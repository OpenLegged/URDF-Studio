import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_LINK } from '@/types/constants';
import type { RobotData } from '@/types';
import { SnapshotDialog } from './SnapshotDialog';
import type { SnapshotPreviewSession } from './snapshot-preview/types';
import {
  resolveSnapshotPreviewRobot,
  resolveSnapshotPreviewShowVisual,
  resolveSnapshotPreviewSourceFile,
} from '../hooks/useSnapshotDialogController';
import { resolveSnapshotPreviewRuntimeReady } from './snapshot-preview/SnapshotPreviewRenderer';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
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
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: dom.window.sessionStorage,
    configurable: true,
  });

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLButtonElement?: typeof HTMLButtonElement }).HTMLButtonElement =
    dom.window.HTMLButtonElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createPreviewRobot(): RobotData {
  return {
    name: 'preview_bot',
    rootLinkId: 'base_link',
    materials: {},
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {},
  };
}

function createPreviewSession(): SnapshotPreviewSession {
  return {
    theme: 'light',
    cameraSnapshot: null,
    viewportAspectRatio: 16 / 9,
    robotName: 'preview_bot',
    robot: createPreviewRobot(),
    assets: {},
    availableFiles: [],
    urdfContent: '',
    showVisual: true,
    isMeshPreview: false,
    viewerReloadKey: 1,
    groundPlaneOffset: 0,
  };
}

test('snapshot preview sessions keep visual geometry enabled for exports', () => {
  assert.equal(resolveSnapshotPreviewShowVisual(), true);
});

test('snapshot preview robot restores visual visibility without mutating the source robot', () => {
  const sourceRobot = createPreviewRobot();
  sourceRobot.links.base_link = {
    ...sourceRobot.links.base_link,
    visible: false,
    visual: {
      ...sourceRobot.links.base_link.visual,
      visible: false,
    },
    visualBodies: [
      {
        ...sourceRobot.links.base_link.visual,
        name: 'secondary_visual',
        visible: false,
      },
    ],
  };

  const previewRobot = resolveSnapshotPreviewRobot(sourceRobot);

  assert.equal(previewRobot.links.base_link.visible, true);
  assert.equal(previewRobot.links.base_link.visual.visible, true);
  assert.equal(previewRobot.links.base_link.visualBodies?.[0]?.visible, true);
  assert.equal(sourceRobot.links.base_link.visible, false);
  assert.equal(sourceRobot.links.base_link.visual.visible, false);
  assert.equal(sourceRobot.links.base_link.visualBodies?.[0]?.visible, false);
});

test('snapshot preview source falls back to the available robot file', () => {
  const sourceFile = resolveSnapshotPreviewSourceFile({
    viewerSourceFile: null,
    availableFiles: [
      {
        name: 'snapshot_visual_probe.urdf',
        content: '<robot name="snapshot_visual_probe" />',
        format: 'urdf',
      },
    ],
    urdfContentForViewer: '',
    robotName: 'snapshot_visual_probe',
  });

  assert.equal(sourceFile?.name, 'snapshot_visual_probe.urdf');
  assert.equal(sourceFile?.format, 'urdf');
});

test('snapshot preview source keeps MJCF effective path and content aligned', () => {
  const sourceFile = resolveSnapshotPreviewSourceFile({
    viewerSourceFile: {
      name: 'mujoco_menagerie-main/unitree_go2/scene.xml',
      content: '<mujoco model="scene"><include file="go2.xml"/></mujoco>',
      format: 'mjcf',
    },
    viewerSourceFilePath: 'mujoco_menagerie-main/unitree_go2/go2.xml',
    viewerSourceFormat: 'mjcf',
    availableFiles: [],
    urdfContentForViewer: '<mujoco model="go2"><worldbody /></mujoco>',
    robotName: 'go2',
  });

  assert.equal(sourceFile?.name, 'mujoco_menagerie-main/unitree_go2/go2.xml');
  assert.equal(sourceFile?.format, 'mjcf');
  assert.equal(sourceFile?.content, '<mujoco model="go2"><worldbody /></mujoco>');
});

test('snapshot preview source does not synthesize URDF for inline MJCF content', () => {
  const sourceFile = resolveSnapshotPreviewSourceFile({
    viewerSourceFile: null,
    viewerSourceFilePath: undefined,
    viewerSourceFormat: 'mjcf',
    availableFiles: [],
    urdfContentForViewer: '<mujoco model="inline"><worldbody /></mujoco>',
    robotName: 'inline_mjcf',
  });

  assert.equal(sourceFile?.name, 'inline_mjcf-snapshot-preview.xml');
  assert.equal(sourceFile?.format, 'mjcf');
  assert.equal(sourceFile?.content, '<mujoco model="inline"><worldbody /></mujoco>');
});

test('snapshot preview stays interactive after a runtime refresh follows initial warmup', () => {
  assert.equal(
    resolveSnapshotPreviewRuntimeReady({
      previewLoadRevision: 0,
      previewWarmupRevision: 0,
      hasCompletedWarmup: false,
    }),
    false,
  );
  assert.equal(
    resolveSnapshotPreviewRuntimeReady({
      previewLoadRevision: 2,
      previewWarmupRevision: 1,
      hasCompletedWarmup: false,
    }),
    false,
  );
  assert.equal(
    resolveSnapshotPreviewRuntimeReady({
      previewLoadRevision: 2,
      previewWarmupRevision: 0,
      hasCompletedWarmup: true,
    }),
    true,
  );
});

test('SnapshotDialog reuses the segmented surface tone for AA choices', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
        }),
      );
    });

    const twoXButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '2x',
    ) as HTMLButtonElement | undefined;
    assert.ok(twoXButton, 'AA segmented control should render the default 2x option');
    assert.match(
      twoXButton.className,
      /\bbg-segmented-active\b/,
      'selected AA option should use the same segmented active tone as settings controls',
    );
    assert.match(
      twoXButton.className,
      /\bring-1\b/,
      'selected AA option should keep the shared selected outline treatment',
    );

    const oneXButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '1x',
    ) as HTMLButtonElement | undefined;
    assert.ok(oneXButton, 'AA segmented control should render the 1x option');
    assert.match(
      oneXButton.className,
      /\btext-text-secondary\b/,
      'unselected AA option should keep the shared secondary text tone',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog opens wide enough for the interactive preview canvas', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
        }),
      );
    });

    const windowRoot = container.firstElementChild as HTMLElement | null;
    assert.ok(windowRoot, 'snapshot dialog should render a draggable window root');
    assert.equal(
      windowRoot.style.width,
      '520px',
      'snapshot dialog should default to a compact width that still leaves enough room to orbit the preview',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog defaults the grid toggle to off with the visible Grid label', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
        }),
      );
    });

    const labelTexts = Array.from(container.querySelectorAll('div'))
      .map((element) => element.textContent?.trim())
      .filter(Boolean);
    assert.ok(
      labelTexts.includes('Grid'),
      'snapshot dialog should expose the positive Grid label instead of Hide Grid',
    );
    assert.ok(
      !labelTexts.includes('Hide Grid'),
      'snapshot dialog should no longer render the old negative grid label',
    );

    const gridSwitch = container.querySelector('[role="switch"]');
    assert.ok(gridSwitch, 'snapshot dialog should render the grid switch');
    assert.equal(
      gridSwitch?.getAttribute('aria-checked'),
      'false',
      'grid should be hidden by default when the dialog opens',
    );
    assert.equal(
      gridSwitch?.getAttribute('aria-label'),
      'Grid',
      'grid switch aria label should match the visible positive label',
    );
    assert.match(
      gridSwitch?.parentElement?.className ?? '',
      /\bjustify-start\b/,
      'grid switch row should align the control to the left edge of its field',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog does not render depth-of-field controls', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
        }),
      );
    });

    assert.equal(container.textContent?.includes('DoF'), false);
    assert.equal(container.textContent?.includes('Depth of Field'), false);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog exposes aspect ratio choices and submits the selected preset', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  let capturedAspectRatioPreset: string | null = null;

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: (options) => {
            capturedAspectRatioPreset = options.aspectRatioPreset;
          },
        }),
      );
    });

    const aspectSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === '9:16'),
    ) as HTMLSelectElement | undefined;
    assert.ok(aspectSelect, 'snapshot dialog should render an aspect ratio select');
    assert.equal(aspectSelect.value, 'viewport');
    assert.deepEqual(
      Array.from(aspectSelect.options).map((option) => option.value),
      ['viewport', '16:9', '4:3', '1:1', '3:4', '9:16'],
    );

    await act(async () => {
      aspectSelect.value = '1:1';
      aspectSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    const captureButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Export Snapshot'),
    ) as HTMLButtonElement | undefined;
    assert.ok(captureButton, 'snapshot dialog should render the export button');

    await act(async () => {
      captureButton.click();
    });

    assert.equal(capturedAspectRatioPreset, '1:1');
    assert.match(
      container.textContent ?? '',
      /4K · 1:1 · PNG · 2x/,
      'capture summary should include the selected aspect ratio',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog shows export progress and keeps the original dialog mounted while capturing', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  let cancelled = false;

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: true,
          captureProgress: { phase: 'rendering', progress: 0.42 },
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          onCancelCapture: () => {
            cancelled = true;
          },
        }),
      );
    });

    const progressOverlay = container.querySelector('[data-testid="snapshot-export-progress"]');
    assert.ok(progressOverlay, 'snapshot dialog should render export progress while capturing');
    assert.match(
      progressOverlay?.textContent ?? '',
      /Rendering the high-resolution image/,
      'progress overlay should describe the active export phase',
    );

    const progressBar = container.querySelector('[role="progressbar"]');
    assert.equal(progressBar?.getAttribute('aria-valuenow'), '42');
    assert.ok(
      container.querySelector('[data-testid="snapshot-preview-card"]'),
      'snapshot dialog should keep the original preview/settings content mounted under the progress overlay',
    );

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel',
    ) as HTMLButtonElement | undefined;
    assert.ok(cancelButton, 'snapshot dialog should expose a cancel button while exporting');

    await act(async () => {
      cancelButton.click();
    });

    assert.equal(cancelled, true);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog gates window close during capture but keeps cancel available', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  let closeCount = 0;
  let cancelCount = 0;

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: true,
          captureProgress: { phase: 'rendering', progress: 0.42 },
          lang: 'en',
          onClose: () => {
            closeCount += 1;
          },
          onCapture: () => {},
          onCancelCapture: () => {
            cancelCount += 1;
          },
        }),
      );
    });

    const headerCloseButton = container.querySelector(
      'button[aria-label="Close"][data-window-control]',
    ) as HTMLButtonElement | null;
    assert.ok(headerCloseButton, 'snapshot dialog should render a window close button');

    await act(async () => {
      headerCloseButton.click();
    });

    assert.equal(closeCount, 0, 'window close should be ignored while capture is active');

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel',
    ) as HTMLButtonElement | undefined;
    assert.ok(cancelButton, 'snapshot dialog should keep the capture cancel action available');

    await act(async () => {
      cancelButton.click();
    });

    assert.equal(cancelCount, 1);

    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {
            closeCount += 1;
          },
          onCapture: () => {},
          onCancelCapture: () => {
            cancelCount += 1;
          },
        }),
      );
    });

    const reopenedCloseButton = container.querySelector(
      'button[aria-label="Close"][data-window-control]',
    ) as HTMLButtonElement | null;
    assert.ok(reopenedCloseButton, 'snapshot dialog should still render the close button');

    await act(async () => {
      reopenedCloseButton.click();
    });

    assert.equal(closeCount, 1, 'window close should run again once capture has ended');
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog renders the live preview state without the frozen-view hint copy', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'refreshing',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const previewImage = container.querySelector('img[alt="Snapshot live preview"]');
    assert.ok(previewImage, 'snapshot dialog should render the latest preview image');
    assert.equal(previewImage?.getAttribute('src'), 'blob:preview');
    assert.equal(
      previewImage?.getAttribute('draggable'),
      'false',
      'snapshot dialog preview image should opt out of native browser drag behavior',
    );

    const textContent = container.textContent ?? '';
    assert.match(textContent, /Live Preview/);
    assert.match(textContent, /Updating preview/);
    assert.doesNotMatch(textContent, /Based on the view when this dialog opened/);
    assert.doesNotMatch(textContent, /Final export quality still follows the selected resolution/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog cleans up preview layout observers when it closes', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalResizeObserver = (globalThis as { ResizeObserver?: typeof ResizeObserver })
    .ResizeObserver;
  const originalAddEventListener = dom.window.addEventListener.bind(dom.window);
  const originalRemoveEventListener = dom.window.removeEventListener.bind(dom.window);
  const resizeHandlers = new Set<EventListenerOrEventListenerObject>();
  let observeCount = 0;
  let disconnectCount = 0;

  class MockResizeObserver implements ResizeObserver {
    readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe() {
      observeCount += 1;
    }

    unobserve() {}

    disconnect() {
      disconnectCount += 1;
    }
  }

  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
  type AddEventListenerArgs = Parameters<typeof dom.window.addEventListener>;
  type RemoveEventListenerArgs = Parameters<typeof dom.window.removeEventListener>;
  const addEventListenerOverride: typeof dom.window.addEventListener = (
    ...args: AddEventListenerArgs
  ) => {
    const [type, listener] = args;
    if (type === 'resize' && listener) {
      resizeHandlers.add(listener);
      originalAddEventListener(type as never, listener as never, args[2] as never);
      return;
    }
  };
  dom.window.addEventListener = addEventListenerOverride;
  const removeEventListenerOverride: typeof dom.window.removeEventListener = (
    ...args: RemoveEventListenerArgs
  ) => {
    const [type, listener] = args;
    if (type === 'resize' && listener) {
      resizeHandlers.delete(listener);
      originalRemoveEventListener(type as never, listener as never, args[2] as never);
      return;
    }
  };
  dom.window.removeEventListener = removeEventListenerOverride;

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    assert.equal(observeCount, 1, 'preview layout should observe the preview frame area');
    const activeResizeHandlerCount = resizeHandlers.size;
    assert.ok(activeResizeHandlerCount >= 1, 'preview layout should subscribe to window resize');

    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: false,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
        }),
      );
    });

    assert.equal(disconnectCount, 1, 'preview layout should disconnect its ResizeObserver');
    assert.ok(
      resizeHandlers.size < activeResizeHandlerCount,
      'preview layout should remove its window resize listener',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    if (originalResizeObserver) {
      (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
        originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
    dom.window.addEventListener = originalAddEventListener as typeof dom.window.addEventListener;
    dom.window.removeEventListener =
      originalRemoveEventListener as typeof dom.window.removeEventListener;
    dom.window.close();
  }
});

test('SnapshotDialog renders an interactive preview canvas when a preview session is available', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewSession: createPreviewSession(),
        }),
      );
    });

    const previewCanvasContainer = container.querySelector(
      '[data-testid="snapshot-preview-canvas"]',
    );
    assert.ok(
      previewCanvasContainer,
      'snapshot dialog should render the interactive preview canvas container',
    );
    assert.equal(
      container.querySelector('img[alt="Snapshot live preview"]'),
      null,
      'snapshot dialog should not use a static preview image when a live session is available',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog keeps the interactive preview when stale image state is present', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewSession: createPreviewSession(),
          previewState: {
            status: 'ready',
            imageUrl: 'blob:stale-preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    assert.ok(
      container.querySelector('[data-testid="snapshot-preview-canvas"]'),
      'snapshot dialog should keep the interactive preview canvas when a session is available',
    );
    assert.equal(
      container.querySelector('img[alt="Snapshot live preview"]'),
      null,
      'snapshot dialog should not fall back to a static image while live preview can be dragged',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog keeps the live preview inside the scrollable content area', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const scrollableContent = container.querySelector('.overflow-y-auto');
    assert.ok(scrollableContent, 'snapshot dialog should keep a scrollable content region');
    assert.match(
      scrollableContent.textContent ?? '',
      /Live Preview/,
      'preview content should stay inside the scrollable body instead of competing with the footer',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog keeps the live preview inside an adaptive shell instead of letting it consume the full card width', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const scrollableContent = container.querySelector('.overflow-y-auto') as HTMLElement | null;
    assert.ok(scrollableContent, 'snapshot dialog should render the scrollable body');
    assert.match(
      scrollableContent.className,
      /\bflex-col\b/,
      'scrollable body should stack sections in a flex column so preview content stays in order',
    );

    const previewCard = container.querySelector(
      '[data-testid="snapshot-preview-card"]',
    ) as HTMLElement | null;
    assert.ok(previewCard, 'snapshot dialog should render the preview card');
    assert.match(
      previewCard.className,
      /\bshrink-0\b/,
      'preview card should keep its content height instead of shrinking the frame out of its border',
    );
    assert.doesNotMatch(
      previewCard.className,
      /\bflex-1\b/,
      'preview card should not flex-shrink around an aspect-ratio driven frame',
    );

    const previewShell = container.querySelector(
      '[data-testid="snapshot-preview-frame-shell"]',
    ) as HTMLElement | null;
    assert.ok(previewShell, 'snapshot dialog should render the preview frame shell');
    assert.equal(
      previewShell.style.maxWidth,
      '468px',
      'default snapshot dialog width should let the preview use the available interactive area',
    );

    const previewFrame = container.querySelector(
      '[data-testid="snapshot-preview-frame"]',
    ) as HTMLElement | null;
    assert.ok(previewFrame, 'snapshot dialog should render the preview frame');
    assert.match(
      previewFrame.className,
      /\bw-full\b/,
      'preview frame should use the available card width',
    );
    assert.doesNotMatch(
      previewFrame.className,
      /max-w-\[280px\]/,
      'preview frame should no longer be trapped inside the old narrow width cap',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog auto-fits its default height to the rendered content when the viewport allows it', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalInnerHeightDescriptor = Object.getOwnPropertyDescriptor(dom.window, 'innerHeight');
  const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
    dom.window.HTMLElement.prototype,
    'scrollHeight',
  );
  const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
    dom.window.HTMLElement.prototype,
    'offsetHeight',
  );

  Object.defineProperty(dom.window, 'innerHeight', {
    value: 900,
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return this.className.includes('overflow-y-auto') ? 596 : 0;
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.className.includes('h-10')) {
        return 40;
      }
      if (this.className.includes('border-t')) {
        return 46;
      }
      return 0;
    },
  });

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const windowRoot = container.firstElementChild as HTMLElement | null;
    assert.ok(windowRoot, 'snapshot dialog should render a draggable window root');
    assert.equal(
      windowRoot.style.height,
      '660px',
      'snapshot dialog should cap the fitted desktop height instead of keeping a tall shell',
    );
  } finally {
    if (originalInnerHeightDescriptor) {
      Object.defineProperty(dom.window, 'innerHeight', originalInnerHeightDescriptor);
    }
    if (originalScrollHeightDescriptor) {
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        'scrollHeight',
        originalScrollHeightDescriptor,
      );
    } else {
      delete (dom.window.HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
    if (originalOffsetHeightDescriptor) {
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        'offsetHeight',
        originalOffsetHeightDescriptor,
      );
    } else {
      delete (dom.window.HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog caps its auto-fitted height to the available viewport when the content is taller', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalInnerHeightDescriptor = Object.getOwnPropertyDescriptor(dom.window, 'innerHeight');
  const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
    dom.window.HTMLElement.prototype,
    'scrollHeight',
  );
  const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
    dom.window.HTMLElement.prototype,
    'offsetHeight',
  );

  Object.defineProperty(dom.window, 'innerHeight', {
    value: 680,
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return this.className.includes('overflow-y-auto') ? 700 : 0;
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.className.includes('h-10')) {
        return 40;
      }
      if (this.className.includes('border-t')) {
        return 46;
      }
      return 0;
    },
  });

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const windowRoot = container.firstElementChild as HTMLElement | null;
    assert.ok(windowRoot, 'snapshot dialog should render a draggable window root');
    assert.equal(
      windowRoot.style.height,
      '656px',
      'snapshot dialog should clamp the fitted height to the current viewport limit',
    );
  } finally {
    if (originalInnerHeightDescriptor) {
      Object.defineProperty(dom.window, 'innerHeight', originalInnerHeightDescriptor);
    }
    if (originalScrollHeightDescriptor) {
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        'scrollHeight',
        originalScrollHeightDescriptor,
      );
    } else {
      delete (dom.window.HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
    if (originalOffsetHeightDescriptor) {
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        'offsetHeight',
        originalOffsetHeightDescriptor,
      );
    } else {
      delete (dom.window.HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog collapses its settings sections into one column on narrow viewports', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalInnerWidthDescriptor = Object.getOwnPropertyDescriptor(dom.window, 'innerWidth');

  Object.defineProperty(dom.window, 'innerWidth', {
    value: 430,
    configurable: true,
  });

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
        }),
      );
    });

    const outputSectionTitle = Array.from(container.querySelectorAll('div')).find(
      (element) => element.textContent?.trim() === 'Output',
    );
    assert.ok(outputSectionTitle, 'snapshot dialog should render the output section title');

    const outputSectionGrid = outputSectionTitle.parentElement?.querySelector(
      '.grid',
    ) as HTMLElement | null;
    assert.ok(outputSectionGrid, 'output section should render a settings grid');
    assert.match(
      outputSectionGrid.className,
      /\bgrid-cols-1\b/,
      'narrow snapshot dialog widths should collapse settings into a single column',
    );

    const sceneSectionTitle = Array.from(container.querySelectorAll('div')).find(
      (element) => element.textContent?.trim() === 'Scene',
    );
    assert.ok(sceneSectionTitle, 'snapshot dialog should render the scene section title');

    const sceneSectionGrid = sceneSectionTitle.parentElement?.querySelector(
      '.grid',
    ) as HTMLElement | null;
    assert.ok(sceneSectionGrid, 'scene section should render a settings grid');
    assert.match(
      sceneSectionGrid.className,
      /\bgrid-cols-1\b/,
      'scene settings should also collapse to a single column on narrow widths',
    );
  } finally {
    if (originalInnerWidthDescriptor) {
      Object.defineProperty(dom.window, 'innerWidth', originalInnerWidthDescriptor);
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog shrinks the preview cap further on narrow layouts so the settings area stays readable', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalInnerWidthDescriptor = Object.getOwnPropertyDescriptor(dom.window, 'innerWidth');

  Object.defineProperty(dom.window, 'innerWidth', {
    value: 430,
    configurable: true,
  });

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const previewShell = container.querySelector(
      '[data-testid="snapshot-preview-frame-shell"]',
    ) as HTMLElement | null;
    assert.ok(previewShell, 'snapshot dialog should render the compact preview shell');
    assert.equal(
      previewShell.style.maxWidth,
      '354px',
      'narrow layouts should reduce the preview cap so the preview does not overwhelm the dialog',
    );
  } finally {
    if (originalInnerWidthDescriptor) {
      Object.defineProperty(dom.window, 'innerWidth', originalInnerWidthDescriptor);
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog fits phone-width viewports and caps portrait preview height', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalInnerWidthDescriptor = Object.getOwnPropertyDescriptor(dom.window, 'innerWidth');
  const originalInnerHeightDescriptor = Object.getOwnPropertyDescriptor(dom.window, 'innerHeight');

  Object.defineProperty(dom.window, 'innerWidth', {
    value: 340,
    configurable: true,
  });
  Object.defineProperty(dom.window, 'innerHeight', {
    value: 620,
    configurable: true,
  });

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 9 / 16,
          },
        }),
      );
    });

    const windowRoot = container.firstElementChild as HTMLElement | null;
    assert.ok(windowRoot, 'snapshot dialog should render a draggable window root');
    assert.equal(
      windowRoot.style.width,
      '320px',
      'phone-width viewports should use the snapshot-specific compact minimum width',
    );

    const previewShell = container.querySelector(
      '[data-testid="snapshot-preview-frame-shell"]',
    ) as HTMLElement | null;
    assert.ok(previewShell, 'snapshot dialog should render the portrait preview shell');
    assert.equal(
      previewShell.style.maxWidth,
      '132px',
      'portrait preview width should shrink enough to respect the viewport-height cap',
    );
  } finally {
    if (originalInnerWidthDescriptor) {
      Object.defineProperty(dom.window, 'innerWidth', originalInnerWidthDescriptor);
    }
    if (originalInnerHeightDescriptor) {
      Object.defineProperty(dom.window, 'innerHeight', originalInnerHeightDescriptor);
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
