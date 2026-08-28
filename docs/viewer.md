# Editor / Viewer 子域

> 最后更新：2026-08-28 | 覆盖源码：`src/core/robot/assemblySceneProjection.ts`、`src/core/robot/assemblyScenePlacement.ts`、`src/features/editor/`、`src/features/urdf-viewer/`、`src/app/components/unified-viewer/`、`src/shared/components/3d/`
> 交叉引用：[architecture.md](architecture.md)、[file-io.md](file-io.md)、[style-guide.md](style-guide.md)、[wasm-build.md](wasm-build.md)

## 1. 单模式 Editor

Editor 子域划分与快速映射见 [CLAUDE.md](../CLAUDE.md) §Editor 单模式。

新增功能前，先判断属于哪类子能力，避免跨子系统逻辑缠绕。

## 2. 目录结构

```
features/editor/
  index.ts                    # 统一 Editor 公开入口

features/urdf-viewer/
  components/                 # React 组件层
    ViewerCanvas.tsx          # viewer 画布层与共享 canvas 适配
    ViewerScene.tsx           # 统一场景编排，格式差异下沉到 RobotModel/backend
    RobotModel.tsx            # 后端驱动的机器人渲染与交互入口
    ViewerToolbar.tsx         # 顶部工具条
    ViewerLoadingHud.tsx      # loading 状态 HUD
  hooks/                      # React hooks
  renderers/                  # viewer backend 生命周期与 Three.js backend 适配
    ThreeJsBackend.ts         # legacy Three.js backend implementation
    createRendererBackend.ts  # source format -> backend factory
    loadedRobotSceneSync.ts   # runtime scene graph 同步
    sourceFormat.ts           # viewer source format 判定
    types.ts                  # renderer backend contract
  utils/                      # 交互、USD adapter、load key、可视化与 patch 工具
  types.ts                    # 共享类型收口
  runtime/                    # vendored usd-viewer runtime
    embed/                    # 嵌入适配
    hydra/                    # Hydra render delegate
    types/                    # runtime 类型
    vendor/                   # 第三方 vendor 代码
    viewer/                   # viewer 核心
    UPSTREAM.md               # 上游来源说明
  workers/                    # Web Workers
```

## 3. 核心 hooks / 能力

- `useViewerController`：viewer 控制器
- `useMouseInteraction`：鼠标交互处理
- `useHoverDetection`：悬停检测
- `useVisualizationEffects`：惯性、质心、原点等辅助可视化
- `useRendererBackend`：统一模型加载与格式后端生命周期，backend 实现在 `features/urdf-viewer/renderers/`
- `useRobotLoader`：Three.js backend 的底层 source loader
- `useHighlightManager`：高亮管理

工具模式：`select | translate | rotate | universal | view | face | measure`

## 4. 实现约束

- 新能力优先放入 hooks 或新增组件，不要恢复双壳并存
- 保持 `RobotNode <-> JointNode` 交替递归渲染模式
- 材质必须通过 `materials.ts` / `urdfMaterials.ts` 复用，不在高频路径直接 `new`
- viewer backend / load scene sync 归 `features/urdf-viewer/renderers/`；`shared/components/3d/renderers/` 只保留 STL/OBJ/DAE/GLTF 等纯 mesh renderer 组件
- 使用 `RobotData`、`WorkspaceSelection` 等共享类型，避免 `any`
- TransformControls 引用注册必须完整、可追踪
- Props 与共享类型统一收口到 `types.ts`
- 可视化扩展通过 `visualizationFactories.ts`
- 共享关节面板位于 `src/shared/components/Panel/JointsPanel.tsx`

## 5. Canonical Assembly scene projection

- viewer 不持有可写机器人状态；`useWorkspaceStore.workspace` 是唯一模型，渲染数据由 `createAssemblySceneProjection` 只读派生
- projection 输出 `RobotData`、`direct-component | assembled-scene` 策略、`globalToEntityRef` / `entityRefKeyToGlobal` 双向映射和 component root target
- 单个可见 component 且无 bridge 时可用 `direct-component`；其余情况使用 `assembled-scene`。这只是 renderer/resource 性能策略，不得改变 selection、mutation、history 或 source sync 路由
- Assembly transform 与 component transform 由 `createAssemblyScenePlacement` 的统一 root placement 应用；不得恢复 source-scene 专用 transform fallback
- renderer 点击、hover、focus、joint motion 与 transform controls 必须通过 projection map 往返 `WorkspaceSelection` / `EntityRef`；禁止解析全局 ID 文本猜 component owner
- source file 只提供 loader/resource context。结构编辑始终写入目标 component 的 source-local `RobotData`，策略切换不得改动 canonical workspace snapshot

## 6. USD runtime 边界

- `runtime/*` 是 vendored usd-viewer runtime，不要在 `core/parsers/usd/*` 重复实现 viewer runtime 职责
- URDF Studio 应把 runtime 输出适配到 `ViewerRobotDataResolution` / `RobotData`
- `public/usd/bindings/*` 必须保留在静态资源目录，供浏览器运行时 fetch
- **WASM 构建系统**位于 `third_party/OpenUSD` 和 `scripts/build/`；重编命令与故障排查见 [wasm-build.md](wasm-build.md)

## 7. USD worker / metadata 链路约束

适用范围：`runtime/hydra/render-delegate/*`、`workers/*`、`utils/usd*`、`app/hooks/useFile*.ts` 中消费 worker 结果的 USD 工作流

必须遵循：

- USD stage preparation、runtime metadata、robot hydration、prepared export cache、roundtrip archive 的修复，默认优先放在 worker/runtime 链路完成，不要搬到主线程 adapter 或 debug bridge
- `runtime/hydra/render-delegate/*` 产出的 metadata snapshot 是该链路的 source of truth；缺字段应修 worker/runtime 生成逻辑
- scene snapshot 的 Prim descriptor 保留 composed `physics:collisionEnabled` 与
  `physics:approximation`，供宿主区分“源文件声明碰撞”和“平台认证碰撞”；该 metadata 只陈述
  Stage 事实，不签发或暗示 Sim Ready 认证
- 禁止新增"worker 结果缺失 -> 主线程重建 metadata -> 静默继续"的 fallback
- 对 folded fixed link、collision-only semantic child link 的推断只能基于 stage/truth 中的明确证据，不做纯命名猜测
- `visual_*` / `collision_*` / `group_*` / `xform_*` / `scene` / `root` 这类 roundtrip 容器 prim 不是 link identity；runtime metadata 不得把它们提升为 synthetic link 或 fixed joint

验证要求：

- 改动上述链路时，必须跑 `test/unitree_model` 整套 USD 浏览器验证
- 至少覆盖 `Go2 + B2 + H1-2`
- 浏览器验证产物写入 `tmp/regression/`

## 8. USD offscreen / runtime 生命周期约束

适用范围：`usdOffscreenViewer.worker.ts`、`runtime/hydra/render-delegate/*`、`shared/utils/three/dispose.ts`

必须遵循：

- 主线程宿主只负责 handoff、尺寸同步与错误透传；不要重建 runtime truth
- teardown 必须完整释放 observer、DOM/worker 事件监听、RAF/timer、OffscreenCanvas 关联 runtime、scene graph 与 driver 引用
- runtime 全局 handler/registry/active owner 必须提供对称的 unregister/reset
- worker 侧创建的 `ImageBitmap`、object URL、临时 geometry/material/texture 必须显式释放
- 禁止通过全局单例把旧实例挂死

## 9. 关键 utils 职责速查

| 文件                                     | 职责                                      |
| ---------------------------------------- | ----------------------------------------- |
| `viewerRobotData.ts`                     | 统一 viewer 层消费的数据形态              |
| `workspaceSceneProjection.ts`            | canonical selection/motion 与 renderer global ID 映射 |
| `viewerResourceScope.ts`                 | source file / assets / robot links 资源域 |
| `usdExportBundle.ts`                     | USD 场景快照与导出缓存协调                |
| `usdRuntimeRobotHydration.ts`            | runtime -> RobotData hydration            |
| `usdSceneRobotResolution.ts`             | 场景级 robot resolution                   |
| `usdViewerRobotAdapter.ts`               | viewer runtime / snapshot 到应用数据适配  |
| `usdOffscreenViewerWorkerClient.ts`      | 主线程对 offscreen worker 请求封装        |
| `usdStageOpenPreparationWorkerBridge.ts` | prepared-open 链路 worker bridge          |
| `usdPreparedExportCacheWorkerBridge.ts`  | prepared-export 链路 worker bridge        |
| `runtimeSceneMetadata.ts`                | runtime scene metadata 标准化读模型       |
| `visualizationFactories.ts`              | 辅助可视化对象创建                        |
| `dispose.ts`                             | THREE 资源清理                            |

## 10. Renderer Backend 职责速查

| 文件 | 职责 |
| ---- | ---- |
| `renderers/createRendererBackend.ts` | 根据 source format 创建 viewer backend |
| `renderers/ThreeJsBackend.ts` | legacy Three.js 机器人加载、patch、scene 同步 |
| `renderers/loadedRobotSceneSync.ts` | loaded scene 与 runtime robot data 的结构同步 |
| `renderers/robotLoaderSourceMetadata.ts` | loader source metadata 标准化 |
| `renderers/sourceFormat.ts` | viewer source format 分类 |
| `renderers/urdfXmlFallbackPolicy.ts` | URDF XML fallback 策略 |
