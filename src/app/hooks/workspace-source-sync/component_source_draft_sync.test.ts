import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createComponentSourceDraft,
  createDefaultWorkspace,
  isComponentSourceDraftMatchingComponent,
} from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { generateEditableRobotSource } from '@/app/utils/generateEditableRobotSource';
import {
  synchronizeComponentSourceDraft,
} from './component_source_draft_sync.ts';

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
