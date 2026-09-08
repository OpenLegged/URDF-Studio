# Robot Canvas Library Draft

当前仓库新增了一个第一版可复用入口：

- `src/lib/index.ts`
- `src/lib/components/RobotCanvas.tsx`
- `packages/react-robot-canvas`

## 当前目标

把“可导入 URDF / MJCF 的 3D 画布核心”先从应用 feature 中抽出来，形成独立可构建的库入口。

USD parser worker 的 stage preload 同时支持 preparation 的字节数组与 Blob 数据。
二进制 USD 层、未归一化的文本层和纹理不能因为 `bytes` 为空而被跳过；
`usdPreloadBytes.ts` 按原始字节读取 Blob，worker 在读取后检查取消并确认虚拟文件写入成功。

## 当前公开 API

```tsx
import { RobotCanvas } from '@/lib';

<RobotCanvas
  source={{
    format: 'auto',
    content: xmlContent,
    sourceFilePath: '/robots/arm/robot.urdf',
  }}
  assets={assetMap}
  lang="en"
  theme="dark"
  mode="editor"
  groundPlaneOffset={0}
  display={{
    showVisual: true,
    showCollision: false,
    highlightMode: 'link',
  }}
  onSelectionChange={(selection) => {
    console.log(selection);
  }}
  onHoverChange={(selection) => {
    console.log(selection);
  }}
  onJointAnglesChange={(jointAngles) => {
    console.log(jointAngles);
  }}
/>;
```

## 已完成

- 新增 headless 组件 `RobotCanvas`
- 支持 `URDF / MJCF` 内容加载，并尊重 `source.format`
- 支持外部控制 `selection / jointAngles / display`
- 画布主题改成可通过 props 注入，不再强依赖 UI store
- 地面对齐偏移改成可通过 props 注入，不再强依赖 UI store
- 新增独立库构建配置：
  - `vite.lib.config.ts`
  - `npm run build:robot-canvas-lib`
  - `npm run build:robot-canvas-lib:types`
- 新增可发布包目录：
  - `packages/react-robot-canvas/package.json`
  - `packages/react-robot-canvas/vite.config.ts`
  - `packages/react-robot-canvas/tsconfig.types.json`
  - `npm run build:package:react-robot-canvas`
  - `npm run pack:package:react-robot-canvas`
- 当前包按现代前端生态发布为 `ESM-only`

## 仍待继续

- `assets` 目前仍是 `Record<string, string>`，后续应升级为 `assetResolver`
- 类型声明现在已切到 `tsc` 自动生成，并对产物里的 `@/` 别名做发布前重写
- `editor` 子域能力仍属于应用内壳，尚未抽成独立可发布子包

## 当前发布方式

```bash
npm run build:package:react-robot-canvas
npm run pack:package:react-robot-canvas

cd packages/react-robot-canvas
npm publish
```

## 推荐后续拆分

1. `@urdf-studio/robot-format-core`
2. `@urdf-studio/react-robot-canvas`
3. `@urdf-studio/react-robot-panels`
