import React from 'react';
import { createPortal } from 'react-dom';
import { Move, MousePointer2, View as ViewIcon, Scan, Ruler, Palette } from 'lucide-react';
import { translations } from '@/shared/i18n';
import { ToolbarToggleGroup, type ToolbarToggleItem } from '@/shared/components/ui';
import { useOverlayHoverBlock } from '@/shared/hooks/useOverlayHoverBlock';
import type { ViewerToolbarProps, ToolMode } from '../types';

const HEADER_DOCK_SLOT_ID = 'viewer-toolbar-dock-slot';
const BOTTOM_DOCK_SLOT_ID = 'viewer-toolbar-bottom-dock';

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  activeMode,
  setMode,
  lang = 'en',
}) => {
  const { activateHoverBlock, deactivateHoverBlock } = useOverlayHoverBlock();
  const t = translations[lang];

  const tools: ToolbarToggleItem<ToolMode>[] = [
    { value: 'view', icon: ViewIcon, label: t.viewMode },
    { value: 'select', icon: MousePointer2, label: t.selectMode },
    { value: 'universal', icon: Move, label: t.transformMode },
    { value: 'paint', icon: Palette, label: t.paintMode },
    { value: 'face', icon: Scan, label: t.faceMode },
    { value: 'measure', icon: Ruler, label: t.measureMode },
  ];

  const headerDockSlot =
    typeof document !== 'undefined' ? document.getElementById(HEADER_DOCK_SLOT_ID) : null;
  const bottomDockSlot =
    typeof document !== 'undefined' ? document.getElementById(BOTTOM_DOCK_SLOT_ID) : null;

  // Wide screens: toolbar docks in the header center (hidden below sm via the
  // dock slot's own className, so this portal renders nothing visible there).
  const headerToolbar = headerDockSlot ? (
    createPortal(
      <ToolbarToggleGroup
        className="urdf-toolbar pointer-events-auto max-w-full border-x border-border-black/35 px-1.5 dark:border-border-black"
        items={tools}
        value={activeMode}
        onValueChange={setMode}
        ariaLabel={t.toolbar}
        compact
        onMouseEnter={activateHoverBlock}
        onMouseLeave={deactivateHoverBlock}
      />,
      headerDockSlot,
    )
  ) : (
    <ToolbarToggleGroup
      className="urdf-toolbar pointer-events-auto max-w-full border-x border-border-black/35 px-1.5 dark:border-border-black"
      items={tools}
      value={activeMode}
      onValueChange={setMode}
      ariaLabel={t.toolbar}
      compact
      onMouseEnter={activateHoverBlock}
      onMouseLeave={deactivateHoverBlock}
    />
  );

  // Narrow screens (phones): a touch-friendly bottom bar. The bottom dock slot
  // is fixed at bottom-0 and sm:hidden, so this portal only shows below sm.
  const bottomToolbar = bottomDockSlot
    ? createPortal(
        <ToolbarToggleGroup
          className="urdf-toolbar pointer-events-auto w-full justify-around border-t border-border-black/35 bg-panel-bg/95 px-2 py-1.5 backdrop-blur dark:border-border-black dark:bg-panel-bg/95"
          items={tools}
          value={activeMode}
          onValueChange={setMode}
          ariaLabel={t.toolbar}
          compact={false}
          style={{
            paddingBottom: 'calc(0.375rem + env(safe-area-inset-bottom))',
            paddingLeft: 'calc(0.5rem + env(safe-area-inset-left))',
            paddingRight: 'calc(0.5rem + env(safe-area-inset-right))',
          }}
        />,
        bottomDockSlot,
      )
    : null;

  return (
    <>
      {headerToolbar}
      {bottomToolbar}
    </>
  );
};
