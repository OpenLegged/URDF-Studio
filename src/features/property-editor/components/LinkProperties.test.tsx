import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import type { AppMode, RobotState, UrdfLink } from '@/types';
import { GeometryType } from '@/types';
import { translations } from '@/shared/i18n';
import { useUIStore } from '@/store/uiStore';
import { applyLinkPatch } from '@/app/hooks/workspace-mutations/linkPatch';
import { LinkProperties } from './LinkProperties.tsx';

function createLink(): UrdfLink {
  return {
    id: 'base_link',
    name: 'base_link',
    visible: true,
    visual: {
      type: GeometryType.BOX,
      dimensions: { x: 0.4, y: 0.3, z: 0.2 },
      color: '#ff0000',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    visualBodies: [],
    collision: {
      type: GeometryType.BOX,
      dimensions: { x: 0.4, y: 0.3, z: 0.2 },
      color: '#00ff00',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    collisionBodies: [],
    inertial: {
      mass: 1,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
    },
  };
}

function createRobot(link: UrdfLink): RobotState {
  return {
    name: 'demo',
    links: {
      [link.id]: link,
    },
    joints: {},
    rootLinkId: link.id,
    selection: {
      type: 'link',
      id: link.id,
      subType: 'visual',
      objectIndex: 0,
    },
  };
}

function mergeTestLinkUpdate(currentLink: UrdfLink, nextData: unknown): UrdfLink {
  return applyLinkPatch(currentLink, nextData as Partial<UrdfLink>);
}

function renderLinkProperties(
  mode: AppMode,
  detailLinkTab: 'visual' | 'collision' | 'physics' = 'visual',
) {
  const link = createLink();
  const robot = createRobot(link);
  useUIStore.getState().setDetailLinkTab(detailLinkTab);

  return renderToStaticMarkup(
    React.createElement(LinkProperties, {
      componentId: 'component_1',
      data: link,
      robot,
      mode,
      selection: robot.selection,
      onUpdate: () => {},
      onSelect: () => {},
      onSelectGeometry: () => {},
      onAddCollisionBody: () => {},
      motorLibrary: {},
      assets: {},
      onUploadAsset: () => {},
      t: translations.en,
      lang: 'en',
    }),
  );
}

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
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
    dom.window.PointerEvent ?? dom.window.MouseEvent;
  (globalThis as { InputEvent?: typeof InputEvent }).InputEvent = dom.window.InputEvent;
  (globalThis as { FocusEvent?: typeof FocusEvent }).FocusEvent = dom.window.FocusEvent;
  (globalThis as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent = dom.window.KeyboardEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  if (!('attachEvent' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
      value: () => {},
      configurable: true,
    });
  }
  if (!('detachEvent' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
      value: () => {},
      configurable: true,
    });
  }
  if (!('setPointerCapture' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
    });
  }
  if (!('releasePointerCapture' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true,
    });
  }
  if (!('hasPointerCapture' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'hasPointerCapture', {
      value: () => false,
      configurable: true,
    });
  }

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, container, root };
}

function getReactProps(node: Element) {
  const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, 'React props key should exist on rendered element');
  return (node as unknown as Record<string, unknown>)[reactPropsKey] as Record<string, unknown>;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const prototype = input.ownerDocument.defaultView?.HTMLInputElement.prototype;
  const valueSetter = prototype
    ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    : undefined;

  assert.ok(valueSetter, 'HTMLInputElement value setter should exist');
  valueSetter.call(input, value);
}

function dispatchReactChange(input: HTMLInputElement, value: string) {
  setInputValue(input, value);
  const reactProps = getReactProps(input);
  const onChange = reactProps.onChange;
  assert.equal(typeof onChange, 'function', 'React onChange handler should exist');

  (onChange as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

function dispatchReactBlur(input: HTMLInputElement) {
  const reactProps = getReactProps(input);
  const onBlur = reactProps.onBlur;
  assert.equal(typeof onBlur, 'function', 'React onBlur handler should exist');

  (onBlur as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

function dispatchReactCheckboxChange(input: HTMLInputElement, checked: boolean) {
  const prototype = input.ownerDocument.defaultView?.HTMLInputElement.prototype;
  const checkedSetter = prototype
    ? Object.getOwnPropertyDescriptor(prototype, 'checked')?.set
    : undefined;

  assert.ok(checkedSetter, 'HTMLInputElement checked setter should exist');
  checkedSetter.call(input, checked);

  const reactProps = getReactProps(input);
  const onChange = reactProps.onChange;
  assert.equal(typeof onChange, 'function', 'React checkbox onChange handler should exist');

  (onChange as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

function dispatchReactClick(button: HTMLButtonElement) {
  const reactProps = getReactProps(button);
  const onClick = reactProps.onClick;
  assert.equal(typeof onClick, 'function', 'React onClick handler should exist');

  (
    onClick as (event: {
      currentTarget: HTMLButtonElement;
      target: HTMLButtonElement;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void
  )({
    currentTarget: button,
    target: button,
    preventDefault: () => {},
    stopPropagation: () => {},
  });
}

function findInlineNumberInputByLabel(container: Element, labelText: string) {
  const label = Array.from(container.querySelectorAll('label')).find(
    (node) => node.textContent === labelText,
  );
  assert.ok(label, `label "${labelText}" should render`);
  const input = label.parentElement?.querySelector('input[type="text"]');
  assert.ok(input, `input for label "${labelText}" should render`);
  return input as HTMLInputElement;
}

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

test('editor mode renders link-only editing layout without embedded joint properties', () => {
  const markup = renderLinkProperties('editor');

  assert.doesNotMatch(markup, new RegExp(translations.en.selectedJoint));
  assert.match(markup, new RegExp(translations.en.visualGeometry));
  assert.match(markup, new RegExp(translations.en.material));
  assert.match(markup, new RegExp(translations.en.collisionGeometry));
  assert.match(markup, new RegExp(translations.en.physics));
});

test('root link origin reference omits redundant no-parent helper text', () => {
  const markup = renderLinkProperties('editor', 'physics');

  assert.match(markup, new RegExp(translations.en.originReferenceFrame));
  assert.match(markup, new RegExp(translations.en.linkFrame));
  assert.doesNotMatch(markup, /This link has no parent joint/);
});

test('tab buttons and rotation mode controls stay shrinkable for narrow property sidebars', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('physics');
    useUIStore.setState({ rotationDisplayMode: 'euler_deg' });

    const link = createLink();
    const robot = createRobot(link);

    await act(async () => {
      root.render(
        React.createElement(LinkProperties, {
          componentId: 'component_1',
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: () => {},
          onSelect: () => {},
          onSelectGeometry: () => {},
          onAddCollisionBody: () => {},
          motorLibrary: {},
          assets: {},
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    const tabButton = container.querySelector(
      'button[title="Collision Geometry"]',
    ) as HTMLButtonElement | null;
    assert.ok(tabButton, 'collision geometry tab button should render');
    assert.match(
      tabButton.className,
      /\bmin-w-0\b/,
      'geometry tab buttons should be allowed to shrink within the property sidebar',
    );
    const tabLabel = tabButton.querySelector('span');
    assert.ok(tabLabel, 'geometry tab button should wrap its text in a label span');
    assert.match(
      tabLabel.className,
      /\btruncate\b/,
      'geometry tab labels should truncate instead of overflowing narrow sidebars',
    );

    const rotationModeButton = container.querySelector(
      `button[title="${translations.en.eulerDegrees}"]`,
    ) as HTMLButtonElement | null;
    assert.ok(rotationModeButton, 'rotation mode segmented control should render');
    assert.match(
      rotationModeButton.className,
      /\bmin-w-0\b/,
      'segmented control buttons should be allowed to shrink inside the sidebar',
    );
    const rotationModeLabel = rotationModeButton.querySelector('span:last-child');
    assert.ok(rotationModeLabel, 'rotation mode button should render a text label');
    assert.match(
      rotationModeLabel.className,
      /\btruncate\b/,
      'segmented control labels should truncate instead of overflowing narrow sidebars',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('visual tab renders geometry controls with an embedded material section', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('visual');

    const link = createLink();
    link.visual.materialSource = 'named';
    const robot = createRobot(link);

    await act(async () => {
      root.render(
        React.createElement(LinkProperties, {
          componentId: 'component_1',
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: () => {},
          onSelect: () => {},
          onSelectGeometry: () => {},
          onAddCollisionBody: () => {},
          motorLibrary: {},
          assets: {
            'textures/body.png': 'blob:body-texture',
          },
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    assert.match(
      container.textContent ?? '',
      new RegExp(translations.en.material),
      'visual tab should render an embedded material section title',
    );

    const materialSourceLabel = Array.from(container.querySelectorAll('label')).find(
      (node) => node.textContent === translations.en.materialSource,
    );
    assert.ok(materialSourceLabel, 'visual tab should render the material source field');

    const colorInput = container.querySelector(
      'input[type="color"][aria-label="Color"]',
    ) as HTMLInputElement | null;
    assert.ok(colorInput, 'visual tab should keep the material color picker visible');

    const textureLabel = Array.from(container.querySelectorAll('label')).find(
      (node) => node.textContent === translations.en.texture,
    );
    assert.ok(textureLabel, 'visual tab should keep the texture controls visible');

    const geometryTypeControl = container.querySelector(
      `button[role="combobox"][aria-label="${translations.en.type}"], select[aria-label="${translations.en.type}"]`,
    );
    assert.ok(geometryTypeControl, 'visual tab should still render geometry type controls');

    const materialTabButton = container.querySelector('button[title="Material"]');
    assert.equal(materialTabButton, null, 'material should no longer render as a top-level tab');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('visual tab shows authored material summaries inside the embedded material section', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('visual');

    const link = createLink();
    link.visual = {
      type: GeometryType.MESH,
      meshPath: 'meshes/base.stl',
      dimensions: { x: 1, y: 1, z: 1 },
      color: '',
      materialSource: 'inline',
      authoredMaterials: [
        { name: 'Body', color: '#112233', texture: 'textures/body.png' },
        { name: 'Accent', color: '#445566' },
      ],
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    };
    const robot = createRobot(link);

    await act(async () => {
      root.render(
        React.createElement(LinkProperties, {
          componentId: 'component_1',
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: () => {},
          onSelect: () => {},
          onSelectGeometry: () => {},
          onAddCollisionBody: () => {},
          motorLibrary: {},
          assets: {
            'textures/body.png': 'blob:body-texture',
          },
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    assert.match(
      container.textContent ?? '',
      /This visual uses multiple authored materials\./,
      'visual tab should surface the embedded multi-material summary inside the material section',
    );

    const authoredColorInputs = Array.from(container.querySelectorAll('input[type="text"]')).filter(
      (node) => ['#112233', '#445566'].includes((node as HTMLInputElement).value),
    );
    assert.equal(
      authoredColorInputs.length,
      2,
      'visual tab should render editable authored material color fields',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('visual geometry dimension labels stay shrinkable inside narrow inline rows', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('visual');

    const link = createLink();
    const robot = createRobot(link);

    await act(async () => {
      root.render(
        React.createElement(LinkProperties, {
          componentId: 'component_1',
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: () => {},
          onSelect: () => {},
          onSelectGeometry: () => {},
          onAddCollisionBody: () => {},
          motorLibrary: {},
          assets: {},
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    const widthLabel = container.querySelector('span[title="Width"]') as HTMLSpanElement | null;
    assert.ok(widthLabel, 'geometry dimension label should render');
    assert.match(
      widthLabel.className,
      /\btruncate\b/,
      'geometry dimension labels should truncate instead of overflowing the sidebar',
    );
    assert.match(
      widthLabel.parentElement?.className ?? '',
      /\bmin-w-0\b/,
      'geometry dimension rows should stay shrinkable inside the dimension grid',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('physics tab keeps diagonal inertia inline and principal axes in a matrix layout', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    const link = createLink();
    const robot = createRobot(link);

    await act(async () => {
      useUIStore.getState().setDetailLinkTab('physics');
      root.render(
        React.createElement(LinkProperties, {
          componentId: 'component_1',
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: () => {},
          onSelect: () => {},
          onSelectGeometry: () => {},
          onAddCollisionBody: () => {},
          motorLibrary: {},
          assets: {},
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    const i1Label = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'I1',
    );
    assert.ok(i1Label, 'I1 label should render');
    assert.equal(i1Label.parentElement?.className.includes('items-center'), true);
    assert.ok(
      i1Label.parentElement?.querySelector('input'),
      'I1 label should share its row with a number input',
    );
    const diagonalGrid = i1Label.parentElement?.parentElement;
    assert.ok(diagonalGrid, 'diagonal inertia grid should render');
    assert.match(
      diagonalGrid.className,
      /\bmin-w-0\b/,
      'diagonal inertia grid should be allowed to shrink within the sidebar',
    );
    assert.match(
      diagonalGrid.className,
      /\bw-full\b/,
      'diagonal inertia grid should fill the available inline width without overflowing',
    );

    const xHeader = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'X',
    );
    assert.ok(xHeader, 'principal axes X header should render');
    assert.equal(xHeader.parentElement?.textContent?.includes('A1'), false);

    const a1Label = Array.from(container.querySelectorAll('div')).find(
      (node) => node.textContent?.trim() === 'A1',
    );
    assert.ok(a1Label, 'principal axes A1 label should render');
    const a1Row = a1Label.parentElement;
    assert.ok(a1Row, 'principal axes A1 label should belong to a row container');
    assert.equal(
      a1Row.children.length,
      4,
      'principal axes A1 row should keep one label column plus three value columns',
    );
    assert.match(
      a1Row.className,
      /\bmin-w-0\b/,
      'principal axes rows should be allowed to shrink within the sidebar',
    );
    assert.match(
      a1Row.className,
      /\bw-full\b/,
      'principal axes rows should fill the available inline width without overflowing',
    );

    const densityLabel = Array.from(container.querySelectorAll('label')).find(
      (node) => node.textContent === translations.en.density,
    );
    assert.ok(densityLabel, 'density label should render');
    const densityField = densityLabel.parentElement?.querySelector('div.min-w-0.flex-1 > div');
    assert.ok(densityField, 'density field should render inside a shrinkable wrapper');
    assert.match(
      densityField.className,
      /\boverflow-hidden\b/,
      'density field should clip oversized values instead of overflowing',
    );
    assert.match(
      densityField.className,
      /\btruncate\b/,
      'density field should truncate oversized values inside the textbox',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('physics tab reuses collision-style rotation shortcuts for inertial origin', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('physics');
    useUIStore.setState({ rotationDisplayMode: 'euler_deg' });

    const link = createLink();
    const robot = createRobot(link);
    const updates: UrdfLink[] = [];

    await act(async () => {
      root.render(
        React.createElement(LinkProperties, {
          componentId: 'component_1',
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: (_type, _id, nextData) => {
            updates.push(nextData as UrdfLink);
          },
          onSelect: () => {},
          onSelectGeometry: () => {},
          onAddCollisionBody: () => {},
          motorLibrary: {},
          assets: {},
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    const rollIncreaseButton = Array.from(
      container.querySelectorAll('button[aria-label="Roll increase 90°"]'),
    ).at(-1) as HTMLButtonElement | undefined;
    const yawDecreaseButton = Array.from(
      container.querySelectorAll('button[aria-label="Yaw decrease 90°"]'),
    ).at(-1) as HTMLButtonElement | undefined;
    assert.ok(rollIncreaseButton, 'physics tab should expose roll shortcut buttons');
    assert.ok(yawDecreaseButton, 'physics tab should expose yaw shortcut buttons');

    await act(async () => {
      rollIncreaseButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const nextLink = updates.at(-1);
    assert.ok(nextLink, 'physics rotation shortcut should emit an updated link');
    assert.equal(nextLink.inertial?.origin?.rpy.r, Math.PI / 2);
    assert.equal(nextLink.inertial?.origin?.rpy.p, 0);
    assert.equal(nextLink.inertial?.origin?.rpy.y, 0);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('mass changes can remember and auto-apply uniform-density inertia re-estimation', async () => {
  const { dom, container, root } = createComponentRoot();
  const updates: UrdfLink[] = [];

  function ControlledHarness() {
    const [link, setLink] = React.useState(() => createLink());
    const robot = React.useMemo(() => createRobot(link), [link]);

    return React.createElement(LinkProperties, {
      componentId: 'component_1',
      data: link,
      robot,
      mode: 'editor',
      selection: robot.selection,
      onUpdate: (_type, _id, nextData) => {
        setLink((currentLink) => {
          const nextLink = mergeTestLinkUpdate(currentLink, nextData);
          updates.push(nextLink);
          return nextLink;
        });
      },
      motorLibrary: {},
      assets: {},
      onUploadAsset: () => {},
      t: translations.en,
      lang: 'en',
    });
  }

  try {
    useUIStore.getState().setDetailLinkTab('physics');
    useUIStore.getState().setMassInertiaChangeBehavior('ask');

    await act(async () => {
      root.render(React.createElement(ControlledHarness));
    });

    const massInput = findInlineNumberInputByLabel(container, translations.en.mass);

    await act(async () => {
      massInput.focus();
      dispatchReactChange(massInput, '2');
      massInput.blur();
      dispatchReactBlur(massInput);
    });

    assert.match(
      dom.window.document.body.textContent ?? '',
      new RegExp(translations.en.massChangeInertiaDialogTitle),
      'mass changes should open a confirmation dialog before applying the new inertia behavior',
    );
    assert.equal(
      dom.window.document.body.textContent?.includes(translations.en.massChangeInertiaReestimateUnavailable),
      false,
      'valid mass and inertia should not show an unavailable explanation',
    );

    const rememberCheckbox = dom.window.document.body.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    assert.ok(rememberCheckbox, 'remember-choice checkbox should render');

    await act(async () => {
      dispatchReactCheckboxChange(rememberCheckbox, true);
    });

    const confirmButton = Array.from(dom.window.document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === translations.en.confirm,
    ) as HTMLButtonElement | undefined;
    assert.ok(confirmButton, 'confirm button should render');

    await act(async () => {
      dispatchReactClick(confirmButton);
    });

    const firstUpdate = updates.at(-1);
    assert.ok(firstUpdate, 'confirming the dialog should emit an updated link');
    assert.equal(firstUpdate.inertial?.mass, 2);
    assert.equal(firstUpdate.inertial?.inertia.ixx, 2);
    assert.equal(firstUpdate.inertial?.inertia.iyy, 2);
    assert.equal(firstUpdate.inertial?.inertia.izz, 2);
    assert.equal(useUIStore.getState().massInertiaChangeBehavior, 'reestimate');
    assert.match(
      dom.window.document.body.textContent ?? '',
      /ixx=2(?:\.0+)?/,
      'the floating notice should summarize the updated inertia tensor',
    );

    const nextMassInput = findInlineNumberInputByLabel(container, translations.en.mass);

    await act(async () => {
      nextMassInput.focus();
      dispatchReactChange(nextMassInput, '3');
      nextMassInput.blur();
    });

    const secondUpdate = updates.at(-1);
    assert.ok(secondUpdate, 'remembered behavior should auto-apply the next mass change');
    assert.equal(secondUpdate.inertial?.mass, 3);
    assert.equal(secondUpdate.inertial?.inertia.ixx, 3);
    assert.equal(secondUpdate.inertial?.inertia.iyy, 3);
    assert.equal(secondUpdate.inertial?.inertia.izz, 3);
    assert.doesNotMatch(
      dom.window.document.body.textContent ?? '',
      new RegExp(translations.en.massChangeInertiaDialogTitle),
      'remembered behavior should skip the confirmation dialog on later changes',
    );
  } finally {
    await destroyComponentRoot(dom, root);
    useUIStore.getState().setMassInertiaChangeBehavior('ask');
  }
});

for (const initialInertial of ['zero-mass', 'missing'] as const) {
  test(`mass change explains unavailable scaling for ${initialInertial} inertia and still confirms`, async () => {
    const { dom, container, root } = createComponentRoot();
    const lang = initialInertial === 'zero-mass' ? 'zh' : 'en';
    const t = translations[lang];
    const link = createLink();
    if (initialInertial === 'zero-mass') {
      link.inertial!.mass = 0;
      link.inertial!.inertia = { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 };
    } else {
      link.inertial = undefined;
    }
    const originalInertia = link.inertial?.inertia;
    const updates: UrdfLink[] = [];

    function ControlledHarness() {
      const [currentLink, setLink] = React.useState(link);
      const robot = createRobot(currentLink);
      return React.createElement(LinkProperties, {
        componentId: 'component_1', data: currentLink, robot, mode: 'editor',
        selection: robot.selection,
        onUpdate: (_type, _id, nextData) => {
          setLink((previous) => {
            const next = mergeTestLinkUpdate(previous, nextData);
            updates.push(next);
            return next;
          });
        },
        motorLibrary: {}, assets: {}, onUploadAsset: () => {}, t, lang,
      });
    }

    try {
      useUIStore.getState().setDetailLinkTab('physics');
      useUIStore.getState().setMassInertiaChangeBehavior('ask');
      await act(async () => { root.render(React.createElement(ControlledHarness)); });

      const massInput = findInlineNumberInputByLabel(container, t.mass);
      await act(async () => {
        massInput.focus();
        dispatchReactChange(massInput, '1');
        massInput.blur();
        dispatchReactBlur(massInput);
      });

      const dialog = dom.window.document.querySelector('[role="dialog"]');
      assert.ok(dialog);
      const choices = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button[role="radio"]'));
      const preserveChoice = choices.find((choice) => choice.textContent?.trim() === t.massChangeInertiaKeep);
      const scaleChoice = choices.find((choice) => choice.textContent?.trim() === t.massChangeInertiaReestimate);
      assert.ok(preserveChoice);
      assert.ok(scaleChoice);
      assert.equal(preserveChoice.getAttribute('aria-checked'), 'true');
      assert.equal(scaleChoice.disabled, true);
      assert.ok(
        dialog.textContent?.includes(t.massChangeInertiaReestimateUnavailable),
        'the reason must be visible while preserve is selected and scaling cannot be selected',
      );
      assert.equal(updates.length, 0, 'opening the dialog should not apply the pending mass');
      const confirm = Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === t.confirm,
      );
      assert.ok(confirm);
      assert.equal(confirm.disabled, false);
      await act(async () => { dispatchReactClick(confirm); });

      assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
      assert.equal(updates.at(-1)?.inertial?.mass, 1);
      if (originalInertia) {
        assert.deepEqual(updates.at(-1)?.inertial?.inertia, originalInertia);
      }
    } finally {
      await destroyComponentRoot(dom, root);
      useUIStore.getState().setMassInertiaChangeBehavior('ask');
    }
  });
}

test('collision tab lists every collision geometry for the selected link', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('collision');

    const link = createLink();
    link.collisionBodies = [
      {
        type: GeometryType.SPHERE,
        dimensions: { x: 0.12, y: 0.12, z: 0.12 },
        color: '#00ff00',
        origin: { xyz: { x: 0.1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      {
        type: GeometryType.CAPSULE,
        dimensions: { x: 0.1, y: 0.1, z: 0.4 },
        color: '#ffaa00',
        origin: { xyz: { x: 0.2, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
    ];
    const robot = createRobot(link);
    robot.selection = {
      type: 'link',
      id: link.id,
      subType: 'collision',
      objectIndex: 0,
    };

    await act(async () => {
      root.render(
        React.createElement(LinkProperties, {
          componentId: 'component_1',
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: () => {},
          onSelect: () => {},
          onSelectGeometry: () => {},
          onAddCollisionBody: () => {},
          motorLibrary: {},
          assets: {},
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    assert.ok(
      container.querySelector('button[aria-label="Collision 1"]'),
      'primary collision entry should render in the list',
    );
    assert.match(
      container.querySelector('button[aria-label="Collision 1"]')?.textContent ?? '',
      /Collision 1.*Box/s,
      'collision rows should summarize name and geometry type inline',
    );
    const primaryVisibilityButton = container.querySelector(
      'button[aria-label="Hide Collision 1"]',
    ) as HTMLButtonElement | null;
    assert.ok(primaryVisibilityButton, 'primary collision entry should expose visibility control');
    assert.equal(
      primaryVisibilityButton.getAttribute('aria-pressed'),
      'true',
      'visible collision entries should expose pressed visibility state',
    );
    assert.ok(
      container.querySelector('button[aria-label="Collision 2"]'),
      'secondary collision entry should render in the list',
    );
    assert.ok(
      container.querySelector('button[aria-label="Collision 3"]'),
      'third collision entry should render in the list',
    );
    assert.ok(
      container.querySelector('div.max-h-48.overflow-y-auto'),
      'collision list should render inside a scrollable container',
    );
    assert.doesNotMatch(
      container.textContent ?? '',
      /Primary/,
      'collision list should not split or label a primary collision body',
    );

    const deleteCollisionButton = container.querySelector(
      `button[aria-label="${translations.en.deleteCollisionGeometry}"]`,
    ) as HTMLButtonElement | null;
    assert.ok(deleteCollisionButton, 'delete collision body button should render');
    assert.match(
      deleteCollisionButton.className,
      /\btext-danger\b/,
      'delete collision body button should use the danger styling',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('collision tab supports renaming collision bodies and shows custom names in the list', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('collision');

    function ControlledCollisionRenameHarness() {
      const [link, setLink] = React.useState(() => {
        const nextLink = createLink();
        nextLink.collision.name = 'base_collision';
        nextLink.collisionBodies = [
          {
            type: GeometryType.SPHERE,
            name: 'motor_guard',
            dimensions: { x: 0.12, y: 0.12, z: 0.12 },
            color: '#00ff00',
            origin: { xyz: { x: 0.1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ];
        return nextLink;
      });
      const [selection, setSelection] = React.useState<RobotState['selection']>({
        type: 'link',
        id: link.id,
        subType: 'collision',
        objectIndex: 0,
      });
      const robot = React.useMemo(
        () => ({
          ...createRobot(link),
          selection,
        }),
        [link, selection],
      );

      return React.createElement(LinkProperties, {
        componentId: 'component_1',
        data: link,
        robot,
        mode: 'editor',
        selection,
        onUpdate: (_type, _id, nextData) => {
          setLink((currentLink) => mergeTestLinkUpdate(currentLink, nextData));
        },
        onSelect: () => {},
        onSelectGeometry: (linkId, subType, objectIndex = 0) => {
          setSelection({ type: 'link', id: linkId, subType, objectIndex });
        },
        motorLibrary: {},
        assets: {},
        onUploadAsset: () => {},
        t: translations.en,
        lang: 'en',
      });
    }

    await act(async () => {
      root.render(React.createElement(ControlledCollisionRenameHarness));
    });

    const primaryCollisionButton = container.querySelector(
      'button[aria-label="base_collision"]',
    ) as HTMLButtonElement | null;
    assert.ok(primaryCollisionButton, 'custom collision names should appear in the list');

    const collisionNameInput = container.querySelector(
      'input[value="base_collision"]',
    ) as HTMLInputElement | null;
    assert.ok(collisionNameInput, 'selected collision should expose a rename input');

    await act(async () => {
      dispatchReactChange(collisionNameInput, 'torso_shell');
    });

    assert.ok(
      container.querySelector('button[aria-label="torso_shell"]'),
      'renaming a collision should update the list label',
    );

    const secondaryCollisionButton = container.querySelector(
      'button[aria-label="motor_guard"]',
    ) as HTMLButtonElement | null;
    assert.ok(secondaryCollisionButton, 'secondary custom collision names should remain visible');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('collision list supports right-click rename for collision entries', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('collision');

    function ControlledCollisionContextRenameHarness() {
      const [link, setLink] = React.useState(() => {
        const nextLink = createLink();
        nextLink.collisionBodies = [
          {
            type: GeometryType.SPHERE,
            name: 'motor_guard',
            dimensions: { x: 0.12, y: 0.12, z: 0.12 },
            color: '#00ff00',
            origin: { xyz: { x: 0.1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ];
        return nextLink;
      });
      const [selection, setSelection] = React.useState<RobotState['selection']>({
        type: 'link',
        id: link.id,
        subType: 'collision',
        objectIndex: 0,
      });
      const robot = React.useMemo(
        () => ({
          ...createRobot(link),
          selection,
        }),
        [link, selection],
      );

      return React.createElement(LinkProperties, {
        componentId: 'component_1',
        data: link,
        robot,
        mode: 'editor',
        selection,
        onUpdate: (_type, _id, nextData) => {
          setLink((currentLink) => mergeTestLinkUpdate(currentLink, nextData));
        },
        onSelect: () => {},
        onSelectGeometry: (linkId, subType, objectIndex = 0) => {
          setSelection({ type: 'link', id: linkId, subType, objectIndex });
        },
        motorLibrary: {},
        assets: {},
        onUploadAsset: () => {},
        t: translations.en,
        lang: 'en',
      });
    }

    await act(async () => {
      root.render(React.createElement(ControlledCollisionContextRenameHarness));
    });

    const secondCollisionRow = container.querySelector(
      '[data-collision-list-row="1"]',
    ) as HTMLDivElement | null;
    assert.ok(secondCollisionRow, 'secondary collision row should render');

    await act(async () => {
      secondCollisionRow.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 140,
          clientY: 96,
        }),
      );
    });

    const renameButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === translations.en.rename,
    ) as HTMLButtonElement | undefined;
    assert.ok(renameButton, 'right-clicking a collision row should open a rename action');

    await act(async () => {
      dispatchReactClick(renameButton);
    });

    const renameInput = container.querySelector(
      'input[aria-label="Rename"]',
    ) as HTMLInputElement | null;
    assert.ok(renameInput, 'collision row should switch into inline rename mode');
    assert.equal(renameInput.value, 'motor_guard');

    await act(async () => {
      dispatchReactChange(renameInput, 'arm_guard');
    });

    await act(async () => {
      dispatchReactBlur(renameInput);
    });

    assert.ok(
      container.querySelector('button[aria-label="arm_guard"]'),
      'context menu rename should update the collision list entry label',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('collision list selection switches the editor to the clicked collision body', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('collision');

    function ControlledCollisionHarness() {
      const [link] = React.useState(() => {
        const nextLink = createLink();
        nextLink.collisionBodies = [
          {
            type: GeometryType.SPHERE,
            dimensions: { x: 0.12, y: 0.12, z: 0.12 },
            color: '#00ff00',
            origin: { xyz: { x: 0.1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ];
        return nextLink;
      });
      const [selection, setSelection] = React.useState<RobotState['selection']>({
        type: 'link',
        id: link.id,
        subType: 'collision',
        objectIndex: 0,
      });
      const robot = React.useMemo(
        () => ({
          ...createRobot(link),
          selection,
        }),
        [link, selection],
      );

      return React.createElement(LinkProperties, {
        componentId: 'component_1',
        data: link,
        robot,
        mode: 'editor',
        selection,
        onUpdate: () => {},
        onSelect: () => {},
        onSelectGeometry: (linkId, subType, objectIndex = 0) => {
          setSelection({ type: 'link', id: linkId, subType, objectIndex });
        },
        onAddCollisionBody: () => {},
        motorLibrary: {},
        assets: {},
        onUploadAsset: () => {},
        t: translations.en,
        lang: 'en',
      });
    }

    await act(async () => {
      root.render(React.createElement(ControlledCollisionHarness));
    });

    const geometryTypeSelect = container.querySelector('select') as HTMLSelectElement | null;
    assert.ok(geometryTypeSelect, 'geometry type select should render');
    assert.equal(geometryTypeSelect.value, GeometryType.BOX);

    const secondCollisionButton = container.querySelector(
      'button[aria-label="Collision 2"]',
    ) as HTMLButtonElement | null;
    assert.ok(secondCollisionButton, 'second collision list item should render');

    await act(async () => {
      dispatchReactClick(secondCollisionButton);
    });

    assert.equal(
      geometryTypeSelect.value,
      GeometryType.SPHERE,
      'clicking a collision list item should retarget the editor to that collision body',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('collision list visibility button toggles the clicked collision body', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('collision');
    const selectionCalls: Array<
      [string, 'visual' | 'collision', number | undefined, boolean | undefined, boolean | undefined]
    > = [];

    function ControlledCollisionVisibilityHarness() {
      const [link, setLink] = React.useState(() => {
        const nextLink = createLink();
        nextLink.collisionBodies = [
          {
            type: GeometryType.SPHERE,
            dimensions: { x: 0.12, y: 0.12, z: 0.12 },
            color: '#00ff00',
            origin: { xyz: { x: 0.1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ];
        return nextLink;
      });
      const [selection, setSelection] = React.useState<RobotState['selection']>({
        type: 'link',
        id: link.id,
        subType: 'collision',
        objectIndex: 0,
      });
      const robot = React.useMemo(
        () => ({
          ...createRobot(link),
          selection,
        }),
        [link, selection],
      );

      return React.createElement(LinkProperties, {
        componentId: 'component_1',
        data: link,
        robot,
        mode: 'editor',
        selection,
        onUpdate: (_type, _id, nextData) => {
          setLink((currentLink) => mergeTestLinkUpdate(currentLink, nextData));
        },
        onSelect: () => {},
        onSelectGeometry: (linkId, subType, objectIndex = 0, suppressPulse, suppressAutoReveal) => {
          selectionCalls.push([linkId, subType, objectIndex, suppressPulse, suppressAutoReveal]);
          setSelection({ type: 'link', id: linkId, subType, objectIndex });
        },
        onAddCollisionBody: () => {},
        motorLibrary: {},
        assets: {},
        onUploadAsset: () => {},
        t: translations.en,
        lang: 'en',
      });
    }

    await act(async () => {
      root.render(React.createElement(ControlledCollisionVisibilityHarness));
    });

    const toggleVisibilityButton = container.querySelector(
      'button[aria-label="Hide Collision 2"]',
    ) as HTMLButtonElement | null;
    assert.ok(toggleVisibilityButton, 'collision list visibility button should render');

    await act(async () => {
      dispatchReactClick(toggleVisibilityButton);
    });

    assert.ok(
      container.querySelector('button[aria-label="Show Collision 2"]'),
      'clicking the list eye button should toggle that collision body visibility',
    );

    // The GeometryEditor no longer has its own visibility button;
    // visibility is managed through the collision list above.
    assert.deepEqual(selectionCalls.at(-1), ['base_link', 'collision', 1, true, true]);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('collision tab add button appends a new collision body and selects it when no app callback is provided', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('collision');

    function ControlledCollisionAddHarness() {
      const [link, setLink] = React.useState(() => {
        const nextLink = createLink();
        nextLink.collisionBodies = [
          {
            type: GeometryType.SPHERE,
            dimensions: { x: 0.12, y: 0.12, z: 0.12 },
            color: '#00ff00',
            origin: { xyz: { x: 0.1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ];
        return nextLink;
      });
      const [selection, setSelection] = React.useState<RobotState['selection']>({
        type: 'link',
        id: link.id,
        subType: 'collision',
        objectIndex: 1,
      });
      const robot = React.useMemo(
        () => ({
          ...createRobot(link),
          selection,
        }),
        [link, selection],
      );

      return React.createElement(LinkProperties, {
        componentId: 'component_1',
        data: link,
        robot,
        mode: 'editor',
        selection,
        onUpdate: (_type, _id, nextData) => {
          setLink((currentLink) => mergeTestLinkUpdate(currentLink, nextData));
        },
        onSelect: () => {},
        onSelectGeometry: (linkId, subType, objectIndex = 0) => {
          setSelection({ type: 'link', id: linkId, subType, objectIndex });
        },
        motorLibrary: {},
        assets: {},
        onUploadAsset: () => {},
        t: translations.en,
        lang: 'en',
      });
    }

    await act(async () => {
      root.render(React.createElement(ControlledCollisionAddHarness));
    });

    const addCollisionButton = container.querySelector(
      `button[aria-label="${translations.en.addCollisionBody}"]`,
    ) as HTMLButtonElement | null;
    assert.ok(addCollisionButton, 'add collision body button should render');

    await act(async () => {
      dispatchReactClick(addCollisionButton);
    });

    assert.ok(
      container.querySelector('button[aria-label="Collision 3"]'),
      'adding a collision body should append a new list entry',
    );

    const geometryTypeSelect = container.querySelector('select') as HTMLSelectElement | null;
    assert.ok(geometryTypeSelect, 'geometry type select should remain mounted');
    assert.equal(
      geometryTypeSelect.value,
      GeometryType.BOX,
      'the newly added collision body should become the active editable collision',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('collision tab delete button removes the active collision body and keeps the next item selected', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('collision');

    function ControlledCollisionDeleteHarness() {
      const [link, setLink] = React.useState(() => {
        const nextLink = createLink();
        nextLink.collisionBodies = [
          {
            type: GeometryType.SPHERE,
            dimensions: { x: 0.12, y: 0.12, z: 0.12 },
            color: '#00ff00',
            origin: { xyz: { x: 0.1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          {
            type: GeometryType.CAPSULE,
            dimensions: { x: 0.1, y: 0.1, z: 0.4 },
            color: '#ffaa00',
            origin: { xyz: { x: 0.2, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ];
        return nextLink;
      });
      const [selection, setSelection] = React.useState<RobotState['selection']>({
        type: 'link',
        id: link.id,
        subType: 'collision',
        objectIndex: 2,
      });
      const robot = React.useMemo(
        () => ({
          ...createRobot(link),
          selection,
        }),
        [link, selection],
      );

      return React.createElement(LinkProperties, {
        componentId: 'component_1',
        data: link,
        robot,
        mode: 'editor',
        selection,
        onUpdate: (_type, _id, nextData) => {
          setLink((currentLink) => mergeTestLinkUpdate(currentLink, nextData));
        },
        onSelect: () => {},
        onSelectGeometry: (linkId, subType, objectIndex = 0) => {
          setSelection({ type: 'link', id: linkId, subType, objectIndex });
        },
        motorLibrary: {},
        assets: {},
        onUploadAsset: () => {},
        t: translations.en,
        lang: 'en',
      });
    }

    await act(async () => {
      root.render(React.createElement(ControlledCollisionDeleteHarness));
    });

    const deleteCollisionButton = container.querySelector(
      `button[aria-label="${translations.en.deleteCollisionGeometry}"]`,
    ) as HTMLButtonElement | null;
    assert.ok(deleteCollisionButton, 'delete collision body button should render');

    await act(async () => {
      dispatchReactClick(deleteCollisionButton);
    });

    assert.equal(
      container.querySelector('button[aria-label="Collision 3"]'),
      null,
      'deleting the selected collision should remove it from the list',
    );

    const geometryTypeSelect = container.querySelector('select') as HTMLSelectElement | null;
    assert.ok(geometryTypeSelect, 'geometry type select should remain mounted after delete');
    assert.equal(
      geometryTypeSelect.value,
      GeometryType.SPHERE,
      'after deleting the last collision entry, the editor should select the next remaining collision body',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});
