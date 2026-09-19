# 代码变更 → 文档更新 & 验证映射

> 最后更新：2026-09-07 | 覆盖范围：变更工作流、验证命令、测试样本索引
> 交叉引用：[architecture.md](architecture.md)、[viewer.md](viewer.md)、[file-io.md](file-io.md)、[testing.md](testing.md)

## 1. 代码变更工作流

项目约束见 [CLAUDE.md](../CLAUDE.md)，模块 owner 与依赖边界见 [architecture.md](architecture.md)。本页补充按变更范围选择的验收项、样本与文档更新位置。

## 2. 单文件与模块化策略

按职责和生命周期决定是否拆分，不为行数硬拆内聚逻辑；source sync、viewer backend 和格式检测落到现有 canonical owner，不在 wrapper 复制。设计原则与规模门禁见 [architecture.md](architecture.md) §10、§13。

## 3. 验收清单

仅检查与本次改动相关的项：

- [ ] UI：Light / Dark / 高对比模式可读，无新增分散硬编码颜色
- [ ] 3D / worker：资源、observer/listener/timer、object URL、ImageBitmap 和 pending request 有对称 cleanup
- [ ] 状态与数据：依赖方向及 canonical ownership 正确，hydration/roundtrip/export 不破坏 source of truth，失败显式报错
- [ ] 调试接口：仅 `?regressionDebug=1` 暴露全局调试对象
- [ ] 浏览器验证：按 §6 保存产物并清理本次启动的浏览器与 dev server
- [ ] USD worker / metadata 链路：完成 `test/unitree_model` 全量验证，结果写入 `tmp/regression/`
- [ ] 运行时代码：完成对应测试或构建验证

## 4. 增量命令

常规单测、fixture、构建与综合验证入口见 [testing.md](testing.md) 和 [CLAUDE.md](../CLAUDE.md)。USD worker / metadata 的专项回归：

```bash
node --test \
  src/features/urdf-viewer/runtime/hydra/render-delegate/robot-metadata-stage-fallback.test.js \
  src/features/urdf-viewer/runtime/hydra/render-delegate/folded-fixed-link-truth.test.js

npx tsx --test \
  src/features/urdf-viewer/utils/usdViewerRobotAdapter.test.ts \
  src/features/urdf-viewer/utils/usdRuntimeRobotHydration.test.ts

npm run test:fixtures:unitree-usd
```

## 5. 测试样本索引

### USD / worker / roundtrip 主样本（`test/unitree_model/`）

| 样本                                   | 用途                                                 |
| -------------------------------------- | ---------------------------------------------------- |
| `Go2/usd/go2.usd`                      | 四足基准：USD stage open、worker metadata、hydration |
| `Go2W/usd/go2w.usd`                    | 轮足变体：资产命名差异与 roundtrip 稳定性            |
| `B2/usd/b2.usd`                        | 更大体量四足：folded fixed link、复杂结构            |
| `H1-2/h1_2/h1_2.usd`                   | Humanoid：双足/人形链路与 viewer hydration           |
| `H1-2/h1_2_handless/h1_2_handless.usd` | Handless 变体：资产差异下的 runtime 行为             |
| `*.viewer_roundtrip.usd`               | 导出后 diff、回归对照与 roundtrip 验证               |

轻量单测 `usdPreparedExportCacheWorkerBridge.test.ts` 验证单资产导出入口的完整二进制依赖闭包、
完成时序、取消/错误/超时清理；`features/file-io/utils/mjcfExport.test.ts` 验证模型与场景共享
MJCF 生成选项、网格和贴图打包。上述单测不替代 Unitree 浏览器语料验证。

### SDF / Gazebo 样本（`test/gazebo_models/`）

| 样本                       | 用途                       |
| -------------------------- | -------------------------- |
| `camera/model.sdf`         | 轻量 smoke                 |
| `cordless_drill/model.sdf` | DAE + STL + texture 混合   |
| `bus_stop/model.sdf`       | 多 mesh + 贴图 + 混合格式  |
| `apartment/model.sdf`      | 大场景：纹理 + viewer 性能 |
| `camera/model-1_2.sdf` 等  | 版本化 SDF 兼容性          |

### URDF 样本（`test/awesome_robot_descriptions_repos/`）

| 样本                                                 | 用途                  |
| ---------------------------------------------------- | --------------------- |
| `anymal_c_simple_description/urdf/anymal.urdf`       | 纹理 + DAE 完整四足   |
| `mini_cheetah_urdf/urdf/mini_cheetah.urdf`           | OBJ/STL 混合资产      |
| `cassie_description/urdf/cassie_v4.urdf`             | 双足复杂关节层级      |
| `fanuc_m760ic_description/urdf/m710ic70.urdf`        | 工业机械臂            |
| `models/franka_description/urdf/panda_arm_hand.urdf` | gltf + ktx2 + png/bin |

### MJCF 样本（`test/awesome_robot_descriptions_repos/mujoco_menagerie/`）

| 样本                    | 用途                       |
| ----------------------- | -------------------------- |
| `unitree_go2/go2.xml`   | 标准 MuJoCo menagerie 样本 |
| `unitree_go2/scene.xml` | 带 scene 包装的 MJCF       |

### 样本选择建议

- 快速 smoke：`gazebo_models/camera/model.sdf`、`fanuc.../m710ic70.urdf`、`Go2/usd/go2.usd`
- 资源加载回归：`bus_stop/model.sdf`、`panda_arm_hand.urdf`、`mini_cheetah.urdf`
- 复杂层级：`H1-2/h1_2/h1_2.usd`、`cassie_v4.urdf`
- USD worker / metadata / roundtrip：整套 `test/unitree_model`

## 6. 浏览器验证规则

- 默认无头模式，除非用户要求可见窗口。验证产物放 `tmp/`，不在根目录写截图；`output/` 用于用户可见导出与回归归档。
- 使用 `try/finally` 或等价机制关闭 page/context/browser 及本次启动的 dev server，结束时运行 `node test/usd-viewer/scripts/cleanup-headless.cjs`。
- 残留进程按本次自动化的 PID/临时 profile 定位，只清理这些进程；禁止宽泛 `pkill chrome` / `killall chrome`。
- 展示截图可清理无关遮挡；bug 复现截图保留与问题相关的界面状态。

## 7. 文档更新映射

| 变更范围                         | 应更新文档                                          |
| -------------------------------- | --------------------------------------------------- |
| 新增 feature / 拆分 feature 目录 | `architecture.md` §4 与对应功能文档                  |
| 新增 store                       | `CLAUDE.md` §Editor 单模式与状态管理、`architecture.md` |
| 修改 USD worker / runtime 链路   | `viewer.md` §6-7、`update-rules.md` §5              |
| 修改 viewer backend / renderers   | `viewer.md` §2、§9、`architecture.md` §6            |
| 修改导入导出流程                 | `file-io.md` §2                                     |
| 修改格式检测                     | `CLAUDE.md` §架构红线、`file-io.md` §1-2            |
| 修改 workspace/source sync 策略   | `file-io.md` §1-3、`architecture.md` §8             |
| 修改 UI 样式 / 新增语义色 token  | `style-guide.md` §3                                 |
| 新增架构例外                     | `architecture.md` §3                                |
| 新增长期稳定测试样本             | `update-rules.md` §5                                |
| 新增测试入口 / 调整测试分层      | `testing.md`、`CLAUDE.md` §测试分层与 AI 选命令规则 |
