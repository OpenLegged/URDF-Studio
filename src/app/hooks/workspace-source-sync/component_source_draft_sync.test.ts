import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';

import { parseMJCF } from '@/core/parsers';
import {
  createComponentSourceDraft,
  createDefaultWorkspace,
  createSingleComponentWorkspace,
  isComponentSourceDraftMatchingComponent,
} from '@/core/robot';
import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType } from '@/types';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { generateEditableRobotSource } from '@/app/utils/generateEditableRobotSource';
import {
  synchronizeComponentSourceDraft,
} from './component_source_draft_sync.ts';

function installDom(t: TestContext): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  for (const key of ['DOMParser', 'XMLSerializer'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.after(() => dom.window.close());
}

function createJointWorkspace(type: JointType) {
  const workspace = createDefaultWorkspace('joint_robot');
  const robot = workspace.components.component_1.robot;
  robot.links.tip = { ...structuredClone(DEFAULT_LINK), id: 'tip', name: 'tip' };
  robot.joints.mount = {
    ...structuredClone(DEFAULT_JOINT),
    id: 'mount',
    name: 'mount',
    parentLinkId: robot.rootLinkId,
    childLinkId: 'tip',
    type,
  };
  return workspace;
}

function installMjcfBallWorkspace() {
  const workspace = createJointWorkspace(JointType.BALL);
  const robot = workspace.components.component_1.robot;
  const draft = createComponentSourceDraft({
    componentId: 'component_1',
    format: 'mjcf',
    content: generateEditableRobotSource({
      format: 'mjcf',
      robotState: { ...robot, selection: { type: null, id: null } },
    }),
    robot,
  });
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useAssetsStore.setState({
    availableFiles: [],
    allFileContents: {},
    componentSourceDrafts: { component_1: draft },
  });
  return draft;
}

test('missing component source becomes an editable generated draft', () => {
  const workspace = createDefaultWorkspace('generated_editable');
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useAssetsStore.setState({
    availableFiles: [],
    allFileContents: {},
    componentSourceDrafts: {},
  });

  assert.equal(synchronizeComponentSourceDraft('component_1'), 'created');
  const component = useWorkspaceStore.getState().workspace.components.component_1;
  const draft = useAssetsStore.getState().componentSourceDrafts.component_1;
  assert.equal(draft.format, 'urdf');
  assert.match(draft.content, /<robot name="generated_editable">/);
  assert.equal(isComponentSourceDraftMatchingComponent(draft, component), true);
});

test('MJCF ball joints remain editable when adding a collision geometry and synchronizing source', (t) => {
  installDom(t);
  const source = `<mujoco model="ball_robot"><worldbody>
    <body name="base"><geom type="box" size="0.1 0.1 0.1" />
      <body name="tip" pos="0 0 0.5"><joint name="mount" type="ball" />
        <geom type="sphere" size="0.1" contype="0" conaffinity="0" />
      </body>
    </body>
  </worldbody></mujoco>`;
  const parsed = parseMJCF(source);
  assert.ok(parsed);
  const { selection: _selection, ...robot } = parsed;
  const workspace = createSingleComponentWorkspace(robot, {
    componentId: 'component_1',
    sourceFile: 'robots/ball_robot.xml',
  });
  const sourceFile = { name: 'robots/ball_robot.xml', format: 'mjcf' as const, content: source };
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useAssetsStore.setState({
    availableFiles: [sourceFile],
    allFileContents: { [sourceFile.name]: source },
    componentSourceDrafts: {
      component_1: createComponentSourceDraft({
        componentId: 'component_1', format: 'mjcf', content: source, robot,
      }),
    },
  });

  assert.equal(robot.links.tip.collision.type, GeometryType.NONE);
  assert.equal(useWorkspaceStore.getState().updateLink(
    { type: 'link', componentId: 'component_1', entityId: 'tip' },
    { collision: { type: GeometryType.BOX, dimensions: { x: 0.4, y: 0.6, z: 0.8 } } },
  ), true);
  assert.equal(synchronizeComponentSourceDraft('component_1', { force: true }), 'synchronized');

  const component = useWorkspaceStore.getState().workspace.components.component_1;
  const draft = useAssetsStore.getState().componentSourceDrafts.component_1;
  assert.equal(draft.format, 'mjcf');
  assert.equal(isComponentSourceDraftMatchingComponent(draft, component), true);
  assert.equal(component.robot.joints.mount.type, JointType.BALL);
  const reparsed = parseMJCF(draft.content);
  assert.ok(reparsed);
  assert.equal(reparsed.joints.mount.type, JointType.BALL);
  assert.equal(reparsed.links.tip.collision.type, GeometryType.BOX);
  assert.deepEqual(reparsed.links.tip.collision.dimensions, { x: 0.4, y: 0.6, z: 0.8 });
  assert.equal(useAssetsStore.getState().availableFiles[0].content, source);
});

test('a ball joint without an existing source gets an editable MJCF draft', (t) => {
  installDom(t);
  const workspace = createJointWorkspace(JointType.BALL);
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useAssetsStore.setState({ availableFiles: [], allFileContents: {}, componentSourceDrafts: {} });

  assert.equal(synchronizeComponentSourceDraft('component_1'), 'created');

  const component = useWorkspaceStore.getState().workspace.components.component_1;
  const draft = useAssetsStore.getState().componentSourceDrafts.component_1;
  assert.equal(draft.format, 'mjcf');
  assert.equal(isComponentSourceDraftMatchingComponent(draft, component), true);
  const reparsed = parseMJCF(draft.content);
  assert.ok(reparsed);
  assert.equal(reparsed.joints.mount.type, JointType.BALL);
});

test('an unfinished mesh collision edit preserves the MJCF draft and canonical ball joint', (t) => {
  installDom(t);
  const previousDraft = installMjcfBallWorkspace();
  const errorLog = t.mock.method(console, 'error', () => {});
  const warningLog = t.mock.method(console, 'warn', () => {});
  assert.equal(useWorkspaceStore.getState().updateLink(
    { type: 'link', componentId: 'component_1', entityId: 'tip' },
    { collision: { type: GeometryType.MESH, meshPath: '' } },
  ), true);
  const editedWorkspace = structuredClone(useWorkspaceStore.getState().workspace);

  assert.equal(synchronizeComponentSourceDraft('component_1', { force: true }), 'failed');

  const currentWorkspace = useWorkspaceStore.getState().workspace;
  assert.deepEqual(currentWorkspace, editedWorkspace);
  assert.equal(currentWorkspace.components.component_1.robot.joints.mount.type, JointType.BALL);
  assert.equal(currentWorkspace.components.component_1.robot.links.tip.collision.type, GeometryType.MESH);
  assert.equal(useAssetsStore.getState().componentSourceDrafts.component_1, previousDraft);
  assert.equal(errorLog.mock.callCount(), 0);
  assert.equal(warningLog.mock.callCount(), 0);
});

test('adding a planar joint preserves the MJCF draft without degrading canonical joint types', (t) => {
  installDom(t);
  const previousDraft = installMjcfBallWorkspace();
  const errorLog = t.mock.method(console, 'error', () => {});
  const warningLog = t.mock.method(console, 'warn', () => {});
  const editedRobot = structuredClone(useWorkspaceStore.getState().workspace.components.component_1.robot);
  editedRobot.links.planar_tip = {
    ...structuredClone(DEFAULT_LINK), id: 'planar_tip', name: 'planar_tip',
  };
  editedRobot.joints.planar_mount = {
    ...structuredClone(DEFAULT_JOINT),
    id: 'planar_mount',
    name: 'planar_mount',
    type: JointType.PLANAR,
    parentLinkId: 'tip',
    childLinkId: 'planar_tip',
  };
  assert.equal(useWorkspaceStore.getState().replaceComponentRobot('component_1', editedRobot), true);
  const editedWorkspace = structuredClone(useWorkspaceStore.getState().workspace);

  assert.equal(synchronizeComponentSourceDraft('component_1', { force: true }), 'failed');

  const currentWorkspace = useWorkspaceStore.getState().workspace;
  assert.deepEqual(currentWorkspace, editedWorkspace);
  assert.equal(currentWorkspace.components.component_1.robot.joints.mount.type, JointType.BALL);
  assert.equal(currentWorkspace.components.component_1.robot.joints.planar_mount.type, JointType.PLANAR);
  assert.equal(useAssetsStore.getState().componentSourceDrafts.component_1, previousDraft);
  assert.equal(errorLog.mock.callCount(), 0);
  assert.equal(warningLog.mock.callCount(), 0);
});

for (const format of ['urdf', 'xacro'] as const) {
  test(`${format} drafts switch to MJCF when editing a fixed joint to ball`, (t) => {
    installDom(t);
    const workspace = createJointWorkspace(JointType.FIXED);
    const component = workspace.components.component_1;
    const content = generateEditableRobotSource({
      format,
      robotState: { ...component.robot, selection: { type: null, id: null } },
    });
    useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
    useAssetsStore.setState({
      availableFiles: [],
      allFileContents: {},
      componentSourceDrafts: {
        component_1: createComponentSourceDraft({
          componentId: 'component_1', format, content, robot: component.robot,
        }),
      },
    });

    assert.equal(useWorkspaceStore.getState().updateJoint(
      { type: 'joint', componentId: 'component_1', entityId: 'mount' },
      { type: JointType.BALL },
    ), true);
    assert.equal(synchronizeComponentSourceDraft('component_1', { force: true }), 'synchronized');

    const currentComponent = useWorkspaceStore.getState().workspace.components.component_1;
    const draft = useAssetsStore.getState().componentSourceDrafts.component_1;
    assert.equal(draft.format, 'mjcf');
    assert.equal(isComponentSourceDraftMatchingComponent(draft, currentComponent), true);
    assert.equal(currentComponent.robot.joints.mount.type, JointType.BALL);
    const reparsed = parseMJCF(draft.content);
    assert.ok(reparsed);
    assert.equal(reparsed.joints.mount.type, JointType.BALL);
  });
}

test('unhandled property changes preserve authored source text while updating robot code', () => {
  const originalDOMParser = globalThis.DOMParser;
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    value: dom.window.DOMParser,
  });

  try {
    const workspace = createDefaultWorkspace('source_preserved');
    const component = workspace.components.component_1;
    const robotState = {
      ...component.robot,
      selection: { type: null, id: null } as const,
    };
    const generated = generateEditableRobotSource({
      format: 'urdf',
      robotState,
      preserveMeshPaths: true,
    });
    const authored = generated.replace(
      '<robot name="source_preserved">',
      '<robot name="source_preserved">\n  <!-- keep authored note -->',
    );
    useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
    useAssetsStore.setState({
      availableFiles: [],
      allFileContents: {},
      componentSourceDrafts: {
        component_1: createComponentSourceDraft({
          componentId: 'component_1',
          format: 'urdf',
          content: authored,
          robot: component.robot,
        }),
      },
    });

    assert.equal(useWorkspaceStore.getState().updateLink(
      { type: 'link', componentId: 'component_1', entityId: component.robot.rootLinkId },
      { visual: { dimensions: { x: 0.125 } } },
    ), true);
    assert.equal(
      synchronizeComponentSourceDraft('component_1', { force: true }),
      'synchronized',
    );

    const currentComponent = useWorkspaceStore.getState().workspace.components.component_1;
    const draft = useAssetsStore.getState().componentSourceDrafts.component_1;
    assert.match(draft.content, /<!-- keep authored note -->/);
    assert.match(draft.content, /radius="0\.125"/);
    assert.equal(isComponentSourceDraftMatchingComponent(draft, currentComponent), true);
  } finally {
    dom.window.close();
    if (originalDOMParser === undefined) {
      Reflect.deleteProperty(globalThis, 'DOMParser');
    } else {
      Object.defineProperty(globalThis, 'DOMParser', {
        configurable: true,
        value: originalDOMParser,
      });
    }
  }
});

test('USD-backed components remain read-only after property mutations', () => {
  const workspace = createDefaultWorkspace('usd_read_only');
  const component = workspace.components.component_1;
  component.sourceFile = 'library/model.usd';
  component.robot.inspectionContext = { sourceFormat: 'usd' };
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  const usdDraft = createComponentSourceDraft({
    componentId: 'component_1',
    format: 'usd',
    content: '#usda 1.0',
    robot: component.robot,
  });
  useAssetsStore.setState({
    availableFiles: [{ name: 'library/model.usd', format: 'usd', content: '#usda 1.0' }],
    allFileContents: {},
    componentSourceDrafts: { component_1: usdDraft },
  });

  assert.equal(useWorkspaceStore.getState().updateLink(
    { type: 'link', componentId: 'component_1', entityId: component.robot.rootLinkId },
    { visual: { dimensions: { x: 0.25 } } },
  ), true);
  assert.equal(
    synchronizeComponentSourceDraft('component_1', { force: true }),
    'unchanged',
  );
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts.component_1, usdDraft);

  useAssetsStore.getState().removeComponentSourceDraft('component_1');
  assert.equal(
    synchronizeComponentSourceDraft('component_1', { force: true }),
    'unchanged',
  );
  assert.equal(useAssetsStore.getState().componentSourceDrafts.component_1, undefined);
});

test('MJCF name-only synchronization changes only the root model attribute', () => {
  const originalDOMParser = globalThis.DOMParser;
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    value: dom.window.DOMParser,
  });

  try {
    const workspace = createDefaultWorkspace('mjcf_before');
    const component = workspace.components.component_1;
    const source = generateEditableRobotSource({
      format: 'mjcf',
      robotState: { ...component.robot, selection: { type: null, id: null } },
      preserveMeshPaths: true,
    }).replace(
      '<worldbody>',
      '<!-- preserve exact authored text -->\n  <worldbody>',
    );
    useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
    useAssetsStore.setState({
      availableFiles: [],
      allFileContents: {},
      componentSourceDrafts: {
        component_1: createComponentSourceDraft({
          componentId: 'component_1',
          format: 'mjcf',
          content: source,
          robot: component.robot,
        }),
      },
    });
    useWorkspaceStore.getState().replaceComponentRobot('component_1', {
      ...component.robot,
      name: 'mjcf_after',
    });

    assert.equal(synchronizeComponentSourceDraft('component_1'), 'synchronized');
    assert.equal(
      useAssetsStore.getState().componentSourceDrafts.component_1.content,
      source.replace('model="mjcf_before"', 'model="mjcf_after"'),
    );
  } finally {
    dom.window.close();
    if (originalDOMParser === undefined) {
      Reflect.deleteProperty(globalThis, 'DOMParser');
    } else {
      Object.defineProperty(globalThis, 'DOMParser', {
        configurable: true,
        value: originalDOMParser,
      });
    }
  }
});
