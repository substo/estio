#!/usr/bin/env python3
"""Studio SQL codemod: the workspace becomes the Location, brand becomes app.

Rewrites Studio SQL migrations and SQL tests in place:
  * workspace -> location in identifiers, messages and comments;
  * brand -> app (it always meant the app: estio or substo);
  * the Location key is text, so location parameters/columns/variables typed
    uuid become text, and function signatures in grant/revoke/drop/alter
    statements follow.
Run with the file list as arguments. Hand edits (studio_locations itself,
Substo/Estio creation) are made afterwards and are not repeated by this tool.
"""
import re, sys

WORDS = [
    (r'\bstudio_workspaces\b', 'studio_locations'),
    (r'\bstudio_workspace_', 'studio_location_'),
    (r'\bworkspace_brand\b', 'location_app'),
    (r'\bp_actor_brand\b', 'p_actor_app'),
    (r'\bactor_brand\b', 'actor_app'),
    (r'\bp_brand\b', 'p_app'),
    (r'\bv_brand\b', 'v_app'),
    (r'\bbrands\b', 'apps'),
    (r'\bbrand\b', 'app'),
    (r'\bBrand\b', 'App'),
    (r'workspaceId', 'locationId'),
    (r'WorkspaceId', 'LocationId'),
    (r'workspaces', 'locations'),
    (r'Workspaces', 'Locations'),
    (r'workspace', 'location'),
    (r'Workspace', 'Location'),
    (r'WORKSPACE', 'LOCATION'),
]

LOC_PARAM = re.compile(r'^(p_location|p_location_id|location_id|p_[a-z_]*location_id)$')

def split_params(s):
    out, depth, cur = [], 0, ''
    for ch in s:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += ch
    if cur.strip():
        out.append(cur)
    return out

def norm_type(t):
    return re.sub(r'\s+', ' ', t.strip().lower())

HEADER = re.compile(r'(create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?)([a-z_0-9]+)\s*\(', re.I)

def find_close(text, start):
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '(':
            depth += 1
        elif text[i] == ')':
            depth -= 1
            if depth == 0:
                return i
    raise ValueError('unbalanced')

def fix_headers(text, sigs):
    """Retype location params in function headers; record signature changes."""
    out, pos = [], 0
    for m in HEADER.finditer(text):
        open_i = m.end() - 1
        close_i = find_close(text, open_i)
        params = split_params(text[open_i + 1:close_i])
        old_types, new_types, new_params = [], [], []
        for p in params:
            mm = re.match(r'^(\s*)(?:(in|out|inout|variadic)\s+)?([a-z_0-9]+)\s+(.*?)(\s+default\s+.*)?(\s*)$', p, re.I | re.S)
            if not mm:
                new_params.append(p); old_types.append(norm_type(p)); new_types.append(norm_type(p)); continue
            mode, name, typ = mm.group(2), mm.group(3), mm.group(4)
            if mode and mode.lower() == 'out':
                new_params.append(p); continue
            old_types.append(norm_type(typ))
            if LOC_PARAM.match(name) and norm_type(typ) == 'uuid':
                p = p[:mm.start(4)] + 'text' + p[mm.end(4):]
                new_types.append('text')
            else:
                new_types.append(norm_type(typ))
            new_params.append(p)
        if old_types != new_types:
            sigs[(m.group(2).lower(), tuple(old_types))] = tuple(new_types)
        out.append(text[pos:open_i + 1]); out.append(','.join(new_params)); pos = close_i
    out.append(text[pos:])
    return ''.join(out)

ALIASES = {'timestamptz': 'timestamp with time zone', 'int': 'integer', 'int4': 'integer', 'int8': 'bigint', 'bool': 'boolean'}

def canon(t):
    t = norm_type(t)
    return ALIASES.get(t, t)

REF = re.compile(r'\b(?:public\.)?([a-z_0-9]+)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)', re.I)

def fix_signatures(text, sigs):
    canon_sigs = {(n, tuple(canon(t) for t in old)): new for (n, old), new in sigs.items()}
    def repl(m):
        name = m.group(1).lower()
        body = m.group(2)
        parts = split_params(body) if body.strip() else []
        key = (name, tuple(canon(p) for p in parts))
        new = canon_sigs.get(key)
        if new is None:
            return m.group(0)
        old_c = key[1]
        rebuilt = []
        for p, o, n in zip(parts, old_c, new):
            rebuilt.append(re.sub(r'\buuid\b', 'text', p, count=1, flags=re.I) if o == 'uuid' and n == 'text' else p)
        return m.group(0)[:m.start(2) - m.start(0)] + ','.join(rebuilt) + ')'
    # Signatures quoted as text, e.g. has_function_privilege('public.f(uuid,text)', ...).
    text = re.sub(r"'public\.[a-z_0-9]+\([^()']*\)'", lambda m: REF.sub(repl, m.group(0)), text)
    # Only statements naming a function signature (no parameter names).
    lines = []
    for stmt in re.split(r'(;)', text):
        if re.search(r'\b(grant|revoke|drop\s+function|alter\s+function|comment\s+on\s+function)\b', stmt, re.I):
            stmt = REF.sub(repl, stmt)
        lines.append(stmt)
    return ''.join(lines)

def transform(text, sigs):
    for pat, rep in WORDS:
        text = re.sub(pat, rep, text)
    text = fix_headers(text, sigs)
    # Columns, return-table columns and variables holding a Location ID.
    text = re.sub(r'\b((?:v_|p_)?[a-z_]*location_id|p_location)(\s+)uuid\b(?!\s*\[)', r'\1\2text', text)
    # Row access on the Location row.
    text = re.sub(r'\bv_location\.id\b', 'v_location.location_id', text)
    text = re.sub(r'(references\s+public\.studio_locations\s*)\(\s*id\s*\)', r'\1(location_id)', text, flags=re.I)
    text = re.sub(r'(references\s+public\.studio_locations\s*)\(\s*id\s*,\s*app\s*\)', r'\1(location_id, app)', text, flags=re.I)
    return text

def main(paths):
    sigs = {}
    texts = {p: open(p, encoding='utf-8').read() for p in paths}
    # Pass 1 collects every retyped signature across all files (later files grant earlier functions).
    stage = {p: transform(t, sigs) for p, t in texts.items()}
    # A renamed function keeps its retyped signature under the new name.
    for t in stage.values():
        for m in re.finditer(r'alter\s+function\s+(?:public\.)?([a-z_0-9]+)\s*\(([^()]*)\)\s+rename\s+to\s+([a-z_0-9]+)', t, re.I):
            types = tuple(canon(x) for x in split_params(m.group(2)))
            for (name, old), new in list(sigs.items()):
                if name == m.group(1).lower() and tuple(canon(x) for x in old) == types:
                    sigs[(m.group(3).lower(), old)] = new
    for p, t in stage.items():
        t = fix_signatures(t, sigs)
        open(p, 'w', encoding='utf-8').write(t)
    for (name, old), new in sorted(sigs.items()):
        print(f'{name}({",".join(old)}) -> ({",".join(new)})')

if __name__ == '__main__':
    main(sys.argv[1:])
