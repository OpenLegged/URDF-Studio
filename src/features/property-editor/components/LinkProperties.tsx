/**
 * LinkProperties - Property editing panel for Link elements.
 * Renders the link-only editing layout shared by all editor modes:
 * - Name input
 * - Visual/Collision/Physics tabs
 */
import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Edit3, Eye, EyeOff, Box, Minus, Plus, Waypoints } from 'lucide-react';
import type {
  DetailLinkTab,
  InteractionSelection,
  RobotState,
  AppMode,
  MotorSpec,
  UrdfLink,
} from '@/types';
import type {
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
} from '@/store/workspace/types';
import { GeometryType } from '@/types';
import { translations } from '@/shared/i18n';
import {
  useUIStore,
  type Language,
} from '@/store/uiStore';
import { MAX_PROPERTY_DECIMALS, formatNumberWithMaxDecimals } from '@/core/utils/numberPrecision';
import {
  appendCollisionBody,
  getParentJointByChildLink,
  getCollisionGeometryEntries,
  removeCollisionGeometryByObjectIndex,
  updateCollisionGeometryByObjectIndex,
} from '@/core/robot';
import {
  composeInertiaTensorFromDerivedValues,
  computeInertialDerivedValues,
  computeLinkDensity,
  scaleInertiaTensorForMassChange,
  type InertiaTensorComponents,
} from '@/shared/utils/inertialDerived';
import {
  Button,
  Checkbox,
  ContextMenuFrame,
  ContextMenuItem,
  Dialog,
  SegmentedControl,
} from '@/shared/components/ui';
import {
  CollapsibleSection,
  InputGroup,
  InlineInputGroup,
  NumberInput,
  PROPERTY_EDITOR_HELPER_TEXT_CLASS,
  PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS,
  PROPERTY_EDITOR_INPUT_CLASS,
  PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS,
  PROPERTY_EDITOR_SECTION_TITLE_CLASS,
  ReadonlyVectorStatHeader,
  ReadonlyVectorStatRow,
  ReadonlyValueField,
} from './FormControls';
import { GeometryEditor } from './GeometryEditor';
import { TransformFields } from './TransformFields';
import {
  useMassInertiaDecision,
  type ResolvedMassInertiaBehavior,
  type FloatingMassInertiaNotice,
} from '../hooks/useMassInertiaDecision';

const DEFAULT_INERTIAL = {
  mass: 0,
  origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
  inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
};
const DEFAULT_LINK_FRAME_ORIGIN = {
  xyz: { x: 0, y: 0, z: 0 },
  rpy: { r: 0, p: 0, y: 0 },
};

const DEFAULT_PRINCIPAL_AXES = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
] as const;

const formatReadonlyNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'N/A';
  }

  return formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);
};

const fillTemplate = (template: string, replacements: Record<string, string>): string =>
  Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );

const formatMassValue = (value: number): string =>
  formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);

const toXYZ = (
  value: { x?: number; y?: number; z?: number },
  fallback = DEFAULT_LINK_FRAME_ORIGIN.xyz,
) => ({
  x: value.x ?? fallback.x,
  y: value.y ?? fallback.y,
  z: value.z ?? fallback.z,
});

const toRPY = (
  value: { r?: number; p?: number; y?: number },
  fallback = DEFAULT_LINK_FRAME_ORIGIN.rpy,
) => ({
  r: value.r ?? fallback.r,
  p: value.p ?? fallback.p,
  y: value.y ?? fallback.y,
});

const formatInertiaTensorSummary = (inertia: InertiaTensorComponents): string => {
  const diagonalSummary = `ixx=${formatReadonlyNumber(inertia.ixx)}, iyy=${formatReadonlyNumber(
    inertia.iyy,
  )}, izz=${formatReadonlyNumber(inertia.izz)}`;
  const hasOffDiagonalTerms = [inertia.ixy, inertia.ixz, inertia.iyz].some(
    (value) => Math.abs(value) > 1e-9,
  );

  if (!hasOffDiagonalTerms) {
    return diagonalSummary;
  }

  return `${diagonalSummary}; ixy=${formatReadonlyNumber(inertia.ixy)}, ixz=${formatReadonlyNumber(
    inertia.ixz,
  )}, iyz=${formatReadonlyNumber(inertia.iyz)}`;
};

const buildMassInertiaNotice = (
  t: (typeof translations)['en'],
  linkName: string,
  nextMass: number,
  behavior: ResolvedMassInertiaBehavior,
  scaledEstimate: ReturnType<typeof scaleInertiaTensorForMassChange>,
): FloatingMassInertiaNotice => {
  if (behavior === 'reestimate' && scaledEstimate) {
    return {
      message: fillTemplate(t.massChangeInertiaReestimatedNotice, {
        name: linkName,
        tensor: formatInertiaTensorSummary(scaledEstimate.inertia),
      }),
      tone: 'success',
    };
  }

  if (behavior === 'reestimate') {
    return {
      message: fillTemplate(t.massChangeInertiaFallbackNotice, {
        name: linkName,
      }),
      tone: 'info',
    };
  }

  return {
    message: fillTemplate(t.massChangeInertiaPreservedNotice, {
      name: linkName,
      mass: formatMassValue(nextMass),
    }),
    tone: 'info',
  };
};

const DetailGeometryTabButton = ({
  icon: Icon,
  isActive,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    className={`relative flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden rounded-t-lg border-x border-t px-1 py-1 text-[10px] font-semibold transition-colors ${
      isActive
        ? 'z-10 -mb-px border-border-black bg-panel-bg pb-1.5 text-system-blue dark:bg-segmented-active'
        : 'border-transparent bg-transparent text-text-tertiary hover:bg-element-hover hover:text-text-secondary'
    }`}
  >
    <Icon className="h-3 w-3 shrink-0" />
    <span className="min-w-0 truncate leading-tight">{label}</span>
  </button>
);

const DetailGeometryTabPanel = ({
  activeTab,
  children,
  tab,
}: {
  activeTab: DetailLinkTab;
  children: React.ReactNode;
  tab: DetailLinkTab;
}) => (
  <div
    style={{ display: activeTab === tab ? undefined : 'none' }}
    className="mb-2.5 rounded-b-lg border-x border-b border-border-black bg-panel-bg p-1.5 shadow-sm"
  >
    {children}
  </div>
);

const getGeometryTypeLabel = (type: GeometryType, t: (typeof translations)['en']) =>
  type === GeometryType.BOX
    ? t.box
    : type === GeometryType.PLANE
      ? t.plane
      : type === GeometryType.CYLINDER
        ? t.cylinder
        : type === GeometryType.SPHERE
          ? t.sphere
          : type === GeometryType.ELLIPSOID
            ? t.ellipsoid
            : type === GeometryType.CAPSULE
              ? t.capsule
              : type === GeometryType.HFIELD
                ? t.hfield
                : type === GeometryType.SDF
                  ? t.sdf
                  : type === GeometryType.MESH
                    ? t.mesh
                    : t.none;

interface LinkPropertiesProps {
  componentId: string;
  data: UrdfLink;
  robot: RobotState;
  mode: AppMode;
  selection: RobotState['selection'];
  onUpdate: (
    type: 'link' | 'joint',
    id: string,
    data: WorkspaceLinkPropertyPatch | WorkspaceJointPropertyPatch,
  ) => void;
  onSelect?: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
  ) => void;
  onSelectGeometry?: (
    linkId: string,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onAddCollisionBody?: (linkId: string) => void;
  motorLibrary: Record<string, MotorSpec[]>;
  assets: Record<string, string>;
  onUploadAsset: (file: File) => void;
  sourceFilePath?: string;
  t: (typeof translations)['en'];
  lang: Language;
}

interface CollisionListContextMenuState {
  x: number;
  y: number;
  objectIndex: number;
}

export const LinkProperties: React.FC<LinkPropertiesProps> = ({
  componentId,
  data,
  robot,
  selection,
  onUpdate,
  onSelect,
  onSelectGeometry,
  onAddCollisionBody,
  assets,
  onUploadAsset,
  sourceFilePath,
  t,
  lang,
}) => {
  const linkTab = useUIStore((state) => state.detailLinkTab);
  const setDetailLinkTab = useUIStore((state) => state.setDetailLinkTab);
  const massInertiaChangeBehavior = useUIStore((state) => state.massInertiaChangeBehavior);
  const setMassInertiaChangeBehavior = useUIStore((state) => state.setMassInertiaChangeBehavior);
  const inertial = data.inertial ?? DEFAULT_INERTIAL;
  const {
    pendingMassInertiaDecision,
    selectedMassInertiaBehavior,
    setSelectedMassInertiaBehavior,
    rememberMassInertiaBehavior,
    setRememberMassInertiaBehavior,
    setPendingMassInertiaDecision,
    floatingMassInertiaNotice,
    handleMassChange,
    handleConfirmMassInertiaDecision,
  } = useMassInertiaDecision({
    linkSnapshot: data,
    currentMass: inertial.mass,
    inertial,
    preferredBehavior: massInertiaChangeBehavior,
    persistPreferredBehavior: (behavior) => setMassInertiaChangeBehavior(behavior),
    applyInertialUpdate: (linkId, nextInertial) =>
      onUpdate('link', linkId, { inertial: nextInertial }),
    buildNotice: (linkName, nextMass, behavior, scaledEstimate) =>
      buildMassInertiaNotice(t, linkName, nextMass, behavior, scaledEstimate),
  });
  const [collisionListContextMenu, setCollisionListContextMenu] =
    React.useState<CollisionListContextMenuState | null>(null);
  const [collisionListEditingObjectIndex, setCollisionListEditingObjectIndex] = React.useState<
    number | null
  >(null);
  const [collisionListEditingDraft, setCollisionListEditingDraft] = React.useState('');
  const collisionListRenameInputRef = React.useRef<HTMLInputElement | null>(null);
  const densityResult = useMemo(() => computeLinkDensity(data), [data]);
  const derivedInertial = useMemo(
    () => computeInertialDerivedValues(data.inertial),
    [data.inertial],
  );
  const collisionGeometryEntries = useMemo(() => getCollisionGeometryEntries(data), [data]);
  const parentJoint = useMemo(() => {
    const parentJointsByChild = getParentJointByChildLink(robot);
    return (
      parentJointsByChild.get(data.id) ?? parentJointsByChild.get(selection.id ?? data.id) ?? null
    );
  }, [data.id, robot, selection.id]);
  const linkFrameOrigin = parentJoint?.origin ?? DEFAULT_LINK_FRAME_ORIGIN;
  const densityLabel = t.density;
  const selectedCollisionObjectIndex =
    selection.type === 'link' && selection.id === data.id && selection.subType === 'collision'
      ? (selection.objectIndex ?? 0)
      : (collisionGeometryEntries[0]?.objectIndex ?? 0);

  const handleTabChange = (tab: DetailLinkTab) => {
    setDetailLinkTab(tab);
  };
  const inertiaTensorFields = ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'] as const;
  const diagonalInertiaLabels = ['I1', 'I2', 'I3'] as const;
  const principalAxisLabels = ['A1', 'A2', 'A3'] as const;
  const diagonalInertiaValues = derivedInertial?.diagonalInertia ?? [
    inertial.inertia.ixx,
    inertial.inertia.iyy,
    inertial.inertia.izz,
  ];
  const principalAxes =
    derivedInertial?.principalAxes ??
    (DEFAULT_PRINCIPAL_AXES as [
      { x: number; y: number; z: number },
      { x: number; y: number; z: number },
      { x: number; y: number; z: number },
    ]);

  const handleDiagonalInertiaChange = (index: 0 | 1 | 2, value: number) => {
    const nextDiagonalInertia = [...diagonalInertiaValues] as [number, number, number];
    nextDiagonalInertia[index] = value;

    onUpdate('link', selection.id!, {
      inertial: {
        inertia: composeInertiaTensorFromDerivedValues(nextDiagonalInertia, principalAxes),
      },
    });
  };

  React.useEffect(() => {
    setCollisionListContextMenu(null);
    setCollisionListEditingObjectIndex(null);
    setCollisionListEditingDraft('');
  }, [data.id]);

  React.useEffect(() => {
    if (!collisionListContextMenu) {
      return;
    }

    const closeMenu = () => setCollisionListContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('contextmenu', closeMenu);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('contextmenu', closeMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [collisionListContextMenu]);

  React.useEffect(() => {
    if (collisionListEditingObjectIndex === null) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      collisionListRenameInputRef.current?.focus();
      collisionListRenameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [collisionListEditingObjectIndex]);

  React.useEffect(() => {
    if (collisionListEditingObjectIndex === null) {
      return;
    }

    const editingEntry = collisionGeometryEntries.find(
      (entry) => entry.objectIndex === collisionListEditingObjectIndex,
    );
    if (!editingEntry) {
      setCollisionListEditingObjectIndex(null);
      setCollisionListEditingDraft('');
    }
  }, [collisionGeometryEntries, collisionListEditingObjectIndex]);

  const nameField = (
    <InlineInputGroup label={t.name} labelWidthClassName="w-11">
      <input
        type="text"
        value={data.name}
        onChange={(e) => onUpdate('link', selection.id!, { name: e.target.value })}
        className={PROPERTY_EDITOR_INPUT_CLASS}
      />
    </InlineInputGroup>
  );

  const frameParametersSection = (
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

  const inertialParametersSection = (
    <CollapsibleSection
      title={t.inertial}
      className="mb-2.5"
      storageKey="property_editor_link_inertial"
    >
      <InlineInputGroup label={t.mass} labelWidthClassName="w-16">
        <NumberInput value={inertial.mass} min={0} commitOnBlurOnly onChange={handleMassChange} />
      </InlineInputGroup>

      <div className="mb-1 overflow-hidden rounded-md border border-border-black/60">
        <div className="bg-element-bg/70 px-2 py-1 text-[9px] font-semibold tracking-[0.02em] text-text-secondary">
          {t.centerOfMass || 'Center of Mass'}
        </div>
        <div className="border-t border-border-black/60 bg-panel-bg px-1.5 py-1">
          <TransformFields
            lang={lang}
            positionValue={inertial.origin?.xyz || { x: 0, y: 0, z: 0 }}
            rotationValue={inertial.origin?.rpy || { r: 0, p: 0, y: 0 }}
            compact={false}
            rotationQuickStepDegrees={90}
            onPositionChange={(xyz) =>
              onUpdate('link', selection.id!, {
                inertial: {
                  origin: {
                    xyz: toXYZ(xyz),
                  },
                },
              })
            }
            onRotationChange={(rpy) =>
              onUpdate('link', selection.id!, {
                inertial: {
                  origin: {
                    rpy: toRPY(rpy),
                  },
                },
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
          {inertiaTensorFields.map((field) => (
            <InlineInputGroup key={field} label={field} labelWidthClassName="w-7" className="mb-0">
              <NumberInput
                value={inertial.inertia[field]}
                onChange={(v) =>
                  onUpdate('link', selection.id!, {
                    inertial: { inertia: { [field]: v } },
                  })
                }
              />
            </InlineInputGroup>
          ))}
        </div>
      </div>
    </CollapsibleSection>
  );

  const derivedValuesSection = (
    <CollapsibleSection
      title={t.derivedValues}
      className="mb-2.5"
      storageKey="property_editor_link_derived_values"
    >
      <InlineInputGroup label={densityLabel} labelWidthClassName="w-16" align="start">
        <ReadonlyValueField className="min-w-0 w-full overflow-hidden truncate">
          {formatReadonlyNumber(densityResult.value)}
        </ReadonlyValueField>
      </InlineInputGroup>

      <InputGroup label={t.diagonalInertia} className="mt-2.5">
        <div className="grid min-w-0 w-full grid-cols-3 gap-1.5">
          {diagonalInertiaLabels.map((label, index) => (
            <div key={label} className="flex min-w-0 items-center gap-1.5">
              <span className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} w-4 justify-center`}>
                {label}
              </span>
              <div className="min-w-0 flex-1">
                <NumberInput
                  value={diagonalInertiaValues[index]}
                  min={0}
                  step={0.01}
                  precision={MAX_PROPERTY_DECIMALS}
                  compact
                  onChange={(value) => handleDiagonalInertiaChange(index as 0 | 1 | 2, value)}
                />
              </div>
            </div>
          ))}
        </div>
      </InputGroup>

      <InputGroup label={t.principalAxes} className="mt-3.5 mb-0">
        <div className="min-w-0 w-full space-y-1.5">
          <ReadonlyVectorStatHeader />
          {principalAxisLabels.map((label, index) => {
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

  const inertialSection = (
    <>
      {frameParametersSection}
      {inertialParametersSection}
      {derivedValuesSection}
    </>
  );

  const handleSelectCollisionGeometry = React.useCallback(
    (objectIndex: number) => {
      if (onSelectGeometry) {
        onSelectGeometry(data.id, 'collision', objectIndex);
        return;
      }

      onSelect?.('link', data.id, 'collision');
    },
    [data.id, onSelect, onSelectGeometry],
  );
  const buildVisualPatch = React.useCallback(
    (nextLink: UrdfLink): Partial<UrdfLink> => ({
      visual: nextLink.visual,
      visualBodies: nextLink.visualBodies,
    }),
    [],
  );
  const buildCollisionPatch = React.useCallback(
    (nextLink: UrdfLink): Partial<UrdfLink> => ({
      collision: nextLink.collision,
      collisionBodies: nextLink.collisionBodies,
    }),
    [],
  );
  const handleVisualGeometryUpdate = React.useCallback(
    (nextLink: UrdfLink) => {
      onUpdate('link', selection.id!, buildVisualPatch(nextLink));
    },
    [buildVisualPatch, onUpdate, selection.id],
  );
  const handleCollisionGeometryUpdate = React.useCallback(
    (nextLink: UrdfLink) => {
      onUpdate('link', selection.id!, buildCollisionPatch(nextLink));
    },
    [buildCollisionPatch, onUpdate, selection.id],
  );

  const handleToggleCollisionGeometryVisibility = React.useCallback(
    (objectIndex: number, isVisible: boolean) => {
      const nextLink = updateCollisionGeometryByObjectIndex(data, objectIndex, {
        visible: !isVisible,
      });

      onUpdate('link', data.id, buildCollisionPatch(nextLink));

      if (onSelectGeometry) {
        // Keep the editor focused on the toggled collision body without forcing
        // the global collision overlay to become visible.
        onSelectGeometry(data.id, 'collision', objectIndex, true, true);
        return;
      }

      onSelect?.('link', data.id, 'collision');
    },
    [buildCollisionPatch, data, onSelect, onSelectGeometry, onUpdate],
  );

  const beginCollisionListRenaming = React.useCallback(
    (objectIndex: number) => {
      const targetEntry = collisionGeometryEntries.find(
        (entry) => entry.objectIndex === objectIndex,
      );
      if (!targetEntry) {
        return;
      }

      if (onSelectGeometry) {
        onSelectGeometry(data.id, 'collision', objectIndex, true);
      } else {
        onSelect?.('link', data.id, 'collision');
      }

      setCollisionListEditingObjectIndex(objectIndex);
      setCollisionListEditingDraft(targetEntry.geometry.name?.trim() || '');
    },
    [collisionGeometryEntries, data.id, onSelect, onSelectGeometry],
  );

  const cancelCollisionListRenaming = React.useCallback(() => {
    setCollisionListEditingObjectIndex(null);
    setCollisionListEditingDraft('');
  }, []);

  const commitCollisionListRenaming = React.useCallback(() => {
    if (collisionListEditingObjectIndex === null) {
      return;
    }

    const normalizedName = collisionListEditingDraft.trim() || undefined;
    const currentEntry = collisionGeometryEntries.find(
      (entry) => entry.objectIndex === collisionListEditingObjectIndex,
    );
    if (!currentEntry) {
      cancelCollisionListRenaming();
      return;
    }

    if (currentEntry.geometry.name !== normalizedName) {
      const nextLink = updateCollisionGeometryByObjectIndex(data, collisionListEditingObjectIndex, {
        name: normalizedName,
      });
      onUpdate('link', data.id, buildCollisionPatch(nextLink));
    }

    cancelCollisionListRenaming();
  }, [
    cancelCollisionListRenaming,
    buildCollisionPatch,
    collisionGeometryEntries,
    collisionListEditingDraft,
    collisionListEditingObjectIndex,
    data,
    onUpdate,
  ]);

  const handleCollisionListContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>, objectIndex: number) => {
      event.preventDefault();
      event.stopPropagation();

      const menuWidth = 170;
      const menuHeight = 44;
      const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
      const maxY = Math.max(8, window.innerHeight - menuHeight - 8);

      setCollisionListContextMenu({
        objectIndex,
        x: Math.min(event.clientX, maxX),
        y: Math.min(event.clientY, maxY),
      });
    },
    [],
  );

  const handleAddCollisionBodyClick = React.useCallback(() => {
    if (onAddCollisionBody) {
      onAddCollisionBody(data.id);
      return;
    }

    const nextLink = appendCollisionBody(data);
    const nextEntries = getCollisionGeometryEntries(nextLink);
    const nextObjectIndex = Math.max(0, nextEntries.length - 1);

    onUpdate('link', data.id, buildCollisionPatch(nextLink));
    onSelectGeometry?.(data.id, 'collision', nextObjectIndex);
  }, [buildCollisionPatch, data, onAddCollisionBody, onSelectGeometry, onUpdate]);

  const handleDeleteCollisionBodyClick = React.useCallback(() => {
    if (collisionGeometryEntries.length === 0) {
      return;
    }

    const {
      link: nextLink,
      removed,
      nextObjectIndex,
    } = removeCollisionGeometryByObjectIndex(data, selectedCollisionObjectIndex);

    if (!removed) {
      return;
    }

    onUpdate('link', data.id, buildCollisionPatch(nextLink));

    if (nextObjectIndex === null) {
      onSelect?.('link', data.id);
      return;
    }

    if (onSelectGeometry) {
      onSelectGeometry(data.id, 'collision', nextObjectIndex);
      return;
    }

    onSelect?.('link', data.id, 'collision');
  }, [
    collisionGeometryEntries.length,
    buildCollisionPatch,
    data,
    onSelect,
    onSelectGeometry,
    onUpdate,
    selectedCollisionObjectIndex,
  ]);

  const collisionBodiesSection = (
    <div className="mb-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className={PROPERTY_EDITOR_SECTION_TITLE_CLASS}>{t.collisionBodiesList}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t.deleteCollisionGeometry}
            title={t.deleteCollisionGeometry}
            onClick={handleDeleteCollisionBodyClick}
            disabled={collisionGeometryEntries.length === 0}
            className={`${PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS} w-6 border-danger-border bg-danger-soft px-0 text-danger hover:border-danger-border hover:bg-danger-soft hover:text-danger-hover focus-visible:ring-danger/20`}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={t.addCollisionBody}
            title={t.addCollisionBody}
            onClick={handleAddCollisionBodyClick}
            className={`${PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS} w-6 px-0`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {collisionGeometryEntries.length ? (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border-black bg-panel-bg/70 p-1 custom-scrollbar">
          <div className="space-y-1 pr-0.5">
            {collisionGeometryEntries.map((entry) => {
              const isSelected = selectedCollisionObjectIndex === entry.objectIndex;
              const geometryTypeLabel = getGeometryTypeLabel(entry.geometry.type, t);
              const collisionLabel = fillTemplate(t.collisionBodyItem, {
                index: String(entry.objectIndex + 1),
              });
              const collisionDisplayName = entry.geometry.name?.trim() || collisionLabel;
              const isVisible = entry.geometry.visible !== false;
              const visibilityActionLabel = `${isVisible ? t.hide : t.show} ${collisionDisplayName}`;
              const isEditing = collisionListEditingObjectIndex === entry.objectIndex;

              return (
                <div
                  key={`${data.id}:collision:${entry.objectIndex}`}
                  data-collision-list-row={entry.objectIndex}
                  className={`flex items-center rounded-md border transition-colors ${
                    isSelected
                      ? 'border-system-blue/50 bg-system-blue/10'
                      : 'border-border-black/60 bg-panel-bg hover:bg-element-hover'
                  }`}
                  onContextMenu={(event) =>
                    handleCollisionListContextMenu(event, entry.objectIndex)
                  }
                >
                  {isEditing ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1">
                      <div
                        className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold ${
                          isSelected
                            ? 'border-system-blue/40 bg-system-blue/15 text-system-blue'
                            : 'border-border-black/60 bg-element-bg/70 text-text-secondary'
                        }`}
                      >
                        {entry.objectIndex + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <input
                          ref={collisionListRenameInputRef}
                          type="text"
                          value={collisionListEditingDraft}
                          aria-label={t.rename}
                          onChange={(event) => setCollisionListEditingDraft(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onBlur={commitCollisionListRenaming}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              commitCollisionListRenaming();
                            } else if (event.key === 'Escape') {
                              cancelCollisionListRenaming();
                            }
                          }}
                          className={`${PROPERTY_EDITOR_INPUT_CLASS} h-7 w-full min-w-0 px-2 text-[10px]`}
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={collisionDisplayName}
                      aria-pressed={isSelected}
                      onClick={() => handleSelectCollisionGeometry(entry.objectIndex)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/25"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
                        <div
                          className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold ${
                            isSelected
                              ? 'border-system-blue/40 bg-system-blue/15 text-system-blue'
                              : 'border-border-black/60 bg-element-bg/70 text-text-secondary'
                          }`}
                        >
                          {entry.objectIndex + 1}
                        </div>
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                          <span className="truncate text-[10px] font-semibold text-text-primary">
                            {collisionDisplayName}
                          </span>
                          {collisionDisplayName !== collisionLabel ? (
                            <span className="truncate text-[9px] text-text-tertiary">
                              {collisionLabel}
                            </span>
                          ) : null}
                          <span className="shrink-0 rounded-sm border border-border-black/50 bg-element-bg/80 px-1 py-0.5 text-[8.5px] font-medium leading-none text-text-secondary">
                            {geometryTypeLabel}
                          </span>
                        </div>
                      </div>
                    </button>
                  )}

                  <button
                    type="button"
                    aria-label={visibilityActionLabel}
                    aria-pressed={isVisible}
                    title={visibilityActionLabel}
                    onClick={() =>
                      handleToggleCollisionGeometryVisibility(entry.objectIndex, isVisible)
                    }
                    className={`mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/25 ${
                      isVisible
                        ? 'bg-system-blue/10 text-system-blue hover:bg-system-blue/15'
                        : 'bg-panel-bg text-text-tertiary hover:bg-element-hover hover:text-text-primary'
                    }`}
                  >
                    {isVisible ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border-black/60 bg-element-bg/60 px-3 py-2">
          <p className={PROPERTY_EDITOR_HELPER_TEXT_CLASS}>{t.collisionBodyEmpty}</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Viewer-side visual / collision / physics tabs */}
      <div>
        {/* Tab Navigation - Folder Style */}
        <div className="mb-0 flex items-stretch gap-0.5 rounded-t-lg border border-border-black bg-element-bg px-0.5 pt-0.5">
          <div className="w-px"></div>
          <DetailGeometryTabButton
            icon={Eye}
            isActive={linkTab === 'visual'}
            label={t.visualGeometry}
            onClick={() => handleTabChange('visual')}
          />
          <DetailGeometryTabButton
            icon={Box}
            isActive={linkTab === 'collision'}
            label={t.collisionGeometry}
            onClick={() => handleTabChange('collision')}
          />
          <DetailGeometryTabButton
            icon={Waypoints}
            isActive={linkTab === 'physics'}
            label={t.physics}
            onClick={() => handleTabChange('physics')}
          />
        </div>

        <DetailGeometryTabPanel activeTab={linkTab} tab="visual">
          {linkTab === 'visual' ? (
            <GeometryEditor
              componentId={componentId}
              data={data}
              robot={robot}
              category="visual"
              onUpdate={handleVisualGeometryUpdate}
              assets={assets}
              onUploadAsset={onUploadAsset}
              sourceFilePath={sourceFilePath}
              t={t}
              lang={lang}
              isTabbed={true}
              onLinkNameChange={(name) => onUpdate('link', selection.id!, { name })}
            />
          ) : null}
        </DetailGeometryTabPanel>

        <DetailGeometryTabPanel activeTab={linkTab} tab="collision">
          {linkTab === 'collision' ? (
            <div className="space-y-2">
              {collisionBodiesSection}
              <GeometryEditor
                componentId={componentId}
                data={data}
                robot={robot}
                category="collision"
                onUpdate={handleCollisionGeometryUpdate}
                assets={assets}
                onUploadAsset={onUploadAsset}
                sourceFilePath={sourceFilePath}
                t={t}
                lang={lang}
                isTabbed={true}
                showCollisionDeleteAction={false}
              />
            </div>
          ) : null}
        </DetailGeometryTabPanel>

        <DetailGeometryTabPanel activeTab={linkTab} tab="physics">
          {inertialSection}
        </DetailGeometryTabPanel>
      </div>

      <Dialog
        isOpen={Boolean(pendingMassInertiaDecision)}
        onClose={() => {
          setPendingMassInertiaDecision(null);
          setRememberMassInertiaBehavior(false);
        }}
        title={t.massChangeInertiaDialogTitle}
        width="w-[520px]"
        zIndexClassName="z-[260]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPendingMassInertiaDecision(null);
                setRememberMassInertiaBehavior(false);
              }}
            >
              {t.cancel}
            </Button>
            <Button type="button" onClick={handleConfirmMassInertiaDecision}>
              {t.confirm}
            </Button>
          </div>
        }
      >
        {pendingMassInertiaDecision ? (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-text-secondary">
              {fillTemplate(t.massChangeInertiaDialogMessage, {
                name: pendingMassInertiaDecision.linkSnapshot.name,
                mass: formatMassValue(pendingMassInertiaDecision.nextMass),
              })}
            </p>

            <div className="space-y-2">
              <SegmentedControl<ResolvedMassInertiaBehavior>
                size="sm"
                value={selectedMassInertiaBehavior}
                onChange={setSelectedMassInertiaBehavior}
                options={[
                  {
                    value: 'preserve',
                    label: t.massChangeInertiaKeep,
                  },
                  {
                    value: 'reestimate',
                    label: t.massChangeInertiaReestimate,
                    disabled: !pendingMassInertiaDecision.scaledEstimate,
                  },
                ]}
              />
              <div className="rounded-xl border border-border-black bg-element-bg/60 px-3 py-2.5">
                <div className="text-xs font-semibold text-text-primary">
                  {selectedMassInertiaBehavior === 'preserve'
                    ? t.massChangeInertiaKeepDescription
                    : t.massChangeInertiaReestimateDescription}
                </div>
                {selectedMassInertiaBehavior === 'reestimate' &&
                !pendingMassInertiaDecision.scaledEstimate ? (
                  <div className="mt-1.5 text-[11px] leading-5 text-danger">
                    {t.massChangeInertiaReestimateUnavailable}
                  </div>
                ) : null}
              </div>
            </div>

            <Checkbox
              checked={rememberMassInertiaBehavior}
              onChange={setRememberMassInertiaBehavior}
              label={t.massChangeInertiaRememberChoice}
            />
          </div>
        ) : null}
      </Dialog>

      {floatingMassInertiaNotice && typeof document !== 'undefined' && document.body
        ? createPortal(
            <div className="pointer-events-none fixed left-1/2 top-20 z-[200] flex max-w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex items-start gap-2.5 rounded-[1.75rem] border border-border-black bg-panel-bg px-3.5 py-2.5 shadow-2xl dark:shadow-black/40">
                <div
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    floatingMassInertiaNotice.tone === 'success'
                      ? 'bg-emerald-500'
                      : 'bg-system-blue'
                  }`}
                />
                <div className="text-xs font-semibold leading-5 text-text-primary">
                  {floatingMassInertiaNotice.message}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <ContextMenuFrame position={collisionListContextMenu}>
        <ContextMenuItem
          onClick={() => {
            if (!collisionListContextMenu) {
              return;
            }
            beginCollisionListRenaming(collisionListContextMenu.objectIndex);
            setCollisionListContextMenu(null);
          }}
          icon={<Edit3 size={12} />}
        >
          {t.rename}
        </ContextMenuItem>
      </ContextMenuFrame>
    </>
  );
};
