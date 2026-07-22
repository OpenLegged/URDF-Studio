import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { createSingleComponentWorkspace } from '@/core/robot';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type AssemblyState,
  type EntityRef,
  type RobotData,
  type WorkspaceSelection,
} from '@/types';
import { translations } from '@/shared/i18n';
import {
  AssemblyProperties,
  BridgeProperties,
  ComponentProperties,
  PropertyEditor,
  resolvePropertyEditorTarget,
} from './PropertyEditor.tsx';

function createRobot(owner: string): RobotData {
  return {
    name: `${owner}_source_robot`,
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: `${owner}_base_display`,
        visible: true,
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          color: owner === 'left' ? '#ff0000' : '#0000ff',
        },
      },
      thigh_link: {
        ...DEFAULT_LINK,
        id: 'thigh_link',
        name: `${owner}_thigh_display`,
        visible: true,
      },
    },
    joints: {
      hip_joint: {
        ...DEFAULT_JOINT,
        id: 'hip_joint',
        name: `${owner}_hip_display`,
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'thigh_link',
      },
    },
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 0,
        tendonCount: 1,
        tendonActuatorCount: 1,
        bodiesWithSites: [],
        tendons: [{
          name: 'finger_tendon',
          type: 'fixed',
          className: owner,
          width: 0.03,
          rgba: [0, 1, 0, 1],
          attachmentRefs: ['hip_joint'],
          attachments: [{ type: 'joint', ref: 'hip_joint', coef: 1 }],
          actuatorNames: [`${owner}_tendon_motor`],
        }],
      },
    },
  };
}

function createWorkspace(): AssemblyState {
  const workspace = createSingleComponentWorkspace(createRobot('left'), {
    workspaceName: 'demo_workspace',
    componentId: 'left',
    componentName: 'Left instance',
    sourceFile: null,
  });
  workspace.components.right = createSingleComponentWorkspace(createRobot('right'), {
    componentId: 'right',
    componentName: 'Right instance',
    sourceFile: null,
  }).components.right;
  workspace.bridges.mount = {
    id: 'mount',
    name: 'Mount bridge',
    parentComponentId: 'left',
    parentLinkId: 'base_link',
    childComponentId: 'right',
    childLinkId: 'base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'mount_joint',
      name: 'mount_joint',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'base_link',
    },
  };
  return workspace;
}

function createProps(
  selection: WorkspaceSelection,
  overrides: Record<string, unknown> = {},
) {
  return {
    workspace: createWorkspace(),
    selection,
    onUpdate: () => {},
    mode: 'editor',
    assets: {},
    onUploadAsset: () => {},
    motorLibrary: {},
    lang: 'en',
    ...overrides,
  };
}

function renderPropertyEditor(
  selection: WorkspaceSelection,
  overrides: Record<string, unknown> = {},
): string {
  return renderToStaticMarkup(
    React.createElement(PropertyEditor, createProps(selection, overrides) as any),
  );
}

function getClassName(markup: string, testId: string): string {
  const match = markup.match(new RegExp(`data-testid="${testId}"[^>]*class="([^"]+)"`));
  assert.ok(match, `${testId} should render`);
  return match[1];
}

function getStyle(markup: string, testId: string): string {
  const match = markup.match(new RegExp(`data-testid="${testId}"[^>]*style="([^"]+)"`));
  assert.ok(match, `${testId} should render with inline style`);
  return match[1];
}

function readRenderedText(markup: string, selector: string): string {
  const dom = new JSDOM(markup);
  try {
    const element = dom.window.document.querySelector(selector);
    assert.ok(element, `${selector} should render`);
    return element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  } finally {
    dom.window.close();
  }
}

function readPropertyHeaderKind(markup: string): string {
  const dom = new JSDOM(markup);
  try {
    const title = dom.window.document.querySelector(
      '[data-testid="property-editor-sidebar"] h2',
    );
    assert.ok(title, 'property editor target title should render');
    const kind = title.previousElementSibling;
    assert.ok(kind, 'property editor target kind should render');
    return kind.textContent?.trim() ?? '';
  } finally {
    dom.window.close();
  }
}

function findElement(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean,
): React.ReactElement<Record<string, unknown>> | null {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child)) return child;
    const nested = findElement(child.props.children as React.ReactNode, predicate);
    if (nested) return nested;
  }
  return null;
}

test('same source-local link ID resolves only inside the selected component', () => {
  const leftMarkup = renderPropertyEditor({
    entity: { type: 'link', componentId: 'left', entityId: 'base_link' },
    subType: 'visual',
    objectIndex: 0,
  });
  const rightMarkup = renderPropertyEditor({
    entity: { type: 'link', componentId: 'right', entityId: 'base_link' },
  });

  assert.match(leftMarkup, /left_base_display/);
  assert.doesNotMatch(leftMarkup, /right_base_display/);
  assert.match(rightMarkup, /right_base_display/);
  assert.doesNotMatch(rightMarkup, /left_base_display/);
});

test('tendon selection resolves within its explicit component', () => {
  const markup = renderPropertyEditor({
    entity: { type: 'tendon', componentId: 'right', entityId: 'finger_tendon' },
  });

  assert.match(markup, /finger_tendon/);
  assert.match(markup, /right_tendon_motor/);
  assert.doesNotMatch(markup, /left_tendon_motor/);
  assert.doesNotMatch(markup, new RegExp(translations.en.selectedJoint));
});

test('bridge selection renders a bridge form instead of joint properties', () => {
  const markup = renderPropertyEditor({ entity: { type: 'bridge', bridgeId: 'mount' } });

  assert.match(markup, /data-testid="bridge-properties"/);
  assert.match(markup, /Mount bridge/);
  assert.match(markup, /left \/ base_link/);
  assert.match(markup, /right \/ base_link/);
  assert.doesNotMatch(markup, new RegExp(translations.en.selectedJoint));
});

test('bridge edits emit the canonical bridge ref and patch', () => {
  const updates: Array<{ ref: EntityRef; patch: unknown }> = [];
  const bridge = createWorkspace().bridges.mount;
  const element = BridgeProperties({
    bridge,
    bridgeRef: { type: 'bridge', bridgeId: 'mount' },
    mode: 'editor',
    motorLibrary: {},
    t: translations.en,
    lang: 'en',
    onUpdate: (ref, patch) => updates.push({ ref, patch }),
  });
  const nameInput = findElement(element, (child) => (
    child.type === 'input' && child.props['aria-label'] === 'Name'
  )) as React.ReactElement<{
    onChange: (event: { currentTarget: { value: string } }) => void;
  }> | null;
  assert.ok(nameInput);

  nameInput.props.onChange({ currentTarget: { value: 'Renamed bridge' } });
  assert.deepEqual(updates.at(-1), {
    ref: { type: 'bridge', bridgeId: 'mount' },
    patch: { name: 'Renamed bridge' },
  });

  const jointEditor = findElement(element, (child) => (
    typeof child.type === 'function'
    && 'selection' in child.props
    && (child.props.selection as { id?: string }).id === 'mount_joint'
  ));
  assert.ok(jointEditor, 'bridge should adapt the full joint property editor');
  const updatedJoint = {
    ...bridge.joint,
    origin: {
      ...bridge.joint.origin,
      xyz: { x: 1, y: 2, z: 3 },
    },
    dynamics: { ...bridge.joint.dynamics, damping: 0.75 },
  };
  (jointEditor.props.onUpdate as (
    type: 'joint',
    id: string,
    patch: unknown,
  ) => void)('joint', 'mount_joint', updatedJoint);
  assert.deepEqual(updates.at(-1), {
    ref: { type: 'bridge', bridgeId: 'mount' },
    patch: { joint: updatedJoint },
  });
});

test('assembly and component selections expose direct canonical fields', () => {
  const assemblyMarkup = renderPropertyEditor({ entity: { type: 'assembly' } });
  const componentMarkup = renderPropertyEditor({
    entity: { type: 'component', componentId: 'left' },
  });

  assert.match(assemblyMarkup, /data-testid="assembly-properties"/);
  assert.match(assemblyMarkup, /demo_workspace/);
  assert.match(assemblyMarkup, /Transform/);
  assert.match(componentMarkup, /data-testid="component-properties"/);
  assert.match(componentMarkup, /Left instance/);
  assert.match(componentMarkup, /Source file/);
  assert.match(componentMarkup, />None</);
});

test('component identity fields keep long names and source paths inside a narrow panel', () => {
  const workspace = createWorkspace();
  const component = workspace.components.left;
  component.name = 'component-name-with-a-very-long-unbroken-suffix-that-must-shrink';
  component.sourceFile =
    'assemblies/components/source-file-with-a-very-long-unbroken-suffix-that-must-truncate.urdf';

  const markup = renderToStaticMarkup(ComponentProperties({
    component,
    refValue: { type: 'component', componentId: 'left' },
    lang: 'en',
    onUpdate: () => {},
  }));
  const dom = new JSDOM(markup);

  try {
    const nameRow = dom.window.document.querySelector('[data-testid="component-name-row"]');
    const visibilityRow = dom.window.document.querySelector(
      '[data-testid="component-visibility-row"]',
    );
    const sourceFileRow = dom.window.document.querySelector(
      '[data-testid="component-source-file-row"]',
    );
    const nameInput = dom.window.document.querySelector<HTMLInputElement>(
      'input[aria-label="Display name"]',
    );
    const sourceValue = dom.window.document.querySelector(
      '[data-testid="component-source-file-value"]',
    );
    const sourceText = sourceValue?.querySelector('span');

    assert.ok(nameRow, 'display name should use the responsive property row');
    assert.ok(visibilityRow, 'visibility should use the responsive property row');
    assert.ok(sourceFileRow, 'source file should stay in the same responsive property grid');
    assert.match(
      nameRow.parentElement?.className ?? '',
      /\bgap-y-1\b/,
      'component fields should keep a visible vertical gap at every panel width',
    );
    assert.match(nameRow.className, /\bmin-w-0\b/);
    assert.match(visibilityRow.className, /\bmin-w-0\b/);
    assert.match(sourceFileRow.className, /\bmin-w-0\b/);
    assert.ok(nameInput);
    assert.match(nameInput.className, /\bmin-w-0\b/);
    assert.ok(sourceValue, 'source path should expose a dedicated responsive value');
    assert.equal(sourceValue.getAttribute('title'), component.sourceFile);
    assert.ok(sourceText);
    assert.match(sourceText.className, /\btruncate\b/);
    assert.equal(
      sourceText.textContent,
      'source-file-with-a-very-long-unbroken-suffix-that-must-truncate.urdf',
    );
  } finally {
    dom.window.close();
  }
});

test('workspace property targets localize Chinese entity and transform labels', () => {
  const assemblyMarkup = renderPropertyEditor(
    { entity: { type: 'assembly' } },
    { lang: 'zh' },
  );
  const componentMarkup = renderPropertyEditor(
    { entity: { type: 'component', componentId: 'left' } },
    { lang: 'zh' },
  );
  const bridgeMarkup = renderPropertyEditor(
    { entity: { type: 'bridge', bridgeId: 'mount' } },
    { lang: 'zh' },
  );

  assert.equal(readPropertyHeaderKind(assemblyMarkup), '装配');
  assert.equal(readPropertyHeaderKind(componentMarkup), '组件');
  assert.equal(readPropertyHeaderKind(bridgeMarkup), '桥接');

  const assemblyText = readRenderedText(assemblyMarkup, '[data-testid="assembly-properties"]');
  const componentText = readRenderedText(
    componentMarkup,
    '[data-testid="component-properties"]',
  );
  const bridgeText = readRenderedText(bridgeMarkup, '[data-testid="bridge-properties"]');
  assert.match(assemblyText, /装配/);
  assert.match(assemblyText, /变换/);
  assert.match(componentText, /组件/);
  assert.match(componentText, /显示名称/);
  assert.match(componentText, /源文件/);
  assert.match(componentText, /变换/);
  assert.match(bridgeText, /桥接/);
  assert.match(bridgeText, /父组件/);
  assert.match(bridgeText, /子组件/);

  const workspacePropertyText = `${assemblyText} ${componentText} ${bridgeText}`;
  assert.doesNotMatch(workspacePropertyText, /position-[xyz]/i);
  assert.doesNotMatch(workspacePropertyText, /rotation-[rpy]/i);
});

test('bridged child component edits its explicit incoming bridge attachment transform', () => {
  const workspace = createWorkspace();
  workspace.bridges.mount.joint.origin = {
    xyz: { x: 1, y: 2, z: 3 },
    rpy: { r: 0.1, p: 0.2, y: 0.3 },
    quatXyzw: { x: 0, y: 0, z: 0, w: 1 },
  };
  const updates: Array<{ ref: EntityRef; patch: unknown }> = [];
  const element = ComponentProperties({
    component: workspace.components.right,
    refValue: { type: 'component', componentId: 'right' },
    incomingBridge: workspace.bridges.mount,
    lang: 'en',
    onUpdate: (ref, patch) => updates.push({ ref, patch }),
  });
  const transformEditor = findElement(element, (child) => (
    child.props.title === 'Bridge attachment transform'
    && typeof child.props.onChange === 'function'
  ));
  assert.ok(transformEditor);
  assert.deepEqual(transformEditor.props.transform, {
    position: { x: 1, y: 2, z: 3 },
    rotation: { r: 0.1, p: 0.2, y: 0.3 },
  });

  (transformEditor.props.onChange as (value: unknown) => void)(transformEditor.props.transform);
  assert.deepEqual(updates.at(-1), {
    ref: { type: 'bridge', bridgeId: 'mount' },
    patch: {
      joint: {
        origin: {
          xyz: { x: 1, y: 2, z: 3 },
          rpy: { r: 0.1, p: 0.2, y: 0.3 },
          quatXyzw: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
    },
  });
  updates.length = 0;

  const nextTransform = {
    position: { x: 4, y: 5, z: 6 },
    rotation: { r: -0.1, p: -0.2, y: -0.3 },
  };
  (transformEditor.props.onChange as (value: unknown) => void)(nextTransform);
  assert.deepEqual(updates, [{
    ref: { type: 'bridge', bridgeId: 'mount' },
    patch: {
      joint: {
        origin: {
          xyz: nextTransform.position,
          rpy: nextTransform.rotation,
          quatXyzw: undefined,
        },
      },
    },
  }]);

  const markup = renderToStaticMarkup(element);
  assert.match(markup, /Bridge attachment transform/);
  assert.match(markup, /controlled by incoming bridge/);
  assert.match(markup, /Mount bridge/);
});

test('assembly transform and component fields emit only their canonical refs', () => {
  const workspace = createWorkspace();
  const updates: Array<{ ref: EntityRef; patch: unknown }> = [];
  const assemblyElement = AssemblyProperties({
    workspace,
    refValue: { type: 'assembly' },
    lang: 'en',
    onUpdate: (ref, patch) => updates.push({ ref, patch }),
  });
  const transformEditor = findElement(assemblyElement, (child) => (
    'transform' in child.props && typeof child.props.onChange === 'function'
  ));
  assert.ok(transformEditor);
  const nextTransform = {
    ...workspace.transform,
    position: { ...workspace.transform.position, x: 4 },
  };
  (transformEditor.props.onChange as (value: unknown) => void)(nextTransform);
  assert.deepEqual(updates.at(-1), {
    ref: { type: 'assembly' },
    patch: { transform: nextTransform },
  });

  const component = workspace.components.left;
  const componentElement = ComponentProperties({
    component,
    refValue: { type: 'component', componentId: 'left' },
    lang: 'en',
    onUpdate: (ref, patch) => updates.push({ ref, patch }),
  });
  const nameInput = findElement(componentElement, (child) => (
    child.type === 'input' && child.props['aria-label'] === 'Display name'
  ));
  const visibilityCheckbox = findElement(componentElement, (child) => (
    typeof child.type === 'function'
    && child.props.ariaLabel === 'Visible'
    && typeof child.props.onChange === 'function'
  ));
  assert.ok(nameInput);
  assert.ok(visibilityCheckbox);
  (nameInput.props.onChange as (event: { currentTarget: { value: string } }) => void)({
    currentTarget: { value: 'Renamed component display' },
  });
  assert.deepEqual(updates.at(-1), {
    ref: { type: 'component', componentId: 'left' },
    patch: { name: 'Renamed component display' },
  });
  assert.equal(component.robot.name, 'left_source_robot');
  (visibilityCheckbox.props.onChange as (checked: boolean) => void)(false);
  assert.deepEqual(updates.at(-1), {
    ref: { type: 'component', componentId: 'left' },
    patch: { visible: false },
  });
});

test('resolver uses exact map keys and never falls back to display names', () => {
  const workspace = createWorkspace();
  assert.equal(resolvePropertyEditorTarget(workspace, {
    entity: { type: 'link', componentId: 'left', entityId: 'left_base_display' },
  }), null);
  assert.equal(resolvePropertyEditorTarget(workspace, {
    entity: { type: 'joint', componentId: 'left', entityId: 'left_hip_display' },
  }), null);
  assert.equal(resolvePropertyEditorTarget(workspace, {
    entity: { type: 'link', componentId: 'toString', entityId: 'base_link' },
  }), null);
});

test('property editor sidebar collapse and resize affordances remain stable', () => {
  const markup = renderPropertyEditor(
    { entity: { type: 'link', componentId: 'left', entityId: 'base_link' } },
    { collapsed: true },
  );
  const sidebarClassName = getClassName(markup, 'property-editor-sidebar');
  const sidebarStyle = getStyle(markup, 'property-editor-sidebar');

  assert.match(sidebarClassName, /\btranslate-x-full\b/);
  assert.match(sidebarClassName, /\btransition-transform\b/);
  assert.match(sidebarStyle, /width:248px/);
  assert.match(sidebarStyle, /min-width:248px/);
  assert.match(sidebarStyle, /contain:layout style/);
  assert.match(
    markup,
    /data-testid="property-editor-sidebar-content"[^>]*aria-hidden="true"[^>]*inert=""/,
  );

  const expanded = renderPropertyEditor({
    entity: { type: 'link', componentId: 'left', entityId: 'base_link' },
  });
  const resizeHandle = getClassName(expanded, 'property-editor-sidebar-resize-handle');
  assert.match(resizeHandle, /\bcursor-col-resize\b/);
});
