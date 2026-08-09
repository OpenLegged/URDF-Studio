import React from 'react';

import { MAX_PROPERTY_DECIMALS, formatNumberWithMaxDecimals } from '@/core/utils/numberPrecision';
import { translations } from '@/shared/i18n';
import type { Language } from '@/store/uiStore';
import type {
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
} from '@/store/workspace/types';
import type { UrdfInertial, UrdfJoint, UrdfOrigin } from '@/types';
import {
  CollapsibleSection,
  InlineInputGroup,
  InputGroup,
  NumberInput,
  PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS,
  ReadonlyValueField,
  ReadonlyVectorStatHeader,
  ReadonlyVectorStatRow,
} from './FormControls';
import { TransformFields } from './TransformFields';

const INERTIA_TENSOR_FIELDS = ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'] as const;
const DIAGONAL_INERTIA_LABELS = ['I1', 'I2', 'I3'] as const;
const PRINCIPAL_AXIS_LABELS = ['A1', 'A2', 'A3'] as const;
const ZERO_ORIGIN: UrdfOrigin = {
  xyz: { x: 0, y: 0, z: 0 },
  rpy: { r: 0, p: 0, y: 0 },
};

type LinkPhysicsUpdate = (
  type: 'link' | 'joint',
  id: string,
  data: WorkspaceLinkPropertyPatch | WorkspaceJointPropertyPatch,
) => void;

function toXYZ(value: { x?: number; y?: number; z?: number }, fallback = ZERO_ORIGIN.xyz) {
  return {
    x: value.x ?? fallback.x,
    y: value.y ?? fallback.y,
    z: value.z ?? fallback.z,
  };
}

function toRPY(value: { r?: number; p?: number; y?: number }, fallback = ZERO_ORIGIN.rpy) {
  return {
    r: value.r ?? fallback.r,
    p: value.p ?? fallback.p,
    y: value.y ?? fallback.y,
  };
}

function formatReadonlyNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'N/A';
  }

  return formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);
}

interface LinkFrameSectionProps {
  parentJoint: UrdfJoint | null;
  linkFrameOrigin: UrdfOrigin;
  onUpdate: LinkPhysicsUpdate;
  t: (typeof translations)['en'];
  lang: Language;
}

/** Edits the selected link's frame through its owning parent joint. */
export const LinkFrameSection: React.FC<LinkFrameSectionProps> = ({
  parentJoint,
  linkFrameOrigin,
  onUpdate,
  t,
  lang,
}) => (
  <CollapsibleSection
    title={t.originReferenceFrame}
    className="mb-2.5"
    storageKey="property_editor_link_frame"
  >
    <InlineInputGroup label={t.originReferenceFrame} labelWidthClassName="w-24">
      <ReadonlyValueField>{parentJoint ? t.parentJointFrame : t.linkFrame}</ReadonlyValueField>
    </InlineInputGroup>
    {parentJoint ? (
      <div className="mt-2.5 overflow-hidden rounded-md border border-border-black/60">
        <div className="bg-element-bg/70 px-2 py-1 text-[9px] font-semibold tracking-[0.02em] text-text-secondary">
          {t.originRelativeParentJoint}
        </div>
        <div className="border-t border-border-black/60 bg-panel-bg px-1.5 py-1">
          <TransformFields
            lang={lang}
            positionValue={linkFrameOrigin.xyz}
            rotationValue={linkFrameOrigin.rpy}
            compact={false}
            rotationQuickStepDegrees={90}
            onPositionChange={(xyz) =>
              onUpdate('joint', parentJoint.id, {
                ...parentJoint,
                origin: {
                  xyz: toXYZ(xyz, linkFrameOrigin.xyz),
                  rpy: linkFrameOrigin.rpy,
                },
              })
            }
            onRotationChange={(rpy) =>
              onUpdate('joint', parentJoint.id, {
                ...parentJoint,
                origin: {
                  xyz: linkFrameOrigin.xyz,
                  rpy: toRPY(rpy, linkFrameOrigin.rpy),
                },
              })
            }
          />
        </div>
      </div>
    ) : null}
  </CollapsibleSection>
);

interface LinkInertialParametersSectionProps {
  inertial: UrdfInertial;
  linkId: string;
  onMassChange: (nextMass: number) => void;
  onUpdate: LinkPhysicsUpdate;
  t: (typeof translations)['en'];
  lang: Language;
}

/** Edits authored mass, center-of-mass transform, and tensor components. */
export const LinkInertialParametersSection: React.FC<LinkInertialParametersSectionProps> = ({
  inertial,
  linkId,
  onMassChange,
  onUpdate,
  t,
  lang,
}) => (
  <CollapsibleSection
    title={t.inertial}
    className="mb-2.5"
    storageKey="property_editor_link_inertial"
  >
    <InlineInputGroup label={t.mass} labelWidthClassName="w-16">
      <NumberInput value={inertial.mass} min={0} commitOnBlurOnly onChange={onMassChange} />
    </InlineInputGroup>

    <div className="mb-1 overflow-hidden rounded-md border border-border-black/60">
      <div className="bg-element-bg/70 px-2 py-1 text-[9px] font-semibold tracking-[0.02em] text-text-secondary">
        {t.centerOfMass || 'Center of Mass'}
      </div>
      <div className="border-t border-border-black/60 bg-panel-bg px-1.5 py-1">
        <TransformFields
          lang={lang}
          positionValue={inertial.origin?.xyz || ZERO_ORIGIN.xyz}
          rotationValue={inertial.origin?.rpy || ZERO_ORIGIN.rpy}
          compact={false}
          rotationQuickStepDegrees={90}
          onPositionChange={(xyz) =>
            onUpdate('link', linkId, {
              inertial: { origin: { xyz: toXYZ(xyz) } },
            })
          }
          onRotationChange={(rpy) =>
            onUpdate('link', linkId, {
              inertial: { origin: { rpy: toRPY(rpy) } },
            })
          }
        />
      </div>
    </div>

    <div className="mt-3 border-t border-border-black/60 pt-2">
      <h4 className="mb-2 text-[10px] font-semibold tracking-[0.02em] text-text-tertiary">
        {t.inertiaTensor}
      </h4>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {INERTIA_TENSOR_FIELDS.map((field) => (
          <InlineInputGroup key={field} label={field} labelWidthClassName="w-7" className="mb-0">
            <NumberInput
              value={inertial.inertia[field]}
              onChange={(value) =>
                onUpdate('link', linkId, {
                  inertial: { inertia: { [field]: value } },
                })
              }
            />
          </InlineInputGroup>
        ))}
      </div>
    </div>
  </CollapsibleSection>
);

interface PrincipalAxis {
  x: number;
  y: number;
  z: number;
}

interface LinkDerivedValuesSectionProps {
  density: number | null;
  diagonalInertia: [number, number, number];
  principalAxes: [PrincipalAxis, PrincipalAxis, PrincipalAxis];
  onDiagonalInertiaChange: (index: 0 | 1 | 2, value: number) => void;
  t: (typeof translations)['en'];
}

/** Displays derived density/axes and applies edits expressed in principal-axis space. */
export const LinkDerivedValuesSection: React.FC<LinkDerivedValuesSectionProps> = ({
  density,
  diagonalInertia,
  principalAxes,
  onDiagonalInertiaChange,
  t,
}) => (
  <CollapsibleSection
    title={t.derivedValues}
    className="mb-2.5"
    storageKey="property_editor_link_derived_values"
  >
    <InlineInputGroup label={t.density} labelWidthClassName="w-16" align="start">
      <ReadonlyValueField className="min-w-0 w-full overflow-hidden truncate">
        {formatReadonlyNumber(density)}
      </ReadonlyValueField>
    </InlineInputGroup>

    <InputGroup label={t.diagonalInertia} className="mt-2.5">
      <div className="grid min-w-0 w-full grid-cols-3 gap-1.5">
        {DIAGONAL_INERTIA_LABELS.map((label, index) => (
          <div key={label} className="flex min-w-0 items-center gap-1.5">
            <span className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} w-4 justify-center`}>
              {label}
            </span>
            <div className="min-w-0 flex-1">
              <NumberInput
                value={diagonalInertia[index]}
                min={0}
                step={0.01}
                precision={MAX_PROPERTY_DECIMALS}
                compact
                onChange={(value) => onDiagonalInertiaChange(index as 0 | 1 | 2, value)}
              />
            </div>
          </div>
        ))}
      </div>
    </InputGroup>

    <InputGroup label={t.principalAxes} className="mt-3.5 mb-0">
      <div className="min-w-0 w-full space-y-1.5">
        <ReadonlyVectorStatHeader />
        {PRINCIPAL_AXIS_LABELS.map((label, index) => {
          const axis = principalAxes[index];
          return (
            <ReadonlyVectorStatRow
              key={label}
              label={label}
              values={[
                formatReadonlyNumber(axis?.x),
                formatReadonlyNumber(axis?.y),
                formatReadonlyNumber(axis?.z),
              ]}
            />
          );
        })}
      </div>
    </InputGroup>
  </CollapsibleSection>
);
