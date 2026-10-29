# 测试指南（Testing Guide）

> 面向所有协作者（含非专业用户）的测试地图：测什么、怎么一键跑、新功能往哪加测试。
> 最后更新：2026-07-09。
> 主入口：[CLAUDE.md](../CLAUDE.md) §测试分层与 AI 选命令规则。
> 配套：[update-rules.md](update-rules.md)（验收清单）、[CATALOG.md](CATALOG.md)（文档索引）。

URDF Studio 采用大厂常见的**测试金字塔**分层：底层多而快、顶层少而慢。理解这三层，就知道任何改动该跑哪个命令、该补哪种测试。

```
        ╱ L3 语料/真值回归 ╲      少、最慢、最接近真实（真实机器人语料 + golden 对比）
      ╱────────────────────╲
    ╱   L2 浏览器 E2E 测试   ╲    中等数量、慢（真启浏览器，按功能点过用户路径）
  ╱──────────────────────────╲
╱      L1 单元测试             ╲  最多、最快（纯 Node，毫秒级，逻辑/边界）
────────────────────────────────
```

---

## L1 · 单元测试（最常用）

- **是什么**：纯 Node（`node:test` + `node:assert/strict`）测试，不启浏览器、毫秒级。覆盖解析器、store、hooks、工具函数的逻辑与边界。
- **放在哪**：紧挨源码，`src/**/*.test.*` / `src/**/*.spec.*`。新写的工具/纯逻辑就在它旁边建 `xxx.test.ts`；suite 与实时数量用 `npm run test:unit:list` 查看。
- **怎么跑**：

| 目的                          | 命令                                                   |
| ----------------------------- | ------------------------------------------------------ |
| 默认快速冒烟（CI 用）         | `npm test`                                             |
| 跑全部单元测试                | `npm run test:unit:all`                                |
| 只跑某个文件                  | `npm run test:unit -- src/core/robot/builders.test.ts` |
| 看有哪些 suite / 各有多少文件 | `npm run test:unit:list`                               |

- runner：`scripts/test/runner/run-node-tests.mjs`（管理 fast / src / all 等 suite）。

### Assembly 单真源回归矩阵

Assembly/workspace 改动至少覆盖以下不变量：

- 空白与五种直接打开格式都是 `1 component + 0 bridges`；再次打开会替换，preview 不写 store，Add 只追加且同一 source 可多实例
- component 内 ID 为 source-local；重复 link/joint/tendon 名通过 `EntityRef` 正确路由，projection global ID 只经显式双向映射解析
- 单/多 component 对 topology、material、inertial、collision、IK、tendon 和 joint motion 使用同一 mutation API；高频 motion flush 只产生一条 workspace history
- `direct-component` / `assembled-scene` 切换前后 canonical snapshot 不变，selection、transform controls 和 component root placement 往返一致
- 单组件 source-preserving export、多组件 merged/bridge/断联 bundle、library 独立导出和 USD cache 隔离均从 canonical workspace 派生
- `.usp` 仅验证严格 `3.0` single/multi roundtrip、history、active component、source drafts 与 USD cache；旧版本或损坏 manifest 必须 fail-fast，不增加迁移测试

## L2 · 浏览器端到端（E2E）测试

- **是什么**：用 Puppeteer 真启一个 headless 浏览器，按**功能**走一遍用户路径（导入模型 → 操作 → 断言）。这是"碰撞编辑、测量、拼接、导入导出、AI、主题、显示开关…"这类用户可见功能的测试层。
- **放在哪**：`scripts/test/browser/test_*.mjs`，每个文件对应一个功能；入口以 `package.json` 和 runner 列表为准。共用地基：
  - `scripts/test/helpers/browser-helpers.mjs` —— 启服务器/浏览器、文件上传、加载触发、稳定化。
  - `scripts/test/helpers/assertions.mjs` —— `createTestSuite` / `assert*` / `printSummary`。
  - `scripts/test/browser/helpers/<格式>-helpers.mjs` —— 各格式（urdf/mjcf/sdf/usd/xacro）的 `importModel`，封装"上传 + 选中 + 加载"。
- **怎么跑**：

| 目的           | 命令                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| 单个功能       | `npm run test:browser:theme`（或 `:mujoco-import` / `:measure` / `:collision-opt` / `:urdf-import` / `:usd-import` / `:xacro-import` …） |
| 全部浏览器测试 | `npm run test:browser:all`（内部调用 `run-all --browser-only`，自动发现全部 `test:browser:*`）         |
| 看有哪些       | `node scripts/test/runner/run-all.mjs --list`                                                          |

- **关键机制**：测试通过 URL 上的 `?regressionDebug=1` 暴露 `window.__URDF_STUDIO_DEBUG__` 调试接口（默认关闭，见 CLAUDE.md 红线）。helper 会自动加这个参数。
- **跑完务必清理**（CLAUDE.md 红线）：`node test/usd-viewer/scripts/cleanup-headless.cjs`。

`npm run test:browser:closed-loops` 使用 Playwright 操作真实拼接弹窗与关节滑块，验证固定朝向、旋转限位与错轴、连续旋转、滑动自由度及限位、相连多环、撤销重做、USP 保存回导和导出提示时机；还会实际下载并回导 SDF、USD、MJCF 固定闭环，检查回导后运动约束及 MJCF 活动闭环的导出保护。使用内置小模型，默认独立端口 4175；`URDF_TEST_SITE_URL` 可指定已有服务器，`CLOSED_LOOP_CASE` 可按名称筛选。数值证据、截图和下载物保存至 `tmp/regression/closed-loop-bridges/`，结束时只清理本次进程。

### 连续几何属性编辑

`npm run test:browser:geometry-edit-stability` 使用 Playwright 点击真实属性面板，连续执行 240 次旋转、位置和半径修改，覆盖默认圆柱及三个连杆的可视几何/碰撞体，并验证源码大小与缩进有界、运行时复用、撤销/重做和浏览器异常。无需外部模型，默认使用独立端口 4186；`URDF_STUDIO_TEST_SITE_URL` 可复用已有服务器，报告和截图位于 `tmp/regression/geometry-edit/`。快速单测另覆盖 URDF/Xacro/MJCF/SDF 连续源码替换，以及 tab、CRLF 和 inline XML。

### 纹理涂色与真实文件回导

`npm run test:browser:paint-roundtrip` 使用 `scripts/test/fixtures/paint_textured/` 中的小型 UV OBJ 和棋盘贴图，操作真实上色面板，覆盖单三角面/相连面、透明度 0.4 → 1、撤销/重做、恢复纹理，以及 USP/URDF/MJCF 下载后在独立浏览器上下文回导。比较颜色、透明度、纹理是否仅留在未涂面及各材质三角面数量，并检查未捕获异常和控制台错误（包括贴图加载失败）；产物位于 `tmp/regression/paint-roundtrip/`。`URDF_STUDIO_TEST_SITE_URL` 可复用构建预览。

默认验证全部三种格式；`PAINT_ROUNDTRIP_FORMATS=URDF` 可缩小调试范围。任一格式失败返回非零，后续格式仍继续验证。邻近单测还覆盖扩展/分组件 URDF、未知源码元素保留、共享网格不同涂色、同名不同目录资源、仅有纹理的 alpha、镜像绕序及原语尺寸烘焙。

### 工作流 E2E 套件（import → 属性编辑 → 源码编辑 → 导出 → 装配）

`scripts/test/e2e/test_workflow_suite.mjs`（`npm run test:workflow` / `test:workflow:quick` / `test:browser:workflow`）是跨功能的**用户旅程**层：每条旅程走完整真实用户路径——多格式导入 → 右侧属性面板改 mass/joint type/limits（GUI 输入并三重验证：面板回读 + 源码草稿 + store）→ 源代码编辑（删 link、joint→fixed、改材质色）→ File→Export 导出 → **解压导出 zip 并断言 XML 内容**；J6 装配旅程用 GUI 桥接弹窗创建 revolute/continuous/prismatic/fixed + 自环闭环桥并导出装配体。

- 6 条独立旅程（URDF/Xacro/MJCF/SDF/USD/装配），**并行浏览器跑**（默认 2——实测 3 并发会让共享 dev server 与软件 WebGL 的页面主线程互相饿死；`--concurrency` / env `URDF_TEST_WORKFLOW_CONCURRENCY` 可覆盖）。
- 并发稳定性三件套：worker **错峰启动**（每个 25s，避免浏览器+Vite 冷编译同时踩踏）、旅程失败**自动重试一次**（`--no-retry` 关闭；间歇性负载抖动重试即过，确定性 bug 两次都挂）、导出前 **chunk 预热**（旅程开头打开一次 Export dialog，防止懒加载 chunk 在高负载下卡 "Loading panel…"）。
- `--quick` 用提交在库的小 fixtures（`test/workflow-fixtures/`，无需 `test:setup`）；全量用真实语料（a1/go2/Go2 USD 等）。
- 旅程失败不中断其他旅程；聚合报告写 `tmp/regression/workflow-suite_results.json`，截图在 `tmp/e2e/workflow/`，导出物在 `tmp/e2e/workflow/downloads/`。
- 已知边界：重型 MJCF 导出（go2 的 28MB zip 在并发下被 CPU 争抢饿死、panda 的 OBJ 导出在 headless 下长时间停在 "Step 4 of 4"）不适合并发旅程，J3 全量用 skydio_x2（真实语料、~1MB 导出）；重导出路径由 `test:browser:mjcf-export` / `test:browser:assembly-export` 覆盖（panda 导出性能另行跟进）。

## L3 · 语料 / 真值回归（最慢、最真实）

- **是什么**：拿真实机器人语料（MuJoCo menagerie、Unitree、Gazebo）批量导入/导出，与预先生成的 golden/truth 数据对比。还有性能 benchmark。
- **怎么跑**：`npm run test:fixtures`（聚合）或单项 `test:fixtures:*`。需要 `test/` 下的大型语料。
- **语料从哪来**：`npm run test:setup`（克隆全部）或单项 `test:setup:*`。脚本在 `scripts/test/setup/`，幂等（已存在则跳过）。

涉及解析、导入导出、资源解析或 viewer hydration 时，按格式选择基准语料：

| 格式 / 场景 | 基准目录 |
| --- | --- |
| MJCF | `test/mujoco_menagerie-main/` |
| MJCF tendon | `test/myosuite-main/` |
| SDF | `test/gazebo_models/` |
| USD | `test/unitree_model/` |
| USDA | `test/unitree_ros_usda/` |
| URDF | `test/unitree_ros/` |
| 工作流 E2E mini fixtures | `test/workflow-fixtures/`（已提交，无需 `test:setup`） |

---

## "一口气全跑完"：统一入口 run-all

`scripts/test/runner/run-all.mjs` 把三层串起来跑，**某个失败不会中断全局**，最后打印一张通过/失败总表并写入 `tmp/regression/run-all-summary.json`。它会先起**一个共享 dev server**，让所有浏览器测试复用、不必各自冷启动 Vite。浏览器阶段按 **worker pool 并行**执行（默认 `min(4, (核数-2)/3)`，约 3-4；`--browser-concurrency <n>` 或 env `URDF_TEST_BROWSER_CONCURRENCY` 覆盖，`--headed` 强制 1）。并发 >1 时每个用例的输出落盘 `tmp/regression/logs/<npm-key>.log`（避免交错），失败的用例会在总表后回放日志尾部。

```bash
npm run test:all                                     # 便捷别名 = run-all.mjs（单元 + 全部浏览器）
node scripts/test/runner/run-all.mjs              # 单元 + 全部浏览器（默认，浏览器并行 3-4）
node scripts/test/runner/run-all.mjs --unit-only  # 只跑单元
node scripts/test/runner/run-all.mjs --browser-only --browser-concurrency 1  # 浏览器串行（调试单用例）
node scripts/test/runner/run-all.mjs --browser-only --filter export   # 只跑名字含 export 的浏览器测试
node scripts/test/runner/run-all.mjs --fixtures   # 额外带上 L3 语料回归
node scripts/test/runner/run-all.mjs --headed     # 显示浏览器窗口（调试用，自动并发 1）
node scripts/test/runner/run-all.mjs --list       # 只列出将要跑的阶段
```

> 浏览器层整体较慢（每个用例都要导入模型、构建 3D 场景）。日常开发用 `npm test`（L1）即可；提交大改动或发版前再 `run-all`。

`npm run verify:fast` 包含格式、lint、`typecheck:quality`、快速单测与构建；`npm run verify:full` 再加 fixtures，其中部分 fixture 验证会启动浏览器。两者都不自动包含全部单测、全部 browser suite、全仓 `typecheck` 或发布包构建；按变更风险单独追加。

---

## 新增功能时，该往哪一层加测试？

1. **纯逻辑 / 工具函数 / store action / 解析器**：加 **L1** 单元测试（`src/**/*.test.ts`），最优先，便宜又快。
2. **用户能在界面上操作的功能**（点按钮、拖拽、切换、导入导出）：加 **L2** 浏览器测试。
   - 在 `scripts/test/browser/` 仿照同类 `test_*.mjs` 新建一个文件；
   - 用 `createSession` 起会话、对应格式 helper 的 `importModel` 导入模型、`store.*` 操作、`assert*` 断言、`printSummary` 收尾；
   - 在 `package.json` 加一条 `test:browser:<name>`，`run-all.mjs` 会自动发现它（无需改 run-all）。
3. **涉及真实模型解析/导出正确性**：加 **L3** 语料回归（`scripts/test/truth/`）。

判断原则：**能用 L1 覆盖的逻辑就别用 L2**（快、稳、便宜）；只有"必须真跑浏览器才能验证"的交互/渲染才上 L2。

## 读懂结果

- 单元测试：末尾 `pass / fail` 计数，退出码非 0 即失败。
- 浏览器测试：每条断言一行 `[suite:<名字>] ✓/✗ ...`，结尾 `[summary:<名字>] passed/failed`。
- run-all：总表 + `tmp/regression/run-all-summary.json`；每个浏览器用例还各自写 `tmp/regression/<name>_results.json`。

### 场景编辑器整模型挂接 ZIP 回归

`src/core/parsers/mjcf/mjcfWholeModelAttachment.test.ts` 自带多根节点、frame 位姿、
同名资源、嵌套挂接和错误诊断的小样本。用户原始 `untitled_scene.mujoco(1).zip`
不纳入 Git；通过环境变量启用真实 ZIP 回归（校验 SHA-256、CRC、15 个 body
含 world、19 个 geom、8 个 mesh、4 个 free joint、家具位姿及全部文件资源路径）：

```bash
MJCF_SCENE_REGRESSION_ZIP='/absolute/path/untitled_scene.mujoco(1).zip' \
  npm run test:unit -- src/core/parsers/mjcf/mjcfWholeModelAttachment.test.ts
```

浏览器验收直接使用“文件 → 导入文件”选择同一原始 ZIP，无需改写或重新打包。
源文件的 1000 米地面会影响自动取景，检查家具时可以缩放视口并临时隐藏 world 的地面显示；
这不改变原始几何尺寸或物理参数。

`src/app/hooks/workspace-source-sync/component_mjcf_source_sync.test.ts` 覆盖可见性反复切换、
宿主共享 geom 原位编辑、挂接家具修改、草稿资源引用、`.usp` 保存重开及篡改拒绝。
同样可设置 `MJCF_SCENE_REGRESSION_ZIP` 运行原始 ZIP 的编辑和保存回归；
浏览器额外验证实际显示切换、修改家具位姿、工程重开、MJCF ZIP 导出及回导。
导出文件应由原生 MuJoCo 成功编译并保留编辑值、8 个 mesh 和 4 个家具根节点。

实际导出的 ZIP 还需按 XML 引用逐个比较 8 个家具 mesh 角色与原 ZIP 对应文件的 SHA-256，
允许内容相同的左右床头柜安全共享；原生编译同时核对家具质量与原始基线一致。
