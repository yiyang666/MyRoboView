# stlToglb.py 使用说明
#
# 功能：
#   1. 批量将 URDF 文件夹中的 meshes/*.STL / *.stl 转换为 meshes/*.glb。
#   2. 可通过 --ratio 控制是否减面。
#   3. 生成 Web 端精简 URDF：默认移除 inertial 和 collision，并把 mesh 路径改为 GLB。
#
# 运行环境：
#   该脚本依赖 Blender 的 Python API：bpy。
#   推荐由 build_web_urdf.sh 调用，不推荐直接用系统 python3 执行。
#
# 参数说明：
#   --source       原始 URDF 文件夹，例如 lrs-x
#   --output       输出 Web 版 URDF 文件夹，例如 lrs-x-web
#   --ratio        减面比例，默认 1.0；设置为 1.0 表示不减面
#   --package-name 输出 URDF 中使用的 package 名，默认取 output 文件夹名
#   --urdf         只处理指定 URDF 文件；默认处理 source 下所有 .urdf
#   --keep-inertial 保留 inertial 字段
#   --keep-collision 保留 collision 字段
#
# 推荐用法（在 my-app 根目录执行）：
#   ./tools/build_web_urdf.sh --source lrs-x --output lrs-x-web --ratio 1.0
#
# 目录约定：
#   源 URDF：tools/robot_urdf/<source>/
#   输出 Web 资源：public/robot_urdf/<output>/
#
# 兼容旧用法：只转换 STL，不生成 URDF：
#   blender --background --python stlToglb.py -- --input lrs-x/meshes --output lrs-x-web/meshes --ratio 1.0
#
# 注意：
#   1. --ratio 取值越小，模型面数越少，文件通常越小，但细节损失越明显。
#   2. --ratio 1.0 不会执行减面，适合先验证 STL 到 GLB 的基础转换效果。

import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
import bpy

def get_script_args():
    """只解析 Blender `--` 后面的脚本参数，避免把 Blender 自身参数传给 argparse。"""
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

def import_stl(path):
    # Blender 4.x
    if hasattr(bpy.ops.wm, "stl_import"):
        bpy.ops.wm.stl_import(filepath=str(path))
    else:
        # Blender 3.x
        bpy.ops.import_mesh.stl(filepath=str(path))

def decimate_objects(ratio):
    if ratio >= 1.0:
        return

    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        # STL 导入后多个物体可能共享同一份 mesh 数据，减面前需先解除多用户引用
        if obj.data.users > 1:
            obj.data = obj.data.copy()

        modifier = obj.modifiers.new("web_decimate", "DECIMATE")
        modifier.ratio = ratio

        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)

def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format='GLB',
        export_apply=True,
        export_yup=False,
    )

def convert_one(src, dst, ratio):
    clear_scene()
    import_stl(src)

    # 保留文件名，方便 URDF 对应
    for obj in bpy.context.scene.objects:
        obj.name = src.stem

    decimate_objects(ratio)
    dst.parent.mkdir(parents=True, exist_ok=True)
    export_glb(dst)

def collect_urdf_files(source_dir, urdf_name):
    if urdf_name:
        urdf_path = source_dir / urdf_name
        if not urdf_path.exists():
            raise FileNotFoundError(f"找不到指定 URDF 文件: {urdf_path}")
        return [urdf_path]

    urdf_files = sorted(source_dir.glob("*.urdf"))
    if not urdf_files:
        raise FileNotFoundError(f"源目录下没有 .urdf 文件: {source_dir}")
    return urdf_files

def remove_child(parent, child):
    if child is not None:
        parent.remove(child)

def simplify_and_rewrite_urdf(src_urdf, dst_urdf, package_name, keep_inertial, keep_collision):
    tree = ET.parse(src_urdf)
    root = tree.getroot()

    for link in root.findall("link"):
        if not keep_inertial:
            # Web 端只做展示和关节动画时，不需要质量和惯量信息。
            remove_child(link, link.find("inertial"))

        if not keep_collision:
            # 浏览器展示不使用碰撞模型，移除后可以减少 URDF 体积和解析负担。
            for collision in list(link.findall("collision")):
                link.remove(collision)

    for mesh in root.findall(".//mesh"):
        filename = mesh.attrib.get("filename", "")
        if not filename:
            continue

        mesh_name = Path(filename).stem
        mesh.attrib["filename"] = f"package://{package_name}/meshes/{mesh_name}.glb"

    ET.indent(tree, space="  ", level=0)
    dst_urdf.parent.mkdir(parents=True, exist_ok=True)
    tree.write(dst_urdf, encoding="utf-8", xml_declaration=True)

def convert_mesh_dir(src_dir, dst_dir, ratio):
    stl_files = sorted(src_dir.glob("*.STL")) + sorted(src_dir.glob("*.stl"))
    if not stl_files:
        raise FileNotFoundError(f"STL 输入目录下没有 STL 文件: {src_dir}")

    for src in stl_files:
        dst = dst_dir / f"{src.stem}.glb"
        print(f"[convert] {src.name} -> {dst.relative_to(dst_dir.parent) if dst_dir.parent else dst.name}")
        convert_one(src, dst, ratio)

def main():
    parser = argparse.ArgumentParser(description="生成 Web 端使用的 GLB mesh + 精简 URDF")
    parser.add_argument("--source", help="原始 URDF 文件夹，例如 lrs-x")
    parser.add_argument("--input", help="兼容旧用法：只转换指定 STL 输入目录")
    parser.add_argument("--output", required=True, help="输出目录；--source 模式下是 Web URDF 文件夹")
    parser.add_argument("--ratio", type=float, default=1.0, help="减面比例，1.0 表示不减面")
    parser.add_argument("--package-name", default=None, help="输出 URDF 中使用的 package 名，默认取 output 文件夹名")
    parser.add_argument("--urdf", default=None, help="只处理指定 URDF 文件；默认处理 source 下所有 .urdf")
    parser.add_argument("--keep-inertial", action="store_true", help="保留 inertial 字段")
    parser.add_argument("--keep-collision", action="store_true", help="保留 collision 字段")
    args = parser.parse_args(get_script_args())

    if not 0 < args.ratio <= 1.0:
        raise ValueError("--ratio 必须在 (0, 1.0] 范围内")

    if args.source:
        source_dir = Path(args.source).resolve()
        output_dir = Path(args.output).resolve()
        package_name = args.package_name or output_dir.name

        source_mesh_dir = source_dir / "meshes"
        output_mesh_dir = output_dir / "meshes"

        if not source_dir.exists():
            raise FileNotFoundError(f"源 URDF 文件夹不存在: {source_dir}")
        if not source_mesh_dir.exists():
            raise FileNotFoundError(f"源 meshes 文件夹不存在: {source_mesh_dir}")

        print(f"[source] {source_dir}")
        print(f"[output] {output_dir}")
        print(f"[package] {package_name}")
        print(f"[ratio] {args.ratio}")

        convert_mesh_dir(source_mesh_dir, output_mesh_dir, args.ratio)

        for src_urdf in collect_urdf_files(source_dir, args.urdf):
            dst_urdf = output_dir / src_urdf.name
            print(f"[urdf] {src_urdf.name} -> {dst_urdf.relative_to(output_dir)}")
            simplify_and_rewrite_urdf(
                src_urdf,
                dst_urdf,
                package_name,
                keep_inertial=args.keep_inertial,
                keep_collision=args.keep_collision,
            )

        print("[done] Web URDF 资源已生成")
        return

    if not args.input:
        raise ValueError("请使用 --source 生成 Web URDF 文件夹，或使用 --input 只转换 STL")

    convert_mesh_dir(Path(args.input), Path(args.output), args.ratio)

if __name__ == "__main__":
    main()