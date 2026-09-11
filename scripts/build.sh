#!/usr/bin/env bash
set -eo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ros_distro="${ROS_DISTRO:-jazzy}"
source "/opt/ros/$ros_distro/setup.bash"
cd "$repo_dir/ROS2"
colcon build --base-paths src --symlink-install --event-handlers console_direct+
