# AI 助手与审阅

> 最后更新：2026-07-07 | 覆盖源码：`src/features/ai-assistant/`
> 交叉引用：[architecture.md](architecture.md)（ai-assistant <-> file-io 例外说明）

## 1. 环境变量与两种运行模式

AI 功能（生成 / 审查 / 对话）有两种互斥的运行模式，由环境变量决定：

**直连模式（BYOK，开源部署默认）** —— 浏览器内直接调用 OpenAI 兼容接口，key 由部署者自备：

```env
VITE_OPENAI_API_KEY=your_key
VITE_OPENAI_BASE_URL=https://api.openai.com/v1
VITE_OPENAI_MODEL=deepseek-v3
```

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
