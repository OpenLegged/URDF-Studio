import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, createRef, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import type { RobotFile } from '@/types';
import { buildFileTree } from '../../utils';
import { TreeEditorFileBrowserPanel } from './TreeEditorFileBrowserPanel.tsx';

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

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement =
    dom.window.HTMLInputElement;
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

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, container, root };
}

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

function renderPanel({
  root,
  file,
  showAddAsComponent,
  onAddComponent,
  onLoadRobot,
  folderRenameInputRef = createRef<HTMLInputElement>(),
}: {
  root: Root;
  file: RobotFile;
  showAddAsComponent: boolean;
  onAddComponent?: (file: RobotFile) => void;
  onLoadRobot?: (file: RobotFile) => void;
  folderRenameInputRef?: RefObject<HTMLInputElement | null>;
}) {
  return act(async () => {
    root.render(
      <TreeEditorFileBrowserPanel
        isOpen
        isDragging={false}
        showAddAsComponent={showAddAsComponent}
        height={240}
        shouldFillSpace={false}
        availableFiles={[file]}
        fileTree={buildFileTree([file])}
        expandedFolders={new Set()}
        editingFolderPath={null}
        folderRenameDraft=""
        folderRenameInputRef={folderRenameInputRef}
        t={translations.en}
        onToggleOpen={() => {}}
        onFolderRenameDraftChange={() => {}}
        onCommitFolderRename={() => {}}
        onCancelFolderRename={() => {}}
        onLoadRobot={onLoadRobot}
        onAddComponent={onAddComponent}
        onFileContextMenu={() => {}}
        onFolderContextMenu={() => {}}
        toggleFolder={() => {}}
      />,
    );
  });
}

test('TreeEditorFileBrowserPanel opens files from row clicks and reserves the add button for components', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    const file: RobotFile = {
      name: 'arm.urdf',
      content: '<robot name="arm" />',
      format: 'urdf',
    };
    const addedFiles: string[] = [];
    const loadedFiles: string[] = [];

    await renderPanel({
      root,
      file,
      showAddAsComponent: true,
      onAddComponent: (nextFile) => {
        addedFiles.push(nextFile.name);
      },
      onLoadRobot: (nextFile) => {
        loadedFiles.push(nextFile.name);
      },
    });

    const fileLabel = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent === 'arm.urdf',
    );
    assert.ok(fileLabel, 'file label should render');
    const fileRow = fileLabel.closest('.group');
    assert.ok(fileRow, 'file row should render');
    const scrollContainer = fileRow.closest('.custom-scrollbar');
    assert.ok(scrollContainer, 'file browser scroll container should render');
    assert.match(
      scrollContainer.className,
      /\boverflow-x-auto\b/,
      'asset library should allow horizontal scrolling for long file names',
    );
    assert.doesNotMatch(
      scrollContainer.className,
      /\boverflow-x-hidden\b/,
      'asset library must not hide horizontally overflowing file names',
    );
    assert.match(
      fileRow.className,
      /\bw-max\b/,
      'file rows should expand to their full content width',
    );
    assert.match(
      fileRow.className,
      /\bmin-w-full\b/,
      'file rows should still fill the visible sidebar width',
    );
    assert.doesNotMatch(
      fileLabel.className,
      /\btruncate\b/,
      'file names should not be truncated in the asset library',
    );
    assert.match(
      fileLabel.className,
      /\bwhitespace-nowrap\b/,
      'file names should stay on one line and use horizontal scrolling when needed',
    );

    await act(async () => {
      fileLabel.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(addedFiles, []);
    assert.deepEqual(loadedFiles, ['arm.urdf']);

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.getAttribute('title') === translations.en.addComponent,
    );
    assert.ok(addButton, 'add button should render for component-capable files');
    assert.match(
      addButton.className,
      /\bshrink-0\b/,
      'add button must remain visible when file names and format badges shrink',
    );
    const addButtonLabel = addButton.querySelector('span');
    assert.ok(addButtonLabel, 'add button should keep a text label for wider sidebars');
    assert.match(
      addButtonLabel.className,
      /\bhidden\b/,
      'narrow sidebars should keep the add icon visible by hiding the text label first',
    );
    assert.match(
      addButtonLabel.className,
      /@\[260px\]:inline/,
      'add button text should reappear when the sidebar has enough width',
    );
    const addButtonColumn = addButton.closest('.sticky');
    assert.ok(addButtonColumn, 'add button column should render');
    assert.match(
      addButtonColumn.className,
      /\bml-auto\b/,
      'add button column should push trailing row controls to the right edge',
    );
    const formatBadge = Array.from(fileRow.querySelectorAll('span')).find(
      (element) => element.textContent === 'URDF',
    );
    assert.equal(
      formatBadge?.textContent,
      'URDF',
      'format badge should render inside the trailing file row column',
    );
    assert.match(
      formatBadge?.getAttribute('class') ?? '',
      /\bw-9\b/,
      'format badge should keep a compact fixed column width',
    );
    assert.match(
      formatBadge?.getAttribute('class') ?? '',
      /text-\[8px\]/,
      'format badge should use compact text for the final column',
    );
    assert.equal(
      formatBadge?.closest('.sticky'),
      addButtonColumn,
      'format badge and add controls should share the sticky trailing column',
    );

    await act(async () => {
      addButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(addedFiles, ['arm.urdf']);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeEditorFileBrowserPanel anchors MJCF and USD badges to the final column', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    const cases: Array<{ name: string; format: RobotFile['format']; label: string }> = [
      { name: 'scene.xml', format: 'mjcf', label: 'MJCF' },
      { name: 'go2.usd', format: 'usd', label: 'USD' },
    ];

    for (const fileCase of cases) {
      const file: RobotFile = {
        name: fileCase.name,
        content: '',
        format: fileCase.format,
      };

      await renderPanel({
        root,
        file,
        showAddAsComponent: false,
        onLoadRobot: () => {},
      });

      const fileLabel = Array.from(container.querySelectorAll('span')).find(
        (element) => element.textContent === fileCase.name,
      );
      assert.ok(fileLabel, `${fileCase.name} label should render`);

      const fileRow = fileLabel.closest('.group');
      assert.ok(fileRow, `${fileCase.name} row should render`);

      const formatBadge = Array.from(fileRow.querySelectorAll('span')).find(
        (element) => element.textContent === fileCase.label,
      );
      assert.equal(
        formatBadge?.textContent,
        fileCase.label,
        `${fileCase.label} badge should render inside the trailing file row column`,
      );
      const trailingColumn = formatBadge?.closest('.sticky');
      assert.ok(trailingColumn, `${fileCase.label} badge should stay in the sticky column`);
      assert.match(
        trailingColumn.className,
        /\bml-auto\b/,
        `${fileCase.label} badge should align to the right edge when no add column is shown`,
      );
      assert.match(
        trailingColumn.className,
        /\bright-0\b/,
        `${fileCase.label} badge should remain visible at the right edge while names scroll`,
      );
      assert.match(
        formatBadge?.getAttribute('class') ?? '',
        /\bw-9\b/,
        `${fileCase.label} badge should use the compact final-column width`,
      );
      assert.match(
        formatBadge?.getAttribute('class') ?? '',
        /text-\[8px\]/,
        `${fileCase.label} badge should use compact text`,
      );
    }
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeEditorFileBrowserPanel previews image assets instead of adding them', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    const file: RobotFile = {
      name: 'poster.png',
      content: '',
      format: 'mesh',
    };
    const addedFiles: string[] = [];
    const loadedFiles: string[] = [];

    await renderPanel({
      root,
      file,
      showAddAsComponent: true,
      onAddComponent: (nextFile) => {
        addedFiles.push(nextFile.name);
      },
      onLoadRobot: (nextFile) => {
        loadedFiles.push(nextFile.name);
      },
    });

    const fileLabel = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent === 'poster.png',
    );
    assert.ok(fileLabel, 'image file label should render');

    await act(async () => {
      fileLabel.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(addedFiles, []);
    assert.deepEqual(loadedFiles, ['poster.png']);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});
