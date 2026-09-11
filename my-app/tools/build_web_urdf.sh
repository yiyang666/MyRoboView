#!/usr/bin/env bash
set -euo pipefail

# build_web_urdf.sh
#
# 用户入口脚本：一键生成 Web 端使用的 URDF 资源。
# 源目录：tools/robot_urdf/<source>/（STL + 原始 URDF）
# 输出目录：assets/<source>/robot_urdf/（GLB + 精简 URDF，供开发软链 / CMake 安装）
#
# 环境依赖：
#   Blender（自带 bpy）：https://www.blender.org/download/
#   Ubuntu：sudo apt install blender && blender --version
#
# 使用示例：
#   ./tools/build_web_urdf.sh --source lrd-w --ratio 1.0
#   ./tools/build_web_urdf.sh --source lrs-x --ratio 0.2 --urdf LRS-XURDF-0318.urdf

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BASE="${SCRIPT_DIR}/robot_urdf"
ASSETS_BASE="${SCRIPT_DIR}/../assets"

SOURCE_NAME="lrs-x"
RATIO="1.0"
PACKAGE_NAME=""
URDF_NAME=""
KEEP_INERTIAL=0
KEEP_COLLISION=0

# 统计目录下匹配文件的总字节数
calc_dir_size() {
  local dir="$1"
  local pattern="$2"
  local total=0

  if [[ ! -d "$dir" ]]; then
    echo 0
    return
  fi

  while IFS= read -r -d '' file; do
    total=$((total + $(stat -c%s "$file")))
  done < <(find "$dir" -maxdepth 1 -type f -iname "$pattern" -print0)

  echo "$total"
}

# 将字节数格式化为易读大小
format_bytes() {
  local bytes="$1"
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec-i --suffix=B "$bytes"
  elif (( bytes >= 1048576 )); then
    awk -v b="$bytes" 'BEGIN { printf "%.2f MB", b / 1048576 }'
  elif (( bytes >= 1024 )); then
    awk -v b="$bytes" 'BEGIN { printf "%.2f KB", b / 1024 }'
  else
    echo "${bytes} B"
  fi
}

usage() {
  cat <<'EOF'
用法：
  ./tools/build_web_urdf.sh [参数]

环境依赖：
  Blender（自带 bpy）：https://www.blender.org/download/
  Ubuntu 可执行：sudo apt install blender
  确认安装：blender --version

目录约定：
  源 URDF：tools/robot_urdf/<source>/
  输出 Web 资源：assets/<source>/robot_urdf/
  package 名默认与 <source> 相同（如 lrd-w），对应前端
    packages: { 'lrd-w': '/robot_urdf/lrd-w/' }

参数：
  --source <name>       产品名 / 源文件夹名，默认 lrs-x
  --ratio <value>       减面比例，1.0 表示不减面，默认 1.0
  --package-name <name> URDF 中 package:// 名，默认与 --source 相同
  --urdf <file>         只处理指定 URDF 文件；默认处理 source 下所有 .urdf
  --keep-inertial       保留 inertial 字段，惯量/质量信息
  --keep-collision      保留 collision 字段，碰撞几何
  -h, --help            显示帮助

示例：
  ./tools/build_web_urdf.sh --source lrd-w --ratio 1.0
  ./tools/build_web_urdf.sh --source lrs-x --ratio 0.2 --urdf LRS-XURDF-0318.urdf
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE_NAME="$2"
      shift 2
      ;;
    --output)
      # 兼容旧参数：忽略，输出固定为 assets/<source>/robot_urdf
      echo "[warn] --output 已废弃，输出目录固定为 assets/<source>/robot_urdf" >&2
      shift 2
      ;;
    --ratio)
      RATIO="$2"
      shift 2
      ;;
    --package-name)
      PACKAGE_NAME="$2"
      shift 2
      ;;
    --urdf)
      URDF_NAME="$2"
      shift 2
      ;;
    --keep-inertial)
      KEEP_INERTIAL=1
      shift
      ;;
    --keep-collision)
      KEEP_COLLISION=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[error] 未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v blender >/dev/null 2>&1; then
  echo "[error] 找不到 blender，请先安装 Blender（https://www.blender.org/download/）。" >&2
  exit 1
fi

SOURCE_DIR="${SOURCE_BASE}/${SOURCE_NAME}"
OUTPUT_DIR="${ASSETS_BASE}/${SOURCE_NAME}/robot_urdf"
SOURCE_MESH_DIR="${SOURCE_DIR}/meshes"

# package:// 名与产品 id / URL 段一致：package://lrd-w/ → /robot_urdf/lrd-w/
if [[ -z "$PACKAGE_NAME" ]]; then
  PACKAGE_NAME="$SOURCE_NAME"
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "[error] 源 URDF 文件夹不存在: $SOURCE_DIR" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_MESH_DIR" ]]; then
  echo "[error] 源 meshes 文件夹不存在: $SOURCE_MESH_DIR" >&2
  exit 1
fi

ARGS=(
  --source "$SOURCE_DIR"
  --output "$OUTPUT_DIR"
  --ratio "$RATIO"
  --package-name "$PACKAGE_NAME"
)

if [[ -n "$URDF_NAME" ]]; then
  ARGS+=(--urdf "$URDF_NAME")
fi

if [[ "$KEEP_INERTIAL" -eq 1 ]]; then
  ARGS+=(--keep-inertial)
fi

if [[ "$KEEP_COLLISION" -eq 1 ]]; then
  ARGS+=(--keep-collision)
fi

OUTPUT_MESH_DIR="${OUTPUT_DIR}/meshes"

# 转换前统计所有 STL 总体积
STL_TOTAL_BYTES="$(calc_dir_size "$SOURCE_MESH_DIR" "*.stl")"
STL_COUNT="$(find "$SOURCE_MESH_DIR" -maxdepth 1 -type f -iname '*.stl' | wc -l)"

echo "[run] 生成 Web URDF 资源"
echo "[source] ${SOURCE_DIR}"
echo "[output] ${OUTPUT_DIR}"
echo "[package] ${PACKAGE_NAME}"
echo "[size] STL 总计: $(format_bytes "$STL_TOTAL_BYTES")（${STL_COUNT} 个文件）"

blender --background --python "${SCRIPT_DIR}/stlToglb.py" -- "${ARGS[@]}"

# 转换后统计所有 GLB 总体积
GLB_TOTAL_BYTES="$(calc_dir_size "$OUTPUT_MESH_DIR" "*.glb")"
GLB_COUNT="$(find "$OUTPUT_MESH_DIR" -maxdepth 1 -type f -iname '*.glb' 2>/dev/null | wc -l)"

echo "[done] Web URDF 资源已生成: $OUTPUT_DIR"
echo "[size] GLB 总计: $(format_bytes "$GLB_TOTAL_BYTES")（${GLB_COUNT} 个文件）"

if (( STL_TOTAL_BYTES > 0 )); then
  SAVED_BYTES=$((STL_TOTAL_BYTES - GLB_TOTAL_BYTES))
  SAVED_PERCENT=$((SAVED_BYTES * 100 / STL_TOTAL_BYTES))
  echo "[size] 总体压缩: $(format_bytes "$SAVED_BYTES")（减少 ${SAVED_PERCENT}%）"
else
  echo "[size] 未找到 STL 文件，跳过压缩统计"
fi
