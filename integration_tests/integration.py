#!/usr/bin/env python3
"""Real C++ robotapp -> DDS -> Drogon -> HTTP/WebSocket, no extra Python deps."""
import base64
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import rclpy
from node_app_msgs.msg import IotCmdMsg

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = os.environ.get('PRODUCT', 'lrs-x')


def find_install_prefix() -> Path:
    # 统一构建产物在外层 build_all_robot；兼容从开发仓或构建工作区源码副本运行
    for cand in (ROOT.parent / 'build_all_robot', ROOT.parent.parent):
        if (cand / 'Makefile').is_file() and (cand / 'repos').is_dir():
            return cand / 'build' / PRODUCT / 'x86_64' / 'install'
    raise SystemExit('未找到外层构建工作区 build_all_robot，请先执行 ./scripts/build.sh')


# 产物前缀：优先取环境变量（scripts/test.sh 按构建模式显式传入），否则自动探测外层统一构建体系
INSTALL_PREFIX = Path(os.environ['MYROBOVIEW_INSTALL']) if os.environ.get('MYROBOVIEW_INSTALL') else find_install_prefix()
APP = INSTALL_PREFIX / 'bin/robotapp_node'
BACKEND = INSTALL_PREFIX / 'bin/roboview'


class WebSocket:
    def __init__(self, port):
        self.socket = socket.create_connection(('127.0.0.1', port), timeout=2)
        self.buffer = b''
        key = base64.b64encode(os.urandom(16)).decode()
        self.socket.sendall((f'GET /ws HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n').encode())
        while b'\r\n\r\n' not in self.buffer:
            self.buffer += self.socket.recv(4096)
        headers, self.buffer = self.buffer.split(b'\r\n\r\n', 1)
        expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        assert b'101 Switching Protocols' in headers and expected in headers

    def exact(self, size):
        while len(self.buffer) < size:
            data = self.socket.recv(65536)
            if not data:
                raise ConnectionError('WebSocket closed')
            self.buffer += data
        result, self.buffer = self.buffer[:size], self.buffer[size:]
        return result

    def message(self):
        while True:
            first, second = self.exact(2)
            assert first & 0x80, 'fragmented message unexpected in small demo frames'
            assert not second & 0x80, 'server frames must be unmasked'
            size = second & 127
            if size == 126:
                size = struct.unpack('!H', self.exact(2))[0]
            elif size == 127:
                size = struct.unpack('!Q', self.exact(8))[0]
            payload = self.exact(size)
            if first & 15 == 1:
                return json.loads(payload)
            if first & 15 == 8:
                raise ConnectionError('WebSocket close frame')
            if first & 15 == 9:
                mask = os.urandom(4)
                self.socket.sendall(bytes([0x8A, 0x80 | len(payload)]) + mask + bytes(v ^ mask[i % 4] for i, v in enumerate(payload)))

    def close(self):
        self.socket.close()


def main():
    env = {**os.environ, 'ROS_DOMAIN_ID': '178', 'ROS_AUTOMATIC_DISCOVERY_RANGE': 'LOCALHOST'}
    env.pop('ROS_LOCALHOST_ONLY', None)
    # 配置按产品拆分，读取当前测试产品对应的一份
    cfg = json.loads((ROOT / 'roboview/backend/config' / PRODUCT / 'myroboview.json').read_text())
    # robotapp 配置同样按产品取（type/motor_count 差异化由这里进入 mock）
    app_cfg = json.loads((ROOT / 'robotapp/config' / PRODUCT / 'robotapp.json').read_text())
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    cfg['server']['port'] = port
    app_cfg['state_step_sec'] = 0.3
    for topic in cfg['topics']:
        topic['topic'] = '/test_myroboview/' + topic['id']
        topic['stale_sec'] = 0.7
        app_cfg['topics'][topic['id']]['name'] = topic['topic']
    base = f'http://127.0.0.1:{port}'
    with tempfile.TemporaryDirectory(prefix='myroboview-separation-') as folder:
        backend_path, app_path = Path(folder) / 'backend.json', Path(folder) / 'robotapp.json'
        backend_path.write_text(json.dumps(cfg)); app_path.write_text(json.dumps(app_cfg))
        processes, logs, sockets = [], [], []
        context = rclpy.context.Context()
        context.init(domain_id=178)
        observer = rclpy.create_node('myroboview_command_test', context=context)
        executor = rclpy.executors.SingleThreadedExecutor(context=context)
        executor.add_node(observer)
        observed, expected_commands = [], []
        observer.create_subscription(IotCmdMsg, '/iot/command', lambda message: observed.append({
            'category': message.category, 'fun_name': message.fun_name, 'sub': message.sub, 'param': message.param}), 10)

        def collect_commands(seconds=.15):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                executor.spin_once(timeout_sec=.02)

        def launch(binary, path):
            log = open(Path(folder) / f'{len(logs)}.log', 'w+')
            logs.append(log)
            process = subprocess.Popen([str(binary), '--config', str(path)], cwd=folder, env=env, stdout=log, stderr=log)
            processes.append(process)
            return process

        def stop(process):
            if process.poll() is not None:
                return
            process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
                raise AssertionError('Process did not terminate within 5 seconds')
            assert process.returncode == 0, f'Unexpected exit {process.returncode}'

        def request(route='/api/v1/state', data=None, method=None, expected=200):
            body = json.dumps(data).encode() if data is not None else None
            req = urllib.request.Request(base + route, data=body, method=method, headers={'Content-Type': 'application/json'})
            try:
                response = urllib.request.urlopen(req, timeout=2)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                assert response.code == expected, f'{route}: {response.code}, wanted {expected}: {response.read()}'
                content = response.read()
                result = json.loads(content) if response.headers.get_content_type() == 'application/json' else content
                if isinstance(result, dict) and result.get('published'):
                    expected_commands.append(result['command'])
                collect_commands(.03)
                return result

        def until(predicate, route='/api/v1/state', timeout=12):
            deadline = time.monotonic() + timeout
            last = None
            while time.monotonic() < deadline:
                try:
                    last = request(route)
                    if predicate(last):
                        return last
                except (OSError, ValueError):
                    pass
                time.sleep(.05)
            raise AssertionError(f'Timed out: {last}')

        def websocket():
            ws = WebSocket(port); sockets.append(ws)
            assert ws.message()['type'] == 'hello'
            return ws

        try:
            backend = launch(BACKEND, backend_path)
            until(lambda state: all(t['state'] == 'waiting' for t in state['topics']))
            assert request('/api/v1/health')['framework'] == 'drogon'
            assert request('/api/v1/health')['robot_control'] is True
            from artifacts import inspect_artifacts
            artifact = inspect_artifacts(INSTALL_PREFIX, PRODUCT)
            assert request('/').decode() == (INSTALL_PREFIX / 'etc/web/index.html').read_text()
            for entry in artifact['entrypoints']:
                assert request('/' + entry) == (INSTALL_PREFIX / 'etc/web' / entry).read_bytes()
            until(lambda _: observer.count_publishers('/iot/command') == 1)
            collect_commands(.5)
            assert request('/nav_maps/test_map01.png').startswith(b'\x89PNG')
            request('/api/v1/state', method='POST', expected=405)
            request('/AGENTS.md', expected=404)
            request('/api/v1/control/start', data={}, expected=404)
            # Navigation exists even without robotapp or any DDS message.
            resources = request('/api/v1/nav/maps/current/resources')
            assert len(resources['waypoints']) == 5 and len(resources['routes']) == 1
            assert resources['map']['source'] == 'demo'
            loaded = request('/api/v1/nav/maps/load', data={'map_id': resources['map']['id']})
            assert loaded['command'] == {'category': 'MAP', 'fun_name': 'LOAD', 'sub': '', 'param': resources['map']['name']}
            request('/api/v1/nav/mapping/start', data={'map_name': 'bad,map'}, expected=400)
            started = request('/api/v1/nav/mapping/start', data={'map_name': 'test_map'})
            assert started['command']['param'] == 'online,test_map'
            assert request('/api/v1/nav/state')['mapping']['active'] is True
            request('/api/v1/nav/mapping/start', data={'map_name': 'duplicate'}, expected=409)
            request('/api/v1/nav/tasks/route/start', data={'route_id': resources['routes'][0]['id']}, expected=409)
            request('/api/v1/nav/mapping/stop', data={})
            request('/api/v1/nav/localization/start', data={})
            original_pose = request('/api/v1/nav/state')['pose']
            relocated = request('/api/v1/nav/localization/manual', data={'x': 1, 'y': 2, 'yaw': .5})
            assert relocated['command']['param'] == '1.000000,2.000000,0.500000'
            assert request('/api/v1/nav/state')['pose']['x'] == 1
            request('/api/v1/nav/localization/manual', data={'x': -1, 'y': 2, 'yaw': 0}, expected=400)
            request('/api/v1/nav/localization/manual', data=original_pose)
            request('/api/v1/nav/tasks/route/pause', data={}, expected=409)
            request('/api/v1/nav/maps/load', data={'map_id': 'invalid'}, expected=404)
            route_id = resources['routes'][0]['id']
            started = request('/api/v1/nav/tasks/route/start', data={'route_id': route_id})
            expected_param = ';'.join(','.join(f'{point[key]:.6f}' for key in ('x', 'y', 'yaw')) for point in resources['waypoints'])
            assert started['command'] == {'category': 'NAV', 'fun_name': 'START', 'sub': '', 'param': expected_param}
            request('/api/v1/nav/tasks/route/start', data={'route_id': route_id}, expected=409)
            request('/api/v1/nav/routes/' + route_id, method='DELETE', expected=409)
            start_pose = request('/api/v1/nav/state')['pose']
            until(lambda s: s['pose'] != start_pose, '/api/v1/nav/state')
            request('/api/v1/nav/tasks/route/pause', data={})
            paused = request('/api/v1/nav/state')
            time.sleep(.2)
            assert request('/api/v1/nav/state')['pose'] == paused['pose']
            request('/api/v1/nav/tasks/route/resume', data={})
            until(lambda s: s['pose'] != paused['pose'], '/api/v1/nav/state')
            request('/api/v1/nav/tasks/route/stop', data={})
            assert request('/api/v1/nav/state')['status'] == 'CANCELED'
            p = request('/api/v1/nav/state')['pose']
            waypoint = request('/api/v1/nav/waypoints', data={'map_id': resources['map']['id'], 'name': 'close target', 'x': p['x'] + .05, 'y': p['y'], 'yaw': .5})['waypoint']
            route = request('/api/v1/nav/routes', data={'name': 'short', 'waypoint_ids': [waypoint['id']]})['route']
            request('/api/v1/nav/waypoints/' + waypoint['id'], method='DELETE', expected=409)
            request('/api/v1/nav/tasks/route/start', data={'route_id': route['id']})
            complete = until(lambda s: s['status'] == 'SUCCEEDED', '/api/v1/nav/state')
            assert abs(complete['pose']['x'] - waypoint['x']) < 1e-8
            request('/api/v1/nav/routes/' + route['id'], method='DELETE')
            request('/api/v1/nav/waypoints/' + waypoint['id'], method='DELETE')
            request('/api/v1/nav/routes', data={'name': 'bad', 'waypoint_ids': []}, expected=400)
            collect_commands(.5)
            assert observed == expected_commands, (observed, expected_commands)
            app = launch(APP, app_path)
            state = until(lambda s: all(t['state'] == 'live' and t['count'] >= 3 for t in s['topics']))
            data = state['topics'][0]['data']
            assert state['robot']['product'] == PRODUCT
            assert data['product'] == PRODUCT
            assert data['robot_id'] == state['robot']['id'] == app_cfg['robot']['id']
            assert data['robot_type'] == {'lrs-x': 0, 'lrd-w': 1}[PRODUCT]
            assert state['robot']['type'] == app_cfg['robot']['type']
            assert 0 <= data['battery_percentage'] <= 100 and data['battery_voltage'] > 0
            motors = state['topics'][2]['data']['motors']
            assert len(motors) == app_cfg['motor_count'] and motors[0]['online_status'] == 0 and motors[1]['motor_direction'] == -1
            assert {'motor_id', 'online_status', 'health_status', 'motor_direction', 'motor_temperature', 'motor_voltage', 'motor_position_zero_rad'} <= motors[0].keys()
            ws, second = websocket(), websocket()
            counts = Counter(); phases = set(); deadline = time.monotonic() + 2.5
            while time.monotonic() < deadline:
                frame = ws.message(); counts[frame['type']] += 1
                if frame['type'] == 'robot_state':
                    phases.add(frame['data']['current_action'])
                if frame['type'] == 'sensor_data':
                    assert frame['receive_hz'] > 50
            for event, hz in [('robot_state', 5), ('sensor_data', 10), ('motor_health', 2), ('nav_state', 5)]:
                assert 2.5 * hz * .6 <= counts[event] <= 2.5 * hz * 1.4 + 2, (event, counts)
            # 动作集按产品差异化（与 robotapp 状态机一致）：人形 WALK+WAVE，四足轮式 WALK+RUN
            expected_actions = {2, 5} if PRODUCT == 'lrs-x' else {2, 3}
            assert expected_actions <= phases, phases
            assert second.message()['type'] in counts
            stop(app)
            until(lambda s: all(t['state'] == 'stale' for t in s['topics']))
            # New connection must still receive explicit stale telemetry broadcasts.
            stale_ws = websocket(); deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                frame = stale_ws.message()
                if frame['type'] == 'robot_state':
                    assert frame['state'] == 'stale'
                    break
            else:
                raise AssertionError('No stale WebSocket status')
            app_cfg['scenario'] = 'fault'; app_path.write_text(json.dumps(app_cfg))
            app = launch(APP, app_path)
            until(lambda s: all(t['state'] == 'live' for t in s['topics']) and s['topics'][0]['data']['running_status'] == 3 and s['topics'][2]['data']['motors'][0]['online_status'] == 1 and s['topics'][2]['data']['motors'][0]['health_status'] == 2)
            stop(app)
            for ws in sockets:
                ws.close()
            sockets.clear()
            stop(backend)
            cfg['navigation']['enabled'] = False
            backend_path.write_text(json.dumps(cfg))
            backend = launch(BACKEND, backend_path)
            until(lambda s: all(t['state'] == 'waiting' for t in s['topics']))
            request('/api/v1/nav/state', expected=404)
            stop(backend)
            cfg['topics'][0]['type'] = 'missing_pkg/msg/Unknown'; backend_path.write_text(json.dumps(cfg))
            invalid = launch(BACKEND, backend_path)
            assert invalid.wait(timeout=10) != 0
            print('PASS independent configs, ROS state/IMU/motors, Drogon WS rates/multi-client, stale/recovery, navigation CRUD/motion/pause/stop/completion, disabled navigation, shutdown')
        except Exception:
            for log in logs:
                log.flush(); log.seek(0); print(log.read())
            raise
        finally:
            for ws in sockets:
                ws.close()
            for process in processes:
                if process.poll() is None:
                    try:
                        stop(process)
                    except Exception:
                        if process.poll() is None:
                            process.kill(); process.wait()
            for log in logs:
                log.close()
            executor.shutdown()
            observer.destroy_node()
            context.shutdown()


if __name__ == '__main__':
    main()
