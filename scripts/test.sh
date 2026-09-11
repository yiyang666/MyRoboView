#!/usr/bin/env bash
set -eo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_dir/ROS2/install/setup.bash"
cd "$repo_dir/ROS2"
colcon test --packages-select myroboview_platform --event-handlers console_direct+
colcon test-result --verbose
python3 "$repo_dir/ROS2/tests/integration.py"
