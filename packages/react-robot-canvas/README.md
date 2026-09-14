# @urdf-studio/react-robot-canvas

Reusable React 3D robot canvas with `URDF` and `MJCF` import support.

## Install

```bash
npm install @urdf-studio/react-robot-canvas react react-dom three @react-three/fiber @react-three/drei
```

## Usage

```tsx
import { RobotCanvas } from '@urdf-studio/react-robot-canvas';
import '@urdf-studio/react-robot-canvas/style.css';

export function Demo() {
  return (
    <div style={{ width: '100%', height: 640 }}>
      <RobotCanvas
        source={{
          format: 'auto',
          content: robotXml,
          sourceFilePath: '/robots/demo.urdf',
        }}
        assets={assetMap}
        lang="en"
        theme="dark"
        display={{
          showVisual: true,
          showCollision: false,
        }}
      />
    </div>
  );
}
```

## Current API

- `source.format` supports `auto | urdf | mjcf`
- `selection`, `hoveredSelection`, `jointAngles` support controlled usage
- `display` supports visual/collision toggles, highlight mode, transform mode, viewer overlays, `cameraProjection`, `renderQuality`, and `showMjcfWorldLink`
- `robotData` accepts a complete preparsed `RobotData` model and takes precedence over the compatible `robotLinks` / `robotJoints` maps
- viewer overlays already include inertia, center of mass, origins, and joint axes
- `groundPlaneOffset` is prop-driven

## MJCF and preparsed models

MJCF rendering requires a canonical model. Parse it before mounting the canvas with `parseRobotDefinitionAsync` from `@urdf-studio/robot-runtime/parser`, then pass the ready result:

```tsx
const result = await parseRobotDefinitionAsync(mjcfText, 'robot.xml');
if (result.status === 'ready') {
  return <RobotCanvas
    source={{ format: 'mjcf', content: mjcfText, sourceFilePath: 'robot.xml' }}
    robotData={result.robotData}
  />;
}
```

The canvas package exports the `RobotData` type. Passing the complete model preserves materials, the root link, constraints, and MJCF site/tendon metadata. URDF source content can still use the default XML fallback. Each canvas owns its interaction state and receives display configuration through props.

## Current limitation

- `assets` is still a synchronous `Record<string, string>` map. A future version should expose `assetResolver`.
- This package is published as modern ESM. It is intended for Vite / modern bundler consumers.
