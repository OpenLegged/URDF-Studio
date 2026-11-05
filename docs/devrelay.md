# DevRelay 工程流程

本仓的共享规则维护在 [`.devrelay/config.toml`](../.devrelay/config.toml)。
[DevRelay](https://github.com/kleinlau17/DevRelay) 在用户环境安装一次，多个项目共用；
无需项目专用启动脚本或仓内 runtime。已包含配置的 checkout 不必再次 `init`。

## 本地入口

每个 Git 仓库选定一个 controller checkout；它可以是现有仓库目录，也可以是专用 Git 工作树。
任务工作树和状态由 DevRelay 管理，同仓不同 checkout 共享状态，不重复建立 controller。
以下命令中的 `/path/to/urdf-studio` 替换为选定的 controller 路径。

```bash
devrelay --project /path/to/urdf-studio doctor --with-codex
devrelay --project /path/to/urdf-studio status
devrelay --project /path/to/urdf-studio next
devrelay --project /path/to/urdf-studio ui --open
```

要在一个网页管理多个独立项目，可在用户级 `~/.config/devrelay/projects.toml` 登记：

```toml
[[projects]]
id = "urdf-studio"
name = "URDF Studio"
path = "/path/to/urdf-studio"
```

```bash
devrelay ui --catalog ~/.config/devrelay/projects.toml --open
```

该清单是可选的本机配置，不提交到本仓；`path` 也可相对清单文件填写。
省略 `runtime` 即共用启动网页的 DevRelay 安装。网页保存的是项目内的配置文件，
共享策略修改仍须审查差异并通过 PR 入库。保存、查询队列和自检不会启动任务或后台 worker。

## 授权和交付

- 仓库 `OpenLegged/URDF-Studio`，目标 `origin/dev`。
- `queue.allowed_authors = ["kleinlau17"]`；其他作者或无法确认作者的 Issue 不进入执行与交付。
- `queue.mode = "manual"`，人工 Issue 与 Agent 新发现均须维护者确认范围和验收后添加 `auto:approved`。
- `discovery.enabled = true`、`discovery.auto_triage = false`：可记录后续问题，每任务最多 3 个，不自动扩大执行范围。
- 优先级为 `priority:P0` / `priority:P1` / `priority:P2`；`blocked`、`needs-input` 和计划父项不能执行。
- 总体计划使用 `scope:plan` 或 `Task kind: plan`，只给可独立验收的子任务授权。
- 依赖写明 `Depends on: none` 或具体 Issue；省略表示无依赖，执行仍须满足依赖门禁。

先查看 `status`、`next` 并恢复已有任务。默认由当前 Agent 在返回的任务工作树实现：

```bash
devrelay --project /path/to/urdf-studio start ISSUE_NUMBER
devrelay --project /path/to/urdf-studio prepare ISSUE_NUMBER
# 在 start 返回的任务工作树调查和实现。
devrelay --project /path/to/urdf-studio check ISSUE_NUMBER
devrelay --project /path/to/urdf-studio submit ISSUE_NUMBER
```

`submit` 创建或更新草稿 PR，并开启新的只读 Codex 会话独立审查。审查失败保留现场，
按同一任务回修；实现预算为三次，不重置预算绕过阻塞。源码、需求、配置或目标基线变化后重新验收。
`auto_merge = false`，不自动清理任务分支或工作树；合并后的检查保持开启。
PR 由仓库负责人志楷审核实际内容和本地 CI 记录，通过后再按授权合并；不直接推进受保护分支。

`run/resume/watch` 是可选编排入口，不因安装工具、登记项目或添加模板自动启用。
`doctor` 检查工具、配置和登录，不执行产品验收，也不证明模型调用可用。
凭据沿用本机已登录的 `gh` / Codex，不写入配置、Issue 或验收证据。

## 准备与验收

`prepare` 执行 `npm ci`；`check` 执行 `npm run verify:fast`，包括格式、lint、
quality typecheck、快速单测与构建。它不包含所有单测、浏览器回归或发布包构建；
按任务风险补齐 [测试指南](testing.md) 和 [更新规则](update-rules.md) 要求的验证。
失败时修复原因，不放宽 baseline 或跳过门禁。

US 是 USP 的 core 上游；US 的 PR 不自动更新 USP 的 core 指针。
跨仓集成单独授权，核对固定 SHA、依赖及 Pro 集成验收，不把单仓成功当作联合验收。

Issue 模板不附带执行授权；模板进入 GitHub 默认分支后才显示在新建 Issue 页面。
