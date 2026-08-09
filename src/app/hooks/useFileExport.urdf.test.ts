import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import { useFileExport, type ExportActionRequired } from './useFileExport.ts';
import { useAssetsStore, useUIStore } from '@/store';
import {
  installExportTestRobot,
  installExportTestWorkspace,
  resetExportTestWorkspace,
  updateExportTestWorkspace,
} from './file-export/exportTestWorkspace.ts';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type AssemblyState,
  type RobotData,
  type RobotFile,
} from '@/types';
import type { ExportDialogConfig } from '@/features/file-io';
import { IDENTITY_ASSEMBLY_TRANSFORM } from '@/core/robot/assemblyTransforms';

function restoreGlobalProperty<T extends keyof typeof globalThis>(
  key: T,
  originalValue: (typeof globalThis)[T] | undefined,
) {
  if (originalValue === undefined) {
    delete globalThis[key];
    return;
  }

  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: originalValue,
  });
}

function installDomEnvironment() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalSVGElement = globalThis.SVGElement;
  const originalNode = globalThis.Node;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalDOMParser = globalThis.DOMParser;

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    writable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    configurable: true,
    writable: true,
    value: dom.window.SVGElement,
  });
  Object.defineProperty(globalThis, 'Node', {
    configurable: true,
    writable: true,
    value: dom.window.Node,
  });
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    writable: true,
    value: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (handle: number) => clearTimeout(handle),
  });
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    writable: true,
    value: dom.window.DOMParser,
  });

  return {
    restore() {
      dom.window.close();
      restoreGlobalProperty('window', originalWindow);
      restoreGlobalProperty('document', originalDocument);
      restoreGlobalProperty('navigator', originalNavigator);
      restoreGlobalProperty('HTMLElement', originalHTMLElement);
      restoreGlobalProperty('SVGElement', originalSVGElement);
      restoreGlobalProperty('Node', originalNode);
      restoreGlobalProperty('MutationObserver', originalMutationObserver);
      restoreGlobalProperty('requestAnimationFrame', originalRequestAnimationFrame);
      restoreGlobalProperty('cancelAnimationFrame', originalCancelAnimationFrame);
      restoreGlobalProperty('DOMParser', originalDOMParser);
    },
  };
}

function renderHook() {
  let hookValue: ReturnType<typeof useFileExport> | null = null as ReturnType<typeof useFileExport> | null;
  const container = document.createElement('div');
  document.body.appendChild(container);

  function Probe() {
    hookValue = useFileExport();
    return null;
  }

  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(Probe));
  });
  assert.ok(hookValue, 'hook should render');
  const hook = hookValue as ReturnType<typeof useFileExport>;
  return {
    hook,
    cleanup() {
      flushSync(() => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

function resetStoresToBaseline() {
  useUIStore.setState({
    lang: 'en',
    appMode: 'editor',
  });

  useAssetsStore.setState({
    assets: {},
    availableFiles: [],
    usdSceneSnapshots: {},
    usdPreparedExportCaches: {},
    selectedFile: null,
    documentLoadState: {
      status: 'idle',
      fileName: null,
      format: null,
      error: null,
    },
    allFileContents: {},
    motorLibrary: {},
    componentSourceDrafts: {},
  });

  resetExportTestWorkspace();
}

function installDownloadMocks() {
  const originalCreateElement = document.createElement.bind(document);
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  let capturedBlob: Blob | null = null as Blob | null;
  let clicked = false;
  let appendedAnchor: HTMLAnchorElement | null = null as HTMLAnchorElement | null;

  Object.defineProperty(document, 'createElement', {
    configurable: true,
    writable: true,
    value: (tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'a') {
        appendedAnchor = element as HTMLAnchorElement;
        Object.defineProperty(element, 'click', {
          configurable: true,
          writable: true,
          value: () => {
            clicked = true;
          },
        });
      }
      return element;
    },
  });

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      capturedBlob = blob;
      return 'blob:urdf-export-test';
    },
  });

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => {},
  });

  return {
    get capturedBlob() {
      return capturedBlob;
    },
    get appendedAnchor() {
      return appendedAnchor;
    },
    get clicked() {
      return clicked;
    },
    restore() {
      Object.defineProperty(document, 'createElement', {
        configurable: true,
        writable: true,
        value: originalCreateElement,
      });

      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });

      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL,
      });
    },
  };
}

async function settleDomTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createUrdfExportConfig(
  urdfOverrides: Partial<ExportDialogConfig['urdf']> = {},
): ExportDialogConfig {
  return {
    format: 'urdf',
    includeSkeleton: false,
    mjcf: {
      meshdir: 'meshes/',
      addFloatBase: false,
      preferSharedMeshReuse: true,
      includeActuators: true,
      actuatorType: 'position',
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
    },
    urdf: {
      includeExtended: false,
      includeBOM: false,
      useRelativePaths: true,
      preferSourceVisualMeshes: true,
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
      ...urdfOverrides,
    },
    xacro: {
      includeGazeboControl: true,
      rosVersion: 'ros2',
      gazeboBackend: 'classic',
      rosHardwareInterface: 'effort',
      useRelativePaths: true,
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
    },
    sdf: {
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
    },
    usd: {
      fileFormat: 'usd',
      compressMeshes: true,
      meshQuality: 50,
    },
  };
}

function createSdfExportConfig(
  sdfOverrides: Partial<ExportDialogConfig['sdf']> = {},
): ExportDialogConfig {
  return {
    format: 'sdf',
    includeSkeleton: false,
    mjcf: {
      meshdir: 'meshes/',
      addFloatBase: false,
      preferSharedMeshReuse: true,
      includeActuators: true,
      actuatorType: 'position',
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
    },
    urdf: {
      includeExtended: false,
      includeBOM: false,
      useRelativePaths: true,
      preferSourceVisualMeshes: true,
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
    },
    xacro: {
      includeGazeboControl: true,
      rosVersion: 'ros2',
      gazeboBackend: 'classic',
      rosHardwareInterface: 'effort',
      useRelativePaths: true,
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
    },
    sdf: {
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
      ...sdfOverrides,
    },
    usd: {
      fileFormat: 'usd',
      compressMeshes: true,
      meshQuality: 50,
    },
  };
}

function createRobotData(rootId: string, rootName: string): RobotData {
  return {
    name: rootName,
    rootLinkId: rootId,
    links: {
      [rootId]: {
        ...DEFAULT_LINK,
        id: rootId,
        name: rootName,
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
        },
      },
    },
    joints: {},
  };
}

function createClosedLoopRobotData(robotName: string): RobotData {
  const baseLinkId = `${robotName}_base_link`;
  const closingLinkId = `${robotName}_closing_link`;
  const robot = createRobotData(baseLinkId, robotName);

  robot.links[closingLinkId] = {
    ...DEFAULT_LINK,
    id: closingLinkId,
    name: closingLinkId,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.BOX,
      dimensions: { x: 0.08, y: 0.08, z: 0.08 },
    },
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.BOX,
      dimensions: { x: 0.08, y: 0.08, z: 0.08 },
    },
  };

  robot.joints[`${robotName}_hinge_joint`] = {
    ...DEFAULT_JOINT,
    id: `${robotName}_hinge_joint`,
    name: `${robotName}_hinge_joint`,
    type: JointType.REVOLUTE,
    parentLinkId: baseLinkId,
    childLinkId: closingLinkId,
  };

  robot.closedLoopConstraints = [
    {
      id: `${robotName}_closed_loop_constraint`,
      type: 'connect',
      linkAId: baseLinkId,
      linkBId: closingLinkId,
      anchorWorld: { x: 0, y: 0, z: 0 },
      anchorLocalA: { x: 0, y: 0, z: 0 },
      anchorLocalB: { x: 0, y: 0, z: 0 },
    },
  ];

  return robot;
}

function createBoxFaceTextureRobotData(robotName: string): RobotData {
  const baseLinkId = `${robotName}_base_link`;
  return {
    name: robotName,
    rootLinkId: baseLinkId,
    links: {
      [baseLinkId]: {
        ...DEFAULT_LINK,
        id: baseLinkId,
        name: baseLinkId,
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          authoredMaterials: [
            { texture: 'textures/right.png' },
            { texture: 'textures/left.png' },
            { texture: 'textures/up.png' },
            { texture: 'textures/down.png' },
            { texture: 'textures/front.png' },
            { texture: 'textures/back.png' },
          ],
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
        },
      },
    },
    joints: {},
  };
}

function createFaceTextureAssets(): Record<string, string> {
  const textureDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';
  return {
    'textures/right.png': textureDataUrl,
    'textures/left.png': textureDataUrl,
    'textures/up.png': textureDataUrl,
    'textures/down.png': textureDataUrl,
    'textures/front.png': textureDataUrl,
    'textures/back.png': textureDataUrl,
  };
}

function createAssemblyState(): AssemblyState {
  return {
    name: 'demo_workspace',
    transform: structuredClone(IDENTITY_ASSEMBLY_TRANSFORM),
    components: {
      comp_left: {
        id: 'comp_left',
        name: 'left_arm',
        sourceFile: 'robots/left_arm.urdf',
        transform: structuredClone(IDENTITY_ASSEMBLY_TRANSFORM),
        visible: true,
        robot: createRobotData('comp_left_base_link', 'left_arm'),
      },
      comp_right: {
        id: 'comp_right',
        name: 'right_arm',
        sourceFile: 'robots/right_arm.urdf',
        transform: structuredClone(IDENTITY_ASSEMBLY_TRANSFORM),
        visible: false,
        robot: createRobotData('comp_right_base_link', 'right_arm'),
      },
    },
    bridges: {},
  };
}

function installDisconnectedWorkspaceAssembly() {
  const leftFile: RobotFile = {
    name: 'robots/left_arm.urdf',
    format: 'urdf',
    content: `<?xml version="1.0"?><robot name="left_arm"><link name="left_arm"/></robot>`,
  };
  const rightFile: RobotFile = {
    name: 'robots/right_arm.urdf',
    format: 'urdf',
    content: `<?xml version="1.0"?><robot name="right_arm"><link name="right_arm"/></robot>`,
  };

  useUIStore.setState({
    lang: 'en',
    appMode: 'editor',
  });

  useAssetsStore.getState().setAvailableFiles([leftFile, rightFile]);
  useAssetsStore.getState().setAllFileContents({
    [leftFile.name]: leftFile.content,
    [rightFile.name]: rightFile.content,
  });
  installExportTestWorkspace(createAssemblyState());
}

function installClosedLoopWorkspaceAssembly() {
  installDisconnectedWorkspaceAssembly();

  updateExportTestWorkspace((workspace) => ({
    ...workspace,
    components: {
      ...workspace.components,
      comp_left: {
        ...workspace.components.comp_left,
        robot: createClosedLoopRobotData('left_arm'),
      },
    },
  }));
}

test('useFileExport rejects URDF export when the current robot contains closed-loop constraints', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  installExportTestRobot(createClosedLoopRobotData('closed_loop_robot'));

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await assert.rejects(
      rendered.hook.handleExportWithConfig(createUrdfExportConfig()),
      /closed-loop constraint/,
    );

    assert.equal(downloadMocks.clicked, false, 'closed-loop URDF export should not download');
  } finally {
    rendered.cleanup();
    downloadMocks.restore();
    await settleDomTasks();
    domEnvironment.restore();
  }
});

test('useFileExport requires an explicit disconnected-workspace decision before exporting a single URDF', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  installDisconnectedWorkspaceAssembly();

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    const result = await rendered.hook.handleExportWithConfig(createUrdfExportConfig());

    assert.equal(
      downloadMocks.clicked,
      false,
      'single URDF export should not download when the workspace is disconnected',
    );
    assert.deepEqual(result.actionRequired satisfies ExportActionRequired | undefined, {
      type: 'disconnected-workspace-urdf',
      componentCount: 2,
      connectedGroupCount: 2,
      exportName: 'left_arm_right_arm',
    });
  } finally {
    rendered.cleanup();
    downloadMocks.restore();
    await settleDomTasks();
    domEnvironment.restore();
  }
});

test('useFileExport blocks disconnected workspace URDF export before suggesting multi-URDF packaging when a component is closed-loop', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  installClosedLoopWorkspaceAssembly();

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await assert.rejects(
      rendered.hook.handleExportWithConfig(createUrdfExportConfig()),
      /closed-loop constraint/,
    );

    assert.equal(
      downloadMocks.clicked,
      false,
      'closed-loop workspace URDF export should not trigger any download',
    );
  } finally {
    rendered.cleanup();
    downloadMocks.restore();
    await settleDomTasks();
    domEnvironment.restore();
  }
});

test('useFileExport rejects URDF export when the current robot contains unsupported ball joints', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const robot = createRobotData('base_link', 'ball_joint_robot');
  robot.links.child_link = {
    ...DEFAULT_LINK,
    id: 'child_link',
    name: 'child_link',
  };
  robot.joints.ball_joint = {
    ...DEFAULT_JOINT,
    id: 'ball_joint',
    name: 'ball_joint',
    type: JointType.BALL,
    parentLinkId: 'base_link',
    childLinkId: 'child_link',
  };
  installExportTestRobot(robot);

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await assert.rejects(
      rendered.hook.handleExportWithConfig(createUrdfExportConfig()),
      /unsupported ball type/i,
    );

    assert.equal(downloadMocks.clicked, false, 'unsupported URDF export should not download');
  } finally {
    rendered.cleanup();
    downloadMocks.restore();
    await settleDomTasks();
    domEnvironment.restore();
  }
});

test('useFileExport downgrades unsupported ellipsoid collisions during URDF export', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const robot = createRobotData('base_link', 'ellipsoid_robot');
  robot.links.base_link.collision = {
    ...robot.links.base_link.collision,
    name: 'base_link_collision',
    type: GeometryType.ELLIPSOID,
    dimensions: { x: 0.2, y: 0.3, z: 0.4 },
  };
  installExportTestRobot(robot);

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await rendered.hook.handleExportWithConfig(createUrdfExportConfig());

    assert.equal(downloadMocks.clicked, true, 'compatible URDF fallback should download');
    assert.ok(downloadMocks.capturedBlob, 'expected a URDF blob to be captured');
    const archive = await JSZip.loadAsync(await downloadMocks.capturedBlob.arrayBuffer());
    const urdfFile = archive.file('ellipsoid_robot/ellipsoid_robot.urdf');
    assert.ok(urdfFile, 'expected exported URDF entry to exist');
    const urdf = await urdfFile.async('text');
    assert.match(urdf, /<box size="0\.2 0\.3 0\.4" \/>/);
    assert.doesNotMatch(urdf, /<ellipsoid/i);
  } finally {
    rendered.cleanup();
    downloadMocks.restore();
    await settleDomTasks();
    domEnvironment.restore();
  }
});

test('useFileExport can package every workspace component as its own URDF zip payload', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  installDisconnectedWorkspaceAssembly();

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await rendered.hook.handleExportDisconnectedWorkspaceUrdfBundle(createUrdfExportConfig());

    assert.equal(downloadMocks.clicked, true, 'expected a multi-URDF archive download');
    assert.match(
      downloadMocks.appendedAnchor?.download ?? '',
      /demo_workspace_components_urdf\.zip$/,
    );
    assert.ok(downloadMocks.capturedBlob, 'expected the generated archive to be captured');

    const archive = await JSZip.loadAsync(await downloadMocks.capturedBlob.arrayBuffer());
    const archivePaths = Object.keys(archive.files).sort();

    assert.ok(
      archivePaths.includes('demo_workspace/components/left_arm/left_arm.urdf'),
      'left component URDF should be packaged',
    );
    assert.ok(
      archivePaths.includes('demo_workspace/components/right_arm/right_arm.urdf'),
      'right component URDF should be packaged even when hidden',
    );

    const leftUrdf = await archive
      .file('demo_workspace/components/left_arm/left_arm.urdf')
      ?.async('string');
    const rightUrdf = await archive
      .file('demo_workspace/components/right_arm/right_arm.urdf')
      ?.async('string');
    assert.match(leftUrdf ?? '', /<robot name="left_arm">/);
    assert.match(rightUrdf ?? '', /<robot name="right_arm">/);
  } finally {
    rendered.cleanup();
    downloadMocks.restore();
    await settleDomTasks();
    domEnvironment.restore();
  }
});

test('useFileExport rejects multi-URDF packaging when any disconnected workspace component is closed-loop', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  installClosedLoopWorkspaceAssembly();

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await assert.rejects(
      rendered.hook.handleExportDisconnectedWorkspaceUrdfBundle(createUrdfExportConfig()),
      /closed-loop constraint/,
    );

    assert.equal(
      downloadMocks.clicked,
      false,
      'multi-URDF export should stop before downloading when a component is closed-loop',
    );
  } finally {
    rendered.cleanup();
    downloadMocks.restore();
    await settleDomTasks();
    domEnvironment.restore();
  }
});

test('useFileExport still allows a single URDF export when workspace components are bridged into one assembly', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  installDisconnectedWorkspaceAssembly();

  updateExportTestWorkspace((workspace) => ({
    ...workspace,
    bridges: {
      bridge_main: {
              id: 'bridge_main',
              name: 'bridge_main',
              parentComponentId: 'comp_left',
              parentLinkId: 'comp_left_base_link',
              childComponentId: 'comp_right',
              childLinkId: 'comp_right_base_link',
              joint: {
                ...DEFAULT_JOINT,
                id: 'bridge_main',
                name: 'bridge_main_joint',
                type: JointType.FIXED,
                parentLinkId: 'comp_left_base_link',
                childLinkId: 'comp_right_base_link',
              },
      },
    },
  }));

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    const result = await rendered.hook.handleExportWithConfig(createUrdfExportConfig());

    assert.equal(result.actionRequired, undefined);
    assert.equal(
      downloadMocks.clicked,
      true,
      'connected assembly should export a single URDF archive',
    );
    assert.match(downloadMocks.appendedAnchor?.download ?? '', /demo_workspace_urdf\.zip$/);
  } finally {
    rendered.cleanup();
    downloadMocks.restore();
    await settleDomTasks();
    domEnvironment.restore();
  }
});

test('useFileExport warns and flattens six-face box textures during URDF export', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  installExportTestRobot(createBoxFaceTextureRobotData('box_face_robot'));
  useAssetsStore.setState({
    assets: createFaceTextureAssets(),
  });

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    const result = await rendered.hook.handleExportWithConfig(
      createUrdfExportConfig({
        includeMeshes: true,
        preferSourceVisualMeshes: false,
      }),
    );

    assert.equal(result.partial, true);
    assert.match(
      result.warnings[0] ?? '',
      /URDF does not natively support six different textures on a single box visual/,
    );
    assert.ok(downloadMocks.capturedBlob, 'expected a URDF archive to be generated');

    const archive = await JSZip.loadAsync(await downloadMocks.capturedBlob.arrayBuffer());
    const urdf = await archive.file('box_face_robot/box_face_robot.urdf')?.async('string');
    assert.ok(urdf, 'expected exported URDF content');
    assert.equal(
      Array.from(urdf.matchAll(/<texture filename="textures\//g)).length,
      1,
      'expected URDF export to keep exactly one texture reference',
    );
    assert.match(urdf, /textures\/front\.png/);
    assert.ok(archive.file('box_face_robot/textures/front.png'));
    assert.equal(archive.file('box_face_robot/textures/right.png'), null);
    assert.equal(archive.file('box_face_robot/textures/back.png'), null);
  } finally {
    rendered.cleanup();
    downloadMocks.restore();
    await settleDomTasks();
    domEnvironment.restore();
  }
});

test('useFileExport warns and flattens six-face box textures during SDF export', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  installExportTestRobot(createBoxFaceTextureRobotData('box_face_robot'));
  useAssetsStore.setState({
    assets: createFaceTextureAssets(),
  });

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    const result = await rendered.hook.handleExportWithConfig(
      createSdfExportConfig({
        includeMeshes: true,
      }),
    );

    assert.equal(result.partial, true);
    assert.match(
      result.warnings[0] ?? '',
      /SDF does not natively support six different textures on a single box visual/,
    );
    assert.ok(downloadMocks.capturedBlob, 'expected an SDF archive to be generated');

    const archive = await JSZip.loadAsync(await downloadMocks.capturedBlob.arrayBuffer());
    const sdf = await archive.file('box_face_robot/model.sdf')?.async('string');
    assert.ok(sdf, 'expected exported SDF content');
    assert.equal(
      Array.from(sdf.matchAll(/<albedo_map>/g)).length,
      1,
      'expected SDF export to keep exactly one albedo map',
    );
    assert.match(sdf, /model:\/\/box_face_robot\/textures\/front\.png/);
    assert.ok(archive.file('box_face_robot/textures/front.png'));
    assert.equal(archive.file('box_face_robot/textures/right.png'), null);
    assert.equal(archive.file('box_face_robot/textures/back.png'), null);
  } finally {
    rendered.cleanup();
    downloadMocks.restore();
    await settleDomTasks();
    domEnvironment.restore();
  }
});
