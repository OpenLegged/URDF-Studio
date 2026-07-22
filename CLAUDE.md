# URDF Studio Agent Guide

> 最后更新：2026-07-11 | 技术栈：React 19.2 + TypeScript 5.8 + Three.js/R3F + Vite 6.2 + Tailwind CSS 4.1 + Zustand 5
> 完整文档索引：[docs/CATALOG.md](docs/CATALOG.md)

URDF Studio 是机器人设计、装配、可视化与导出工作台。核心能力：单模式 Editor 编辑、多 URDF 组装与桥接关节、多格式导入导出（URDF / MJCF / SDF / USD / Xacro / ZIP / .usp）、AI 生成与审阅、PDF/CSV 报告、可复用 react-robot-canvas 画布封装。

## 语言偏好

- 默认中文沟通（过程说明、总结、澄清、错误说明），除非用户明确要求其他语言
- 代码标识符、命令、文件路径、API 名称、错误原文保持原文

## 需求澄清与第一性原理

- 使用第一性原理思考：从用户的原始需求、问题动机、目标结果和约束出发，不要只按表面措辞机械执行
- 不要默认用户已经完全清楚自己想要什么、为什么要这样做、以及应该怎样得到结果；需要主动识别目标、动机、范围和成功标准是否清晰
- 如果需求意图不清、目标互相冲突、实现路径会显著影响产品形态或可能引入错误抽象，先停下来用中文和用户讨论关键问题
- 如果任务目标明确且风险可控，继续自治执行；不要把可由代码、文档或上下文推断的问题变成无谓确认

## src/ 目录结构

```
src/
├── app/            应用编排层：App shell、viewer 组合、导入导出、canonical source documents、USD hydration
│   ├── components/ App 级 UI 编排与跨域入口（header/settings/snapshot-preview/unified-viewer/workspace）
│   ├── hooks/      跨 store / viewer / source document hook（file-export/workspace-mutations）
│   ├── utils/      App 层辅助逻辑与导入准备 wrapper
│   └── workers/    App 编排使用的 worker
├── features/       业务功能模块
│   ├── ai-assistant/     AI 生成与审阅
│   ├── assembly/         桥接组件创建与组装（桥接弹窗内部模块在 components/bridge-create/）
│   ├── code-editor/      源码编辑器
│   ├── editor/           Editor 统一公开入口
│   ├── file-io/          底层文件能力（格式检测 workflow wrapper、project archive、USD/SDF export、弹层）
│   ├── hardware-config/  硬件/电机配置（兼容层 re-export）
│   ├── property-editor/  属性编辑、几何编辑、碰撞优化
│   ├── robot-tree/       文件树与结构树（tree-editor/ + tree-node/）
│   └── urdf-viewer/      Editor 实现：拓扑/几何/碰撞/测量 + renderer backend + USD runtime + workers
├── store/          Zustand 状态层
├── shared/         共享组件、3D 基础设施、hooks、i18n、数据、调试桥接、utils、workers
│   ├── components/ 共享 UI、3D 基础组件与纯 mesh renderer 组件
│   ├── data/       静态数据与内置配置
│   ├── debug/      调试桥接与验证辅助
│   ├── hooks/      通用 React hooks
│   ├── i18n/       本地化文案与类型
│   ├── utils/      通用工具（含 THREE / DOM / PDF 等）
│   └── workers/    共享 worker
├── core/           纯逻辑：解析器、robot core、mesh loaders、parse workers、runtime diagnostics
│   ├── geometry/       几何计算
│   ├── image-compressor/ 图像压缩逻辑
│   ├── loaders/        mesh / 资源加载
│   ├── parsers/        URDF / MJCF / SDF / USD 解析与格式检测
│   ├── robot/          robot core、组装 seed、runtime patch diff 与拓扑逻辑
│   ├── stl-compressor/ STL 压缩逻辑
│   ├── utils/          core 层工具
│   └── workers/        parse / runtime workers
├── lib/            对外复用的 RobotCanvas 封装（仅收稳定通用能力）
├── styles/         全局样式与语义 token
└── types/          跨模块类型定义
```

补充：`docs/`（Agent 上下文）、`scripts/`、`packages/react-robot-canvas/`（对外发布包）、`public/usd/bindings/`（USD WASM）、`output/`（导出结果）、`tmp/`（临时验证产物）、`test/`（大型 fixture 与回归样本）、`test/usd-viewer/`（独立 USD viewer 验证环境与浏览器清理脚本）

## scripts/ 目录结构

`scripts/` 按大型仓库常见的生命周期职责组织。新增脚本必须放入以下目录之一，不要恢复旧目录名（`codegen/`、`testing/`、`e2e/`、`isaacsim/`、`util/`、`version/`）：

```
scripts/
├── build/          WASM / OpenUSD 构建与源码同步
├── generate/       代码生成（AI prompt、SEO prerender、URDF schema）
├── test/           测试入口与测试基础设施
│   ├── browser/      浏览器回归测试（Puppeteer）
│   ├── e2e/          端到端场景测试
│   ├── helpers/      浏览器 / E2E 共用 helper
│   ├── runner/       测试 runner
│   ├── setup/        测试语料准备
│   ├── fixtures/     fixture 生成
│   ├── truth/        语料 / 真值验证
│   └── benchmark/    性能基准
├── tools/          开发与外部工具
│   ├── dts/          DTS 别名重写
│   └── isaacsim/     IsaacSim 集成工具
└── release/        版本管理（bump / show）
```

脚本入口优先通过 `package.json` 暴露。移动或新增脚本时同步更新 package scripts、README/docs、生成文件头注释、ESLint suppressions 和脚本内部相对 import。

## Google-style 工程质量约束

这里的“Google-style”指持续改善 code health、可评审的小变更、严格类型与可维护测试；不是把 Google 内部所有命名或工具约定原样搬进本项目。存量债务走 ratchet，新代码不得降低整体可维护性。

- **变更要小且单一目标**：一个变更只解决一个可说清的问题；行为变更与大范围重构尽量分开，除非两者不可分割。新行为与对应测试必须同一变更落地。
- **评审优先级**：正确性/安全/数据所有权 > 依赖边界/失败语义 > 测试有效性 > 可读性 > 纯样式偏好。不用个人风格阻断变更，也不能用“只是风格”掩盖真实的设计复杂度。
- **类型安全**：运行时代码禁止新增 `any`、`@ts-ignore`、`@ts-nocheck` 或双重断言来绕过模型；外部/Worker/JSON 边界使用 `unknown` + 窄化/验证。第三方互操确实无法表达时，把不安全转换局限在一个 adapter，用就地 suppression 说明原因，不得向业务层扩散。测试中的不安全 mock 也要尽量用最小结构类型。
- **API 面要小**：新模块使用 named export，不新增 default export 或可变 `export let`；只 export 真正的外部合约。feature/app 模块之间走明确公开入口，模块内部相互引用直接 import 具体文件，**禁止从自己的 barrel `index.ts` 反向 import**。存量 default export 不做无意义批量改名，触及时再随清晰边界演进。
- **依赖必须可静态看见**：产品 TS/TSX 使用 ESM `import`/`export`，不新增可绕过 `dependency_boundaries.mjs` 的 `require()`；CommonJS 只限明确 `.cjs`/工具边界。`scripts/tools/dependency_boundaries.mjs` 是分层、deep import、cycle 与例外清单的 canonical checker，不新建平行 layer rank/import regex/allowlist；改边界时在存量重复测试收敛前也要同步它们。
- **类型表达优先简单**：能用明确 interface/DTO 表达就不堆叠跨文件 `Pick`/条件类型/映射类型；少量重复通常比需要读者心算的类型更便宜。
- **注释记录 why**：实现注释说明不直观的动机、所有权、不变量和失败语义，不复述代码字面行为。公开 API 文档说明用途、输入输出、副作用与 cleanup 责任。
- **测试保护行为而非内部结构**：每个测试聚焦一个可观察行为和失败原因；纯重构不应引发大量无关测试改动。测试代码同样受可读性、去重和生命周期约束。
- **门禁不是数字游戏**：不得为让 CI 变绿而扩大 `google_style_baseline.json`、`dependency_boundaries_baseline.json`、`eslint-suppressions.json` 或新增宽泛 ignore。若确需例外，必须给出窄范围、所有者、原因和退出条件。`google-style:check` 对 active baseline 执行 exact-count ratchet：`actual > allowed` 阻断新债务，`actual < allowed` 作为 stale baseline 同样阻断，必须同步收紧。

## 架构红线与执行准则

依赖方向：`app -> features -> store -> shared -> core -> types`。箭头表示左侧上层可按 `dependency_boundaries.mjs` 的规则依赖右侧下层，不要求只依赖相邻层；同层 feature 默认不得互引。

- 不新增反向依赖；features 之间禁止直接 import，持久共享状态通过 store，workflow 由 app 编排。`features/editor -> features/urdf-viewer` 是已登记的窄 facade 例外，只能通过 `docs/architecture.md` §3-4 与 checker 精确 allowlist 中的入口使用，不得扩成一般 feature 对 feature 依赖
- Zustand store action 不得直接写另一个 store；跨 store command/同步放 `app/hooks`
- `core/` 保持纯函数，不引入 React / UI / Feature 依赖
- 使用 `@/` 指向 `src/`；`src/lib/` 只收稳定通用能力，不当业务 source of truth
- `src/lib/**` 和 `packages/react-robot-canvas/` 的可发布运行时边界不得新增对 `app/store/features` 的传递依赖；应用状态通过 props/ports + feature adapter 注入。`RobotCanvas -> urdf-viewer` 的两条剩余 allowlist 只能收缩，不得扩大
- 优先复用现有 hooks/utils/components，不重复造轮子；类型完整，避免 `any`
- 机器人源文件格式检测 canonical source 是 `src/core/parsers/format_detection.ts`；`app` / `features/file-io` 只做 workflow wrapper，不复制判断逻辑
- viewer backend 生命周期归 `src/features/urdf-viewer/renderers/`；`src/shared/components/3d/renderers/` 只保留纯 mesh renderer 组件与 Collada scene helpers
- `AssemblyState` 是应用唯一可写机器人模型；source-local mutation 放 `workspace-mutations/`，component source draft/document 编排放 `app/hooks` 或 `app/utils`，禁止恢复 `useWorkspaceSourceSync` 双写镜像
- viewer/export 统一从 `createAssemblySceneProjection` / `createAssemblyScenePlacement` 或 canonical export projection 派生 `RobotData`；renderer strategy 不得参与 selection、mutation、history 或 source 路由
- viewer/renderer hook 只上报 typed renderer facts（例如 measured bounds/offsets/runtime delta），不读取或消费 workspace mutation queue，不决定 history label/skipHistory/transaction；这些由 `app/hooks/workspace-mutations/` coordinator 拥有
- `.usp` 只接受和生成严格 `3.0` canonical workspace schema；禁止恢复 v2 migration、deprecated robot/assembly payload 或旧双 history
- 涉及 3D / USD / mesh 时检查材质缓存、资源释放、hydration/export 生命周期
- 新增 `ResizeObserver`、timer、worker listener、THREE 资源时必须对称 cleanup
- worker entry 优先只做 protocol dispatch 和顶层 dispose；若 cache、interaction、scheduler 或 runtime 各自可独立 reset/dispose，按生命周期抽出明确 owner，不继续累加 worker 全局可变状态
- shared worker/singleton runtime 必须有 app/document-lifetime owner；组件 unmount 至少通过 generation/token 使本实例的在途 async 结果失效，任一 viewer 实例不得擅自销毁共享 runtime
- 多 viewer 共享的 interaction/hover/selection lock 必须 owner-scoped 或 ref-counted，acquire/release 对称；read-only/offscreen/snapshot viewer 不得改 canonical selection 或全局 hover lock
- 桥接弹窗对外入口保持 `features/assembly/components/BridgeCreateModal.tsx`，内部实现放 `components/bridge-create/`
- 单元测试邻近源码放置（`src/**/*.test.*`）
- **跨域 Handoff 接收端**：`src/app/hooks/useAssetImportFromUrl.ts`、`src/app/components/BotWorldImportOverlay.tsx` 为 BOT-World 资产导入核心文件；插件激活详见 [docs/file-io.md](docs/file-io.md) §6
- **调试接口默认关闭**：`window.__URDF_STUDIO_DEBUG__`、`window.__usdStageLoadDebug*`、`window.__visualizerCollisionLoadDebug*` 等回归调试接口只能在 URL 显式带 `?regressionDebug=1` 时启用；不要仅因 `DEV`、本地开发或普通预览环境暴露。Codex / Claude / 回归脚本需要调试时由脚本加该参数。
- **修复用户上报的 bug 必须用浏览器实测**：拿到用户反馈的 bug 后，不能凭推理或读代码就判定已修好。必须通过 `npm run dev` 启动应用，并使用浏览器自动化工具（chrome-devtools / playwright MCP）走一遍用户复现路径，确认现象消失后才能回复"已修复"。typecheck / 单元测试通过 ≠ bug 修好
- **浏览器自动化必须清理进程**：使用 chrome-devtools / Playwright / Puppeteer / MCP 或运行浏览器回归脚本后，必须关闭 page、context、browser、DevTools 会话和由 agent 启动的 dev server；结束前运行 `node test/usd-viewer/scripts/cleanup-headless.cjs`。如仍有残留，只清理由本次自动化产生的 chrome-devtools/playwright/puppeteer 临时进程，禁止杀掉用户日常浏览器。
- **文件规模门禁，禁止为凑行数硬拆内聚逻辑**：单文件/函数长度、复杂度由 `google-style:check` 的 exact-count baseline ratchet 检查；存量 grandfather、禁止净新增，债务下降必须同步收紧 baseline。`file-name-snake-case` 是 retired 信息项，不再阻断当前项目约定。多数超长解析器/数值求解器是**真实领域内聚**，硬拆成互传 ref 的碎片只损害 debuggability；只对存在"可干净抽离附带膨胀"的文件定向重构。手写 C-ABI emscripten 源（`src/core/loaders/wasm/*.cpp`，单 TU 设计）、`public/wasm/**` 生成产物、`**/*.generated.*`、`third_party/**`、`urdf-viewer/runtime/**` 有意豁免，详见 [docs/architecture.md](docs/architecture.md) §13

存量例外与设计哲学（debuggability first、Linux 哲学：简单数据流优于抽象层、规模门禁与豁免）详见 [docs/architecture.md](docs/architecture.md) §3、§9-10、§13。

## 解耦判定与演进优先级

解耦的目标是减少变更传导和模糊所有权，不是追求文件数。只有当抽离后同时获得更窄依赖、更清晰合约或可独立测试的纯逻辑时才拆分。

### 边界判定

- 一个模块若同时因两种不同原因变更（例如文件解析 + overlay 状态，或 scene 派生 + store mutation），优先按变更原因分边界。
- 纯领域转换/验证放 `core/`；单 feature 用例与 UI controller 放该 `features/`；跨 feature/store/source/viewer 时序放 `app/`；`shared/` 只收无业务语义且已有两个真实使用方的稳定原语。`shared/components/3d/` 可以组合通用 scene/mesh/interaction 原语，但不拥有 workspace workflow、history 或 feature 业务协调。
- feature 之间禁止直接 import。只有真正的共享持久状态才进 store；短期交互、workflow 回调和 adapter 合约由 `app` 组合，不要为了避免 feature import 把所有协调都塞入 Zustand。
- React 组件负责 render 和用户事件；hook 负责一个明确生命周期/use case；纯派生、规则和序列化优先做成无 React 函数。不用巨型 props/ref 包或一组互相回调的小 hook 伪装解耦。
- 循环依赖是边界错位信号：优先把双方共享 DTO/contract 下沉到中性模块，或让组合方注入实现，不新增 barrel/re-export 遮住环。
- 拆分后必须能用一句话指出每个模块的 owner、输入输出、失败方式和 cleanup 责任；否则说明边界仍不成立。

### 当前状态与债务地图（2026-07-11）

`npm run deps:check` 当前为 0 个分层违规、0 个 app feature deep import、0 个 import cycle，`dependency_boundaries_baseline.json` 两个清单均为空。已完成：

- 7 个存量 cycle 已通过 neutral contract/direct leaf import 解除，共享 protocol/DTO 不再反向依赖编排器。
- `selectionStore` 不再写 `workspaceStore`，active component 同步由 `app/hooks/useSelectionActiveComponentSync.ts` 所有；hover freeze 使用 owner token，副 viewer cleanup 不会释放主 viewer 的锁。
- auto-grounding viewer hook 只上报测量 facts，workspace queue/transform/history 由 `app/hooks/workspace-mutations/assemblyAutoGrounding.ts` 所有；projected joint motion transaction 同样已抽到 app command/hook。
- Google-style baseline 已改为 exact-count ratchet；dependency checker 已覆盖 `types` leaf 和非 `.cjs` 的 `require()`；重复 architecture/source/size 规则已收敛到 canonical checker。
- 发布包 viewport 已抽为 store-free `src/lib/components/RobotCanvasViewport.tsx`，删除 `ViewerCanvas -> workspaceStore` 传递依赖与对应 allowlist。
- P1 第一批已完成：document load/import 由 `app/hooks/robotLoadWorkflow.ts` + `useRobotLoadWorkflow.ts` 统一 pre-resolved/worker completion；`useClosedLoopPreviewScheduler.ts` 独占闭环预览 worker、RAF、generation/in-flight 与 cleanup；`importPreparation.ts` 已收为线性 facade，payload contract、sidecar reference、archive/loose collector 各自独立；USD offscreen interaction state 独占 selection/hover、mesh/pick/helper index、highlight snapshot 与分层 reset 生命周期。
- P1 第二批已完成：`useWorkspaceViewerDerivations.ts` 隔离 workspace→scene/viewer/source/joint read model 且保持 live motion 下 projection identity；`useAppLayoutSnapshotWorkflow.ts` 独占 snapshot refs/session/cancel/progress/debug cleanup；`useUnifiedViewerSceneLifecycle.ts` 独占 retained Three.js graph、scope 与 inactive/release timer；USD deferred snapshot owner 独占 pending/timeout/generation/clear/dispose；Snapshot capture form 独占默认值、格式不变量和配置 choices。

下列是**定向重构候选**，不要单独发起“降行数”式大拆分：

P0 内部的执行顺序是：可能导致错误 mutation/history 或多 viewer 状态串扰的正确性边界 > 触及发布包时的 package/store 边界 > 本次改动正好触及的存量 cycle。P0 不代表脱离需求一次性重写全部。

- P0 `src/lib/components/RobotCanvas.tsx` / `packages/react-robot-canvas/`：当前还剩 `RobotModel` / `JointInteraction` 两条 feature allowlist；继续抽取 store-free renderer kernel 和通用 joint interaction primitive，将 camera projection、MJCF world visibility 与 selection 作为显式 props/ports，`urdf-viewer` 只保留 Zustand adapter。
- P1 `src/features/urdf-viewer/hooks/useViewerController.ts`：闭环预览 scheduler 已抽离；继续按 selection/tool state、projection-derived state、camera/snapshot 等独立生命周期抽可测试 controller/纯派生，保留薄 facade，禁止重新散落 worker/RAF refs。
- P1 `src/app/App.tsx` / `AppLayout.tsx`：document load/import、viewer derivation 与 snapshot workflow 已抽离，`AppContent` 当前约 453 代码行、`AppLayout` 约 613 代码行；下一步只抽有明确 owner 的 overlay/panel 组合，不把状态机切成互相捕获 ref 的碎 hook。
- P1 `src/app/components/UnifiedViewer.tsx`：retained scene 生命周期已抽离；继续把 scene/view mode 派生和 overlays/panels render 分开，但 backend strategy 继续不得接触 mutation/selection/history。
- P1 `src/features/urdf-viewer/workers/usdOffscreenViewer.worker.ts`：interaction state 与 deferred snapshot owner 已抽离；后续再按独立生命周期抽 stage/cache、picking 算法与 preload/load pipeline，entry 保留 dispatch 和统一销毁，不引入万能 manager/class。
- P1 `SettingsModal.tsx` / `SnapshotDialog.tsx`：Snapshot capture config model 已抽离且主文件低于 800 代码行；继续分离 Settings pane model 与 Snapshot preview/layout render，让 UI 只消费窄 props 和稳定 command；共享是因为真实合约，不是因为 JSX 长得像。
- P2 `src/store/workspace/runtime.ts`：`createWorkspaceRuntime` 约 433 行但共享 transaction/history/joint-motion 不变量；只在能以窄 command contract 分开且不复制可变闭包状态时拆分。

以上行数只是定位信号，不是验收条件。验收看依赖是否单向、数据是否单一所有、测试是否可稳定保护行为，以及调试时能否沿简单数据流定位失败。

## Editor 单模式

| 子域               | 典型任务                                 |
| ------------------ | ---------------------------------------- |
| 拓扑               | Link / Joint 增删、拓扑编辑、关节参数    |
| 几何 / 碰撞 / 测量 | Visual / Collision、mesh、材质、碰撞变换 |
| 硬件配置           | 电机型号、传动比、阻尼、摩擦             |

公开入口 `features/editor/index.ts`，实现位于 `features/urdf-viewer/`，跨子域交互在 `app/` 或 `shared/components/3d/`。详见 [docs/viewer.md](docs/viewer.md)。

## 状态管理

| Store                          | 职责                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `workspaceStore`               | 唯一可写 `AssemblyState`、component/bridge/entity CRUD、单一 history/activity、transaction |
| `uiStore`                      | 主题、语言、侧栏、面板、显示选项（含持久化）                                               |
| `selectionStore`               | 唯一 `WorkspaceSelection`，覆盖 assembly/component/bridge/link/joint/tendon 与 hover/focus |
| `assetsStore`                  | mesh、texture、library templates、component source drafts、USD snapshot/export cache       |
| `collisionTransformStore`      | 碰撞 gizmo 瞬时 pending transform                                                          |
| `jointInteractionPreviewStore` | 跨 viewer 关节交互预览                                                                     |

`RobotData` 只允许存在于 component 或只读 projection；不得在 Zustand 顶层恢复第二份可写 `name/links/joints/components`。`assetsStore` 拥有 draft/cache/blob 等持久或可订阅状态，`app/hooks` / `app/utils` 拥有 parse/validate/apply/invalidate 编排；状态存放不等于 store action 可以越过 app 拥有业务 workflow。跨 store 协调放 `app/hooks/*`；USD 中间态优先落在 `assetsStore` 或 `app/utils/*`。

## 开发服务器访问

`npm run dev` 默认绑定 `127.0.0.1`，用于本机 IPv4 回环访问，避免 Windows + Node 18+ 下 `localhost` 被解析到仅 IPv6 `::1` 后浏览器走 IPv4 访问失败。

需要远程开发端口转发、容器或局域网访问时，显式运行 `URDF_STUDIO_DEV_HOST=0.0.0.0 npm run dev`。如果预览 / 隧道域名被 Vite host check 拒绝，再按需设置 `URDF_STUDIO_DEV_ALLOWED_HOSTS=preview.example.test,.tunnel.example.test npm run dev`。

## 常用命令

```bash
npm run dev            # 开发
npm run lint           # 代码检查
npm run google-style:audit  # Google JS/TS + HTML/CSS 风格债务审计（非阻断）
npm run google-style:check  # Google 风格 exact-count baseline ratchet
npm run typecheck:quality  # 运行时代码类型检查（排除 test/spec）
npm run typecheck      # 全仓 TypeScript 债务检查（含 test/spec）
npm run test           # 测试
npm run build          # 构建
npm run build:package:react-robot-canvas  # 修改 src/lib 或发布包时额外运行
npm run verify:fast    # 快速验证
npm run verify:full    # verify:fast + 大型 fixture（不含 all unit/browser/full typecheck/package build）
node test/usd-viewer/scripts/cleanup-headless.cjs  # 清理自动化残留浏览器进程
```

## 测试分层与 AI 选命令规则

单元测试继续邻近源码放置：`src/**/*.test.*` / `src/**/*.spec.*`。用 `npm run test:unit:list` 查看当前 runner 管理的 suite 与实时数量，不在文档中维护会漂移的硬编码计数。不要把普通单元测试搬到统一 `tests/` 目录。

完整测试金字塔、命令选择和新增测试落点见 [docs/testing.md](docs/testing.md)。

给 Codex / Claude 等 agent 选择命令时按以下优先级：

| 场景                                  | 命令                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| 默认快速验证                          | `npm test` 或 `npm run test:unit`                                                 |
| 指定文件 / 变更邻近测试               | `npm run test:unit -- path/to/file.test.ts`                                       |
| 查看 runner 管理的 suite 与数量       | `npm run test:unit:list`                                                          |
| 跑全部源码邻近 Node 测试              | `npm run test:unit:all`                                                           |
| 只跑 app hooks 快速子集               | `npm run test:unit:app-hooks`                                                     |
| 只跑配置测试                          | `npm run test:unit:config`                                                        |
| 轻量 regression 脚本旁单测            | `npm run test:regression:unit`                                                    |
| 浏览器回归                            | `npm run test:browser:*` 或 `node scripts/test/runner/run-all.mjs --browser-only` |
| 大型 fixture / truth / benchmark 回归 | `npm run test:fixtures:*` 或 `scripts/test/truth/*` / `scripts/test/benchmark/*`  |

`npm test` 保持 fast lane，避免默认验证依赖 `test/` 大型语料或浏览器环境。需要全量覆盖时，按变更风险显式组合 `npm run test:unit:all`、`npm run test:fixtures` 和对应 browser suite。

注意：`verify:full` 是 `verify:fast + test:fixtures`，**不自动包含** `test:unit:all`、browser suite、全仓 `typecheck` 或 react-robot-canvas package build。“全量”必须按变更风险分别显式运行所需命令，不能仅以命令名称推断覆盖范围。

## 格式回归样本

涉及格式解析、导入、导出、资源解析或 viewer hydration 时，优先使用以下大型语料：

| 格式 / 场景 | 基准目录                      |
| ----------- | ----------------------------- |
| MJCF        | `test/mujoco_menagerie-main/` |
| MJCF tendon | `test/myosuite-main/`         |
| SDF         | `test/gazebo_models/`         |
| USD         | `test/unitree_model/`         |
| USDA        | `test/unitree_ros_usda/`      |
| URDF        | `test/unitree_ros/`           |

## 文档导航

| 任务                                  | 文档                                                 |
| ------------------------------------- | ---------------------------------------------------- |
| Editor / 3D / Viewer / USD runtime    | [docs/viewer.md](docs/viewer.md)                     |
| 导入导出 / Workspace / 组装           | [docs/file-io.md](docs/file-io.md)                   |
| UI 样式 / 颜色 / 主题 / 可访问性      | [docs/style-guide.md](docs/style-guide.md)           |
| AI 助手 / 审阅 / skill 路由           | [docs/ai-features.md](docs/ai-features.md)           |
| 架构边界 / 依赖方向 / 例外 / 设计哲学 | [docs/architecture.md](docs/architecture.md)         |
| 测试金字塔 / 命令选择 / 新增测试落点  | [docs/testing.md](docs/testing.md)                   |
| 验收清单 / 测试样本 / 回归命令        | [docs/update-rules.md](docs/update-rules.md)         |
| react-robot-canvas 对外库             | [docs/robot-canvas-lib.md](docs/robot-canvas-lib.md) |
| 完整文档索引                          | [docs/CATALOG.md](docs/CATALOG.md)                   |
