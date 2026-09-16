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
 #   前端 dev server 当前仅允许回环访问（见 frontend/vite.config.js 的 Host 校验），故暂不提供 --lan。
 #
 # 进程安全策略：
 #   1. 只清理由本脚本创建、且经 /proc 验证（cwd/exe 属于本仓）的进程——
 #      实例 PID 记录在 /tmp/roboview-dev-<仓路径哈希>.pids，异常退出后下次启动据此清理；
 #   2. 端口 3000/8080 被其他程序占用时直接报错退出，不自动杀。
 #   Ctrl+C / 后端退出时，按进程组杀掉本次拉起的前端整棵树，
 #   避免只杀 npm 外壳、vite 子进程残留占用 3000。
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

# 列出某端口的监听进程 PID（精确匹配本地端口，不误伤 :30001 之类）
port_occupants() {
    local port="$1"
    ss -ltnp 2>/dev/null | awk -v p=":${port}" '
        $4 ~ p "$" {
            while (match($0, /pid=[0-9]+/)) {
                print substr($0, RSTART + 4, RLENGTH - 4)
                $0 = substr($0, RSTART + RLENGTH)
            }
        }
    ' | sort -u
}

# 端口被占用时报错退出（不自动杀）；尽量列出占用者 pid 与命令行，交用户处理
require_port_free() {
    local port="$1"
    ss -ltn 2>/dev/null | awk -v p=":${port}" '$4 ~ p "$" {found=1} END{exit !found}' || return 0
    local pid
    echo -e "${RED}错误: 端口 ${port} 已被占用${NC}" >&2
    for pid in $(port_occupants "$port"); do
        echo -e "${RED}  占用者: pid=${pid} $(ps -o args= -p "$pid" 2>/dev/null)${NC}" >&2
    done
    echo -e "${YELLOW}非本脚本创建的实例，请确认后自行处理（如 kill <pid>）${NC}" >&2
    exit 1
}

# 按端口清理，但仅限 /proc 验证 cwd 属于指定目录的进程（本脚本创建的实例）
kill_port_listeners_verified() {
    local port="$1" cwd_prefix="$2"
    local pid cwd
    for pid in $(port_occupants "$port"); do
        cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null)"
        case "$cwd" in
            "${cwd_prefix}"*)
                echo -e "${YELLOW}清理本实例端口 ${port} 残留: pid=${pid}${NC}"
                kill -TERM "$pid" 2>/dev/null || true
                ;;
            *)
                echo -e "${YELLOW}跳过端口 ${port} 的 pid=${pid}（cwd=${cwd:-?} 非本实例）${NC}"
                ;;
        esac
    done
}

# 清理本脚本的既有实例：只认 PID 文件记录、且 /proc 身份可验证（cwd/exe 属于本仓）的进程
cleanup_stale_instances() {
    [ -f "$PID_FILE" ] || return 0
    echo -e "${YELLOW}发现本脚本的实例记录（$PID_FILE），核验并清理...${NC}"
    local role pid pgid
    while read -r role pid pgid; do
        [ -n "${pid:-}" ] || continue
        case "$role" in
            frontend)
                # 进程组中任一成员 cwd 属于本仓前端目录，才认定为本脚本实例
                local member cwd verified=""
                for member in $(pgrep -g "${pgid:-0}" 2>/dev/null); do
                    cwd="$(readlink -f "/proc/$member/cwd" 2>/dev/null)"
                    case "$cwd" in
                        "$REPO_DIR/roboview/frontend"*) verified=1; break ;;
                    esac
                done
                if [ -n "$verified" ]; then
                    echo -e "${YELLOW}终止既有前端实例: pgid=${pgid}${NC}"
                    kill -TERM -- "-$pgid" 2>/dev/null || true
                    sleep 0.4
                    kill -KILL -- "-$pgid" 2>/dev/null || true
                fi
                ;;
            backend)
                if kill -0 "$pid" 2>/dev/null; then
                    local exe
                    exe="$(readlink -f "/proc/$pid/exe" 2>/dev/null)"
                    if [ -n "$exe" ] && [ "$exe" = "$(readlink -f "$BACKEND_EXEC")" ]; then
                        echo -e "${YELLOW}终止既有后端实例: pid=${pid}${NC}"
                        kill -TERM "$pid" 2>/dev/null || true
                    fi
                fi
                ;;
        esac
    done < "$PID_FILE"
    rm -f "$PID_FILE"
    sleep 0.5
}

# 退出时停止本次启动的前端进程组（以及可能仍占用端口的子进程）
cleanup() {
    local ec=$?
    trap - EXIT INT TERM
    local self_pgid
    self_pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"

    if [ -n "$FRONTEND_PGID" ] && [ "$FRONTEND_PGID" != "$self_pgid" ]; then
        echo -e "\n${YELLOW}停止前端进程组 (pgid $FRONTEND_PGID)...${NC}"
        # 负号 = 按进程组杀整棵树（npm + vite）
        kill -TERM -- "-$FRONTEND_PGID" 2>/dev/null || true
        sleep 0.4
        kill -KILL -- "-$FRONTEND_PGID" 2>/dev/null || true
    elif [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo -e "\n${YELLOW}停止前端 (pid $FRONTEND_PID)...${NC}"
        kill -TERM "$FRONTEND_PID" 2>/dev/null || true
        wait "$FRONTEND_PID" 2>/dev/null || true
    fi

    # 兜底：仅当本次脚本拉起过前端时，才按端口清 3000，且仅限 cwd 属于本仓前端目录的进程
    if [ -n "$FRONTEND_PID" ] || [ -n "$FRONTEND_PGID" ]; then
        kill_port_listeners_verified 3000 "$REPO_DIR/roboview/frontend"
    fi

    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo -e "${YELLOW}停止后端 (pid $BACKEND_PID)...${NC}"
        kill -TERM "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi

    # 实例记录随正常退出销毁
    rm -f "$PID_FILE" 2>/dev/null || true

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
    # URDF 资源按产品组织在 asserts/<产品>/robot_urdf，开发态拷到 public 供 Vite 静态托管
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

    FRONTEND_LOG="${TMPDIR:-/tmp}/roboview-frontend-$$.log"
    echo -e "${GREEN}后台启动前端: $frontend_dir (产品=${product}, 仅本机 HOST=127.0.0.1)${NC}"

    # setsid：独立会话/进程组，退出时 kill -- -pgid 只杀前端树，不会误伤本脚本
    # Vite 默认不自动弹窗；由脚本在前端就绪后统一打开浏览器（见下方 OPEN_BROWSER）
    # HOST=127.0.0.1：vite.config.js 读取，仅监听回环；另有 Host 头校验兜底（防 DNS 重绑定）
    if ! command -v setsid >/dev/null 2>&1; then
        echo -e "${RED}错误: 未找到 setsid，无法隔离前端进程组${NC}"
        exit 1
    fi
    setsid bash -c "
        cd \"\$1\" || exit 1
        export HOST=127.0.0.1
        # 与生产构建同源：按产品差异化前端（电机状态卡片等，见 config/robotUrdfConfig.js）
        export REACT_APP_PRODUCT=\"\$2\"
        exec npm start
    " bash "$frontend_dir" "$product" >"$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    # setsid 后该进程即为新会话/进程组 leader
    FRONTEND_PGID="$FRONTEND_PID"

    # 登记实例：前端进程组（供异常退出后的下次启动核验清理）
    echo "frontend $FRONTEND_PID $FRONTEND_PGID" > "$PID_FILE"

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

# 实例 PID 文件：按仓路径哈希区分多个检出，互不影响
RUN_KEY="$(echo -n "$REPO_DIR" | md5sum | cut -c1-12)"
PID_FILE="${TMPDIR:-/tmp}/roboview-dev-${RUN_KEY}.pids"

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
# 端口被其他程序占用时默认报错，不自动杀
require_port_free 3000
require_port_free 8080

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

    # 前端就绪后主动打开页面（Vite 后台启动不弹窗，由脚本统一打开）
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
# 登记实例：后端进程
echo "backend $BACKEND_PID" >> "$PID_FILE"
wait "$BACKEND_PID"
