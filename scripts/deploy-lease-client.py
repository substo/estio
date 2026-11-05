#!/usr/bin/env python3
"""Keep the server-owned flock alive only while this deployment and its SSH guard live."""
import os,sys,subprocess,time,signal,select,json
server,token,revision,ready,parent,candidate=sys.argv[1:]; parent=int(parent); stopping=False
signal.signal(signal.SIGTERM,lambda *_:sys.exit(0))
p=subprocess.Popen(['/usr/bin/ssh','-o','ServerAliveInterval=3','-o','ServerAliveCountMax=2',server,'python3','/usr/local/lib/estio/deploy-guard.py','hold',token,revision],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
try:
 if not select.select([p.stdout],[],[],20)[0] or p.stdout.readline().strip()!='READY': raise RuntimeError('Server deployment lease refused')
 with open(ready,'w') as f: f.write('READY')
 while True:
  os.kill(parent,0)
  if p.poll() is not None: raise RuntimeError('Server deployment lease lost')
  tip=subprocess.check_output(['git','ls-remote','--exit-code','origin','refs/heads/release/studio-go-live'],text=True,timeout=10).split()[0]
  if tip!=candidate: raise RuntimeError('Canonical release tip changed during deployment')
  if subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()!=candidate: raise RuntimeError('Candidate changed during deployment')
  p.stdin.write('\n');p.stdin.flush();time.sleep(3)
except (Exception,KeyboardInterrupt):
 try: os.kill(parent,signal.SIGTERM)
 except ProcessLookupError: pass
 raise
finally:
 if p.stdin: p.stdin.close()
 try:p.wait(timeout=5)
 except subprocess.TimeoutExpired:p.terminate()
