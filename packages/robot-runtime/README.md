# @urdf-studio/robot-runtime

URDF Studio's reusable robot asset pipeline. It parses robot definitions,
resolves package-relative assets, and constructs the articulated Three.js scene
graph consumed by Motion Studio.

## Public entries

| Entry                                      | Purpose                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `@urdf-studio/robot-runtime`               | Parse URDF/MJCF/SDF/Xacro and construct a `RobotRuntime` Three.js hierarchy     |
| `@urdf-studio/robot-runtime/mesh`          | Load package-relative mesh assets as complete Three.js object hierarchies       |
| `@urdf-studio/robot-runtime/motion-studio` | Discover definition files and prepare folder/package parse inputs               |
| `@urdf-studio/robot-runtime/parser`        | Parse definitions into the portable `RobotData` DTO without constructing meshes |
| `@urdf-studio/robot-runtime/usd`           | Load USD into the same articulated Three.js runtime through worker/WASM         |

The root and USD entries construct the same Three.js runtime shape. Parser and
folder helpers do not pull mesh workers or USD WASM into their bundles. USD
remains an explicit lazy entry because its WASM assets are approximately 20 MB.

## Install from the workspace

```json
{
  "dependencies": {
    "@urdf-studio/robot-runtime": "file:../URDF-Studio/packages/robot-runtime"
  }
}
```

Build the package before consuming it:

```bash
cd ../URDF-Studio
npm run build:package:robot-runtime
```

`three` is a peer dependency. The consuming application owns the Three.js
version and renderer lifecycle.

## Construct a robot

```ts
import {
  loadRobotRuntime,
  type RobotRuntime,
  type RobotRuntimeJoint,
} from '@urdf-studio/robot-runtime';

const runtime = await loadRobotRuntime(sourceText, sourcePath, {
  assets: {
    'meshes/base.dae': URL.createObjectURL(baseMeshFile),
  },
  parse: {
    allFileContents,
    availableFiles,
    sourcePath,
    xacroFileMap: allFileContents,
  },
  parseCollision: true,
});

const robot: RobotRuntime = runtime.root;
const shoulder: RobotRuntimeJoint | undefined = robot.joints.shoulder_joint;
shoulder?.setJointValue(0.5);
scene.add(robot);

// Removes package-owned geometry, material, texture, and scene resources.
runtime.dispose();
```

The runtime result contains:

- `root`: the canonical articulated `RobotRuntime`, derived from
  `THREE.Object3D`;
- `joints`: the non-fixed joints used by animation, retargeting, and IK;
- `links`: all runtime links;
- `robotData`: the portable parsed source model;
- `dispose()`: an idempotent release for package-owned Three.js resources.

The mesh pipeline supports STL, legacy MuJoCo MSH, DAE, OBJ, GLTF/GLB, PLY,
and VTK. Pass the complete imported folder through `assets` so mesh textures
and sidecars resolve from their source-relative paths.

For standalone collision or tooling meshes, use a loader session so duplicate
requests share URDF Studio's parsed mesh cache:

```ts
import { createRobotMeshLoader, resolveRobotAsset } from '@urdf-studio/robot-runtime/mesh';

const meshes = createRobotMeshLoader({ assets, sourceFilePath: 'robot/model.urdf' });
const collisionObject = await meshes.load('meshes/collision.dae');
scene.add(collisionObject);

// Uses the same exact/case-insensitive/package-relative/suffix index as loading.
const textureUrl = resolveRobotAsset('../textures/body.png', assets, 'robot/model.urdf');

// The session owns every returned Object3D. Dispose after removing all of them.
meshes.dispose();
```

The returned value is an `Object3D`, not a flattened geometry: authored DAE,
OBJ, and GLTF node hierarchies and transforms are preserved. Loader disposal
does not revoke consumer-owned Blob URLs or terminate shared parser workers.

To construct an already parsed definition, call
`buildRobotRuntimeFromData(robotData, options)` from the root entry.

## Motion Studio folder imports

```ts
import {
  createRobotDefinitionParseOptions,
  listRobotDefinitionEntries,
  parseRobotDefinitionAsync,
} from '@urdf-studio/robot-runtime/motion-studio';

const packageFiles = await Promise.all(
  importedFiles.map(async (file) => ({
    path: file.webkitRelativePath,
    content: await file.text(),
  })),
);
const entries = listRobotDefinitionEntries(packageFiles);
const entry = entries[0];
const source = packageFiles.find((file) => file.path === entry.path);
const parseOptions = createRobotDefinitionParseOptions(packageFiles, entry.path);
const result = await parseRobotDefinitionAsync(source?.content ?? '', entry.path, {
  ...parseOptions,
  assets,
});
```

Motion Studio owns the stage, cameras, lights, timeline, retargeting, IK, and
editing state. This package owns format detection, parsing, asset resolution,
and construction of the robot's Three.js hierarchy.

## Definition parser

```ts
import {
  parseMJCF,
  parseRobotDefinitionAsync,
  parseSDF,
  parseURDF,
  processXacro,
  toRobotData,
} from '@urdf-studio/robot-runtime/parser';

const urdfState = parseURDF(urdfXml);
const mjcfState = parseMJCF(mjcfXml);
const sdfState = parseSDF(sdfXml, {
  allFileContents,
  availableFiles,
  sourcePath,
});
const expandedUrdf = processXacro(xacroText, args, fileMap, basePath);

const robotData = urdfState ? toRobotData(urdfState) : null;

// Use the async entry when the result will drive MJCF collision physics.
const physicalResult = await parseRobotDefinitionAsync(mjcfXml, 'robot.xml', {
  assets,
  sourcePath: 'robots/robot.xml',
});
```

URDF/MJCF/SDF/Xacro parsing uses `DOMParser`. Node.js tests and SSR must install
a DOM implementation before invoking those parsers.

## USD

The USD entry loads its worker and emHdBindings runtime only when requested:

```ts
import { disposeParseUsdWorker, loadUsdRobotRuntime } from '@urdf-studio/robot-runtime/usd';

const runtime = await loadUsdRobotRuntime(usdaText, 'robot.usda', {
  availableFiles,
  assets,
  sourceBlobUrl,
  wasmBaseUrl: '/usd/bindings',
});
scene.add(runtime.root);

runtime.dispose();
disposeParseUsdWorker();
```

The consumer must:

- serve the contents of `dist/wasm/` from the configured `wasmBaseUrl`;
- enable cross-origin isolation with
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`;
- pass `wasmBaseUrl` to `loadUsdRobotRuntime`, or configure the base URL before
  calling lower-level USD APIs.

`loadUsdRobotRuntime` resolves the package in a worker, transfers baked geometry,
materials, and transforms, and returns the same canonical `root`, `joints`,
`links`, `robotData`, and `dispose()` shape used by the root entry.
