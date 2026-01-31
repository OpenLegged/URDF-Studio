# URDF Viewer 模块架构

> 基于 urdf-loader 的 3D 机器人模型查看器，支持 Detail/Hardware 模式

## 目录结构

```
src/features/urdf-viewer/
├── hooks/                          # 功能 Hooks
│   ├── useRobotLoader.ts           # URDF 模型加载
│   ├── useHighlightManager.ts      # 高亮效果管理
│   ├── useCameraFocus.ts           # 相机聚焦控制
│   ├── useMouseInteraction.ts      # 鼠标交互处理
│   ├── useHoverDetection.ts        # 悬停检测
│   ├── useVisualizationEffects.ts  # 可视化效果（惯性、质心、原点等）
│   ├── useViewerSettings.ts        # 查看器设置状态管理
│   └── usePanelDrag.ts             # 浮动面板拖拽逻辑
├── utils/
│   ├── materials.ts                # 材质定义（高亮、碰撞等）
│   ├── urdfMaterials.ts            # URDF 材质处理
│   ├── visualizationFactories.ts   # 可视化辅助对象工厂
│   ├── robotPositioning.ts         # 机器人定位计算
│   └── dispose.ts                  # THREE.js 资源清理
├── components/
│   ├── URDFViewer.tsx              # 主组件（Canvas + 布局）
│   ├── ViewerOptionsPanel.tsx      # 设置面板
│   ├── JointsPanel.tsx             # 关节控制面板
│   ├── MeasurePanel.tsx            # 测量工具面板
│   ├── RobotModel.tsx              # 机器人模型渲染
│   ├── JointInteraction.tsx        # 关节拖拽交互
│   ├── JointControlItem.tsx        # 关节控制滑块
│   ├── ViewerToolbar.tsx           # 工具栏 UI
│   ├── MeasureTool.tsx             # 测量工具
│   └── CollisionTransformControls.tsx # 碰撞体变换控制
├── constants.ts                    # 共享常量与对象池
├── types.ts                        # TypeScript 类型定义
└── index.ts
```

## 核心模式

### 1. 组件层级
```
URDFViewer
├─ ViewerToolbar (工具模式切换)
├─ ViewerOptionsPanel (显示选项)
├─ JointsPanel (关节控制列表)
├─ MeasurePanel (测量信息面板)
└─ Canvas
   ├─ RobotModel (模型 + 可视化)
   ├─ JointInteraction (关节拖拽)
   ├─ MeasureTool (测量线)
   └─ CollisionTransformControls (变换 gizmo)
```

### 2. 工具模式 (ToolMode)
`select | translate | rotate | universal | view | face | measure`

### 3. 性能优化
- `constants.ts` 中定义对象池避免 GC
- `SHARED_MATERIALS` 集合防止重复创建材质
- `dispose.ts` 提供完整资源清理

## AI 开发关键点

1. **材质使用**：优先使用 `materials.ts` 中的共享材质
2. **资源清理**：卸载时必须调用 dispose 工具函数
3. **类型安全**：Props 类型统一定义在 `types.ts`
4. **可视化扩展**：使用 `visualizationFactories.ts` 创建辅助对象
