#!/usr/bin/env python3
"""Forced command for the existing deployment SSH key: old unguarded scripts fail closed.
Other administrator keys are outside this accidental-concurrency boundary.
"""
import os,shlex,sys
try:
 args=shlex.split(os.environ.get('SSH_ORIGINAL_COMMAND',''))
 if args[:2]!=['python3','/usr/local/lib/estio/deploy-guard.py'] or len(args)<3 or args[2] not in ['hold','check','op','publish','inspect','verify-code']:
  raise ValueError('Use the current canonical deploy-local-build.sh; unguarded SSH deployment is disabled')
 os.execv('/usr/bin/python3',['python3',*args[1:]])
except (ValueError,OSError) as e:
 print(str(e),file=sys.stderr);sys.exit(1)
