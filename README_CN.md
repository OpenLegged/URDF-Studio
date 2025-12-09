<div align="center">

# URDF Architect

[![React](https://img.shields.io/badge/React-19.2-blue?logo=react)](https://reactjs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.181-black?logo=three.js)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-purple?logo=vite)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**下一代可视化机器人设计平台**

**在线体验：** https://urdf.d-robotics.cc/

[English](./README.md) | [中文](./README_CN.md)

</div>

---

## 📖 概览

**UrdfArchitect** 是一款先进的 Web 端可视化机器人设计环境，专为简化 URDF（Unified Robot Description Format）模型的创建、编辑与导出而生。通过将繁琐的 XML 代码编写抽象为直观的图形化交互，它赋予机器人工程师专注于设计创新与架构验证的能力。

该平台覆盖了机器人建模的全生命周期——从运动学骨架的构建，到高保真几何细节的打磨，再到精密硬件参数的配置。结合 **生成式 AI** 的强大能力，UrdfArchitect 显著加速了原型设计流程，并确保与 MuJoCo 等工业级仿真生态系统的无缝兼容。


## ✨ 核心能力

### 🦴 多维设计模式

| 模式 | 功能描述 |
|------|---------|
| **Skeleton (骨架)** | 快速构建运动学链条 (Links & Joints)，精准定义拓扑结构与自由度。 |
| **Detail (细节)** | 精细化编辑视觉外观与碰撞流形，支持基础几何体及高精度网格模型 (STL/OBJ/DAE) 导入。 |
| **Hardware (硬件)** | 深度配置机电参数，包括执行器选型、力矩约束及传动比设定。 |

### 🎨 沉浸式 3D 工作区

- **高保真渲染**: 基于 **Three.js** 与 **React Three Fiber** 构建，提供响应迅速、逼真的设计体验。
- **直观操控**: 采用工业标准的变换控件 (Gizmos)，实现对机器人部件的精确空间操控。
- **可视化分析**: 实时显示关节轴向、参考坐标系及碰撞边界，确保设计的物理合理性。

### 🤖 AI 增强工程

集成 **Google Gemini AI**，UrdfArchitect 引入了自然语言交互接口，重塑机器人设计体验：
- *"生成一个四足移动平台"*
- *"在 base_link 上集成一套激光雷达阵列"*
- *"根据力矩需求为髋关节推荐最优执行器"*

### 📥 无缝互操作性

- **导入**: 轻松加载包含 URDF 定义及网格资产的 ZIP 归档项目。
- **导出**: 一键生成生产级机器人资源包：
  - `urdf/`: 标准 URDF + 扩展 URDF（富含硬件元数据）。
  - `meshes/`: 自动整合所有引用的 3D 资产。
  - `hardware/`: 自动生成 CSV 格式的物料清单 (BOM)。
  - `mujoco/`: 自动配置 XML 文件，支持即时 MuJoCo 仿真。

### ⚙️ 内置电机库

预置多款主流机器人电机参数，方便快速选型：
- **Unitree (宇树)**: Go1, A1, B1 系列。
- **RobStride**: RS 系列。
- 支持自定义电机库扩展。

## 🚀 本地部署

### 环境要求

- Node.js 18+
- npm 或 yarn

### 安装与运行

1. **克隆项目**
   ```bash
   git clone https://github.com/Wangxinhui-bot/UrdfArchitect.git
   cd UrdfArchitect
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **配置 API Key（可选）**
   如需使用 AI 功能，请在根目录创建 `.env.local` 文件并添加：
   ```env
   API_KEY=your_google_gemini_api_key
   ```

4. **启动开发服务器**
   ```bash
   npm run dev
   ```
   访问 `http://localhost:5173` 开始使用。

## 📁 项目结构

```
UrdfArchitect/
├── App.tsx                 # 主应用组件 / Main Application
├── components/             # UI 组件 / UI Components
│   ├── TreeEditor.tsx      # 树形结构编辑器 / Tree View
│   ├── Visualizer.tsx      # 3D 可视化器 / 3D Viewport
│   └── PropertyEditor.tsx  # 属性面板 / Properties Panel
├── services/               # 核心逻辑服务 / Core Services
│   ├── urdfGenerator.ts    # URDF 生成 / Generation
│   ├── urdfParser.ts       # URDF 解析 / Parsing
│   ├── mujocoGenerator.ts  # MuJoCo 生成 / MuJoCo Export
│   ├── geminiService.ts    # AI 服务 / AI Integration
│   └── motorLibrary.ts     # 电机库 / Motor Data
└── ...
```

## 📄 License

MIT License

## 特别致谢
地瓜机器人 https://developer.d-robotics.cc/
