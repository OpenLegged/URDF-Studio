import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { translations } from '@/shared/i18n';
import { isIkDragToolEnabled } from '@/shared/utils/ikDragFeatureGate';
import { useToolItems } from './useToolItems.tsx';

function renderHook(overrides?: {
  openIkTool?: () => void;
  extensionItems?: Parameters<typeof useToolItems>[0]['extensionItems'];
}) {
  let hookValue: ReturnType<typeof useToolItems> | null = null as ReturnType<typeof useToolItems> | null;

  function Probe() {
    hookValue = useToolItems({
      t: translations.en,
      openAIInspection: () => {},
      openAIConversation: () => {},
      openIkTool: overrides?.openIkTool ?? (() => {}),
      openCollisionOptimizer: () => {},
      extensionItems: overrides?.extensionItems,
    });
    return null;
  }

  renderToStaticMarkup(<Probe />);
  assert.ok(hookValue, 'hook should render');
  return hookValue as ReturnType<typeof useToolItems>;
}

test('useToolItems hides the unfinished IK drag tool entry', () => {
  let openedIkTool = false;
  const { items, openTool } = renderHook({
    openIkTool: () => {
      openedIkTool = true;
    },
  });

  assert.equal(isIkDragToolEnabled(), false);
  assert.equal(
    items.some((item) => item.key === 'ik-tool'),
    false,
  );

  openTool('ik-tool');
  assert.equal(openedIkTool, false);
});

test('useToolItems appends host tools and makes them addressable by key', () => {
  let opened = false;
  const { items, openTool } = renderHook({
    extensionItems: [
      {
        key: 'host-scene-tool',
        title: 'Scene tool',
        description: 'Open the host scene tool',
        icon: null,
        onClick: () => {
          opened = true;
        },
      },
    ],
  });

  assert.equal(items.at(-1)?.key, 'host-scene-tool');
  openTool('host-scene-tool');
  assert.equal(opened, true);
});

test('useToolItems rejects host keys that collide with built-in tools', () => {
  assert.throws(
    () =>
      renderHook({
        extensionItems: [
          {
            key: 'collision-optimizer',
            title: 'Conflicting tool',
            description: 'Must not replace a built-in handler',
            icon: null,
            onClick: () => {},
          },
        ],
      }),
    /Duplicate toolbox item key: collision-optimizer/,
  );
});
