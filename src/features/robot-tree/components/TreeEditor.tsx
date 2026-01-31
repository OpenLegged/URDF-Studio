/**
 * TreeEditor - Robot tree structure editor with file browser
 * Features: File tree, robot structure tree, link/joint management
 */
import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Box, ArrowRightLeft, Plus, Trash2, ChevronDown, ChevronRight, ChevronLeft, PanelLeftOpen, FileCode, Folder, FolderOpen, FileText, File, Cuboid, Eye, EyeOff, Shapes, Shield } from 'lucide-react';
import type { RobotState, AppMode, Theme, RobotFile, GeometryType } from '@/types';
import { translations } from '@/shared/i18n';
import type { Language } from '@/store';

// --- File Tree Types and Components ---

interface FileTreeNode {
    name: string;
    path: string;
    isFolder: boolean;
    children?: FileTreeNode[];
    file?: RobotFile;
}

// Build a tree structure from flat file list
function buildFileTree(files: RobotFile[]): FileTreeNode[] {
    const root: FileTreeNode[] = [];

    for (const file of files) {
        const parts = file.name.split('/').filter(p => p.length > 0);
        let currentLevel = root;
        let currentPath = '';

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const isLast = i === parts.length - 1;

            let existing = currentLevel.find(n => n.name === part);

            if (!existing) {
                const newNode: FileTreeNode = {
                    name: part,
                    path: currentPath,
                    isFolder: !isLast,
                    children: isLast ? undefined : [],
                    file: isLast ? file : undefined
                };
                currentLevel.push(newNode);
                existing = newNode;
            }

            if (!isLast && existing.children) {
                currentLevel = existing.children;
            }
        }
    }

    // Sort: folders first, then alphabetically
    const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
        return nodes.sort((a, b) => {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return a.name.localeCompare(b.name);
        }).map(node => ({
            ...node,
            children: node.children ? sortNodes(node.children) : undefined
        }));
    };

    return sortNodes(root);
}

// Get file icon based on extension
function getFileIcon(filename: string, isFolder: boolean, isOpen: boolean) {
    if (isFolder) {
        return isOpen ? <FolderOpen className="w-3.5 h-3.5 text-amber-500" /> : <Folder className="w-3.5 h-3.5 text-amber-500" />;
    }

    const ext = filename.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
        case 'urdf':
            return <FileCode className="w-3.5 h-3.5 text-blue-500" />;
        case 'xacro':
            return <FileCode className="w-3.5 h-3.5 text-slate-500" />;
        case 'xml':
            return <FileCode className="w-3.5 h-3.5 text-orange-500" />;
        case 'dae':
        case 'stl':
        case 'obj':
            return <Cuboid className="w-3.5 h-3.5 text-green-500" />;
        default:
            return <File className="w-3.5 h-3.5 text-slate-400" />;
    }
}

// File Tree Node Component
const FileTreeNodeComponent: React.FC<{
    node: FileTreeNode;
    depth: number;
    onLoadRobot?: (file: RobotFile) => void;
    expandedFolders: Set<string>;
    toggleFolder: (path: string) => void;
}> = ({ node, depth, onLoadRobot, expandedFolders, toggleFolder }) => {
    const isExpanded = expandedFolders.has(node.path);
    const paddingLeft = depth * 12 + 8;

    const handleClick = () => {
        if (node.isFolder) {
            toggleFolder(node.path);
        } else if (node.file && onLoadRobot) {
            onLoadRobot(node.file);
        }
    };

    return (
        <div>
            <div
                className={`flex items-center gap-1.5 py-1 pr-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-[#3A3A3C] transition-colors group rounded-sm`}                style={{ paddingLeft: `${paddingLeft}px` }}
                onClick={handleClick}
            >
                {/* Expand/collapse arrow for folders */}
                {node.isFolder ? (
                    <span className="w-3 h-3 flex items-center justify-center">
                        {isExpanded ? (
                            <ChevronDown className="w-3 h-3 text-slate-400" />
                        ) : (
                            <ChevronRight className="w-3 h-3 text-slate-400" />
                        )}
                    </span>
                ) : (
                    <span className="w-3 h-3" />
                )}

                {/* Icon */}
                {getFileIcon(node.name, node.isFolder, isExpanded)}

                {/* Name */}
                <span className={`text-xs truncate flex-1 ${
                    node.isFolder
                        ? 'text-slate-700 dark:text-slate-300 font-medium'
                        : 'text-slate-600 dark:text-slate-400'
                }`}>
                    {node.name}
                </span>

                {/* Format badge for robot files */}
                {node.file && (
                    <span className={`text-[9px] px-1 rounded font-medium ${
                        node.file.format === 'urdf' ? 'bg-blue-100 dark:bg-slate-700 text-blue-600 dark:text-slate-300' :
                        node.file.format === 'xacro' ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' :
                        node.file.format === 'mjcf' ? 'bg-orange-100 dark:bg-slate-700 text-orange-600 dark:text-slate-300' :
                        'bg-slate-200 dark:bg-slate-700 text-slate-500'
                    }`}>
                        {node.file.format.toUpperCase()}
                    </span>
                )}
            </div>

      {/* Children */}
            {node.isFolder && isExpanded && node.children && (
                <div>
                    {node.children.map((child, idx) => (
                        <FileTreeNodeComponent
                            key={child.path}
                            node={child}
                            depth={depth + 1}
                            onLoadRobot={onLoadRobot}
                            expandedFolders={expandedFolders}
                            toggleFolder={toggleFolder}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export interface TreeEditorProps {
  robot: RobotState;
  onSelect: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onFocus?: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  onNameChange: (name: string) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  showVisual: boolean;
  setShowVisual: (show: boolean) => void;
  mode: AppMode;
  lang: Language;
  collapsed?: boolean;
  onToggle?: () => void;
  theme: Theme;
  availableFiles?: RobotFile[];
  onLoadRobot?: (file: RobotFile) => void;
  currentFileName?: string;  // Currently loaded file name
}

// --- Structure View Components ---

// Component for text with long-press selection
const SelectableText: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => {
  const [isLongPressing, setIsLongPressing] = useState(false);
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const elementRef = useRef<HTMLSpanElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Prevent default text selection behavior for normal clicks
    e.preventDefault();

    pressTimerRef.current = setTimeout(() => {
      setIsLongPressing(true);
      // Enable text selection on the element itself
      if (elementRef.current) {
        elementRef.current.style.userSelect = 'text';
        elementRef.current.style.webkitUserSelect = 'text';
      }
    }, 400); // 400ms for long press
  }, []);

  const handleMouseUp = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (!isLongPressing) {
      // Reset if not long pressing
      if (elementRef.current) {
        elementRef.current.style.userSelect = 'none';
        elementRef.current.style.webkitUserSelect = 'none';
      }
    }
    setIsLongPressing(false);
  }, [isLongPressing]);

  const handleMouseLeave = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    setIsLongPressing(false);
    if (elementRef.current) {
      elementRef.current.style.userSelect = 'none';
      elementRef.current.style.webkitUserSelect = 'none';
    }
  }, []);

  return (
    <span
      ref={elementRef}
      className={className}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </span>
  );
};

// Memoized TreeNode to prevent unnecessary re-renders in recursive tree
const TreeNode = memo(({
  linkId,
  robot,
  onSelect,
  onFocus,
  onAddChild,
  onDelete,
  onUpdate,
  mode,
  t,
  depth = 0
}: {
  linkId: string;
  robot: RobotState;
  onSelect: TreeEditorProps['onSelect'];
  onFocus?: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  mode: AppMode;
  t: typeof translations['en'];
  depth?: number;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isGeomExpanded, setIsGeomExpanded] = useState(false);

  const link = robot.links[linkId];
  if (!link) return null;

  const childJoints = Object.values(robot.joints).filter(j => j.parentLinkId === linkId);
  const hasChildren = childJoints.length > 0;

  const isLinkSelected = robot.selection.type === 'link' && robot.selection.id === linkId;
  const isSkeleton = mode === 'skeleton';

  const isVisible = link.visible !== false; // Default to true
  const hasVisual = link.visual?.type && link.visual.type !== 'none';
  const hasCollision = link.collision?.type && link.collision.type !== 'none';

  return (
    <div className="relative">
      {/* Link Node - Compact card style */}
      <div
        className={`relative flex items-center py-1 px-2 mx-1 my-0.5 rounded-md cursor-pointer group
          ${isLinkSelected
            ? 'bg-blue-500 text-white shadow-sm dark:bg-[#3A3A3C]'
            : 'hover:bg-slate-100 dark:hover:bg-[#3A3A3C] text-slate-700 dark:text-slate-300'}`}
        onClick={() => onSelect('link', linkId)}
        onDoubleClick={() => onFocus && onFocus(linkId)}
        style={{ marginLeft: depth > 0 ? '8px' : '0' }}
      >
        {/* Tree line connector */}
        {depth > 0 && (
          <div className="absolute -left-2 top-1/2 w-2 h-px bg-slate-300 dark:bg-slate-600" />
        )}

        {/* Expand toggle */}
        <div
          className={`w-4 h-4 flex items-center justify-center shrink-0 mr-1 rounded
            ${hasChildren ? 'hover:bg-black/10 dark:hover:bg-[#48484A] cursor-pointer' : ''}`}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) setIsExpanded(!isExpanded); }}
        >
          {hasChildren && (
            isExpanded
              ? <ChevronDown size={12} className={isLinkSelected ? 'text-blue-200' : 'text-slate-400'} />
              : <ChevronRight size={12} className={isLinkSelected ? 'text-blue-200' : 'text-slate-400'} />
          )}
        </div>

        {/* Link icon */}
        <div className={`w-5 h-5 rounded flex items-center justify-center mr-1.5 shrink-0
          ${isLinkSelected ? 'bg-blue-400 dark:bg-slate-500' : 'bg-blue-100 dark:bg-slate-700'}`}>
          <Box size={12} className={isLinkSelected ? 'text-white' : 'text-blue-500 dark:text-slate-300'} />
        </div>

        <SelectableText className="text-xs font-medium truncate flex-1">
          {link.name}
        </SelectableText>

        {/* Right side actions - always visible */}
        <div className="flex items-center gap-0.5 ml-auto">
          {/* Visual/Collision Toggle - always visible if link has geometry */}
          {(hasVisual || hasCollision) && (
            <button
              onClick={(e) => { e.stopPropagation(); setIsGeomExpanded(!isGeomExpanded); }}
              className={`p-1 rounded transition-colors ${
                isGeomExpanded
                  ? (isLinkSelected ? 'bg-blue-400 text-white' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400')
                  : (isLinkSelected ? 'text-blue-200 hover:bg-blue-400' : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-blue-500')
              }`}
              title={isGeomExpanded ? t.hideVisualCollision : t.showVisualCollision}
            >
              <Shapes size={12} />
            </button>
          )}

          {/* Visibility Toggle */}
          <button
              className={`p-1 rounded hover:bg-black/10 dark:hover:bg-[#48484A] cursor-pointer
                  ${isLinkSelected ? 'text-white' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}
              onClick={(e) => {
                  e.stopPropagation();
                  onUpdate('link', linkId, { ...link, visible: !isVisible });
              }}
              title={isVisible ? t.hide : t.show}
          >
              {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>

          {/* Add child button - skeleton mode only, show on hover */}
          {isSkeleton && (
            <button
              onClick={(e) => { e.stopPropagation(); onAddChild(linkId); setIsExpanded(true); }}
              className={`p-1 rounded transition-opacity ${
                isLinkSelected
                  ? 'opacity-100 hover:bg-blue-400'
                  : 'opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
              title={t.addChildJoint}
            >
              <Plus size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Children & Geometry */}
      {(hasChildren || ((hasVisual || hasCollision) && isGeomExpanded)) && isExpanded && (
        <div className="relative ml-3">
          {/* Vertical connector line */}
          <div className="absolute left-0 top-0 bottom-2 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Visual/Collision entries FIRST - directly under the link */}
          {(hasVisual || hasCollision) && isGeomExpanded && (
            <div className="space-y-0.5 pb-0.5">
              {hasVisual && (
                <div
                  className={`relative flex items-center gap-2 text-[11px] px-2 py-1 ml-5 rounded-md cursor-pointer transition-colors
                    ${robot.selection.type === 'link' && robot.selection.id === linkId && robot.selection.subType === 'visual'
                      ? 'bg-blue-500 text-white shadow-sm dark:bg-[#3A3A3C]'
                      : 'text-blue-600 dark:text-slate-400 hover:bg-blue-50 dark:hover:bg-[#3A3A3C]'}
                  `}
                  title={`Visual: ${link.visual.type}`}
                  onClick={(e) => { e.stopPropagation(); onSelect('link', linkId, 'visual'); }}
                >
                  {/* Connector */}
                  <div className="absolute -left-3 top-1/2 w-3 h-px bg-slate-200 dark:bg-slate-700" />
                  <Shapes size={12} />
                  <SelectableText className="font-medium">{t.visual}</SelectableText>
                  <SelectableText className="text-[10px] opacity-70 ml-auto">{link.visual.type}</SelectableText>
                </div>
              )}

              {hasCollision && (
                <div
                  className={`relative flex items-center gap-2 text-[11px] px-2 py-1 ml-5 rounded-md cursor-pointer transition-colors
                    ${robot.selection.type === 'link' && robot.selection.id === linkId && robot.selection.subType === 'collision'
                      ? 'bg-[#0060FA] text-white shadow-sm dark:bg-[#3A3A3C]'
                      : 'text-[#0060FA] dark:text-slate-400 hover:bg-[#0060FA]/10 dark:hover:bg-[#3A3A3C]'}
                  `}
                  title={`Collision: ${link.collision.type}`}
                  onClick={(e) => { e.stopPropagation(); onSelect('link', linkId, 'collision'); }}
                >
                  {/* Connector */}
                  <div className="absolute -left-3 top-1/2 w-3 h-px bg-slate-200 dark:bg-slate-700" />
                  <Shield size={12} />
                  <SelectableText className="font-medium">{t.collision}</SelectableText>
                  <SelectableText className="text-[10px] opacity-70 ml-auto">{link.collision.type}</SelectableText>
                </div>
              )}
            </div>
          )}

          {/* Child Joints after Visual/Collision */}
          {childJoints.map((joint, idx) => {
            const isJointSelected = robot.selection.type === 'joint' && robot.selection.id === joint.id;

            return (
              <div key={joint.id} className="relative">
                {/* Joint Node - Inline compact style */}
                <div
                  className={`relative flex items-center py-1 px-2 mx-1 my-0.5 rounded-md cursor-pointer group
                    ${isJointSelected
                      ? 'bg-orange-500 text-white shadow-sm dark:bg-[#3A3A3C]'
                      : 'hover:bg-slate-100 dark:hover:bg-[#3A3A3C] text-slate-600 dark:text-slate-400'}`}
                  onClick={() => onSelect('joint', joint.id)}
                  style={{ marginLeft: '8px' }}
                >
                  {/* Connector */}
                  <div className="absolute -left-2 top-1/2 w-2 h-px bg-slate-300 dark:bg-slate-600" />

                  {/* Joint icon */}
                  <div className={`w-5 h-5 rounded flex items-center justify-center mr-1.5 shrink-0
                    ${isJointSelected ? 'bg-orange-400 dark:bg-slate-500' : 'bg-orange-100 dark:bg-slate-700'}`}>
                    <ArrowRightLeft size={10} className={isJointSelected ? 'text-white' : 'text-orange-500 dark:text-slate-300'} />
                  </div>

                  <SelectableText className="text-[11px] font-medium truncate flex-1">
                    {joint.name}
                  </SelectableText>

                  {/* Actions */}
                  {isSkeleton && (
                    <div className={`flex items-center gap-0.5 ml-1 ${isJointSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(joint.childLinkId); }}
                        className={`p-0.5 rounded ${isJointSelected ? 'hover:bg-orange-400' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                        title={t.deleteBranch}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Child Link - Recursive */}
                <TreeNode
                  linkId={joint.childLinkId}
                  robot={robot}
                  onSelect={onSelect}
                  onFocus={onFocus}
                  onAddChild={onAddChild}
                  onDelete={onDelete}
                  onUpdate={onUpdate}
                  mode={mode}
                  t={t}
                  depth={depth + 1}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

TreeNode.displayName = 'TreeNode';

export const TreeEditor: React.FC<TreeEditorProps> = ({
    robot, onSelect, onFocus, onAddChild, onDelete, onNameChange, onUpdate, showVisual, setShowVisual, mode, lang, collapsed, onToggle, theme,
    availableFiles = [], onLoadRobot, currentFileName
}) => {
  const t = translations[lang];
  const [width, setWidth] = useState(288);
  const [isDragging, setIsDragging] = useState(false);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Vertical resizing state
  const [fileBrowserHeight, setFileBrowserHeight] = useState(250);
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(true);
  const [isStructureOpen, setIsStructureOpen] = useState(true);
  const isVerticalResizing = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // File tree state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Build file tree from available files
  const fileTree = useMemo(() => buildFileTree(availableFiles), [availableFiles]);

  // Toggle folder expansion
  const toggleFolder = useCallback((path: string) => {
      setExpandedFolders(prev => {
          const newSet = new Set(prev);
          if (newSet.has(path)) {
              newSet.delete(path);
          } else {
              newSet.add(path);
          }
          return newSet;
      });
  }, []);

  // Expand all folders when files change
  useEffect(() => {
      if (availableFiles.length > 0) {
          const allFolders = new Set<string>();
          availableFiles.forEach(f => {
              const parts = f.name.split('/');
              let path = '';
              for (let i = 0; i < parts.length - 1; i++) {
                  path = path ? `${path}/${parts[i]}` : parts[i];
                  allFolders.add(path);
              }
          });
          // Expand first level folders by default
          const firstLevel = new Set<string>();
          availableFiles.forEach(f => {
              const firstPart = f.name.split('/')[0];
              if (firstPart) firstLevel.add(firstPart);
          });
          setExpandedFolders(firstLevel);
      }
  }, [availableFiles]);

  // Horizontal resizing
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    setIsDragging(true);
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  // Vertical resizing
  const handleVerticalMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    isVerticalResizing.current = true;
    setIsDragging(true);
    startY.current = e.clientY;
    startHeight.current = fileBrowserHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [fileBrowserHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing.current) {
        const delta = e.clientX - startX.current;
        const newWidth = Math.max(200, Math.min(600, startWidth.current + delta));
        setWidth(newWidth);
      }
      if (isVerticalResizing.current) {
          const delta = e.clientY - startY.current;
          // Min 50, Max 500 or constraint by container
          const newHeight = Math.max(100, Math.min(600, startHeight.current + delta));
          setFileBrowserHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      isVerticalResizing.current = false;
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const actualWidth = collapsed ? 0 : width;

  return (
    <div
      className={`bg-slate-50 dark:bg-google-dark-bg border-r border-slate-200 dark:border-google-dark-border flex flex-col h-full shrink-0 relative ${isDragging ? '' : 'transition-[width,min-width,flex] duration-200 ease-out'}`}
      style={{ width: `${actualWidth}px`, minWidth: `${actualWidth}px`, flex: `0 0 ${actualWidth}px`, overflow: 'visible' }}
    >
      {/* Side Toggle Button */}
      <button
          onClick={onToggle}
          className="absolute -right-4 top-1/2 -translate-y-1/2 w-4 h-16 bg-white dark:bg-[#2C2C2E] hover:bg-blue-500 dark:hover:bg-blue-600 hover:text-white border border-slate-300 dark:border-[#000000] rounded-r-lg shadow-md flex flex-col items-center justify-center z-50 cursor-pointer text-slate-400 hover:text-white transition-all group"
          title={collapsed ? t.structure : t.collapseSidebar}
      >
          <div className="flex flex-col gap-0.5 items-center">
            <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-blue-200" />
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-blue-200" />
          </div>
      </button>

      {!collapsed && (
        <div className="flex flex-col h-full overflow-hidden w-full relative">
            {/* Robot Name Input - Moved to Top */}
            <div className="px-4 pt-3 pb-2 bg-white dark:bg-google-dark-bg border-b border-slate-200 dark:border-google-dark-border shrink-0">
                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1 block">{t.robotName}</label>
                    <input
                    type="text"
                    value={robot.name}
                    onChange={(e) => onNameChange(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#000000] focus:bg-white dark:focus:bg-[#000000] text-sm text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-300 dark:border-[#48484A] focus:border-google-blue outline-none transition-colors"
                    placeholder={t.enterRobotName}
                />
                {/* Current Loaded File Display */}
                {currentFileName && (
                    <div className="mt-2 flex items-center gap-1.5">
                        <FileCode className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="text-[11px] text-slate-600 dark:text-slate-400 truncate" title={currentFileName}>
                            {currentFileName}
                        </span>
                    </div>
                )}
            </div>

            {/* Top: File Browser */}
            <div
                className={`flex flex-col shrink-0 bg-white dark:bg-google-dark-bg border-b border-slate-200 dark:border-google-dark-border ${isDragging ? '' : 'transition-all duration-200'}`}
                style={{ height: isFileBrowserOpen ? `${fileBrowserHeight}px` : 'auto' }}
            >
                <div
                    className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-[#2C2C2E] cursor-pointer select-none"
                    onClick={() => setIsFileBrowserOpen(!isFileBrowserOpen)}
                >
                     <div className="flex items-center gap-2">
                        {isFileBrowserOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">{t.fileBrowser}</span>
                     </div>
                     <span className="text-[10px] text-slate-400">{availableFiles.length}</span>
                </div>

                {isFileBrowserOpen && (
                    <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar py-1">
                        {availableFiles.length === 0 ? (
                            <div className="text-xs text-slate-400 text-center py-4 italic">
                                {t.dropOrImport}
                            </div>
                        ) : (
                            fileTree.map((node) => (
                                <FileTreeNodeComponent
                                    key={node.path}
                                    node={node}
                                    depth={0}
                                    onLoadRobot={onLoadRobot}
                                    expandedFolders={expandedFolders}
                                    toggleFolder={toggleFolder}
                                />
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Vertical Resizer */}
            {isFileBrowserOpen && isStructureOpen && (
                <div
                    className="h-1 bg-slate-200 dark:bg-google-dark-border cursor-row-resize hover:bg-blue-400 transition-colors shrink-0 z-10"
                    onMouseDown={handleVerticalMouseDown}
                />
            )}

            {/* Bottom: Structure Tree */}
            <div
                className="flex flex-col min-h-0 transition-all flex-1"
                style={{ flex: isStructureOpen ? '1 1 0%' : '0 0 auto' }}
            >
                <div
                    className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-[#2C2C2E] cursor-pointer select-none border-b border-slate-200 dark:border-google-dark-border"
                    onClick={() => setIsStructureOpen(!isStructureOpen)}
                >
                     <div className="flex items-center gap-2">
                        {isStructureOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">{t.structure}</span>
                     </div>

                     {/* Master Visual Toggle */}
                     <div
                        className={`flex items-center justify-center w-5 h-5 rounded hover:bg-black/10 dark:hover:bg-[#48484A] cursor-pointer text-slate-500 dark:text-slate-400`}
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowVisual(!showVisual);
                        }}
                        title={showVisual ? t.hideAllVisuals : t.showAllVisuals}
                     >
                        {showVisual ? <Eye size={14} /> : <EyeOff size={14} />}
                     </div>
                </div>

                {isStructureOpen && (
                    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">


                        <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-google-dark-surface border-b border-slate-200 dark:border-google-dark-border shrink-0">
                             <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.structure}</span>
                             {mode === 'skeleton' && (
                                 <button
                                    className="p-1 hover:bg-blue-600 bg-blue-700 text-white rounded-md transition-colors shadow-sm"
                                    onClick={() => {
                                        let targetId = robot.rootLinkId;
                                        if (robot.selection.type === 'link' && robot.selection.id) {
                                            targetId = robot.selection.id;
                                        } else if (robot.selection.type === 'joint' && robot.selection.id) {
                                            const selectedJoint = robot.joints[robot.selection.id];
                                            if (selectedJoint) targetId = selectedJoint.childLinkId;
                                        }
                                        onAddChild(targetId);
                                    }}
                                    title={t.addChildLink}
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                </button>
                             )}
                        </div>

                        {/* 3. Content Area */}
                        <div className="flex-1 overflow-y-auto overflow-x-auto py-2 custom-scrollbar bg-white dark:bg-google-dark-bg">
                             <TreeNode
                                linkId={robot.rootLinkId}
                                robot={robot}
                                onSelect={onSelect}
                                onFocus={onFocus}
                                onAddChild={onAddChild}
                                onDelete={onDelete}
                                onUpdate={onUpdate}
                                mode={mode}
                                t={t}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Horizontal Resize Handle */}
            <div
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 transition-colors z-20"
                onMouseDown={handleMouseDown}
            />
        </div>
      )}
    </div>
  );
};
