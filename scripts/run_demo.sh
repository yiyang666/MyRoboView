#!/usr/bin/env bash
set -eo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$repo_dir/install/setup.bash" ]]; then
  echo 'Build first: ./scripts/build.sh' >&2
  exit 1
fi
source "$repo_dir/install/setup.bash"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-77}"
export ROS_AUTOMATIC_DISCOVERY_RANGE="${ROS_AUTOMATIC_DISCOVERY_RANGE:-LOCALHOST}"
if [[ $# -ne 0 ]]; then
  echo 'Use ROBOTAPP_CONFIG and MYROBOVIEW_CONFIG for independent configuration paths.' >&2
  exit 2
fi
"$repo_dir/install/robotapp/lib/robotapp/robotapp_node" --config "${ROBOTAPP_CONFIG:-$repo_dir/robotapp/config/robotapp.json}" &
robot_pid=$!
"$repo_dir/install/myroboview_backend/lib/myroboview_backend/myroboview_server" --config "${MYROBOVIEW_CONFIG:-$repo_dir/myroboview/backend/config/myroboview.json}" &
backend_pid=$!
cleanup() {
  trap - EXIT INT TERM
  kill -TERM "$robot_pid" "$backend_pid" 2>/dev/null || true
  wait "$robot_pid" "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
wait -n "$robot_pid" "$backend_pid"
