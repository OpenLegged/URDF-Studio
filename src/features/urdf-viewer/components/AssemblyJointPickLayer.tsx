import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Line2, LineSegments2 } from 'three-stdlib';

import { entityRefKey, type AssemblyState } from '@/types';
import type { AssemblySceneProjection } from '@/core/robot';
import {
  useJointPickSessionStore,
  type JointPickSide,
  type PickedSnapFrame,
} from '@/store/jointPickSessionStore';
import { CoordinateAxes } from '@/shared/components/3d/helpers/CoordinateAxes';
import { isRegressionDebugEnabled } from '@/shared/debug/regressionDebugEnabled';
import {
  registerRegressionJointPickHoverSummaryProvider,
  registerRegressionJointPickOverlaySummaryProvider,
  type RegressionJointPickOverlaySummary,
} from '@/shared/debug/regressionState';

import { getRobotSceneNodeIndex } from '../utils/robotSceneNodeIndex';
import { derivePickedSnapLinkLocalDisplay } from '../utils/jointPickOverlayFrame';
import {
  JointPickHoverOverlay,
  ScreenSpaceSnapDot,
} from './joint-pick/JointPickHoverOverlay';
import { useJointPickHoverInteraction } from './joint-pick/useJointPickHoverInteraction';

const PICK_RENDER_ORDER = 2500;
const FRAME_SIZE = 0.05;
const FRAME_ORIGIN = new THREE.Vector3();
const CONNECTOR_MIN_LENGTH_SQ = 1e-10;

const SNAP_TONE = {
  invalid: '#94a3b8',
  parent: '#0ea5e9',
  child: '#10b981',
} as const;

interface AssemblyJointPickLayerProps {
  robot: THREE.Object3D | null;
  runtimeRobotRevision: number;
  workspace: AssemblyState | null;
  sceneProjection: AssemblySceneProjection | null;
  hidden?: boolean;
}

function decomposeMatrix(matrix: THREE.Matrix4): {
  position: [number, number, number];
  quaternion: [number, number, number, number];
} {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return {
    position: [position.x, position.y, position.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
  };
}

const FrameAxes = memo(({
  axesRef,
  matrix,
  opacity = 1,
  markerSide,
}: {
  axesRef?: RefObject<THREE.Group | null>;
  matrix: THREE.Matrix4;
  opacity?: number;
  markerSide?: JointPickSide;
}) => {
  const { position, quaternion } = useMemo(() => decomposeMatrix(matrix), [matrix]);
  return (
    <group
      ref={axesRef}
      name={markerSide ? `__joint_pick_snap_axes__:${markerSide}` : undefined}
      position={position}
      quaternion={quaternion}
      userData={
        markerSide
          ? {
              excludeFromSceneBounds: true,
              isHelper: true,
              jointPickSnapSide: markerSide,
            }
          : undefined
      }
    >
      <CoordinateAxes
        size={FRAME_SIZE}
        profile="slim"
        depthTest={false}
        renderOrder={PICK_RENDER_ORDER}
        opacity={opacity}
      />
    </group>
  );
});

function resolveRuntimeLink(
  robot: THREE.Object3D | null,
  sceneProjection: AssemblySceneProjection | null,
  frame: PickedSnapFrame,
): THREE.Object3D | null {
  if (!robot || !sceneProjection) {
    return null;
  }

  const runtimeLinkId = sceneProjection.entityRefKeyToGlobal.get(
    entityRefKey({
      type: 'link',
      componentId: frame.componentId,
      entityId: frame.linkId,
    }),
  );
  if (!runtimeLinkId) {
    return null;
  }

  const registeredLink = (
    robot as THREE.Object3D & { links?: Record<string, THREE.Object3D> }
  ).links?.[runtimeLinkId];
  if (registeredLink) {
    return registeredLink;
  }

  return getRobotSceneNodeIndex(robot).links.find((link) => {
    const semanticLinkId =
      typeof link.userData.semanticLinkId === 'string'
        ? link.userData.semanticLinkId
        : link.name;
    return semanticLinkId === runtimeLinkId;
  }) ?? null;
}

interface CommittedSnapProps {
  axesRef: RefObject<THREE.Group | null>;
  frame: PickedSnapFrame;
  pointRef: RefObject<THREE.Group | null>;
  robot: THREE.Object3D | null;
  sceneProjection: AssemblySceneProjection | null;
  tone: string;
}

const CommittedSnap = memo(function CommittedSnap({
  axesRef,
  frame,
  pointRef,
  robot,
  sceneProjection,
  tone,
}: CommittedSnapProps) {
  const runtimeLink = resolveRuntimeLink(robot, sceneProjection, frame);
  const localDisplay = useMemo(() => derivePickedSnapLinkLocalDisplay(frame), [frame]);
  const capturedWorldPose = useMemo(
    () => new THREE.Matrix4().fromArray(frame.poseWorldMatrix),
    [frame.poseWorldMatrix],
  );
  const capturedWorldPoint = useMemo(
    () => new THREE.Vector3(frame.pointWorld.x, frame.pointWorld.y, frame.pointWorld.z),
    [frame.pointWorld.x, frame.pointWorld.y, frame.pointWorld.z],
  );
  const display = runtimeLink
    ? (() => {
        runtimeLink.updateWorldMatrix(true, false);
        return {
          point: localDisplay.point.clone().applyMatrix4(runtimeLink.matrixWorld),
          pose: runtimeLink.matrixWorld.clone().multiply(localDisplay.pose),
        };
      })()
    : { point: capturedWorldPoint, pose: capturedWorldPose };
  const syncScratchRef = useRef({
    pose: new THREE.Matrix4(),
    scale: new THREE.Vector3(),
  });

  useFrame(() => {
    const axes = axesRef.current;
    const point = pointRef.current;
    if (!axes || !point || !runtimeLink) {
      return;
    }

    runtimeLink.updateWorldMatrix(true, false);
    point.position.copy(localDisplay.point).applyMatrix4(runtimeLink.matrixWorld);
    syncScratchRef.current.pose
      .multiplyMatrices(runtimeLink.matrixWorld, localDisplay.pose)
      .decompose(axes.position, axes.quaternion, syncScratchRef.current.scale);
  });

  const marker = (
    <group>
      <group
        ref={pointRef}
        name={`__joint_pick_snap_point__:${frame.side}`}
        position={display.point}
        userData={{
          excludeFromSceneBounds: true,
          isHelper: true,
          jointPickSnapPointSide: frame.side,
        }}
      >
        <ScreenSpaceSnapDot point={FRAME_ORIGIN} radiusPx={5} tone={tone} />
      </group>
      <FrameAxes
        axesRef={axesRef}
        matrix={display.pose}
        markerSide={frame.side}
        opacity={0.92}
      />
    </group>
  );

  return marker;
});

interface SnapConnectorProps {
  childPointRef: RefObject<THREE.Group | null>;
  childSnap: PickedSnapFrame;
  lineRef: RefObject<Line2 | LineSegments2 | null>;
  parentPointRef: RefObject<THREE.Group | null>;
  parentSnap: PickedSnapFrame;
}

const SnapConnector = memo(function SnapConnector({
  childPointRef,
  childSnap,
  lineRef,
  parentPointRef,
  parentSnap,
}: SnapConnectorProps) {
  const scratchRef = useRef({
    child: new THREE.Vector3(),
    parent: new THREE.Vector3(),
    previousChild: new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN),
    previousParent: new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN),
  });
  const initialPoints = useMemo(
    () => [
      new THREE.Vector3(
        parentSnap.pointWorld.x,
        parentSnap.pointWorld.y,
        parentSnap.pointWorld.z,
      ),
      new THREE.Vector3(
        childSnap.pointWorld.x,
        childSnap.pointWorld.y,
        childSnap.pointWorld.z,
      ),
    ],
    [
      childSnap.pointWorld.x,
      childSnap.pointWorld.y,
      childSnap.pointWorld.z,
      parentSnap.pointWorld.x,
      parentSnap.pointWorld.y,
      parentSnap.pointWorld.z,
    ],
  );

  useFrame(() => {
    const childPoint = childPointRef.current;
    const line = lineRef.current;
    const parentPoint = parentPointRef.current;
    if (!childPoint || !line || !parentPoint) {
      return;
    }

    const scratch = scratchRef.current;
    parentPoint.getWorldPosition(scratch.parent);
    childPoint.getWorldPosition(scratch.child);
    line.visible = scratch.parent.distanceToSquared(scratch.child) > CONNECTOR_MIN_LENGTH_SQ;
    if (
      scratch.parent.equals(scratch.previousParent) &&
      scratch.child.equals(scratch.previousChild)
    ) {
      return;
    }

    line.geometry.setPositions([
      scratch.parent.x,
      scratch.parent.y,
      scratch.parent.z,
      scratch.child.x,
      scratch.child.y,
      scratch.child.z,
    ]);
    line.computeLineDistances();
    scratch.previousParent.copy(scratch.parent);
    scratch.previousChild.copy(scratch.child);
  });

  return (
    <Line
      ref={lineRef}
      points={initialPoints}
      color="#f59e0b"
      lineWidth={1.5}
      dashed
      dashSize={0.02}
      gapSize={0.012}
      depthTest={false}
      depthWrite={false}
      transparent
      opacity={0.8}
      renderOrder={PICK_RENDER_ORDER}
      userData={{ excludeFromSceneBounds: true, isHelper: true }}
    />
  );
});

interface SummarizeCommittedAxesOptions {
  axes: THREE.Group | null;
  connectorVisible: boolean | null;
  frame: PickedSnapFrame | null;
  liveLink: THREE.Object3D | null;
  side: JointPickSide;
}

function summarizeCommittedAxes({
  axes,
  connectorVisible,
  frame,
  liveLink,
  side,
}: SummarizeCommittedAxesOptions): RegressionJointPickOverlaySummary | null {
  if (!axes) {
    return null;
  }

  axes.updateWorldMatrix(true, false);
  const position = axes.getWorldPosition(new THREE.Vector3()).toArray();
  const quaternion = axes.getWorldQuaternion(new THREE.Quaternion()).toArray();
  liveLink?.updateWorldMatrix(true, false);
  let tracksLiveLink = false;
  if (liveLink && frame) {
    const localDisplay = derivePickedSnapLinkLocalDisplay(frame);
    const expectedPose = liveLink.matrixWorld.clone().multiply(localDisplay.pose);
    const expectedPosition = new THREE.Vector3().setFromMatrixPosition(expectedPose);
    const expectedQuaternion = new THREE.Quaternion().setFromRotationMatrix(expectedPose);
    tracksLiveLink =
      expectedPosition.distanceTo(new THREE.Vector3(...position)) < 1e-6
      && 1 - Math.abs(expectedQuaternion.dot(new THREE.Quaternion(...quaternion))) < 1e-6;
  }
  return {
    connectorVisible,
    liveLinkPosition: liveLink
      ? liveLink.getWorldPosition(new THREE.Vector3()).toArray()
      : null,
    position,
    quaternion,
    side,
    tracksLiveLink,
  };
}

export const AssemblyJointPickLayer = memo(
  ({
    robot,
    runtimeRobotRevision,
    workspace,
    sceneProjection,
    hidden = false,
  }: AssemblyJointPickLayerProps) => {
    const { camera, gl } = useThree();
    const active = useJointPickSessionStore((state) => state.active);
    const side = useJointPickSessionStore((state) => state.side);
    const snapFilter = useJointPickSessionStore((state) => state.snapFilter);
    const parentComponentId = useJointPickSessionStore((state) => state.parentComponentId);
    const childComponentId = useJointPickSessionStore((state) => state.childComponentId);
    const parentSnap = useJointPickSessionStore((state) => state.parentSnap);
    const childSnap = useJointPickSessionStore((state) => state.childSnap);
    const commitSnap = useJointPickSessionStore((state) => state.commitSnap);
    const parentAxesRef = useRef<THREE.Group>(null);
    const childAxesRef = useRef<THREE.Group>(null);
    const connectorRef = useRef<Line2 | LineSegments2>(null);
    const parentPointRef = useRef<THREE.Group>(null);
    const childPointRef = useRef<THREE.Group>(null);

    const { hover, hoverRef } = useJointPickHoverInteraction({
      active,
      camera,
      childComponentId,
      commitSnap,
      domElement: gl.domElement,
      hidden,
      parentComponentId,
      robot,
      sceneProjection,
      side,
      snapFilter,
      workspace,
    });

    useEffect(() => {
      if (!active || hidden || !isRegressionDebugEnabled()) {
        return undefined;
      }

      return registerRegressionJointPickOverlaySummaryProvider(() =>
        [
          summarizeCommittedAxes(
            {
              axes: parentAxesRef.current,
              connectorVisible: connectorRef.current?.visible ?? null,
              frame: parentSnap,
              liveLink: parentSnap
                ? resolveRuntimeLink(robot, sceneProjection, parentSnap)
                : null,
              side: 'parent',
            },
          ),
          summarizeCommittedAxes(
            {
              axes: childAxesRef.current,
              connectorVisible: connectorRef.current?.visible ?? null,
              frame: childSnap,
              liveLink: childSnap
                ? resolveRuntimeLink(robot, sceneProjection, childSnap)
                : null,
              side: 'child',
            },
          ),
        ].filter((summary): summary is RegressionJointPickOverlaySummary => summary !== null),
      );
    }, [active, childSnap, hidden, parentSnap, robot, sceneProjection]);

    useEffect(() => {
      if (!active || hidden || !isRegressionDebugEnabled()) {
        return undefined;
      }

      return registerRegressionJointPickHoverSummaryProvider(() => {
        const current = hoverRef.current;
        return current
          ? [{
              boundaryLoopCount: current.snap.region.boundaryLoops.length,
              candidateCount: current.snap.candidates.length,
              candidateKinds: [...new Set(
                current.snap.candidates.map((candidate) => candidate.kind),
              )].sort(),
              chosenKind: current.chosen.kind,
              componentId: current.snap.componentId,
              confidence: current.snap.region.confidence,
              featureKind: current.snap.region.featureKind,
              linkId: current.snap.linkId,
              recommendedKind: current.snap.recommended.kind,
              side: current.side,
              triangleCount: current.snap.region.trianglesWorld.length / 3,
              truncated: current.snap.region.truncated,
              valid: current.valid,
            }]
          : [];
      });
    }, [active, hidden, hoverRef]);

    if (!active || hidden) {
      return null;
    }

    return (
      <group>
        {hover ? (
          <>
            <JointPickHoverOverlay
              chosenCandidateId={hover.chosen.id}
              snap={hover.snap}
              tone={hover.valid && hover.side ? SNAP_TONE[hover.side] : SNAP_TONE.invalid}
            />
            {hover.valid ? <FrameAxes matrix={hover.chosen.poseWorld} /> : null}
          </>
        ) : null}
        {parentSnap ? (
          <CommittedSnap
            key={`parent:${runtimeRobotRevision}`}
            axesRef={parentAxesRef}
            frame={parentSnap}
            pointRef={parentPointRef}
            robot={robot}
            sceneProjection={sceneProjection}
            tone={SNAP_TONE.parent}
          />
        ) : null}
        {childSnap ? (
          <CommittedSnap
            key={`child:${runtimeRobotRevision}`}
            axesRef={childAxesRef}
            frame={childSnap}
            pointRef={childPointRef}
            robot={robot}
            sceneProjection={sceneProjection}
            tone={SNAP_TONE.child}
          />
        ) : null}
        {parentSnap && childSnap ? (
          <SnapConnector
            parentPointRef={parentPointRef}
            parentSnap={parentSnap}
            childPointRef={childPointRef}
            childSnap={childSnap}
            lineRef={connectorRef}
          />
        ) : null}
      </group>
    );
  },
);

AssemblyJointPickLayer.displayName = 'AssemblyJointPickLayer';
