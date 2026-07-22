import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { DEFAULT_MANAGED_WINDOW_ORDER, useUIStore } from '@/store';
import {
  __setPdfCanvasFactoryForTests,
  __setPdfGenerationDepsLoaderForTests,
} from '@/features/file-io/utils/generatePdfFromHtml';
import { __setInspectionOpenAIClientFactoryForTests } from '../services/aiService';
import { INSPECTION_PROFILE_DEFINITIONS } from '../config/inspectionProfiles';
import { buildNormalInspectionPlan } from '../utils/inspectionNormalPlan';
import { GeometryType, JointType, type RobotState } from '@/types';

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

function installPdfExportMocks(savedFiles: string[]) {
  __setPdfGenerationDepsLoaderForTests(async () => ({
    html2canvas: (async () => ({
      width: 1200,
      height: 1800,
      getContext: () => ({
        fillStyle: '#ffffff',
        fillRect: () => {},
        drawImage: () => {},
      }),
      toDataURL: () => 'data:image/png;base64,source',
    })) as never,
    jsPDF: class {
      internal = {
        pageSize: {
          getWidth: () => 210,
          getHeight: () => 297,
        },
      };

      addImage() {}

      addPage() {}

      save(fileName: string) {
        savedFiles.push(fileName);
      }

      setProperties() {}
    } as never,
  }));

  __setPdfCanvasFactoryForTests((width, height) => ({
    width,
    height,
    getContext: () => ({
      fillStyle: '#ffffff',
      fillRect: () => {},
      drawImage: () => {},
    }),
    toDataURL: () => 'data:image/png;base64,slice',
  }));

  return () => {
    __setPdfGenerationDepsLoaderForTests(null);
    __setPdfCanvasFactoryForTests(null);
  };
}

const createRobotFixture = (): RobotState => ({
  name: 'inspection-fixture',
  rootLinkId: 'base_link',
  links: {
    base_link: {
      id: 'base_link',
      name: 'base_link',
      visual: {
        type: GeometryType.BOX,
        dimensions: { x: 0.4, y: 0.2, z: 0.1 },
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        color: '#999999',
      },
      collision: {
        type: GeometryType.BOX,
        dimensions: { x: 0.4, y: 0.2, z: 0.1 },
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        color: '#999999',
      },
      inertial: {
        mass: 2.5,
        inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
      },
    },
  },
  joints: {
    hip_joint: {
      id: 'hip_joint',
      name: 'hip_joint',
      type: JointType.REVOLUTE,
      parentLinkId: 'world',
      childLinkId: 'base_link',
      origin: { xyz: { x: 0, y: 0.1, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 1, z: 0 },
      limit: { lower: -1, upper: 1, effort: 20, velocity: 10 },
      dynamics: { damping: 0.1, friction: 0.1 },
      hardware: { armature: 0.03, motorType: 'servo', motorId: 'M1', motorDirection: 1 },
    },
  },
  inspectionContext: undefined,
  selection: { type: 'link', id: 'base_link' },
});

const createHumanoidMeshRobotFixture = (): RobotState => {
  const robot = createRobotFixture();
  robot.name = 'humanoid_biped_mesh_robot';
  robot.inspectionContext = { sourceFormat: 'mesh' };
  robot.links.base_link.name = 'pelvis';
  robot.links.base_link.visual.type = GeometryType.MESH;
  robot.links.base_link.visual.meshPath = 'meshes/pelvis.stl';
  robot.links.left_foot = {
    ...robot.links.base_link,
    id: 'left_foot',
    name: 'left_foot',
  };
  robot.links.right_foot = {
    ...robot.links.base_link,
    id: 'right_foot',
    name: 'right_foot',
  };
  robot.joints.left_hip_pitch = {
    ...robot.joints.hip_joint,
    id: 'left_hip_pitch',
    name: 'left_hip_pitch',
    parentLinkId: 'base_link',
    childLinkId: 'left_foot',
  };
  robot.joints.right_hip_pitch = {
    ...robot.joints.hip_joint,
    id: 'right_hip_pitch',
    name: 'right_hip_pitch',
    parentLinkId: 'base_link',
    childLinkId: 'right_foot',
  };
  return robot;
};

function getNormalPlanSelectedItemCount(robot: RobotState = createRobotFixture()) {
  return Object.values(buildNormalInspectionPlan({ robot }).selectedProfiles).reduce(
    (sum, itemIds) => sum + itemIds.size,
    0,
  );
}

function getSetupModeButton(container: Element, label: string): HTMLButtonElement | null {
  return (
    Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-inspection-setup-mode-switcher] button'),
    ).find((button) => button.textContent?.trim() === label) ?? null
  );
}

async function switchInspectionSetupMode(container: Element, dom: JSDOM, label: string) {
  const modeButton = getSetupModeButton(container, label);
  assert.ok(modeButton, `expected setup mode button "${label}" to render`);

  await act(async () => {
    modeButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
}

test('transparent AI inspection backdrop does not intercept pointer events', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const backdrop = container.querySelector('[aria-hidden="true"].fixed.inset-0');
    assert.ok(backdrop, 'expected transparent backdrop to render');
    assert.equal(
      backdrop.classList.contains('pointer-events-none'),
      true,
      'transparent backdrop should not block interactions with the workspace',
    );
    const dialog = container.querySelector<HTMLElement>(
      `[role="dialog"][aria-label="${translations.zh.aiInspection}"]`,
    );
    assert.ok(dialog, 'expected the inspection window to expose a stable dialog landmark');
    assert.equal(dialog.getAttribute('aria-modal'), 'false');
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('AIInspectionModal can be resized below the viewport', async () => {
  const dom = installDom();
  Object.defineProperty(dom.window, 'innerWidth', { value: 900, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 600, configurable: true });
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const dialog = container.querySelector<HTMLElement>(
      `[role="dialog"][aria-label="${translations.zh.aiInspection}"]`,
    );
    const bottomResizeHandle = dialog?.querySelector<HTMLButtonElement>(
      '.resize-edge-bottom.resize-edge-visual-bottom',
    );
    assert.ok(dialog, 'expected the AI inspection dialog to render');
    assert.ok(bottomResizeHandle, 'expected the bottom resize handle to render');

    await act(async () => {
      bottomResizeHandle.dispatchEvent(
        new dom.window.MouseEvent('mousedown', { bubbles: true, clientY: 568 }),
      );
    });
    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mousemove', { bubbles: true, clientY: 800 }),
      );
    });

    assert.ok(
      Number.parseFloat(dialog.style.height) > dom.window.innerHeight,
      'dragging the bottom edge should allow the inspection window to extend below the viewport',
    );

    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
    });
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('AIInspectionModal moves to the front when activated', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const initialState = useUIStore.getState();

  try {
    useUIStore.setState({
      managedWindowOrder: [...DEFAULT_MANAGED_WINDOW_ORDER],
    });
    assert.ok(
      useUIStore.getState().getManagedWindowZIndex('sourceCode') >
        useUIStore.getState().getManagedWindowZIndex('aiInspection'),
      'source code should sit above AI inspection in the default order before the modal opens',
    );

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="en"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const initialZIndex = String(useUIStore.getState().getManagedWindowZIndex('aiInspection'));
    const windowRoot = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find(
      (element) => element.style.zIndex === initialZIndex,
    );
    assert.ok(windowRoot, 'inspection window should render with dynamic z-index');
    assert.equal(windowRoot.className.includes('z-[100]'), false);
    assert.ok(
      useUIStore.getState().getManagedWindowZIndex('aiInspection') >
        useUIStore.getState().getManagedWindowZIndex('sourceCode'),
      'opened AI inspection window should move above source code',
    );

    await act(async () => {
      windowRoot.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    });

    assert.ok(
      useUIStore.getState().getManagedWindowZIndex('aiInspection') >
        useUIStore.getState().getManagedWindowZIndex('sourceCode'),
      'activated AI inspection window should move above source code',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    useUIStore.setState(initialState);
    dom.window.close();
  }
});

test('inspection report stays available after closing and reopening the modal', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.en;
  const previousApiKey = process.env.API_KEY;

  function ModalHarness() {
    const [isOpen, setIsOpen] = React.useState(true);

    return (
      <>
        <button type="button" onClick={() => setIsOpen(true)}>
          Reopen
        </button>
        <AIInspectionModal
          isOpen={isOpen}
          onClose={() => {
            setIsOpen(false);
          }}
          robot={createRobotFixture()}
          lang="en"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />
      </>
    );
  }

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    delete process.env.API_KEY;

    await act(async () => {
      root.render(<ModalHarness />);
    });

    const runButton = getButtonByText(t.runInspection);
    assert.ok(runButton, 'expected the run inspection button to render');

    await act(async () => {
      runButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    assert.ok(
      getButtonByText(t.discussReportWithAI),
      'expected the inspection report actions to render after running the inspection',
    );

    const closeButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${t.close}"]`,
    );
    assert.ok(closeButton, 'expected the window close button to render');

    await act(async () => {
      closeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      getButtonByText(t.discussReportWithAI),
      null,
      'expected the report action to be hidden while the modal is closed',
    );

    const reopenButton = getButtonByText('Reopen');
    assert.ok(reopenButton, 'expected the reopen control to render');

    await act(async () => {
      reopenButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.ok(
      getButtonByText(t.discussReportWithAI),
      'expected the prior inspection report to remain available after reopening the modal',
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection report footer uses regenerate confirmation instead of a back button', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const previousApiKey = process.env.API_KEY;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    delete process.env.API_KEY;

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const runButton = getButtonByText(t.runInspection);
    assert.ok(runButton, 'expected the run inspection button to render');

    await act(async () => {
      runButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    assert.equal(
      getButtonByText(t.back),
      null,
      'expected the report footer to stop rendering the back button',
    );

    const regenerateButton = getButtonByText(t.retryLastResponse);
    assert.ok(regenerateButton, 'expected the regenerate button to render in the report footer');

    await act(async () => {
      regenerateButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const confirmDialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(confirmDialog, 'expected regenerate confirmation dialog to open');
    assert.equal(
      confirmDialog.className.includes('z-[260]'),
      true,
      'expected regenerate confirmation dialog to render above managed windows',
    );
    assert.equal(
      confirmDialog.textContent?.includes(t.inspectionRegenerateConfirmTitle),
      true,
      'expected regenerate confirmation title to render',
    );
    assert.equal(
      confirmDialog.textContent?.includes(t.inspectionRegenerateConfirmMessage),
      true,
      'expected regenerate confirmation message to render',
    );

    const dialogButtons = Array.from(confirmDialog.querySelectorAll('button'));
    assert.equal(
      dialogButtons.some((button) => button.textContent?.trim() === t.back),
      true,
      'expected confirmation dialog to render the back action',
    );
    assert.equal(
      dialogButtons.some((button) => button.textContent?.trim() === t.saveReport),
      true,
      'expected confirmation dialog to render the save report action',
    );
    assert.equal(
      dialogButtons.some((button) => button.textContent?.trim() === t.retryLastResponse),
      true,
      'expected confirmation dialog to render the regenerate action',
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('saving the report from regenerate confirmation returns to the inspection result view', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const savedFiles: string[] = [];
  const restorePdfMocks = installPdfExportMocks(savedFiles);
  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const previousApiKey = process.env.API_KEY;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    delete process.env.API_KEY;

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const runButton = getButtonByText(t.runInspection);
    assert.ok(runButton, 'expected the run inspection button to render');

    await act(async () => {
      runButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    const regenerateButton = getButtonByText(t.retryLastResponse);
    assert.ok(regenerateButton, 'expected the regenerate button to render in the report footer');

    await act(async () => {
      regenerateButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const confirmDialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(confirmDialog, 'expected regenerate confirmation dialog to open');

    const saveReportButton = Array.from(confirmDialog.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === t.saveReport,
    );
    assert.ok(saveReportButton, 'expected confirmation dialog to render the save report action');

    await act(async () => {
      saveReportButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 80);
      });
    });

    assert.equal(savedFiles.length, 1, 'expected save report to export one PDF file');
    assert.equal(
      dom.window.document.querySelector('[role="dialog"][aria-modal="true"]'),
      null,
      'expected the confirmation dialog to close after saving the report',
    );
    assert.ok(
      getButtonByText(t.discussReportWithAI),
      'expected the inspection result view to remain visible after saving the report',
    );
    assert.ok(
      getButtonByText(t.retryLastResponse),
      'expected the report footer to remain on the inspection result view after saving',
    );
  } finally {
    restorePdfMocks();
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('confirming regenerate returns to setup and preserves the prior mode and selected checks', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const previousApiKey = process.env.API_KEY;
  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    delete process.env.API_KEY;

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const runButton = getButtonByText(t.runInspection);
    assert.ok(runButton, 'expected the run inspection button to render');

    await act(async () => {
      runButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    const regenerateButton = getButtonByText(t.retryLastResponse);
    assert.ok(regenerateButton, 'expected the regenerate button to render in the report footer');

    await act(async () => {
      regenerateButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const confirmDialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(confirmDialog, 'expected regenerate confirmation dialog to open');

    const confirmRegenerateButton = Array.from(confirmDialog.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === t.retryLastResponse,
    );
    assert.ok(
      confirmRegenerateButton,
      'expected confirmation dialog to render the regenerate action',
    );

    await act(async () => {
      confirmRegenerateButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    assert.equal(
      dom.window.document.querySelector('[role="dialog"][aria-modal="true"]'),
      null,
      'expected the confirmation dialog to close after confirming regenerate',
    );
    assert.equal(
      getButtonByText(t.discussReportWithAI),
      null,
      'expected the report view to close after confirming regenerate',
    );
    assert.equal(
      container.textContent?.includes(t.inspectionRecommendedPlan),
      true,
      'expected confirming regenerate to return to the setup view',
    );
    assert.equal(
      container.textContent?.includes(t.inspectionRunSummary),
      false,
      'expected the previously selected normal mode to remain active after returning to setup',
    );

    const summaryChip = container.querySelector<HTMLElement>(
      '[data-inspection-normal-footer-summary]',
    );
    assert.ok(summaryChip, 'expected the setup summary to render after confirming regenerate');
    assert.ok(
      summaryChip.querySelector('[data-inspection-normal-footer-primary-count]'),
      'expected the normal inspection plan selection count to be restored',
    );
    assert.ok(
      getButtonByText(t.runInspection),
      'expected the setup run button to render again after confirming regenerate',
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup keeps selected checks in sync with updated recommended profiles', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const genericRobot = createRobotFixture();
  const humanoidMeshRobot = createHumanoidMeshRobotFixture();
  const t = translations.zh;
  const totalItemCount = INSPECTION_PROFILE_DEFINITIONS.reduce(
    (sum, profile) => sum + profile.items.length,
    0,
  );
  const expectedUpdatedSelectedCount = getNormalPlanSelectedItemCount(humanoidMeshRobot);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={genericRobot}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={humanoidMeshRobot}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.equal(
      container.textContent?.includes(t.inspectionRobotTypeHumanoid),
      true,
      'expected the recommendation card to reflect the updated humanoid robot type',
    );

    const summaryChip = container.querySelector<HTMLElement>(
      '[data-inspection-normal-footer-summary]',
    );
    assert.ok(summaryChip, 'expected the normal setup summary chip to render');
    assert.equal(
      summaryChip.querySelector('[data-inspection-normal-footer-primary-count]')?.textContent,
      String(expectedUpdatedSelectedCount),
      'expected selected checks to match the updated recommendation profile set',
    );
    assert.equal(
      summaryChip.querySelector('[data-inspection-normal-footer-total-count]')?.textContent,
      String(totalItemCount),
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection report follow-up uses the robot snapshot from the completed run', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.en;
  const previousApiKey = process.env.API_KEY;
  const initialRobot = createRobotFixture();
  const updatedRobot = {
    ...createRobotFixture(),
    name: 'changed-after-inspection',
    selection: { type: 'joint' as const, id: 'hip_joint' },
  };
  let conversationRobotName: string | null = null;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    delete process.env.API_KEY;

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={initialRobot}
          lang="en"
          onSelectItem={() => {}}
          onOpenConversationWithReport={(_, robotSnapshot) => {
            conversationRobotName = robotSnapshot.name;
          }}
        />,
      );
    });

    const runButton = getButtonByText(t.runInspection);
    assert.ok(runButton, 'expected the run inspection button to render');

    await act(async () => {
      runButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    assert.ok(
      getButtonByText(t.discussReportWithAI),
      'expected the inspection report actions to render after running the inspection',
    );

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={updatedRobot}
          lang="en"
          onSelectItem={() => {}}
          onOpenConversationWithReport={(_, robotSnapshot) => {
            conversationRobotName = robotSnapshot.name;
          }}
        />,
      );
    });

    const discussButton = getButtonByText(t.discussReportWithAI);
    assert.ok(discussButton, 'expected the report discussion action to remain available');

    await act(async () => {
      discussButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      conversationRobotName,
      initialRobot.name,
      'expected report follow-up to use the robot snapshot captured for that report',
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('running inspection can be stopped and returns to setup without producing a report', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const previousApiKey = process.env.API_KEY;
  let requestWasAborted = false;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    process.env.API_KEY = 'test-key';
    __setInspectionOpenAIClientFactoryForTests(
      () =>
        ({
          chat: {
            completions: {
              create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
                const signal = options?.signal;
                if (signal?.aborted) {
                  requestWasAborted = true;
                  throw new dom.window.DOMException('Aborted', 'AbortError');
                }

                return new Promise((_resolve, reject) => {
                  signal?.addEventListener('abort', () => {
                    requestWasAborted = true;
                    reject(new dom.window.DOMException('Aborted', 'AbortError'));
                  });
                });
              },
            },
          },
        }) as never,
    );

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="en"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const runButton = getButtonByText(translations.en.runInspection);
    assert.ok(runButton, 'expected the run inspection button to render');

    await act(async () => {
      runButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    const stopButton = getButtonByText('Stop Review');
    assert.ok(stopButton, 'expected a dedicated stop review action while inspection is running');
    assert.equal(
      container.querySelector('[data-inspection-sidebar]'),
      null,
      'expected the full inspection checklist sidebar to be hidden while a run is in progress',
    );
    assert.equal(
      container.querySelector('[data-inspection-running-rail="true"]'),
      null,
      'expected the running view not to use a separate progress rail',
    );
    assert.ok(
      container.querySelector('[data-inspection-running-console="true"]'),
      'expected the running view to place live status in the main console panel',
    );
    assert.ok(
      container.querySelector('[data-inspection-progress-footer="true"]'),
      'expected running controls to remain anchored in the modal footer',
    );

    await act(async () => {
      stopButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    assert.equal(requestWasAborted, true, 'expected the in-flight inspection request to abort');
    assert.equal(
      getButtonByText(translations.en.runInspection) !== null,
      true,
      'expected cancellation to return to the setup footer',
    );
    assert.equal(
      container.textContent?.includes(translations.en.inspectionResultTitle),
      false,
      'expected cancellation not to create an inspection report',
    );
    assert.equal(
      container.textContent?.includes('Review stopped. No report was generated.'),
      true,
      'expected setup to explain that the run was cancelled without a report',
    );
    const cancellationNotice = container.querySelector('[data-inspection-cancelled-notice]');
    assert.ok(cancellationNotice, 'expected cancellation notice to render as a dismissible banner');
    const dismissCancellationNoticeButton = container.querySelector<HTMLButtonElement>(
      '[data-inspection-cancelled-notice-dismiss]',
    );
    assert.ok(
      dismissCancellationNoticeButton,
      'expected cancellation notice to expose a close action',
    );

    await act(async () => {
      dismissCancellationNoticeButton!.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
    });

    assert.equal(
      container.textContent?.includes('Review stopped. No report was generated.'),
      false,
      'expected dismissing the cancellation notice to remove it from setup',
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    __setInspectionOpenAIClientFactoryForTests(null);
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('professional setup preserves manual selected checks across selection-only robot updates', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const robot = createRobotFixture();
  const plan = buildNormalInspectionPlan({ robot });
  const profileId = plan.includedProfileIds[0];
  assert.ok(profileId, 'expected the fixture to include at least one profile');
  const itemId = Array.from(plan.selectedProfiles[profileId] ?? [])[0];
  assert.ok(itemId, 'expected the selected profile to include at least one item');
  const initialSelectedItemCount = getNormalPlanSelectedItemCount(robot);
  const updatedRobot = {
    ...createRobotFixture(),
    selection: { type: 'joint' as const, id: 'hip_joint' },
  };

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={robot}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    await switchInspectionSetupMode(container, dom, t.inspectionAdvancedMode);

    const profileToggle = container.querySelector<HTMLButtonElement>(
      `[data-inspection-current-plan-profile-toggle="${profileId}"]`,
    );
    assert.ok(profileToggle, 'expected the current-plan profile dropdown to render');
    await act(async () => {
      profileToggle!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const getBadge = () =>
      container.querySelector<HTMLButtonElement>(
        `[data-inspection-setup-item-badge="${profileId}:${itemId}"]`,
      );
    const badge = getBadge();
    assert.ok(badge, 'expected the focused item badge button to render');

    await act(async () => {
      badge!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(badge!.textContent?.includes(t.inspectionSkipped), true);

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={updatedRobot}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.equal(
      getBadge()?.textContent?.includes(t.inspectionSkipped),
      true,
      'expected a selection-only robot update to preserve the manually skipped item',
    );
    assert.equal(
      container.textContent?.includes(
        t.inspectionSelectedChecks.replace('{count}', String(initialSelectedItemCount - 1)),
      ),
      true,
      'expected the professional-mode summary to keep the manually edited count',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup starts in normal mode and keeps selection in sync with professional mode', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const recognitionPanel = container.querySelector<HTMLElement>(
      '[data-inspection-recognition-panel="true"]',
    );
    assert.ok(recognitionPanel, 'expected normal mode to render the editable recognition panel');
    const recognitionGrid = recognitionPanel.querySelector<HTMLElement>(
      '[data-inspection-recognition-grid="true"]',
    );
    assert.ok(recognitionGrid, 'expected normal mode to show the recognition grid');
    assert.equal(
      recognitionGrid.style.gridTemplateColumns,
      'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
      'expected recognition controls to form two columns when space allows and one otherwise',
    );
    const sourceFormatSelect = recognitionPanel.querySelector<HTMLSelectElement>(
      '[data-inspection-recognition-select="sourceFormat"]',
    );
    const robotTypeSelect = recognitionPanel.querySelector<HTMLSelectElement>(
      '[data-inspection-recognition-select="robotType"]',
    );
    assert.ok(sourceFormatSelect, 'expected normal mode to allow editing source format');
    assert.ok(robotTypeSelect, 'expected normal mode to allow editing robot type');

    await act(async () => {
      sourceFormatSelect!.value = 'mjcf';
      sourceFormatSelect!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      robotTypeSelect!.value = 'quadruped';
      robotTypeSelect!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    const advancedModeButton = getButtonByText(t.inspectionAdvancedMode);
    assert.ok(advancedModeButton, 'expected the advanced mode toggle to render');

    await act(async () => {
      advancedModeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const reviewDetails = container.querySelector('[data-inspection-review-details="true"]');
    assert.ok(reviewDetails, 'expected professional mode to render a review details container');
    assert.equal(
      reviewDetails.querySelector('[data-inspection-recognition-panel="true"]'),
      null,
      'expected professional mode to omit the recognition panel moved to normal mode',
    );
    assert.ok(
      reviewDetails.querySelector('[data-inspection-current-plan="true"]'),
      'expected professional mode to show the editable current plan',
    );
    const currentPlanViewport = reviewDetails.querySelector<HTMLElement>(
      '[data-inspection-current-plan-viewport="true"]',
    );
    const currentPlan = reviewDetails.querySelector<HTMLElement>(
      '[data-inspection-current-plan="true"]',
    );
    const currentPlanScroll = reviewDetails.querySelector<HTMLElement>(
      '[data-inspection-current-plan-scroll="true"]',
    );
    assert.ok(currentPlanViewport, 'expected the current plan viewport to render');
    assert.ok(currentPlan, 'expected the current plan panel to render');
    assert.ok(currentPlanScroll, 'expected the current plan list container to render');
    assert.equal(currentPlanViewport.className.includes('overflow-hidden'), false);
    assert.equal(currentPlan.className.includes('flex-1'), false);
    assert.equal(currentPlanScroll.className.includes('xl:overflow-y-auto'), false);
    assert.equal(
      reviewDetails.querySelector('[data-inspection-recommendation-baseline="true"]'),
      null,
      'expected professional mode not to keep a full recommendation baseline column',
    );
    assert.equal(
      reviewDetails.querySelector('[data-inspection-focused-profile-panel="true"]'),
      null,
      'expected professional mode to remove the separate focused profile panel',
    );
    assert.ok(
      reviewDetails.querySelector('[data-inspection-current-plan-layer="base"]'),
      'expected current plan to group profiles by the base layer',
    );
    assert.equal(
      reviewDetails
        .querySelector('[data-inspection-current-plan-layer-header="base"]')
        ?.textContent?.trim(),
      '基础通用层',
      'expected current plan layer headings not to repeat the profile count',
    );
    assert.ok(
      container.querySelector('[data-inspection-current-plan-profile="format.mjcf"]'),
      'expected the source-format choice from normal mode to reach the professional plan',
    );
    const profileToggle = reviewDetails.querySelector<HTMLButtonElement>(
      '[data-inspection-current-plan-profile-toggle]',
    );
    assert.ok(profileToggle, 'expected current plan profiles to expose dropdown controls');
    await act(async () => {
      profileToggle!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.ok(
      reviewDetails.querySelector('[data-inspection-current-plan-profile-details]'),
      'expected profile checks to expand directly inside the current plan',
    );
    const profileToggles = reviewDetails.querySelectorAll<HTMLButtonElement>(
      '[data-inspection-current-plan-profile-toggle]',
    );
    assert.ok(profileToggles.length >= 2, 'expected at least two current-plan profiles');
    await act(async () => {
      profileToggles[1]!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(
      reviewDetails.querySelectorAll('[data-inspection-current-plan-profile-details]').length,
      2,
      'expected opening another profile to preserve the first expanded profile',
    );
    assert.equal(
      profileToggle!.getAttribute('aria-expanded'),
      'true',
      'expected the first profile to remain expanded',
    );
    assert.ok(
      container.querySelector('[data-inspection-current-plan-profile="morph.quadruped"]'),
      'expected the robot-type choice from normal mode to reach the professional plan',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('professional setup sidebar is collapsed by default during selection', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const robot = createRobotFixture();
  const recommendedProfileIds = buildNormalInspectionPlan({ robot }).includedProfileIds;
  const firstRecommendedProfile = INSPECTION_PROFILE_DEFINITIONS.find(
    (profile) => profile.id === recommendedProfileIds[0],
  );
  assert.ok(firstRecommendedProfile, 'expected the fixture to recommend at least one profile');

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={robot}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    await switchInspectionSetupMode(container, dom, translations.zh.inspectionAdvancedMode);

    assert.equal(
      container.querySelector('[data-inspection-setup-sidebar-collapsed]'),
      null,
      'expected professional mode selection to hide the duplicated sidebar rail',
    );
    assert.equal(
      container.querySelector('[data-inspection-sidebar]'),
      null,
      'expected professional mode selection to avoid rendering the full sidebar by default',
    );
    assert.equal(
      container
        .querySelector('[data-inspection-current-plan="true"]')
        ?.textContent?.includes(firstRecommendedProfile.nameZh),
      true,
      'expected the current plan workspace to carry professional profile navigation',
    );
    assert.ok(
      container.querySelector('[data-inspection-current-plan-layer]'),
      'expected the current plan workspace to group profiles by layer',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('professional setup edits the current plan through a draft plan editor', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const addedProfile = INSPECTION_PROFILE_DEFINITIONS.find(
    (profile) => profile.id === 'morph.humanoid',
  );
  const addedItem = addedProfile?.items[0];
  assert.ok(addedProfile, 'expected humanoid profile fixture to exist');
  assert.ok(addedItem, 'expected humanoid profile to include at least one item');

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    await switchInspectionSetupMode(container, dom, translations.zh.inspectionAdvancedMode);

    assert.equal(
      container.querySelector('[data-inspection-current-plan-profile="morph.humanoid"]'),
      null,
      'expected the default current plan not to include the humanoid profile',
    );

    const editButton = container.querySelector<HTMLButtonElement>(
      '[data-inspection-current-plan-edit]',
    );
    assert.ok(editButton, 'expected current plan to expose an edit action');

    await act(async () => {
      editButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const editor = dom.window.document.querySelector<HTMLElement>(
      '[data-inspection-plan-editor="true"]',
    );
    assert.ok(editor, 'expected current plan editor dialog to open');
    const editorDialog = editor.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
    assert.ok(editorDialog, 'expected current plan editor to render in a modal dialog');
    assert.equal(
      editorDialog.className.includes('z-[260]'),
      true,
      'expected current plan editor to render above managed AI windows',
    );
    assert.ok(
      editor!.querySelector('[data-inspection-plan-editor-layer="base"]'),
      'expected plan editor to show the base layer',
    );
    assert.ok(
      editor!.querySelector('[data-inspection-plan-editor-layer="morph"]'),
      'expected plan editor to show the morphology layer',
    );
    assert.ok(
      editor!.querySelector('[data-inspection-plan-editor-profile="morph.humanoid"]'),
      'expected plan editor to list profiles not currently included',
    );
    const unselectedEditorItem = editor!.querySelector<HTMLElement>(
      '[data-inspection-plan-editor-item="morph.humanoid:humanoid_body_hierarchy"]',
    );
    assert.ok(unselectedEditorItem, 'expected plan editor to list checks under each profile');
    const editorItems = Array.from(
      editor!.querySelectorAll<HTMLElement>('[data-inspection-plan-editor-item]'),
    );
    assert.equal(
      editorItems.some((item) => item.textContent?.includes(translations.zh.inspectionSkipped)),
      true,
      'expected unselected plan editor items to use the not-included status',
    );
    assert.equal(
      editorItems.some((item) =>
        item.textContent?.includes(translations.zh.inspectionNotRecommended),
      ),
      false,
      'expected the plan editor not to describe unselected items as recommendation metadata',
    );

    const humanoidToggle = editor!.querySelector<HTMLButtonElement>(
      '[data-inspection-plan-editor-profile-toggle="morph.humanoid"]',
    );
    assert.ok(humanoidToggle, 'expected plan editor to support profile-level toggles');

    await act(async () => {
      humanoidToggle!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const cancelButton = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-inspection-plan-editor-cancel]',
    );
    assert.ok(cancelButton, 'expected plan editor to expose a cancel action');

    await act(async () => {
      cancelButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      container.querySelector('[data-inspection-current-plan-profile="morph.humanoid"]'),
      null,
      'expected cancelling the plan editor not to mutate the current plan',
    );

    await act(async () => {
      editButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const reopenedEditor = dom.window.document.querySelector<HTMLElement>(
      '[data-inspection-plan-editor="true"]',
    );
    assert.ok(reopenedEditor, 'expected current plan editor dialog to reopen');
    const reopenedHumanoidToggle = reopenedEditor!.querySelector<HTMLButtonElement>(
      '[data-inspection-plan-editor-profile-toggle="morph.humanoid"]',
    );
    assert.ok(reopenedHumanoidToggle, 'expected profile toggle to render after reopening');

    await act(async () => {
      reopenedHumanoidToggle!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const confirmButton = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-inspection-plan-editor-confirm]',
    );
    assert.ok(confirmButton, 'expected plan editor to expose a confirm action');

    await act(async () => {
      confirmButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.ok(
      container.querySelector('[data-inspection-current-plan-profile="morph.humanoid"]'),
      'expected confirming the plan editor to add the selected profile to the current plan',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('professional mode status badge toggles the inspection item selection', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const initialSelectedItemCount = getNormalPlanSelectedItemCount();
  const firstProfile = INSPECTION_PROFILE_DEFINITIONS[0];
  const firstItem = firstProfile?.items[0];
  assert.ok(firstProfile, 'expected inspection profiles to include at least one profile');
  assert.ok(firstItem, 'expected the first profile to include at least one item');

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const professionalModeButton = getButtonByText(t.inspectionAdvancedMode);
    assert.ok(professionalModeButton, 'expected the professional mode toggle to render');

    await act(async () => {
      professionalModeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const profileToggle = container.querySelector<HTMLButtonElement>(
      `[data-inspection-current-plan-profile-toggle="${firstProfile!.id}"]`,
    );
    assert.ok(profileToggle, 'expected the current-plan profile dropdown to render');
    await act(async () => {
      profileToggle!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const badge = container.querySelector<HTMLButtonElement>(
      `[data-inspection-setup-item-badge="${firstProfile!.id}:${firstItem!.id}"]`,
    );
    assert.ok(badge, 'expected the focused item badge button to render');
    assert.equal(badge.textContent?.includes(t.inspectionIncluded), true);
    assert.equal(badge.getAttribute('aria-pressed'), 'true');
    const expandedProfileDetails = container.querySelector<HTMLElement>(
      `[data-inspection-current-plan-profile-details="${firstProfile!.id}"]`,
    );
    assert.ok(expandedProfileDetails, 'expected the profile checks to expand in the current plan');
    assert.equal(
      expandedProfileDetails!.textContent?.includes(firstItem!.id),
      false,
      'expected expanded checks not to expose internal English item identifiers',
    );
    const severityLabel =
      firstItem!.severityOnFailure === 'error'
        ? '错误'
        : firstItem!.severityOnFailure === 'warning'
          ? '警告'
          : '建议';
    assert.equal(
      expandedProfileDetails!.textContent?.includes(severityLabel),
      false,
      'expected focused profile checks not to display severity labels',
    );
    assert.equal(
      expandedProfileDetails!.textContent?.includes(firstItem!.evidenceLevelRequired ?? 'L1'),
      false,
      'expected focused profile checks not to display evidence levels',
    );

    await act(async () => {
      badge!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(badge!.textContent?.includes(t.inspectionSkipped), true);
    assert.equal(badge!.getAttribute('aria-pressed'), 'false');

    const summaryText = t.inspectionSelectedChecks.replace(
      '{count}',
      String(initialSelectedItemCount - 1),
    );
    assert.equal(
      container.textContent?.includes(summaryText),
      true,
      'expected the professional-mode summary to reflect the deselected item',
    );
    assert.equal(
      expandedProfileDetails!.textContent?.includes('用户排除推荐'),
      false,
      'expected the item checkbox to be the only selection-status indicator',
    );
    assert.ok(
      container.querySelector('[data-inspection-current-plan-custom-state="true"]'),
      'expected the current plan to make the custom profile selection state explicit',
    );
    const currentPlanProfile = container.querySelector(
      `[data-inspection-current-plan-profile="${firstProfile!.id}"]`,
    );
    assert.match(
      currentPlanProfile?.textContent ?? '',
      new RegExp(`${firstProfile!.items.length - 1}/${firstProfile!.items.length}`),
      'expected only the current plan to reflect the deselected item',
    );
    assert.equal(
      container.querySelector('[data-inspection-recommendation-empty-reason]'),
      null,
      'expected professional mode not to repeat the recommendation description as a fallback reason card',
    );

    const restoreProfileButton = getButtonByText('恢复本 Profile 推荐');
    assert.ok(restoreProfileButton, 'expected profile-level recommendation restore action');

    await act(async () => {
      restoreProfileButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(badge!.textContent?.includes(t.inspectionIncluded), true);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode shows the footer selection summary without bulk actions', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const totalItemCount = INSPECTION_PROFILE_DEFINITIONS.reduce(
    (sum, profile) => sum + profile.items.length,
    0,
  );
  const initialSelectedItemCount = getNormalPlanSelectedItemCount();

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const summaryChip = container.querySelector<HTMLElement>(
      '[data-inspection-normal-footer-summary]',
    );
    assert.ok(summaryChip, 'expected the normal mode footer to render a selection summary');
    assert.equal(
      summaryChip.querySelector('[data-inspection-normal-footer-primary-count]')?.textContent,
      String(initialSelectedItemCount),
      'expected the summary to reflect the recommended default profile selection',
    );
    assert.equal(
      summaryChip.querySelector('[data-inspection-normal-footer-total-count]')?.textContent,
      String(totalItemCount),
    );

    assert.equal(
      container.querySelector('[data-inspection-normal-action]'),
      null,
      'expected normal mode to avoid manual bulk actions',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode adjustment keeps the generated plan runnable', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const getRunButton = () =>
      container.querySelector<HTMLButtonElement>('[data-inspection-run-button]');
    assert.ok(getRunButton(), 'expected the normal mode run button to render');
    assert.equal(getRunButton()?.disabled, false, 'expected run inspection to start enabled');

    const targetPlatformSelect = container.querySelector<HTMLSelectElement>(
      '[data-inspection-recognition-select="targetPlatform"]',
    );
    assert.ok(targetPlatformSelect, 'expected the normal mode target selector to render');
    assert.equal(
      targetPlatformSelect.value,
      '',
      'expected target selection to start in automatic mode',
    );

    await act(async () => {
      targetPlatformSelect!.value = 'gazebo';
      targetPlatformSelect!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    assert.equal(targetPlatformSelect.value, 'gazebo');
    assert.equal(
      getRunButton()?.disabled,
      false,
      'expected target correction to keep running the inspection enabled',
    );

    await act(async () => {
      targetPlatformSelect!.value = '';
      targetPlatformSelect!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    assert.equal(
      targetPlatformSelect.value,
      '',
      'expected users to be able to restore automatic target selection',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode renders only the recognition panel without direct check editing', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const recommendationCard = container.querySelector<HTMLElement>(
      '[data-inspection-recognition-panel="true"]',
    );
    assert.ok(recommendationCard, 'expected normal mode to render the recognition panel');
    assert.equal(recommendationCard.className.includes('overflow-hidden'), true);
    assert.equal(recommendationCard.className.includes('rounded-2xl'), true);
    assert.ok(
      recommendationCard.querySelector('svg.lucide-sparkles'),
      'expected the recommendation card to render the recommendation icon',
    );
    assert.ok(
      container.querySelector('[data-inspection-recognition-grid="true"]'),
      'expected normal mode to expose the editable recognition grid',
    );
    assert.equal(
      container.querySelector('[data-inspection-normal-check-editor="true"]'),
      null,
      'normal mode no longer renders the direct check editor (move selection to professional mode)',
    );
    assert.equal(
      container.querySelector('[data-inspection-normal-item]'),
      null,
      'normal mode no longer exposes per-item toggles',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection selection is edited in professional mode and persists across mode switches', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const robot = createRobotFixture();
  const plan = buildNormalInspectionPlan({ robot });
  const profile = INSPECTION_PROFILE_DEFINITIONS.find(
    (candidate) => (plan.selectedProfiles[candidate.id]?.size ?? 0) > 1,
  );
  assert.ok(profile, 'expected a recommended category with multiple checks');
  const itemId = Array.from(plan.selectedProfiles[profile.id] ?? [])[0];
  assert.ok(itemId, 'expected a recommended check in the selected category');
  const t = translations.zh;

  const getProfessionalItemBadge = () =>
    container.querySelector<HTMLButtonElement>(
      `[data-inspection-setup-item-badge="${profile.id}:${itemId}"]`,
    );

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={robot}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    // Normal mode no longer exposes direct per-item toggles; selection editing lives in professional mode only.
    assert.equal(
      container.querySelector('[data-inspection-normal-item]'),
      null,
      'normal mode must not expose per-item toggles anymore',
    );

    await switchInspectionSetupMode(container, dom, t.inspectionAdvancedMode);

    // Professional mode collapses profile details by default; expand the target profile to reach its item toggles.
    const professionalProfileToggle = container.querySelector<HTMLButtonElement>(
      `[data-inspection-current-plan-profile-toggle="${profile.id}"]`,
    );
    assert.ok(professionalProfileToggle, 'expected the target category to render in professional mode');
    await act(async () => {
      professionalProfileToggle.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
    });
    assert.equal(
      professionalProfileToggle.getAttribute('aria-expanded'),
      'true',
      'clicking the professional profile toggle should expand its details',
    );

    await act(async () => {
      getProfessionalItemBadge()?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
    });
    assert.equal(
      getProfessionalItemBadge()?.getAttribute('aria-pressed'),
      'false',
      'professional mode should toggle the recommended item off',
    );

    // Switching back to normal mode must not silently restore the recommendation.
    await switchInspectionSetupMode(container, dom, t.inspectionNormalMode);
    assert.equal(
      container.querySelector('[data-inspection-normal-item]'),
      null,
      'normal mode still hides per-item toggles after a professional edit',
    );

    await switchInspectionSetupMode(container, dom, t.inspectionAdvancedMode);
    // The professional view collapses profile details on remount; expand the target profile again to reach its restore action.
    const professionalProfileToggleAgain = container.querySelector<HTMLButtonElement>(
      `[data-inspection-current-plan-profile-toggle="${profile.id}"]`,
    );
    assert.ok(
      professionalProfileToggleAgain,
      'expected the target category to remain visible in professional mode after the edit',
    );
    if (professionalProfileToggleAgain.getAttribute('aria-expanded') !== 'true') {
      await act(async () => {
        professionalProfileToggleAgain.dispatchEvent(
          new dom.window.MouseEvent('click', { bubbles: true }),
        );
      });
    }
    const restoreProfileButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent === t.inspectionRestoreProfileRecommendation);
    assert.ok(restoreProfileButton, 'expected professional mode to expose the per-profile restore');
    await act(async () => {
      restoreProfileButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(
      container
        .querySelector<HTMLButtonElement>(
          `[data-inspection-setup-item-badge="${profile.id}:${itemId}"]`,
        )
        ?.getAttribute('aria-pressed'),
      'true',
      'expected the per-profile restore to recover the removed item',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode replaces the old adjustment action with direct selectors', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.equal(
      container.querySelector('[data-inspection-profile-adjust-scope]'),
      null,
      'expected the old adjustment action to be removed',
    );
    assert.equal(
      container.querySelectorAll('[data-inspection-recognition-select]').length,
      4,
      'expected all recommendation inputs to be directly editable',
    );
    assert.equal(
      container.querySelector('[data-inspection-normal-action]'),
      null,
      'expected the old bulk-selection actions to stay out of normal mode',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode footer uses a compact aligned count treatment', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const footerSummary = container.querySelector<HTMLElement>(
      '[data-inspection-normal-footer-summary]',
    );
    assert.ok(footerSummary, 'expected the normal mode footer to render a dedicated count summary');
    assert.equal(
      footerSummary.className.includes('inline-flex items-center'),
      true,
      'expected the footer summary to use an aligned inline-flex layout',
    );

    const primaryCount = container.querySelector<HTMLElement>(
      '[data-inspection-normal-footer-primary-count]',
    );
    const totalCount = container.querySelector<HTMLElement>(
      '[data-inspection-normal-footer-total-count]',
    );
    assert.ok(primaryCount, 'expected the footer summary to render the selected-count token');
    assert.ok(totalCount, 'expected the footer summary to render the total-count token');
    assert.equal(
      primaryCount.className.includes('text-2xl'),
      true,
      'expected the selected count to use the rebalanced primary size',
    );
    assert.equal(
      totalCount.className.includes('text-sm'),
      true,
      'expected the total count to use the smaller supporting size',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup mode switcher uses the professional mode label', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.ok(
      getButtonByText(t.inspectionAdvancedMode),
      'expected the setup mode switcher to render the renamed professional mode label',
    );
    assert.equal(
      getButtonByText('高级模式'),
      null,
      'expected the old advanced mode label to stop rendering in the setup switcher',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup opens without an animated operation hint', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const getRunButton = () =>
      container.querySelector<HTMLButtonElement>('[data-inspection-run-button]');
    assert.ok(getRunButton(), 'expected the setup footer to expose the run inspection button hook');
    assert.equal(
      getRunButton()?.className.includes('inspection-run-cta-pulse'),
      false,
      'expected the run inspection button not to pulse when the modal opens',
    );
    assert.equal(
      getRunButton()?.className.includes('inspection-run-cta-breathe-sync'),
      false,
      'expected the run inspection button not to play a breathing hint when the modal opens',
    );
    assert.equal(
      container.querySelector('[data-inspection-run-pointer-overlay]'),
      null,
      'expected the modal not to render an operation pointer overlay',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup does not restore or persist the selected mode across remounts', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const setupModeStorageKey = 'urdf-studio.ai-inspection.setup-mode';
  dom.window.localStorage.setItem(setupModeStorageKey, 'advanced');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.ok(
      container.querySelector('[data-inspection-normal-footer-summary]'),
      'expected stale saved professional mode to be ignored on first open',
    );
    assert.ok(
      container.querySelector('[data-inspection-recognition-panel="true"]'),
      'expected first open to use the normal-mode recognition panel even when old storage says advanced',
    );

    dom.window.localStorage.setItem(setupModeStorageKey, 'legacy-stale');

    const advancedModeButton = getButtonByText(t.inspectionAdvancedMode);
    assert.ok(advancedModeButton, 'expected the advanced mode toggle to render');

    await act(async () => {
      advancedModeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      container.querySelector('[data-inspection-recognition-panel="true"]'),
      null,
      'expected the current session to switch to professional mode without the moved panel',
    );
    assert.equal(
      dom.window.localStorage.getItem(setupModeStorageKey),
      'legacy-stale',
      'expected mode changes not to write the retired setup-mode storage key',
    );

    await act(async () => {
      root.unmount();
    });

    const reopenedRoot = createRoot(container);

    try {
      await act(async () => {
        reopenedRoot.render(
          <AIInspectionModal
            isOpen
            onClose={() => {}}
            robot={createRobotFixture()}
            lang="zh"
            onSelectItem={() => {}}
            onOpenConversationWithReport={() => {}}
          />,
        );
      });

      assert.ok(
        container.querySelector('[data-inspection-normal-footer-summary]'),
        'expected remounting the setup to return to normal mode',
      );
      assert.ok(
        container.querySelector('[data-inspection-recognition-panel="true"]'),
        'expected remounting to restore the normal-mode recognition panel',
      );
      assert.equal(
        dom.window.localStorage.getItem(setupModeStorageKey),
        'legacy-stale',
        'expected remounting not to write the retired setup-mode storage key',
      );
    } finally {
      await act(async () => {
        reopenedRoot.unmount();
      });
    }
  } finally {
    dom.window.close();
  }
});

test('inspection setup defaults to normal mode when no saved mode exists', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.removeItem('urdf-studio.ai-inspection.setup-mode');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.equal(
      container.textContent?.includes(t.inspectionRecommendedPlan),
      true,
      'expected first-time setup to enter normal mode',
    );
    assert.ok(
      container.querySelector('[data-inspection-normal-footer-summary]'),
      'expected the normal-mode summary to render on first open',
    );
    assert.equal(
      container.textContent?.includes(t.inspectionRunSummary),
      false,
      'expected first-time setup to skip the advanced-mode layout',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup keeps the mode switcher visually centered in the header', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const modeSwitcher = container.querySelector<HTMLElement>(
      '[data-inspection-setup-mode-switcher]',
    );
    assert.ok(
      modeSwitcher,
      'expected the setup header to render a dedicated mode switcher wrapper',
    );
    assert.equal(
      modeSwitcher.className.includes('absolute left-1/2 top-1/2'),
      true,
      'expected the setup mode switcher to anchor from the visual center of the header',
    );
    assert.equal(
      modeSwitcher.className.includes('-translate-x-1/2 -translate-y-1/2'),
      true,
      'expected the setup mode switcher to translate back from the anchor point for true centering',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('compact professional setup exposes one vertical scroll viewport', async () => {
  const dom = installDom();
  Object.defineProperty(dom.window, 'innerWidth', { value: 613, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 618, configurable: true });
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const compactModeSwitcher = container.querySelector<HTMLElement>(
      '[data-inspection-setup-mode-switcher]',
    );
    assert.ok(compactModeSwitcher, 'expected the compact mode switcher to render');
    assert.equal(compactModeSwitcher.className.includes('absolute'), false);

    await act(async () => {
      getSetupModeButton(container, t.inspectionAdvancedMode)?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
    });

    const scrollViewport = container.querySelector<HTMLElement>(
      '[data-inspection-advanced-scroll-viewport]',
    );
    assert.ok(scrollViewport, 'expected professional setup to render its scroll viewport');
    assert.equal(scrollViewport.className.includes('overflow-y-auto'), true);
    assert.equal(
      container
        .querySelector<HTMLElement>('[data-inspection-review-details="true"]')
        ?.className.includes('flex-none'),
      true,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('wide short professional setup keeps one vertical scroll viewport', async () => {
  const dom = installDom();
  Object.defineProperty(dom.window, 'innerWidth', { value: 1400, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 500, configurable: true });
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    await act(async () => {
      getSetupModeButton(container, t.inspectionAdvancedMode)?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
    });

    const scrollViewport = container.querySelector<HTMLElement>(
      '[data-inspection-advanced-scroll-viewport]',
    );
    const reviewDetails = container.querySelector<HTMLElement>(
      '[data-inspection-review-details="true"]',
    );
    assert.ok(scrollViewport, 'expected professional setup to render its scroll viewport');
    assert.ok(reviewDetails, 'expected professional setup to render review details');
    assert.equal(scrollViewport.className.includes('overflow-y-auto'), true);
    assert.equal(scrollViewport.className.includes('xl:overflow-hidden'), false);
    assert.equal(reviewDetails.className.includes('flex-none'), true);
    assert.equal(reviewDetails.className.includes('xl:flex-1'), false);
    assert.equal(
      Array.from(reviewDetails.querySelectorAll<HTMLElement>('[class]')).some((element) =>
        element.getAttribute('class')?.includes('xl:overflow-y-auto'),
      ),
      false,
      'expected the professional content not to introduce a nested xl scroll container',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup header uses the toolbox AI inspection logo', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const setupHeaderLogo = container.querySelector<HTMLElement>(
      '[data-inspection-setup-header-logo]',
    );
    assert.ok(setupHeaderLogo, 'expected the setup header logo wrapper to render');
    assert.match(setupHeaderLogo.className, /\bh-7\b/);
    assert.match(setupHeaderLogo.className, /\bw-7\b/);
    assert.ok(
      setupHeaderLogo.querySelector('svg.lucide-scan-search'),
      'expected the setup header logo to match the toolbox AI inspection ScanSearch icon',
    );
    assert.match(
      setupHeaderLogo.querySelector('svg.lucide-scan-search')?.getAttribute('class') ?? '',
      /\bh-4\b/,
    );
    assert.equal(
      setupHeaderLogo.querySelector('svg.lucide-bot'),
      null,
      'expected the setup header logo to stop rendering the Bot icon',
    );
    const dialog = container.querySelector<HTMLElement>(
      `[role="dialog"][aria-label="${translations.zh.aiInspection}"]`,
    );
    assert.ok(dialog, 'expected the inspection dialog to render');
    assert.match(dialog.className, /\brounded-lg\b/);
    const header = dialog.querySelector<HTMLElement>(':scope > [role="toolbar"]');
    assert.ok(header, 'expected the inspection header to render');
    assert.match(header.className, /\bh-10\b/);
    const title = header.querySelector('h1');
    assert.ok(title, 'expected the inspection title to render');
    assert.equal(title.className.includes('text-[13px]'), true);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup header omits maximize and restore controls', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.equal(
      container.querySelector(`button[aria-label="${t.maximize}"]`),
      null,
      'expected the fixed-size setup window to omit maximize',
    );
    assert.equal(
      container.querySelector(`button[aria-label="${t.restore}"]`),
      null,
      'expected the fixed-size setup window to omit restore',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('professional setup summary chip uses content-based width instead of stretching across the footer', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    await switchInspectionSetupMode(container, dom, translations.zh.inspectionAdvancedMode);

    const summaryChip = container.querySelector<HTMLElement>('[data-inspection-setup-summary]');
    assert.ok(
      summaryChip,
      'expected the professional setup footer to render a summary chip wrapper',
    );
    assert.equal(
      summaryChip.className.includes('inline-flex'),
      true,
      'expected the professional setup summary chip to size to its content',
    );
    assert.equal(
      summaryChip.className.includes('w-fit'),
      true,
      'expected the professional setup summary chip to stop expanding toward the footer actions',
    );
    assert.equal(
      summaryChip.textContent?.includes(translations.zh.inspectionMaxPossibleScore),
      false,
      'expected the professional setup summary to omit the theoretical maximum score',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
