#!/usr/bin/env bash
# 无前端 Demo：同一脚本拉起 robotapp + backend（联调后端/DDS 用）
# 日常开发推荐分离启动：run_robotapp.sh + start_dev.sh
set -eo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 定位外层构建工作区：开发仓的兄弟目录；从构建工作区内的源码副本运行时取上两级
build_root=""
for cand in "${BUILD_ALL_ROBOT_ROOT:-}" "$repo_dir/../build_all_robot" "$repo_dir/../.."; do
  if [ -n "$cand" ] && [ -f "$cand/Makefile" ] && [ -d "$cand/repos" ]; then
    build_root="$(cd "$cand" && pwd)"
    break
  fi
done
[ -n "$build_root" ] || { echo "错误: 未找到外层构建工作区 build_all_robot（可用 BUILD_ALL_ROBOT_ROOT 指定）" >&2; exit 1; }

install_dir="$build_root/build/lrs-x/x86_64/install"
if [[ ! -f "$install_dir/setup.bash" ]]; then
  echo 'Build first: ./scripts/build.sh' >&2
  exit 1
fi
source /opt/ros/jazzy/setup.bash
source "$install_dir/setup.bash"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-77}"
export ROS_AUTOMATIC_DISCOVERY_RANGE="${ROS_AUTOMATIC_DISCOVERY_RANGE:-LOCALHOST}"
if [[ $# -ne 0 ]]; then
  echo 'Use ROBOTAPP_CONFIG and MYROBOVIEW_CONFIG for independent configuration paths.' >&2
  exit 2
fi
"$install_dir/bin/robotapp_node" --config "${ROBOTAPP_CONFIG:-$install_dir/etc/robotapp/robotapp.json}" &
robot_pid=$!
"$install_dir/bin/myroboview_server" --config "${MYROBOVIEW_CONFIG:-$install_dir/etc/web_config/myroboview.json}" &
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
