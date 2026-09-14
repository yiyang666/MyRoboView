#!/usr/bin/env bash
set -eo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/install/setup.bash"
cd "$repo_dir"
colcon test --packages-select robotapp myroboview_backend --event-handlers console_direct+
colcon test-result --verbose
python3 "$repo_dir/myroboview/backend/integration_tests/integration.py"
