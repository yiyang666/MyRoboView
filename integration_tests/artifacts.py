"""Checks installed artifacts, including exact hashed frontend output membership."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = {'lrs-x': ('humanoid', 26, 'LRS-X2URDF.urdf'),
            'lrd-w': ('quadruped_wheeled', 16, 'LRD_W01.urdf')}


def inspect_artifacts(prefix, product):
    prefix = Path(prefix)
    kind, count, urdf = PRODUCTS[product]
    backend = json.loads((prefix / 'etc/web_config/myroboview.json').read_text())
    mock = json.loads((prefix / 'etc/robotapp/robotapp.json').read_text())
    for cfg in (backend, mock):
        assert cfg['robot']['product'] == product, 'installed product mismatch'
        assert cfg['robot']['type'] == kind, 'installed robot type mismatch'
    assert backend['robot']['id'] == mock['robot']['id'], 'installed identity mismatch'
    assert mock['motor_count'] == count
    web = prefix / 'etc/web'
    source = ROOT / 'roboview/frontend/build' / product
    index = (web / 'index.html').read_text()
    assert f'name="roboview-product" content="{product}"' in index, 'frontend product mismatch'
    # 安装态与构建态的 static 目录必须集合一致且逐字节相同（防旧哈希残留/漏装）
    installed = {p.relative_to(web / 'static') for p in (web / 'static').rglob('*') if p.is_file()}
    expected = {p.relative_to(source / 'static') for p in (source / 'static').rglob('*') if p.is_file()}
    assert installed and installed == expected, 'missing or stale hashed assets'
    for rel in expected:
        assert (web / 'static' / rel).read_bytes() == (source / 'static' / rel).read_bytes()
    # Vite 不再产出 asset-manifest.json：改为校验 index.html 引用的入口资源真实存在且路径安全
    entries = [e.lstrip('/') for e in re.findall(r'(?:src|href)="(/static/[^"]+)"', index)]
    assert entries, 'index.html references no bundled assets'
    for entry in entries:
        assert '..' not in Path(entry).parts, entry
        assert (web / entry).is_file(), entry
    # Assets are optional in a fresh CI clone; when present verify product isolation.
    assets = ROOT / 'roboview/frontend/asserts' / product / 'robot_urdf'
    if assets.exists():
        # URDF 安装路径与 CMakeLists 现行规则一致：etc/web/assets/robot_urdf/
        assert (web / 'assets/robot_urdf' / urdf).is_file()
        other = PRODUCTS['lrd-w' if product == 'lrs-x' else 'lrs-x'][2]
        assert not (web / 'assets/robot_urdf' / other).exists(), 'foreign product URDF'
    return {'product': product, 'motor_count': count,
            'entrypoints': entries, 'urdf_checked': assets.exists()}


if __name__ == '__main__':
    import sys
    print(json.dumps(inspect_artifacts(sys.argv[1], sys.argv[2]), indent=2))
