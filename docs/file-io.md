# 导入导出与 Workspace 链路

> 最后更新：2026-09-07 | 覆盖源码：`src/app/hooks/`、`src/app/hooks/file-export/`、`src/app/hooks/workspace-source-sync/`、`src/app/hooks/workspace-mutations/`、`src/app/utils/`、`src/app/workers/`、`src/app/components/BotWorldImportOverlay.tsx`、`src/core/parsers/format_detection.ts`、`src/core/robot/assemblySceneProjection.ts`、`src/features/file-io/`、`src/features/robot-tree/`、`src/features/assembly/`、`src/features/property-editor/`、`src/shared/utils/popupHandoffProtocol.ts`、`src/shared/hostIntegrationState.ts`
> 交叉引用：[viewer.md](viewer.md)、[architecture.md](architecture.md)

## 1. 职责拆分

| 层级 | 职责 | 入口 |
|------|------|------|
| `core/parsers/format_detection.ts` | 机器人源文件格式检测 canonical source（URDF / MJCF / SDF / USD / Xacro） | `detectRobotDefinitionFormat`、`isRobotDefinitionPath` |
| `features/file-io/` | 底层文件能力：BOM、project import/export、archive/asset registry、USD/SDF export、ExportDialog/ExportProgressDialog、snapshot/pdf hooks、导入导出 worker bridge；格式检测只 wrap core 并补充 asset/motor 判断 | `src/features/file-io/index.ts` |
| `app/hooks/useFileImport.ts` | 应用级导入工作流（source of truth） | — |
| `app/hooks/useFileExport.ts` | 应用级导出工作流（source of truth） | — |
| `app/hooks/file-export/*` | 导出 workflow 子模块 helper | `canonicalExportContext.ts`、`progress.ts`、`projectExport.ts`、`usdExport.ts` |
| `app/hooks/workspace-source-sync/*` | component source snapshot、文件预览与格式相关 viewer policy；不持有 workspace 镜像 | `robot_source_snapshot.ts`、`useWorkspaceFilePreview.ts`、`mjcfViewerRuntimePolicy.ts` |
| `app/hooks/workspace-mutations/*` | workspace 变更操作拆分 | 组件、bridge、source file 相关 mutation |
| `features/robot-tree/` | canonical Assembly 文件树、树编辑器、上下文菜单 | `TreeEditor.tsx`、`AssemblyTreeView.tsx`、`tree-editor/*` |
| `features/assembly/` | 桥接组件创建与组装入口 | — |
| `features/property-editor/` | 属性编辑、几何编辑、碰撞优化 | `geometry-conversion/*`、`workers/*` |

## 2. 当前工作流事实

- `features/file-io/hooks/useFileExport.ts` 已移除，应用导出 source of truth 在 `app/hooks/useFileExport.ts`
- 应用导入 source of truth 在 `app/hooks/useFileImport.ts`，不要在 `features/file-io` 恢复旧导入 hook
- `useWorkspaceStore.workspace`（非空 `AssemblyState`）是唯一可变机器人模型；`RobotData` 只由 component 或只读 scene projection 产生
- 空白项目也是 `1 component + 0 bridges`；直接打开文件原子替换 workspace，显式“添加”只追加 component
- `.usp` 只接受并生成严格的 `3.0` manifest，project payload 只保存 canonical workspace、统一 history 和 component source drafts；不提供 v2 或旧 robot/assembly 字段迁移
- component 内实体 ID 始终是 source-local；全局 ID 只在 scene/export projection 中生成，并通过显式双向映射解析
- 机器人源格式检测 source of truth 在 `core/parsers/format_detection.ts`；`app/utils/import-preparation/formatDetection.ts` 与 `features/file-io/utils/formatDetection.ts` 只做 wrapper
- 新增导出辅助逻辑时，优先补到 `app/hooks/file-export/*`，不要把 `useFileExport.ts` 堆成大而全单文件
- component mutation 放到 `workspace-mutations/*` 并显式携带 `EntityRef`/`componentId`；`workspaceSourceSyncUtils.ts` 仅保留从 canonical workspace 生成 source/preview 的纯函数
- 导入是**尽力而为**而不是全有或全无：`core/robot/importedRobotRecovery.ts` 负责把解析结果修成可表达的模型（丢弃自环 / 重复父关节 / 成环关节，必要时重挂 root），
  `core/robot/canonicalRobotSalvage.ts` 在 canonical 校验仍失败时按 issue 归属丢弃 link/joint/material 后重试；只有连一个可显示的 link 都不剩才返回 `parse_failed`。
  URDF / Xacro / MJCF / SDF 的解析阶段也按实体边界跳过损坏的 link、joint、body、model 或 include/attach 分支；XML 结构本身损坏、根标签无效或没有任何可显示实体仍然失败，不做猜测式 XML 修复。
  被丢弃的内容通过 `inspectionContext.recovery` 上报，主导入、文件预览、添加组件和源码应用入口都提示恢复数量，不允许静默地把残缺模型当成完整模型
- URDF `<limit>` 只对 revolute / prismatic 必需；`continuous`（轮子、被动转动关节）缺 `<limit>` 不产生诊断，也不合成上下限位
- `.usp 3.0` project import/export、USD prepared export cache、live USD roundtrip archive 已进入主工作流
- `projectArchive.worker.ts`、`usdExport.worker.ts`、`usdBinaryArchive.worker.ts` 已进入主导出链路；大型归档或序列化任务优先走 worker/transfer
- `projectImport.worker.ts` 已进入 project import 链路；问题优先在 worker/bridge 修
- `DisconnectedWorkspaceUrdfExportDialog.tsx` 是 workspace 断联导出特例，不要塞回通用导出弹层
- `ExportProgressDialog.tsx` / `ExportProgressView.tsx` 是长时导出反馈的统一 UI，不要重新发明导出进度弹层

### 闭环拼接

- 同组件的不同连杆、或已有连接路径的组件之间可创建闭环。闭环保存在 workspace 中；fixed 保留完整相对朝向，revolute / continuous / prismatic 按各自轴向、自由度与限位求解。被动关节影响的相连闭环必须一起求解。
- 闭环的两个局部锚点定义位置；`origin.rpy` / `quatXyzw` 定义 B 相对 A 的零位朝向，axis 位于 A 乘零位旋转的关节坐标系。`origin.xyz` 不能再次叠加到 anchor A。
- `.usp` 保存完整桥接数据。SDF 用原生关节及 `urdf_studio:closed_loop` 扩展保留锚点与零位，回导闭环不改变结构树或几何；USD 使用原生物理关节帧和闭环元数据保留相同语义，包括 fixed、非主轴与负轴。
- MJCF 的 fixed 闭环使用原生 `weld` 并支持回导；尚未实现等效编码的旋转、连续和滑动闭环在显式导出时拒绝有损转换，并建议 SDF / USD。内部源码自动选择能保留这些闭环的 SDF，不把它们静默改成 `connect`。
- 创建、编辑、撤销重做和保存项目不提示导出格式限制。URDF / Xacro 的闭环省略提示仅在实际导出后出现，编辑器内闭环保留。

## 3. App 编排层

### 关键组件

- `App.tsx`：根组件，装配 Providers、懒加载模态框、全局导入导出入口、debug bridge
- `AppLayout.tsx`：应用壳、Header、TreeEditor、PropertyEditor、UnifiedViewer 主编排
- `AppExtensionConfig.contextFileMenu`：替代工作区 surface 的 host-owned 文件动作注入；
  Core 只呈现菜单，不接管 host 的文件 workflow
- `UnifiedViewer.tsx`：组合 Editor 两个子域场景，统一 selection/hover/preview/tool mode
- `WorkspaceCanvas.tsx`：应用层 re-export；底层 runtime 在 `shared/components/3d/workspace/*`
- `AppLayoutOverlays.tsx` + `utils/overlayLoaders.ts`：懒加载业务浮层
- `SnapshotDialog.tsx`：统一快照导出与预览弹层
- `unified-viewer/*`：统一 viewer 的 scene root、overlay、derived state、mode module loader

### 关键 hooks

- `useAppShellState` / `useAppEffects` / `useAppLayoutEffects` / `useAppState`：App shell 与 layout 编排
- `useViewerOrchestration`：selection / hover / pulse / focus / transform pending 协调
- `useFileImport` / `useFileExport`：导入导出编排入口
- `useWorkspaceMutations` / `useLibraryFileActions`：显式目标的 workspace mutation 与 library 工作流
- `workspace-source-sync/robot_source_snapshot.ts` / `useWorkspaceFilePreview.ts`：component source snapshot 与只读文件预览
- `useWorkspaceModeTransitions` / `useWorkspaceOverlayActions`：workspace 视图切换与浮层动作
- `usePreparedUsdViewerAssets`：USD viewer 资产准备；可编辑结构数据始终来自 workspace projection
- `useImportInputBinding`：App 级文件输入绑定
- `useEditableSourcePatches` / `useUnsavedChangesPrompt`：源码 patch 与离开保护
- 导出格式限制只在显式导出工作流提示，不能作为编辑、源码派生或 AI 修改的模型校验。ball 模型的内部源码优先保留 MJCF；`tryGenerateEditableRobotSource` 在未选 mesh 等中间态无法生成源码时保留 canonical 模型和已有草稿，生成视图暂不可编辑。`canPreserveJointTypesInSource` 阻止内部生成器静默改变关节类型；`.usp` 以 canonical workspace 与原始资产为准，各附带格式独立生成。可选 MJCF 仅在关节可保留、mesh 可原样使用且无需额外资源转换时附带；需 Collada/GLTF 转换、材质拆分或额外纹理/MTL 等资源准备时跳过 MJCF，仍保留可生成的 URDF/BOM。项目保存复用已打包的资产字节，不因附带产物再次加载或转换 mesh；实际格式导出继续执行完整资源准备与兼容性提示。
- URDF/Xacro/MJCF/SDF 四种源码 reconciler 统一通过 `tryGenerateEditableRobotSource` 保护可选派生，不能把导出异常透传到编辑界面。MJCF/SDF 生成器默认内部序列化不输出 console 导出诊断；显式 configured/library 导出通过 `onWarning` 收集并返回 `warnings`。App 在成功导出后统一将非阻塞 `warnings` / `issues` 去重写入控制台，不弹 toast；真正导出失败与需要用户选择的导出操作保留界面反馈。
- `canPreserveGeometryInSource` 同时保护主/附加 visual 和 collision：不能把格式导出的包围盒、空几何或忽略几何等近似结果写成当前模型的源码。源码同步、AI 对比与 `.usp` 可选产物共用该检查；AI 对比只复用语义 hash 匹配的源码草稿。局部源码 patch 失败由同步协调器恢复，仅记录控制台信息。
- URDF / Xacro / MJCF / SDF 编辑源码通过 `generateEditableRobotSource` 启用 `preserveNumericPrecision`，数值按可恢复 JavaScript `number` 的十进制写入；限位、惯量、几何、颜色、tendon 等局部 patch 同样避免小数位截断。应用的文件、项目、组件和骨架导出也保留数值精度；独立 generator 默认格式化保持兼容。连续编辑仍校验源码与模型的一致性：MJCF 四元数/RPY 与 degree 限位仅接受精确值或确定的序列化往返结果，SDF 保留源版本并处理旧版世界坐标表示；真实的过期值和不可表示变更继续拒绝。可恢复的源码回退只记录 `console.info`。
- USD 文本保留数值有效位，颜色不再吸附到邻近灰色或 0/1；几何哈希只定位候选，去重还必须精确比较顶点、索引、法线与 UV。微小差异不能作为重复材质或网格合并；transform、动力学和 root 惯量也不能因 epsilon 判断被省略。目标格式的 float 类型和网格已有 Float32 精度限制仍然适用。
- `useCollisionOptimizationWorkflow`：碰撞优化 UI 流程
- `usePendingHistoryCoordinator`：pending history 生命周期协调
- `useToolItems`：工具箱注册表（新增工具唯一需要改的文件）
- `usePluginLaunch`：读取 `?plugin=<key>` URL 参数并调用 `openTool(key)` 激活插件工具，参数消费后从 URL 移除

### app/utils/ 重点

- USD/roundtrip/hydration：`usdExportContext.ts`、`usdHydrationPersistence.ts`、`usdStageHydration.ts`
- 导出辅助：`exportArchiveAssets.ts`、`usdBinaryArchive.ts`、`currentUsdExportMode.ts`
- 历史与缓存：`pendingHistory.ts`、`pendingUsdCache.ts`
- 导入准备：`documentLoadFlow.ts`、`importPreparation.ts`、`importPreparationTransfer.ts`
- 导入格式 wrapper：`import-preparation/formatDetection.ts`（委托 core）
- Unified viewer 状态：`unifiedViewer*.ts`、`viewerViewportHandoff.ts`
- Worker payload：`robotImportWorkerPayload.ts`、`usdBinaryArchiveWorkerTransfer.ts`

### app/workers/

- `importPreparation.worker.ts`
- `robotImport.worker.ts`
- `usdBinaryArchive.worker.ts`

### 约束

- 逻辑横跨多个 store / feature / viewer 状态时优先放 `app`
- 单一 feature 内闭环逻辑不要硬塞 `app`
- `app` deep import feature 内部 `utils/*` 是历史遗留；新增长期编排能力优先通过 feature `index.ts` 或 facade 暴露稳定入口

## 4. 多 URDF 组装

- 每个组件保存 source-local Link / Joint / Tendon ID；不同组件通过 `{ componentId, entityId }` 消歧
- 组件之间通过 `BridgeJoint` 连接
- `core/robot/assemblySceneProjection.ts` 和 `assemblyScenePlacement.ts` 生成 direct/assembled 渲染投影、全局 ID 映射和 root placement；导出合并由同一 canonical workspace 派生
- `${componentId}_${entityId}` 形式只存在于 projection，禁止截字符串前缀猜 owner
- 改动组装功能时重点检查：显式映射冲突、BridgeJoint 合法性、合并导出一致性、direct/assembled 策略切换前后 canonical snapshot 不变

## 5. Workspace 交互

- Tree 永远消费 Assembly；单组件时隐藏 Assembly/Bridges 冗余层并默认展开唯一 component
- 文件加入组装入口：右键菜单"添加"、文件行右侧绿色按钮
- 单击机器人文件原子替换为单组件 workspace；显式"添加"才追加，允许同一 source 多实例
- PropertyEditor 按统一 `WorkspaceSelection` 直接定位 component entity 或 bridge，不把 bridge 伪装成 joint

## 6. 跨域 Handoff 接收端

上游资产图库 → URDF Studio 的跨域资产传递接收端，不可删除。开源 Core 只实现通用接收
infra（URL 参数解析、BroadcastChannel 已有-tab 认领、并发下载与上限校验、导入编排）；
上游专属的鉴权凭据与下载端点通过注入 facade 由宿主壳（pro）提供，Core 不读
`import.meta.env` 的服务凭据。下方 `BOT-World` / `BotWorld*` 等命名仅沿用代码中的
常量/组件名，不绑定具体产品。

### 路径 A — assetId 直传（主路径）

```text
上游图库构造 URL ?import=<assetId>&from=<gallery_origin> → window.open 新标签页
  → useAssetImportFromUrl 检测 URL 参数，立即消费（从 URL 移除）
  → BroadcastChannel 广播 import-request（等待 1s）
    → 已有 Studio tab 回复 import-accepted → 新 tab 关闭 → 已有 tab 执行导入
    → 无已有 tab 回复 → 当前 tab 执行导入
  → Studio 验证 from origin 白名单 → 解析资产下载端点
  → POST 资产下载接口（携带宿主注入的 Bearer 服务令牌）→ 获取文件列表（含预签名下载 URL）
  → worker pool 并行下载预签名 URL → 设置 webkitRelativePath 保持文件夹结构
  → handleImport(files) 导入到编辑器
```

- 发送端图库按资产分类确定目标 Studio（发送端逻辑不在本仓）
- Studio 验证 `from` origin 白名单后获取文件列表（含预签名下载 URL）；Core 默认请求该
  handoff origin，宿主可通过 `setAssetDownloadEndpointResolver` 显式改为自己的同源代理
- 资产下载请求的 `Authorization: Bearer <token>` 由宿主通过 `setAssetDownloadAuthTokenProvider`
  在调用时注入服务令牌（上游服务的静态 service token）；未注册 provider 时不带 `Authorization`
  （BYOK / 本地未鉴权开发）。token 在调用时读取，开源 Core 不读 `import.meta.env`，不把
  `VITE_*` 服务凭据编进浏览器资产
- 并行下载由 `REMOTE_IMPORT_DOWNLOAD_CONCURRENCY`（8）限流的 worker pool 调度，不用
  `Promise.all(files.map(...))` 一次性发起全部请求（资产最多含 2000 文件，避免压垮浏览器与
  对象存储）；按原始 index 写回 `downloadedFiles`，保证 `webkitRelativePath` 顺序与文件列表一致
- 大小上限三道校验：`MAX_REMOTE_IMPORT_FILE_COUNT` = 2000（文件数）、
  `MAX_REMOTE_IMPORT_TOTAL_BYTES` = 512MB（累计）、`MAX_REMOTE_IMPORT_SINGLE_FILE_BYTES`
  = 512MB（单文件）；并行下载下累计字节检查为 best-effort，循环外对总量再做一次确定性兜底
- 进度展示通过 `BotWorldImportOverlay` 独立组件（居中遮罩，不依赖 LoadingHud）

**关键文件：**

| 文件 | 用途 |
|------|------|
| `src/app/hooks/useAssetImportFromUrl.ts` | 核心 hook：URL 参数解析、BroadcastChannel 已有 tab 检测、可注入资产下载端点 + 服务令牌、worker pool 并发下载与上限校验、assetId 导入 |
| `src/app/hooks/assetDownloadEndpoint.ts` | 资产下载端点 resolver 与服务令牌 provider 的 app 层 re-export（实现位于 `src/shared/hostIntegrationState.ts`） |
| `src/app/components/BotWorldImportOverlay.tsx` | 导入进度遮罩 UI（waiting / fetching / downloading / importing） |
| `src/app/hooks/usePluginLaunch.ts` | 插件激活 hook：BroadcastChannel 已有 tab 认领 + `openTool(key)`（见路径 C） |
| `src/shared/utils/popupHandoffProtocol.ts` | 协议常量、origin 白名单（env 驱动 + 通配）、URL 参数 helper、BroadcastChannel 消息类型 |
| `src/shared/hostIntegrationState.ts` | 宿主注入态：资产下载端点 resolver、AI 后端 / 资产下载服务令牌 provider；`src/hostIntegrations.ts` 为其窄 facade |

### 路径 C — 插件激活

```text
上游图库构造 URL ?plugin=<key> → window.open 新标签页
  → usePluginLaunch 检测 URL 参数，立即消费（从 URL 移除）
  → BroadcastChannel 广播 plugin-launch-request（等待 1s）
    → 已有 Studio tab 回复 plugin-launch-accepted → 新 tab 关闭 → 已有 tab 调用 openTool
    → 无已有 tab 回复 → 当前 tab 调用 openTool
```

- `usePluginLaunch`（`src/app/hooks/usePluginLaunch.ts`）：读取 `?plugin=<key>` URL 参数，参数
  消费后从 URL 移除；通过 BroadcastChannel 复用与资产导入相同的「已有 tab 认领」机制
  （`plugin-launch-request` / `plugin-launch-accepted`），无已有 tab 回复时由当前 tab 激活
- 已不再使用 `requestAnimationFrame` 双帧等待；已有 tab 认领成功后 title blink 提示用户切回

### 协议与安全

| 项目 | 值 |
|------|-----|
| BroadcastChannel 名称 | `botworld-handoff`（各端共享，承载 import 与 plugin-launch 两类消息） |
| 消息类型 | `import-request` / `import-accepted` / `plugin-launch-request` / `plugin-launch-accepted` |
| 超时时间 | `HANDOFF_BROADCAST_TIMEOUT_MS = 1000` |
| Origin 校验 | `ALLOWED_HANDOFF_ORIGINS`，由 `VITE_HANDOFF_ORIGINS`（逗号分隔、支持 `*` 通配多级子域）注入，缺省回退到内置生产域名清单；`normalizeHandoffOrigin` 剥离 userinfo/path/port-default，`isAllowedHandoffOrigin` 做通配匹配 |
| 资产下载认证 | 浏览器不携带静态服务凭据；宿主经 `setAssetDownloadAuthTokenProvider` 注入上游服务令牌（Bearer），无 provider 时不带 `Authorization`（避免 `Bearer undefined` 泄漏） |
| 资产下载端点 | Core 默认 `<handoff origin>/api/download-asset`；宿主可经 `setAssetDownloadEndpointResolver` 改为同源 server proxy |

宿主注入入口由窄的 `src/hostIntegrations.ts` facade 导出（实现位于 import-free 的
`src/shared/hostIntegrationState.ts`，使 Pro bootstrap 不加载 app/feature chunk）。resolver
接收已经通过白名单验证并标准化的 handoff origin，返回资产列表请求的 `URL`；传入 `null` 恢复
Core 默认行为。文件列表中的预签名 URL 仍由浏览器直接下载，不经过该 resolver；后端返回的下载
URL 自带凭证且来自已鉴权受信接口，其域名与 API 不同源属预期，**不要**对预签名 URL 加 origin
白名单或严格相等校验（曾因该错误假设导致线上导入报错）。

`VITE_*` 会被编译进公开浏览器资产，因此不得用来承载后端服务令牌。Core 默认 endpoint 只适用于
公开下载接口；后端要求服务认证时，部署方必须通过 `setAssetDownloadAuthTokenProvider` 在宿主层
注入凭据，或在 server/nginx 层注入。

约束：各端（发送端图库与各接收端 Studio）的 `popupHandoffProtocol.ts`
必须保持 origin 白名单、BroadcastChannel 常量与消息类型一致。

## 共用 MJCF 模型转换

`features/file-io/utils/mjcfExport.ts` 提供 `prepareMjcfExport`，统一网格准备和 MJCF XML 生成。
模型导出的 `configuredRobotExport` 保留源格式 overlay、导出选项与 archive/download 编排；
Pro 场景的源资产适配器复用相同函数，再用 `collectMjcfExportFiles` 打包 `meshes/` 与 `textures/`
依赖。缺失依赖必须失败，不能生成引用悬空的模型。场景实例的摆放、仿真覆盖与最终编译属于 Pro。
工程输出、素材库跨格式转换和 MuJoCo 真值回归也使用此入口。源码编辑保留原始惯性占位值，
不在编辑文档时读取网格或写入估算结果；自动补参只作用于导出副本。

模型编辑器的 MJCF 导出通过 `targetFormat: mjcf` 将目标格式传入资源打包 worker，
与场景打包共用 `core/loaders/mjcfExportAssets.ts` 的资源解析及贴图规范化：
精确路径优先，USD 层相对路径仅接受唯一完整后缀，歧义或缺失依赖显式失败；
JPEG 内容误标为 PNG 时生成真实 PNG，不改写源文件。其他格式继续保留原始图片字节。
模型编辑器保留 worker 进度、STL 压缩、源格式 overlay 与用户导出选项。
共用 MJCF 生成器默认保留已有质量/惯性，缺失值使用碰撞几何推算，编译器为
`inertiafromgeom="auto"`、`inertiagrouprange="3 3"`；视觉几何不参与计重。
质量和惯性均缺失时，用可配置密度（默认 1000 kg/m³）让 MuJoCo 估算；只有质量已知时，
保留总质量，按各碰撞体积给 geom 分配 mass，由 MuJoCo 推算惯性。网格体积来自最终转换
网格的凸包，与默认 MJCF mesh 惯性约定一致。已知质量的 OBJ/STL/MSH 和 inline mesh
只在需要补惯性时读取体积；导出不改写源数据。负值或非零错误张量不当作缺失数据吞掉。
运动 body 缺少碰撞几何时明确失败；零体积几何不能用于估算。XML 标注估算部件，
`prepareMjcfExport` 返回 `estimatedLinkNames` 供场景报告使用。

模型导出面板和 Pro 场景属性默认显示自动补齐提示，折叠的“质量设置（高级）”允许调整
估算密度或开启“忽略原参数，重新估算”。此设置独立于固定/可动：固定柜体的内部抽屉也
需要补齐缺失惯性。模型与 USD/URDF/SDF/Xacro 源资产的场景导出共用 `prepareMjcfExport`。
完整原生 MJCF 场景仍保留源物理参数，受原生组合契约约束，不自动重写。

USD 单资产入口 `prepareUsdSourceExportCacheWithWorker` 通过 editor 的 `usd_hydration` facade
公开，使用现有 robot-mode USD worker 和 prepared export cache；显式完整加载调用方已校验的
源文件闭包，避免文本扫描遗漏二进制 USDC 内部依赖。默认 viewer 加载策略不变。取消、超时、
错误与成功均释放一次性 worker 和源对象 URL；只在 complete document-load 后交付 prepared cache。


### 宿主接管格式导出（2026-09-07）

`HandleExportWithConfigOptions.onArchive(blob, fileName)` 允许宿主接管生成的 ZIP；配置时不再触发 Core 默认浏览器下载，未配置时行为保持不变。USD 和机器人文本格式共用该交付选择。默认配置经 file-io 公共入口 `DEFAULT_EXPORT_CONFIG` 导出。

隔离嵌入工作区可以传 `AppContent.externalImportEnabled={false}`，关闭自动 URL 导入与 BroadcastChannel 监听，避免后台转换抢占用户其他标签页的导入。默认开启，手动文件导入与导出不受影响。

### Xacro YAML appearance dependencies

Folder and archive import retain `.yaml` / `.yml` as auxiliary text in the imported
file map. Browser Xacro supports `load_yaml` / `xacro.load_yaml`, dictionary access
(including `.get`), numeric list comprehensions, conditional expressions and
`str.join` for palette-to-RGBA conversion. Relative YAML paths resolve against the
declaring Xacro file; `$(find package)` and `package://` paths stay inside imported
packages. No host filesystem access or Python/JavaScript source execution occurs.
Unsupported expressions remain outside this data-only subset. Missing/invalid YAML
and unresolved material RGBA fail explicitly instead of producing black materials.
To change an authored scheme, edit its YAML configuration and reimport the package;
this does not add a palette selection UI.

Focused regression: `npm run test:unit -- src/core/parsers/xacro/xacroYaml.test.ts src/app/utils/importPreparation.yaml.test.ts`.
