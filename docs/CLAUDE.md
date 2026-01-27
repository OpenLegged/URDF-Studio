# URDF-Studio 开发指南

> 本文件为 Claude Code 提供项目上下文。

## 重构状态

✅ **模块化重构已完成** (2025-01)

与 `docs/MODULARIZATION_PLAN.md` 计划相比的简化：

- 入口文件使用 `main.tsx`（Vite 标准命名）
- 样式文件合并为单个 `index.css`（Tailwind 4.0）
- 省略了空的 `config/` 目录

## 项目概述

**URDF Studio** - 基于 Web 的可视化机器人设计平台

- **技术栈**: React 19 + TypeScript + Three.js (R3F) + Vite + Tailwind CSS + Zustand
- **在线体验**: https://urdf.d-robotics.cc/

## 项目结构

```
urdf-studio/
├── index.html              # HTML 入口
├── vite.config.ts          # Vite 配置
├── tsconfig.json           # TypeScript 配置
├── package.json            # 依赖配置
├── public/                 # 静态资源
│   ├── logos/              # Logo 图片
│   └── samples/            # 示例机器人文件
├── docs/                   # 文档
└── src/                    # 源代码
    ├── main.tsx            # 应用入口
    ├── styles/             # 全局样式
    │   └── index.css       # Tailwind CSS 配置
    ├── app/                # 应用层
    │   ├── index.ts        # 导出
    │   ├── App.tsx         # 主应用组件
    │   ├── AppLayout.tsx   # 布局组件
    │   ├── Providers.tsx   # Provider 组合
    │   ├── components/     # 应用级组件 (Header, Modals)
    │   └── hooks/          # 应用级 Hooks
    ├── features/           # 功能模块
    │   ├── robot-tree/     # 机器人树结构编辑器
    │   ├── property-editor/# 属性编辑器
    │   ├── visualizer/     # 3D 可视化器
    │   ├── urdf-viewer/    # URDF 查看器
    │   ├── code-editor/    # 代码编辑器
    │   ├── hardware-config/# 硬件配置
    │   ├── ai-assistant/   # AI 助手
    │   └── file-io/        # 文件导入导出
    ├── core/               # 核心逻辑
    │   ├── robot/          # 机器人模型操作
    │   ├── parsers/        # URDF/MJCF/USD 解析器
    │   └── loaders/        # 资源加载器
    ├── shared/             # 共享模块
    │   ├── components/     # 通用 UI 组件
    │   ├── hooks/          # 通用 Hooks
    │   ├── utils/          # 工具函数
    │   └── i18n/           # 国际化
    ├── store/              # Zustand 状态管理
    │   ├── robotStore.ts   # 机器人状态
    │   ├── uiStore.ts      # UI 状态
    │   ├── selectionStore.ts # 选中状态
    │   └── assetsStore.ts  # 资源状态
    └── types/              # TypeScript 类型定义
```

## 依赖规则

```
app/ → features/ → store/ → shared/ → core/ → types/
```

- Features 之间**不可直接依赖**，通过 Store 通信
- 使用 `@/` 路径别名引用 src 目录

## 常用命令

```bash
npm run dev      # 开发服务器 (http://localhost:3000)
npm run build    # 生产构建
```

## 功能说明

### 三种编辑模式

- **Skeleton Mode**: 骨架编辑模式
- **Detail Mode**: 详细编辑模式
- **Hardware Mode**: 硬件配置模式

### 支持的文件格式

- **导入**: URDF, MJCF, USD, ZIP
- **导出**: URDF, MJCF, USD

### 主要功能

- 3D 可视化和交互
- 机器人结构树编辑
- 属性面板编辑
- 代码编辑器 (Monaco)
- AI 辅助设计
- Undo/Redo 支持
- 多语言支持 (中/英)
- 深色/浅色主题
