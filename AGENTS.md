# URDF Studio Agent Guide

内容已合并到 [CLAUDE.md](CLAUDE.md)。本文件保留为兼容入口，所有 agent 上下文请直接读 `CLAUDE.md`。

同步提醒：

- 更新 agent 规则时以 `CLAUDE.md` 为主，必要时同步本兼容入口。
- `scripts/` 已统一为 `build/`、`generate/`、`test/`、`tools/`、`release/` 五类；新增或移动脚本时不要恢复旧目录名，具体结构以 `CLAUDE.md` 的 `scripts/ 目录结构` 为准。
- 机器人源文件格式检测以 `src/core/parsers/format_detection.ts` 为 canonical source；`app` / `features/file-io` 只保留 workflow wrapper，不重复实现格式判断。
- viewer backend 生命周期归 `src/features/urdf-viewer/renderers/`；`src/shared/components/3d/renderers/` 只放纯 mesh renderer 组件与 Collada scene helpers。
- workspace/source 同步策略优先放 `src/app/hooks/workspace-source-sync/` 或 `workspace-mutations/` 子模块，避免继续堆大 `useWorkspaceSourceSync.ts` / `workspaceSourceSyncUtils.ts`。
- `npm run dev` 默认绑定 `127.0.0.1`；远程开发端口转发、容器或局域网访问需显式使用 `URDF_STUDIO_DEV_HOST=0.0.0.0 npm run dev`，具体说明以 `CLAUDE.md` 的 `开发服务器访问` 为准。
- 浏览器验证、Playwright/Puppeteer、浏览器回归脚本结束后，必须按 `CLAUDE.md` 清理残留浏览器进程；优先运行 `node test/usd-viewer/scripts/cleanup-headless.cjs`，不要使用会误杀用户浏览器的宽泛 `pkill chrome` / `killall chrome`。
