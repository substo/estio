#!/usr/bin/env python3
"""Copy verifier. Defaults to disposable local restore; operator mode requires explicit services and source freeze.
Private CSV/SQL/evidence remain in the cluster directory outside the repository.
"""
import csv, hashlib, json, os, pathlib, subprocess, sys
os.umask(0o077)
root = pathlib.Path(os.path.abspath(sys.argv[1]))
operator = '--operator-apply' in sys.argv[2:]
env = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
if operator:
    import re
    source_service=os.environ.get('STUDIO_COPY_SOURCE_SERVICE','')
    target_service=os.environ.get('STUDIO_COPY_TARGET_SERVICE','')
    if not all(re.fullmatch(r'[a-zA-Z0-9_-]+',v) for v in [source_service,target_service]) or source_service==target_service:
        raise SystemExit('Two distinct explicit pg_service names required')
    service_file=os.environ.get('PGSERVICEFILE')
    if not service_file: raise SystemExit('Explicit private PGSERVICEFILE required')
    env['PGSERVICEFILE']=service_file
    gate=os.environ.get('STUDIO_MERGE_STATE_FILE')
    if not gate or pathlib.Path(gate).exists(): raise SystemExit('Remove activation receipt to freeze target before copy')
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
else:
    if not (root / 'db/PG_VERSION').exists() or not (root / 'source-counts').exists():
        raise SystemExit('Expected a rehearsal cluster from rehearse-restore.sh')
def connection(db):
    if operator: return ['-d','service='+ (source_service if db=='studio_source' else target_service)]
    return ['-h',str(root/'socket'),'-p','55441','-U','rehearsal','-d',db]
def sql(db, query):
    return subprocess.check_output(['psql','-X','-At','-v','ON_ERROR_STOP=1',*connection(db),'-c',query],env=env,text=True)
if operator:
    missing=sql('studio_source', """select count(*) from pg_tables t where schemaname='public'
      and (tablename like 'studio\\_%' escape '\\' or tablename like 'platform\\_%' escape '\\')
      and not exists(select 1 from pg_trigger g where g.tgrelid=format('public.%I',t.tablename)::regclass
      and g.tgname='studio_merge_write_freeze' and g.tgenabled='O')""").strip()
    if missing != '0': raise SystemExit('Source write freeze is incomplete')
def rows(db, query):
    return [json.loads(s) for s in sql(db,query).splitlines()]
def columns(db, schema):
    return rows(db, f"select json_build_object('table',table_name,'column',column_name) from information_schema.columns where table_schema='{schema}' order by table_name,ordinal_position")
source_cols, target_cols = {}, {}
for row in columns('studio_source','public'): source_cols.setdefault(row['table'],[]).append(row['column'])
for row in columns('crm','studio'): target_cols.setdefault(row['table'],[]).append(row['column'])
target_tables = sql('crm',"select tablename from pg_tables where schemaname='studio' order by tablename").splitlines()
locations = rows('crm', '''select json_build_object('id',id,'workspace',"studioWorkspaceId",'realm',"authRealm") from public."Location"''')
workspaces = rows('studio_source','select row_to_json(w) from public.studio_workspaces w')
mapping = {}
for w in workspaces:
    matches = [l for l in locations if l['realm']==w['brand'] and (l['workspace']==w['id'] or l['id']==w['estio_location_id'])]
    if len(matches)!=1: raise SystemExit('Workspace mapping is missing or ambiguous; no writes performed')
    mapping[w['id']]=matches[0]['id']
rename={'studio_location_ai_credentials':'studio_workspace_ai_credentials','studio_location_ai_settings':'studio_workspace_ai_settings'}
consumed=set(rename.get(t,t) for t in target_tables)
# These are superseded authority tables; preserve in source snapshot, never copy into authority.
retired={'studio_workspaces','studio_workspace_memberships','studio_workspace_invitations'}
for t in set(source_cols)-consumed-retired:
    if int(sql('studio_source',f'select count(*) from public."{t}"')):
        raise SystemExit('Unmapped nonempty source table; no writes performed')
statements=['begin;',"set local session_replication_role=replica;",'create temp table merge_rows (v jsonb);']
expected={}
for t in target_tables:
    old=rename.get(t,t)
    if old not in source_cols: raise SystemExit('Target table has no source projection')
    if int(sql('crm',f'select count(*) from studio."{t}"')): raise SystemExit('Target must be empty')
    expressions=[]
    for c in target_cols[t]:
        prior = c.replace('location_id','workspace_id').replace('actor_app','actor_brand')
        if c=='app': prior='brand'
        if c=='legacy_key_prefix': prior='workspace_id'
        if prior not in source_cols[old]: raise SystemExit(f'Unmapped column {t}.{c}')
        value=f's."{prior}"'
        if c=='location_id':
            cases=' '.join("when '"+k+"' then '"+v+"'" for k,v in mapping.items())
            value=f'case s."{prior}"::text {cases} else null end'
        expressions.extend(["'"+c+"'",value])
    projection='jsonb_build_object('+','.join(expressions)+')'
    # SQL computes digest over normalized projection in source; payloads stay private.
    query=f'select {projection} v from public."{old}" s'
    expected[t]=sql('studio_source',f"select count(*)||'|'||md5(coalesce(string_agg(v::text,E'\\n' order by v::text),'')) from ({query}) q").strip()
    payload=rows('studio_source',query)
    path=root/(t+'.csv')
    with path.open('w') as f:
        writer=csv.writer(f); writer.writerows([[json.dumps(v)] for v in payload])
    generated=set(sql('crm',f"select column_name from information_schema.columns where table_schema='studio' and table_name='{t}' and is_generated='ALWAYS'").splitlines())
    writable=[c for c in target_cols[t] if c not in generated]
    names=','.join('"'+c+'"' for c in writable)
    fields=','.join('(jsonb_populate_record(null::studio."'+t+'",v))."'+c+'"' for c in writable)
    statements.extend(['truncate merge_rows;' ,f"\\copy merge_rows from '{path}' with (format csv)",f'insert into studio."{t}" ({names}) overriding system value select {fields} from merge_rows;'])
statements.append('set local session_replication_role=origin;')
# Re-add each FK under a temporary name and validate all copied rows before commit.
fks=rows('crm',"select json_build_object('table',c.conrelid::regclass::text,'definition',pg_get_constraintdef(c.oid)) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='studio' and c.contype='f'")
for i,fk in enumerate(fks):
    name=f'merge_verify_{i}'
    statements.extend([f"alter table {fk['table']} add constraint {name} {fk['definition']};",f"alter table {fk['table']} drop constraint {name};"])
# Explicit IDs must advance identity/serial sequences before workers can write.
sequences=rows('crm', "select json_build_object('table',table_name,'column',column_name,'sequence',pg_get_serial_sequence(format('%I.%I',table_schema,table_name),column_name)) from information_schema.columns where table_schema='studio' and (is_identity='YES' or column_default like 'nextval%')")
for seq in sequences:
    if seq['sequence']:
        statements.append(f"select setval('{seq['sequence']}',greatest(coalesce(max(\"{seq['column']}\"),0),1),coalesce(max(\"{seq['column']}\"),0)>0) from studio.\"{seq['table']}\";")
statements.append('commit;')
script=root/'copy.sql'; script.write_text('\n'.join(statements)+'\n')
with (root/'copy.log').open('w') as log:
    subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1',*connection('crm'),'-f',str(script)],env=env,stdout=log,stderr=log,check=True)
results=[]
for t in target_tables:
    actual=sql('crm',f'''select count(*)||'|'||md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) from studio."{t}" t''').strip()
    if actual!=expected[t]: raise SystemExit(f'Digest mismatch: {t}')
    results.append({'table':t,'count':int(actual.split('|')[0]),'digest':actual.split('|')[1]})
(root/'copy-verification.json').write_text(json.dumps({'tables':results,'foreign_keys':len(fks),'mapped_locations':len(mapping)},indent=2))
print(f'Verified {len(results)} tables, {len(fks)} foreign keys, {len(mapping)} location mappings')
