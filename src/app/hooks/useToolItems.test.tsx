import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { translations } from '@/shared/i18n';
import { isIkDragToolEnabled } from '@/shared/utils/ikDragFeatureGate';
import { useToolItems } from './useToolItems.tsx';

interface RenderHookOverrides {
  openIkTool?: () => void;
  extensionItems?: Parameters<typeof useToolItems>[0]['extensionItems'];
  prefetchAIInspection?: () => void;
  prefetchAIConversation?: () => void;
  prefetchCollisionOptimizer?: () => void;
}

function renderHook(overrides?: RenderHookOverrides) {
  let hookValue: ReturnType<typeof useToolItems> | null = null as ReturnType<typeof useToolItems> | null;

  function Probe() {
    hookValue = useToolItems({
      t: translations.en,
      openAIInspection: () => {},
      prefetchAIInspection: overrides?.prefetchAIInspection ?? (() => {}),
      openAIConversation: () => {},
      prefetchAIConversation: overrides?.prefetchAIConversation ?? (() => {}),
      openIkTool: overrides?.openIkTool ?? (() => {}),
      openCollisionOptimizer: () => {},
      extensionItems: overrides?.extensionItems,
      prefetchCollisionOptimizer: overrides?.prefetchCollisionOptimizer ?? (() => {}),
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

test('useToolItems attaches intent prefetch handlers only to lazy local tools', () => {
  const prefetchCounts = {
    aiInspection: 0,
    aiConversation: 0,
    collisionOptimizer: 0,
  };
  const { items } = renderHook({
    prefetchAIInspection: () => {
      prefetchCounts.aiInspection += 1;
    },
    prefetchAIConversation: () => {
      prefetchCounts.aiConversation += 1;
    },
    prefetchCollisionOptimizer: () => {
      prefetchCounts.collisionOptimizer += 1;
    },
  });

  items.find((item) => item.key === 'ai-inspection')?.onPrefetch?.();
  items.find((item) => item.key === 'ai-conversation')?.onPrefetch?.();
  items.find((item) => item.key === 'collision-optimizer')?.onPrefetch?.();

  assert.deepEqual(prefetchCounts, {
    aiInspection: 1,
    aiConversation: 1,
    collisionOptimizer: 1,
  });
  assert.equal(items.find((item) => item.key === 'motion-tracking')?.onPrefetch, undefined);
});
