import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Object3D } from 'three';
import { translations } from '../../shared/i18n';
import { useResolvedTheme } from '../../shared/hooks/useTheme';
import type {
  RuntimeJointObject,
  RuntimeRobotObject,
} from '../../shared/components/3d/runtimeRobotTypes';
import { JointInteraction } from '../../features/urdf-viewer/components/JointInteraction';
import { RobotModel } from '../../features/urdf-viewer/components/RobotModel';
import { isSingleDofJoint } from '../../shared/utils/jointTypes';
import { useControllableState } from '../hooks/useControllableState';
import {
  DEFAULT_ROBOT_CANVAS_DISPLAY_OPTIONS,
  DEFAULT_ROBOT_CANVAS_SELECTION,
  type RobotCanvasProps,
  type RobotCanvasSelection,
} from '../types';
import { RobotCanvasViewport } from './RobotCanvasViewport';

type InteractiveRuntimeJoint = RuntimeJointObject & {
  angle?: number;
  child?: Object3D;
  setJointValue?: (value: number) => void;
};

type InteractiveRuntimeRobot = RuntimeRobotObject & {
  joints?: Record<string, InteractiveRuntimeJoint>;
};

function asInteractiveRuntimeRobot(robot: RuntimeRobotObject): InteractiveRuntimeRobot {
  return robot as InteractiveRuntimeRobot;
}

function mergeDisplayOptions(display?: RobotCanvasProps['display']) {
  return {
    ...DEFAULT_ROBOT_CANVAS_DISPLAY_OPTIONS,
    ...display,
  };
}

export const RobotCanvas = memo(function RobotCanvas({
  source,
  assets = {},
  lang = 'en',
  theme = 'system',
  mode = 'editor',
  className,
  style,
  selection,
  defaultSelection = DEFAULT_ROBOT_CANVAS_SELECTION,
  hoveredSelection,
  onSelectionChange,
  onHoverChange,
  onMeshSelect,
  jointAngles,
  defaultJointAngles = {},
  onJointAnglesChange,
  onJointChange,
  display,
  allowUrdfXmlFallback = true,
  robotLinks,
  robotJoints,
  focusTarget,
  groundPlaneOffset = 0,
  snapshotAction,
  orbitEnabled = true,
  showUsageGuide = false,
  enableJointInteraction = true,
  isMeshPreview = false,
  onPointerMissed,
  onRobotLoaded,
  onOrbitStart,
  onOrbitEnd,
  onCollisionTransformPreview,
  onCollisionTransform,
  onTransformPendingChange,
}: RobotCanvasProps) {
  const t = translations[lang];
  const resolvedTheme = useResolvedTheme(theme);
  const rootClassName = [
    'urdf-studio-canvas',
    resolvedTheme === 'dark' ? 'dark' : '',
    'relative h-full w-full',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const resolvedDisplay = useMemo(() => mergeDisplayOptions(display), [display]);
  const [resolvedSelection, setResolvedSelection] = useControllableState<RobotCanvasSelection>({
    value: selection,
    defaultValue: defaultSelection,
    onChange: onSelectionChange,
  });
  const [resolvedJointAngles, setResolvedJointAngles] = useControllableState<
    Record<string, number>
  >({
    value: jointAngles,
    defaultValue: defaultJointAngles,
    onChange: onJointAnglesChange,
  });
  const [robot, setRobot] = useState<InteractiveRuntimeRobot | null>(null);
  const [activeJoint, setActiveJoint] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isOrbitDragging = useRef(false);
  const justSelectedRef = useRef(false);
  const transformPendingRef = useRef(false);

  const handleRobotLoaded = useCallback(
    (loadedRobot: RuntimeRobotObject) => {
      const interactiveRobot = asInteractiveRuntimeRobot(loadedRobot);
      setRobot(interactiveRobot);
      onRobotLoaded?.(loadedRobot);

      const loadedJoints = interactiveRobot.joints;
      if (!loadedJoints || jointAngles !== undefined) {
        return;
      }

      setResolvedJointAngles((previousAngles) => {
        const nextAngles: Record<string, number> = {};

        Object.keys(loadedJoints).forEach((jointName) => {
          const joint = loadedJoints[jointName];
          if (!isSingleDofJoint(joint)) return;

          nextAngles[jointName] = previousAngles[jointName] ?? joint.angle ?? 0;
        });

        return nextAngles;
      });
    },
    [jointAngles, onRobotLoaded, setResolvedJointAngles],
  );

  const handleJointAngleChange = useCallback(
    (jointName: string, angle: number) => {
      const loadedJoint = robot?.joints?.[jointName];
      if (!loadedJoint || !isSingleDofJoint(loadedJoint)) {
        return;
      }

      loadedJoint.setJointValue?.(angle);
      setResolvedJointAngles((previousAngles) => ({
        ...previousAngles,
        [jointName]: angle,
      }));
    },
    [robot, setResolvedJointAngles],
  );

  const handleJointChangeCommit = useCallback(
    (jointName: string, angle: number) => {
      onJointChange?.(jointName, angle);
    },
    [onJointChange],
  );

  const handleTransformPending = useCallback(
    (pending: boolean) => {
      transformPendingRef.current = pending;
      onTransformPendingChange?.(pending);
    },
    [onTransformPendingChange],
  );

  useEffect(() => {
    return () => {
      transformPendingRef.current = false;
      onTransformPendingChange?.(false);
    };
  }, [onTransformPendingChange]);

  const handleSelectionUpdate = useCallback(
    (nextSelection: RobotCanvasSelection) => {
      setResolvedSelection(nextSelection);
    },
    [setResolvedSelection],
  );

  const handleSelect = useCallback(
    (type: 'link' | 'joint' | 'tendon', id: string, subType?: 'visual' | 'collision') => {
      if (transformPendingRef.current) {
        return;
      }

      handleSelectionUpdate({
        type,
        id,
        subType,
      });
    },
    [handleSelectionUpdate],
  );

  const handleMeshSelection = useCallback(
    (
      linkId: string,
      jointId: string | null,
      objectIndex: number,
      objectType: 'visual' | 'collision',
    ) => {
      onMeshSelect?.(linkId, jointId, objectIndex, objectType);
      handleSelectionUpdate({
        type: 'link',
        id: linkId,
        subType: objectType,
        objectIndex,
      });
    },
    [handleSelectionUpdate, onMeshSelect],
  );

  const handleHover = useCallback(
    (
      type: 'link' | 'joint' | 'tendon' | null,
      id: string | null,
      subType?: 'visual' | 'collision',
      objectIndex?: number,
    ) => {
      onHoverChange?.({
        type,
        id,
        subType,
        objectIndex,
      });
    },
    [onHoverChange],
  );

  const handlePointerMissedInternal = useCallback(() => {
    if (justSelectedRef.current || transformPendingRef.current) {
      return;
    }

    handleSelectionUpdate(DEFAULT_ROBOT_CANVAS_SELECTION);
    setActiveJoint(null);
    onPointerMissed?.();
  }, [handleSelectionUpdate, onPointerMissed]);

  useEffect(() => {
    const robotJoints = robot?.joints;
    if (!robotJoints) {
      setActiveJoint(null);
      return;
    }

    if (resolvedSelection.type === 'joint' && resolvedSelection.id) {
      const selectedJoint = robotJoints[resolvedSelection.id];
      setActiveJoint(isSingleDofJoint(selectedJoint) ? resolvedSelection.id : null);
      return;
    }

    if (resolvedSelection.type === 'link' && resolvedSelection.id) {
      const matchingJointName = Object.keys(robotJoints).find((jointName) => {
        const joint = robotJoints[jointName];
        return joint?.child?.name === resolvedSelection.id && isSingleDofJoint(joint);
      });

      setActiveJoint(matchingJointName ?? null);
      return;
    }

    setActiveJoint(null);
  }, [resolvedSelection.id, resolvedSelection.type, robot]);

  return (
    <div className={rootClassName} style={style} data-lang={lang} data-theme={resolvedTheme}>
      <RobotCanvasViewport
        lang={lang}
        resolvedTheme={resolvedTheme}
        groundOffset={groundPlaneOffset}
        snapshotAction={snapshotAction}
        robotName={robot?.name || 'robot'}
        orbitEnabled={orbitEnabled && !isDragging}
        onOrbitStart={() => {
          isOrbitDragging.current = true;
          onOrbitStart?.();
        }}
        onOrbitEnd={() => {
          isOrbitDragging.current = false;
          onOrbitEnd?.();
        }}
        onPointerMissed={handlePointerMissedInternal}
        showUsageGuide={showUsageGuide}
      >
        <RobotModel
          urdfContent={source.content}
          assets={assets}
          sourceFormat={source.format}
          allowUrdfXmlFallback={allowUrdfXmlFallback}
          sourceFilePath={source.sourceFilePath}
          onRobotLoaded={handleRobotLoaded}
          showCollision={resolvedDisplay.showCollision}
          showVisual={resolvedDisplay.showVisual}
          onSelect={handleSelect}
          onHover={handleHover}
          onMeshSelect={handleMeshSelection}
          onJointChange={handleJointAngleChange}
          onJointChangeCommit={handleJointChangeCommit}
          initialJointAngles={resolvedJointAngles}
          setIsDragging={setIsDragging}
          setActiveJoint={(jointName) => setActiveJoint(jointName)}
          justSelectedRef={justSelectedRef}
          t={t}
          mode={mode}
          selection={resolvedSelection}
          hoveredSelection={hoveredSelection}
          hoverSelectionEnabled={false}
          showInertia={resolvedDisplay.showInertia}
          showInertiaOverlay={resolvedDisplay.showInertiaOverlay}
          showCenterOfMass={resolvedDisplay.showCenterOfMass}
          showCoMOverlay={resolvedDisplay.showCoMOverlay}
          centerOfMassSize={resolvedDisplay.centerOfMassSize}
          showOrigins={resolvedDisplay.showOrigins}
          showOriginsOverlay={resolvedDisplay.showOriginsOverlay}
          originSize={resolvedDisplay.originSize}
          showJointAxes={resolvedDisplay.showJointAxes}
          showJointAxesOverlay={resolvedDisplay.showJointAxesOverlay}
          jointAxisSize={resolvedDisplay.jointAxisSize}
          modelOpacity={resolvedDisplay.modelOpacity}
          robotLinks={robotLinks}
          robotJoints={robotJoints}
          focusTarget={focusTarget}
          transformMode={resolvedDisplay.transformMode}
          toolMode={resolvedDisplay.toolMode}
          onCollisionTransformPreview={onCollisionTransformPreview}
          onCollisionTransformEnd={onCollisionTransform}
          isOrbitDragging={isOrbitDragging}
          onTransformPending={handleTransformPending}
          isSelectionLockedRef={transformPendingRef}
          isMeshPreview={isMeshPreview}
          groundPlaneOffset={groundPlaneOffset}
        />
      </RobotCanvasViewport>

      {enableJointInteraction && activeJoint && robot?.joints?.[activeJoint] ? (
        <JointInteraction
          joint={robot.joints[activeJoint]}
          value={resolvedJointAngles[activeJoint] || 0}
          onChange={(value) => handleJointAngleChange(activeJoint, value)}
          onCommit={(value) => handleJointChangeCommit(activeJoint, value)}
          setIsDragging={setIsDragging}
          onInteractionLockChange={handleTransformPending}
        />
      ) : null}
    </div>
  );
});
