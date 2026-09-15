"""Checks installed artifacts, including exact hashed frontend output membership."""
import json
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
    manifest = json.loads((web / 'asset-manifest.json').read_text())
    assert f'name="roboview-product" content="{product}"' in (web / 'index.html').read_text(), 'frontend product mismatch'
    assert manifest == json.loads((source / 'asset-manifest.json').read_text())
    installed = {p.relative_to(web / 'static') for p in (web / 'static').rglob('*') if p.is_file()}
    expected = {p.relative_to(source / 'static') for p in (source / 'static').rglob('*') if p.is_file()}
    assert installed and installed == expected, 'missing or stale hashed assets'
    for rel in expected:
        assert (web / 'static' / rel).read_bytes() == (source / 'static' / rel).read_bytes()
    for entry in manifest['entrypoints']:
        assert not entry.startswith('/') and '..' not in Path(entry).parts
        assert (web / entry).is_file(), entry
    # Assets are optional in a fresh CI clone; when present verify product isolation.
    assets = ROOT / 'roboview/frontend/asserts' / product / 'robot_urdf'
    if assets.exists():
        assert (web / 'robot_urdf' / urdf).is_file()
        other = PRODUCTS['lrd-w' if product == 'lrs-x' else 'lrs-x'][2]
        assert not (web / 'robot_urdf' / other).exists(), 'foreign product URDF'
    return {'product': product, 'motor_count': count,
            'entrypoints': manifest['entrypoints'], 'urdf_checked': assets.exists()}


if __name__ == '__main__':
    import sys
    print(json.dumps(inspect_artifacts(sys.argv[1], sys.argv[2]), indent=2))
