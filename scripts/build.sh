#!/usr/bin/env bash
# 构建入口（两种模式）：
#   默认    : 调外层统一构建体系 build_all_robot 编译（源码由 make vcs_* 以 git clone 形式
#             拉取到其 src/ 下，日常开发直接在 src/ 中的工作区进行）
#   --local : 仓内独立构建（CI / 无外层体系时使用），产物在本仓 build/ install/ log/
# 用法: ./scripts/build.sh [-p lrs-x|lrd-w] [--local]
set -eo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PRODUCT="lrs-x"
LOCAL_BUILD=0
while [ $# -gt 0 ]; do
  case "$1" in
    -p) [ $# -ge 2 ] || { echo "错误: -p 需要参数（lrs-x|lrd-w）" >&2; exit 2; }; PRODUCT="$2"; shift 2 ;;
    --local) LOCAL_BUILD=1; shift ;;
    -h|--help) echo "用法: $0 [-p lrs-x|lrd-w] [--local]"; exit 0 ;;
    *) echo "错误: 未知参数 $1" >&2; exit 2 ;;
  esac
done

if [ "$LOCAL_BUILD" = "1" ]; then
  # 仓内独立构建：--merge-install 保证与外层相同的 install/{bin,etc} 单前缀布局
  echo "仓内构建模式（--local），产品: $PRODUCT"
  source /opt/ros/jazzy/setup.bash
  cd "$repo_dir"
  colcon build --merge-install --symlink-install \
    --base-paths robot_msgs/node_app_msgs robotapp myroboview \
    --event-handlers console_direct+ \
    --cmake-args -DAI_TARGET_PRODUCT="$PRODUCT" -DAI_TARGET_PLATFORM=x86_64 -DCMAKE_BUILD_TYPE=Release --no-warn-unused-cli
  exit 0
fi

# 外层统一构建体系（开发态默认路径）：定位 build_all_robot 并编译其 src/ 中的源码
build_root=""
for cand in "$repo_dir/../build_all_robot" "$repo_dir/../../build_all_robot"; do
  if [ -f "$cand/Makefile" ]; then build_root="$(cd "$cand" && pwd)"; break; fi
done
if [ -z "$build_root" ]; then
  echo "错误: 未找到外层统一构建体系 build_all_robot（仓内构建请使用 --local）" >&2
  exit 1
fi

make -C "$build_root" "${PRODUCT}_x86_64"
