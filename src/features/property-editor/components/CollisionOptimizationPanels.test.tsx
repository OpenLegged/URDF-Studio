import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { GeometryType, type UrdfVisual } from '@/types';
import type {
  CollisionOptimizationCandidate,
  CollisionTargetRef,
} from '../utils/collisionOptimization.ts';
import {
  CollisionOptimizationCandidateList,
  type CollisionOptimizationCandidateListLabels,
} from './CollisionOptimizationCandidateList.tsx';
import { CollisionOptimizationSplitPane } from './CollisionOptimizationSplitPane.tsx';
import {
  getCollisionOptimizationPrimaryWidthRange,
  shouldStackCollisionOptimizationPanels,
} from './collisionOptimizationSplitLayout.ts';
import {
  CollisionOptimizationStrategyPanel,
  type CollisionOptimizationStrategyPanelLabels,
} from './CollisionOptimizationStrategyPanel.tsx';

const LIST_LABELS: CollisionOptimizationCandidateListLabels = {
  clearAll: 'Exclude candidate',
  collisionIndex: 'Collision',
  component: 'Component',
  jointPair: 'Joint pair',
  noCandidates: 'No candidates',
  selectedCount: 'Include candidate',
};

const STRATEGY_LABELS: CollisionOptimizationStrategyPanelLabels = {
  current: 'Current',
  includeCandidate: 'Include candidate',
  reason: 'Reason',
  selectCandidateHint: 'Select a candidate',
  selectedCandidate: 'Selected candidate',
  status: 'Status',
  suggested: 'Suggested',
};

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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  return { container, dom, root: createRoot(container) };
}

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

function createGeometry(type: GeometryType): UrdfVisual {
  return {
    type,
    dimensions: { x: 0.4, y: 0.3, z: 0.2 },
    color: '#ef4444',
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };
}

function createTarget(): CollisionTargetRef {
  return {
    id: 'component-a::base-link::collision::0',
    componentId: 'component-a',
    componentName: 'Robot A',
    linkId: 'base-link',
    linkName: 'Base link',
    objectIndex: 0,
    bodyIndex: null,
    geometry: createGeometry(GeometryType.BOX),
    isPrimary: true,
    sequenceIndex: 0,
  };
}

function createCandidate(): CollisionOptimizationCandidate {
  const target = createTarget();
  return {
    target,
    eligible: true,
    currentType: GeometryType.BOX,
    suggestedType: GeometryType.CAPSULE,
    status: 'ready',
    reason: 'rod-box-to-capsule',
    nextGeometry: createGeometry(GeometryType.CAPSULE),
    affectedTargetIds: [target.id],
    autoSelect: true,
  };
}

function formatGeometryType(type: GeometryType | null | undefined): string {
  if (!type) {
    return '-';
  }
  return `${type[0]?.toUpperCase()}${type.slice(1)}`;
}

function findButton(container: Element, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === text,
  );
  assert.ok(button, `button "${text}" should render`);
  return button;
}

function findButtonContaining(container: Element, textFragments: string[]): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    textFragments.every((fragment) => candidate.textContent?.includes(fragment)),
  );
  assert.ok(button, `button containing "${textFragments.join('" and "')}" should render`);
  return button;
}

test('split pane preserves usable panel widths as the dialog narrows', () => {
  assert.deepEqual(getCollisionOptimizationPrimaryWidthRange(820), { min: 200, max: 512 });
  assert.deepEqual(getCollisionOptimizationPrimaryWidthRange(560), { min: 200, max: 252 });
  assert.deepEqual(getCollisionOptimizationPrimaryWidthRange(420), { min: 200, max: 200 });
  assert.equal(shouldStackCollisionOptimizationPanels(720), false);
  assert.equal(shouldStackCollisionOptimizationPanels(719), true);
});

test('split pane stacks panels and removes the splitter at narrow widths', async () => {
  const { container, dom, root } = createComponentRoot();

  try {
    await act(async () => {
      root.render(
        <CollisionOptimizationSplitPane
          dialogWidth={640}
          primary={<div id="candidate-pane">Candidates</div>}
          primaryPanelId="candidate-pane"
          resizeLabel="Resize candidates"
          secondary={<div id="editor-pane">Editor</div>}
          secondaryPanelId="editor-pane"
        />,
      );
    });

    assert.equal(
      container
        .querySelector('[data-collision-optimization-layout]')
        ?.getAttribute('data-collision-optimization-layout'),
      'stacked',
    );
    assert.equal(container.querySelector('[role="separator"]'), null);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('splitter exposes its range and supports keyboard resizing', async () => {
  const { container, dom, root } = createComponentRoot();

  try {
    await act(async () => {
      root.render(
        <CollisionOptimizationSplitPane
          dialogWidth={820}
          primary={<div id="candidate-pane">Candidates</div>}
          primaryPanelId="candidate-pane"
          resizeLabel="Resize candidates"
          secondary={<div id="editor-pane">Editor</div>}
          secondaryPanelId="editor-pane"
        />,
      );
    });

    const splitter = container.querySelector<HTMLElement>('[role="separator"]');
    assert.ok(splitter, 'splitter should render');
    assert.equal(splitter.getAttribute('aria-valuemin'), '200');
    assert.equal(splitter.getAttribute('aria-valuemax'), '512');
    assert.equal(splitter.getAttribute('aria-valuenow'), '430');

    await act(async () => {
      splitter.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Home' }),
      );
    });
    assert.equal(splitter.getAttribute('aria-valuenow'), '200');

    await act(async () => {
      splitter.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }),
      );
    });
    assert.equal(splitter.getAttribute('aria-valuenow'), '216');

    await act(async () => {
      splitter.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'End' }),
      );
    });
    assert.equal(splitter.getAttribute('aria-valuenow'), '512');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('candidate list activates the candidate and selects its collision target', async () => {
  const candidate = createCandidate();
  const candidateKey = `${candidate.target.id}::single`;
  const activated: Array<{
    candidateKey: string;
    candidate: CollisionOptimizationCandidate;
  }> = [];
  const selectedTargets: CollisionTargetRef[] = [];
  const { container, dom, root } = createComponentRoot();

  try {
    await act(async () => {
      root.render(
        <CollisionOptimizationCandidateList
          candidates={[candidate]}
          checkedCandidateKeys={new Set([candidateKey])}
          labels={LIST_LABELS}
          formatGeometryType={formatGeometryType}
          getStatusLabel={() => 'Ready'}
          onActivateCandidate={(nextCandidateKey, nextCandidate) => {
            activated.push({ candidateKey: nextCandidateKey, candidate: nextCandidate });
          }}
          onSelectTarget={(target) => selectedTargets.push(target)}
          onToggleCandidate={() => {}}
        />,
      );
    });

    await act(async () => {
      findButtonContaining(container, ['Base link', 'Robot A']).dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
    });

    assert.deepEqual(activated, [{ candidateKey, candidate }]);
    assert.deepEqual(selectedTargets, [candidate.target]);
    const candidateButton = findButtonContaining(container, ['Base link', 'CAP']);
    assert.equal(candidateButton.textContent?.includes('to'), false);
    assert.equal(candidateButton.getAttribute('aria-label'), 'Base link: Box → Capsule');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('strategy panel exposes target types in supplied order and reports the chosen type', async () => {
  const candidate = createCandidate();
  const candidateKey = `${candidate.target.id}::single`;
  const choices: Array<{
    candidate: CollisionOptimizationCandidate;
    type: GeometryType;
  }> = [];
  const { container, dom, root } = createComponentRoot();

  try {
    await act(async () => {
      root.render(
        <CollisionOptimizationStrategyPanel
          activeCandidate={candidate}
          activeCandidateKey={candidateKey}
          getCandidateOverrideOptions={() => [
            GeometryType.CAPSULE,
            GeometryType.CYLINDER,
            GeometryType.BOX,
          ]}
          getReasonLabel={() => 'Box approximation'}
          getStatusLabel={() => 'Ready'}
          isChecked
          labels={STRATEGY_LABELS}
          onSetCandidateOverride={(nextCandidate, type) => {
            choices.push({ candidate: nextCandidate, type });
          }}
          formatGeometryType={formatGeometryType}
          strategyField={{ label: 'Target type' }}
        />,
      );
    });

    const optionLabels = Array.from(container.querySelectorAll('button'))
      .map((button) => button.textContent?.trim())
      .filter((label) => ['Capsule', 'Cylinder', 'Box'].includes(label ?? ''));
    assert.deepEqual(optionLabels, ['Capsule', 'Cylinder', 'Box']);

    await act(async () => {
      findButton(container, 'Cylinder').dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
      findButton(container, 'Box').dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
    });

    assert.deepEqual(choices, [
      { candidate, type: GeometryType.CYLINDER },
      { candidate, type: GeometryType.BOX },
    ]);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});
