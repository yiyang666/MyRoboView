#!/usr/bin/env python3
"""Exercise the compiled C++ bridge and mock over real DDS and HTTP."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
BIN = ROOT / 'ROS2/install/myroboview_platform/lib/myroboview_platform'
CONFIG = ROOT / 'ROS2/src/myroboview_platform/config/demo.json'


def main():
    env = {**os.environ, 'ROS_DOMAIN_ID': '178', 'ROS_LOCALHOST_ONLY': '1', 'ROS_AUTOMATIC_DISCOVERY_RANGE': 'LOCALHOST'}
    with tempfile.TemporaryDirectory(prefix='myroboview-test-') as folder:
        cfg = json.loads(CONFIG.read_text())
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cfg['server']['port'] = sock.getsockname()[1]
        # Prove configuration drives both sides, without relying on demo topic names.
        for topic in cfg['topics']:
            topic['topic'] = '/myroboview/integration/' + topic['id']
            topic['stale_sec'] = 0.8
        path = Path(folder) / 'config.json'
        path.write_text(json.dumps(cfg))
        base = f"http://127.0.0.1:{cfg['server']['port']}"
        processes = []
        logs = []

        def start(name, *extra):
            log = open(Path(folder) / f'{name}-{len(logs)}.log', 'w+')
            logs.append(log)
            process = subprocess.Popen([str(BIN / name), '--config', str(path), *extra], env=env, stdout=log, stderr=log)
            processes.append(process)
            return process

        def stop(process):
            process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                raise AssertionError('C++ process did not shut down within 5 seconds')

        def fetch(route='/api/v1/state', method='GET'):
            request = urllib.request.Request(base + route, method=method)
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.read()

        def until(predicate, timeout=15):
            deadline = time.monotonic() + timeout
            last = None
            while time.monotonic() < deadline:
                try:
                    last = json.loads(fetch())
                    if predicate(last):
                        return last
                except (OSError, ValueError):
                    pass
                time.sleep(0.1)
            raise AssertionError(f'Timed out; last snapshot: {last}')

        try:
            bridge = start('bridge')
            until(lambda data: all(t['state'] == 'waiting' for t in data['topics']))
            assert json.loads(fetch('/api/v1/health'))['read_only'] is True
            assert b'MyRoboView' in fetch('/')
            for route, method, status in [('/api/v1/control/start', 'POST', 405), ('/../../README.md', 'GET', 404)]:
                try:
                    fetch(route, method)
                    raise AssertionError('Unexpected writable or arbitrary file endpoint')
                except urllib.error.HTTPError as error:
                    assert error.code == status
            mock = start('mock')
            data = until(lambda data: all(t['state'] == 'live' and t['count'] >= 3 for t in data['topics']))
            assert data['topics'][0]['data']['mode'] == 'mock_nominal'
            assert all(t['topic'].startswith('/myroboview/integration/') for t in data['topics'])
            assert data['topics'][3]['data']['name'] == ['left_wheel_joint', 'right_wheel_joint']
            assert data['topics'][4]['data']['child_frame_id'] == 'base_link'
            # Selective publisher outage: battery alone becomes stale while other topics stay live.
            stop(mock)
            reduced = json.loads(json.dumps(cfg))
            del reduced['topics'][1]['mock']
            path.write_text(json.dumps(reduced))
            mock = start('mock')
            until(lambda data: data['topics'][1]['state'] == 'stale' and all(t['state'] == 'live' for i, t in enumerate(data['topics']) if i != 1))
            stop(mock)
            until(lambda data: all(t['state'] == 'stale' and t['hz'] == 0 for t in data['topics']))
            path.write_text(json.dumps(cfg))
            warning = start('mock', '--scenario', 'warning')
            until(lambda data: all(t['state'] == 'live' for t in data['topics']) and data['topics'][0]['data']['level'] == 1 and data['topics'][1]['data']['percentage'] < 0.2)
            stop(warning)
            stop(bridge)
            assert bridge.returncode == 0
            # Invalid configuration must fail before opening the service.
            invalid = json.loads(json.dumps(cfg))
            invalid['topics'][0]['type'] = 'missing_pkg/msg/Unknown'
            path.write_text(json.dumps(invalid))
            bad = start('bridge')
            assert bad.wait(timeout=10) != 0
            print('PASS: C++ DDS -> HTTP, config topic remapping, selective dropout, stale/recovery, warning scenario, read-only routes, missing type and graceful shutdown')
        except Exception:
            for log in logs:
                log.flush()
                log.seek(0)
                print(log.read())
            raise
        finally:
            for process in processes:
                if process.poll() is None:
                    stop(process)
            for log in logs:
                log.close()


if __name__ == '__main__':
    main()
