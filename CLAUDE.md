# URDF-Studio 重构助手指南

> 本文件为 Claude Code 提供项目上下文，用于模块化重构工作。

## 项目概述

**URDF Studio** 是基于 Web 的可视化机器人设计平台，用于创建、编辑和导出 URDF 模型。

- **技术栈**: React 19 + TypeScript + Three.js (R3F) + Vite + Tailwind CSS + Zustand
- **在线体验**: https://urdf.d-robotics.cc/

## 当前重构任务

正在进行**模块化重构**，将扁平结构迁移到 Feature-Based 架构。

### 相关文档


| 文档                                                       | 说明           |
| ---------------------------------------------------------- | -------------- |
| [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md)             | 当前项目结构   |
| [docs/MODULARIZATION_PLAN.md](docs/MODULARIZATION_PLAN.md) | 目标模块化架构 |
| [docs/REFACTORING_STEPS.md](docs/REFACTORING_STEPS.md)     | 渐进式重构步骤 |

### 重构阶段


| 阶段 | 名称             | 状态      |
| ---- | ---------------- | --------- |
| 1    | 基础设施准备     | ✅ 已完成 |
| 2    | 类型与工具迁移   | ✅ 已完成 |
| 3    | 核心业务逻辑迁移 | ✅ 已完成 |
| 4    | 共享组件迁移     | ✅ 已完成 |
| 5    | Store 层建立     | ✅ 已完成 |
| 6    | Feature 模块迁移 | 待开始    |
| 7    | App 层重构       | 待开始    |
| 8    | 清理与验证       | 待开始    |

## 目标架构

```
src/
├── app/                    # 应用入口 (App.tsx, AppLayout, Providers)
├── features/               # 功能模块
│   ├── robot-tree/         # 机器人树编辑器
│   ├── property-editor/    # 属性编辑器
│   ├── visualizer/         # Skeleton/Hardware 模式 3D
│   ├── urdf-viewer/        # Detail 模式 3D
│   ├── code-editor/        # 代码编辑器
│   ├── hardware-config/    # 硬件配置
│   ├── ai-assistant/       # AI 助手
│   └── file-io/            # 文件导入导出
├── core/                   # 核心业务逻辑 (无 UI)
│   ├── robot/              # 机器人数据模型
│   ├── parsers/            # 格式解析器 (urdf/mjcf/usd/xacro)
│   └── loaders/            # Mesh 加载器 (stl/obj/dae)
├── shared/                 # 共享资源
│   ├── components/         # 通用 UI 组件
│   ├── components/3d/      # 共享 3D 组件
│   ├── hooks/              # 通用 Hooks
│   ├── utils/              # 工具函数
│   └── i18n/               # 国际化
├── store/                  # Zustand 状态管理
├── types/                  # 全局类型定义
├── styles/                 # 样式文件
└── config/                 # 配置文件
```

## 重构原则

1. **渐进式迁移**: 每步完成后应用必须能正常运行
2. **向后兼容**: 使用重导出保持原有导入路径可用
3. **单一职责**: 每个文件控制在 200-400 行
4. **单向依赖**: 上层可依赖下层，下层不可依赖上层
5. **功能验证**: 每阶段完成后进行完整功能测试

### 依赖规则

```
app/ → features/ → store/ → shared/ → core/ → types/
      ↘          ↘         ↘         ↘
       (可依赖下层所有模块)
```

Features 之间**不可直接依赖**，通过 Store 通信。

## 编码规范

### 文件命名


| 类型 | 规则                | 示例                |
| ---- | ------------------- | ------------------- |
| 组件 | PascalCase          | `LinkEditor.tsx`    |
| Hook | camelCase + use前缀 | `useModelLoader.ts` |
| 工具 | camelCase           | `transforms.ts`     |
| 类型 | camelCase           | `types.ts`          |

### 导入顺序

```typescript
// 1. React
import { useState, useCallback } from 'react'

// 2. 第三方库
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

// 3. Store
import { useRobotStore, useUIStore } from '@/store'

// 4. 同级模块
import { LinkRenderer } from './LinkRenderer'

// 5. Shared
import { Button } from '@/shared/components'
import { CoordinateAxes } from '@/shared/components/3d'

// 6. Core
import { parseURDF } from '@/core/parsers'

// 7. Types
import type { UrdfLink } from '@/types'
```

### 模块导出

每个模块必须有 `index.ts` 导出公共 API：

```typescript
// features/property-editor/index.ts
export { PropertyEditor } from './components/PropertyEditor'
export { usePropertyForm } from './hooks/usePropertyForm'
export type { PropertyEditorProps } from './types'
```

## 迁移策略

### 重导出模式

迁移文件时，原文件改为重导出，保持向后兼容：

```typescript
// services/urdfParser.ts (原文件)
export * from '@/core/parsers/urdf/urdfParser'
```

### 双写模式 (Store 迁移)

状态迁移时同时更新新旧两边：

```typescript
const setAppMode = useCallback((mode) => {
  setAppModeLocal(mode)   // 原有 state
  setAppModeStore(mode)   // Zustand store
}, [])
```

## 常用命令

```bash
# 开发
npm run dev              # 启动开发服务器 (localhost:3000)
npm run build            # 生产构建
npm run preview          # 预览构建

# 创建 Feature 模块
mkdir -p src/features/my-feature/{components,hooks}
touch src/features/my-feature/index.ts

# 创建共享组件
mkdir -p src/shared/components/MyComponent
touch src/shared/components/MyComponent/{MyComponent.tsx,index.ts}
```

## 路径别名

```typescript
import { Something } from '@/store'           // src/store
import { Something } from '@/features/xxx'    // src/features/xxx
import { Something } from '@/shared/xxx'      // src/shared/xxx
import { Something } from '@/core/xxx'        // src/core/xxx
import { Something } from '@/types'           // src/types
import { Something } from '@legacy/xxx'       // 原有位置 (临时)
```

## 关键大文件

需要拆分的主要文件：


| 文件                 | 当前行数 | 目标                      |
| -------------------- | -------- | ------------------------- |
| `App.tsx`            | ~2,734   | 拆分到 app/ + store/      |
| `RobotModel.tsx`     | ~2,273   | 拆分到 urdf-viewer/model/ |
| `Visualizer.tsx`     | ~1,575   | 拆分到 visualizer/        |
| `PropertyEditor.tsx` | ~1,151   | 拆分到 property-editor/   |
| `mjcfLoader.ts`      | ~1,225   | 拆分到 core/parsers/mjcf/ |

## 核心数据结构

```typescript
// 机器人状态
interface RobotState {
  name: string
  links: Record<string, UrdfLink>
  joints: Record<string, UrdfJoint>
  rootLinkId: string
  materials?: Record<string, Material>
}

// UI 状态
interface UIState {
  appMode: 'skeleton' | 'detail' | 'hardware'
  selection: { type: 'link' | 'joint' | null; id: string | null }
  viewOptions: { showGrid, showAxes, showInertia, ... }
  panels: { codeEditor, aiAssistant }
}
```

## 验证清单

每完成一个阶段，验证以下内容：

- [ ]  `npm run dev` 正常启动
- [ ]  `npm run build` 无错误
- [ ]  控制台无错误/警告
- [ ]  三种模式 (Skeleton/Detail/Hardware) 正常切换
- [ ]  导入功能正常 (URDF/MJCF/USD/Xacro)
- [ ]  导出功能正常
- [ ]  TreeEditor 编辑正常
- [ ]  PropertyEditor 编辑正常
- [ ]  3D 渲染正常
- [ ]  Undo/Redo 正常

## 注意事项

1. **每步提交 Git**: 便于回滚
2. **先读后改**: 修改文件前先理解现有逻辑
3. **保持运行**: 任何时候 `npm run dev` 都应该能启动
4. **避免大改**: 每次改动尽量小，频繁验证
5. **类型安全**: 保持 TypeScript 严格模式，不使用 `any`
6. **不删原文件**: 迁移完成前，原文件改为重导出而非删除

## 快速参考

### 当前工作目录结构

```
URDF-Studio/
├── App.tsx              # 主应用 (需拆分)
├── types.ts             # 类型定义 (需迁移到 src/types/)
├── components/          # 组件 (需迁移到 src/features/)
├── services/            # 服务 (需迁移到 src/core/)
├── hooks/               # Hooks (需迁移到 src/shared/hooks/)
└── src/                 # 新模块化目录 (逐步填充)
```

### 核心文件位置


| 功能        | 当前位置                             | 目标位置                        |
| ----------- | ------------------------------------ | ------------------------------- |
| URDF 解析   | services/urdfParser.ts               | src/core/parsers/urdf/          |
| 3D 模型渲染 | components/URDFViewer/RobotModel.tsx | src/features/urdf-viewer/model/ |
| 属性编辑    | components/PropertyEditor.tsx        | src/features/property-editor/   |
| 状态管理    | App.tsx (useState)                   | src/store/ (Zustand)            |
| 共享 3D     | components/shared/                   | src/shared/components/3d/       |
