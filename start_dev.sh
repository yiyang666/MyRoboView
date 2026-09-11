#!/bin/bash
###
 # @Description: x86_64 本地开发 — 后台启动前端，前台启动后端（主要看后端日志）
 #
 # 用法:
 #   ./start_dev.sh              # 默认 lrs-x，仅本机可访问
 #   ./start_dev.sh -p lrd-w     # 指定产品
 #   ./start_dev.sh --lan        # 允许局域网用本机 IP 访问
 #   ./start_dev.sh -p lrd-w --lan
 #
 # 说明:
 #   CRA 默认 HOST=0.0.0.0（局域网也能打开 :3000）。
 #   默认模式显式 HOST=127.0.0.1，仅本机；--lan 才绑 0.0.0.0。
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
# 0=仅本机（HOST=127.0.0.1）；1=局域网（HOST=0.0.0.0）
LAN_ACCESS=0

usage() {
    echo "用法: $0 [-p <product>] [--lan] [--no-browser]"
    echo "  -p            构建产品名，对应 build/<product>/x86_64/install（默认: lrs-x）"
    echo "  --lan         允许局域网其他主机通过本机 IP 访问前端（默认仅本机）"
    echo "  --no-browser  不自动打开浏览器"
    echo "示例:"
    echo "  $0"
    echo "  $0 -p lrd-w"
    echo "  $0 -p lrd-w --lan"
    exit "${1:-0}"
}

# 列举可用于局域网访问的本机 IPv4（排除回环）
list_lan_ips() {
    if command -v hostname >/dev/null 2>&1; then
        hostname -I 2>/dev/null | tr ' ' '\n' | awk 'NF && $1 !~ /^127\./' | head -8
        return 0
    fi
    ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -8
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

# 杀掉本仓库相关的旧前端/后端残留（启动前自愈）
cleanup_stale_instances() {
    local project_root="$1"
    echo -e "${YELLOW}检查并清理本仓库残留的 RoboView 进程...${NC}"

    # 旧 start_dev / roboview 二进制
    local stale
    stale="$(pgrep -af "${project_root}/.*/bin/roboview|${project_root}/.*/start_dev\\.sh|${project_root}/.*/my-app/node_modules/.*/react-scripts" 2>/dev/null || true)"
    if [ -n "$stale" ]; then
        echo "$stale" | while read -r line; do
            local pid
            pid="$(echo "$line" | awk '{print $1}')"
            [ -n "$pid" ] || continue
            # 不要误杀当前脚本自身
            if [ "$pid" = "$$" ] || [ "$pid" = "$PPID" ]; then
                continue
            fi
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
    local lan_access="${3:-0}"
    local asset_urdf="${frontend_dir}/assets/${product}/robot_urdf"
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

    # 开发态：把当前产品 URDF 拷到 public，供 CRA 静态托管（/robot_urdf/...）
    if [ ! -d "$asset_urdf" ]; then
        echo -e "${RED}错误: 找不到产品 URDF 资源: $asset_urdf${NC}"
        echo -e "${YELLOW}请先: cd my-app && ./tools/build_web_urdf.sh --source ${product}${NC}"
        exit 1
    fi
    echo -e "${GREEN}同步 URDF 到 public: ${product}${NC}"
    rm -rf "$public_urdf"
    mkdir -p "$public_urdf"
    cp -a "${asset_urdf}/." "$public_urdf/"

    FRONTEND_LOG="${TMPDIR:-/tmp}/roboview-frontend-$$.log"
    if [ "$lan_access" = "1" ]; then
        echo -e "${GREEN}后台启动前端: $frontend_dir (REACT_APP_PRODUCT=${product}, LAN HOST=0.0.0.0)${NC}"
    else
        # CRA 默认是 0.0.0.0，必须显式绑回环，否则局域网仍能访问
        echo -e "${GREEN}后台启动前端: $frontend_dir (REACT_APP_PRODUCT=${product}, 仅本机 HOST=127.0.0.1)${NC}"
    fi

    # setsid：独立会话/进程组，退出时 kill -- -pgid 只杀前端树，不会误伤本脚本
    # BROWSER=none：禁止 CRA 自己弹窗；后面由脚本在就绪后统一打开，避免“后台重定向导致不弹窗”
    # 默认 HOST=127.0.0.1；--lan 时 HOST=0.0.0.0 并放宽 Host 校验
    if ! command -v setsid >/dev/null 2>&1; then
        echo -e "${RED}错误: 未找到 setsid，无法隔离前端进程组${NC}"
        exit 1
    fi
    setsid bash -c "
        cd \"\$1\" || exit 1
        export REACT_APP_PRODUCT=\"\$2\"
        export BROWSER=none
        # 有 package.json proxy 时 CRA 用 [lanUrl] 填 allowedHosts；
        # HOST=127.0.0.1 时 lanUrl 为空会直接崩：allowedHosts[0] should be a non-empty string。
        # 因此两种模式都关掉 Host 防火墙；本机/局域网只靠 HOST 绑定区分。
        export DANGEROUSLY_DISABLE_HOST_CHECK=true
        export WDS_ALLOWED_HOSTS=all
        if [ \"\$3\" = \"1\" ]; then
            export HOST=0.0.0.0
        else
            export HOST=127.0.0.1
        fi
        exec npm start
    " bash "$frontend_dir" "$product" "$lan_access" >"$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    # setsid 后该进程即为新会话/进程组 leader
    FRONTEND_PGID="$FRONTEND_PID"

    echo -e "${BLUE}前端 pid=$FRONTEND_PID pgid=$FRONTEND_PGID  日志: $FRONTEND_LOG${NC}"
}

# 兼容：./start_dev.sh -p lrd-w --lan --no-browser
# 参数解析放在 trap 之前，避免 -h 触发 EXIT 清理
ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        -p)
            [ $# -ge 2 ] || { echo -e "${RED}错误: -p 需要参数${NC}" >&2; usage 1; }
            ROBOVIEW_PRODUCT="$2"
            shift 2
            ;;
        --lan)
            LAN_ACCESS=1
            shift
            ;;
        --no-browser)
            OPEN_BROWSER=0
            shift
            ;;
        -h|--help)
            usage 0
            ;;
        --)
            shift
            ARGS+=("$@")
            break
            ;;
        -*)
            echo -e "${RED}错误: 未知选项 $1${NC}" >&2
            usage 1
            ;;
        *)
            ARGS+=("$1")
            shift
            ;;
    esac
done

# 真正启动后再注册清理；此前 -h / 参数错误退出不会误杀端口
trap cleanup EXIT INT TERM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INSTALL_DIR="$PROJECT_ROOT/build/${ROBOVIEW_PRODUCT}/x86_64/install"
BACKEND_BIN="$INSTALL_DIR/bin"
BACKEND_EXEC="$BACKEND_BIN/roboview"

SETUP_ZSH="$INSTALL_DIR/setup.zsh"
SETUP_BASH="$INSTALL_DIR/setup.bash"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  RoboView 本地开发 (x86_64)${NC}"
echo -e "${BLUE}  产品: ${ROBOVIEW_PRODUCT}${NC}"
echo -e "${BLUE}  安装: ${INSTALL_DIR}${NC}"
if [ "$LAN_ACCESS" = "1" ]; then
    echo -e "${BLUE}  访问: 局域网 (--lan)${NC}"
else
    echo -e "${BLUE}  访问: 仅本机（加 --lan 开放局域网）${NC}"
fi
echo -e "${BLUE}========================================${NC}"

cleanup_stale_instances "$PROJECT_ROOT"

if [ -n "${ZSH_VERSION:-}" ] && [ -f "$SETUP_ZSH" ]; then
    echo -e "${GREEN}加载环境: $SETUP_ZSH${NC}"
    # shellcheck disable=SC1090
    source "$SETUP_ZSH"
elif [ -f "$SETUP_BASH" ]; then
    echo -e "${GREEN}加载环境: $SETUP_BASH${NC}"
    # shellcheck disable=SC1090
    source "$SETUP_BASH"
else
    echo -e "${RED}错误: 未找到 setup 脚本: $INSTALL_DIR/setup.{zsh,bash}${NC}"
    echo -e "${YELLOW}请先执行: make ${ROBOVIEW_PRODUCT}_x86_64${NC}"
    exit 1
fi

if [ ! -f "$BACKEND_EXEC" ]; then
    echo -e "${RED}错误: 后端不存在: $BACKEND_EXEC${NC}"
    echo -e "${YELLOW}请先执行: make ${ROBOVIEW_PRODUCT}_x86_64${NC}"
    exit 1
fi

AUTH_CFG="$INSTALL_DIR/etc/web_config/auth_users.json"
VIEW_CFG="$INSTALL_DIR/etc/web_config/roboview.yaml"
UPLOAD_DIR="$INSTALL_DIR/etc/web_uploads"

if [ ! -f "$AUTH_CFG" ]; then
    echo -e "${RED}错误: 认证配置不存在: $AUTH_CFG${NC}"
    echo -e "${YELLOW}请先 make ${ROBOVIEW_PRODUCT}_x86_64 安装 roboview${NC}"
    exit 1
fi

mkdir -p "$UPLOAD_DIR"

export ROBOVIEW_AUTH_CONFIG="$AUTH_CFG"
export ROBOVIEW_CONFIG="$VIEW_CFG"
export ROBOVIEW_UPLOAD_PATH="$UPLOAD_DIR"

MY_APP_DIR="$SCRIPT_DIR/my-app"
start_frontend "$MY_APP_DIR" "$ROBOVIEW_PRODUCT" "$LAN_ACCESS"

echo -e "${BLUE}ROBOVIEW_AUTH_CONFIG=$ROBOVIEW_AUTH_CONFIG${NC}"
echo -e "${BLUE}ROBOVIEW_CONFIG=$ROBOVIEW_CONFIG${NC}"
echo -e "${BLUE}ROBOVIEW_UPLOAD_PATH=$ROBOVIEW_UPLOAD_PATH${NC}"
echo -e "${GREEN}启动后端: $BACKEND_EXEC${NC}"
echo -e "${BLUE}本机页面: http://localhost:3000  API: http://localhost:8080/api/v1${NC}"
if [ "$LAN_ACCESS" = "1" ]; then
    echo -e "${GREEN}局域网访问（其他主机浏览器打开）:${NC}"
    lan_ips="$(list_lan_ips || true)"
    if [ -n "$lan_ips" ]; then
        while IFS= read -r ip; do
            [ -n "$ip" ] || continue
            echo -e "${GREEN}  http://${ip}:3000${NC}"
        done <<< "$lan_ips"
    else
        echo -e "${YELLOW}  未能自动探测本机局域网 IP，请用 ifconfig/ip addr 查看后访问 http://<你的IP>:3000${NC}"
    fi
    echo -e "${YELLOW}  若连不上，请检查防火墙是否放行 3000/8080${NC}"
else
    echo -e "${YELLOW}当前仅本机可访问 :3000；局域网请加 --lan 重启${NC}"
fi
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
            echo -e "${YELLOW}等待前端就绪超时，请手动打开 http://localhost:3000（日志: $FRONTEND_LOG）${NC}"
        fi
    ) &
fi

cd "$BACKEND_BIN"
# 不用 exec：后端退出或 Ctrl+C 时仍可走 trap，按进程组清理前端
"$BACKEND_EXEC" &
BACKEND_PID=$!
wait "$BACKEND_PID"
