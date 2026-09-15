#!/usr/bin/env bash
# 单独启动 robotapp mock（前台运行，Ctrl+C 退出）
# 注意：真实机器人接入时请勿启动，避免与真实 app 的同名话题冲突
# 用法: ./scripts/run_robotapp.sh [-p lrs-x|lrd-w]
set -eo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PRODUCT="lrs-x"
while [ $# -gt 0 ]; do
  case "$1" in
    -p) [ $# -ge 2 ] || { echo "错误: -p 需要参数（lrs-x|lrd-w）" >&2; exit 2; }; PRODUCT="$2"; shift 2 ;;
    -h|--help) echo "用法: $0 [-p lrs-x|lrd-w]"; exit 0 ;;
    *) echo "错误: 未知参数 $1" >&2; exit 2 ;;
  esac
done

# 定位外层构建工作区：开发仓的兄弟目录；从构建工作区内的源码副本运行时取上两级
build_root=""
for cand in "${BUILD_ALL_ROBOT_ROOT:-}" "$repo_dir/../build_all_robot" "$repo_dir/../.."; do
  if [ -n "$cand" ] && [ -f "$cand/Makefile" ] && [ -d "$cand/repos" ]; then
    build_root="$(cd "$cand" && pwd)"
    break
  fi
done
[ -n "$build_root" ] || { echo "错误: 未找到外层构建工作区 build_all_robot（可用 BUILD_ALL_ROBOT_ROOT 指定）" >&2; exit 1; }

install_dir="$build_root/build/$PRODUCT/x86_64/install"
bin="$install_dir/bin/robotapp_node"
cfg="$install_dir/etc/robotapp/robotapp.json"

if [ ! -x "$bin" ]; then
  echo "错误: 未找到 robotapp_node: $bin" >&2
  echo "请先执行: ./scripts/build.sh -p $PRODUCT" >&2
  exit 1
fi

# 加载 ROS 环境：ament_index 需要本产物前缀来定位 etc/ 下的默认配置
if [ -n "${ZSH_VERSION:-}" ]; then
  source /opt/ros/jazzy/setup.zsh
  source "$install_dir/setup.zsh"
else
  source /opt/ros/jazzy/setup.bash
  source "$install_dir/setup.bash"
fi
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-77}"
export ROS_AUTOMATIC_DISCOVERY_RANGE="${ROS_AUTOMATIC_DISCOVERY_RANGE:-LOCALHOST}"

echo "启动 robotapp（产品: $PRODUCT）: $bin --config $cfg"
exec "$bin" --config "$cfg"
