# Visualizer 模块架构

> 3D 可视化模块，已从 1577 行单体组件重构为模块化架构（主组件 254 行）

## 目录结构

```
src/features/visualizer/
├── hooks/                      # 状态与逻辑 Hooks
│   ├── useVisualizerState.ts   # 显示选项状态（showGeometry, showVisual 等）
│   ├── useDraggablePanel.ts    # 面板拖拽、折叠
│   ├── useJointPivots.ts       # 关节 THREE.Group 引用映射
│   ├── useCollisionRefs.ts     # 碰撞 THREE.Group 引用映射
│   └── useTransformControls.ts # 变换编辑（拖拽、确认、取消）
├── utils/
│   └── materialCache.ts        # 材质缓存（getCachedMaterial）
├── components/
│   ├── panels/                 # 选项面板（可拖拽、折叠）
│   │   ├── SkeletonOptionsPanel.tsx
│   │   ├── DetailOptionsPanel.tsx
│   │   └── HardwareOptionsPanel.tsx
│   ├── nodes/                  # 场景图节点
│   │   ├── RobotNode.tsx       # 渲染 Link（递归入口）
│   │   ├── JointNode.tsx       # 渲染 Joint
│   │   └── GeometryRenderer.tsx # 渲染几何体（Box/Cylinder/Sphere/Mesh）
│   ├── controls/
│   │   ├── JointTransformControls.tsx    # Joint 变换控制
│   │   └── TransformConfirmUI.tsx        # 确认/取消 UI
│   ├── VisualizerCanvas.tsx    # Canvas + OrbitControls + Grid
│   └── Visualizer.tsx          # 主组件（编排所有模块）
└── index.ts
```

## 核心模式

### 1. 递归场景图
```
RobotNode (Link) → JointNode (Joint) → RobotNode (子 Link) → ...
```

### 2. 引用注册
子节点通过回调向父组件注册 THREE.js 对象引用：
- `onRegisterJointPivot(jointId, pivotRef)` → `useJointPivots`
- `onRegisterCollisionRef(linkId, meshRef)` → `useCollisionRefs`

### 3. 状态管理
不使用 Redux/Context，通过自定义 Hooks 解耦：
- `useVisualizerState` → 所有显示开关
- `useDraggablePanel` → 面板位置、拖拽
- `useJointPivots` → 关节引用（用于 TransformControls）
- `useCollisionRefs` → 碰撞引用（用于直接操作）
- `useTransformControls` → 编辑流程（拖拽、确认、取消）

### 4. CommonVisualizerProps
所有节点组件共享的 Props 接口：
- `robot: RobotState`
- `mode: 'skeleton' | 'detail' | 'hardware'`
- `showGeometry, showVisual, showCollision` 等显示开关
- `onRegisterJointPivot, onRegisterCollisionRef` 引用注册回调

## 组件依赖

```
Visualizer
├─ SkeletonOptionsPanel / DetailOptionsPanel / HardwareOptionsPanel
├─ VisualizerCanvas
│   ├─ RobotNode (递归)
│   │   ├─ GeometryRenderer (visual)
│   │   ├─ GeometryRenderer (collision)
│   │   └─ JointNode
│   │       └─ RobotNode (递归)
│   └─ JointTransformControls
│       └─ TransformConfirmUI
```

## AI 开发关键点

1. **添加功能**：扩展 Hooks 或创建新组件，不要修改 Visualizer.tsx
2. **材质创建**：必须使用 `getCachedMaterial()` 而非 `new THREE.MeshStandardMaterial()`
3. **类型导入**：`robot` 必须类型为 `RobotState`（不要用 `any`）
4. **引用注册**：TransformControls 依赖正确注册的 THREE.Group 引用
5. **递归结构**：保持 RobotNode ↔ JointNode 交替递归模式
