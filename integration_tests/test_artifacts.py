"""Synthetic negative cases; never mutate the user's installed artifacts."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import artifacts


class ArtifactChecks(unittest.TestCase):
    def test_identity_and_stale_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prefix = root / 'install'
            def write(path, value):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(value)
            identity = {'type': 'humanoid', 'product': 'lrs-x', 'id': 'test-01'}
            backend = prefix / 'etc/web_config/myroboview.json'
            write(backend, json.dumps({'robot': identity}))
            write(prefix / 'etc/robotapp/robotapp.json', json.dumps({'robot': identity, 'motor_count': 26}))
            web = prefix / 'etc/web'
            source = root / 'roboview/frontend/build/lrs-x'
            for folder in (web, source):
                write(folder / 'index.html', '<meta name="roboview-product" content="lrs-x">')
                write(folder / 'static/js/main.js', 'test')
                write(folder / 'asset-manifest.json', json.dumps({'entrypoints': ['static/js/main.js']}))
            with patch.object(artifacts, 'ROOT', root):
                self.assertFalse(artifacts.inspect_artifacts(prefix, 'lrs-x')['urdf_checked'])
                stale = web / 'static/js/old.js'
                write(stale, 'old')
                with self.assertRaisesRegex(AssertionError, 'stale'):
                    artifacts.inspect_artifacts(prefix, 'lrs-x')
                stale.unlink()
                write(backend, json.dumps({'robot': {**identity, 'id': 'wrong'}}))
                with self.assertRaisesRegex(AssertionError, 'identity'):
                    artifacts.inspect_artifacts(prefix, 'lrs-x')
                write(backend, json.dumps({'robot': identity}))
                write(web / 'index.html', '<meta name="roboview-product" content="lrd-w">')
                with self.assertRaisesRegex(AssertionError, 'frontend product'):
                    artifacts.inspect_artifacts(prefix, 'lrs-x')


if __name__ == '__main__':
    unittest.main()
