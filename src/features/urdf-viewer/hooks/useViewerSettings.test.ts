import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { useUIStore } from '@/store';
import { useViewerSettings } from './useViewerSettings.ts';

const ACTIVE_OVERLAY_LAYER_STORAGE_KEY = 'urdf_viewer_active_overlay_layer_v1';
const IK_HANDLE_ALWAYS_ON_TOP_STORAGE_KEY = 'urdf_viewer_ik_handle_always_on_top';

type ViewerSettingsTestViewOptions = {
  showGrid: boolean;
  showAxes: boolean;
  showUsageGuide: boolean;
  showMjcfWorldLink: boolean;
  showIkHandles: boolean;
  showJointAxes: boolean;
  showInertia: boolean;
  showCenterOfMass: boolean;
  showCollision: boolean;
  modelOpacity: number;
  cameraProjection: 'perspective' | 'orthographic';
  renderQuality: 'performance' | 'balanced' | 'high' | 'ultra';
};

const DEFAULT_VIEW_OPTIONS: ViewerSettingsTestViewOptions = {
  showGrid: true,
  showAxes: true,
  showUsageGuide: true,
  showMjcfWorldLink: false,
  showIkHandles: false,
  showJointAxes: false,
  showInertia: false,
  showCenterOfMass: false,
  showCollision: false,
  modelOpacity: 1,
  cameraProjection: 'perspective',
  renderQuality: 'high',
};

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
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: dom.window.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });

  return dom;
}

function resetUiStore(viewOptions: Partial<ViewerSettingsTestViewOptions> = {}) {
  useUIStore.setState((state) => ({
    ...state,
    viewOptions: {
      ...DEFAULT_VIEW_OPTIONS,
      ...viewOptions,
    },
  }));
}

function renderSettings() {
  let hookValue: ReturnType<typeof useViewerSettings> | null = null as ReturnType<typeof useViewerSettings> | null;

  function Probe() {
    hookValue = useViewerSettings();
    return null;
  }

  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(hookValue, 'hook should render');
  return hookValue as ReturnType<typeof useViewerSettings>;
}

async function mountSettings(
  viewOptions: Partial<ViewerSettingsTestViewOptions> = {},
  prepareDom?: (dom: JSDOM) => void,
) {
  const dom = installDom();
  resetUiStore(viewOptions);
  prepareDom?.(dom);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useViewerSettings> | null = null as ReturnType<typeof useViewerSettings> | null;

  function Probe() {
    hookValue = useViewerSettings();
    return null;
  }

  await act(async () => {
    root.render(React.createElement(Probe));
  });

  return {
    dom,
    root,
    getSettings() {
      assert.ok(hookValue, 'hook should stay mounted');
      return hookValue as ReturnType<typeof useViewerSettings>;
    },
  };
}

test('origin axes default to depth-occluded rendering when no preference is saved', () => {
  const dom = installDom();
  resetUiStore();
  dom.window.localStorage.removeItem('urdf_viewer_origin_overlay_v2');
  dom.window.localStorage.setItem('urdf_viewer_origin_overlay', 'true');

  const settings = renderSettings();

  assert.equal(settings.showOriginsOverlay, false);

  dom.window.close();
});

test('origin axes overlay preference still restores explicit user opt-in', () => {
  const dom = installDom();
  resetUiStore();
  dom.window.localStorage.setItem('urdf_viewer_origin_overlay_v2', 'true');

  const settings = renderSettings();

  assert.equal(settings.showOriginsOverlay, true);

  dom.window.close();
});

test('collision overlay defaults to depth-occluded rendering when no preference is saved', () => {
  const dom = installDom();
  resetUiStore();
  dom.window.localStorage.removeItem(ACTIVE_OVERLAY_LAYER_STORAGE_KEY);
  dom.window.localStorage.removeItem('urdf_viewer_collision_always_on_top');

  const settings = renderSettings();

  assert.equal(settings.showCollisionAlwaysOnTop, false);

  dom.window.close();
});

test('viewer visibility toggles and sizing parameters restore from saved preferences', async () => {
  const { dom, root, getSettings } = await mountSettings(
    {
      showCollision: true,
      showCenterOfMass: true,
      showInertia: true,
      showJointAxes: true,
    },
    (preparedDom) => {
      preparedDom.window.localStorage.setItem('urdf_viewer_show_visual', 'false');
      preparedDom.window.localStorage.setItem('urdf_viewer_com_size', '0.12');
      preparedDom.window.localStorage.setItem('urdf_viewer_show_origins', 'true');
      preparedDom.window.localStorage.setItem('urdf_viewer_show_mjcf_sites', 'true');
      preparedDom.window.localStorage.setItem('urdf_viewer_origin_size', '0.18');
      preparedDom.window.localStorage.setItem('urdf_viewer_joint_axis_size', '0.42');
    },
  );

  const settings = getSettings();

  assert.equal(settings.showCollision, true);
  assert.equal(settings.localShowVisual, false);
  assert.equal(settings.showCenterOfMass, true);
  assert.equal(settings.centerOfMassSize, 0.12);
  assert.equal(settings.showInertia, true);
  assert.equal(settings.showOrigins, true);
  assert.equal(settings.showMjcfSites, true);
  assert.equal(settings.originSize, 0.18);
  assert.equal(settings.showJointAxes, true);
  assert.equal(settings.jointAxisSize, 0.42);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('overlay top-most state is mutually exclusive and last activation wins', async () => {
  const { dom, root, getSettings } = await mountSettings({
    showCollision: true,
    showCenterOfMass: true,
    showInertia: true,
    showJointAxes: true,
  });

  await act(async () => {
    getSettings().setShowOrigins(true);
    getSettings().setShowOriginsOverlay(true);
  });

  let settings = getSettings();
  assert.equal(settings.showOriginsOverlay, true);
  assert.equal(settings.showCollisionAlwaysOnTop, false);
  assert.equal(settings.showJointAxesOverlay, false);
  assert.equal(settings.showCoMOverlay, false);
  assert.equal(settings.showInertiaOverlay, false);
  assert.equal(settings.interactionLayerPriority[0], 'origin-axes');

  await act(async () => {
    getSettings().setShowCollisionAlwaysOnTop(true);
  });

  settings = getSettings();
  assert.equal(settings.showCollisionAlwaysOnTop, true);
  assert.equal(settings.showOriginsOverlay, false);
  assert.equal(settings.showJointAxesOverlay, false);
  assert.equal(settings.showCoMOverlay, false);
  assert.equal(settings.showInertiaOverlay, false);
  assert.equal(settings.interactionLayerPriority[0], 'collision');
  assert.equal(dom.window.localStorage.getItem(ACTIVE_OVERLAY_LAYER_STORAGE_KEY), 'collision');

  await act(async () => {
    getSettings().setShowJointAxesOverlay(true);
  });

  settings = getSettings();
  assert.equal(settings.showCollisionAlwaysOnTop, false);
  assert.equal(settings.showOriginsOverlay, false);
  assert.equal(settings.showJointAxesOverlay, true);
  assert.equal(settings.showCoMOverlay, false);
  assert.equal(settings.showInertiaOverlay, false);
  assert.equal(settings.interactionLayerPriority[0], 'joint-axis');
  assert.equal(dom.window.localStorage.getItem(ACTIVE_OVERLAY_LAYER_STORAGE_KEY), 'joint-axis');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('hiding the active overlay layer clears the persisted top-most selection', async () => {
  const { dom, root, getSettings } = await mountSettings({
    showCollision: true,
  });

  await act(async () => {
    getSettings().setShowCollisionAlwaysOnTop(true);
  });

  assert.equal(getSettings().showCollisionAlwaysOnTop, true);
  assert.equal(dom.window.localStorage.getItem(ACTIVE_OVERLAY_LAYER_STORAGE_KEY), 'collision');

  await act(async () => {
    getSettings().setShowCollision(false);
  });

  const settings = getSettings();
  assert.equal(settings.showCollision, false);
  assert.equal(settings.showCollisionAlwaysOnTop, false);
  assert.equal(dom.window.localStorage.getItem(ACTIVE_OVERLAY_LAYER_STORAGE_KEY), 'none');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ik handle always-on-top preference persists while disabled handles stay out of interaction priority', async () => {
  const { dom, root, getSettings } = await mountSettings({ showIkHandles: true }, (preparedDom) => {
    preparedDom.window.localStorage.setItem(IK_HANDLE_ALWAYS_ON_TOP_STORAGE_KEY, 'false');
  });

  let settings = getSettings();
  assert.equal(settings.showIkHandlesAlwaysOnTop, false);

  await act(async () => {
    getSettings().setShowIkHandlesAlwaysOnTop(true);
  });

  settings = getSettings();
  assert.equal(settings.showIkHandlesAlwaysOnTop, true);
  assert.equal(dom.window.localStorage.getItem(IK_HANDLE_ALWAYS_ON_TOP_STORAGE_KEY), 'true');
  assert.equal(settings.interactionLayerPriority.includes('ik-handle'), false);

  await act(async () => {
    getSettings().setShowIkHandlesAlwaysOnTop(false);
  });

  settings = getSettings();
  assert.equal(settings.showIkHandlesAlwaysOnTop, false);
  assert.equal(dom.window.localStorage.getItem(IK_HANDLE_ALWAYS_ON_TOP_STORAGE_KEY), 'false');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joint axes can still take interaction priority while ik handles render on top', async () => {
  const { dom, root, getSettings } = await mountSettings({
    showIkHandles: true,
    showJointAxes: false,
  });

  assert.equal(getSettings().showIkHandlesAlwaysOnTop, true);

  await act(async () => {
    getSettings().setShowJointAxes(true);
  });

  const settings = getSettings();
  assert.equal(settings.showJointAxes, true);
  assert.equal(settings.showIkHandlesAlwaysOnTop, true);
  assert.equal(settings.interactionLayerPriority[0], 'joint-axis');
  assert.equal(settings.interactionLayerPriority.includes('ik-handle'), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
