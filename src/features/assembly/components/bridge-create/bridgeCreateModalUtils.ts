import { getMjcfLinkDisplayName } from '@/shared/utils/robot/mjcfDisplayNames';
import { formatNumberWithMaxDecimals, roundToMaxDecimals } from '@/core/utils/numberPrecision';
import {
  JointType,
  type AssemblyComponent,
  type AssemblyState,
  type JointHardwareInterface,
} from '@/types';
import type { SelectOption } from '@/shared/components/ui';
import type { BridgePreviewDraft } from '../../utils/bridgePreview';
import type { BridgeRotationDisplayMode } from './bridgeCreateModalTypes';
import {
  BRIDGE_EMPTY_SELECT_OPTION,
  BRIDGE_HALF_ROTATION_DEGREES,
} from './bridgeCreateModalStyles';

interface BridgeFlatLinkOption extends SelectOption {
  componentId: string;
  linkId: string;
}

const EMPTY_FLAT_LINK_OPTION: BridgeFlatLinkOption = {
  ...BRIDGE_EMPTY_SELECT_OPTION,
  componentId: '',
  linkId: '',
};

export function buildFlatBridgeLinkOptions(
  components: AssemblyComponent[],
): BridgeFlatLinkOption[] {
  return [
    EMPTY_FLAT_LINK_OPTION,
    ...components.flatMap((component) =>
      Object.values(component.robot.links).map((link) => ({
        value: JSON.stringify([component.id, link.id]),
        label: `${component.name} › ${getBridgeLinkDisplayName(component.robot, link.id)}`,
        componentId: component.id,
        linkId: link.id,
      })),
    ),
  ];
}

export function resolveFlatBridgeLinkValue(
  options: BridgeFlatLinkOption[],
  componentId: string,
  linkId: string,
): string {
  return (
    options.find((option) => option.componentId === componentId && option.linkId === linkId)
      ?.value ?? ''
  );
}

export function resolveBridgeComponentDefaultLinkId(
  assemblyState: AssemblyState,
  componentId: string,
): string {
  if (!componentId) {
    return '';
  }

  return assemblyState.components[componentId]?.robot.rootLinkId ?? '';
}

export function getBridgeLinkDisplayName(
  robot: AssemblyState['components'][string]['robot'] | null | undefined,
  linkId: string | null | undefined,
): string {
  if (!robot || !linkId) {
    return '--';
  }

  const link = robot.links[linkId];
  if (!link) {
    return linkId;
  }

  return robot.inspectionContext?.sourceFormat === 'mjcf'
    ? getMjcfLinkDisplayName(link)
    : link.name;
}

export function hasIncomingStructuralBridge(
  assemblyState: AssemblyState,
  componentId: string,
): boolean {
  if (!componentId) {
    return false;
  }

  return Object.values(assemblyState.bridges).some(
    (bridge) => bridge.childComponentId === componentId,
  );
}

export function clampValue(value: number, min?: number, max?: number) {
  let nextValue = value;

  if (min !== undefined) {
    nextValue = Math.max(min, nextValue);
  }

  if (max !== undefined) {
    nextValue = Math.min(max, nextValue);
  }

  return nextValue;
}

export function formatBridgeNumber(value: number, precision: number) {
  return formatNumberWithMaxDecimals(roundToMaxDecimals(value, precision), precision) || '0';
}

export function normalizeBridgeDegreesAngle(value: number): number {
  let normalized = ((value % 360) + 360) % 360;
  if (normalized > BRIDGE_HALF_ROTATION_DEGREES) {
    normalized -= 360;
  }
  return Object.is(normalized, -0) ? 0 : normalized;
}

function sanitizeBridgeNamePart(value: string | null | undefined): string {
  const sanitized = String(value ?? '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_./-]+|[_./-]+$/g, '');

  return sanitized || 'robot';
}

export function buildSuggestedBridgeName({
  assemblyState,
  parentComponentId,
  childComponentId,
}: {
  assemblyState: AssemblyState;
  parentComponentId: string;
  childComponentId: string;
}): string {
  if (!parentComponentId || !childComponentId || parentComponentId === childComponentId) {
    return '';
  }

  const parentComponent = assemblyState.components[parentComponentId];
  const childComponent = assemblyState.components[childComponentId];
  if (!parentComponent || !childComponent) {
    return '';
  }

  const parentName = sanitizeBridgeNamePart(
    parentComponent.name || parentComponent.robot.name || parentComponent.id,
  );
  const childName = sanitizeBridgeNamePart(
    childComponent.name || childComponent.robot.name || childComponent.id,
  );
  const baseName = `${parentName}-${childName}`;
  const existingNames = new Set(
    Object.values(assemblyState.bridges)
      .map((bridge) => bridge.name.trim())
      .filter(Boolean),
  );

  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let duplicateIndex = 1;
  let nextName = `${baseName}-${duplicateIndex}`;
  while (existingNames.has(nextName)) {
    duplicateIndex += 1;
    nextName = `${baseName}-${duplicateIndex}`;
  }

  return nextName;
}

export interface BuildBridgePreviewDraftInput {
  name: string;
  parentComponentId: string;
  parentLinkId: string;
  childComponentId: string;
  childLinkId: string;
  jointType: JointType;
  hardwareInterface?: JointHardwareInterface;
  jointSupportsAxisAndLimits: boolean;
  originX: number;
  originY: number;
  originZ: number;
  axisX: number;
  axisY: number;
  axisZ: number;
  limitLower: number;
  limitUpper: number;
  limitEffort: number;
  limitVelocity: number;
  rotationDisplayMode: BridgeRotationDisplayMode;
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  quatX: number;
  quatY: number;
  quatZ: number;
  quatW: number;
}

/**
 * Build the BridgePreviewDraft shared by preview + submit from modal form state.
 * Extracted from BridgeCreateModal, where previewBridge / submitJoint useMemo
 * duplicated this exact object literal (~18 fields).
 */
export function buildBridgePreviewDraft(input: BuildBridgePreviewDraftInput): BridgePreviewDraft {
  return {
    name: input.name,
    parentComponentId: input.parentComponentId,
    parentLinkId: input.parentLinkId,
    childComponentId: input.childComponentId,
    childLinkId: input.childLinkId,
    jointType: input.jointType,
    hardwareInterface: input.jointSupportsAxisAndLimits ? input.hardwareInterface : undefined,
    originXyz: { x: input.originX, y: input.originY, z: input.originZ },
    axis: { x: input.axisX, y: input.axisY, z: input.axisZ },
    limitLower: input.limitLower,
    limitUpper: input.limitUpper,
    limitEffort: input.limitEffort,
    limitVelocity: input.limitVelocity,
    rotationMode: input.rotationDisplayMode === 'quaternion' ? 'quaternion' : 'euler_deg',
    rotationEulerDeg: { r: input.rollDeg, p: input.pitchDeg, y: input.yawDeg },
    rotationQuaternion: { x: input.quatX, y: input.quatY, z: input.quatZ, w: input.quatW },
  };
}
