import React, { useMemo } from 'react';

import { getParentJointByChildLink } from '@/core/robot';
import { translations } from '@/shared/i18n';
import {
  composeInertiaTensorFromDerivedValues,
  computeInertialDerivedValues,
  computeLinkDensity,
} from '@/shared/utils/inertialDerived';
import { type Language, useUIStore } from '@/store/uiStore';
import type {
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
} from '@/store/workspace/types';
import type { RobotState, UrdfInertial, UrdfLink, UrdfOrigin, Vector3 } from '@/types';
import { useMassInertiaDecision } from '../hooks/useMassInertiaDecision';
import { buildMassInertiaNotice, LinkMassInertiaFeedback } from './LinkMassInertiaFeedback';
import {
  LinkDerivedValuesSection,
  LinkFrameSection,
  LinkInertialParametersSection,
} from './LinkPhysicsSections';

const DEFAULT_INERTIAL: UrdfInertial = {
  mass: 0,
  origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
  inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
};

const DEFAULT_LINK_FRAME_ORIGIN: UrdfOrigin = {
  xyz: { x: 0, y: 0, z: 0 },
  rpy: { r: 0, p: 0, y: 0 },
};

const DEFAULT_PRINCIPAL_AXES: [Vector3, Vector3, Vector3] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];

interface LinkPhysicsPanelProps {
  data: UrdfLink;
  robot: RobotState;
  selection: RobotState['selection'];
  onUpdate: (
    type: 'link' | 'joint',
    id: string,
    data: WorkspaceLinkPropertyPatch | WorkspaceJointPropertyPatch,
  ) => void;
  t: (typeof translations)['en'];
  lang: Language;
}

/** Coordinates link-frame, authored inertial, derived-value, and feedback owners. */
export const LinkPhysicsPanel: React.FC<LinkPhysicsPanelProps> = ({
  data,
  robot,
  selection,
  onUpdate,
  t,
  lang,
}) => {
  const massInertiaChangeBehavior = useUIStore((state) => state.massInertiaChangeBehavior);
  const setMassInertiaChangeBehavior = useUIStore((state) => state.setMassInertiaChangeBehavior);
  const inertial = data.inertial ?? DEFAULT_INERTIAL;
  const densityResult = useMemo(() => computeLinkDensity(data), [data]);
  const derivedInertial = useMemo(
    () => computeInertialDerivedValues(data.inertial),
    [data.inertial],
  );
  const parentJoint = useMemo(() => {
    const parentJointsByChild = getParentJointByChildLink(robot);
    return (
      parentJointsByChild.get(data.id) ?? parentJointsByChild.get(selection.id ?? data.id) ?? null
    );
  }, [data.id, robot, selection.id]);
  const linkFrameOrigin = parentJoint?.origin ?? DEFAULT_LINK_FRAME_ORIGIN;
  const diagonalInertia = derivedInertial?.diagonalInertia ?? [
    inertial.inertia.ixx,
    inertial.inertia.iyy,
    inertial.inertia.izz,
  ];
  const principalAxes = derivedInertial?.principalAxes ?? DEFAULT_PRINCIPAL_AXES;
  const massDecision = useMassInertiaDecision({
    linkSnapshot: data,
    currentMass: inertial.mass,
    inertial,
    preferredBehavior: massInertiaChangeBehavior,
    persistPreferredBehavior: setMassInertiaChangeBehavior,
    applyInertialUpdate: (linkId, nextInertial) =>
      onUpdate('link', linkId, { inertial: nextInertial }),
    buildNotice: (linkName, nextMass, behavior, scaledEstimate) =>
      buildMassInertiaNotice({
        t,
        linkName,
        nextMass,
        behavior,
        scaledEstimate,
      }),
  });

  const handleDiagonalInertiaChange = (index: 0 | 1 | 2, value: number) => {
    const nextDiagonalInertia = [...diagonalInertia] as [number, number, number];
    nextDiagonalInertia[index] = value;
    onUpdate('link', selection.id!, {
      inertial: {
        inertia: composeInertiaTensorFromDerivedValues(nextDiagonalInertia, principalAxes),
      },
    });
  };

  return (
    <>
      <LinkFrameSection
        parentJoint={parentJoint}
        linkFrameOrigin={linkFrameOrigin}
        onUpdate={onUpdate}
        t={t}
        lang={lang}
      />
      <LinkInertialParametersSection
        inertial={inertial}
        linkId={selection.id!}
        onMassChange={massDecision.handleMassChange}
        onUpdate={onUpdate}
        t={t}
        lang={lang}
      />
      <LinkDerivedValuesSection
        density={densityResult.value}
        diagonalInertia={diagonalInertia}
        principalAxes={principalAxes}
        onDiagonalInertiaChange={handleDiagonalInertiaChange}
        t={t}
      />
      <LinkMassInertiaFeedback decision={massDecision} t={t} />
    </>
  );
};
