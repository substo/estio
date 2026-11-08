#!/usr/bin/env python3
"""Keep the owned lease responsive while independently checking canonical identity."""
import os
import select
import signal
import subprocess
import sys
import time


def stop_probe(probe):
    if probe is None:
        return
    # Git may have spawned SSH; stop the entire probe group, not just Git.
    try:
        os.killpg(probe.pid, signal.SIGTERM)
        probe.wait(timeout=1)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        pass
    finally:
        try:
            os.killpg(probe.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    probe.communicate(timeout=1)



def supervise(holder, parent, candidate, ready, command=None, heartbeat=3,
              timeout=10, max_age=20, poll=0.25, local_check=None):
    command = command or ['git', 'ls-remote', '--exit-code', 'origin',
                          'refs/heads/release/studio-go-live']
    local_check = local_check or (lambda: subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], text=True, timeout=2).strip())
    probe = None
    last_verified = time.monotonic()
    next_probe = next_heartbeat = last_verified
    failures = 0
    announced = False
    try:
        while True:
            now = time.monotonic()
            os.kill(parent, 0)
            if holder.poll() is not None:
                raise RuntimeError('Server deployment lease lost')
            if now - last_verified >= max_age:
                raise RuntimeError('Canonical revision verification expired; stopping deployment')
            if now >= next_heartbeat:
                if local_check() != candidate:
                    raise RuntimeError('Candidate changed during deployment')
                holder.stdin.write('\n')
                holder.stdin.flush()
                next_heartbeat = time.monotonic() + heartbeat
            if probe is not None:
                expired = now - started >= timeout
                if probe.poll() is not None or expired:
                    if expired:
                        stop_probe(probe)
                        output, code = '', -1
                    else:
                        output, _ = probe.communicate()
                        code = probe.returncode
                    probe = None
                    if code == 0:
                        if output.split()[:1] != [candidate]:
                            raise RuntimeError('Canonical release tip changed during deployment')
                        last_verified = time.monotonic()
                        failures = 0
                        if not announced:
                            with open(ready, 'w') as file:
                                file.write('READY')
                            announced = True
                    else:
                        failures += 1
                        if failures >= 2:
                            raise RuntimeError('Canonical revision check failed twice; stopping deployment')
                        print('Canonical revision check unavailable; retrying once with lease heartbeat active', file=sys.stderr)
                    next_probe = time.monotonic() + heartbeat
            if probe is None and time.monotonic() >= next_probe:
                probe = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                         text=True, start_new_session=True,
                                         env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})
                started = time.monotonic()
            time.sleep(poll)
    finally:
        stop_probe(probe)


def main():
    server, token, revision, ready, parent, candidate = sys.argv[1:]
    parent = int(parent)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    holder = subprocess.Popen(['/usr/bin/ssh', '-o', 'ServerAliveInterval=3', '-o',
        'ServerAliveCountMax=2', server, 'python3', '/usr/local/lib/estio/deploy-guard.py',
        'hold', token, revision], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        if not select.select([holder.stdout], [], [], 20)[0] or holder.stdout.readline().strip() != 'READY':
            raise RuntimeError('Server deployment lease refused')
        supervise(holder, parent, candidate, ready)
    except (Exception, KeyboardInterrupt):
        try:
            os.kill(parent, signal.SIGTERM)
        except ProcessLookupError:
            pass
        raise
    finally:
        holder.stdin.close()
        try:
            holder.wait(timeout=5)
        except subprocess.TimeoutExpired:
            holder.terminate()
            try:
                holder.wait(timeout=2)
            except subprocess.TimeoutExpired:
                holder.kill()
                holder.wait()


if __name__ == '__main__':
    main()
