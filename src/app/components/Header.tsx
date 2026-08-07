/**
 * App Header Component
 * Contains logo, menus, and action buttons
 */
import React from 'react';
import { useUIStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { translations } from '@/shared/i18n';
import { attachContextMenuBlocker } from '@/shared/utils';
import { useActiveHistory } from '../hooks/useActiveHistory';
import { HeaderActions } from './header/HeaderActions';
import { HeaderMenus } from './header/HeaderMenus';
import { useHeaderResponsiveLayout } from './header/useHeaderResponsiveLayout';
import type {
  HeaderAction,
  HeaderMenuKey,
  HeaderViewAvailability,
  HeaderViewConfig,
  ToolboxItem,
} from './header/types';

interface HeaderProps {
  // Import actions
  onImportFile: () => void;
  onImportFolder: () => void;
  onOpenExport: () => void;
  onPrefetchExport: () => void;
  onExportProject: () => void;
  isExportingProject?: boolean;
  // Toolbox items
  toolboxItems: ToolboxItem[];
  // Other actions
  onOpenCodeViewer: () => void;
  onPrefetchCodeViewer: () => void;
  onOpenSettings: () => void;
  onPrefetchSettings: () => void;
  quickAction?: HeaderAction;
  secondaryAction?: HeaderAction;
  // Snapshot
  onSnapshot: () => void;
  onPrefetchSnapshot: () => void;
  // View config
  viewConfig: {
    showOptionsPanel: boolean;
    showJointPanel: boolean;
    showStructureGraph: boolean;
  };
  viewAvailability?: HeaderViewAvailability;
  setViewConfig: React.Dispatch<React.SetStateAction<HeaderViewConfig>>;
}

export function Header({
  onImportFile,
  onImportFolder,
  onOpenExport,
  onPrefetchExport,
  onExportProject,
  isExportingProject = false,
  toolboxItems,
  onOpenCodeViewer,
  onPrefetchCodeViewer,
  onOpenSettings,
  onPrefetchSettings,
  quickAction,
  secondaryAction,
  onSnapshot,
  onPrefetchSnapshot,
  viewConfig,
  viewAvailability = { jointPanel: true },
  setViewConfig,
}: HeaderProps) {
  const headerRef = React.useRef<HTMLElement | null>(null);
  const [activeMenu, setActiveMenu] = React.useState<HeaderMenuKey>(null);

  React.useEffect(() => {
    return attachContextMenuBlocker(headerRef.current);
  }, []);

  const { theme, setTheme, lang, setLang } = useUIStore(
    useShallow((state) => ({
      theme: state.theme,
      setTheme: state.setTheme,
      lang: state.lang,
      setLang: state.setLang,
    })),
  );
  const { undo, redo, canUndo, canRedo } = useActiveHistory();
  const responsiveOptions = React.useMemo(
    () => ({
      hasQuickAction: Boolean(quickAction),
      hasSecondaryAction: Boolean(secondaryAction),
    }),
    [quickAction, secondaryAction],
  );
  const responsive = useHeaderResponsiveLayout(headerRef, responsiveOptions);
  const t = translations[lang];
  React.useEffect(() => {
    if (activeMenu === null) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenu]);

  return (
    <header
      ref={headerRef}
      className="relative z-[200] h-10 border-b shrink-0 select-none bg-panel-bg dark:bg-panel-bg border-border-black grid grid-cols-[auto_1fr] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2.5"
    >
      {/* Left Section - Logo & Menus */}
      <div className="flex items-center gap-1 min-w-0">
        <div className="mr-1 hidden shrink-0 items-center gap-2 border-r border-border-black pr-2.5 min-[400px]:flex">
          <img
            src="/logos/logo.png"
            alt="Logo"
            draggable={false}
            className="h-7 w-7 shrink-0 object-contain"
          />
        </div>

        <HeaderMenus
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          showMenuLabels={responsive.showMenuLabels}
          showSourceInline={responsive.showSourceInline}
          showSourceText={responsive.showSourceText}
          showUndoRedoInline={responsive.showUndoRedoInline}
          t={t}
          viewConfig={viewConfig}
          viewAvailability={viewAvailability}
          setViewConfig={setViewConfig}
          onImportFile={onImportFile}
          onImportFolder={onImportFolder}
          onOpenExport={onOpenExport}
          onPrefetchExport={onPrefetchExport}
          onExportProject={onExportProject}
          isExportingProject={isExportingProject}
          toolboxItems={toolboxItems}
          onOpenCodeViewer={onOpenCodeViewer}
          onPrefetchCodeViewer={onPrefetchCodeViewer}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      </div>

      <div
        id="viewer-toolbar-dock-slot"
        className="pointer-events-none hidden h-full min-w-0 items-center justify-center justify-self-center px-2 sm:flex sm:px-3"
      />

      <HeaderActions
        responsive={responsive}
        lang={lang}
        theme={theme}
        canUndo={canUndo}
        canRedo={canRedo}
        activeMenu={activeMenu}
        setActiveMenu={setActiveMenu}
        setLang={setLang}
        setTheme={setTheme}
        undo={undo}
        redo={redo}
        quickAction={quickAction}
        secondaryAction={secondaryAction}
        onOpenCodeViewer={onOpenCodeViewer}
        onPrefetchCodeViewer={onPrefetchCodeViewer}
        onSnapshot={onSnapshot}
        onPrefetchSnapshot={onPrefetchSnapshot}
        onOpenSettings={onOpenSettings}
        onPrefetchSettings={onPrefetchSettings}
        t={t}
      />
    </header>
  );
}

export default Header;
