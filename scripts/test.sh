#!/usr/bin/env bash
# 测试入口（与 build.sh 模式对应）：
#   默认    : 在外层统一构建体系（build_all_robot）中执行单元测试与集成测试
#   --local : 在仓内构建产物上执行（CI / 无外层体系时使用）
# 用法: ./scripts/test.sh [-p lrs-x|lrd-w] [--local]
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
  install_dir="$repo_dir/install"
  if [ ! -f "$install_dir/setup.bash" ]; then
    echo "错误: 未找到仓内构建产物，请先执行 ./scripts/build.sh --local" >&2
    exit 1
  fi
  source /opt/ros/jazzy/setup.bash
  source "$install_dir/setup.bash"
  cd "$repo_dir"
  # --merge-install：与 build.sh --local 的构建布局保持一致
  colcon test --merge-install --base-paths robotapp roboview --packages-select robotapp roboview --event-handlers console_direct+
  colcon test-result --verbose
  # 显式告知集成测试产物前缀（仓内单前缀布局）
  MYROBOVIEW_INSTALL="$install_dir" PRODUCT="$PRODUCT" python3 "$repo_dir/roboview/backend/integration_tests/integration.py"
  exit 0
fi

build_root=""
# 候选：仓与体系同级（旧布局）/ 仓在体系 src/ 下（当前布局，祖父目录即体系根）
for cand in "$repo_dir/../build_all_robot" "$repo_dir/../../build_all_robot" "$repo_dir/../.."; do
  if [ -f "$cand/Makefile" ] && [ -d "$cand/repos" ]; then build_root="$(cd "$cand" && pwd)"; break; fi
done
if [ -z "$build_root" ]; then
  echo "错误: 未找到外层统一构建体系 build_all_robot（仓内测试请使用 --local）" >&2
  exit 1
fi

build_dir="$build_root/build/$PRODUCT/x86_64"
if [ ! -f "$build_dir/install/setup.bash" ]; then
  echo "错误: 未找到构建产物 $build_dir/install，请先执行 ./scripts/build.sh -p $PRODUCT" >&2
  exit 1
fi

source /opt/ros/jazzy/setup.bash
source "$build_dir/install/setup.bash"

# 与外层 Makefile 的 colcon 路径参数对齐（从 build_root 发起，指向产品构建目录）
cd "$build_root"
colcon --log-base "$build_dir/log" test \
  --base-paths src --merge-install \
  --build-base "$build_dir/build" --install-base "$build_dir/install" \
  --packages-select robotapp roboview --event-handlers console_direct+
colcon --log-base "$build_dir/log" test-result --verbose --test-result-base "$build_dir/build"

MYROBOVIEW_INSTALL="$build_dir/install" PRODUCT="$PRODUCT" python3 "$repo_dir/roboview/backend/integration_tests/integration.py"
