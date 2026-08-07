import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';

import { HeaderMenus } from './HeaderMenus.tsx';

const noopToolboxItems: import('./types').ToolboxItem[] = [];

const aiToolboxItems: import('./types').ToolboxItem[] = [
  {
    key: 'ai-inspection',
    title: translations.en.aiInspection,
    description: translations.en.aiInspectionDesc,
    icon: React.createElement('span'),
    onClick: () => {},
  },
  {
    key: 'ai-conversation',
    title: translations.en.aiConversation,
    description: translations.en.aiConversationDesc,
    icon: React.createElement('span'),
    onClick: () => {},
  },
  {
    key: 'collision-optimizer',
    title: translations.en.collisionOptimizerDialog,
    description: translations.en.collisionOptimizerToolboxDesc,
    icon: React.createElement('span'),
    onClick: () => {},
  },
  {
    key: 'mesh-tools',
    title: 'Mesh Tools',
    description: 'Mesh helper tools',
    icon: React.createElement('span'),
    onClick: () => {},
  },
];

function renderViewMenu({
  showJointPanel = true,
  jointPanelAvailable = true,
}: {
  showJointPanel?: boolean;
  jointPanelAvailable?: boolean;
}) {
  return renderToStaticMarkup(
    React.createElement(HeaderMenus, {
      activeMenu: 'view',
      setActiveMenu: () => {},
      showMenuLabels: true,
      showSourceInline: false,
      showSourceText: false,
      showUndoRedoInline: false,
      t: translations.en,
      viewConfig: {
        showOptionsPanel: true,
        showJointPanel,
        showStructureGraph: false,
      },
      viewAvailability: {
        jointPanel: jointPanelAvailable,
      },
      setViewConfig: () => {},
      onImportFile: () => {},
      onImportFolder: () => {},
      onOpenExport: () => {},
      onPrefetchExport: () => {},
      onExportProject: () => {},
      toolboxItems: noopToolboxItems,
      onOpenCodeViewer: () => {},
      onPrefetchCodeViewer: () => {},
      undo: () => {},
      redo: () => {},
      canUndo: false,
      canRedo: false,
    }),
  );
}

function renderHeaderMenusWithToolboxItems(activeMenu: import('./types').HeaderMenuKey) {
  return renderToStaticMarkup(
    React.createElement(HeaderMenus, {
      activeMenu,
      setActiveMenu: () => {},
      showMenuLabels: true,
      showSourceInline: false,
      showSourceText: false,
      showUndoRedoInline: false,
      t: translations.en,
      viewConfig: {
        showOptionsPanel: true,
        showJointPanel: true,
        showStructureGraph: false,
      },
      viewAvailability: {
        jointPanel: true,
      },
      setViewConfig: () => {},
      onImportFile: () => {},
      onImportFolder: () => {},
      onOpenExport: () => {},
      onPrefetchExport: () => {},
      onExportProject: () => {},
      toolboxItems: aiToolboxItems,
      onOpenCodeViewer: () => {},
      onPrefetchCodeViewer: () => {},
      undo: () => {},
      redo: () => {},
      canUndo: false,
      canRedo: false,
    }),
  );
}

function getJointsPanelMenuButton(markup: string) {
  const dom = new JSDOM(`<body>${markup}</body>`);
  const buttons = Array.from(dom.window.document.querySelectorAll('button'));
  const match = buttons.find((button) => button.textContent?.includes('Joints Panel'));
  assert.ok(match, 'expected the view menu to render a joints panel menu item');
  return match;
}

function installDomEnvironment() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalSVGElement = globalThis.SVGElement;
  const originalNode = globalThis.Node;

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

  return {
    dom,
    restore() {
      dom.window.close();

      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          writable: true,
          value: originalWindow,
        });
      }

      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          writable: true,
          value: originalDocument,
        });
      }

      if (originalHTMLElement === undefined) {
        Reflect.deleteProperty(globalThis, 'HTMLElement');
      } else {
        Object.defineProperty(globalThis, 'HTMLElement', {
          configurable: true,
          writable: true,
          value: originalHTMLElement,
        });
      }

      if (originalSVGElement === undefined) {
        Reflect.deleteProperty(globalThis, 'SVGElement');
      } else {
        Object.defineProperty(globalThis, 'SVGElement', {
          configurable: true,
          writable: true,
          value: originalSVGElement,
        });
      }

      if (originalNode === undefined) {
        Reflect.deleteProperty(globalThis, 'Node');
      } else {
        Object.defineProperty(globalThis, 'Node', {
          configurable: true,
          writable: true,
          value: originalNode,
        });
      }
    },
  };
}

function renderFileMenu({
  onImportFile = () => {},
  onImportFolder = () => {},
  onExportProject = () => {},
  onPrefetchExport = () => {},
  isExportingProject = false,
  setActiveMenu = () => {},
}: {
  onImportFile?: () => void;
  onImportFolder?: () => void;
  onExportProject?: () => void;
  onPrefetchExport?: () => void;
  isExportingProject?: boolean;
  setActiveMenu?: (menu: import('./types').HeaderMenuKey) => void;
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  flushSync(() => {
    root.render(
      React.createElement(HeaderMenus, {
        activeMenu: 'file',
        setActiveMenu,
        showMenuLabels: true,
        showSourceInline: false,
        showSourceText: false,
        showUndoRedoInline: false,
        t: translations.en,
        viewConfig: {
          showOptionsPanel: true,
          showJointPanel: true,
          showStructureGraph: false,
        },
        viewAvailability: {
          jointPanel: true,
        },
        setViewConfig: () => {},
        onImportFile,
        onImportFolder,
        onOpenExport: () => {},
        onPrefetchExport,
        onExportProject,
        isExportingProject,
        toolboxItems: noopToolboxItems,
        onOpenCodeViewer: () => {},
        onPrefetchCodeViewer: () => {},
        undo: () => {},
        redo: () => {},
        canUndo: false,
        canRedo: false,
      }),
    );
  });

  return {
    container,
    root,
    cleanup() {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test('view menu no longer renders a toolbar visibility toggle', () => {
  const markup = renderViewMenu({
    showJointPanel: true,
    jointPanelAvailable: true,
  });
  const dom = new JSDOM(`<body>${markup}</body>`);
  const buttons = Array.from(dom.window.document.querySelectorAll('button'));
  const toolbarButton = buttons.find((button) => button.textContent?.includes('Toolbar'));

  assert.equal(toolbarButton, undefined);
});

test('AI menu owns only AI assistant toolbox items without duplicating them in the toolbox menu', () => {
  const aiMenuMarkup = renderHeaderMenusWithToolboxItems('ai');
  const toolboxMarkup = renderHeaderMenusWithToolboxItems('toolbox');

  assert.match(aiMenuMarkup, new RegExp(translations.en.aiInspection));
  assert.match(aiMenuMarkup, new RegExp(translations.en.aiConversation));
  assert.equal(
    new JSDOM(`<body>${aiMenuMarkup}</body>`).window.document.querySelectorAll(
      'span.text-system-blue',
    ).length,
    2,
  );
  assert.doesNotMatch(aiMenuMarkup, new RegExp(translations.en.collisionOptimizerDialog));
  assert.doesNotMatch(aiMenuMarkup, /Mesh Tools/);

  assert.match(toolboxMarkup, /Mesh Tools/);
  assert.match(toolboxMarkup, new RegExp(translations.en.collisionOptimizerDialog));
  assert.doesNotMatch(toolboxMarkup, new RegExp(translations.en.aiInspection));
  assert.doesNotMatch(toolboxMarkup, new RegExp(translations.en.aiConversation));
});

test('view menu shows the joints panel item as checked when the panel is available and enabled', () => {
  const markup = renderViewMenu({
    showJointPanel: true,
    jointPanelAvailable: true,
  });
  const button = getJointsPanelMenuButton(markup);

  assert.equal(button.getAttribute('role'), 'menuitemcheckbox');
  assert.equal(button.getAttribute('aria-checked'), 'true');
  assert.equal(button.hasAttribute('disabled'), false);
});

test('view menu disables the joints panel item and clears its checkmark when no controllable joint exists', () => {
  const markup = renderViewMenu({
    showJointPanel: true,
    jointPanelAvailable: false,
  });
  const button = getJointsPanelMenuButton(markup);

  assert.equal(button.getAttribute('role'), 'menuitemcheckbox');
  assert.equal(button.getAttribute('aria-checked'), 'false');
  assert.equal(button.hasAttribute('disabled'), true);
});

test('file menu opens the folder picker synchronously from the menu item click', async () => {
  const domEnvironment = installDomEnvironment();
  let importFolderCallCount = 0;
  const rendered = renderFileMenu({
    onImportFolder: () => {
      importFolderCallCount += 1;
    },
  });

  try {
    const folderButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Import Folder'),
    );
    assert.ok(folderButton, 'expected import folder menu item');

    folderButton.dispatchEvent(
      new domEnvironment.dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );

    assert.equal(importFolderCallCount, 1);
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    domEnvironment.restore();
  }
});

test('file menu prefetches the export dialog on pointer intent before click', async () => {
  const domEnvironment = installDomEnvironment();
  let prefetchCallCount = 0;
  const rendered = renderFileMenu({
    onPrefetchExport: () => {
      prefetchCallCount += 1;
    },
  });

  try {
    const exportButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Export',
    );
    assert.ok(exportButton, 'expected export menu item');

    exportButton.dispatchEvent(
      new domEnvironment.dom.window.Event('pointerover', {
        bubbles: true,
      }),
    );

    assert.equal(prefetchCallCount, 1);
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    domEnvironment.restore();
  }
});

test('file menu disables project export while an export is already running', async () => {
  const domEnvironment = installDomEnvironment();
  let exportCallCount = 0;
  const rendered = renderFileMenu({
    isExportingProject: true,
    onExportProject: () => {
      exportCallCount += 1;
    },
  });

  try {
    const exportProjectButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Export Project'),
    );
    assert.ok(exportProjectButton, 'expected export project menu item');
    assert.equal(exportProjectButton.hasAttribute('disabled'), true);

    exportProjectButton.dispatchEvent(
      new domEnvironment.dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );

    assert.equal(exportCallCount, 0);
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    domEnvironment.restore();
  }
});

test('file menu renders a semantic overlay button that closes the menu', async () => {
  const domEnvironment = installDomEnvironment();
  let closed = false;
  const rendered = renderFileMenu({
    setActiveMenu: (menu) => {
      closed = menu === null;
    },
  });

  try {
    const overlayButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"][tabindex="-1"]',
    );
    assert.ok(overlayButton, 'expected semantic menu overlay button');

    overlayButton.dispatchEvent(
      new domEnvironment.dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );

    assert.equal(closed, true);
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    domEnvironment.restore();
  }
});
