# UI 样式与可访问性

> 最后更新：2026-07-23 | 覆盖源码：`src/styles/`、`src/store/uiStore.ts`、`src/shared/components/ui/`、`src/app/components/header/`、`src/app/components/settings/`
> 交叉引用：[architecture.md](architecture.md)

## 1. 关键入口

- 语义 token：`src/styles/index.css`
- 主题状态：`src/store/uiStore.ts`
- 系统主题监听：`src/app/hooks/useAppEffects.ts`
- 共享 UI 原语：`src/shared/components/ui/*`
- 3D HUD / 画布主题辅助：`src/shared/components/3d/LoadingHud.tsx`、`src/shared/components/3d/scene/themeUtils.ts`

## 2. 必须遵守

- 使用语义色 token，不散落硬编码 `#RRGGBB`
- 所有组件在 `light + dark + prefers-contrast: more` 下都应可读
- 暗色界面使用 `base / surface / elevated` 层级，避免纯黑硬切
- 状态表达不能只依赖颜色，补充图标、文案或形态差异
- Focus 态必须可见，建议统一 `ring-system-blue/30`
- 小字号文本避免低对比度颜色

## 2.1 控件复用边界

- 基础交互控件统一从 `src/shared/components/ui/` 引用：`Button`、`IconButton`、`ToolbarToggleGroup`、`Checkbox`、`Switch`、`Input`、`Select`、`PanelSelect`、`Slider`、`SegmentedControl`、`Dialog`、`Tooltip`、`ContextMenu`
- 面板组合控件统一从 `src/shared/components/Panel/` 引用；面板内 overlay / toolbar 小按钮优先使用 `IconButton` 或 `PanelOverlayToggleButton`
- Feature 内可以保留业务 adapter（如 property editor 的数值输入），但 adapter 只负责业务布局、密度和行为，不复制完整 hover / focus / disabled / token 状态样式
- Header、toolbar、panel、menu、dialog 表面禁止新增 `bg-white`、`text-slate-*`、`border-slate-*` 等绕过语义 token 的 Tailwind 色值；使用 `panel-bg`、`element-bg`、`element-hover`、`input-bg`、`border-black`、`border-strong`、`text-*`

## 3. 高频语义色

| Token | 用途 |
|-------|------|
| `app-bg` | 应用背景 |
| `panel-bg` | 面板背景 |
| `element-bg` | 元素背景 |
| `element-hover` | 元素悬停 |
| `border-black` | 边框 |
| `text-primary` / `text-secondary` / `text-tertiary` | 文本层级 |
| `system-blue` | 文本 / 图标强调 |
| `system-blue-solid` | 主按钮底色 |
| `slider-accent` | 线性高亮 / 进度条 |

## 4. 蓝色使用强约束

- `#0088FF` 仅用于 `slider-accent`、进度线、细线型高亮
- `#0088FF` 禁止用于：主按钮实底、小字号正文链接、大面积背景填充
- 语义映射：线性高亮 -> `slider-accent`，主按钮 -> `system-blue-solid`，文本/图标强调 -> `system-blue`

## 5. 面板文案约束

- 常驻工具面板默认使用短标签、短标题、短状态文案
- 测量、吸附、显示开关等高频操作直接提供可选项，不重复解释
- 只有首次门槛高、流程长或存在误操作成本的区域（如 toolbox、批量优化、复杂导入导出流程）才保留简短 helper copy
- 若面板已能通过标题、字段名、占位文案和按钮标签表达清楚，删除冗余说明文本

## 6. 验收标准

- Light / Dark / 高对比 三种场景均可读
- Hover / Active / Focus 行为一致且可感知
- 无新增分散硬编码色值
