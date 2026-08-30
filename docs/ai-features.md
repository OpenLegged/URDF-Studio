# AI 助手与审阅

> 最后更新：2026-08-30 | 覆盖源码：`src/features/ai-assistant/`
> 交叉引用：[architecture.md](architecture.md)（ai-assistant <-> file-io 例外说明）

## 1. 环境变量与两种运行模式

AI 功能（生成 / 审查 / 对话）有两种互斥的运行模式，由环境变量决定：

**直连模式（BYOK，开源部署默认）** —— 浏览器内直接调用 OpenAI 兼容接口，key 由部署者自备：

```env
VITE_OPENAI_API_KEY=your_key
VITE_OPENAI_BASE_URL=https://api.openai.com/v1
VITE_OPENAI_MODEL=deepseek-v3
VITE_OPENAI_CONTEXT_WINDOW_TOKENS=32768
VITE_OPENAI_THINKING_MODE=auto
VITE_OPENAI_REASONING_EFFORT=high
```

- `VITE_OPENAI_THINKING_MODE`（Node 环境对应 `OPENAI_THINKING_MODE`）支持 `auto / enabled / disabled`。
  `auto` 不发送 provider 私有字段，保留模型默认行为；DeepSeek 等兼容接口需要显式开启时使用
  `enabled`，不支持该字段的接口应保持 `auto`。
- `VITE_OPENAI_REASONING_EFFORT`（Node 环境对应 `OPENAI_REASONING_EFFORT`）支持
  `low / medium / high / max`，仅在 thinking 显式开启时发送。DeepSeek thinking + tools 返回的
  `reasoning_content` 会在同一 Agent turn 的后续请求中完整续传，满足 provider 的 tool-call 协议；
  它不会被复制到可见或可导出的 activity 日志。参考
  [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。

**托管模式（backend transport，官网部署）** —— 设置后端 AI 代理地址后，三个 AI 功能改为把
**结构化上下文**（robot 快照、审查项、对话历史等）POST 给后端，提示词模板与 Provider key
都在服务端（botbase → BotPilot），浏览器 bundle 里不存在任何 AI 密钥：

```env
VITE_AI_BACKEND_URL=/api/ai/urdf-studio
```

- 设置 `VITE_AI_BACKEND_URL`（或 `AI_BACKEND_URL`）即启用托管模式，忽略 BYOK 三件套。
- 契约见 `services/aiBackendTransport.ts`：`/generate`、`/inspect` 返回
  `{success, data:{content}}`（content 为模型原始输出，JSON 解析仍在前端，两种模式共用同一条
  处理管线）；`/chat` 为 SSE（`data: {"delta"|"done"|"error"}`）。
- 鉴权可插拔：宿主壳通过 `setAiBackendAuthTokenProvider(() => token)` 注册用户 JWT 提供者
  （推荐从窄 `src/hostIntegrations.ts` facade 导入；feature 入口保留兼容导出），请求以 `Authorization: Bearer` 携带；自部署自建代理
  时可不注册。
- 服务端提示词模板是本仓 `config/aiPromptTemplates.generated.ts` 的镜像（BotPilot
  `workflows/urdf_studio/prompt_templates.py`）；改模板时两侧一起更新。

## 2. 审阅标准输入

- `src/features/ai-assistant/config/urdf_inspect_standard_en.md`
- `src/features/ai-assistant/config/urdf_inspect_stantard_zh.md`

> 注意：中文文件名当前拼写为 `stantard`，属仓库现状，不要擅自改名。

## 3. Skill-first 路由策略

默认原则：
- 若需求本质是"工作流指导、最佳实践、排障框架、测试套路、设计约束"，优先使用 skill，而不是在 prompt 里堆 MCP/tool 名称
- skill 压缩"怎么做"的上下文；只有确实需要执行外部能力时，才调用对应 MCP/tool
- skill 不能替代真实执行能力（浏览器点击、远程 API、Figma 读取等）

优先替代映射：

| 任务类型 | 优先 skill | 仅在必要时使用 MCP |
|----------|-----------|-------------------|
| 浏览器验证 / 截图 | `webapp-testing`、`playwright`、`browser-automation` | 真实 DOM 快照、网络面板、DevTools 级检查 |
| 3D / R3F / Three.js | `threejs-skills` | — |
| URDF Studio UI 改造 | `urdf-studio-style`、`frontend-design` | — |
| 调试 / 排障 | `systematic-debugging`、`debugger` | — |
| 测试 / QA | `testing-qa` | — |
| 库文档 | `context7-auto-research` | Context7 / Web 搜索 |
| 代码审阅 | `requesting-code-review`、`find-bugs` | — |

使用约束：
- 同一任务优先选择 1 个主 skill；不足时再补 1-2 个辅助
- 不要同时声明多个重叠 skill
- 若仓库已有现成脚本/测试/build 命令，优先本地命令，不改走 MCP

## 4. 与 AI 对话时的有效上下文

优先给出：
- 具体的 `Link` / `Joint` 名称
- 期望的父子关系
- 当前在 Editor 中操作的是拓扑、几何/碰撞、还是硬件相关能力
- 涉及电机时的力矩 / 传动 / 阻尼约束
- 目标格式（URDF / MJCF / USD / .usp）
- 是否涉及 merged assembly 或 workspace/structure 视图

浏览器 tool-calling 路径每轮都使用提交时的 live robot，并按整个模型请求的 token 预算携带当前
“新对话”分隔线之后的有效对话。已应用修改卡的 explanation 会作为 assistant turn 进入后续上下文，因此
“把刚才的改动再调大一点”之类跟进指令不再是伪多轮。选中实体、审阅报告和 focused issue
通过结构化 task context 注入 system prompt；实际工具读到的 live draft 始终是最终权威数据。

## 5. DeepSeek Harness（DSH）接入边界

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 可以作为独立 agent runtime，但不是可直接打包到
Vite 浏览器 bundle 的对话库：

- 官方 TypeScript SDK 使用 Node `child_process` 启动 `dsh` runtime，通过 stdio JSON-RPC 交换
  `session/prompt` / `session.event` / `session.status`。
- DSH Web UI 仍然需要本机 Host；浏览器端通过受信 API / WebSocket 访问模型、文件系统、
  Shell、沙箱、持久化与子 agent。
- 因此纯静态 URDF Studio 不引入 DSH Node 依赖。可在浏览器内复用的部分是它的编排模式：
  capability registry、有界会话上下文、tool loop、进度事件以及修改前确认。本项目已在
  `agentEngine.ts` / `robotCapabilities.ts` / `AIConversationModal.tsx` 中实现这些边界。

当前浏览器 harness 还提供以下运行时保证：

- 一次用户请求是一个 turn；每次模型请求是一个 step。运行状态、计划、工具开始/结束、校验和
  终态使用 typed events 记录到本地 Session 日志；模型请求进行中显示单一的“AI 正在思考”实时状态，
  不把“思考下一步”重复堆成历史行。模型通过普通 assistant content 给出的单句公开思路会显示为“思路”，
  隐藏的 `reasoning_content` 不直接展示或落入 activity 日志。
- 工具执行过程同时显示实际工具名和领域化动作，例如 `read_path · 正在查看连杆 base_link`、
  `write_path · 正在调整机器人名称`；成功工具回执不重复显示，内部路径会转换为领域描述。完成后仅保留一个
  可展开的“查看处理过程”。工具结果、内部 checklist 和上下文压缩信息始终不展示，也不把 activity
  混入下一轮模型历史。
- `update_plan` 是 engine-owned control capability。复杂任务可以维护最多 8 项计划，存在未完成
  计划时不会把当前草稿报告为完整结果。
- 每个 mutating tool 在事务副本上执行；工具返回失败或抛异常时丢弃副本，避免半次修改污染草稿。
- 浏览器 BYOK 运行时保留防失控的高位 backstop：每轮最多 40 个 model steps、96 个 tool calls；它不再是
  正常任务会碰到的 10 步硬限制。达到 backstop 时返回明确终态，不生成可 Apply 的半成品。
- 每次请求前用浏览器内 token meter 估算完整 system prompt、tools、消息与工具结果。达到配置模型窗口
  80% 时，先把超过 2048 tokens 的工具结果裁成首尾，再用同一模型把最旧的完整消息/tool-call 单元
  压成最多 1024 tokens 的 checkpoint，保留最近 16%；摘要请求失败时使用本地提取式摘要兜底。
- Provider 返回 context-window overflow 时会强制压缩并重试一次。checkpoint 隐藏保存在当前会话中，
  UI 继续显示原始聊天记录，下一轮模型只收到 checkpoint 与未压缩尾部，避免重复总结旧消息。
- `VITE_OPENAI_CONTEXT_WINDOW_TOKENS`（Node 环境对应 `OPENAI_CONTEXT_WINDOW_TOKENS`）应填写实际模型窗口；
  未配置或非法时采用保守的 32768。计量使用 UTF-8 bytes / 3 的偏保守跨模型估算，也可由 engine 注入
  provider-specific estimator；压缩会额外产生一次无 tools 的摘要模型请求。
- 任何成功 mutation 在生成确认卡前都必须通过确定性的 `validate_robot`。失败会把诊断回送给模型，最多
  自动修复 2 次；仍失败则阻止修改方案。停止按钮也会在批量工具之间中断，`run_script` 会终止 Worker。
- 用户点击 Apply 后，App 层会从 canonical workspace 重新读取已经提交的 `RobotData`、revision 和语义 hash，
  而不是把待应用草稿或模型的自述当作最终结果。随后发起一个不带 tools 的独立短请求，用原始用户目标、
  实际机器人拓扑/几何/位置/方向快照和结构校验结果逐项验收。比如“4 个轮子”必须能从实际 link/joint 数量、
  父子连接和相对位置得到证明；URDF 仅能 round-trip 并不代表语义或视觉结构正确。
- verifier 内部仍返回 evidence-linked `pass / fail / unknown` checklist，但普通对话 UI 永远不展示该清单，
  也不会把它混入后续聊天历史。确认卡只在检查中、检查通过或 AI 正在自动调整时更新轻量状态；`unknown`、
  provider 不可用和验证期间状态变化均静默处理，不生成额外聊天消息。发布成功状态前会再次比较 live
  workspace hash，避免把并发编辑后的机器人误报为已验证。
- 验收失败时，AI 会自动重新读取 live robot 并生成修正提案，不要求用户操作“撤回”或“生成修复”；修正提案
  仍以新的 diff 请求确认，绝不把一次确认扩张成后续修改授权。证据不足或 verifier 不可用时 fail closed，
  不显示无法确认的系统式消息，也不在后台猜测或继续改动。

### 与 DSH 当前实现的逐项对照

DSH 官方当前仍处于 developer preview。这里复用的是它的边界和生命周期思想，而不是把 Node runtime
塞进浏览器：

| DSH 思路 | URDF Studio 当前状态 | 取舍 |
|---|---|---|
| plugin 化的 agent / tool / session seam | capability registry、Studio ports、持久化 backend 已拆开 | 浏览器内保持静态受信注册，不开放运行时加载任意插件 |
| append-only typed session log，派生 replay / fork / resume | IndexedDB 追加事件、fork lineage、只读 replay、刷新恢复已具备 | 仍是单页应用级实现，不追求 DSH 的跨进程 JSONL/SQLite flush 协议 |
| pressure / overflow compaction 与 tool-result pruning | 80% 压缩、首尾裁剪、checkpoint、overflow 重试已具备 | checkpoint 对 UI 隐藏，避免增加可见噪声 |
| same-session durable goal 与 round driver | 当前只有 turn 内 plan 和自动继续，尚无跨多轮自动 goal | URDF 编辑通常应在一次 turn 内完成；只有真正长任务再增加显式 goal，避免普通对话自行唤醒 |
| `agent/turn-stopping` 等停止策略扩展点 | validation、未完成 plan、post-Apply live-state verifier 已作为停止/验收门控 | 这是最适合 URDF Studio 的 DSH 式扩展点 |
| Ralph / subagent / workflow、Shell / PTY / MCP、后台 job | 纯前端版本未提供 | 这些能力需要可信本机 sidecar；不能安全地由静态网页获得 |

需要特别说明：DSH 的 durable goal 和 Ralph 当前都把完成视为调用方/worker 的声明，官方文档明确列出
“没有独立 evaluator”。DSH 提供审批 seam、工具执行管线以及执行后 hook / session readback，足以承载
这类扩展，但不会自动判断“4 个轮子的车是否真的做对了”。本项目增加的 post-Apply live-state verifier
是面向 URDF Studio 的额外领域保证，不是假装 DSH 已经内置了通用验收器。参考：
[DSH architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、
[goal service](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/goal/goal)、
[Ralph workflow](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/workflow/tool-ralph)、
[compaction](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md)。

### 浏览器本地 Session、Fork 与 Replay

对话 timeline、Agent activity、上下文 checkpoint、修改卡及 Apply 状态以追加事件写入 IndexedDB，
不再依赖 Modal 的临时 React state。普通入口每次从关闭状态重新打开时都会创建空白 Session，不会把上一次
timeline 恢复到窗口；旧 Session 仅作为本地审计、导出和显式 replay 数据保留。“新开对话”会创建真实子
Session，同时保留当前窗口中的 UI 分隔线。Replay 只重建明确选择的已保存 timeline，不调用模型、不再次
执行工具，也不会自动 Apply 旧修改。

如果刷新发生在一次 Agent run 中间，所有非终态 activity 会恢复为 `aborted`，并追加
`run.interrupted` 记录，防止工具副作用被隐式重试。写入前会递归脱敏常见 API key、Authorization、
Bearer token 和 secret；模型服务凭据本身不会进入 Session 数据。

设置 → AI Agent → 本地会话数据可查看 Session 数、事件数和估算空间，支持导出/导入 JSON 归档及
“清理缓存”。清理操作会通知仍挂载的对话窗口同步清空内存，避免旧数据被自动写回。IndexedDB 不可用
时会安全降级为仅当前页面有效的内存仓库，设置页会明确显示“临时内存”。

### 浏览器内 Studio 操作能力

App 层通过窄 `StudioAgentPorts` 向 harness 注入语义命令，不使用 DOM selector、屏幕坐标或调试接口。
为减少每轮 tool schema 占用，默认只向模型暴露 6 个通用工具：`studio`、`read_path`、
`write_path`、`run_script`、`validate_robot` 和 engine-owned `update_plan`。原有细粒度 robot
capability 保留在内部实现中，但不进入默认模型上下文。

单一 `studio` 工具通过 `action` 复用语义入口：

- `help` 按需返回某个 action 的参数格式，例如 `input: { for: 'elements' }`；常驻 tool schema 只保留
  `action + input`，避免把所有 action 的嵌套参数长期塞进模型上下文。
- `inspect` 读取 live workspace、component、selection、focus、view 和 panel 状态。
- `elements` 按 `interactive` / `status` / `all` 分页读取当前页面的语义元素快照，包括稳定的
  会话内 `elementId`、role、accessible name、状态和值；支持 query 过滤，默认 20 条、最多 40 条，
  避免一次塞入整棵 DOM。
- `interact` 使用最近快照的 `elementId` 执行 click、focus、set-value、toggle 或 select-option，
  不使用 CSS selector、鼠标坐标或模型生成的 DOM 路径。
- `select` / `focus` 使用 canonical component-local ref 操作 assembly、component、bridge、link、
  joint 或 tendon；不存在或被交互锁阻止的目标会明确失败。
- `view` 切换 grid、axes、joint axes、inertia、center of mass、collision、opacity 和相机投影。
- `panels` 开关左右 sidebar、viewer options/joint panel，并切换 link property tab。
- `workflow` 打开 inspection setup 或 export dialog。检查启动、格式选择和文件下载仍由用户控制，
  agent 不直接下载或外发数据。

元素桥接不会返回 raw HTML。密码/API key/token 等凭据值始终脱敏且禁止写入，文件输入、外部跳转、
导出/下载和删除/清空等破坏性按钮保留为用户操作；Agent 自己的对话窗口也从元素快照中排除，避免递归操作自身。DOM 重渲染
导致目标失效时，命令会要求重新读取元素，而不是猜测位置。

同一套受控命令也挂载在 `window.urdfStudioAgent`，可直接从浏览器 Console 调试：

```js
urdfStudioAgent.inspect()
await urdfStudioAgent.elements({ kind: 'interactive', query: 'settings' })
await urdfStudioAgent.interact({ elementId: 'ui-12', operation: 'click' })
await urdfStudioAgent.select({ type: 'link', componentId: 'arm', entityId: 'base_link' })
await urdfStudioAgent.view({ showCollision: true, cameraProjection: 'orthographic' })
```

这不是任意 `eval`：Console API 与模型使用相同的 `StudioAgentPorts` 安全边界，不能访问凭据、文件系统、
任意网络或内部 Zustand store。调用 `urdfStudioAgent.help()` 可查看内置示例；Console 调用本身不进入
模型消息，因此不会消耗 AI 上下文。

这些 app command 立即作用于可逆 UI 状态，并通过工具 lifecycle event 展示；机器人持久修改
仍只在 agent draft 中完成，继续经过 validation、diff card、CAS/history 和用户 Apply。一次 turn 的
机器人 draft 固定在提交时的 component；本轮选择另一个 component 后，engine 会硬性阻断该 run
余下的 robot mutation，要求下一轮重新锁定目标，避免同名 Link/Joint 被写到旧 component。

`read_path` / `write_path` 除 `links.*`、`joints.*` 外，也支持 `name`、`rootLinkId` 等显式白名单的
RobotData 顶层字段；`__proto__` / `constructor` / `prototype` 路径和 `sourceDocument` 等非白名单数据均被拒绝。

如果后续需要 DSH 的 Shell、skills、MCP 或子 agent，正确拓扑是一个仅监听 loopback 的本机
sidecar（不一定是云后端），再通过带鉴权的 SSE / WebSocket 适配到现有 modification proposal
流程。不应 iframe DSH Web UI，也不应让 DSH 直接修改 Zustand/workspace；最终变更仍必须经过
URDF 生成/解析校验、diff card、CAS/history 和用户 apply 边界。DSH 当前是 developer preview，若引入
sidecar 需锁定精确版本并跟踪破坏性变更。
