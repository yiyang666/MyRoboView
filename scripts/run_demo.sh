#!/usr/bin/env bash
set -eo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$repo_dir/ROS2/install/setup.bash" ]]; then
  echo 'Build first: ./scripts/build.sh' >&2
  exit 1
fi
source "$repo_dir/ROS2/install/setup.bash"
# Isolated domain for the demo; override explicitly to match real robots.
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-77}"
export ROS_LOCALHOST_ONLY="${ROS_LOCALHOST_ONLY:-1}"
export ROS_AUTOMATIC_DISCOVERY_RANGE="${ROS_AUTOMATIC_DISCOVERY_RANGE:-LOCALHOST}"
scenario="${MYROBOVIEW_SCENARIO:-nominal}"
"$repo_dir/ROS2/install/myroboview_platform/lib/myroboview_platform/mock" --scenario "$scenario" "$@" &
mock_pid=$!
"$repo_dir/ROS2/install/myroboview_platform/lib/myroboview_platform/bridge" "$@" &
bridge_pid=$!
cleanup() {
  trap - EXIT INT TERM
  kill -TERM "$mock_pid" "$bridge_pid" 2>/dev/null || true
  wait "$mock_pid" "$bridge_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
wait -n "$mock_pid" "$bridge_pid"
