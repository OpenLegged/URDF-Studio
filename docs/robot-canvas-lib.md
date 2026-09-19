# Robot Canvas 库

公开入口为 `src/lib/index.ts`，组件实现位于 `src/lib/components/RobotCanvas.tsx`，发布包为 `packages/react-robot-canvas/`。

## 接入与 API

安装和基本用法见 [包 README](../packages/react-robot-canvas/README.md)，完整 props 以 [src/lib/types.ts](../src/lib/types.ts) 为准。

- 支持 URDF / MJCF；`source.format` 可选 `auto | urdf | mjcf`。
- `selection`、`hoveredSelection`、`jointAngles` 可受控；selection/hover/joint 回调将交互变化交给宿主。
- 主题、相机、质量、visual/collision/MJCF world 显示与地面对齐偏移通过 props 注入。

## 预解析模型

MJCF 需要预解析的规范模型。使用 `@urdf-studio/robot-runtime/parser` 的 `parseRobotDefinitionAsync(content, filename)`，在结果 `status === 'ready'` 后传入完整 `robotData`：

```tsx
const result = await parseRobotDefinitionAsync(mjcfText, 'arm.xml');
if (result.status === 'ready') {
  return <RobotCanvas
    source={{ format: 'mjcf', content: mjcfText, sourceFilePath: 'arm.xml' }}
    robotData={result.robotData}
  />;
}
```

`RobotData` 类型也从画布包导出。完整模型优先于兼容的 `robotLinks` / `robotJoints` props，并携带根链接、材质、闭环约束和 MJCF site/tendon 元信息。既有仅传两张表的用法仍可加载，但不能补回缺失的元信息。URDF 的原始 XML fallback 保持默认启用；画布不负责解析器任务或应用 workspace 的生命周期。

## 边界与限制

- 渲染 kernel 位于 `src/shared/components/3d/robot/`；发布包依赖闭包不得包含 app/store/features。
- 每个 Canvas 拥有自身 hover 与 joint interaction 生命周期；Studio 的 workspace controls/grounding 归 feature adapter。
- `assets` 是同步 `Record<string, string>`，暂不提供异步 `assetResolver`；Editor panels 仍属应用壳。
- 包为 ESM-only，类型声明由 `tsc` 生成，发布前重写 `@/` 别名。
- USD parser worker 的 stage preload 支持字节数组和 Blob；`usdPreloadBytes.ts` 按原始字节读取 Blob，不能因 `bytes` 为空跳过二进制层、未归一化文本层或纹理；读取后检查取消及虚拟文件写入结果。

## 构建与发布

```bash
npm run build:package:react-robot-canvas
npm run pack:package:react-robot-canvas

cd packages/react-robot-canvas
npm publish
```
