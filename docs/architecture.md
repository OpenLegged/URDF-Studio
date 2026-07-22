# 架构边界详细说明

> 最后更新：2026-07-11 | 覆盖源码：`src/` 全局
> 交叉引用：[viewer.md](viewer.md)、[file-io.md](file-io.md)、[robot-canvas-lib.md](robot-canvas-lib.md)

## 1. 依赖方向（补充）

依赖图与基本约束见 [CLAUDE.md](../CLAUDE.md) §架构红线与执行准则。此处补充逐层细化：

- `app`：编排 features/store/shared/core/types，不把业务细节反向塞回下层
- `features`：依赖 store/shared/core/types，禁止依赖 app
- `store` / `shared`：不应新增对 features 的运行时依赖
- `core`：纯解析、robot 拓扑、格式检测、runtime patch diff 等，不引入 React / store / feature / shared UI
- `types`：只提供类型与常量，不回指上层

## 2. lib / packages 约束

- `src/lib/` 视为对外复用封装层，只收稳定、通用、与应用壳无关的能力
- 应用内部不要把 `src/lib/` 当业务逻辑 source of truth
- 若能力强依赖 `workspaceStore`、app overlays 或特定业务流程，不要抽进 `src/lib/`
- `packages/react-robot-canvas/` 是对外发布包工作区；`dist/` 由构建脚本维护，禁止手改

## 3. 当前存量例外（禁止扩散）

运行时代码：

- `src/features/editor/index.ts` -> `src/features/urdf-viewer/index.ts`（Editor facade）
- `src/features/editor/{ik_selection,panels,usd_bindings,usd_documents,usd_export,usd_hydration,usd_offscreen_runtime,usd_prewarm,usd_runtime}.ts` -> `src/features/urdf-viewer/...`（Editor 窄 facade；精确 importer / specifier / target 以 `dependency_boundaries.mjs` allowlist 为准）
- `src/lib/components/RobotCanvas.tsx` -> `src/features/urdf-viewer/components/JointInteraction.tsx`
- `src/lib/components/RobotCanvas.tsx` -> `src/features/urdf-viewer/components/RobotModel.tsx`

上述例外由 `scripts/tools/dependency_boundaries.mjs` 按 importer + specifier + resolved target 精确匹配，禁止扩大为整层或整 feature 例外。

测试期例外（不作为运行时先例）：

- `src/features/file-io/utils/usdFloatingRoundtrip.test.ts` -> `urdf-viewer` runtime/utils
- `src/features/file-io/utils/usdGo2Roundtrip.test.ts` -> `urdf-viewer` runtime/utils

## 4. Feature Public APIs

- `editor`：统一 Editor 公开入口通过 `src/features/editor/index.ts` 暴露；高成本 / 延迟加载 / app 编排专用能力可通过 `src/features/<feature>/*.ts` 窄 facade 暴露，允许清单由 `dependency_boundaries.mjs` 精确维护
- `code-editor`：组件与 Monaco 运行时从 `src/features/code-editor/index.ts` 静态进入应用依赖图；这是为了保证开发期旧页面点击源码时不再请求可能失效的 Vite 模块，禁止恢复组件入口或 Monaco 的点击时动态 `import()`
- `urdf-viewer`：Editor 实现子目录，通过 `src/features/urdf-viewer/index.ts` 暴露
- `file-io`：导入导出入口，通过 `src/features/file-io/index.ts` 暴露
- `app` 层新增对 `src/features/<feature>/...` 子路径的 deep import 必须先收敛到 feature 公开入口；存量 deep import 只保留在 `dependency_boundaries_baseline.json` 的 `knownFeatureDeepImports` ratchet 中，按 `importer -> specifier` 精确计数，修掉后删除对应 baseline 项。

## 5. Canonical Data Sources

- `DEFAULT_MOTOR_LIBRARY` canonical source：`src/shared/data/defaultMotorLibrary.json`
- 宿主注入状态 canonical source：`src/shared/hostIntegrationState.ts`；`src/hostIntegrations.ts` 只做稳定 facade，feature 不得反向依赖 app facade
- `src/shared/data/motorLibrary.ts`：仅负责验证、标准化与导入路径检测
- `src/features/hardware-config/index.ts`：兼容层 re-export
- 应用机器人领域状态 canonical source：`src/store/workspaceStore.ts` 中非空 `workspace: AssemblyState`
- workspace 构造与严格不变量：`src/core/robot/canonicalWorkspace.ts`
- component 内 `RobotData` 始终使用 source-local ID；跨 component ID 只由 `assemblySceneProjection.ts` 显式映射
- selection canonical source：`src/store/selectionStore.ts` 的 `WorkspaceSelection`；禁止恢复 robot/assembly 两套 selection
- project archive canonical source：`.usp 3.0` 的 `workspace/state.json` 与 `history/workspace.json`；旧版本直接拒绝

## 6. Shared Three.js 工具

- `vite.config.ts` 从 Node 当前可解析的依赖图定位 Three：Core 独立安装时使用自身 `node_modules`，被宿主仓直接编译或运行配置测试时可使用上层锁定安装，不要求伪造 `core/node_modules`
- 通用 THREE 释放：`src/shared/utils/three/dispose.ts`
- `src/features/urdf-viewer/utils/dispose.ts`：兼容层 re-export
- viewer backend lifecycle：`src/features/urdf-viewer/renderers/`，包括 `ThreeJsBackend`、`createRendererBackend`、`loadedRobotSceneSync`、source format / metadata / fallback policy
- shared mesh renderer：`src/shared/components/3d/renderers/` 只放纯 mesh renderer 组件（STL/OBJ/DAE/GLTF）与 Collada scene helpers，不承载 viewer backend 状态
- collision overlay material：`src/shared/utils/three/collisionOverlayMaterial.ts`
- MJCF parser material：`src/core/utils/materialFactory.ts`

## 7. Core Canonical Helpers

- 源文件格式检测 canonical source：`src/core/parsers/format_detection.ts`
- `app/utils/import-preparation/formatDetection.ts` 与 `features/file-io/utils/formatDetection.ts` 只做 workflow wrapper 或资产/电机文件补充判断
- 组装 auto seed：`src/core/robot/auto_seed_assembly.ts`；避免 app 与 file-io 测试各自复制 seed 逻辑
- runtime patch diff：`src/core/robot/runtime_patch_diff.ts`；viewer 可通过 `features/urdf-viewer/utils/robotLoaderDiff.ts` 兼容 re-export

## 8. Canonical Workspace / Source Documents

- `src/app/hooks/workspace-source-sync/robot_source_snapshot.ts`：source snapshot 的稳定序列化；该目录不持有 robot 镜像
- `src/core/robot/componentSourceDraft.ts`：component-owned draft 与 semantic hash；library source 只是不可变模板
- `src/app/utils/sourceCodeDocuments.ts`：按 active component 构造可编辑 document；multi/bridge workspace 只提供只读 projection
- `src/app/hooks/workspace-mutations/*`：所有业务 mutation 显式携带 component/entity target
- structured mutation 后只允许 patch 对应 component draft 或使其失效；禁止回写共享 library template
- source full apply 在 store 外 parse/validate，再以 revision CAS 原子替换目标 component robot + matching draft
- 不得恢复 `useWorkspaceSourceSync`、single-component reuse/reseed、source-scene mirror 或 renderer-strategy mutation 分支

## 8.1 Scene Projection Boundary

- `src/core/robot/assemblySceneProjection.ts`：输出 direct/assembled `RobotData` 与 `EntityRef` 双向 global ID mapping
- `src/core/robot/assemblyScenePlacement.ts`：统一 Assembly/component root transform，renderer 与 export 共用
- `direct-component` 仅是性能策略；selection、mutation、history、source apply 和 export target 不得以此分流
- projection 只读且不得写回 store；owner 解析只能查 mapping，禁止按字符串前缀猜测

## 8.2 Workflow / Runtime Lifecycle Owners

- `src/app/hooks/robotLoadWorkflow.ts` 是 document load/import 的线性 use case；pre-resolved cache 与 worker completion 必须汇入同一 finish/commit 路径，React/store 绑定只放 `useRobotLoadWorkflow.ts`
- `src/features/urdf-viewer/hooks/viewer-controller/useClosedLoopPreviewScheduler.ts` 独占闭环预览 worker session、RAF、pending request、generation/in-flight serial 和 unmount cleanup；controller facade 不得复制这些 refs 或另开求解入口
- `src/app/utils/importPreparation.ts` 只保留顶层 workflow/facade；共享 DTO/集合、sidecar reference、archive collector、loose-file collector 分别位于 `import-preparation/` 对应模块，archive/loose 路径复用同一 sidecar 解析能力
- `src/features/urdf-viewer/utils/usdOffscreenInteractionState.ts` 独占 offscreen selection/hover、mesh/pick/helper index、raycaster/pointer 与 highlight snapshot；stage reset 恢复 highlight 并清索引但保留 selection，full reset 才清空交互选择
- `src/app/hooks/useWorkspaceViewerDerivations.ts` 负责 workspace→semantic scene/projection/placement/viewer document/source document/joint read model；高频 live joint motion 不得使 semantic projection/placement 失去 identity
- `src/app/hooks/useAppLayoutSnapshotWorkflow.ts` 独占 snapshot action refs、preview session、capture cancellation/progress 与 debug API cleanup；`AppLayout` 只组合其稳定输出
- `src/app/components/unified-viewer/useUnifiedViewerSceneLifecycle.ts` 独占 retained Three.js graph、document scope、inactive scene timer、release timer 和 unmount cleanup
- `src/features/urdf-viewer/utils/usdDeferredSceneSnapshotLifecycle.ts` 独占 deferred scene snapshot 的 pending payload、单 timer、generation/revision、stage clear 与 terminal dispose
- `src/app/components/snapshot-dialog/snapshotCaptureForm.ts` 独占 capture form 默认值、JPEG/透明背景不变量、压缩档位和翻译后的 choice model；`SnapshotDialog` 保留窗口/preview render 生命周期

## 9. Debuggability First

默认原则：兜底不是默认美德，silent fallback 会掩盖真实问题、污染状态、拉高排障成本。

必须遵循：

- 默认优先暴露真实错误，不吞错、不改写异常、不偷偷切备用路径
- 禁止新增 `catch -> 返回空值/默认值/旧缓存/伪成功状态` 的 silent fallback
- 导入、导出、hydration、roundtrip、解析、viewer 初始化等 source-of-truth 链路禁止不透明兜底
- Worker bridge / off-main-thread 链路默认 fail fast，不要因 worker 不可用就在主线程悄悄补实现
- 禁止用"自动重试 + 自动降级 + 自动切换备用实现"掩盖根因

若必须保留窄兜底，同时满足：

- 保留原始错误信息、栈与触发条件
- 能被用户或开发者明确观察到
- 不得悄悄改写 source of truth
- 注释说明为何必须兜底及降级到什么

## 10. Linux 哲学与 Linus taste

这是一级工程约束，不是风格建议。

默认取向：

- 优先简单直接的数据流与控制流，不为"理论优雅"引入额外抽象层
- 优先解决真实问题，不为未来场景预埋复杂框架
- 优先把复杂度消灭在设计里，不包进 manager/factory/coordinator 名字里

必须遵循：

- 小而清晰的接口优先
- 优先组合现有稳定模块，不新增"万能层""统一抽象层""Base\*"或过度泛化封装
- 优先通过更好的数据结构消灭特殊情况，不继续堆 `if/else`
- 命名必须直白，描述真实语义、所有权、生命周期和失败路径
- 不把坏状态悄悄修平；异常时暴露不变量被破坏的位置
- 新抽象必须证明降低了整体复杂度；只搬运复杂度则不抽

明确不鼓励：

- 为"模式统一"引入不需要的架构层
- 过度 OO / 继承 / 配置化 / 泛型化
- 把复杂交互拆成大量弱关联小文件
- 用 silent fallback、隐式同步、魔法默认值维持表面整洁
- 为避免修改旧代码而额外包适配器

## 11. 内存 / 生命周期约束

- 新增 `ResizeObserver`、全局事件监听、RAF、timer、worker listener、`ImageBitmap`、object URL、THREE 材质/几何体/纹理、OffscreenCanvas 时必须同时实现对称 cleanup
- shared worker / singleton runtime 必须明确所有者和释放边界
- 新增 shared worker / singleton runtime 时，评审必须能指出对应 `dispose*` / `reset*` 调用点
- 临时缓存必须有上限、淘汰策略或显式 dispose/reset 路径

## 12. 依赖检查命令

分层红线、`app` feature deep import surface 与 import 循环由 `scripts/tools/dependency_boundaries.mjs` 机器化把关（零依赖，复用 `@/* -> src/*` alias）：

```bash
npm run deps:audit   # 报告越层 import、app feature deep import 与循环依赖
npm run deps:check    # CI 阻断门（当前 cycles/deep-import baseline 均为空）
```

该脚本编码 §1 的方向（core 禁 React/越层、features 禁互相 import、shared/store/lib 禁向上、types 为 leaf），也会拦截非 `.cjs` 产品源中可绕过 ESM 图的 `require()`。§3 的存量例外只按精确 importer/specifier/target allowlist。`app` 对 feature 子路径的 deep import 和 import cycle 新增或 baseline stale 都会让 `--check` 失败；当前两个 baseline 清单均为空。`npm run lint` 已串联 `deps:check`。下列 `rg` 命令仅作快速人工排查备用：

```bash
# 检查潜在反向依赖（core/shared/store 对 features 的引用）
rg -n "from ['\"]@/features/" src/core src/shared src/store

# 检查 feature 间直接耦合
rg -n "from ['\"]@/features/" src/features

# 检查 shared 对 store 的依赖
rg -n "from ['\"]@/store/" src/shared

# 检查硬编码色值
rg -n "#[0-9A-Fa-f]{3,8}" src

# 检查 #0088FF 使用范围
rg -n "#0088FF|#0088ff" src | rg -v "Slider.tsx|styles/index.css"
```

## 13. 规模门禁与豁免（Size Budgets & Exemptions）

单文件/函数长度、圈复杂度、参数数、嵌套深度由 `scripts/tools/google_style_audit.mjs` 的 count-based 规则把关，走 `google_style_baseline.json` ratchet（存量 grandfather、仅净新增违规 fail；`file-name-snake-case` 已 retired，只报告不阻断）。当前阈值：file hard 800、function hard 200、complexity hard 20、params 4、depth 4（均 skipBlank+skipComments，仅作用 `src/**`，对 `**/*.test.*` / `**/*.spec.*` / `scripts/**` 关闭）。`css-declaration-order` 当前 baseline 为 0，新增乱序会阻断。原则：**多数超长解析器/数值求解器是真实领域内聚，禁止为凑行数硬拆**；只对存在"可干净抽离附带膨胀"的文件做定向重构。

以下文件/目录**有意豁免**所有 JS/TS 行长与复杂度门禁，不计入上述预算：

- **手写 C-ABI emscripten 源**：`src/core/loaders/wasm/collada_mesh_parser.cpp`、`src/core/loaders/wasm/obj_parser.cpp`。它们是**单翻译单元（single TU）**设计——单 `.cpp` + `-flto` + 匿名 `namespace` 内部链接，所有 helper 文件本地。拆成多 TU/头文件**运行时零收益、只增 header 边界摩擦**，故有意保留单文件；要可读性用 section banner 注释而非物理拆分。注意：构建是 **C-ABI `EXPORTED_FUNCTIONS`** 模式（手动 `HEAPU8` marshalling via `*_get_result_ptr` / `*_get_result_size`），**不是 embind**（无 `emscripten/bind.h` / `EMSCRIPTEN_BINDINGS` / `--bind`）。.cpp 风格由 `.clang-format` 固定。
- **生成产物**：`public/wasm/**`（emscripten JS glue + `.wasm` 二进制，由 `scripts/build/rebuild-*-wasm.sh` 生成，**勿手改**，改 `.cpp` 重跑脚本）、`**/*.generated.*`（ESLint 与 audit 一致跳过）。
- **vendored 源**：`third_party/**`（魔改版 OpenUSD）、`src/features/urdf-viewer/runtime/**`（USD WASM runtime）。
