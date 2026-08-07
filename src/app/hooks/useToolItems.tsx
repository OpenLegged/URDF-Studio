import React, { useCallback, useMemo } from 'react';
import { Activity, Box, Crosshair, MessageSquare, RefreshCw, ScanSearch } from 'lucide-react';
import type { TranslationKeys } from '@/shared/i18n/types';
import { useEffectiveTheme } from '@/shared/hooks/useEffectiveTheme';
import { isIkDragToolEnabled } from '@/shared/utils/ikDragFeatureGate';
import type { ToolboxItem } from '../components/header/types';

interface UseToolItemsParams {
  t: TranslationKeys;
  openAIInspection: () => void;
  prefetchAIInspection: () => void;
  openAIConversation: () => void;
  prefetchAIConversation: () => void;
  openIkTool: () => void;
  openCollisionOptimizer: () => void;
  prefetchCollisionOptimizer: () => void;
}

interface UseToolItemsReturn {
  items: ToolboxItem[];
  openTool: (key: string) => void;
}

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

export function useToolItems(params: UseToolItemsParams): UseToolItemsReturn {
  const {
    t,
    openAIInspection,
    prefetchAIInspection,
    openAIConversation,
    prefetchAIConversation,
    openIkTool,
    openCollisionOptimizer,
    prefetchCollisionOptimizer,
  } = params;
  const effectiveTheme = useEffectiveTheme();
  const motrixLogoSrc =
    effectiveTheme === 'dark' ? '/logos/motrix-logo-white.svg' : '/logos/motrix-logo.svg';

  const items: ToolboxItem[] = useMemo(
    () => [
      {
        key: 'ai-inspection',
        title: t.aiInspection,
        description: t.aiInspectionDesc,
        icon: <ScanSearch className="h-[18px] w-[18px]" />,
        onClick: openAIInspection,
        onPrefetch: prefetchAIInspection,
        tone: 'primary',
      },
      {
        key: 'ai-conversation',
        title: t.aiConversation,
        description: t.aiConversationDesc,
        icon: <MessageSquare className="h-[18px] w-[18px]" />,
        onClick: openAIConversation,
        onPrefetch: prefetchAIConversation,
        tone: 'primary',
      },
      ...(isIkDragToolEnabled()
        ? [
            {
              key: 'ik-tool',
              title: t.ikTool,
              description: t.ikToolboxDesc,
              icon: <Crosshair className="h-[18px] w-[18px]" />,
              onClick: openIkTool,
              tone: 'primary' as const,
            },
          ]
        : []),
      {
        key: 'collision-optimizer',
        title: t.collisionOptimizerDialog,
        description: t.collisionOptimizerToolboxDesc,
        icon: <Box className="h-[18px] w-[18px]" />,
        onClick: openCollisionOptimizer,
        onPrefetch: prefetchCollisionOptimizer,
        tone: 'primary',
      },
      {
        key: 'motion-tracking',
        title: t.robotRedirect,
        description: t.motionTrackingDesc,
        icon: <RefreshCw className="h-[18px] w-[18px]" />,
        onClick: () => openExternal('https://motion-tracking.axell.top/'),
        external: true,
        tone: 'neutral',
      },
      {
        key: 'step2urdf',
        title: t.step2urdf,
        description: t.step2urdfDesc,
        icon: <img src="/logos/step2urdf-logo.png" alt="" className="h-5 w-5 object-contain" />,
        onClick: () => openExternal('https://step2urdf.top/'),
        external: true,
        tone: 'logo',
      },
      {
        key: 'robogo',
        title: t.robogo,
        description: t.robogoDesc,
        icon: (
          <img
            src="/logos/d-robotics-logo.jpg"
            alt=""
            className="h-5 w-5 rounded-[0.5rem] object-contain"
          />
        ),
        onClick: () => openExternal('https://robogo.d-robotics.cc/'),
        external: true,
        tone: 'logo',
      },
      {
        key: 'motrix',
        title: t.motrix,
        description: t.motrixDesc,
        icon: <img src={motrixLogoSrc} alt="" className="h-5 w-5 object-contain" />,
        onClick: () => openExternal('https://motrix.motphys.com/'),
        external: true,
        tone: 'logo',
      },
      {
        key: 'trajectory-editing',
        title: t.trajectoryEditing,
        description: t.trajectoryEditingDesc,
        icon: <Activity className="h-[18px] w-[18px]" />,
        onClick: () => openExternal('https://motion-editor.cyoahs.dev/'),
        external: true,
        tone: 'neutral',
      },
      {
        key: 'bridgedp',
        title: t.bridgedpEngine,
        description: t.bridgedpEngineDesc,
        icon: <img src="/logos/bridgedp-logo.png" alt="" className="h-5 w-5 object-contain" />,
        onClick: () => openExternal('https://engine.bridgedp.com/'),
        external: true,
        tone: 'logo',
      },
    ],
    [
      t,
      openAIInspection,
      prefetchAIInspection,
      openAIConversation,
      prefetchAIConversation,
      openIkTool,
      openCollisionOptimizer,
      prefetchCollisionOptimizer,
      motrixLogoSrc,
    ],
  );

  const registry = useMemo(() => {
    const map = new Map<string, () => void>();
    for (const item of items) {
      map.set(item.key, item.onClick);
    }
    return map;
  }, [items]);

  const openTool = useCallback(
    (key: string) => {
      registry.get(key)?.();
    },
    [registry],
  );

  return { items, openTool };
}
