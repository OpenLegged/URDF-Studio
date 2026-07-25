import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Move, MousePointer2, View as ViewIcon, Scan, Ruler, Palette } from 'lucide-react';
import { translations } from '@/shared/i18n';
import { IconButton } from '@/shared/components/ui';
import { useOverlayHoverBlock } from '@/shared/hooks/useOverlayHoverBlock';
import type { ViewerToolbarProps, ToolMode } from '../types';

const HEADER_DOCK_SLOT_ID = 'viewer-toolbar-dock-slot';
const BOTTOM_DOCK_SLOT_ID = 'viewer-toolbar-bottom-dock';

interface ViewerTool {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

interface ToolbarClusterProps {
  tools: ViewerTool[];
  activeMode: string;
  setMode: (mode: ToolMode) => void;
  /** Compact = header toolbar sizing; false = touch-friendly bottom bar sizing. */
  compact: boolean;
}

function ToolbarCluster({
  tools,
  activeMode,
  setMode,
  compact,
}: ToolbarClusterProps) {
  const buttonClassName = compact
    ? 'h-7 w-7 rounded-md'
    : 'h-10 w-12 min-w-12 snap-center rounded-full transition-[background-color,box-shadow,color] duration-200';
  const iconClassName = compact ? 'h-4 w-4' : 'h-5 w-5';

  return (
    <>
      {tools.map((tool) => {
        const isActive = activeMode === tool.id;
        const Icon = tool.icon;
        return (
          <IconButton
            key={tool.id}
            variant="toolbar"
            size="sm"
            isActive={isActive}
            aria-label={tool.label}
            title={tool.label}
            data-viewer-tool={tool.id}
            className={buttonClassName}
            onClick={() => {
              setMode(tool.id as ToolMode);
            }}
          >
            <Icon className={iconClassName} />
          </IconButton>
        );
      })}
    </>
  );
}

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  activeMode,
  setMode,
  lang = 'en',
}) => {
  const { activateHoverBlock, deactivateHoverBlock } = useOverlayHoverBlock();
  const t = translations[lang];
  const bottomToolbarRef = useRef<HTMLDivElement>(null);

  const tools: ViewerTool[] = [
    { id: 'view', icon: ViewIcon, label: t.viewMode },
    { id: 'select', icon: MousePointer2, label: t.selectMode },
    { id: 'universal', icon: Move, label: t.transformMode },
    { id: 'paint', icon: Palette, label: t.paintMode },
    { id: 'face', icon: Scan, label: t.faceMode },
    { id: 'measure', icon: Ruler, label: t.measureMode },
  ];

  const headerDockSlot =
    typeof document !== 'undefined' ? document.getElementById(HEADER_DOCK_SLOT_ID) : null;
  const bottomDockSlot =
    typeof document !== 'undefined' ? document.getElementById(BOTTOM_DOCK_SLOT_ID) : null;

  useEffect(() => {
    const activeButton = bottomToolbarRef.current?.querySelector<HTMLElement>(
      `[data-viewer-tool="${activeMode}"]`,
    );
    if (activeButton && typeof activeButton.scrollIntoView === 'function') {
      activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeMode]);

  // Wide screens: toolbar docks in the header center (hidden below sm via the
  // dock slot's own className, so this portal renders nothing visible there).
  const headerToolbar = headerDockSlot ? (
    createPortal(
      <div
        className="urdf-toolbar pointer-events-auto flex max-w-full items-center gap-0.5 border-x border-border-black/35 px-1.5 dark:border-border-black"
        onMouseEnter={activateHoverBlock}
        onMouseLeave={deactivateHoverBlock}
      >
        <ToolbarCluster
          tools={tools}
          activeMode={activeMode}
          setMode={setMode}
          compact
        />
      </div>,
      headerDockSlot,
    )
  ) : (
    <div
      className="urdf-toolbar pointer-events-auto flex max-w-full items-center gap-0.5 border-x border-border-black/35 px-1.5 dark:border-border-black"
      onMouseEnter={activateHoverBlock}
      onMouseLeave={deactivateHoverBlock}
    >
      <ToolbarCluster
        tools={tools}
        activeMode={activeMode}
        setMode={setMode}
        compact
      />
    </div>
  );

  // Narrow screens (phones): a touch-friendly bottom bar. The bottom dock slot
  // is fixed at bottom-0 and sm:hidden, so this portal only shows below sm.
  const bottomToolbar = bottomDockSlot
    ? createPortal(
        <div
          className="urdf-toolbar pointer-events-auto relative flex w-full justify-center bg-transparent"
          style={{
            paddingBottom: 'calc(0.375rem + env(safe-area-inset-bottom))',
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          }}
        >
          <div className="urdf-toolbar-track my-1.5 w-max max-w-[calc(100vw-1rem)] overflow-hidden rounded-full border border-border-black/35 bg-panel-bg/25 p-1 shadow-lg backdrop-blur-[2px] dark:bg-panel-bg/25">
            <div
              ref={bottomToolbarRef}
              className="urdf-toolbar-scroll flex min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain [touch-action:pan-x]"
              role="toolbar"
              aria-label="Viewer tools"
            >
              <div className="flex w-max min-w-full shrink-0 items-center justify-center gap-0.5">
                <ToolbarCluster
                  tools={tools}
                  activeMode={activeMode}
                  setMode={setMode}
                  compact={false}
                />
              </div>
            </div>
          </div>
        </div>,
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
