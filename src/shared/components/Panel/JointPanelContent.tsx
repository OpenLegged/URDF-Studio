import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, RotateCcw, Settings, Unlock } from 'lucide-react';
import { JointControlItem } from './JointControlItem';
import type { JointControlItemJoint } from './jointControlItemTypes';
import { getSingleDofJointEntries } from '@/shared/utils/jointTypes';
import { resolveViewerJointAngleValue } from '@/shared/utils/jointPanelState';
import {
  getMjcfJointDisplayName,
  getMjcfLinkDisplayName,
} from '@/shared/utils/robot/mjcfDisplayNames';
import type { JointPanelActiveJointOptions, JointPanelStore } from '@/shared/utils/jointPanelStore';
import type { TranslationKeys } from '@/shared/i18n';
import type { RobotInspectionContext, UrdfJoint, UrdfLink } from '@/types';

export type JointPanelAngleUnit = 'rad' | 'deg';

export type JointPanelTranslations = Partial<
  Pick<
    TranslationKeys,
    | 'advanced'
    | 'collapse'
    | 'close'
    | 'expand'
    | 'ignoreJointLimits'
    | 'ignoreJointLimitsHint'
    | 'ignoreJointLimitsOn'
    | 'joints'
    | 'reset'
    | 'resetJoints'
    | 'resize'
    | 'switchUnit'
  >
>;

export interface JointPanelJoint extends JointControlItemJoint {
  angle?: number;
  childLinkId?: string;
  dynamics?: UrdfJoint['dynamics'];
  hardware?: UrdfJoint['hardware'];
  jointValue?: number | number[] | null;
  origin?: UrdfJoint['origin'];
  parentLinkId?: string;
  urdfName?: string;
}

export interface JointPanelLink {
  id?: string | number;
  name?: string;
  urdfName?: string;
  userData?: Record<string, unknown>;
  visual?: UrdfLink['visual'];
  visualBodies?: UrdfLink['visualBodies'];
  collision?: UrdfLink['collision'];
  collisionBodies?: UrdfLink['collisionBodies'];
}

export interface JointPanelRobot {
  links?: Record<string, JointPanelLink>;
  joints?: Record<string, JointPanelJoint>;
  inspectionContext?: {
    sourceFormat?: RobotInspectionContext['sourceFormat'] | string | null;
  } | null;
}

interface JointPanelItemBindingProps {
  name: string;
  joint: JointPanelJoint;
  displayName?: string;
  angleUnit: JointPanelAngleUnit;
  jointPanelStore: JointPanelStore;
  setActiveJoint: (name: string | null, options?: JointPanelActiveJointOptions) => void;
  handleJointAngleChange: (name: string, angle: number) => void;
  handleJointChangeCommit: (name: string, angle: number) => void;
  setIsDragging?: (dragging: boolean) => void;
  onSelect?: (type: 'link' | 'joint', id: string) => void;
  isAdvanced?: boolean;
  ignoreLimits?: boolean;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  compact?: boolean;
}

interface JointPanelItemSnapshot {
  value: number;
  isActive: boolean;
  shouldAutoScroll: boolean;
}

export interface JointPanelControlsProps {
  t: JointPanelTranslations;
  angleUnit: JointPanelAngleUnit;
  setAngleUnit: (unit: JointPanelAngleUnit) => void;
  isAdvanced: boolean;
  setIsAdvanced: React.Dispatch<React.SetStateAction<boolean>>;
  onReset?: () => void;
  ignoreLimits?: boolean;
  onToggleIgnoreLimits?: (ignore: boolean) => void;
  compact?: boolean;
}

export interface JointPanelListProps {
  robot: JointPanelRobot | null | undefined;
  angleUnit: JointPanelAngleUnit;
  jointPanelStore: JointPanelStore;
  setActiveJoint: (name: string | null, options?: JointPanelActiveJointOptions) => void;
  handleJointAngleChange: (name: string, angle: number) => void;
  handleJointChangeCommit: (name: string, angle: number) => void;
  setIsDragging?: (dragging: boolean) => void;
  onSelect?: (type: 'link' | 'joint', id: string) => void;
  onHover?: (
    type: 'link' | 'joint' | null,
    id: string | null,
    subType?: 'visual' | 'collision',
  ) => void;
  isAdvanced?: boolean;
  ignoreLimits?: boolean;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  className?: string;
  compact?: boolean;
}

function areJointPanelItemSnapshotsEqual(a: JointPanelItemSnapshot, b: JointPanelItemSnapshot) {
  return (
    a.value === b.value && a.isActive === b.isActive && a.shouldAutoScroll === b.shouldAutoScroll
  );
}

function resolveJointPanelItemSnapshot(
  jointPanelStore: JointPanelStore,
  name: string,
  joint: JointPanelJoint,
): JointPanelItemSnapshot {
  const snapshot = jointPanelStore.getSnapshot();

  return {
    value: resolveViewerJointAngleValue(
      snapshot.jointAngles,
      name,
      getJointAngleLike(joint),
      0,
    ),
    isActive: snapshot.activeJoint === name,
    shouldAutoScroll: snapshot.activeJoint === name && snapshot.activeJointAutoScroll,
  };
}

function useJointPanelItemSnapshot(
  jointPanelStore: JointPanelStore,
  name: string,
  joint: JointPanelJoint,
) {
  const getSnapshot = useCallback(
    () => resolveJointPanelItemSnapshot(jointPanelStore, name, joint),
    [jointPanelStore, joint, name],
  );

  const [itemSnapshot, setItemSnapshot] = useState<JointPanelItemSnapshot>(() => getSnapshot());

  useEffect(() => {
    const syncSnapshot = () => {
      setItemSnapshot((previousSnapshot) => {
        const nextSnapshot = getSnapshot();
        return areJointPanelItemSnapshotsEqual(previousSnapshot, nextSnapshot)
          ? previousSnapshot
          : nextSnapshot;
      });
    };

    syncSnapshot();
    return jointPanelStore.subscribe(syncSnapshot);
  }, [getSnapshot, jointPanelStore]);

  return itemSnapshot;
}

function getJointAngleLike(joint: JointPanelJoint) {
  const rawJointValue = Array.isArray(joint.jointValue) ? joint.jointValue[0] : joint.jointValue;
  return {
    angle: joint.angle,
    jointValue: rawJointValue ?? undefined,
    name: joint.name,
  };
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getNumericIdValue(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

function resolveJointPanelLinkId(link: JointPanelLink, fallbackId: string): string {
  return (
    getStringValue(link.userData?.linkId) ??
    getStringValue(link.id) ??
    getStringValue(link.urdfName) ??
    getStringValue(link.name) ??
    getNumericIdValue(link.id) ??
    fallbackId
  );
}

function resolveJointPanelLinkDisplayName(
  link: JointPanelLink,
  fallbackId: string,
  isMjcfSource: boolean,
): string {
  if (isMjcfSource && isUrdfLink(link)) {
    return getMjcfLinkDisplayName(link);
  }

  return (
    getStringValue(link.userData?.displayName) ??
    getStringValue(link.name) ??
    getStringValue(link.urdfName) ??
    fallbackId
  );
}

function resolveJointPanelJointDisplayName(
  name: string,
  joint: JointPanelJoint,
  linkDisplayNames: Record<string, string>,
  isMjcfSource: boolean,
): string {
  if (isMjcfSource && isUrdfJoint(joint)) {
    return getMjcfJointDisplayName(
      joint,
      linkDisplayNames[joint.parentLinkId] || joint.parentLinkId,
      linkDisplayNames[joint.childLinkId] || joint.childLinkId,
    );
  }

  return getStringValue(joint.name) ?? getStringValue(joint.urdfName) ?? name;
}

function isUrdfLink(link: JointPanelLink): link is UrdfLink {
  return (
    typeof link.id === 'string' &&
    typeof link.name === 'string' &&
    link.visual !== undefined &&
    link.collision !== undefined
  );
}

function isUrdfJoint(joint: JointPanelJoint): joint is UrdfJoint {
  return (
    typeof joint.id === 'string' &&
    typeof joint.name === 'string' &&
    typeof joint.parentLinkId === 'string' &&
    typeof joint.childLinkId === 'string' &&
    typeof joint.origin === 'object' &&
    joint.origin !== null &&
    typeof joint.dynamics === 'object' &&
    joint.dynamics !== null &&
    typeof joint.hardware === 'object' &&
    joint.hardware !== null
  );
}

const JointPanelItemBinding = React.memo(function JointPanelItemBinding({
  name,
  joint,
  displayName,
  angleUnit,
  jointPanelStore,
  setActiveJoint,
  handleJointAngleChange,
  handleJointChangeCommit,
  setIsDragging,
  onSelect,
  isAdvanced = false,
  ignoreLimits = false,
  onUpdate,
  compact = true,
}: JointPanelItemBindingProps) {
  const { value, isActive, shouldAutoScroll } = useJointPanelItemSnapshot(
    jointPanelStore,
    name,
    joint,
  );

  return (
    <JointControlItem
      name={name}
      joint={joint}
      displayName={displayName}
      value={value}
      angleUnit={angleUnit}
      isActive={isActive}
      shouldAutoScroll={shouldAutoScroll}
      setActiveJoint={setActiveJoint}
      handleJointAngleChange={handleJointAngleChange}
      handleJointChangeCommit={handleJointChangeCommit}
      setIsDragging={setIsDragging}
      onSelect={onSelect}
      isAdvanced={isAdvanced}
      ignoreLimits={ignoreLimits}
      onUpdate={onUpdate}
      compact={compact}
      dragSyncMode="animationFrame"
    />
  );
});

export function JointPanelControls({
  t,
  angleUnit,
  setAngleUnit,
  isAdvanced,
  setIsAdvanced,
  onReset,
  ignoreLimits = false,
  onToggleIgnoreLimits,
  compact = false,
}: JointPanelControlsProps) {
  const buttonHeightClass = compact ? 'h-5' : 'h-6';
  const sidePaddingClass = compact ? 'px-1' : 'px-1 @[300px]:px-2';
  const textClass = compact ? 'hidden' : 'text-[10px] hidden @[300px]:inline whitespace-nowrap';
  const iconClass = compact ? 'h-2.5 w-2.5' : 'w-3 h-3';
  const unitMinWidthClass = compact ? 'min-w-[24px]' : 'min-w-[26px] @[300px]:min-w-[32px]';

  return (
    <div className="mr-1 flex shrink-0 items-center gap-0.5 @[320px]:gap-1">
      {onReset ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onReset();
          }}
          className={`inline-flex ${buttonHeightClass} items-center justify-center gap-1 rounded border border-border-black/60 bg-panel-bg ${sidePaddingClass} text-text-secondary transition-colors hover:bg-system-blue/10 hover:text-system-blue`}
          title={t.resetJoints}
        >
          <RotateCcw className={iconClass} />
          <span className={textClass}>{t.reset || 'Reset'}</span>
        </button>
      ) : null}
      {onToggleIgnoreLimits ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleIgnoreLimits(!ignoreLimits);
          }}
          className={`inline-flex ${buttonHeightClass} items-center justify-center gap-1 rounded border ${sidePaddingClass} transition-colors ${
            ignoreLimits
              ? 'border-warning-border bg-warning-soft text-warning hover:bg-warning/15'
              : 'border-border-black/60 bg-panel-bg text-text-secondary hover:bg-system-blue/10 hover:text-system-blue'
          }`}
          title={`${ignoreLimits ? t.ignoreJointLimitsOn : t.ignoreJointLimits}\n${t.ignoreJointLimitsHint ?? ''}`.trim()}
          aria-pressed={ignoreLimits}
          data-testid="joint-panel-ignore-limits-toggle"
        >
          {/* The padlock mirrors the constraint, not the action: closed while the
              authored limits still bound the joint, open once they are lifted. */}
          {ignoreLimits ? (
            <Unlock className={iconClass} />
          ) : (
            <Lock className={iconClass} />
          )}
          <span className={textClass}>{t.ignoreJointLimits}</span>
        </button>
      ) : null}
      <button
        onClick={(event) => {
          event.stopPropagation();
          setIsAdvanced((previous) => !previous);
        }}
        className={`inline-flex ${buttonHeightClass} items-center justify-center gap-1 rounded border border-border-black/60 ${sidePaddingClass} transition-colors ${
          isAdvanced
            ? 'bg-system-blue-solid text-white border-system-blue-solid'
            : 'bg-panel-bg text-text-secondary hover:bg-system-blue/10 hover:text-system-blue'
        }`}
        title={t.advanced || 'Advanced'}
      >
        <Settings className={iconClass} />
        <span className={textClass}>{t.advanced || 'Advanced'}</span>
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          setAngleUnit(angleUnit === 'rad' ? 'deg' : 'rad');
        }}
        className={`inline-flex ${buttonHeightClass} ${unitMinWidthClass} items-center justify-center rounded bg-element-bg px-1 text-[10px] font-mono text-text-secondary transition-colors hover:bg-element-hover dark:text-text-secondary`}
        title={t.switchUnit}
      >
        {angleUnit.toUpperCase()}
      </button>
    </div>
  );
}

export function JointPanelList({
  robot,
  angleUnit,
  jointPanelStore,
  setActiveJoint,
  handleJointAngleChange,
  handleJointChangeCommit,
  setIsDragging,
  onSelect,
  onHover,
  isAdvanced = false,
  ignoreLimits = false,
  onUpdate,
  className = 'space-y-0.5 px-1 py-1',
  compact = true,
}: JointPanelListProps) {
  const onHoverRef = useRef(onHover);
  const jointEntries = useMemo(() => getSingleDofJointEntries(robot?.joints), [robot?.joints]);
  const isMjcfSource = robot?.inspectionContext?.sourceFormat === 'mjcf';
  const linkDisplayNames = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        Object.entries(robot?.links ?? {}).map(([linkKey, link]) => {
          const linkId = resolveJointPanelLinkId(link, linkKey);
          return [linkId, resolveJointPanelLinkDisplayName(link, linkId, isMjcfSource)];
        }),
      ),
    [isMjcfSource, robot?.links],
  );

  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    return () => {
      onHoverRef.current?.(null, null);
    };
  }, []);

  const clearGlobalHover = useCallback(() => {
    onHoverRef.current?.(null, null);
  }, []);

  return (
    <div
      className={`w-full min-w-0 ${className}`}
      onMouseEnter={clearGlobalHover}
      onMouseLeave={clearGlobalHover}
    >
      {jointEntries.map(([name, joint]) => (
        <JointPanelItemBinding
          key={name}
          name={name}
          joint={joint}
          displayName={resolveJointPanelJointDisplayName(
            name,
            joint,
            linkDisplayNames,
            isMjcfSource,
          )}
          angleUnit={angleUnit}
          jointPanelStore={jointPanelStore}
          setActiveJoint={setActiveJoint}
          handleJointAngleChange={handleJointAngleChange}
          handleJointChangeCommit={handleJointChangeCommit}
          setIsDragging={setIsDragging}
          onSelect={onSelect}
          isAdvanced={isAdvanced}
          ignoreLimits={ignoreLimits}
          onUpdate={onUpdate}
          compact={compact}
        />
      ))}
    </div>
  );
}
