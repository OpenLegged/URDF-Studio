# URDF Studio Agent Guide

URDF Studio 是机器人设计、装配、可视化与多格式导出工作台，使用 React、TypeScript、Three.js/R3F、Vite、Tailwind CSS 和 Zustand。依赖版本以 `package.json` 为准。

本文件只保留项目约定与易踩坑的约束；专题细节按任务查阅末尾文档，不要求每次通读。重构进度、债务清单和文件行数不放在这里。

## 协作方式

- 默认中文沟通；代码标识符、命令、路径和错误原文保持原文。
- 根据目标和上下文自治完成任务；常规实现选择自行决定，只有真正影响目标或涉及破坏性操作的不确定事项才澄清。
- 独立子任务能提高效率时使用原生 subagent 并行处理。
- 按变更风险选择验证；必要检查通过后结束，不为小改动反复扩大测试范围。

## 设计原则

- **第一性原理**：从实际目标、约束和数据模型推导方案；发现更简单的可行路径时主动指出，不机械照表面措辞实现。
- **Linux 设计哲学**：一个模块做好一件事，接口小而清晰，优先组合现有稳定能力；让数据流和控制流简单直接。
- **简单与实用**：新抽象必须降低整体复杂度；不为假设的未来需求预埋框架，不为行数把内聚逻辑拆成碎片。
- **可调试性优先**：所有权、生命周期和失败路径显式可追踪；暴露真实错误，不用隐式同步、静默降级或魔法默认值掩盖坏状态。
- **Google-style 工程质量**：正确性与数据所有权优先，保持类型安全，用必要的行为测试保护变更，逐步收紧存量债务。

设计取舍的详细约束见 [docs/architecture.md](docs/architecture.md) §9–10。

## 架构红线与执行准则

依赖方向：`app -> features -> store -> shared -> core -> types`，允许跨级向下依赖。`app` 编排跨域 workflow，`features` 承载单一业务能力，`store` 保存状态，`shared` 放稳定共享原语，`core` 保持无 React/UI 的领域逻辑。`@/` 指向 `src/`。

- feature 间不直接互引；跨 feature/store 协调放 `app/hooks`，store action 不得写另一个 store。Editor facade 是精确登记的例外。
- 分层、公开入口、发布包依赖闭包和循环依赖统一由 `scripts/tools/dependency_boundaries.mjs` 检查；不复制 checker，不扩大 allowlist，不用 `require()` 绕过检查。
- `src/lib/` 与 `packages/react-robot-canvas/` 的可发布运行时不得传递依赖 `app/store/features`；应用状态通过 props/ports 和 feature adapter 注入。
- `workspaceStore.workspace: AssemblyState` 是唯一可写机器人模型，使用单一 history；`RobotData` 仅存在于 component 或只读 projection，不恢复顶层 robot 镜像或 source 双写同步。
- viewer/export 从 `createAssemblySceneProjection` / `createAssemblyScenePlacement` 或 canonical export projection 派生；renderer strategy 不参与 selection、mutation、history 或 source 路由。
- source-local mutation 归 `app/hooks/workspace-mutations/`；component source command、draft/reconcile/history 策略归 `app/hooks/workspace-source-sync/`。viewer 只上报 typed renderer facts，mutation queue 和 transaction 由 app coordinator 消费和决定。
- `.usp` 仅接受与生成严格 `3.0` canonical workspace schema，不恢复旧版迁移、旧 payload 或双 history。
- 格式检测唯一实现：`src/core/parsers/format_detection.ts`；app/file-io 只做 workflow wrapper。
- 通用 robot kernel/backend 生命周期归 `shared/components/3d/robot/`，无 store/feature 依赖；`features/urdf-viewer` 注入应用状态并拥有 workspace adapter；`shared/components/3d/renderers/` 只放纯 mesh renderer 与 Collada helpers。
- worker/runtime 明确 app/document 生命周期 owner；组件卸载使自身在途 async 结果失效，不销毁其他 viewer 共用的 runtime。observer、listener、timer 和 THREE 等资源必须对称 cleanup；worker entry 保持 protocol dispatch，独立 cache/session 按生命周期归属模块。
- 多 viewer 的 interaction/hover/selection lock 使用 owner token 或引用计数，成对 acquire/release；只读、offscreen、snapshot viewer 不改 canonical selection 或全局 hover lock。
- 导入、导出、解析、hydration、worker 链路保留真实错误，不用空值、旧缓存或静默降级伪装成功。

具体 owner、公开入口与窄例外见 [docs/architecture.md](docs/architecture.md)。

## 代码约定

- 新模块使用 named export，不新增 default export 或可变 `export let`；跨模块走公开入口，内部直接引用具体文件，不从自己的 barrel `index.ts` 反向 import。
- 不新增 `any`、`@ts-ignore`、`@ts-nocheck` 或双重断言绕过类型；外部输入用 `unknown` 并验证，必要的不安全第三方转换限制在 adapter 内并说明原因。
- 不通过放宽 baseline、suppression 或 ignore 让检查通过；确需例外时注明窄范围、owner、原因和退出条件。`google-style:check` 使用 exact-count ratchet：债务增加失败，减少后也必须同步收紧 baseline。
- 按职责和生命周期拆分，不为行数硬拆内聚逻辑；门禁与生成代码/第三方源码等豁免见 [docs/architecture.md](docs/architecture.md)。

## Editor 单模式与状态管理

Editor 包含拓扑、几何/碰撞/测量和硬件配置；公开入口 `features/editor/index.ts`，实现位于 `features/urdf-viewer/`。

| Store | 职责 |
| --- | --- |
| `workspaceStore` | 唯一可写 AssemblyState、CRUD、history、transaction |
| `selectionStore` | 唯一 WorkspaceSelection、hover/focus |
| `assetsStore` | mesh/texture、library、component source drafts、USD cache |
| `uiStore` | 主题、语言、面板与显示选项 |
| `collisionTransformStore` | 碰撞 gizmo pending transform |
| `jointInteractionPreviewStore` | 跨 viewer 关节交互预览 |
| `jointPickSessionStore` | 桥接关节拾取会话；由 assembly/urdf-viewer 直接 import，不经 store barrel 导出 |

状态存放不等于 workflow 所有权：`assetsStore` 保存 draft/cache，parse/validate/apply/invalidate 仍由 app 编排。

## scripts/ 目录结构

脚本只放 `scripts/{build,generate,test,tools,release}/`，不恢复旧目录名；入口优先通过 `package.json` 暴露。移动时同步调用入口、文档、相对 import、生成文件头和 ESLint suppressions。子目录见 [scripts/README.md](scripts/README.md)。

## 开发服务器访问

`npm run dev` 默认监听 `127.0.0.1:3000`。远程/容器/LAN 使用 `URDF_STUDIO_DEV_HOST=0.0.0.0 npm run dev`；LAN 的 USD WASM 需要安全上下文及 cross-origin isolation，可用 `URDF_STUDIO_DEV_HTTPS=true npm run dev`。证书与 allowed hosts 配置见 [README_CN.md](README_CN.md#启动应用)。

## 测试分层与 AI 选命令规则

单元测试邻近源码放在 `src/**/*.test.*` / `src/**/*.spec.*`。完整测试入口、语料与并发设置见 [docs/testing.md](docs/testing.md)，样本选择见 [docs/update-rules.md](docs/update-rules.md)。

- `npm test` 是快速子集；全量源码邻近测试用 `npm run test:unit:all`，suite 清单用 `npm run test:unit:list`。
- 工作流 E2E 用 `npm run test:workflow:quick`（仓内小 fixtures，无需大型语料）或 `npm run test:workflow`（完整旅程）；格式/runtime 改动按风险追加对应 browser/fixture suite。
- `verify:full` 仅在 `verify:fast` 上增加 fixtures，不自动包含全部单测、全部 browser suite、全仓 typecheck 或发布包构建。
- 修复用户上报的 bug：启动应用，用 Playwright 走用户复现路径，确认现象消失再称“已修复”；typecheck/单测不能替代浏览器实测。无法实测时明确说明缺失的验证。
- 调试接口仅在 URL 显式带 `?regressionDebug=1` 时开启，不能因 DEV 或本地预览而默认暴露。
- 浏览器自动化结束时关闭 page/context/browser 和本次启动的 dev server，并运行 `node test/usd-viewer/scripts/cleanup-headless.cjs`。只清理本次自动化进程，禁止宽泛 `pkill chrome` / `killall chrome`；产物放 `tmp/`。

## 常用命令

| 用途 | 命令 |
| --- | --- |
| 变更邻近单测 | `npm run test:unit -- path/to/file.test.ts` |
| lint / 依赖与风格门禁 | `npm run lint` |
| 运行时代码 / 全仓类型检查 | `npm run typecheck:quality` / `npm run typecheck` |
| 应用构建 | `npm run build` |
| 常规综合验证 | `npm run verify:fast` |
| 修改 src/lib 或发布包后额外构建 | `npm run build:package:react-robot-canvas` |

## 分支工作流

- 本地修改先在 `dev` 提交与验证，禁止直接在 `main` 开发提交。
- `dev` 验证通过后合并到 `main`：`git checkout main && git merge dev`，先 `git push origin dev` 再 `git push origin main`。
- 若 `main` 先有提交，在 `dev` 上 `git merge --ff-only main` 对齐后继续开发。
- provider key 只放被忽略的 `.env` / `.env.local`，不写入任何跟踪文件，不强制 add；`opencode.json` 使用 `{env:VAR}` 引用。BYOK 的 `VITE_*` 会进入浏览器 bundle，仅限本机 dev，不能向不可信网络暴露带密钥的实例。
- 提交/推送前检查暂存区与未跟踪非忽略文件中的明文 secret，命中立即停止提交并移除；不能把单一 key 正则无匹配当作安全证明。

## 文档导航

| 任务 | 文档 |
| --- | --- |
| 架构、canonical owner、依赖例外、生命周期 | [docs/architecture.md](docs/architecture.md) |
| Editor / 3D / Viewer / USD runtime | [docs/viewer.md](docs/viewer.md) |
| 导入导出 / Workspace / 组装 / BOT-World handoff | [docs/file-io.md](docs/file-io.md) |
| UI 样式 / 颜色 / 主题 / 可访问性 | [docs/style-guide.md](docs/style-guide.md) |
| AI 助手 / 审阅 / 宿主 Agent 契约 | [docs/ai-features.md](docs/ai-features.md) |
| 测试入口 / 语料 / 验收与文档更新 | [docs/testing.md](docs/testing.md)、[docs/update-rules.md](docs/update-rules.md) |
| react-robot-canvas 对外库 | [docs/robot-canvas-lib.md](docs/robot-canvas-lib.md) |
| 完整文档索引 | [docs/CATALOG.md](docs/CATALOG.md) |
