
import React, { useState } from 'react';
import { RobotState, AppMode } from '../types';
import { Box, ArrowRightLeft, Plus, Trash2, ChevronDown, ChevronRight, ChevronLeft, PanelLeftOpen } from 'lucide-react';
import { translations, Language } from '../services/i18n';

interface TreeEditorProps {
  robot: RobotState;
  onSelect: (type: 'link' | 'joint', id: string) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  onNameChange: (name: string) => void;
  mode: AppMode;
  lang: Language;
  collapsed?: boolean;
  onToggle?: () => void;
}

// --- Structure View Components ---

const TreeNode = ({ 
  linkId, 
  robot, 
  onSelect, 
  onAddChild, 
  onDelete,
  mode,
  t
}: { 
  linkId: string; 
  robot: RobotState; 
  onSelect: any; 
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
        className={`relative flex items-center py-1.5 pr-8 pl-1 cursor-pointer transition-colors group whitespace-nowrap ${isSelected ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
        onClick={() => onSelect('link', linkId)}
      >
        {/* Expand/Collapse Toggle */}
        <div 
            className="w-5 h-5 flex items-center justify-center shrink-0 mr-0.5 text-slate-500 hover:text-slate-300"
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
                    className={`p-1 rounded shadow-sm ${isSelected ? 'bg-blue-500 hover:bg-blue-400 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
                    title={t.addChildJoint}
                >
                    <Plus className="w-3 h-3" />
                </button>
            </div>
        )}
      </div>

      {/* Children (Joints) */}
      {hasChildren && isExpanded && (
        <div className="ml-2 pl-2 border-l border-slate-700">
            {childJoints.map(joint => (
                <div key={joint.id}>
                    {/* Joint Node */}
                    <div 
                        className={`relative flex items-center py-1.5 px-2 pr-8 cursor-pointer transition-colors group whitespace-nowrap ${robot.selection.type === 'joint' && robot.selection.id === joint.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
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
                                    className={`p-1 rounded shadow-sm ${robot.selection.type === 'joint' && robot.selection.id === joint.id ? 'bg-blue-500 hover:bg-blue-400 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
                                    title={t.deleteBranch}
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Recursive Child Link */}
                    <div className="ml-2 pl-2 border-l border-slate-700">
                        <TreeNode 
                            linkId={joint.childLinkId} 
                            robot={robot} 
                            onSelect={onSelect}
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

export const TreeEditor: React.FC<TreeEditorProps> = ({ robot, onSelect, onAddChild, onDelete, onNameChange, mode, lang, collapsed, onToggle }) => {
  const t = translations[lang];

  // Collapsed state - show only expand button
  if (collapsed) {
    return (
      <div className="w-10 bg-[#0b1120] border-r border-slate-800 flex flex-col items-center py-4 shrink-0">
        <button
          onClick={onToggle}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
          title={t.structure}
        >
          <PanelLeftOpen className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 bg-[#0b1120] border-r border-slate-800 flex flex-col h-full shrink-0">
      
      {/* Collapse button */}
      <div className="flex items-center justify-between px-2 pt-2 shrink-0">
        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t.structure}</span>
        <button
          onClick={onToggle}
          className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
          title="Collapse sidebar"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* 1. Robot Name Input */}
      <div className="px-4 pt-2 pb-2 bg-[#0b1120] border-b border-slate-800 shrink-0">
         <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1 block">{t.robotName}</label>
         <input 
            type="text" 
            value={robot.name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full bg-slate-800/50 focus:bg-slate-800 text-sm text-white px-3 py-2 rounded border border-slate-700 focus:border-blue-500 outline-none transition-colors"
            placeholder="Enter robot name..."
        />
      </div>

      <div className="flex items-center justify-between px-4 py-2 bg-[#0f172a] border-b border-slate-800 shrink-0">
         <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.structure}</span>
         {mode === 'skeleton' && (
             <button 
                className="p-1 hover:bg-blue-600 bg-blue-700 text-white rounded transition-colors shadow-sm"
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
      <div className="flex-1 overflow-y-auto overflow-x-auto py-2 custom-scrollbar bg-[#0f172a]">
         <TreeNode 
            linkId={robot.rootLinkId} 
            robot={robot} 
            onSelect={onSelect} 
            onAddChild={onAddChild}
            onDelete={onDelete}
            mode={mode}
            t={t}
        />
      </div>
    </div>
  );
};
