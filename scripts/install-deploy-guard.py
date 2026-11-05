#!/usr/bin/env python3
"""Explicit one-time verified adoption. No automatic deployment bootstrap."""
import argparse,subprocess,json,base64,shlex,pathlib,re
p=argparse.ArgumentParser();p.add_argument('--revision',required=True);p.add_argument('--build',required=True);p.add_argument('--slot',choices=['blue','green'],required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
if not re.fullmatch('[0-9a-f]{40}',a.revision) or not re.fullmatch('[A-Za-z0-9_-]{1,128}',a.build):raise SystemExit('Invalid explicit identity')
if not a.apply:print('Preview: install reviewed server lease/gate, explicitly bootstrap observed identity, constrain existing deployment key.');raise SystemExit()
data={'guard':base64.b64encode(pathlib.Path('scripts/deploy-server-guard.py').read_bytes()).decode(),'gate':base64.b64encode(pathlib.Path('scripts/deploy-ssh-gate.py').read_bytes()).decode(),'pub':(pathlib.Path.home()/'.ssh/id_ed25519.pub').read_text().split()[:2],'revision':a.revision,'build':a.build,'slot':a.slot}
code='''import pathlib,json,base64,sys,subprocess,os,time
v=json.load(sys.stdin);d=pathlib.Path('/usr/local/lib/estio');d.mkdir(parents=True,exist_ok=True)
state=pathlib.Path('/home/martin/.deploy-state/current-release.json')
if state.exists():raise SystemExit('Already adopted; no bootstrap or automatic guard replacement allowed')
for key,name in [('guard','deploy-guard.py'),('gate','deploy-ssh-gate.py')]:
 p=d/name;p.write_bytes(base64.b64decode(v[key]));p.chmod(0o700)
p=pathlib.Path('/root/.ssh/authorized_keys');old=p.read_text();lines=old.splitlines();matches=[i for i,l in enumerate(lines) if l.split()[:2]==v['pub']]
if len(matches)!=1:raise SystemExit('Expected exactly one plain existing deployment key; no authorization changed')
subprocess.run(['python3',str(d/'deploy-guard.py'),'bootstrap',v['revision'],v['build'],v['slot']],check=True)
backup=p.with_name('authorized_keys.before-estio-guard-'+str(int(time.time())));backup.write_text(old);backup.chmod(0o600)
i=matches[0];lines[i]='command="/usr/bin/python3 /usr/local/lib/estio/deploy-ssh-gate.py",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty '+lines[i]
temp=p.with_name('authorized_keys.estio-tmp');temp.write_text('\\n'.join(lines)+'\\n');temp.chmod(0o600);os.replace(temp,p)
print('Installed verified manifest, lease supervisor and existing-key gate; original authorization backed up privately.')
'''
subprocess.run(['ssh','root@138.199.214.117','python3 -c '+shlex.quote(code)],input=json.dumps(data).encode(),check=True)
