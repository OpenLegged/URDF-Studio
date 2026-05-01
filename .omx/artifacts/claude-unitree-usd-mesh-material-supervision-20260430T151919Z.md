# Claude Supervision: Unitree USD Mesh/Material

## Original user task

修复 Unitree model/USD 加载后法线/黑三角和 Go2 FR_calf 颜色不对；用 conda IsaacSim 提取 mesh 并对比所有 Unitree model 与真值；调用 Claude 监督。

## Final prompt sent to Claude CLI

```text
你是 URDF Studio 修复任务的监督 reviewer。请审查这个问题的根因和修复方向，不要改文件，只给建议。

用户反馈：URDF Studio 加载 Unitree model 里的模型仍有法线/剔除不对，渲染有很多黑色三角形；Go2 USD 里腿部 FR_calf 颜色不对；怀疑 RobotState 与 USD 真值不一致。要求使用 conda 里的 IsaacSim 提取 mesh 并对比所有 Unitree model 与真值。

当前仓库关键事实：
- 技术栈 React/TS/Three/Vite，USD runtime 在 src/features/urdf-viewer/runtime。
- 现有回归脚本 scripts/regression/validate_unitree_ros_usd_against_isaacsim.ts 使用 /home/xiangyk/anaconda3/envs/isaaclab22/bin/python 与 IsaacLab convert_urdf.py 生成真值，并用 extract_isaacsim_truth.py/compare_roundtrip_truth.py 对比 mesh/material/physics。
- 工作树已有未提交改动：RobotState hydration/prepared cache、UrdfVisual.doubleSided、buildRuntimeRobotFromState/robotLoaderGeometryPatch 对 doubleSided 应用 DoubleSide、robotLoaderDiff 增加 doubleSided 比较。
- HydraMesh.js 已有 _doubleSided/_cullStyle、setDoubleSided/setCullStyle、_applySurfaceState，applyUpdates 会接收 updates.doubleSided/cullStyle；commit 末尾调用 _applySurfaceState。
- 可能风险：HydraMesh.setMaterial 在替换材质后没有立即 _applySurfaceState；_applySurfaceState 设置 side 但未设置 material.needsUpdate。setGeomSubsetMaterial 会调用 _applySurfaceState。
- USD 序列化当前写 normals、displayColor、material:binding，但没有看到 explicit doubleSided/cullStyle 输出；需要确认 USD stage 输入是否含 doubleSided 或是否来自 proto payload。
- 用户特别点名 FR_calf 颜色错，应验证是否材质绑定/GeomSubset/materialId 在 RobotState hydration 或 runtime render delegate 中丢失。

请给出：
1. 最可能的根因假设，按概率排序。
2. 最小回归测试建议（最好是 node:test 对 HydraMesh/serialization/hydration，另加 IsaacSim focused fixture 命令）。
3. 修复时最该避免的误区。
4. 针对 FR_calf 材质错色，需要查哪些 JSON/artifacts 字段。

要求：简洁、可执行、严谨。
```

## Claude output (raw)

```text

### 关键调试节点
重点检查 `FR_calf` 在以下三处的状态一致性：
1. **RobotState hydration 前**（原始数据）
2. **USD 序列化后**（中间状态）
3. **Runtime 渲染时**（最终状态）

使用 `console.log` 或 debug 工具打印每处的 `material`、`doubleSided`、`cullStyle`、`geomSubsets.materialId`，定位在哪一步丢失或错位。
```

## Concise summary

待主代理阅读 Claude 输出后整理。

## Action items / next steps

待主代理阅读 Claude 输出后整理。
