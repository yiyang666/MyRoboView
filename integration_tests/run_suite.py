#!/usr/bin/env python3
"""Persist each verification stage and exit nonzero on any failure."""
import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def main():
    workspace, build, install, product = sys.argv[1:]
    build, install = Path(build), Path(install)
    report = ROOT / 'test_reports' / product / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    report.mkdir(parents=True)
    suite = ET.Element('testsuite', name=f'system-{product}')
    env = {**os.environ, 'MYROBOVIEW_INSTALL': str(install), 'PRODUCT': product}
    colcon = ['colcon', '--log-base', str(report / 'colcon-log')]
    stages = [
        ('unit', colcon + ['test', '--base-paths', str(ROOT / 'robotapp'), str(ROOT / 'roboview'),
                         '--merge-install', '--build-base', str(build), '--install-base', str(install),
                         '--packages-select', 'robotapp', 'roboview', '--return-code-on-test-failure',
                         '--event-handlers', 'console_direct+']),
        ('unit-results', colcon + ['test-result', '--verbose', '--test-result-base', str(build)]),
        ('artifact-checker-negative-tests', [sys.executable, str(ROOT / 'integration_tests/test_artifacts.py')]),
        ('installed-artifacts', [sys.executable, str(ROOT / 'integration_tests/artifacts.py'), str(install), product]),
        ('dds-http-websocket-artifacts', [sys.executable, str(ROOT / 'integration_tests/integration.py')]),
    ]
    failures = 0
    for name, command in stages:
        start = time.monotonic()
        with (report / f'{name}.log').open('w') as log:
            try:
                process = subprocess.Popen(command, cwd=workspace, env=env, stdout=log,
                                           stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    code = process.wait(timeout=300)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                    log.write('Stage timed out after 300 seconds\n')
                    code = 1
            except OSError as error:
                log.write(str(error))
                code = 1
        case = ET.SubElement(suite, 'testcase', name=name, classname=product,
                             time=f'{time.monotonic() - start:.3f}')
        if code:
            failures += 1
            ET.SubElement(case, 'failure', message=f'exit {code}; see {name}.log')
        ET.SubElement(case, 'system-out').text = f'{name}.log'
        print(f'{name}: {"FAIL" if code else "PASS"}', flush=True)
    for package in ('robotapp', 'roboview'):
        testing = build / package / 'Testing'
        if testing.exists():
            shutil.copytree(testing, report / 'ctest' / package)
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()
    (report / 'metadata.json').write_text(json.dumps({
        'commit': git('rev-parse', 'HEAD'), 'worktree': git('status', '--porcelain'),
        'product': product, 'install_prefix': str(install), 'failures': failures,
        'scope': 'CTest + real DDS/HTTP/WebSocket + installed frontend assets; no browser UI automation',
    }, indent=2) + '\n')
    suite.set('tests', str(len(stages)))
    suite.set('failures', str(failures))
    ET.ElementTree(suite).write(report / 'junit.xml', encoding='utf-8', xml_declaration=True)
    print(f'Reports: {report}', flush=True)
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())
