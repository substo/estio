#!/usr/bin/env python3
"""Only the owned deployment's remote operations use this monitored transport."""
import os,sys,base64,shlex
args=sys.argv[1:]; target='root@138.199.214.117'
host=target if target in args else '138.199.214.117'
if host not in args: raise SystemExit('Unexpected deployment SSH target')
i=args.index(host); opts=args[:i]; command=args[i+1:]
if not command: raise SystemExit('Unscoped SSH session refused')
cmd=' '.join(command) # ssh itself joins its remote argv with spaces.
payload=base64.b64encode(cmd.encode()).decode()
remote=shlex.join(['python3','/usr/local/lib/estio/deploy-guard.py','op',os.environ['ESTIO_DEPLOY_TOKEN'],payload])
os.execv('/usr/bin/ssh',['ssh',*opts,target,remote])
