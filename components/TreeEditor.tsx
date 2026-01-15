import React, { useState, useRef, useEffect, useCallback } from 'react';
import { RobotState, AppMode, Theme } from '../types';
import { Box, ArrowRightLeft, Plus, Trash2, ChevronDown, ChevronRight, ChevronLeft, PanelLeftOpen } from 'lucide-react';
import { translations, Language } from '../services/i18n';

interface TreeEditorProps {
  robot: RobotState;
  onSelect: (type: 'link' | 'joint', id: string) => void;
  onFocus?: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  onNameChange: (name: string) => void;
  mode: AppMode;
  lang: Language;
  collapsed?: boolean;
  onToggle?: () => void;
  theme: Theme;
}

// --- Structure View Components ---

const TreeNode = ({ 
  linkId, 
  robot, 
  onSelect, 
  onFocus,
  onAddChild, 
  onDelete,
  mode,
  t
}: { 
  linkId: string; 
  robot: RobotState; 
  onSelect: any; 
  onFocus?: any;
  onAddChild: any;
  onDelete: any;
  mode: AppMode;
  t: any;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const link = robot.links[linkId];
  if (!link) return null;

  // Find joints where this link is the parent
  const childJoints = Object.values(robot.joints).filter(j => j.parentLinkId === linkId);
  const hasChildren = childJoints.length > 0;
  
  const isSelected = robot.selection.type === 'link' && robot.selection.id === linkId;
  const isSkeleton = mode === 'skeleton';

  return (
    <div className="relative min-w-full">
      {/* Link Node */}
      <div 
        className={`relative flex items-center py-1.5 pr-8 pl-1 cursor-pointer transition-colors group whitespace-nowrap ${isSelected ? 'bg-google-blue text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-google-dark-surface hover:text-slate-900 dark:hover:text-slate-200'}`}
        onClick={() => onSelect('link', linkId)}
        onDoubleClick={() => onFocus && onFocus(linkId)}
      >
        {/* Expand/Collapse Toggle */}
        <div 
            className="w-5 h-5 flex items-center justify-center shrink-0 mr-0.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            onClick={(e) => { 
                e.stopPropagation(); 
                if (hasChildren) setIsExpanded(!isExpanded); 
            }}
        >
            {hasChildren ? (
                isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : <div className="w-3.5" />}
        </div>

        <Box className={`w-4 h-4 mr-2 shrink-0 ${isSelected ? 'text-blue-200' : 'text-blue-500'}`} />
        <span className="text-sm font-medium mr-2">{link.name}</span>
        
        {/* Actions visible on hover or if selected - Sticky Right */}
        {isSkeleton && (
            <div className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                <button 
                    onClick={(e) => { e.stopPropagation(); onAddChild(linkId); setIsExpanded(true); }}
                    className={`p-1 rounded shadow-sm ${isSelected ? 'bg-blue-500 hover:bg-blue-400 text-white' : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200'}`}
                    title={t.addChildJoint}
                >
                    <Plus className="w-3 h-3" />
                </button>
            </div>
        )}
      </div>

      {/* Children (Joints) */}
      {hasChildren && isExpanded && (
        <div className="ml-2 pl-2 border-l border-slate-200 dark:border-google-dark-border">
            {childJoints.map(joint => (
                <div key={joint.id}>
                    {/* Joint Node */}
                    <div 
                        className={`relative flex items-center py-1.5 px-2 pr-8 cursor-pointer transition-colors group whitespace-nowrap ${robot.selection.type === 'joint' && robot.selection.id === joint.id ? 'bg-google-blue text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-google-dark-surface hover:text-slate-900 dark:hover:text-slate-200'}`}
                        onClick={() => onSelect('joint', joint.id)}
                    >
                         {/* Indent spacer for joints to align nicer */}
                        <div className="w-5 mr-0.5 shrink-0" />
                        
                        <ArrowRightLeft className={`w-3.5 h-3.5 mr-2 shrink-0 ${robot.selection.type === 'joint' && robot.selection.id === joint.id ? 'text-orange-200' : 'text-orange-500'}`} />
                        <span className="text-sm mr-2">{joint.name}</span>
                        
                         {/* Joint Actions - Sticky Right */}
                        {isSkeleton && (
                            <div className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 ${robot.selection.type === 'joint' && robot.selection.id === joint.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                                <button 
                                    onClick={(e) => { 
                                        e.stopPropagation(); 
                                        onDelete(joint.childLinkId); 
                                    }}
                                    className={`p-1 rounded shadow-sm ${robot.selection.type === 'joint' && robot.selection.id === joint.id ? 'bg-blue-500 hover:bg-blue-400 text-white' : 'bg-slate-200 dark:bg-google-dark-surface hover:bg-slate-300 dark:hover:bg-google-dark-border text-slate-600 dark:text-slate-200'}`}
                                    title={t.deleteBranch}
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Recursive Child Link */}
                    <div className="ml-2 pl-2 border-l border-slate-200 dark:border-google-dark-border">
                        <TreeNode 
                            linkId={joint.childLinkId} 
                            robot={robot} 
                            onSelect={onSelect}
                            onFocus={onFocus}
                            onAddChild={onAddChild}
                            onDelete={onDelete}
                            mode={mode}
                            t={t}
                        />
                    </div>
                </div>
            ))}
        </div>
      )}
    </div>
  );
};

export const TreeEditor: React.FC<TreeEditorProps> = ({ robot, onSelect, onFocus, onAddChild, onDelete, onNameChange, mode, lang, collapsed, onToggle, theme }) => {
  const t = translations[lang];
  const [width, setWidth] = useState(288); // 72 * 4 = 288px (w-72)
  const [isDragging, setIsDragging] = useState(false);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    setIsDragging(true);
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.max(200, Math.min(600, startWidth.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
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

  // Compute actual width based on collapsed state
  const actualWidth = collapsed ? 0 : width;

  return (
    <div 
      className={`bg-slate-50 dark:bg-google-dark-bg border-r border-slate-200 dark:border-google-dark-border flex flex-col h-full shrink-0 relative ${isDragging ? '' : 'transition-all duration-300 ease-in-out'}`}
      style={{ width: `${actualWidth}px`, minWidth: `${actualWidth}px`, flex: `0 0 ${actualWidth}px`, overflow: 'visible' }}
    >
      {/* Side Toggle Button (Centered & Protruding) */}
      <button
          onClick={onToggle}
          className="absolute -right-4 top-1/2 -translate-y-1/2 w-4 h-16 bg-white dark:bg-slate-800 hover:bg-blue-500 dark:hover:bg-blue-600 hover:text-white border border-slate-300 dark:border-slate-600 rounded-r-lg shadow-md flex flex-col items-center justify-center z-50 cursor-pointer text-slate-400 hover:text-white transition-all group"
          title={collapsed ? t.structure : t.collapseSidebar}
      >
          <div className="flex flex-col gap-0.5 items-center">
            <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-blue-200" />
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-blue-200" />
          </div>
      </button>

      {!collapsed && (
        <>
          {/* Header without toggle */}
          <div className="flex items-center justify-between px-2 pt-2 shrink-0">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t.structure}</span>
          </div>

          {/* 1. Robot Name Input */}
          <div className="px-4 pt-2 pb-2 bg-slate-50 dark:bg-google-dark-bg border-b border-slate-200 dark:border-google-dark-border shrink-0">
             <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1 block">{t.robotName}</label>
             <input 
                type="text" 
                value={robot.name}
                onChange={(e) => onNameChange(e.target.value)}
                className="w-full bg-white dark:bg-google-dark-surface focus:bg-white dark:focus:bg-google-dark-surface text-sm text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-300 dark:border-google-dark-border focus:border-google-blue outline-none transition-colors"
                placeholder={t.enterRobotName}
            />
          </div>

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
                            // If a joint is selected, add to its child link
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
                mode={mode}
                t={t}
            />
          </div>
          
          {/* Resize Handle */}
          <div 
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 transition-colors z-10"
            onMouseDown={handleMouseDown}
          />
        </>
      )}
    </div>
  );
};