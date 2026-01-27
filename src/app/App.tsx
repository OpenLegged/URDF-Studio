/**
 * Main App Component
 * Root component that assembles all pieces together
 */
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Providers } from './Providers';
import { AppLayout } from './AppLayout';
import { SettingsModal } from './components/SettingsModal';
import { AboutModal } from './components/AboutModal';
import { AIModal } from '@/features/ai-assistant';
import { useFileImport, useFileExport } from './hooks';
import { useRobotStore, useUIStore, useSelectionStore, useAssetsStore } from '@/store';
import { parseURDF, parseMJCF, parseUSDA, parseXacro } from '@/core/parsers';
import type { RobotFile, RobotState, UrdfLink, UrdfJoint } from '@/types';
import { translations } from '@/shared/i18n';

function AppContent() {
  // Refs for file inputs
  const importInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);

  // UI Store
  const lang = useUIStore((state) => state.lang);
  const setAppMode = useUIStore((state) => state.setAppMode);
  const openSettings = useUIStore((state) => state.openSettings);

  // Selection Store
  const setSelection = useSelectionStore((state) => state.setSelection);

  // Assets Store
  const setOriginalUrdfContent = useAssetsStore((state) => state.setOriginalUrdfContent);
  const setOriginalFileFormat = useAssetsStore((state) => state.setOriginalFileFormat);
  const setSelectedFile = useAssetsStore((state) => state.setSelectedFile);
  const availableFiles = useAssetsStore((state) => state.availableFiles);
  const assets = useAssetsStore((state) => state.assets);
  const motorLibrary = useAssetsStore((state) => state.motorLibrary);

  // Robot Store
  const robotName = useRobotStore((state) => state.name);
  const robotLinks = useRobotStore((state) => state.links);
  const robotJoints = useRobotStore((state) => state.joints);
  const rootLinkId = useRobotStore((state) => state.rootLinkId);
  const setRobot = useRobotStore((state) => state.setRobot);

  // Local UI state
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'info' | 'success' }>({
    show: false, message: '', type: 'info'
  });
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isCodeViewerOpen, setIsCodeViewerOpen] = useState(false);
  const [viewConfig, setViewConfig] = useState({
    showToolbar: true,
    showOptionsPanel: true,
    showSkeletonOptionsPanel: true,
    showJointPanel: true,
  });

  // Show toast helper
  const showToast = useCallback((message: string, type: 'info' | 'success' = 'info') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 5000);
  }, []);

  // Build robot state for components
  const robot: RobotState = {
    name: robotName,
    links: robotLinks,
    joints: robotJoints,
    rootLinkId,
    selection: useSelectionStore.getState().selection,
  };

  // Load robot file handler
  const handleLoadRobot = useCallback((file: RobotFile) => {
    let newState: RobotState | null = null;

    switch (file.format) {
      case 'urdf':
        newState = parseURDF(file.content);
        break;
      case 'mjcf':
        newState = parseMJCF(file.content);
        break;
      case 'usd':
        newState = parseUSDA(file.content);
        break;
      case 'xacro':
        const fileMap: Record<string, string> = {};
        availableFiles.forEach(f => { fileMap[f.name] = f.content; });
        Object.entries(assets).forEach(([path, content]) => {
          if (typeof content === 'string') fileMap[path] = content;
        });
        const pathParts = file.name.split('/');
        pathParts.pop();
        newState = parseXacro(file.content, {}, fileMap, pathParts.join('/'));
        break;
    }

    if (newState) {
      const { selection: _, ...data } = newState;
      setRobot(data);
      setSelection({ type: null, id: null });
      setSelectedFile(file);
      setOriginalUrdfContent(file.content);
      setOriginalFileFormat(file.format);
      setAppMode('detail');
    } else {
      alert(lang === 'zh' ? `解析 ${file.format.toUpperCase()} 失败` : `Failed to parse ${file.format.toUpperCase()}`);
    }
  }, [availableFiles, assets, lang, setRobot, setSelection, setSelectedFile, setOriginalUrdfContent, setOriginalFileFormat, setAppMode]);

  // File import/export hooks
  const { handleImport } = useFileImport({ onLoadRobot: handleLoadRobot, onShowToast: showToast });
  const { handleExport } = useFileExport();

  // AI changes handler
  const handleApplyAIChanges = useCallback((data: { name?: string; links?: Record<string, UrdfLink>; joints?: Record<string, UrdfJoint>; rootLinkId?: string }) => {
    setRobot({
      name: data.name || robotName,
      links: data.links || robotLinks,
      joints: data.joints || robotJoints,
      rootLinkId: data.rootLinkId || rootLinkId,
    });
    setAppMode('skeleton');
  }, [robotName, robotLinks, robotJoints, rootLinkId, setRobot, setAppMode]);

  // File input change handlers
  useEffect(() => {
    const input = importInputRef.current;
    const folderInput = importFolderInputRef.current;
    const onImport = (e: Event) => handleImport((e.target as HTMLInputElement).files);
    if (input) input.addEventListener('change', onImport as EventListener);
    if (folderInput) folderInput.addEventListener('change', onImport as EventListener);
    return () => {
      if (input) input.removeEventListener('change', onImport as EventListener);
      if (folderInput) folderInput.removeEventListener('change', onImport as EventListener);
    };
  }, [handleImport]);

  const t = translations[lang];

  return (
    <>
      <AppLayout
        importInputRef={importInputRef}
        importFolderInputRef={importFolderInputRef}
        onExport={handleExport}
        showToast={showToast}
        onOpenAI={() => setIsAIModalOpen(true)}
        isCodeViewerOpen={isCodeViewerOpen}
        setIsCodeViewerOpen={setIsCodeViewerOpen}
        onOpenSettings={() => openSettings()}
        onOpenAbout={() => setIsAboutOpen(true)}
        viewConfig={viewConfig}
        setViewConfig={setViewConfig}
        onLoadRobot={handleLoadRobot}
      />

      {/* Modals */}
      <SettingsModal />
      <AboutModal isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
      <AIModal
        isOpen={isAIModalOpen}
        onClose={() => setIsAIModalOpen(false)}
        robot={robot}
        motorLibrary={motorLibrary}
        lang={lang}
        onApplyChanges={handleApplyAIChanges}
        onSelectItem={(type, id) => setSelection({ type, id })}
      />

      {/* Toast */}
      {toast.show && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="bg-white dark:bg-slate-800 shadow-xl rounded-lg border border-green-200 dark:border-green-900 px-4 py-3 flex items-center gap-3 max-w-md">
            <div className="bg-green-100 dark:bg-green-900/30 p-1.5 rounded-full shrink-0">
              <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-sm text-slate-700 dark:text-slate-200 font-medium">{toast.message}</div>
            <button
              onClick={() => setToast(prev => ({ ...prev, show: false }))}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <Providers>
      <AppContent />
    </Providers>
  );
}
