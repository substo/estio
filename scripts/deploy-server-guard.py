#!/usr/bin/env python3
"""Server-owned deployment serialization. No package dependencies or stale-lock deletion."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

STATE = Path('/home/martin/.deploy-state')
LIVE = Path('/home/martin/estio-app')
CADDY = Path('/etc/caddy/Caddyfile')


def identity(pid):
    # Linux start ticks distinguish a live owner from a reused PID.
    raw = Path(f'/proc/{pid}/stat').read_text()
    fields = raw[raw.rfind(')') + 2:].split()
    if fields[0] in ('Z', 'X'):
        raise ProcessLookupError('Lease holder is no longer running')
    return fields[19]


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, value, exclusive=False):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = (json.dumps(value, sort_keys=True) + '\n').encode()
    if exclusive:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    else:
        temp = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
        try:
            with open(temp, 'wb') as handle:
                os.chmod(temp, 0o600)
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Guard:
    def __init__(self, state=STATE, live=LIVE, caddy=CADDY, ttl=15, process_identity=identity):
        self.state, self.live = Path(state), Path(live)
        self.caddy = Path(caddy) if caddy else None
        self.ttl, self.process_identity = ttl, process_identity
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)

    def lock(self):
        handle = open(self.state / 'deployment.lock', 'a+')
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.close()
            raise RuntimeError('Another deployment owns the server lock')
        return handle

    def drain_lock(self, shared=False):
        handle = open(self.state / 'operation-drain.lock', 'a+')
        try:
            flags = fcntl.LOCK_SH if shared else fcntl.LOCK_EX | fcntl.LOCK_NB
            fcntl.flock(handle, flags)
        except BlockingIOError:
            handle.close()
            raise RuntimeError('Previous deployment operations are still draining or rolling back')
        return handle

    def manifest(self):
        value = json.loads((self.state / 'current-release.json').read_text())
        if not re.fullmatch('[0-9a-f]{40}', value.get('revision', '')):
            raise RuntimeError('Production release identity is missing or invalid')
        return value

    def actual_live(self):
        if not self.live.is_symlink():
            raise RuntimeError('Live release is not the expected slot symlink')
        target = self.live.resolve(strict=True)
        match = re.fullmatch('estio-app-(blue|green)', target.name)
        if not match:
            raise RuntimeError('Live symlink points outside a known release slot')
        slot = match.group(1)
        build = (target / '.next/BUILD_ID').read_text().strip()
        if not re.fullmatch('[A-Za-z0-9_-]{1,128}', build):
            raise RuntimeError('Live build identity is invalid')
        if self.caddy:
            ports = set(re.findall(r'reverse_proxy\s+localhost:(3001|3002)\b', self.caddy.read_text()))
            if ports != {dict(blue='3001', green='3002')[slot]}:
                raise RuntimeError('Caddy and live symlink disagree on the active slot')
        return target, build, slot

    def verify_release(self, expected_revision):
        current = self.manifest()
        _, build, slot = self.actual_live()
        if current['revision'] != expected_revision:
            raise RuntimeError('Production committed revision changed')
        if current.get('buildId') != build or current.get('slot') != slot:
            raise RuntimeError('Unmanaged runtime drift: live slot/build differs from release manifest')
        return current

    def lease(self, token):
        if not re.fullmatch('[A-Za-z0-9_-]{8,128}', token):
            raise RuntimeError('Invalid lease token')
        value = json.loads((self.state / 'lease.json').read_text())
        if value.get('token') != token or time.time() - value.get('heartbeatAt', 0) > self.ttl:
            raise RuntimeError('Deployment lease is absent, expired or owned by another deployment')
        try:
            if self.process_identity(value['pid']) != value['start']:
                raise RuntimeError('Deployment lease owner has exited')
        except (OSError, KeyError, IndexError):
            raise RuntimeError('Deployment lease owner has exited')
        return value

    def check(self, token, expected_revision):
        self.lease(token)
        return self.verify_release(expected_revision)

    def hold(self, token, expected_revision, input_fd=0, ready=None):
        if not re.fullmatch('[A-Za-z0-9_-]{8,128}', token):
            raise RuntimeError('Invalid lease token')
        with self.lock():
            # A dead holder releases deployment.lock before its op has completed
            # rollback. A successor must not change slots while that op drains.
            with self.drain_lock():
                pass
            self.verify_release(expected_revision)
            owner = {'token': token, 'pid': os.getpid(), 'start': self.process_identity(os.getpid()),
                     'heartbeatAt': time.time(), 'expectedRevision': expected_revision}
            atomic_json(self.state / 'lease.json', owner)
            select = selectors.DefaultSelector()
            select.register(input_fd, selectors.EVENT_READ)
            try:
                if ready:
                    ready()
                else:
                    print('READY', flush=True)
                deadline = time.monotonic() + self.ttl
                pending = b''
                while True:
                    wait = max(0, deadline - time.monotonic())
                    events = select.select(wait)
                    if not events:
                        raise RuntimeError('Deployment heartbeat expired')
                    chunk = os.read(input_fd, 4096)
                    if not chunk:
                        return
                    pending += chunk
                    if len(pending) > 8192:
                        raise RuntimeError('Invalid heartbeat')
                    if b'\n' in pending:
                        pending = pending.rsplit(b'\n', 1)[1]
                        if len(pending) > 4096:
                            raise RuntimeError('Invalid heartbeat')
                        deadline = time.monotonic() + self.ttl
                        owner['heartbeatAt'] = time.time()
                        atomic_json(self.state / 'lease.json', owner)
            finally:
                select.close()
                # Do not delete another owner's record; never unlink deployment.lock.
                try:
                    found = json.loads((self.state / 'lease.json').read_text())
                    if found.get('token') == token and found.get('pid') == os.getpid():
                        (self.state / 'lease.json').unlink()
                except (OSError, ValueError):
                    pass

    def op(self, token, command):
        with self.drain_lock(shared=True):
            return self._op(token, command)

    def _op(self, token, command):
        self.lease(token)
        child = subprocess.Popen(['bash', '-c', command], start_new_session=True)
        try:
            while child.poll() is None:
                self.lease(token)
                time.sleep(0.2)
            # A successful command with a lost lease is still a failed deployment.
            self.lease(token)
            return child.returncode
        except BaseException:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            raise

    def publish(self, token, revision, build, fingerprint, slot):
        lease = self.lease(token)
        if not re.fullmatch('[0-9a-f]{40}', revision) or not re.fullmatch('[0-9a-f]{64}', fingerprint):
            raise RuntimeError('Invalid release revision or fingerprint')
        previous = self.manifest()
        if previous['revision'] != lease['expectedRevision']:
            raise RuntimeError('Production release changed before publication')
        target, actual_build, actual_slot = self.actual_live()
        if (actual_build, actual_slot) != (build, slot):
            raise RuntimeError('Cannot publish a release that is not serving traffic')
        if (target / '.next/estio-source.sha256').read_text().strip() != fingerprint:
            raise RuntimeError('Published build fingerprint does not match target artifact')
        value = {'revision': revision, 'buildId': build, 'fingerprint': fingerprint, 'slot': slot,
                 'at': timestamp(), 'token': token, 'previous': {k: v for k, v in previous.items() if k != 'previous'}}
        self.lease(token)
        atomic_json(self.state / 'history' / f'{token}.json', value, exclusive=True)
        self.lease(token)
        atomic_json(self.state / 'current-release.json', value)
        return value

    def bootstrap(self, revision, observed_build, slot):
        if not re.fullmatch('[0-9a-f]{40}', revision):
            raise RuntimeError('Verified committed revision is required')
        with self.lock():
            if (self.state / 'current-release.json').exists():
                raise RuntimeError('Bootstrap refuses to replace an existing release identity')
            target, build, active = self.actual_live()
            if (build, active) != (observed_build, slot):
                raise RuntimeError('Observed live build/slot changed before bootstrap')
            fingerprint = (target / '.next/estio-source.sha256').read_text().strip()
            if not re.fullmatch('[0-9a-f]{64}', fingerprint):
                raise RuntimeError('Observed live build has no verified input fingerprint')
            value = {'revision': revision, 'buildId': build, 'fingerprint': fingerprint, 'slot': slot,
                     'at': timestamp(), 'previous': None, 'bootstrap': 'explicit-operator-verified-live-build'}
            atomic_json(self.state / 'history' / f'bootstrap-{build}.json', value, exclusive=True)
            atomic_json(self.state / 'current-release.json', value)
            return value


def main(args):
    guard = Guard()
    if args == ['inspect']:
        value = guard.manifest()
        guard.verify_release(value['revision'])
        result = {key: value[key] for key in ['revision', 'buildId', 'fingerprint', 'slot']}
        services = json.loads(subprocess.check_output(['pm2', 'jlist']))
        result['services'] = [{'name': s['name'], 'status': s['pm2_env']['status'], 'restarts': s['pm2_env'].get('restart_time', 0)} for s in services]
        print(json.dumps(result))
    elif len(args) == 2 and args[0] == 'verify-code':
        if not re.fullmatch('[0-9a-f]{64}', args[1]) or hashlib.sha256(Path(__file__).read_bytes()).hexdigest() != args[1]:
            raise RuntimeError('Installed deployment guard code does not match candidate')
        print('OK')
    elif len(args) == 3 and args[0] == 'hold':
        guard.hold(args[1], args[2])
    elif len(args) == 3 and args[0] == 'check':
        guard.check(args[1], args[2])
        print('OK')
    elif len(args) == 3 and args[0] == 'op':
        command = base64.b64decode(args[2], validate=True).decode('utf-8')
        return guard.op(args[1], command)
    elif len(args) == 6 and args[0] == 'publish':
        print(json.dumps(guard.publish(*args[1:])))
    elif len(args) == 4 and args[0] == 'bootstrap':
        print(json.dumps(guard.bootstrap(*args[1:])))
    else:
        raise RuntimeError('Usage: inspect | verify-code SHA256 | hold TOKEN EXPECTED_REV | check TOKEN EXPECTED_REV | op TOKEN BASE64_COMMAND | publish TOKEN REV BUILD FINGERPRINT SLOT | bootstrap VERIFIED_REV OBSERVED_BUILD SLOT')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as error:
        print(f'Deployment guard refused: {error}', file=sys.stderr)
        sys.exit(1)
