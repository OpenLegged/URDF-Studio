# 导入导出与 Workspace 链路

> 最后更新：2026-07-17 | 覆盖源码：`src/app/hooks/`、`src/app/hooks/file-export/`、`src/app/hooks/workspace-source-sync/`、`src/app/hooks/workspace-mutations/`、`src/app/utils/`、`src/app/workers/`、`src/app/components/BotWorldImportOverlay.tsx`、`src/core/parsers/format_detection.ts`、`src/core/robot/assemblySceneProjection.ts`、`src/features/file-io/`、`src/features/robot-tree/`、`src/features/assembly/`、`src/features/property-editor/`、`src/shared/utils/popupHandoffProtocol.ts`、`src/shared/hostIntegrationState.ts`
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
- `.usp 3.0` project import/export、USD prepared export cache、live USD roundtrip archive 已进入主工作流
- `projectArchive.worker.ts`、`usdExport.worker.ts`、`usdBinaryArchive.worker.ts` 已进入主导出链路；大型归档或序列化任务优先走 worker/transfer
- `projectImport.worker.ts` 已进入 project import 链路；问题优先在 worker/bridge 修
- `DisconnectedWorkspaceUrdfExportDialog.tsx` 是 workspace 断联导出特例，不要塞回通用导出弹层
- `ExportProgressDialog.tsx` / `ExportProgressView.tsx` 是长时导出反馈的统一 UI，不要重新发明导出进度弹层

## 3. App 编排层

### 关键组件

- `App.tsx`：根组件，装配 Providers、懒加载模态框、全局导入导出入口、debug bridge
- `AppLayout.tsx`：应用壳、Header、TreeEditor、PropertyEditor、UnifiedViewer 主编排
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

## 7. 明确热点文件（新增逻辑优先抽离）

- `src/features/property-editor/utils/geometryConversion.ts`
- `src/features/file-io/utils/usdExport.ts`
- `src/app/hooks/useFileExport.ts`
- `src/app/AppLayout.tsx`
- `src/app/hooks/workspaceSourceSyncUtils.ts`（只允许 canonical workspace → source/preview 纯派生）
