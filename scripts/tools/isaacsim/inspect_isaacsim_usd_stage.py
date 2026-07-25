#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path

from isaaclab.app import AppLauncher


def _sanitize_json_value(value: object) -> object:
    """Replace non-finite USD schema fallbacks with JSON-safe null values."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _sanitize_json_value(entry) for key, entry in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize_json_value(entry) for entry in value]
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open USD stages in Isaac Sim and export structural summaries as JSON.",
    )
    parser.add_argument("paths", nargs="+", help="USD stage paths to inspect.")
    parser.add_argument("--output", required=True, help="Where to write the JSON summary.")
    parser.add_argument(
        "--dump-layer-text-dir",
        help="Optional directory where used layers will be exported as readable USDA text.",
    )
    AppLauncher.add_app_launcher_args(parser)
    return parser.parse_args()


def summarize_stage(path: str, dump_layer_text_dir: str | None = None) -> dict[str, object]:
    from pxr import Gf, Usd, UsdGeom, UsdPhysics, UsdShade

    stage = Usd.Stage.Open(path)
    if stage is None:
        return {
            "path": path,
            "open_ok": False,
        }

    default_prim = stage.GetDefaultPrim()
    type_counts: Counter[str] = Counter()
    rigid_bodies: list[str] = []
    articulation_roots: list[str] = []
    joints: list[dict[str, object]] = []
    invalid_joint_targets: list[dict[str, str]] = []
    material_bindings: list[dict[str, object]] = []
    meshes_without_material: list[str] = []
    visual_meshes_without_material: list[str] = []
    collision_meshes_without_material: list[str] = []
    mesh_extents: list[dict[str, object]] = []
    fixed_joint_count = 0
    moving_joint_count = 0
    collision_api_count = 0
    collision_enabled_count = 0
    material_binding_count = 0
    mesh_without_material_count = 0
    mesh_zero_extent_count = 0
    mesh_world_zero_extent_count = 0
    visual_mesh_count = 0
    collision_mesh_count = 0
    visual_mesh_without_material_count = 0
    collision_mesh_without_material_count = 0

    def tuple_to_list(value) -> list[float]:
        return [float(entry) for entry in value]

    def compute_mesh_extent(prim) -> dict[str, object]:
        mesh = UsdGeom.Mesh(prim)
        extent = mesh.GetExtentAttr().Get()
        if extent and len(extent) >= 2:
            min_value = Gf.Vec3d(extent[0])
            max_value = Gf.Vec3d(extent[1])
        else:
            points = mesh.GetPointsAttr().Get() or []
            if points:
                min_value = Gf.Vec3d(points[0])
                max_value = Gf.Vec3d(points[0])
                for point in points[1:]:
                    point_vec = Gf.Vec3d(point)
                    min_value = Gf.Vec3d(
                        min(min_value[0], point_vec[0]),
                        min(min_value[1], point_vec[1]),
                        min(min_value[2], point_vec[2]),
                    )
                    max_value = Gf.Vec3d(
                        max(max_value[0], point_vec[0]),
                        max(max_value[1], point_vec[1]),
                        max(max_value[2], point_vec[2]),
                    )
            else:
                min_value = Gf.Vec3d(0, 0, 0)
                max_value = Gf.Vec3d(0, 0, 0)
        size = max_value - min_value
        corners = [
            Gf.Vec3d(x, y, z)
            for x in (min_value[0], max_value[0])
            for y in (min_value[1], max_value[1])
            for z in (min_value[2], max_value[2])
        ]
        local_to_world = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        world_corners = [local_to_world.Transform(corner) for corner in corners]
        world_min = Gf.Vec3d(world_corners[0])
        world_max = Gf.Vec3d(world_corners[0])
        for point in world_corners[1:]:
            world_min = Gf.Vec3d(
                min(world_min[0], point[0]),
                min(world_min[1], point[1]),
                min(world_min[2], point[2]),
            )
            world_max = Gf.Vec3d(
                max(world_max[0], point[0]),
                max(world_max[1], point[1]),
                max(world_max[2], point[2]),
            )
        world_size = world_max - world_min
        return {
            "path": prim.GetPath().pathString,
            "min": tuple_to_list(min_value),
            "max": tuple_to_list(max_value),
            "size": tuple_to_list(size),
            "world_min": tuple_to_list(world_min),
            "world_max": tuple_to_list(world_max),
            "world_size": tuple_to_list(world_size),
            "point_count": len(mesh.GetPointsAttr().Get() or []),
            "face_count": len(mesh.GetFaceVertexCountsAttr().Get() or []),
            "zero_extent": abs(size[0]) < 1e-12 and abs(size[1]) < 1e-12 and abs(size[2]) < 1e-12,
            "world_zero_extent": abs(world_size[0]) < 1e-12
            and abs(world_size[1]) < 1e-12
            and abs(world_size[2]) < 1e-12,
        }

    for prim in stage.Traverse():
        type_name = prim.GetTypeName() or ""
        type_counts[type_name] += 1

        if prim.HasAPI(UsdPhysics.RigidBodyAPI):
            rigid_bodies.append(prim.GetPath().pathString)
        if prim.HasAPI(UsdPhysics.ArticulationRootAPI):
            articulation_roots.append(prim.GetPath().pathString)
        if prim.HasAPI(UsdPhysics.CollisionAPI):
            collision_api_count += 1
            collision_api = UsdPhysics.CollisionAPI(prim)
            enabled = collision_api.GetCollisionEnabledAttr().Get()
            if enabled is not False:
                collision_enabled_count += 1

        if type_name == "Mesh":
            mesh_path = prim.GetPath().pathString
            is_visual_mesh = "/visuals/" in mesh_path.lower()
            is_collision_mesh = "/collisions/" in mesh_path.lower()
            if is_visual_mesh:
                visual_mesh_count += 1
            if is_collision_mesh:
                collision_mesh_count += 1
            extent_entry = compute_mesh_extent(prim)
            mesh_extents.append(extent_entry)
            if extent_entry["zero_extent"]:
                mesh_zero_extent_count += 1
            if extent_entry["world_zero_extent"]:
                mesh_world_zero_extent_count += 1
            bound_material, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
            if bound_material and bound_material.GetPrim().IsValid():
                material_binding_count += 1
                material_bindings.append(
                    {
                        "mesh": prim.GetPath().pathString,
                        "material": bound_material.GetPrim().GetPath().pathString,
                    }
                )
            else:
                mesh_without_material_count += 1
                meshes_without_material.append(mesh_path)
                if is_visual_mesh:
                    visual_mesh_without_material_count += 1
                    visual_meshes_without_material.append(mesh_path)
                if is_collision_mesh:
                    collision_mesh_without_material_count += 1
                    collision_meshes_without_material.append(mesh_path)

        if "Joint" not in type_name:
            continue

        if "fixed" in type_name.lower():
            fixed_joint_count += 1
        else:
            moving_joint_count += 1

        body0_rel = prim.GetRelationship("physics:body0")
        body1_rel = prim.GetRelationship("physics:body1")
        body0 = [target.pathString for target in body0_rel.GetTargets()] if body0_rel else []
        body1 = [target.pathString for target in body1_rel.GetTargets()] if body1_rel else []

        for target in body0 + body1:
            if not stage.GetPrimAtPath(target).IsValid():
                invalid_joint_targets.append(
                    {
                        "joint": prim.GetPath().pathString,
                        "target": target,
                    }
                )

        joints.append(
            {
                "path": prim.GetPath().pathString,
                "type": type_name,
                "body0": body0,
                "body1": body1,
                "axis": prim.GetAttribute("physics:axis").Get() if prim.HasAttribute("physics:axis") else None,
                "lower_limit": prim.GetAttribute("physics:lowerLimit").Get()
                if prim.HasAttribute("physics:lowerLimit")
                else None,
                "upper_limit": prim.GetAttribute("physics:upperLimit").Get()
                if prim.HasAttribute("physics:upperLimit")
                else None,
                "local_pos0": tuple_to_list(prim.GetAttribute("physics:localPos0").Get())
                if prim.HasAttribute("physics:localPos0") and prim.GetAttribute("physics:localPos0").Get() is not None
                else None,
                "local_pos1": tuple_to_list(prim.GetAttribute("physics:localPos1").Get())
                if prim.HasAttribute("physics:localPos1") and prim.GetAttribute("physics:localPos1").Get() is not None
                else None,
            }
        )

    dumped_layers: list[str] = []
    if dump_layer_text_dir:
        dump_root = Path(dump_layer_text_dir)
        dump_root.mkdir(parents=True, exist_ok=True)
        for index, layer in enumerate(stage.GetUsedLayers()):
            layer_name = Path(layer.identifier).name or f"layer_{index}.usd"
            target_name = f"{index:02d}_{layer_name}"
            if not target_name.endswith(".usda"):
                target_name = f"{target_name}.usda"
            target_path = dump_root / target_name
            layer.Export(str(target_path))
            dumped_layers.append(str(target_path))

    return {
        "path": path,
        "open_ok": True,
        "default_prim": default_prim.GetPath().pathString if default_prim and default_prim.IsValid() else None,
        "default_prim_children": [
            child.GetName() for child in default_prim.GetChildren()
        ] if default_prim and default_prim.IsValid() else [],
        "prim_count": sum(1 for _ in stage.Traverse()),
        "used_layers": [layer.identifier for layer in stage.GetUsedLayers()],
        "meters_per_unit": float(UsdGeom.GetStageMetersPerUnit(stage)),
        "up_axis": str(UsdGeom.GetStageUpAxis(stage)),
        "type_counts": dict(type_counts),
        "rigid_body_count": len(rigid_bodies),
        "collision_api_count": collision_api_count,
        "collision_enabled_count": collision_enabled_count,
        "mesh_count": type_counts.get("Mesh", 0),
        "visual_mesh_count": visual_mesh_count,
        "collision_mesh_count": collision_mesh_count,
        "mesh_zero_extent_count": mesh_zero_extent_count,
        "mesh_world_zero_extent_count": mesh_world_zero_extent_count,
        "mesh_without_material_count": mesh_without_material_count,
        "visual_mesh_without_material_count": visual_mesh_without_material_count,
        "collision_mesh_without_material_count": collision_mesh_without_material_count,
        "mesh_without_material_sample": meshes_without_material[:16],
        "visual_mesh_without_material_sample": visual_meshes_without_material[:16],
        "collision_mesh_without_material_sample": collision_meshes_without_material[:16],
        "material_binding_count": material_binding_count,
        "material_binding_sample": material_bindings[:16],
        "mesh_extent_sample": mesh_extents[:16],
        "joint_count_moving": moving_joint_count,
        "joint_count_fixed": fixed_joint_count,
        "joint_count_non_fixed": moving_joint_count,
        "articulation_roots": articulation_roots,
        "joint_count": len(joints),
        "joint_sample": joints[:16],
        "invalid_joint_target_count": len(invalid_joint_targets),
        "invalid_joint_targets_sample": invalid_joint_targets[:16],
        "dumped_layers": dumped_layers,
    }


def main() -> None:
    args = parse_args()
    app_launcher = AppLauncher(args)
    simulation_app = app_launcher.app

    try:
        summary: dict[str, dict[str, object]] = {}
        for path in args.paths:
            dump_dir = None
            if args.dump_layer_text_dir:
                dump_dir = str(Path(args.dump_layer_text_dir) / Path(path).stem)
            summary[path] = summarize_stage(path, dump_dir)

        with open(args.output, "w", encoding="utf-8") as output_file:
            json.dump(_sanitize_json_value(summary), output_file, indent=2, allow_nan=False)
    finally:
        simulation_app.close()


if __name__ == "__main__":
    main()
