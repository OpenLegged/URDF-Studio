import React from 'react';
import { RotateCcw, X } from 'lucide-react';
import { JointControlItem } from './JointControlItem';

interface JointsPanelProps {
    showJointControls: boolean;
    showJointPanel: boolean;
    robot: any;
    jointPanelRef: React.RefObject<HTMLDivElement>;
    jointPanelPos: { x: number; y: number } | null;
    onMouseDown: (e: React.MouseEvent) => void;
    t: any;
    handleResetJoints: () => void;
    angleUnit: 'rad' | 'deg';
    setAngleUnit: (unit: 'rad' | 'deg') => void;
    isJointsCollapsed: boolean;
    toggleJointsCollapsed: () => void;
    setShowJointPanel?: (show: boolean) => void;
    jointAngles: Record<string, number>;
    activeJoint: string | null;
    setActiveJoint: (name: string | null) => void;
    handleJointAngleChange: (name: string, angle: number) => void;
    handleJointChangeCommit: (name: string, angle: number) => void;
    onSelect?: (type: 'link' | 'joint', id: string) => void;
}

export const JointsPanel: React.FC<JointsPanelProps> = ({
    showJointControls,
    showJointPanel,
    robot,
    jointPanelRef,
    jointPanelPos,
    onMouseDown,
    t,
    handleResetJoints,
    angleUnit,
    setAngleUnit,
    isJointsCollapsed,
    toggleJointsCollapsed,
    setShowJointPanel,
    jointAngles,
    activeJoint,
    setActiveJoint,
    handleJointAngleChange,
    handleJointChangeCommit,
    onSelect,
}) => {
    if (!showJointControls || !showJointPanel || !robot?.joints || Object.keys(robot.joints).length === 0) {
        return null;
    }

    return (
        <div
            ref={jointPanelRef}
            className="absolute z-30 bg-white dark:bg-panel-bg rounded-lg border border-slate-200 dark:border-border-black max-h-[50vh] overflow-hidden w-64 shadow-xl dark:shadow-black flex flex-col pointer-events-auto"
            style={jointPanelPos
                ? { left: jointPanelPos.x, top: jointPanelPos.y, right: 'auto', bottom: 'auto' }
                : { bottom: '16px', right: '16px' }
            }
        >
            <div
                className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100 dark:bg-element-active hover:bg-slate-100 dark:hover:bg-element-active select-none flex items-center justify-between shrink-0"
                onMouseDown={onMouseDown}
            >
                <div className="flex items-center gap-2">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                    </svg>
                    {t.jointControls}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => { e.stopPropagation(); handleResetJoints(); }}
                        className="p-1 rounded bg-slate-200 dark:bg-google-dark-bg hover:bg-slate-300 dark:hover:bg-google-dark-border text-slate-700 dark:text-white"
                        title={t.resetJoints}
                    >
                        <RotateCcw className="w-3 h-3" />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); setAngleUnit(angleUnit === 'rad' ? 'deg' : 'rad'); }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-google-dark-bg hover:bg-slate-300 dark:hover:bg-google-dark-border text-slate-700 dark:text-white font-mono"
                        title={t.switchUnit}
                    >
                        {angleUnit.toUpperCase()}
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); toggleJointsCollapsed(); }}
                        className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                    >
                        {isJointsCollapsed ? (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                        )}
                    </button>
                    {setShowJointPanel && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowJointPanel(false); }}
                            className="text-slate-400 dark:hover:text-white p-1 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 rounded"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>
            {!isJointsCollapsed && (
                <div className="p-3 overflow-y-auto flex-1">
                    <div className="space-y-2">
                        {Object.entries(robot.joints)
                            .filter(([_, joint]: [string, any]) => joint.jointType !== 'fixed')
                            .map(([name, joint]: [string, any]) => (
                                <JointControlItem
                                    key={name}
                                    name={name}
                                    joint={joint}
                                    jointAngles={jointAngles}
                                    angleUnit={angleUnit}
                                    activeJoint={activeJoint}
                                    setActiveJoint={setActiveJoint}
                                    handleJointAngleChange={handleJointAngleChange}
                                    handleJointChangeCommit={handleJointChangeCommit}
                                    onSelect={onSelect}
                                />
                            ))}
                    </div>
                </div>
            )}
        </div>
    );
};
