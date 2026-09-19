# Assembly 单一主体端到端重构记录

> 状态：实施与验证完成 | 最后更新：2026-07-10
> 交叉引用：[architecture.md](architecture.md)、[file-io.md](file-io.md)、[viewer.md](viewer.md)、[testing.md](testing.md)

> 本文是已完成重构的历史记录，仅供查阅设计背景，不作为当前待办；现行约束以 CLAUDE.md 和上述专题文档为准。

## 1. 目标

- 以 `AssemblyState` 作为应用唯一可写的机器人领域模型；source library、资源 registry 和可重建 cache 不得成为第二份机器人拓扑状态。
- 单机器人固定表示为 `1 component + 0 bridges`；多机器人只增加 component 和 bridge，不切换数据模型。
- `RobotData` 继续服务解析器、renderer、导出器和 `react-robot-canvas`，但只能由 component 或 Assembly projection 产生，不再作为 store 中第二份可写状态。
- 单组件保持简洁界面；direct source renderer 只是一项性能策略，不得改变 selection、mutation、history 或 source sync 的路由。
- 采用一次性硬切换：只支持新 canonical workspace/project schema，不迁移旧 `.usp`、旧双主状态或旧双 history。

## 2. 非目标

- 不读取、升级或修复旧 `.usp` 项目。
- 不保留 v2 migration、raw/prefixed 混合 component normalizer 或旧 history 交织逻辑。
- 不为旧调用方保留 deprecated `robot` / `assembly` project 字段或临时双写 API。
- 不保证升级前已打开 session 经 HMR 后继续可用；刷新后从新默认 workspace 或重新导入源文件开始。
- 不改变外部 `RobotCanvas` 的 `RobotData` API。

## 3. 核心模型与接口

### 3.1 Workspace store

- 将现有 store 原地收敛并重命名为 `useWorkspaceStore`。
- store 持有：
  - 非空 `workspace: AssemblyState`
  - 单一 workspace `history`
  - 单一 `activity`
  - 瞬时 `activeComponentId`
- 删除：
  - 可写的顶层 `name`、`links`、`joints`、`components` 镜像
  - `assemblyState: null` 分支
  - robot history 与 assembly history 双轨
  - topology pending history 与 assembly pending history 双协调器
- 初始空白项目创建一个无源文件的默认 component。
- `AssemblyComponent.sourceFile` 允许为 `null`；规范化后 `transform` 和 `visible` 必填。

### 3.2 ID 与实体引用

- `AssemblyComponent.robot` 只保存 source-local ID。
- `EntityRef` 使用 discriminated union，不用一个可选字段对象兼容所有类型：
  - `{ type: 'assembly' }`
  - `{ type: 'component'; componentId }`
  - `{ type: 'bridge'; bridgeId }`
  - `{ type: 'link' | 'joint' | 'tendon'; componentId; entityId }`
- `${componentId}_${entityId}` 只允许出现在合并、渲染和导出 projection 中。
- component、bridge 和 source-local entity ID 在各自声明域内必须稳定且唯一。
- projection 必须提供 `globalToEntityRef` 与 `entityRefKeyToGlobal` 双向映射；`entityRefKey` 由统一 helper 编码，禁止通过截取字符串前缀猜 owner。
- 新增统一 `EntityRef` 与 `WorkspaceSelection`，覆盖：
  - assembly
  - component
  - bridge
  - link
  - joint
  - tendon
- 用一个 selection store 替代 robot/assembly 两套 selection。
- selection、hover、focus 和 pulse target 全部使用 `EntityRef`；实体失效时通过同一个 repair helper 清理或回退。

### 3.3 Mutation API

- component CRUD 必须显式携带目标，例如：
  - `updateLink(ref, patch)`
  - `updateJoint(ref, patch)`
  - `addChild({ componentId, parentLinkId })`
  - `replaceComponentRobot(componentId, robot)`
- link、joint、拓扑、几何、惯量、材质、collision、IK、tendon 和 joint motion 全部写回目标 component。
- bridge 与 Assembly transform 继续通过 Assembly actions 修改。
- 高频 joint motion 只更新 pending workspace；在 pointer-up 或 flush 时提交一个 history entry。
- component 显示名称、`component.robot.name` 和 Assembly 名称是三个独立概念；重命名 component 不修改源码实体名。
- mutation 必须维持 workspace 不变量：
  - 删除最后一个 component 时原子创建默认无源 component
  - 删除 component 或 link 时，同一 transaction 内级联删除失效 bridge
  - `replaceComponentRobot` 同一 transaction 内清理端点已失效的 bridge
  - selection 指向失效实体时回退到所在 component；component 已删除时回退到新的 active component
  - `activeComponentId` 保留有效值，否则稳定回退到 components 插入顺序中的第一个 ID

### 3.4 Source 与 cache ownership

- `AssemblyComponent.sourceFile: string | null` 只引用 source library 中的模板文件，不承载共享可写 RobotData。
- source library 保存导入的模板文本和资源；普通 component mutation 不回写模板。
- `component.robot` 永远是该实例的语义权威；source template 和 draft 都不能反向覆盖它，只有显式源码全文 apply 在 parse/validate 成功后才能替换 target component 的 robot。
- 每个 component 的派生 source draft 以 `ComponentSourceDraft { componentId, format, content, robotSnapshotHash }` 隔离保存；它是按 component robot revision 生成的 document cache，不进入 workspace history 或 dirty 比较。
- 结构化 mutation 后，若 format-specific patch 能基于新 robot snapshot 完整产生 draft，则更新该 target draft/hash；否则立即使旧 draft 失效并异步重建，绝不把旧 draft 当作当前源码。
- 源码全文 apply 成功时，从同一输入同时得到新 `robot` 和与其 hash 匹配的 target draft；失败时二者都不修改。
- source-preserving export 只使用 hash 与当前 component robot 匹配的 draft；draft 缺失或 stale 时从 component/projection 重新生成，生成失败必须明确报错，禁止退回旧 source。
- `.usp` 可把有效的 component drafts 作为 derived document entries 保存；stale draft 不写入 archive，导入后仍以 workspace robot 为权威。
- 显式编辑 library file 是独立文档操作；其 dirty 状态与 workspace dirty 分开命名，但不得镜像 robot topology。
- USD prepared export cache 是按 source/content hash 生成的只读派生缓存：
  - 不是 mutation target
  - 不进入 workspace history 或 dirty 比较
  - 可选写入 `.usp` 只用于性能，缺失或失效时可重建
  - cache 中的 `RobotData` 只能由 component snapshot/projection 生成，不能反向覆盖 workspace

### 3.5 Scene projection

- 新增只读 `AssemblySceneProjection`，统一输出：
  - direct/merged `RobotData`
  - `renderStrategy: 'direct-component' | 'assembled-scene'`
  - global ID 双向映射
  - component root target
  - selection/transform control 所需的 canonical target
- projection 是 renderer、点击命中、transform controls 和导出的共同边界，不保存回 store。

### 3.6 Project API 与 archive

- 新 project schema 固定为 `version: '3.0'`，在任何 import/export 切流前先落类型和 validator。
- canonical payload 为：
  - `workspace/state.json`: 当前非空 `AssemblyState`
  - `history/workspace.json`: `{ past: AssemblyState[]; future: AssemblyState[]; activity: WorkspaceActivityEntry[] }`
  - `assets/manifest.json` 与现有 source/library/mesh archive entries
  - 可选的 USD derived cache manifest/entries
  - `manifest.json`: 只保存 `version`、项目 metadata 和上述 entry 路径
- `ExportProjectParams` 的 domain payload 固定为 `{ workspace, workspaceHistory, assets, derivedCaches? }`（项目名、语言和 progress callback 是输出元数据）；`ProjectImportResult` 返回同一 canonical shape 加 manifest/warnings。
- 直接删除旧 `robot`、`robotHistory`、`assembly`、`assemblyHistory` 等双主字段，不标记 deprecated、不提供兼容投影。
- `activeComponentId`、selection、hover、focus、preview、panel 和 renderer strategy 都是 session state，不进入 history 或 archive；workspace 变化后只做有效性修复。
- `.usp` 只写入 3.0 schema；导入时先在 store 外完整解包、校验并构造结果，再以一个 transaction 替换当前 workspace。损坏或版本不匹配直接失败，不得部分修改当前 workspace。
- 不实现旧 `.usp` migration，不为旧 archive 建 fixture 或回归矩阵。

### 3.7 Workspace transaction

- 所有写操作统一经过 `beginWorkspaceTransaction` / `commitWorkspaceTransaction` / `cancelWorkspaceTransaction`（具体实现可为 store 内部 helper，不要求暴露 manager 对象）。
- 同步 CRUD、bridge cascade 和 transform：从同一 before snapshot 计算、校验并提交一个 history entry；no-op 与失败操作不写 history/activity/dirty。
- 连续 joint/transform gesture：begin 后允许更新 pending workspace；pointer-up/flush 时提交一次，cancel 时恢复 before snapshot。
- 源码全文 apply：在 store 外 parse/validate，成功后一次提交 robot + component draft；失败不修改 store。
- 普通文件 open/Add：在 store 外完成 parse/validate，成功后一次 replace/append。
- USD open/Add：创建只存在于 transaction draft 的目标 component，hydration 成功后一次提交；失败或取消恢复 before snapshot，不留下空壳或 history。
- 每个异步 transaction 携带 `{ operationId, baseWorkspaceRevision, componentId }`；新 open、删除目标 component 或显式 cancel 会使旧 token 失效，晚到结果直接丢弃并释放资源。
- pending USD import/hydration 期间，除 cancel 和新的 replace/open 外，property/CRUD/transform/undo/redo/Add 等 workspace mutation 全部被拒绝并提供可观察的 busy 状态；新的 replace/open 先 cancel 旧 transaction。这样不允许普通 mutation 改变 `baseWorkspaceRevision` 后与 hydration 交错提交。
- undo/redo、project import 和新的离散 mutation 开始前必须 flush 当前 gesture；异步 transaction 不允许与其他 transaction 交错提交。

## 4. 实施阶段

### 阶段 1：锁定新不变量

- 为单组件和多组件现有行为补 characterization tests，覆盖 mutation 次数、history 粒度、selection 和 source-preserving export。
- 先定义 `.usp` 3.0 manifest、canonical project payload 与 strict validator，之后所有 project 测试只生成 3.0 fixture。
- 新增 canonical workspace constructor/validator：
  - workspace 非空
  - 至少一个 component
  - source-local entity ID
  - component `transform` / `visible` 完整
  - bridge 引用有效 component/entity
- 普通机器人文件导入在边界生成 canonical 单组件数据。
- project archive 只接受当前 schema；不接入兼容 normalizer。

### 阶段 2：Store 单真源

- 原地将现有 Zustand store 改为 `useWorkspaceStore`，避免长期并存第二个 store。
- 把所有 robot mutation 改成显式 component target，并统一写入 `workspace`。
- 合并 topology/assembly pending history、undo/redo、dirty baseline 和 activity。
- 引入统一 workspace transaction helper，并先覆盖同步 CRUD、gesture、source apply 与异步 import/hydration 的提交/取消语义。
- 保持 joint motion 的单次提交语义。
- 删除顶层 RobotData 镜像、seed component 双写和 `assemblyState: null` 分支。

### 阶段 3：Selection、Tree 与 PropertyEditor

- 用 `WorkspaceSelection` 替换 robot/assembly selection。
- Tree 永远消费 Assembly：
  - 单组件隐藏 Assembly/Bridges 冗余层并默认展开唯一 component
  - 多组件显示完整 Assembly、Components 和 Bridges 层级
- PropertyEditor 直接通过 selection 定位 component entity 或 bridge。
- bridge 不再伪装成 joint；更新目标不再通过扫描或解析 ID 决定。
- 单组件增加为多组件时保留仍然有效的 canonical selection 和 active component。

### 阶段 4：Viewer 单一路由

- 单个可见 component 且无 bridge 时使用 `direct-component`；其 Assembly/component transform 由统一 root wrapper 应用。
- 其他情况使用 `assembled-scene`。
- 两种策略共享 projection mapping、selection、mutation、hover、focus、transform controls 和 joint motion。
- 删除业务路由与镜像逻辑：
  - `shouldRenderAssembly`
  - `entityUpdateScope`
  - source-scene 专用 transform fallback
  - `sourceSceneSeedSync`
- render strategy 切换只替换渲染输入，不得修改 canonical workspace snapshot。

### 阶段 5：Import、source sync 与 export

- 直接打开 URDF、MJCF、SDF、Xacro 或 USD 时，原子替换为单组件 Assembly。
- preview 不修改 workspace；“添加到工作空间”只追加 component。
- USD 在 pending transaction draft 中先创建目标 component；hydration 只允许通过匹配的 operation token 写回，成功后整体提交。
- source document change target 必须携带 `componentId`。
- 同一 source 被多个实例引用时保留模板不自动覆盖，只更新目标实例的派生草稿。
- 当前导出始终从 Assembly 解析：
  - 单组件保持原格式和源名称
  - 带 transform 的单组件通过统一 projection 导出
  - 多组件使用 merged projection
  - 断联 URDF 继续使用现有 bundle 流程
  - library file 保持独立导出
- robot parser 的 `RobotData` 结果立即包装为 canonical workspace；不存在 assembly-only/robot-only project 兼容分支。

### 阶段 6：Project archive 切流与遗留删除

- 按阶段 1 固定的 `.usp` 3.0 schema 更新 worker payload、import/export API 和测试 fixture，只保存 canonical `workspace/workspaceHistory`。
- 删除：
  - v2 schema 与 migration
  - raw/prefixed 混合 ID normalizer
  - robot/assembly 双 history 与双 dirty baseline
  - single-component reuse mutation 特例
  - 临时兼容字段、兼容 selector、兼容 action
  - seed component 与顶层 RobotData 同步逻辑
- 全仓检查不再存在根据 `assemblyState === null`、renderer strategy 或 ID 字符串格式选择业务 mutation 路由的代码。
- 同步 `CLAUDE.md`、`docs/architecture.md`、`docs/file-io.md`、`docs/viewer.md` 与对外类型说明。

## 5. 测试计划

### 5.1 Import 与 workspace

- URDF、MJCF、SDF、Xacro、USD 直接打开后均为一个 component。
- 打开新文件原子替换整个 workspace；preview 不修改；Add 追加 component。
- 同一 source 可添加多个实例，实例 mutation 与派生草稿互相隔离。
- USD hydration 只更新 operation token 绑定的目标 component；重新 open、删除目标、失败和晚到 completion 均不得污染新 workspace。
- USD pending 期间普通 workspace mutation 必须被 busy guard 拒绝；cancel 或新 open 后旧 hydration completion 必须失效。

### 5.2 Mutation 与 history

- 同一组 link/joint/topology/material/inertial/collision/IK/tendon 操作在单组件和多组件场景调用同一 action。
- mutation 必须显式携带 component target，且一次用户操作只生成一个 workspace history entry。
- joint drag 在 pointer-up/flush 前不提交重复 history。
- undo/redo 同时恢复 workspace topology、component data、bridge 和 transform。
- 删除 component/link 与替换 robot 时，bridge cascade、selection repair 和 active component repair 必须与主体 mutation 同一次提交。
- source apply、普通 import 和 USD hydration 分别验证 success/failed/cancel/no-op 的 history 与 dirty 边界。
- 结构化 mutation 验证 draft patch/hash 同步或 stale invalidation；export 永远不读取 hash 不匹配的 draft。

### 5.3 Selection、Tree 与 PropertyEditor

- direct-component 与 assembled-scene 的点击产生相同 canonical selection。
- 从一个 component 增加到两个时，不丢失有效 selection、编辑状态、transform 或 viewer 状态。
- Tree 验证单组件折叠呈现、多组件和 Bridges 展开呈现。
- PropertyEditor 验证 component、bridge、link、joint、tendon 各自正确定位和更新。

### 5.4 Viewer 与 source sync

- 验证 source property patch、源码全文 apply 和共享 source 实例隔离。
- 验证 Assembly/component transform 在两种 renderer strategy 下一致。
- 验证 strategy 切换前后 canonical workspace snapshot 完全相同。
- 验证 projection global ID 双向映射，不允许 owner 推断 fallback。

### 5.5 Export 与 project archive

- 验证五种格式的单组件 source-preserving export、带 transform 单组件、多组件 bridge/闭环、断联 bundle 和 library-file 独立导出。
- 验证 `.usp` 3.0 的 single/multi roundtrip、workspace history、assets 和可选 USD derived cache。
- 验证 `activeComponentId` 与所有 selection/session state 不进入 archive，导入后按有效 workspace 决定默认值。
- 验证损坏或非 3.0 schema 的 project archive fail fast，且当前 workspace 不发生部分更新。
- 不执行任何旧 `.usp`、v2 migration 或旧双 history 回归测试。

### 5.6 验证命令

按阶段运行邻近单测，最终完整执行：

```bash
npm run test:unit:app-hooks
npm test
npm run test:unit:all
npm run typecheck
npm run typecheck:quality
npm run lint
npm run build
```

最后至少运行以下单机器人、多机器人与跨格式浏览器回归：

```bash
npm run test:browser:urdf-tree-crud
npm run test:browser:urdf-property-editor
npm run test:browser:urdf-source-editor
npm run test:browser:urdf-assembly
npm run test:browser:cross-format-assembly
npm run test:browser:assembly-export
```

浏览器验证结束后必须执行：

```bash
node test/usd-viewer/scripts/cleanup-headless.cjs
```

## 6. 完成标准

- Zustand 中只有一个可写 workspace model 和一条 history timeline。
- 所有业务 mutation 都通过 canonical target 更新 component 或 Assembly。
- selection、Tree、PropertyEditor 和 viewer 不再区分“robot 模式”与“assembly 模式”。
- renderer strategy 不参与业务状态路由。
- store 中不存在 projection RobotData、global prefixed ID 或 source scene seed 镜像。
- project archive/API 中不存在旧双主字段、migration 或兼容分支。
- 全量类型检查、lint、单测、构建与浏览器回归通过，并清理 headless 进程。

## 7. 并行实施与审查

- 子代理按互不重叠的文件面并行：canonical types/store、selection/UI、projection/viewer、import/export；共享接口由主线程先定稿。
- 每批子代理修改由主线程检查 `git diff`、运行邻近测试并解决交叉依赖，不直接接受未经验证的批量改动。
- React 改动遵守细粒度 Zustand selector、稳定 callback/dependency 和避免重复派生 state 的约束。
- 全部阶段完成后，使用独立 code-review 子代理检查 correctness、状态所有权、异步竞态、性能、资源释放和测试缺口。
- 所有 CRITICAL/HIGH review findings 必须修复并重新验证；没有阻断 finding 后才算完成。

## 8. 完成记录

- canonical workspace、统一 history/activity、`EntityRef` selection、Tree、PropertyEditor、viewer projection、import/source/export 与 `.usp` 3.0 已完成硬切流。
- 旧 robot/assembly 双 store、双 history、兼容 normalizer、v2 migration 与 deprecated project payload 已删除；项目导入只接受严格的 3.0 canonical schema。
- 完整单测：3599 项，3597 通过、2 跳过、0 失败；app hooks 34/34、fast suite 40/40。
- `typecheck`、`typecheck:quality`、ESLint、Stylelint、Google style、dependency boundaries 与 production build 全部通过。
- 单组件、多组件、跨格式、bridge/export、深层三组件、Joint Pick、transform gizmo 与 MJCF property browser regression 共 270 项断言通过；验证结束后已执行 headless cleanup。
