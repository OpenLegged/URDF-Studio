import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

type UIStoreModule = typeof import('./uiStore.ts');
const UI_STORE_PERSIST_VERSION = 22;

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });

  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
    configurable: true,
  });

  return dom;
}

async function loadUIStore(
  seedState?: Record<string, unknown>,
  seedVersion = UI_STORE_PERSIST_VERSION,
) {
  const dom = installDom();

  if (seedState) {
    dom.window.localStorage.setItem(
      'urdf-studio-ui',
      JSON.stringify({
        state: seedState,
        version: seedVersion,
      }),
    );
  }

  const moduleUrl = new URL(`./uiStore.ts?test=${Date.now()}-${Math.random()}`, import.meta.url);
  const uiStoreModule = (await import(moduleUrl.href)) as UIStoreModule;

  await uiStoreModule.useUIStore.persist.rehydrate();

  return {
    dom,
    useUIStore: uiStoreModule.useUIStore,
  };
}

test('view options restore persisted world-origin axes and usage-guide preferences', async () => {
  const { dom, useUIStore } = await loadUIStore({
    viewOptions: {
      showGrid: true,
      showAxes: false,
      showMjcfWorldLink: true,
      showJointAxes: false,
      showInertia: false,
      showCenterOfMass: false,
      showCollision: false,
      showUsageGuide: false,
      modelOpacity: 0.42,
      renderQuality: 'balanced',
    },
  });

  const state = useUIStore.getState();
  assert.equal(state.viewOptions.showAxes, false);
  assert.equal(state.viewOptions.showMjcfWorldLink, true);
  assert.equal(state.viewOptions.showUsageGuide, false);
  assert.equal(state.viewOptions.modelOpacity, 0.42);
  assert.equal(state.viewOptions.renderQuality, 'balanced');

  dom.window.close();
});

test('MJCF world visibility defaults to visible for fresh sessions', async () => {
  const { dom, useUIStore } = await loadUIStore();

  const state = useUIStore.getState();
  assert.equal(state.viewOptions.showMjcfWorldLink, true);
  assert.equal(state.viewOptions.showIkHandles, false);
  assert.equal(state.viewOptions.renderQuality, 'high');
  assert.equal(state.panelLayout.treePanelHeightMode, 'balanced');

  dom.window.close();
});

test('managed workbench windows move the activated window to the front without persisting order', async () => {
  const { dom, useUIStore } = await loadUIStore();

  const initialState = useUIStore.getState();
  assert.ok(
    initialState.getManagedWindowZIndex('sourceCode') >
      initialState.getManagedWindowZIndex('settings'),
    'source code should keep its historical default layer above settings',
  );

  initialState.bringWindowToFront('settings');
  const settingsFrontState = useUIStore.getState();
  assert.ok(
    settingsFrontState.getManagedWindowZIndex('settings') >
      settingsFrontState.getManagedWindowZIndex('sourceCode'),
    'activated settings window should move above source code',
  );
  assert.ok(
    settingsFrontState.getManagedWindowZIndex('settings') >
      settingsFrontState.getManagedWindowZIndex('structureGraph'),
    'activated settings window should move above structure graph',
  );

  settingsFrontState.bringWindowToFront('sourceCode');
  const sourceFrontState = useUIStore.getState();
  assert.ok(
    sourceFrontState.getManagedWindowZIndex('sourceCode') >
      sourceFrontState.getManagedWindowZIndex('settings'),
    'last activated source code window should move above settings',
  );

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'persisted ui store payload should be written');
  const persisted = JSON.parse(raw) as {
    state?: {
      managedWindowOrder?: unknown;
    };
  };

  assert.equal(persisted.state?.managedWindowOrder, undefined);

  dom.window.close();
});

test('opening settings moves it above the source code window immediately', async () => {
  const { dom, useUIStore } = await loadUIStore();

  const initialState = useUIStore.getState();
  initialState.bringWindowToFront('sourceCode');
  assert.ok(
    useUIStore.getState().getManagedWindowZIndex('sourceCode') >
      useUIStore.getState().getManagedWindowZIndex('settings'),
    'source code should be in front before opening settings',
  );

  useUIStore.getState().openSettings({ x: 24, y: 32 });
  const settingsOpenState = useUIStore.getState();

  assert.equal(settingsOpenState.isSettingsOpen, true);
  assert.deepEqual(settingsOpenState.settingsPos, { x: 24, y: 32 });
  assert.ok(
    settingsOpenState.getManagedWindowZIndex('settings') >
      settingsOpenState.getManagedWindowZIndex('sourceCode'),
    'opened settings window should immediately move above source code',
  );

  dom.window.close();
});

test('useManagedWindowLayer brings a window to the front when it mounts', async () => {
  // Import the plain (non-cache-busted) store + hook modules so the hook and
  // the test observe the same store instance. We reset state manually instead
  // of going through loadUIStore's query-suffixed module.
  const dom = installDom();
  const uiStoreModule = (await import('./uiStore.ts')) as UIStoreModule;
  const { useManagedWindowLayer } = await import('./useManagedWindowLayer.ts');
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = (await import('react-dom/test-utils')) as {
    act: (cb: () => Promise<unknown>) => Promise<void>;
  };

  const { useUIStore } = uiStoreModule;
  useUIStore.setState({ managedWindowOrder: [...uiStoreModule.DEFAULT_MANAGED_WINDOW_ORDER] });

  // Start with sourceCode at the front; collisionOptimization sits below it.
  useUIStore.getState().bringWindowToFront('sourceCode');
  assert.ok(
    useUIStore.getState().getManagedWindowZIndex('sourceCode') >
      useUIStore.getState().getManagedWindowZIndex('collisionOptimization'),
    'source code should start in front of collision optimization',
  );

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  // Rendering a component that uses the hook simulates the collision
  // optimization window mounting (i.e. being opened).
  function CollisionProbe() {
    useManagedWindowLayer('collisionOptimization');
    return null;
  }

  try {
    await act(async () => {
      root.render(React.createElement(CollisionProbe));
    });

    assert.ok(
      useUIStore.getState().getManagedWindowZIndex('collisionOptimization') >
        useUIStore.getState().getManagedWindowZIndex('sourceCode'),
      'mounting the collision optimization layer should move it above source code',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  dom.window.close();
});

test('legacy default tree panel heights migrate to balanced sizing', async () => {
  const { dom, useUIStore } = await loadUIStore(
    {
      panelLayout: {
        propertyEditorWidth: 248,
        treeFileBrowserHeight: 216,
        treeJointPanelHeight: 132,
        treeSidebarWidth: 264,
      },
    },
    17,
  );

  const state = useUIStore.getState();
  assert.equal(state.panelLayout.treePanelHeightMode, 'balanced');
  assert.equal(state.panelLayout.treeFileBrowserHeight, 240);
  assert.equal(state.panelLayout.treeJointPanelHeight, 240);

  dom.window.close();
});

test('legacy customized tree panel heights migrate as custom sizing', async () => {
  const { dom, useUIStore } = await loadUIStore(
    {
      panelLayout: {
        propertyEditorWidth: 248,
        treeFileBrowserHeight: 280,
        treeJointPanelHeight: 220,
        treeSidebarWidth: 264,
      },
    },
    17,
  );

  const state = useUIStore.getState();
  assert.equal(state.panelLayout.treePanelHeightMode, 'custom');
  assert.equal(state.panelLayout.treeFileBrowserHeight, 280);
  assert.equal(state.panelLayout.treeJointPanelHeight, 220);

  dom.window.close();
});

test('setViewOption persists world-origin axes and usage-guide preferences', async () => {
  const { dom, useUIStore } = await loadUIStore();

  const state = useUIStore.getState();
  state.setViewOption('showAxes', false);
  state.setViewOption('showMjcfWorldLink', true);
  state.setViewOption('showUsageGuide', false);
  state.setViewOption('modelOpacity', 0.42);
  state.setViewOption('renderQuality', 'ultra');

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'persisted ui store payload should be written');

  const persisted = JSON.parse(raw) as {
    state?: {
      viewOptions?: {
        showAxes?: boolean;
        showMjcfWorldLink?: boolean;
        showUsageGuide?: boolean;
        modelOpacity?: number;
        renderQuality?: string;
      };
    };
  };

  assert.equal(persisted.state?.viewOptions?.showAxes, false);
  assert.equal(persisted.state?.viewOptions?.showMjcfWorldLink, true);
  assert.equal(persisted.state?.viewOptions?.showUsageGuide, false);
  assert.equal(persisted.state?.viewOptions?.modelOpacity, 0.42);
  assert.equal(persisted.state?.viewOptions?.renderQuality, 'ultra');

  dom.window.close();
});

test('legacy and malformed render quality preferences migrate to the high default', async () => {
  const { dom, useUIStore } = await loadUIStore(
    {
      viewOptions: {
        renderQuality: 'unsupported',
      },
    },
    21,
  );

  assert.equal(useUIStore.getState().viewOptions.renderQuality, 'high');

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'migrated ui store payload should be written');
  const persisted = JSON.parse(raw) as {
    state?: { viewOptions?: { renderQuality?: string } };
    version?: number;
  };
  assert.equal(persisted.version, UI_STORE_PERSIST_VERSION);
  assert.equal(persisted.state?.viewOptions?.renderQuality, 'high');

  dom.window.close();
});

test('setLang does not expose SEO language paths in the user URL', async () => {
  const { dom, useUIStore } = await loadUIStore();

  useUIStore.getState().setLang('zh');

  assert.equal(useUIStore.getState().lang, 'zh');
  assert.equal(dom.window.location.pathname, '/');

  dom.window.close();
});

test('migration resets legacy MJCF world-link visibility to visible default', async () => {
  const { dom, useUIStore } = await loadUIStore(
    {
      viewOptions: {
        showGrid: true,
        showAxes: true,
        showUsageGuide: true,
        showMjcfWorldLink: true,
        showJointAxes: false,
        showInertia: false,
        showCenterOfMass: false,
        showCollision: false,
        modelOpacity: 1,
      },
    },
    13,
  );

  const state = useUIStore.getState();
  assert.equal(state.viewOptions.showMjcfWorldLink, true);

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'persisted ui store payload should be written');
  const persisted = JSON.parse(raw) as {
    state?: {
      viewOptions?: {
        showMjcfWorldLink?: boolean;
      };
    };
    version?: number;
  };

  assert.equal(persisted.version, UI_STORE_PERSIST_VERSION);
  assert.equal(persisted.state?.viewOptions?.showMjcfWorldLink, true);

  dom.window.close();
});

test('migration resets legacy IK handle visibility to the hidden default', async () => {
  const { dom, useUIStore } = await loadUIStore(
    {
      viewOptions: {
        showGrid: true,
        showAxes: true,
        showUsageGuide: true,
        showMjcfWorldLink: false,
        showIkHandles: true,
        showJointAxes: false,
        showInertia: false,
        showCenterOfMass: false,
        showCollision: false,
        modelOpacity: 1,
      },
    },
    14,
  );

  const state = useUIStore.getState();
  assert.equal(state.viewOptions.showIkHandles, false);

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'persisted ui store payload should be written');
  const persisted = JSON.parse(raw) as {
    state?: {
      viewOptions?: {
        showIkHandles?: boolean;
      };
    };
    version?: number;
  };

  assert.equal(persisted.version, UI_STORE_PERSIST_VERSION);
  assert.equal(persisted.state?.viewOptions?.showIkHandles, false);

  dom.window.close();
});

test('navigation sensitivity defaults to 100% for fresh sessions', async () => {
  const { dom, useUIStore } = await loadUIStore();

  const state = useUIStore.getState();
  assert.deepEqual(state.navigationSensitivity, { zoom: 1, rotate: 1, pan: 1 });

  dom.window.close();
});

test('legacy sessions without navigation sensitivity migrate to defaults', async () => {
  const { dom, useUIStore } = await loadUIStore({}, 14);

  const state = useUIStore.getState();
  assert.deepEqual(state.navigationSensitivity, { zoom: 1, rotate: 1, pan: 1 });

  dom.window.close();
});

test('navigation sensitivity restores persisted values and clamps via the setter', async () => {
  const { dom, useUIStore } = await loadUIStore({
    navigationSensitivity: { zoom: 0.5, rotate: 1.5, pan: 2 },
  });

  assert.deepEqual(useUIStore.getState().navigationSensitivity, {
    zoom: 0.5,
    rotate: 1.5,
    pan: 2,
  });

  // Out-of-range input is clamped to the [0.25, 2] envelope.
  useUIStore.getState().setNavigationSensitivity({ zoom: 9 });
  assert.equal(useUIStore.getState().navigationSensitivity.zoom, 2);
  useUIStore.getState().setNavigationSensitivity({ rotate: 0 });
  assert.equal(useUIStore.getState().navigationSensitivity.rotate, 0.25);
  // Untouched axes are preserved.
  assert.equal(useUIStore.getState().navigationSensitivity.pan, 2);

  dom.window.close();
});

test('source code auto-apply restores from persisted settings and writes updates back', async () => {
  const { dom, useUIStore } = await loadUIStore({
    sourceCodeAutoApply: false,
  });

  assert.equal(useUIStore.getState().sourceCodeAutoApply, false);

  useUIStore.getState().setSourceCodeAutoApply(true);

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'persisted ui store payload should be written');

  const persisted = JSON.parse(raw) as {
    state?: {
      sourceCodeAutoApply?: boolean;
    };
  };

  assert.equal(persisted.state?.sourceCodeAutoApply, true);

  dom.window.close();
});

test('code editor opacity restores, clamps, and persists updates', async () => {
  const { dom, useUIStore } = await loadUIStore({
    codeEditorOpacity: 0.45,
  });

  assert.equal(useUIStore.getState().codeEditorOpacity, 0.45);

  useUIStore.getState().setCodeEditorOpacity(9);
  assert.equal(useUIStore.getState().codeEditorOpacity, 1);

  useUIStore.getState().setCodeEditorOpacity(0);
  assert.equal(useUIStore.getState().codeEditorOpacity, 0.35);

  useUIStore.getState().setCodeEditorOpacity(0.8);

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'persisted ui store payload should be written');

  const persisted = JSON.parse(raw) as {
    state?: {
      codeEditorOpacity?: number;
    };
  };

  assert.equal(persisted.state?.codeEditorOpacity, 0.8);

  dom.window.close();
});
