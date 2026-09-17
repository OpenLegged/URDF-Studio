import React, { type ComponentProps } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { FilePreviewWindow } from '../FilePreviewWindow';
import type { PropertyEditorProps } from '@/features/property-editor/property_editor';
import { TreeEditor } from '@/features/robot-tree';
import { usePointerResize } from '@/shared/hooks/usePointerResize';
import { translations } from '@/shared/i18n';
import { useUIStore } from '@/store/uiStore';

const PROPERTY_EDITOR_MIN_WIDTH = 220;
const PROPERTY_EDITOR_MAX_WIDTH = 420;

const LazyPropertyEditor = React.lazy(async () => ({
  default: (await import('@/features/property-editor/property_editor')).PropertyEditor,
}));

interface WorkspaceSidebarsProps {
  leftSidebarClassName: string;
  rightSidebarClassName: string;
  treeEditorProps: ComponentProps<typeof TreeEditor>;
  filePreviewWindowProps: ComponentProps<typeof FilePreviewWindow>;
  propertyEditorProps: PropertyEditorProps;
}

function applyPropertyEditorWidth(node: HTMLDivElement | null, width: number) {
  if (!node) return;

  const widthPx = `${Math.round(width)}px`;
  node.style.width = widthPx;
  node.style.minWidth = widthPx;
  node.style.flex = `0 0 ${widthPx}`;
}

function EmptyPropertyEditor({
  lang,
  collapsed,
  onToggle,
  readOnlyMessage,
  readOnlyBadge,
}: Pick<
  PropertyEditorProps,
  'lang' | 'collapsed' | 'onToggle' | 'readOnlyMessage' | 'readOnlyBadge'
>) {
  const t = translations[lang];
  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const committedWidth = useUIStore((state) => state.panelLayout.propertyEditorWidth);
  const setPanelLayout = useUIStore((state) => state.setPanelLayout);
  const [dragWidth, setDragWidth] = React.useState<number | null>(null);
  const resize = usePointerResize({
    axis: 'x',
    cursor: 'col-resize',
    direction: -1,
    min: PROPERTY_EDITOR_MIN_WIDTH,
    max: PROPERTY_EDITOR_MAX_WIDTH,
    value: committedWidth,
    onChange: (nextWidth) => {
      applyPropertyEditorWidth(sidebarRef.current, nextWidth);
      setDragWidth(nextWidth);
    },
    onCommit: (nextWidth) => {
      setPanelLayout('propertyEditorWidth', nextWidth);
      setDragWidth(null);
    },
  });
  const width = dragWidth ?? committedWidth;
  const isReadOnly = Boolean(readOnlyMessage);

  return (
    <div
      ref={sidebarRef}
      data-testid="property-editor-sidebar"
      className={`bg-element-bg dark:bg-panel-bg border-l border-border-black flex flex-col h-full z-20 relative will-change-transform ${collapsed ? 'translate-x-full pointer-events-auto' : 'translate-x-0 pointer-events-auto'} ${resize.isDragging ? '' : 'transition-transform duration-200 ease-out motion-reduce:transition-none'}`}
      style={{
        width: `${width}px`,
        minWidth: `${width}px`,
        flex: `0 0 ${width}px`,
        contain: 'layout style',
      }}
    >
      <button
        onClick={(event) => {
          event.stopPropagation();
          onToggle?.();
        }}
        className="pointer-events-auto absolute -left-4 top-1/2 -translate-y-1/2 w-4 h-16 bg-panel-bg hover:bg-system-blue-solid hover:text-white border border-border-strong rounded-l-lg shadow-md flex flex-col items-center justify-center z-50 cursor-pointer text-text-tertiary transition-colors group"
        title={collapsed ? t.properties : t.collapseSidebar}
      >
        <div className="flex flex-col gap-0.5 items-center">
          <div className="w-1 h-1 rounded-full bg-text-tertiary/40 group-hover:bg-white/80" />
          {collapsed ? (
            <ChevronLeft className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <div className="w-1 h-1 rounded-full bg-text-tertiary/40 group-hover:bg-white/80" />
        </div>
      </button>

      <div
        data-testid="property-editor-sidebar-content"
        className="h-full w-full flex flex-col overflow-hidden"
        aria-hidden={collapsed ? true : undefined}
        inert={collapsed ? true : undefined}
      >
        <div
          style={{ width: `${width}px` }}
          className="h-full flex flex-col bg-element-bg dark:bg-panel-bg"
        >
          <div className="w-full flex h-8 items-center justify-between px-2 border-b border-border-black bg-panel-bg shrink-0 relative z-30">
            <span className="ui-static-copy-guard text-[11px] font-semibold tracking-[0.02em] text-text-tertiary">
              {t.properties}
            </span>
            {isReadOnly ? (
              <span className="ui-static-copy-guard ml-1.5 rounded-md border border-system-blue/20 bg-system-blue/10 px-1.5 py-px text-[9px] font-semibold tracking-[0.02em] text-system-blue">
                {readOnlyBadge ?? t.preview}
              </span>
            ) : null}
          </div>

          <div className="w-full flex-1 flex items-center justify-center p-8 text-text-tertiary text-center">
            <p className="ui-static-copy-guard text-xs italic leading-5">
              {readOnlyMessage ?? t.selectLinkJointOrTendon}
            </p>
          </div>
        </div>
      </div>

      {!collapsed ? (
        <button
          type="button"
          data-testid="property-editor-sidebar-resize-handle"
          aria-label={t.resize}
          className="group absolute left-0 top-0 bottom-0 z-40 w-2 cursor-col-resize border-0 bg-transparent p-0"
          onMouseDown={resize.handleResizeStart}
        >
          <span
            data-testid="property-editor-sidebar-resize-rail"
            className="pointer-events-none absolute left-0 top-0 bottom-0 w-px bg-transparent transition-colors group-hover:bg-system-blue/50 group-active:bg-system-blue/60"
          />
        </button>
      ) : null}
    </div>
  );
}

export function WorkspaceSidebars({
  leftSidebarClassName,
  rightSidebarClassName,
  treeEditorProps,
  filePreviewWindowProps,
  propertyEditorProps,
}: WorkspaceSidebarsProps) {
  return (
    <>
      <div className={leftSidebarClassName}>
        <TreeEditor {...treeEditorProps} />
      </div>

      <FilePreviewWindow {...filePreviewWindowProps} />

      <div className={rightSidebarClassName}>
        {propertyEditorProps.selection?.entity ? (
          <React.Suspense fallback={<EmptyPropertyEditor {...propertyEditorProps} />}>
            <LazyPropertyEditor {...propertyEditorProps} />
          </React.Suspense>
        ) : (
          <EmptyPropertyEditor {...propertyEditorProps} />
        )}
      </div>
    </>
  );
}
