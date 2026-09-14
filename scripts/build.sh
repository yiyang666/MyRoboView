#!/usr/bin/env bash
set -eo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source /opt/ros/jazzy/setup.bash
cd "$repo_dir"
colcon build --base-paths robot_msgs/node_app_msgs robotapp myroboview/backend --symlink-install --event-handlers console_direct+
