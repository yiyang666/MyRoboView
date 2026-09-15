#!/bin/bash
###
 # @Description: x86_64 本地开发 — 后台启动前端，前台启动后端（主要看后端日志）
 #   移植自原项目 start_dev.sh，适配 ROS2 统一构建体系（build_all_robot）的路径布局
 #
 # 用法:
 #   ./start_dev.sh              # 默认 lrs-x，仅本机可访问
 #   ./start_dev.sh -p lrd-w     # 指定产品
 #   ./start_dev.sh --no-browser # 不自动打开浏览器
 #
 # 说明:
 #   robotapp 不在本脚本内启动；需要 mock 数据时请另开终端执行 ./scripts/run_robotapp.sh
 #   前端 setupProxy 当前仅允许回环访问（见 src/setupProxy.js），故暂不提供 --lan。
 #
 # 退出清理：
 #   Ctrl+C / 后端退出时，会按进程组杀掉本次拉起的前端整棵树，
 #   避免只杀 npm 外壳、react-scripts 子进程残留占用 3000。
###
set -e
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ROBOVIEW_PRODUCT="lrs-x"
FRONTEND_PID=""
FRONTEND_PGID=""
FRONTEND_LOG=""
BACKEND_PID=""
OPEN_BROWSER=1

usage() {
    echo "用法: $0 [-p <product>] [--no-browser]"
    echo "  -p            构建产品名，对应 build_all_robot/build/<product>/x86_64/install（默认: lrs-x）"
    echo "  --no-browser  不自动打开浏览器"
    echo "示例:"
    echo "  $0"
    echo "  $0 -p lrd-w"
    exit "${1:-0}"
}

# 按端口杀监听进程（清理历史残留）
kill_port_listeners() {
    local port="$1"
    local pids
    pids="$(ss -ltnp 2>/dev/null | awk -v p=":${port}" '
        index($0, p) {
            while (match($0, /pid=[0-9]+/)) {
                print substr($0, RSTART + 4, RLENGTH - 4)
                $0 = substr($0, RSTART + RLENGTH)
            }
        }
    ' | sort -u)"
    if [ -z "$pids" ]; then
        return 0
    fi
    echo -e "${YELLOW}清理占用端口 ${port} 的进程: ${pids}${NC}"
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true
    sleep 0.4
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done
}

# 杀掉本项目相关的旧前端/后端残留（启动前自愈）
cleanup_stale_instances() {
    echo -e "${YELLOW}检查并清理残留的本项目进程...${NC}"

    # 旧 start_dev / roboview 后端 / 本项目前端的 react-scripts
    # 注意: 必须在管道外的 awk 里剔除本脚本自身及父进程——
    # while 管道子 shell 中的 $$ 比较在部分环境下不可靠，曾导致误匹配自身
    local stale
    stale="$(pgrep -afi "roboview|roboview/frontend/node_modules/.*/react-scripts|scripts/start_dev\\.sh" 2>/dev/null \
        | awk -v self="$$" -v parent="$PPID" '$1 != self && $1 != parent')"
    if [ -n "$stale" ]; then
        echo "$stale" | while read -r line; do
            local pid
            pid="$(echo "$line" | awk '{print $1}')"
            [ -n "$pid" ] || continue
            # pgrep 会匹配到命令替换子 shell（继承本脚本命令行），轮到 kill 时它已退出，直接跳过
            kill -0 "$pid" 2>/dev/null || continue
            echo -e "${YELLOW}终止残留: pid=${pid} ${line}${NC}"
            kill -TERM "$pid" 2>/dev/null || true
        done
        sleep 0.5
    fi

    kill_port_listeners 3000
    kill_port_listeners 8080
}

# 退出时停止本次启动的前端进程组（以及可能仍占用端口的子进程）
cleanup() {
    local ec=$?
    trap - EXIT INT TERM
    local self_pgid
    self_pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"

    if [ -n "$FRONTEND_PGID" ] && [ "$FRONTEND_PGID" != "$self_pgid" ]; then
        echo -e "\n${YELLOW}停止前端进程组 (pgid $FRONTEND_PGID)...${NC}"
        # 负号 = 按进程组杀整棵树（npm + react-scripts + webpack）
        kill -TERM -- "-$FRONTEND_PGID" 2>/dev/null || true
        sleep 0.4
        kill -KILL -- "-$FRONTEND_PGID" 2>/dev/null || true
    elif [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo -e "\n${YELLOW}停止前端 (pid $FRONTEND_PID)...${NC}"
        kill -TERM "$FRONTEND_PID" 2>/dev/null || true
        wait "$FRONTEND_PID" 2>/dev/null || true
    fi

    # 兜底：仅当本次脚本拉起过前端时，才按端口清 3000（避免 -h 等早退误杀别的实例）
    if [ -n "$FRONTEND_PID" ] || [ -n "$FRONTEND_PGID" ]; then
        if ss -ltn 2>/dev/null | awk '/:3000 /{found=1} END{exit !found}'; then
            kill_port_listeners 3000
        fi
    fi

    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo -e "${YELLOW}停止后端 (pid $BACKEND_PID)...${NC}"
        kill -TERM "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi

    exit "$ec"
}

wait_for_http() {
    local url="$1"
    local timeout_sec="${2:-60}"
    local i=0
    while [ "$i" -lt "$timeout_sec" ]; do
        if curl -fsS -m 1 "$url" >/dev/null 2>&1; then
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done
    return 1
}

start_frontend() {
    local frontend_dir="$1"
    local product="$2"
    # URDF 资源按产品组织在 asserts/<产品>/robot_urdf，开发态拷到 public 供 CRA 静态托管
    local asset_urdf="${frontend_dir}/asserts/${product}/robot_urdf"
    local public_urdf="${frontend_dir}/public/robot_urdf"

    if [ ! -d "$frontend_dir" ]; then
        echo -e "${RED}错误: 前端目录不存在: $frontend_dir${NC}"
        exit 1
    fi

    if ! command -v npm >/dev/null 2>&1; then
        echo -e "${RED}错误: 未找到 npm，请先安装 Node.js${NC}"
        exit 1
    fi

    if [ ! -d "$frontend_dir/node_modules" ]; then
        echo -e "${YELLOW}前端依赖未安装，正在执行 npm install...${NC}"
        (cd "$frontend_dir" && npm install)
    fi

    if [ ! -d "$asset_urdf" ]; then
        echo -e "${RED}错误: 找不到产品 URDF 资源: $asset_urdf${NC}"
        exit 1
    fi
    echo -e "${GREEN}同步 URDF 到 public: ${product}${NC}"
    rm -rf "$public_urdf"
    mkdir -p "$public_urdf"
    cp -a "${asset_urdf}/." "$public_urdf/"

    FRONTEND_LOG="${TMPDIR:-/tmp}/myroboview-frontend-$$.log"
    echo -e "${GREEN}后台启动前端: $frontend_dir (产品=${product}, 仅本机 HOST=127.0.0.1)${NC}"

    # setsid：独立会话/进程组，退出时 kill -- -pgid 只杀前端树，不会误伤本脚本
    # BROWSER=none：禁止 CRA 自己弹窗；后面由脚本在就绪后统一打开，避免“后台重定向导致不弹窗”
    # 有 package.json proxy 时 CRA 用 [lanUrl] 填 allowedHosts；
    # HOST=127.0.0.1 时 lanUrl 为空会直接崩：allowedHosts[0] should be a non-empty string。
    # 因此关掉 Host 防火墙；仅本机访问由 setupProxy.js 的回环校验兜底。
    if ! command -v setsid >/dev/null 2>&1; then
        echo -e "${RED}错误: 未找到 setsid，无法隔离前端进程组${NC}"
        exit 1
    fi
    setsid bash -c "
        cd \"\$1\" || exit 1
        export BROWSER=none
        export DANGEROUSLY_DISABLE_HOST_CHECK=true
        export WDS_ALLOWED_HOSTS=all
        export HOST=127.0.0.1
        exec npm start
    " bash "$frontend_dir" >"$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    # setsid 后该进程即为新会话/进程组 leader
    FRONTEND_PGID="$FRONTEND_PID"

    echo -e "${BLUE}前端 pid=$FRONTEND_PID pgid=$FRONTEND_PGID  日志: $FRONTEND_LOG${NC}"
}

# 参数解析放在 trap 之前，避免 -h 触发 EXIT 清理
while [ $# -gt 0 ]; do
    case "$1" in
        -p)
            [ $# -ge 2 ] || { echo -e "${RED}错误: -p 需要参数${NC}" >&2; usage 1; }
            ROBOVIEW_PRODUCT="$2"
            shift 2
            ;;
        --no-browser)
            OPEN_BROWSER=0
            shift
            ;;
        -h|--help)
            usage 0
            ;;
        *)
            echo -e "${RED}错误: 未知选项 $1${NC}" >&2
            usage 1
            ;;
    esac
done

# 真正启动后再注册清理；此前 -h / 参数错误退出不会误杀端口
trap cleanup EXIT INT TERM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 定位外层构建工作区：开发仓的兄弟目录；从构建工作区内的源码副本运行时取上两级
BUILD_ROOT=""
for cand in "${BUILD_ALL_ROBOT_ROOT:-}" "$REPO_DIR/../build_all_robot" "$REPO_DIR/../.."; do
    if [ -n "$cand" ] && [ -f "$cand/Makefile" ] && [ -d "$cand/repos" ]; then
        BUILD_ROOT="$(cd "$cand" && pwd)"
        break
    fi
done
if [ -z "$BUILD_ROOT" ]; then
    echo -e "${RED}错误: 未找到外层构建工作区 build_all_robot（可用 BUILD_ALL_ROBOT_ROOT 指定）${NC}"
    exit 1
fi

INSTALL_DIR="$BUILD_ROOT/build/${ROBOVIEW_PRODUCT}/x86_64/install"
BACKEND_EXEC="$INSTALL_DIR/bin/roboview"
BACKEND_CFG="$INSTALL_DIR/etc/web_config/myroboview.json"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  MyRoboView 本地开发 (x86_64)${NC}"
echo -e "${BLUE}  产品: ${ROBOVIEW_PRODUCT}${NC}"
echo -e "${BLUE}  安装: ${INSTALL_DIR}${NC}"
echo -e "${BLUE}========================================${NC}"

cleanup_stale_instances

if [ ! -f "$INSTALL_DIR/setup.bash" ]; then
    echo -e "${RED}错误: 未找到安装产物: $INSTALL_DIR${NC}"
    echo -e "${YELLOW}请先执行: ./scripts/build.sh -p ${ROBOVIEW_PRODUCT}${NC}"
    exit 1
fi

# 加载 ROS 环境：系统 Jazzy + 本产物前缀（zsh 对应 .zsh）
if [ -n "${ZSH_VERSION:-}" ]; then
    source /opt/ros/jazzy/setup.zsh
    source "$INSTALL_DIR/setup.zsh"
else
    source /opt/ros/jazzy/setup.bash
    source "$INSTALL_DIR/setup.bash"
fi

if [ ! -x "$BACKEND_EXEC" ]; then
    echo -e "${RED}错误: 后端不存在: $BACKEND_EXEC${NC}"
    echo -e "${YELLOW}请先执行: ./scripts/build.sh -p ${ROBOVIEW_PRODUCT}${NC}"
    exit 1
fi
if [ ! -f "$BACKEND_CFG" ]; then
    echo -e "${RED}错误: 后端配置不存在: $BACKEND_CFG${NC}"
    exit 1
fi

export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-77}"
export ROS_AUTOMATIC_DISCOVERY_RANGE="${ROS_AUTOMATIC_DISCOVERY_RANGE:-LOCALHOST}"

start_frontend "$REPO_DIR/roboview/frontend" "$ROBOVIEW_PRODUCT"

echo -e "${GREEN}启动后端: $BACKEND_EXEC --config $BACKEND_CFG${NC}"
echo -e "${BLUE}本机页面: http://localhost:3000  API: http://localhost:8080/api/v1${NC}"
echo -e "${YELLOW}前端日志见: $FRONTEND_LOG${NC}"
echo ""

# 前端就绪后主动打开页面（解决后台启动 + 日志重定向时 CRA 不弹窗）
if [ "$OPEN_BROWSER" = "1" ]; then
    (
        if wait_for_http "http://127.0.0.1:3000" 90; then
            echo -e "${GREEN}前端已就绪，打开 http://localhost:3000${NC}"
            if command -v xdg-open >/dev/null 2>&1; then
                xdg-open "http://localhost:3000" >/dev/null 2>&1 || true
            elif command -v gio >/dev/null 2>&1; then
                gio open "http://localhost:3000" >/dev/null 2>&1 || true
            fi
        else
            echo -e "${YELLOW}等待前端就绪超时，请手动打开 http://127.0.0.1:3000（日志: $FRONTEND_LOG）${NC}"
        fi
    ) &
fi

# 不用 exec：后端退出或 Ctrl+C 时仍可走 trap，按进程组清理前端
"$BACKEND_EXEC" --config "$BACKEND_CFG" &
BACKEND_PID=$!
wait "$BACKEND_PID"
