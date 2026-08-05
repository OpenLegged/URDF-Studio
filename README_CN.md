<div align="center">

# URDF Studio

[![React](https://img.shields.io/badge/React-19.2-blue?logo=react)](https://reactjs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.181-black?logo=three.js)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-purple?logo=vite)](https://vitejs.dev/)
[![Zustand](https://img.shields.io/badge/Zustand-5-green?logo=react)](https://zustand-docs.netlify.app/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

面向 `URDF`、`MJCF`、`USD`、`Xacro`、`SDF` 和 `.usp` 项目工作流的机器人设计、组装、可视化与导出工作台。支持快速编辑、碰撞优化、模块化组装、参数配置、AI 生成与多格式导出。

**在线体验：** [urdf.enkeebot.com](https://urdf.enkeebot.com/)

[English](./README.md) | [中文](./README_CN.md)

</div>

---

## 项目简介

URDF Studio 是一个运行在浏览器中的机器人建模环境，用来处理机器人拓扑、视觉/碰撞几何体、硬件参数与多文件工作区，并完成多格式导出交付，而不需要每次操作都直接手写 XML。

当前版本整合了：

- **单模式 Editor**：拓扑编辑、几何/碰撞/测量、硬件参数配置统一在一个 Editor 中
- **多机器人组装**：bridge joint 创建、workspace 文件管理、基于组件的机器人装配
- **AI 助手**：AI 驱动的机器人生成、检查与审阅，并支持 PDF/CSV 报告导出
- **worker 化链路**：导入/导出配合 USD runtime hydration、prepared export cache 与 roundtrip archive 工作流
- **丰富的可视化**：React Three Fiber 工作区画布，运行时 URDF/MJCF/USD viewer，配合 transform controls 与 helper overlay

包身份说明：

- 根应用：`urdf-studio@2.0.0`（私有工作区应用）
- 对外发布包：`@urdf-studio/react-robot-canvas@0.1.0`

版本管理约定：

- 私有应用与对外发布包采用各自独立的语义化版本
- 应用版本在构建时注入前端，并显示在 About 弹窗中
- 版本升级统一通过 `npm run version:bump`，不要手改多个清单文件

## 核心能力

### 编辑能力

- **拓扑编辑**：通过 link/joint 拓扑工具构建与编辑运动学树
- **几何与碰撞**：编辑 visual mesh、collision mesh、测量与碰撞优化策略
- **硬件配置**：配置电机型号、传动比、阻尼、摩擦与硬件元数据
- **编辑模式**：单一统一的 Editor 模式，包含拓扑、几何/碰撞/测量与硬件配置标签页

### 工作区与组装

- **文件管理**：导入单文件、文件夹、ZIP 包与 `.usp` 项目归档
- **工作区同步**：维护 workspace 文件树、源码文本与跨 viewer 的选中状态同步
- **多机器人组装**：将多个机器人装配到同一工作区，通过 bridge joint 连接并进行组件管理
- **历史与缓存**：保留历史记录、pending edit 与预解析机器人缓存

### 可视化

- **React Three Fiber**：服务于 Editor 与 URDF/USD viewer 的共享工作区画布
- **运行时 viewer**：原生 URDF/MJCF viewer 与 vendored USD runtime
- **USD 集成**：stage preparation、hydration、metadata extraction 与 offscreen worker 渲染
- **交互**：截图采集、helper overlay、transform controls 与碰撞编辑链路

### 导出与互操作

- **多格式导出**：`URDF`、`MJCF`、`USD`、`SDF`、`Xacro`、CSV/BOM、PDF、ZIP 与 `.usp` 项目归档
- **worker 化链路**：project archive、USD export 与 USD binary archive 转换
- **roundtrip 支持**：配合 prepared export cache 的 USD archive 生成，服务 roundtrip 工作流
- **包工作区**：对外复用的 `@urdf-studio/react-robot-canvas` 包

### AI 助手

- **生成**：基于自然语言描述生成机器人结构
- **检查**：基于可配置标准的自动化机器人检查与问题识别
- **报告导出**：生成包含检查结果的 PDF 与 CSV 报告
- **审阅**：AI 辅助的代码审阅与优化建议

## 技术栈

- **前端**：React 19.2、TypeScript 5.8、Vite 6.2
- **3D**：Three.js 0.181、React Three Fiber 9、@react-three/drei 10
- **状态管理**：Zustand 5
- **样式**：Tailwind CSS 4.1
- **解析 / 导出**：位于 `src/core` 的 URDF、MJCF、USD、Xacro、SDF、mesh、图像压缩与 STL 管线
- **打包导出**：JSZip、jsPDF、libarchive.js
- **AI**：OpenAI SDK，配合自定义检查标准与 prompt 模板生成
- **包工作区**：`packages/react-robot-canvas`

## 仓库结构

```text
src/
  app/                  应用编排层：shell、viewer 组合、导入导出、workspace/source 同步
  features/             业务功能模块
    ├── ai-assistant/        AI 生成与审阅
    ├── assembly/            bridge joint 创建与多机器人组装
    ├── code-editor/         基于 Monaco 的源码编辑器
    ├── editor/              统一 Editor 公开入口
    ├── file-io/             文件能力：格式检测、project archive、导出
    ├── hardware-config/     电机与硬件参数配置
    ├── property-editor/     属性编辑、几何编辑、碰撞优化
    ├── robot-tree/          文件树与结构树
    └── urdf-viewer/         Editor 实现：拓扑/几何/碰撞 + USD runtime
  store/                Zustand store（robot、ui、selection、assets、assembly 等）
  shared/               共享组件、3D 基础设施、hooks、i18n、debug 辅助
  core/                 纯逻辑：解析器、robot core、mesh loaders、图像/STL 压缩、diagnostics
  lib/                  对外复用的 RobotCanvas 封装
  styles/               全局样式与语义 token
  types/                跨模块类型定义
packages/react-robot-canvas/
  可发布的复用包工作区
docs/
  架构说明、viewer 文档、file-io 文档、style guide、AI features
scripts/
  build/、generate/、test/（browser/e2e/fixtures/truth/benchmark）、tools/、release/
public/
  静态资源、Monaco editor、USD WASM bindings、示例机器人
test/
  大型 fixture 语料、浏览器回归样本、外部镜像工程
tmp/
  截图、trace、临时验证产物
output/
  用户可见导出与需要保留的验证产物
```

架构补充：

- **依赖方向**：`app -> features -> store -> shared -> core -> types`（不引入反向依赖）
- **core 纯度**：`src/core` 保持纯函数逻辑，不引入 React/UI/Feature 依赖
- **Editor 实现**：`src/features/urdf-viewer` 是当前最重的 feature 区域，同时包含 React UI、vendored USD runtime、adapter/util 层与 worker 驱动的 offscreen 渲染
- **编排层**：`src/app` 负责 document loading、viewer handoff、导入导出编排、pending history 与 binary/archive worker bridge

## 快速开始

### 环境要求

- Node.js 18 或更高版本
- npm
- 用于本地 USD 验证的现代 Chromium 浏览器

### 安装

```bash
git clone https://github.com/OpenLegged/URDF-Studio.git
cd URDF-Studio
npm install
```

### 可选环境变量

项目即使没有 AI 凭据也可以运行。如果需要启用 AI 生成 / AI 审阅，请设置 `vite.config.ts` 注入到前端运行时的环境变量：

```bash
# AI 助手的 OpenAI 配置
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini

# 当 OPENAI_API_KEY 未设置时，GEMINI_API_KEY 会作为备选键
GEMINI_API_KEY=
```

可以放到 `.env.local` 中。

### AI 功能

AI 助手提供：

- **机器人生成**：根据自然语言描述生成机器人结构
- **检查**：基于可配置标准的自动化机器人检查
- **审阅**：AI 辅助的代码审阅与优化建议
- **报告导出**：生成包含检查结果的 PDF 与 CSV 报告

没有 API key 时，AI 功能会被禁用，但应用的其余部分仍可完整使用。

### 启动应用

```bash
npm run dev
```

打开：

- `http://127.0.0.1:3000`
- 编辑器或远程开发环境提供的端口转发 URL

当前 Vite dev server 默认监听 `127.0.0.1`，用于本机 IPv4 回环访问，并返回 USD WASM runtime 所需的 cross-origin isolation headers。
如需远程开发端口转发、容器或局域网访问，运行 `URDF_STUDIO_DEV_HOST=0.0.0.0 npm run dev`。
如果预览 / 隧道域名被 Vite host check 拒绝，可以用逗号分隔的 allow-list：`URDF_STUDIO_DEV_ALLOWED_HOSTS=preview.example.test,.tunnel.example.test npm run dev`。

## USD 运行时要求

USD 加载依赖 `SharedArrayBuffer`，因此页面必须处于 cross-origin isolated 环境。

- 开发使用 `npm run dev`
- 本地验证生产构建使用 `npm run preview`
- 优先使用 `127.0.0.1` / `localhost` 或 HTTPS
- 直接使用 `http://<LAN-IP>:3000` 可以加载应用外壳，但 USD 导入 / stage open 需要 HTTPS 或可信的 localhost 风格转发源
- 不要用缺少下列响应头的普通静态服务器直接托管 `dist/`

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-site
```

如果这些响应头不存在，应用壳可能仍然能打开，但 USD 导入 / stage open 会失败。

## 常用命令

```bash
# 开发
npm run dev                    # 启动开发服务器
npm run dev:with-generate      # 启动开发服务器并先生成 AI prompt
npm run build                  # 构建应用
npm run preview                # 预览生产构建

# 质量与验证
npm run lint                   # 运行 ESLint 与 stylelint
npm run typecheck              # 全仓 TypeScript 债务检查（含测试）
npm run typecheck:quality      # 排除 test/spec 的 TypeScript 检查
npm run check                  # 运行 verify:fast（格式、lint、运行时 typecheck、测试、构建）
npm run verify:fast            # 快速验证（不含 fixture 测试）
npm run verify:full            # 完整验证（含 fixture 测试）
npm test                       # 运行单元测试
npm run test:unit -- path/to/file.test.ts  # 运行定向 Node 测试
npm run test:unit:all          # 运行全部源码邻近 Node 测试
npm run test:unit:list         # 列出测试 runner 管理的 suite

# 格式化
npm run format                 # 用 Prettier 格式化
npm run format:check           # 检查格式

# 版本管理
npm run version:show           # 查看当前版本
npm run version:bump -- --app minor      # 升级应用版本
npm run version:bump -- --package patch  # 升级发布包版本

# AI 功能
npm run generate               # 生成 AI prompt 模板与检查标准
npm run generate:check         # 检查是否需要重新生成
npm run build:with-generate    # 带生成步骤的构建

# 包工作区
npm run build:package:react-robot-canvas   # 构建 react-robot-canvas 包
npm run pack:package:react-robot-canvas     # 打包预览

# schema 与对比工具
npm run code-editor:generate-urdf-schema    # 为代码编辑器生成 URDF schema
npm run mjcf:compare                         # 对比 MJCF 解析与参考结果
npm run sdf:compare                          # 对比 SDF 解析与参考结果

# 回归与 fixture 测试
npm run regression:shadow-hand-hover         # shadow hand hover 回归
npm run test:fixtures:imports                # 校验导入 fixture 矩阵
npm run test:fixtures:unitree-ros-urdfs      # 校验 Unitree ROS URDF
npm run test:fixtures:unitree-usd            # 校验 Unitree USD 导出
npm run test:fixtures:unitree-ros-usda       # 校验 Unitree USDA 导出
npm run test:fixtures:isaacsim-truth         # 对照 IsaacSim 真值校验
```

## 测试与验证

仓库提供统一的根级质量命令，用于格式化、Lint 和本地校验：

- `npm run format`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck:quality`
- `npm run check`

`npm run typecheck` 仍保留为全仓 TypeScript 债务检查。`npm run check` 当前使用 `npm run typecheck:quality`，它会先排除 test/spec 文件，以便在测试夹具持续迁移期间保持 runtime 编译为绿。

Git hooks 和托管 CI 配置不是运行项目的必要条件；共享改动前手动运行对应质量命令即可。

`npm test` 当前只覆盖仓库内可自给的测试，不包含依赖 `test/` 外部大型语料的 fixture 回归。

Node 测试入口统一收敛在 `scripts/test/runner/run-node-tests.mjs`。单元测试应邻近源码放置在 `src/**/*.test.*` 或 `src/**/*.spec.*`；定向验证用 `npm run test:unit -- path/to/file.test.ts`，需要源码邻近全量覆盖时用 `npm run test:unit:all`。

通常通过以下方式完成验证：

- 在改动模块旁运行定向 `npm run test:unit -- path/to/file.test.ts`
- 运行 `scripts/test/` 下的定向回归脚本
- 使用 `npm test` 跑 `npm run verify:fast` 采用的仓库内快速测试
- 执行 `npm run build`
- 如果改动了 `src/lib` 或 `packages/react-robot-canvas`，补跑包构建
- 通过 `npm run test:fixtures:*` / `npm run verify:full` 针对 `test/` 下的大型 fixture 语料做回归检查，尤其是 `test/unitree_model`、`test/gazebo_models`、`test/awesome_robot_descriptions_repos`、`test/usd-viewer`

## 文档入口

- [架构边界](./docs/architecture.md)
- [Viewer 与 Editor 指南](./docs/viewer.md)
- [导入导出与导出指南](./docs/file-io.md)
- [样式指南](./docs/style-guide.md)
- [AI 功能指南](./docs/ai-features.md)
- [测试指南](./docs/testing.md)
- [WASM 构建指南](./docs/wasm-build.md)
- [更新规则与验证](./docs/update-rules.md)
- [Robot Canvas 库说明](./docs/robot-canvas-lib.md)
- [完整文档索引](./docs/CATALOG.md)
- [Agent 规范](./AGENTS.md)

## 包工作区

仓库内同时包含可发布的包工作区：

- **`@urdf-studio/react-robot-canvas`**（`packages/react-robot-canvas`）

这个包对外提供可复用的 `RobotCanvas` 组件，用于在独立 React 应用中嵌入 URDF/MJCF 查看能力，而不需要带上完整的 URDF Studio 应用壳。它收纳从主应用提取出的稳定、通用的 3D 机器人可视化能力。

构建与打包命令：

```bash
npm run build:package:react-robot-canvas   # 构建包
npm run pack:package:react-robot-canvas     # 打包预览
```

## 贡献说明

- **依赖方向**：保持符合 `app -> features -> store -> shared -> core -> types`
- **代码复用**：优先复用现有 hooks / utils，而不是重复实现 viewer 或 export 逻辑
- **core 纯度**：保持 `core/` 为纯函数逻辑，不引入 React / UI / Feature 依赖
- **资源管理**：引入 `ResizeObserver`、timer、worker listener 或 THREE 资源时补充对称 cleanup
- **文档**：阅读 [AGENTS.md](./AGENTS.md) 了解详细架构、执行准则与样式约束
- **验证**：共享改动前运行 `npm run verify:fast`；需要完整校验时运行 `npm run verify:full`
- **临时产物**：临时截图、trace 与浏览器验证产物统一放到 `tmp/`

## 许可证

本项目采用 **Apache License 2.0**，详见 [LICENSE](./LICENSE)。

## 致谢

感谢 [D-Robotics](https://developer.d-robotics.cc/) 提供支持。

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=OpenLegged/URDF-Studio&type=date&legend=top-left&sealed_token=kmdzy1ZL1gzaZEez2FPky5BCbmG644II3h8OxV87IkopAIxkAjpqQ6jq65_0QMBWYuH6G62jkznUpYlrhPrQRj-jfp73tthAW_G3pLzJSLFdt1f095YGhfkDYeeqVxSLmunIPddDPTq9bNstiWPWoNZJ608oJfa5PVWTGmQ7rrha-TDqWUwqEbZV1ZmL)](https://www.star-history.com/?repos=OpenLegged%2FURDF-Studio&type=date&legend=top-left)
