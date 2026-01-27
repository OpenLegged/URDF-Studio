/**
 * App Layout Component
 * Main application layout with Header and workspace area
 */
import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Header } from './components/Header';
import { TreeEditor } from '@/features/robot-tree';
import { PropertyEditor } from '@/features/property-editor';
import { Visualizer } from '@/features/visualizer';
import { URDFViewer } from '@/features/urdf-viewer';
import { SourceCodeEditor } from '@/features/code-editor';
import { useUIStore, useSelectionStore, useAssetsStore, useRobotStore, useCanUndo, useCanRedo } from '@/store';
import { parseURDF, generateURDF } from '@/core/parsers';
import type { RobotState, UrdfLink, UrdfJoint, RobotFile } from '@/types';

interface AppLayoutProps {
  // Import handlers (passed from App)
  importInputRef: React.RefObject<HTMLInputElement>;
  importFolderInputRef: React.RefObject<HTMLInputElement>;
  onExport: () => void;
  // Toast handler
  showToast: (message: string, type?: 'info' | 'success') => void;
  // Modal handlers
  onOpenAI: () => void;
  isCodeViewerOpen: boolean;
  setIsCodeViewerOpen: (open: boolean) => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
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
  // Robot file handling
  onLoadRobot: (file: RobotFile) => void;
}

export function AppLayout({
  importInputRef,
  importFolderInputRef,
  onExport,
  showToast,
  onOpenAI,
  isCodeViewerOpen,
  setIsCodeViewerOpen,
  onOpenSettings,
  onOpenAbout,
  viewConfig,
  setViewConfig,
  onLoadRobot,
}: AppLayoutProps) {
  // UI Store
  const appMode = useUIStore((state) => state.appMode);
  const lang = useUIStore((state) => state.lang);
  const theme = useUIStore((state) => state.theme);
  const os = useUIStore((state) => state.os);
  const sidebar = useUIStore((state) => state.sidebar);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);

  // Selection Store
  const selection = useSelectionStore((state) => state.selection);
  const setSelection = useSelectionStore((state) => state.setSelection);
  const hoveredSelection = useSelectionStore((state) => state.hoveredSelection);
  const setHoveredSelection = useSelectionStore((state) => state.setHoveredSelection);
  const focusTarget = useSelectionStore((state) => state.focusTarget);
  const focusOn = useSelectionStore((state) => state.focusOn);

  // Assets Store
  const assets = useAssetsStore((state) => state.assets);
  const motorLibrary = useAssetsStore((state) => state.motorLibrary);
  const availableFiles = useAssetsStore((state) => state.availableFiles);
  const selectedFile = useAssetsStore((state) => state.selectedFile);
  const originalUrdfContent = useAssetsStore((state) => state.originalUrdfContent);
  const uploadAsset = useAssetsStore((state) => state.uploadAsset);

  // Robot Store
  const robotName = useRobotStore((state) => state.name);
  const robotLinks = useRobotStore((state) => state.links);
  const robotJoints = useRobotStore((state) => state.joints);
  const rootLinkId = useRobotStore((state) => state.rootLinkId);
  const setName = useRobotStore((state) => state.setName);
  const setRobot = useRobotStore((state) => state.setRobot);
  const addChild = useRobotStore((state) => state.addChild);
  const deleteSubtree = useRobotStore((state) => state.deleteSubtree);
  const updateLink = useRobotStore((state) => state.updateLink);
  const updateJoint = useRobotStore((state) => state.updateJoint);
  const setAllLinksVisibility = useRobotStore((state) => state.setAllLinksVisibility);
  const setJointAngle = useRobotStore((state) => state.setJointAngle);
  const undo = useRobotStore((state) => state.undo);
  const redo = useRobotStore((state) => state.redo);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  // Snapshot ref
  const snapshotActionRef = useRef<(() => void) | null>(null);

  // Construct robot object for legacy components
  const robot: RobotState = useMemo(() => ({
    name: robotName,
    links: robotLinks,
    joints: robotJoints,
    rootLinkId,
    selection,
  }), [robotName, robotLinks, robotJoints, rootLinkId, selection]);

  // Joint angle state for URDFViewer
  const jointAngleState = useMemo(() => {
    const angles: Record<string, number> = {};
    Object.values(robotJoints).forEach((joint) => {
      const angle = (joint as { angle?: number }).angle;
      if (angle !== undefined) {
        angles[joint.name] = angle;
      }
    });
    return angles;
  }, [robotJoints]);

  // Show visual computed from links
  const showVisual = useMemo(() => {
    return Object.values(robotLinks).some(l => l.visible !== false);
  }, [robotLinks]);

  // URDF content for viewer
  const urdfContentForViewer = useMemo(() => {
    if (originalUrdfContent) {
      return originalUrdfContent;
    }
    return generateURDF(robot, false);
  }, [originalUrdfContent, robot]);

  // Handlers
  const handleSelect = useCallback((type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => {
    setSelection({ type, id, subType });
  }, [setSelection]);

  const handleFocus = useCallback((id: string) => {
    focusOn(id);
  }, [focusOn]);

  const handleNameChange = useCallback((name: string) => {
    setName(name);
  }, [setName]);

  const handleUpdate = useCallback((type: 'link' | 'joint', id: string, data: UrdfLink | UrdfJoint) => {
    if (type === 'link') {
      updateLink(id, data as Partial<UrdfLink>);
    } else {
      updateJoint(id, data as Partial<UrdfJoint>);
    }
  }, [updateLink, updateJoint]);

  const handleAddChild = useCallback((parentId: string) => {
    const { jointId } = addChild(parentId);
    setSelection({ type: 'joint', id: jointId });
  }, [addChild, setSelection]);

  const handleDelete = useCallback((linkId: string) => {
    if (linkId === rootLinkId) return;
    deleteSubtree(linkId);
    setSelection({ type: null, id: null });
  }, [deleteSubtree, rootLinkId, setSelection]);

  const handleSetShowVisual = useCallback((target: boolean) => {
    setAllLinksVisibility(target);
  }, [setAllLinksVisibility]);

  const handleUploadAsset = useCallback((file: File) => {
    uploadAsset(file);
  }, [uploadAsset]);

  const handleJointChange = useCallback((jointName: string, angle: number) => {
    setJointAngle(jointName, angle);
  }, [setJointAngle]);

  const handleCodeChange = useCallback((newCode: string) => {
    const newState = parseURDF(newCode);
    if (newState) {
      const { selection: _, ...newData } = newState;
      setRobot(newData);
    }
  }, [setRobot]);

  const handleSnapshot = useCallback(() => {
    if (snapshotActionRef.current) {
      try {
        snapshotActionRef.current();
        showToast(lang === 'zh' ? '正在生成高清快照...' : 'Generating High-Res Snapshot...', 'info');
      } catch (e) {
        console.error('Snapshot failed:', e);
        showToast(lang === 'zh' ? '快照失败' : 'Snapshot failed', 'info');
      }
    }
  }, [lang, showToast]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (canUndo) {
          undo();
          e.preventDefault();
        }
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        if (canRedo) {
          redo();
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);

  // Clean up selection if selected item no longer exists
  useEffect(() => {
    if (selection.id && selection.type) {
      const exists = selection.type === 'link'
        ? robotLinks[selection.id]
        : robotJoints[selection.id];
      if (!exists) {
        setSelection({ type: null, id: null });
      }
    }
  }, [robotLinks, robotJoints, selection, setSelection]);

  return (
    <div className="flex flex-col h-screen font-sans bg-google-light-bg dark:bg-google-dark-bg text-slate-800 dark:text-slate-200">
      {/* Hidden file inputs */}
      <input
        type="file"
        accept=".zip,.urdf,.xml,.usda,.usd,.xacro"
        ref={importInputRef}
        className="hidden"
      />
      <input
        type="file"
        ref={importFolderInputRef}
        className="hidden"
        {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
      />

      {/* Header */}
      <Header
        onImportFile={() => importInputRef.current?.click()}
        onImportFolder={() => importFolderInputRef.current?.click()}
        onExport={onExport}
        onOpenAI={onOpenAI}
        onOpenCodeViewer={() => setIsCodeViewerOpen(true)}
        onOpenSettings={onOpenSettings}
        onOpenAbout={onOpenAbout}
        onSnapshot={handleSnapshot}
        viewConfig={viewConfig}
        setViewConfig={setViewConfig}
      />

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        <TreeEditor
          robot={robot}
          onSelect={handleSelect}
          onFocus={handleFocus}
          onAddChild={handleAddChild}
          onDelete={handleDelete}
          onNameChange={handleNameChange}
          onUpdate={handleUpdate}
          showVisual={showVisual}
          setShowVisual={handleSetShowVisual}
          mode={appMode}
          lang={lang}
          theme={theme}
          collapsed={sidebar.leftCollapsed}
          onToggle={() => toggleSidebar('left')}
          availableFiles={availableFiles}
          onLoadRobot={onLoadRobot}
          currentFileName={selectedFile?.name}
        />

        {/* Viewer Container */}
        <div className="flex-1 relative">
          {/* URDFViewer for detail/hardware modes */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            visibility: (appMode === 'detail' || appMode === 'hardware') && urdfContentForViewer ? 'visible' : 'hidden',
            pointerEvents: (appMode === 'detail' || appMode === 'hardware') && urdfContentForViewer ? 'auto' : 'none'
          }}>
            <URDFViewer
              key="urdf-viewer"
              urdfContent={urdfContentForViewer}
              assets={assets}
              lang={lang}
              mode={appMode as 'detail' | 'hardware'}
              onSelect={handleSelect}
              selection={robot.selection}
              hoveredSelection={hoveredSelection}
              focusTarget={focusTarget}
              theme={theme}
              robotLinks={robot.links}
              showVisual={showVisual}
              setShowVisual={handleSetShowVisual}
              jointAngleState={jointAngleState}
              snapshotAction={snapshotActionRef}
              showToolbar={viewConfig.showToolbar}
              setShowToolbar={(show) => setViewConfig(prev => ({ ...prev, showToolbar: show }))}
              showOptionsPanel={viewConfig.showOptionsPanel}
              setShowOptionsPanel={(show) => setViewConfig(prev => ({ ...prev, showOptionsPanel: show }))}
              showJointPanel={viewConfig.showJointPanel}
              setShowJointPanel={(show) => setViewConfig(prev => ({ ...prev, showJointPanel: show }))}
              onJointChange={handleJointChange}
              onCollisionTransform={(linkId, position, rotation) => {
                if (linkId && robot.links[linkId]) {
                  const link = robot.links[linkId];
                  const updatedLink = {
                    ...link,
                    collision: {
                      ...link.collision,
                      origin: {
                        xyz: position,
                        rpy: rotation
                      }
                    }
                  };
                  handleUpdate('link', linkId, updatedLink);
                }
              }}
            />
          </div>

          {/* Visualizer for skeleton mode */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            visibility: appMode === 'skeleton' ? 'visible' : 'hidden',
            pointerEvents: appMode === 'skeleton' ? 'auto' : 'none'
          }}>
            <Visualizer
              key="visualizer"
              robot={robot}
              onSelect={handleSelect}
              onUpdate={handleUpdate}
              mode={appMode}
              assets={assets}
              lang={lang}
              theme={theme}
              os={os}
              showVisual={showVisual}
              setShowVisual={handleSetShowVisual}
              snapshotAction={snapshotActionRef}
              showOptionsPanel={viewConfig.showSkeletonOptionsPanel}
              setShowOptionsPanel={(show) => setViewConfig(prev => ({ ...prev, showSkeletonOptionsPanel: show }))}
            />
          </div>
        </div>

        <PropertyEditor
          robot={robot}
          onUpdate={handleUpdate}
          onSelect={handleSelect}
          onHover={(type, id, subType) => setHoveredSelection({ type, id, subType })}
          mode={appMode}
          assets={assets}
          onUploadAsset={handleUploadAsset}
          motorLibrary={motorLibrary}
          lang={lang}
          theme={theme}
          collapsed={sidebar.rightCollapsed}
          onToggle={() => toggleSidebar('right')}
        />
      </div>

      {/* Source Code Editor */}
      {isCodeViewerOpen && (
        <SourceCodeEditor
          code={selectedFile ? selectedFile.content : urdfContentForViewer}
          onCodeChange={handleCodeChange}
          onClose={() => setIsCodeViewerOpen(false)}
          theme={theme}
          fileName={selectedFile ? selectedFile.name.split('/').pop() || `${robot.name}.urdf` : `${robot.name}.urdf`}
          lang={lang}
        />
      )}
    </div>
  );
}

export default AppLayout;
