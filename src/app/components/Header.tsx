/**
 * App Header Component
 * Contains logo, menus, mode switcher, and action buttons
 */
import React from 'react';
import {
  Download,
  Activity,
  Box,
  Cpu,
  Upload,
  Check,
  Globe,
  ScanSearch,
  Info,
  ChevronDown,
  FileText,
  RefreshCw,
  Sun,
  Moon,
  Briefcase,
  Undo,
  Redo,
  Code,
  Settings,
  Camera,
  Eye,
  MoreHorizontal,
  Folder,
  LayoutGrid,
} from 'lucide-react';
import { useUIStore, useCanUndo, useCanRedo, useRobotStore } from '@/store';
import { translations } from '@/shared/i18n';
import type { AppMode } from '@/types';

interface HeaderProps {
  // Import actions
  onImportFile: () => void;
  onImportFolder: () => void;
  onExport: () => void;
  // Modal actions
  onOpenAI: () => void;
  onOpenCodeViewer: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onOpenURDFSquare: () => void;
  // Snapshot
  onSnapshot: () => void;
  // View config
  viewConfig: {
    showToolbar: boolean;
    showOptionsPanel: boolean;
    showSkeletonOptionsPanel: boolean;
    showJointPanel: boolean;
  };
  setViewConfig: React.Dispatch<React.SetStateAction<{
    showToolbar: boolean;
    showOptionsPanel: boolean;
    showSkeletonOptionsPanel: boolean;
    showJointPanel: boolean;
  }>>;
}

export function Header({
  onImportFile,
  onImportFolder,
  onExport,
  onOpenAI,
  onOpenCodeViewer,
  onOpenSettings,
  onOpenAbout,
  onOpenURDFSquare,
  onSnapshot,
  viewConfig,
  setViewConfig,
}: HeaderProps) {
  // Store state
  const appMode = useUIStore((state) => state.appMode);
  const setAppMode = useUIStore((state) => state.setAppMode);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const lang = useUIStore((state) => state.lang);
  const setLang = useUIStore((state) => state.setLang);
  const activeMenu = useUIStore((state) => state.activeMenu);
  const setActiveMenu = useUIStore((state) => state.setActiveMenu);

  // Robot store
  const undo = useRobotStore((state) => state.undo);
  const redo = useRobotStore((state) => state.redo);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  const t = translations[lang];

  return (
    <header className="h-12 border-b flex items-center px-3 shrink-0 relative bg-white dark:bg-panel-bg border-slate-200 dark:border-border-black">
      {/* Left Section - Logo & Menus */}
      <div className="flex items-center gap-1 shrink-0 flex-1 min-w-0">
        {/* Logo */}
        <div className="flex items-center gap-2 pr-3 mr-1 border-r border-slate-200 dark:border-border-black">
          <img src="/logos/logo.png" alt="Logo" className="w-7 h-7 object-contain" />
        </div>

        {/* Menu Buttons */}
        <div className="flex items-center">
          {/* File Menu */}
          <div className="relative">
            <button
              onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeMenu === 'file'
                  ? 'bg-slate-100 dark:bg-element-active text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t.file}</span>
              <ChevronDown className={`w-3 h-3 opacity-60 transition-transform hidden md:inline ${activeMenu === 'file' ? 'rotate-180' : ''}`} />
            </button>

            {activeMenu === 'file' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
                <div className="absolute top-full left-0 mt-1 w-52 bg-white dark:bg-panel-bg rounded-lg shadow-md dark:shadow-xl border border-slate-200 dark:border-border-black z-50 overflow-hidden py-1">
                  <button
                    onClick={() => { setActiveMenu(null); setTimeout(onImportFolder, 0); }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-2.5"
                  >
                    <Folder className="w-4 h-4 text-slate-400" />
                    {t.importFolder}
                  </button>
                  <button
                    onClick={() => { setActiveMenu(null); setTimeout(onImportFile, 0); }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-2.5"
                  >
                    <Download className="w-4 h-4 text-slate-400" />
                    {lang === 'zh' ? '导入 ZIP / 文件' : 'Import ZIP / File'}
                  </button>
                  <div className="h-px bg-slate-100 dark:bg-border-black my-1" />
                  <button
                    onClick={() => { setActiveMenu(null); onExport(); }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-2.5"
                  >
                    <Upload className="w-4 h-4 text-slate-400" />
                    {t.export}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Toolbox Menu */}
          <div className="relative">
            <button
              onClick={() => setActiveMenu(activeMenu === 'toolbox' ? null : 'toolbox')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeMenu === 'toolbox'
                  ? 'bg-system-blue text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t.toolbox}</span>
              <ChevronDown className={`w-3 h-3 opacity-60 transition-transform hidden md:inline ${activeMenu === 'toolbox' ? 'rotate-180' : ''}`} />
            </button>

            {activeMenu === 'toolbox' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
                <div className="absolute top-full left-0 mt-1 w-[280px] bg-white dark:bg-panel-bg rounded-lg shadow-md dark:shadow-xl border border-slate-200 dark:border-border-black z-50 p-2">
                  <div className="space-y-1">
                    <button
                      onClick={() => { setActiveMenu(null); onOpenAI(); }}
                      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-system-blue/10 transition-all group"
                    >
                      <div className="w-9 h-9 flex items-center justify-center bg-blue-50 dark:bg-system-blue/10 rounded-lg text-system-blue shrink-0">
                        <ScanSearch className="w-5 h-5" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.aiAssistant}</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">{t.aiAssistantDesc}</div>
                      </div>
                    </button>

                    <button
                      onClick={() => { setActiveMenu(null); window.open('https://motion-tracking.axell.top/', '_blank'); }}
                      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-system-blue/10 transition-all group"
                    >
                      <div className="w-9 h-9 flex items-center justify-center bg-blue-50 dark:bg-system-blue/10 rounded-lg text-system-blue shrink-0">
                        <RefreshCw className="w-5 h-5" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.robotRedirect}</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">{t.motionTrackingDesc}</div>
                      </div>
                    </button>

                    <button
                      onClick={() => { setActiveMenu(null); window.open('https://motion-editor.cyoahs.dev/', '_blank'); }}
                      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-system-blue/10 transition-all group"
                    >
                      <div className="w-9 h-9 flex items-center justify-center bg-blue-50 dark:bg-system-blue/10 rounded-lg text-system-blue shrink-0">
                        <Activity className="w-5 h-5" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.trajectoryEditing}</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">{t.trajectoryEditingDesc}</div>
                      </div>
                    </button>

                    <button
                      onClick={() => { setActiveMenu(null); window.open('https://engine.bridgedp.com/', '_blank'); }}
                      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-system-blue/10 transition-all group"
                    >
                      <div className="w-9 h-9 rounded-lg overflow-hidden border border-slate-200 dark:border-border-black bg-white dark:bg-system-blue/10 p-1.5 shrink-0">
                        <img src="/logos/bridgedp-logo.png" alt="BridgeDP" className="w-full h-full object-contain" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.bridgedpEngine}</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">{t.bridgedpEngineDesc}</div>
                      </div>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* View Menu */}
          <div className="relative">
            <button
              onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeMenu === 'view'
                  ? 'bg-system-blue text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{lang === 'zh' ? '视图' : 'View'}</span>
              <ChevronDown className={`w-3 h-3 opacity-60 transition-transform hidden md:inline ${activeMenu === 'view' ? 'rotate-180' : ''}`} />
            </button>

            {activeMenu === 'view' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
                <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-panel-bg rounded-lg shadow-md dark:shadow-xl border border-slate-200 dark:border-border-black z-50 overflow-hidden py-1">
                  <ViewMenuItem
                    checked={viewConfig.showToolbar}
                    label={lang === 'zh' ? '工具栏' : 'Toolbar'}
                    onClick={() => setViewConfig(prev => ({ ...prev, showToolbar: !prev.showToolbar }))}
                  />
                  <ViewMenuItem
                    checked={viewConfig.showOptionsPanel}
                    label={lang === 'zh' ? '细节选项' : 'Detail Options'}
                    onClick={() => setViewConfig(prev => ({ ...prev, showOptionsPanel: !prev.showOptionsPanel }))}
                  />
                  <ViewMenuItem
                    checked={viewConfig.showSkeletonOptionsPanel}
                    label={lang === 'zh' ? '骨架/硬件选项' : 'Skeleton/Hardware Options'}
                    onClick={() => setViewConfig(prev => ({ ...prev, showSkeletonOptionsPanel: !prev.showSkeletonOptionsPanel }))}
                  />
                  <ViewMenuItem
                    checked={viewConfig.showJointPanel}
                    label={lang === 'zh' ? '关节控制' : 'Joint Controls'}
                    onClick={() => setViewConfig(prev => ({ ...prev, showJointPanel: !prev.showJointPanel }))}
                  />
                </div>
              </>
            )}
          </div>

          <div className="w-px h-5 bg-slate-200 dark:bg-border-black mx-1.5 hidden md:block" />

          {/* Source Code Button */}
          <div className="relative hidden md:block">
            <button
              onClick={onOpenCodeViewer}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-900 dark:hover:text-white"
            >
              <Code className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">{lang === 'zh' ? '源代码' : 'Source Code'}</span>
            </button>
          </div>

          <div className="w-px h-5 bg-slate-200 dark:bg-border-black mx-1.5 hidden md:block" />

          {/* Undo/Redo */}
          <div className="items-center gap-0.5 hidden md:flex">
            <button
              onClick={undo}
              disabled={!canUndo}
              className={`p-1.5 rounded-md transition-all ${
                !canUndo
                  ? 'text-slate-300 dark:text-element-hover cursor-not-allowed'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-900 dark:hover:text-white'
              }`}
              title={lang === 'zh' ? '撤销 (Ctrl+Z)' : 'Undo (Ctrl+Z)'}
            >
              <Undo className="w-4 h-4" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className={`p-1.5 rounded-md transition-all ${
                !canRedo
                  ? 'text-slate-300 dark:text-element-hover cursor-not-allowed'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-900 dark:hover:text-white'
              }`}
              title={lang === 'zh' ? '重做 (Ctrl+Shift+Z)' : 'Redo (Ctrl+Shift+Z)'}
            >
              <Redo className="w-4 h-4" />
            </button>
          </div>

          {/* Mode Switcher - Inline on small screens */}
          <div className="flex items-center ml-2 lg:hidden">
            <ModeSwitcher appMode={appMode} setAppMode={setAppMode} t={t} compact />
          </div>
        </div>
      </div>

      {/* Center - Mode Switcher - Large screens only */}
      <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
        <ModeSwitcher appMode={appMode} setAppMode={setAppMode} t={t} />
      </div>

      {/* Right Section - Actions */}
      <div className="flex items-center gap-0.5 shrink-0 ml-auto">
        <button
          onClick={onOpenURDFSquare}
          className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-system-blue dark:text-slate-300 hover:bg-system-blue hover:text-white dark:hover:bg-element-bg transition-all hidden sm:flex"
          title={t.urdfSquare}
        >
          <LayoutGrid className="w-4 h-4" />
          <span className="hidden lg:inline">{t.square}</span>
        </button>

        <button
          onClick={onSnapshot}
          className="flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-slate-200 transition-all hidden sm:flex"
          title={lang === 'zh' ? '快照' : 'Snapshot'}
        >
          <Camera className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenSettings}
          className="flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-slate-200 transition-all hidden sm:flex"
          title={lang === 'zh' ? '设置' : 'Settings'}
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
          className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-slate-200 transition-all hidden sm:flex"
          title={lang === 'zh' ? '切换语言' : 'Switch Language'}
        >
          <Globe className="w-3.5 h-3.5" />
          <span className="text-[10px] font-semibold">{lang === 'en' ? 'EN' : '中'}</span>
        </button>

        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-slate-200 transition-all hidden sm:flex"
          title={lang === 'zh' ? '切换主题' : 'Toggle Theme'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="w-px h-5 bg-slate-200 dark:bg-border-black mx-1 hidden sm:block" />

        <button
          onClick={onOpenAbout}
          className="flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-slate-200 transition-all hidden sm:flex"
          title={lang === 'zh' ? '关于' : 'About'}
        >
          <Info className="w-4 h-4" />
        </button>

        {/* Mobile/Tablet "More" Menu */}
        <MobileMoreMenu
          lang={lang}
          theme={theme}
          appMode={appMode}
          canUndo={canUndo}
          canRedo={canRedo}
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          setAppMode={setAppMode}
          setLang={setLang}
          setTheme={setTheme}
          undo={undo}
          redo={redo}
          onOpenCodeViewer={onOpenCodeViewer}
          onSnapshot={onSnapshot}
          onOpenSettings={onOpenSettings}
          onOpenAbout={onOpenAbout}
          t={t}
        />
      </div>
    </header>
  );
}

// Helper component for view menu items
function ViewMenuItem({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center justify-between group"
    >
      <div className="flex items-center gap-2">
        <div className={`w-4 h-4 flex items-center justify-center rounded border ${
          checked
            ? 'bg-system-blue border-system-blue text-white'
            : 'border-slate-300 dark:border-slate-600'
        }`}>
          {checked && <Check className="w-3 h-3" />}
        </div>
        <span>{label}</span>
      </div>
    </button>
  );
}

// Mode Switcher component
function ModeSwitcher({
  appMode,
  setAppMode,
  t,
  compact = false,
}: {
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
  t: typeof translations['en'];
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex items-center bg-slate-100 dark:bg-app-bg rounded-lg p-0.5">
        <ModeButton mode="skeleton" current={appMode} setMode={setAppMode} icon={<Activity className="w-3.5 h-3.5" />} title={t.skeleton} />
        <ModeButton mode="detail" current={appMode} setMode={setAppMode} icon={<Box className="w-3.5 h-3.5" />} title={t.detail} />
        <ModeButton mode="hardware" current={appMode} setMode={setAppMode} icon={<Cpu className="w-3.5 h-3.5" />} title={t.hardware} />
      </div>
    );
  }

  return (
    <div className="flex items-center bg-slate-100 dark:bg-app-bg rounded-lg p-0.5 pointer-events-auto border border-slate-200 dark:border-border-black">
      <ModeButton mode="skeleton" current={appMode} setMode={setAppMode} icon={<Activity className="w-3.5 h-3.5" />} label={t.skeleton} />
      <ModeButton mode="detail" current={appMode} setMode={setAppMode} icon={<Box className="w-3.5 h-3.5" />} label={t.detail} />
      <ModeButton mode="hardware" current={appMode} setMode={setAppMode} icon={<Cpu className="w-3.5 h-3.5" />} label={t.hardware} />
    </div>
  );
}

function ModeButton({
  mode,
  current,
  setMode,
  icon,
  label,
  title,
}: {
  mode: AppMode;
  current: AppMode;
  setMode: (mode: AppMode) => void;
  icon: React.ReactNode;
  label?: string;
  title?: string;
}) {
  const isActive = current === mode;
  return (
    <button
      onClick={() => setMode(mode)}
      className={`flex items-center ${label ? 'gap-1.5 px-3' : 'justify-center'} p-1.5 rounded-md text-xs font-medium transition-all ${
        isActive
          ? 'bg-white dark:bg-segmented-active text-slate-900 dark:text-white shadow-sm dark:shadow-md'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white'
      }`}
      title={title}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

// Mobile More Menu
function MobileMoreMenu({
  lang,
  theme,
  appMode,
  canUndo,
  canRedo,
  activeMenu,
  setActiveMenu,
  setAppMode,
  setLang,
  setTheme,
  undo,
  redo,
  onOpenCodeViewer,
  onSnapshot,
  onOpenSettings,
  onOpenAbout,
  t,
}: {
  lang: 'en' | 'zh';
  theme: 'light' | 'dark';
  appMode: AppMode;
  canUndo: boolean;
  canRedo: boolean;
  activeMenu: 'file' | 'toolbox' | 'view' | 'more' | null;
  setActiveMenu: (menu: 'file' | 'toolbox' | 'view' | 'more' | null) => void;
  setAppMode: (mode: AppMode) => void;
  setLang: (lang: 'en' | 'zh') => void;
  setTheme: (theme: 'light' | 'dark') => void;
  undo: () => void;
  redo: () => void;
  onOpenCodeViewer: () => void;
  onSnapshot: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  t: typeof translations['en'];
}) {
  return (
    <div className="relative sm:hidden">
      <button
        onClick={() => setActiveMenu(activeMenu === 'more' ? null : 'more')}
        className={`flex items-center justify-center w-8 h-8 rounded-md transition-all ${
          activeMenu === 'more'
            ? 'bg-slate-100 dark:bg-element-active text-slate-900 dark:text-white'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg'
        }`}
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>
      {activeMenu === 'more' && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
          <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-panel-bg rounded-lg shadow-md dark:shadow-xl border border-slate-200 dark:border-border-black z-50 overflow-hidden py-1">
            {/* Mode Switcher for Mobile */}
            <div className="px-3 py-2 border-b border-slate-100 dark:border-border-black md:hidden">
              <div className="text-[10px] uppercase text-slate-400 font-bold mb-1">{t.modeLabel}</div>
              <div className="flex gap-1 bg-slate-50 dark:bg-app-bg p-0.5 rounded-lg border border-slate-200 dark:border-border-black">
                <button
                  onClick={() => { setAppMode('skeleton'); setActiveMenu(null); }}
                  className={`flex-1 p-1.5 rounded text-center text-xs ${appMode === 'skeleton' ? 'bg-white dark:bg-segmented-active text-blue-600 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
                >
                  <Activity className="w-4 h-4 mx-auto" />
                </button>
                <button
                  onClick={() => { setAppMode('detail'); setActiveMenu(null); }}
                  className={`flex-1 p-1.5 rounded text-center text-xs ${appMode === 'detail' ? 'bg-white dark:bg-segmented-active text-blue-600 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
                >
                  <Box className="w-4 h-4 mx-auto" />
                </button>
                <button
                  onClick={() => { setAppMode('hardware'); setActiveMenu(null); }}
                  className={`flex-1 p-1.5 rounded text-center text-xs ${appMode === 'hardware' ? 'bg-white dark:bg-segmented-active text-blue-600 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
                >
                  <Cpu className="w-4 h-4 mx-auto" />
                </button>
              </div>
            </div>

            <button
              onClick={() => { onOpenCodeViewer(); setActiveMenu(null); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-3"
            >
              <Code className="w-4 h-4" /> {lang === 'zh' ? '源代码' : 'Source Code'}
            </button>
            <button
              onClick={() => { undo(); setActiveMenu(null); }}
              disabled={!canUndo}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-3 disabled:opacity-50"
            >
              <Undo className="w-4 h-4" /> {lang === 'zh' ? '撤销' : 'Undo'}
            </button>
            <button
              onClick={() => { redo(); setActiveMenu(null); }}
              disabled={!canRedo}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-3 disabled:opacity-50"
            >
              <Redo className="w-4 h-4" /> {lang === 'zh' ? '重做' : 'Redo'}
            </button>

            <div className="h-px bg-slate-100 dark:bg-border-black my-1" />

            <button
              onClick={() => { onSnapshot(); setActiveMenu(null); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-3"
            >
              <Camera className="w-4 h-4" /> {lang === 'zh' ? '快照' : 'Snapshot'}
            </button>
            <button
              onClick={() => { onOpenSettings(); setActiveMenu(null); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-3"
            >
              <Settings className="w-4 h-4" /> {lang === 'zh' ? '设置' : 'Settings'}
            </button>
            <button
              onClick={() => { setLang(lang === 'en' ? 'zh' : 'en'); setActiveMenu(null); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-3"
            >
              <Globe className="w-4 h-4" /> {lang === 'zh' ? '切换语言' : 'Switch Language'}
            </button>
            <button
              onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setActiveMenu(null); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-3"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />} {lang === 'zh' ? '切换主题' : 'Toggle Theme'}
            </button>
            <button
              onClick={() => { onOpenAbout(); setActiveMenu(null); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-element-bg text-slate-700 dark:text-slate-200 flex items-center gap-3"
            >
              <Info className="w-4 h-4" /> {lang === 'zh' ? '关于' : 'About'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Header;
