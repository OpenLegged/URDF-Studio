/**
 * BridgeCreateModal - Dialog to create a bridge joint between two components
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import { Link2 } from 'lucide-react';
import {
  DraggableWindow,
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import {
  Button,
  CLOSE_BUTTON_DANGER_TERTIARY_CLASS,
  PanelSelect,
  SegmentedControl,
  type SelectOption,
} from '@/shared/components/ui';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import { resolveSuggestedBridgeOriginForVisualContact } from '@/core/robot/assemblyBridgeAlignment';
import { wouldBridgeCreateUnsupportedAssemblyCycle } from '@/core/robot/assemblyBridgeTopology';
import { degToRad, radToDeg } from '@/core/robot/transforms';
import { DEFAULT_JOINT, JointType, type JointHardwareInterface } from '@/types';
import { translations } from '@/shared/i18n';
import { useManagedWindowLayer } from '@/store';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { filterSelectableBridgeComponents } from '../../utils/bridgeSelection';
import { buildBridgeJointFromDraft, buildBridgePreview } from '../../utils/bridgePreview';
import {
  BridgeAxisSpinnerField,
  BridgeInlineFieldRow,
  BridgeQuickRotateButtonGroup,
  BridgeSection,
  BridgeSpinnerField,
} from './BridgeCreateFields';
import { BridgeEndpointChooser } from './BridgeEndpointInputs';
import {
  BRIDGE_PANEL_SELECT_CLASS,
  BRIDGE_ROTATION_SHORTCUT_DEGREES,
  BRIDGE_SELECT_CLASS,
} from './bridgeCreateModalStyles';
import type {
  BridgeCreateModalProps,
  BridgeEndpointInputMode,
  BridgeEulerAxisKey,
} from './bridgeCreateModalTypes';
import {
  buildFlatBridgeLinkOptions,
  buildSuggestedBridgeName,
  getBridgeLinkDisplayName,
  hasIncomingStructuralBridge,
  resolveFlatBridgeLinkValue,
} from './bridgeCreateModalUtils';
import { useBridgeCreateDraft } from './useBridgeCreateDraft';
import { useBridgeCreateSelectionSync } from './useBridgeCreateSelectionSync';
import { useJointPickController } from './useJointPickController';

export type { BridgeCreateModalProps } from './bridgeCreateModalTypes';

function resolveBridgeRotationShortcutAxis(key: string): BridgeEulerAxisKey | null {
  switch (key.toLowerCase()) {
    case 'x':
      return 'r';
    case 'y':
      return 'p';
    case 'z':
      return 'y';
    default:
      return null;
  }
}

function isBridgeRotationShortcutEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]'),
  );
}

const formatTemplateValue = (template: string, value: string): string =>
  template.replace('{value}', value);

export const BridgeCreateModal: React.FC<BridgeCreateModalProps> = ({
  isOpen,
  onClose,
  onPreviewChange,
  onCreate,
  lang,
}) => {
  const t = translations[lang];
  const bridgeCreateWindowLayer = useManagedWindowLayer('bridgeCreate');
  const sideCardTitle = { parent: t.bridgeBaseLink, child: t.bridgeAttachLink };
  const compactLabelWidthClassName = lang === 'zh' ? 'w-[30px]' : 'w-[44px]';
  const fullRowLabelClassName = 'w-auto whitespace-nowrap';
  const axisLabelWidthClassName = 'w-4 justify-center';
  const compactPositionLimitLabelClassName = lang === 'zh' ? 'w-[52px]' : 'w-[128px]';
  const compactLimitLabelClassName = lang === 'zh' ? 'w-[34px]' : 'w-[64px]';
  const nameInputId = React.useId();
  const jointTypeSelectId = React.useId();
  const defaultWindowSize = useMemo(() => ({ width: 420, height: 480 }), []);
  const workspace = useWorkspaceStore((state) => state.workspace);
  const comps = useMemo(() => Object.values(workspace.components), [workspace.components]);
  const defaultPosition = useMemo(() => {
    if (typeof window === 'undefined') {
      return { x: 72, y: 92 };
    }

    return {
      x: Math.max(16, window.innerWidth - defaultWindowSize.width - 24),
      y: 92,
    };
  }, [defaultWindowSize.width]);
  const windowState = useDraggableWindow({
    isOpen,
    defaultPosition,
    defaultSize: defaultWindowSize,
    minSize: { width: 360, height: 320 },
    centerOnMount: false,
    enableMinimize: false,
    enableMaximize: false,
    dragBounds: {
      allowNegativeX: false,
      minVisibleWidth: 120,
      topMargin: 64,
      bottomMargin: 56,
    },
  });
  const usesInlineIdentityRow = windowState.size.width >= 320;
  const usesCadInspectorLayout = windowState.size.width >= 640;
  const topFieldGridClassName = usesInlineIdentityRow
    ? `grid items-center gap-x-1.5 gap-y-1 ${
        lang === 'zh'
          ? 'grid-cols-[30px_minmax(0,1fr)_30px_minmax(0,1fr)]'
          : 'grid-cols-[44px_minmax(0,1fr)_44px_minmax(0,1fr)]'
      }`
    : 'space-y-1.5';
  const xyzStackClassName = 'space-y-1';
  const transformPanelClassName = usesCadInspectorLayout
    ? 'grid grid-cols-[minmax(0,0.68fr)_minmax(0,1fr)] gap-1.5'
    : 'space-y-1.5';
  const jointPanelClassName = usesCadInspectorLayout
    ? 'grid grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] gap-1.5'
    : 'space-y-1.5';
  const quaternionFieldGridClassName = usesCadInspectorLayout
    ? 'grid grid-cols-4 gap-1.5'
    : 'grid grid-cols-2 gap-1.5';
  const eulerFieldGridClassName = usesCadInspectorLayout ? 'grid grid-cols-3 gap-1.5' : 'space-y-1';
  const limitsGridClassName = usesCadInspectorLayout ? 'grid grid-cols-2 gap-1.5' : 'space-y-1';
  const defaultJointLimit = DEFAULT_JOINT.limit;
  const defaultLimitLower = defaultJointLimit?.lower ?? -1.57;
  const defaultLimitUpper = defaultJointLimit?.upper ?? 1.57;
  const defaultLimitEffort = defaultJointLimit?.effort ?? 100;
  const defaultLimitVelocity = defaultJointLimit?.velocity ?? 10;

  const {
    applyEulerRotation,
    applyPickedOrigin,
    applyQuaternionRotation,
    applySuggestedOrigin,
    axisX,
    axisY,
    axisZ,
    childCompId,
    childLinkId,
    endpointInputMode,
    handleNameBlur,
    handleNameChange,
    handleOriginXChange,
    handleOriginYChange,
    handleOriginZChange,
    handleQuickRotate,
    hardwareInterface,
    jointType,
    limitEffort,
    limitLower,
    limitUpper,
    limitVelocity,
    name,
    originDirtyRef,
    originX,
    originY,
    originZ,
    parentCompId,
    parentLinkId,
    pickTarget,
    pitchDeg,
    previousBridgeRelationSignatureRef,
    quatW,
    quatX,
    quatY,
    quatZ,
    resetForm,
    rollDeg,
    rotationDisplayMode,
    setAxisX,
    setAxisY,
    setAxisZ,
    setChildCompId,
    setChildLinkId,
    setEndpointInputMode,
    setHardwareInterface,
    setJointType,
    setLimitEffort,
    setLimitLower,
    setLimitUpper,
    setLimitVelocity,
    setParentCompId,
    setParentLinkId,
    setPickTarget,
    setRotationDisplayMode,
    syncSuggestedName,
    yawDeg,
  } = useBridgeCreateDraft({
    defaultLimitEffort,
    defaultLimitLower,
    defaultLimitUpper,
    defaultLimitVelocity,
  });

  const geometryPickingEnabled = endpointInputMode === 'geometry';
  const jointPick = useJointPickController({
    isOpen,
    enabled: geometryPickingEnabled,
    parentComponentId: parentCompId,
    parentLinkId,
    childComponentId: childCompId,
    childLinkId,
    setParentCompId,
    setParentLinkId,
    setChildCompId,
    setChildLinkId,
    setPickTarget,
    applyPickedOrigin,
  });
  const hasCurrentParentSnap = Boolean(
    jointPick.parentSnap &&
    jointPick.parentSnap.componentId === parentCompId &&
    jointPick.parentSnap.linkId === parentLinkId,
  );
  const hasCurrentChildSnap = Boolean(
    jointPick.childSnap &&
    jointPick.childSnap.componentId === childCompId &&
    jointPick.childSnap.linkId === childLinkId,
  );
  const hasPickedOriginForCurrentRelation = hasCurrentParentSnap && hasCurrentChildSnap;

  const parentComp = parentCompId ? workspace.components[parentCompId] : null;
  const childComp = childCompId ? workspace.components[childCompId] : null;
  const parentComponentOptions = useMemo(
    () => filterSelectableBridgeComponents(comps, childCompId || null),
    [childCompId, comps],
  );
  const childComponentHasIncomingBridge = useMemo(
    () => hasIncomingStructuralBridge(workspace, childCompId),
    [childCompId, workspace],
  );
  const childComponentOptions = useMemo(
    () =>
      filterSelectableBridgeComponents(comps, parentCompId || null).filter(
        (component) => !hasIncomingStructuralBridge(workspace, component.id),
      ),
    [comps, parentCompId, workspace],
  );
  const jointTypeSelectOptions = useMemo<SelectOption[]>(
    () => [
      { value: JointType.FIXED, label: t.jointTypeFixed },
      { value: JointType.REVOLUTE, label: t.jointTypeRevolute },
      { value: JointType.CONTINUOUS, label: t.jointTypeContinuous },
      { value: JointType.PRISMATIC, label: t.jointTypePrismatic },
    ],
    [t.jointTypeContinuous, t.jointTypeFixed, t.jointTypePrismatic, t.jointTypeRevolute],
  );
  const hardwareInterfaceSelectOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'position', label: t.hardwareInterfacePosition },
      { value: 'effort', label: t.hardwareInterfaceEffort },
      { value: 'velocity', label: t.hardwareInterfaceVelocity },
    ],
    [t.hardwareInterfaceEffort, t.hardwareInterfacePosition, t.hardwareInterfaceVelocity],
  );
  const parentFlatLinkOptions = useMemo(
    () => buildFlatBridgeLinkOptions(parentComponentOptions),
    [parentComponentOptions],
  );
  const childFlatLinkOptions = useMemo(
    () => buildFlatBridgeLinkOptions(childComponentOptions),
    [childComponentOptions],
  );
  const parentFlatLinkValue = resolveFlatBridgeLinkValue(
    parentFlatLinkOptions,
    parentCompId,
    parentLinkId,
  );
  const childFlatLinkValue = resolveFlatBridgeLinkValue(
    childFlatLinkOptions,
    childCompId,
    childLinkId,
  );
  const suggestedBridgeName = useMemo(
    () =>
      buildSuggestedBridgeName({
        assemblyState: workspace,
        parentComponentId: parentCompId,
        childComponentId: childCompId,
      }),
    [childCompId, parentCompId, workspace],
  );
  const effectiveBridgeName = name.trim() || suggestedBridgeName;
  const parentSummary = parentComp?.name ?? '--';
  const childSummary = childComp?.name ?? '--';
  const parentLinkSummary = getBridgeLinkDisplayName(parentComp?.robot, parentLinkId);
  const childLinkSummary = getBridgeLinkDisplayName(childComp?.robot, childLinkId);
  const parentEndpointSummary =
    parentCompId && parentLinkId ? `${parentSummary} › ${parentLinkSummary}` : t.bridgePickEndpoint;
  const childEndpointSummary =
    childCompId && childLinkId ? `${childSummary} › ${childLinkSummary}` : t.bridgePickEndpoint;
  const snapKindLabels = {
    surface: t.bridgeSnapKindSurface,
    faceCenter: t.bridgeSnapKindFaceCenter,
    bboxCenter: t.bridgeSnapKindObjectCenter,
    geometryCenter: t.bridgeSnapKindObjectCenter,
    circleCenter: t.bridgeSnapKindCircleCenter,
    cylinderAxis: t.bridgeSnapKindCylinderAxis,
    vertex: t.bridgeSnapKindVertex,
    edgeMidpoint: t.bridgeSnapKindEdgeMidpoint,
  } as const;
  const jointSupportsAxisAndLimits = jointType !== JointType.FIXED;
  const jointSupportsPositionLimits =
    jointType === JointType.REVOLUTE || jointType === JointType.PRISMATIC;
  const isLimitRangeInvalid = jointSupportsPositionLimits && limitLower > limitUpper;
  const limitRangeValidationMessage = isLimitRangeInvalid ? t.bridgeLimitRangeInvalid : null;
  const hasUnsupportedNonFixedCycle = useMemo(
    () =>
      Boolean(parentCompId) &&
      Boolean(childCompId) &&
      parentCompId !== childCompId &&
      wouldBridgeCreateUnsupportedAssemblyCycle(
        Object.values(workspace.bridges),
        {
          id: '__bridge_preview__',
          parentComponentId: parentCompId,
          childComponentId: childCompId,
        },
        jointType,
      ),
    [childCompId, jointType, parentCompId, workspace.bridges],
  );
  const nonFixedCycleValidationMessage = hasUnsupportedNonFixedCycle
    ? t.bridgeNonFixedCycleUnsupported
    : null;
  const validationMessages = [limitRangeValidationMessage, nonFixedCycleValidationMessage].filter(
    (message): message is string => Boolean(message),
  );
  const positionLowerLabel = t.bridgePositionLowerLimit;
  const positionUpperLabel = t.bridgePositionUpperLimit;
  const rollRad = useMemo(() => degToRad(rollDeg), [rollDeg]);
  const pitchRad = useMemo(() => degToRad(pitchDeg), [pitchDeg]);
  const yawRad = useMemo(() => degToRad(yawDeg), [yawDeg]);

  const quickRotateButtonText =
    rotationDisplayMode === 'euler_rad'
      ? { decrease: '-π/2', increase: '+π/2' }
      : { decrease: '-90', increase: '+90' };
  const quickRotateAriaLabelSuffix =
    rotationDisplayMode === 'euler_rad'
      ? {
          decrease: formatTemplateValue(t.decreaseValue, 'π/2'),
          increase: formatTemplateValue(t.increaseValue, 'π/2'),
        }
      : {
          decrease: formatTemplateValue(t.decreaseValue, `${BRIDGE_ROTATION_SHORTCUT_DEGREES}°`),
          increase: formatTemplateValue(t.increaseValue, `${BRIDGE_ROTATION_SHORTCUT_DEGREES}°`),
        };
  const rotationAxisFields = [
    {
      key: 'r' as const,
      label: t.roll,
      value: rotationDisplayMode === 'euler_rad' ? rollRad : rollDeg,
      onChange: (nextValue: number) =>
        applyEulerRotation({
          r: rotationDisplayMode === 'euler_rad' ? radToDeg(nextValue) : nextValue,
          p: pitchDeg,
          y: yawDeg,
        }),
    },
    {
      key: 'p' as const,
      label: t.pitch,
      value: rotationDisplayMode === 'euler_rad' ? pitchRad : pitchDeg,
      onChange: (nextValue: number) =>
        applyEulerRotation({
          r: rollDeg,
          p: rotationDisplayMode === 'euler_rad' ? radToDeg(nextValue) : nextValue,
          y: yawDeg,
        }),
    },
    {
      key: 'y' as const,
      label: t.yaw,
      value: rotationDisplayMode === 'euler_rad' ? yawRad : yawDeg,
      onChange: (nextValue: number) =>
        applyEulerRotation({
          r: rollDeg,
          p: pitchDeg,
          y: rotationDisplayMode === 'euler_rad' ? radToDeg(nextValue) : nextValue,
        }),
    },
  ];

  const previewBridge = useMemo(
    () =>
      buildBridgePreview({
        name: effectiveBridgeName,
        parentComponentId: parentCompId,
        parentLinkId,
        childComponentId: childCompId,
        childLinkId,
        jointType,
        hardwareInterface: jointSupportsAxisAndLimits ? hardwareInterface : undefined,
        originXyz: { x: originX, y: originY, z: originZ },
        axis: { x: axisX, y: axisY, z: axisZ },
        limitLower,
        limitUpper,
        limitEffort,
        limitVelocity,
        rotationMode: rotationDisplayMode === 'quaternion' ? 'quaternion' : 'euler_deg',
        rotationEulerDeg: { r: rollDeg, p: pitchDeg, y: yawDeg },
        rotationQuaternion: { x: quatX, y: quatY, z: quatZ, w: quatW },
      }),
    [
      axisX,
      axisY,
      axisZ,
      childCompId,
      childLinkId,
      hardwareInterface,
      jointSupportsAxisAndLimits,
      jointType,
      limitLower,
      limitUpper,
      limitEffort,
      limitVelocity,
      effectiveBridgeName,
      originX,
      originY,
      originZ,
      parentCompId,
      parentLinkId,
      pitchDeg,
      quatW,
      quatX,
      quatY,
      quatZ,
      rollDeg,
      rotationDisplayMode,
      yawDeg,
    ],
  );
  const submitJoint = useMemo(
    () =>
      buildBridgeJointFromDraft(
        {
          name: effectiveBridgeName,
          parentComponentId: parentCompId,
          parentLinkId,
          childComponentId: childCompId,
          childLinkId,
          jointType,
          hardwareInterface: jointSupportsAxisAndLimits ? hardwareInterface : undefined,
          originXyz: { x: originX, y: originY, z: originZ },
          axis: { x: axisX, y: axisY, z: axisZ },
          limitLower,
          limitUpper,
          limitEffort,
          limitVelocity,
          rotationMode: rotationDisplayMode === 'quaternion' ? 'quaternion' : 'euler_deg',
          rotationEulerDeg: { r: rollDeg, p: pitchDeg, y: yawDeg },
          rotationQuaternion: { x: quatX, y: quatY, z: quatZ, w: quatW },
        },
        effectiveBridgeName || 'bridge_joint',
      ),
    [
      axisX,
      axisY,
      axisZ,
      childCompId,
      childLinkId,
      hardwareInterface,
      jointSupportsAxisAndLimits,
      jointType,
      limitLower,
      limitUpper,
      limitEffort,
      limitVelocity,
      effectiveBridgeName,
      originX,
      originY,
      originZ,
      parentCompId,
      parentLinkId,
      pitchDeg,
      quatW,
      quatX,
      quatY,
      quatZ,
      rollDeg,
      rotationDisplayMode,
      yawDeg,
    ],
  );
  const isBridgeSelectionIncomplete =
    !parentCompId ||
    !parentLinkId ||
    !childCompId ||
    !childLinkId ||
    parentCompId === childCompId ||
    childComponentHasIncomingBridge ||
    (geometryPickingEnabled && !hasPickedOriginForCurrentRelation);

  const isConfirmActuallyDisabled =
    isBridgeSelectionIncomplete ||
    !effectiveBridgeName ||
    !submitJoint ||
    isLimitRangeInvalid ||
    hasUnsupportedNonFixedCycle;

  const handleSubmit = useCallback(() => {
    if (!submitJoint || isConfirmActuallyDisabled) {
      return;
    }

    const createParams = {
      name: effectiveBridgeName,
      parentComponentId: parentCompId,
      parentLinkId,
      childComponentId: childCompId,
      childLinkId,
      joint: {
        type: submitJoint.type,
        origin: submitJoint.origin,
        axis: submitJoint.axis ?? { x: axisX, y: axisY, z: axisZ },
        limit: submitJoint.limit,
        hardware: submitJoint.hardware,
      },
    };

    onPreviewChange?.(null);
    resetForm();
    onClose();
    window.requestAnimationFrame(() => {
      onCreate(createParams);
    });
  }, [
    axisX,
    axisY,
    axisZ,
    childCompId,
    childLinkId,
    effectiveBridgeName,
    isConfirmActuallyDisabled,
    onClose,
    onCreate,
    onPreviewChange,
    parentCompId,
    parentLinkId,
    resetForm,
    submitJoint,
  ]);

  const handleClose = useCallback(() => {
    onPreviewChange?.(null);
    resetForm();
    onClose();
  }, [onClose, onPreviewChange, resetForm]);

  const handleEndpointInputModeChange = useCallback(
    (nextMode: BridgeEndpointInputMode) => {
      if (nextMode === endpointInputMode) {
        return;
      }

      // Component/link ownership survives mode changes, while geometric frames
      // cannot: a frame is meaningful only in the geometry-pick workflow.
      jointPick.clearSide('parent');
      jointPick.clearSide('child');
      setEndpointInputMode(nextMode);

      if (nextMode === 'geometry') {
        setPickTarget('parent');
        jointPick.startPick('parent');
        return;
      }

      originDirtyRef.current = false;
      jointPick.cancelPick();
    },
    [endpointInputMode, jointPick, originDirtyRef, setEndpointInputMode, setPickTarget],
  );

  const handleFlatLinkChange = useCallback(
    (side: 'parent' | 'child', value: string) => {
      const options = side === 'parent' ? parentFlatLinkOptions : childFlatLinkOptions;
      const selectedOption = options.find((option) => option.value === value);
      const componentId = selectedOption?.componentId ?? '';
      const linkId = selectedOption?.linkId ?? '';

      setPickTarget(side);
      if (side === 'parent') {
        setParentCompId(componentId);
        setParentLinkId(linkId);
        return;
      }

      setChildCompId(componentId);
      setChildLinkId(linkId);
    },
    [
      childFlatLinkOptions,
      parentFlatLinkOptions,
      setChildCompId,
      setChildLinkId,
      setParentCompId,
      setParentLinkId,
      setPickTarget,
    ],
  );

  useBridgeCreateSelectionSync({
    parentCompId,
    childCompId,
    childLinkId,
    enabled: geometryPickingEnabled,
    handleClose,
    isOpen,
    onPreviewChange,
    pickTarget,
    setChildCompId,
    setChildLinkId,
    setParentCompId,
    setParentLinkId,
    setPickTarget,
  });
  const canPickJointOrigin = comps.length >= 2;
  const resolveEndpointDetail = (side: 'parent' | 'child') => {
    const snap = side === 'parent' ? jointPick.parentSnap : jointPick.childSnap;
    if (snap) {
      return snapKindLabels[snap.kind];
    }
    if (!canPickJointOrigin) {
      return t.bridgeSelectRelationFirst;
    }
    return jointPick.active && jointPick.side === side
      ? t.bridgePickEndpointActive
      : t.bridgePickEndpointInactive;
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    syncSuggestedName(suggestedBridgeName);
  }, [isOpen, suggestedBridgeName, syncSuggestedName]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isBridgeRotationShortcutEditableTarget(event.target)
      ) {
        return;
      }

      const axis = resolveBridgeRotationShortcutAxis(event.key);
      if (!axis) {
        return;
      }

      event.preventDefault();
      handleQuickRotate(axis, event.shiftKey ? -1 : 1);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleQuickRotate, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const relationSignature = [parentCompId, parentLinkId, childCompId, childLinkId].join('|');
    if (relationSignature !== previousBridgeRelationSignatureRef.current) {
      previousBridgeRelationSignatureRef.current = relationSignature;
      originDirtyRef.current = false;
    }
  }, [childCompId, childLinkId, isOpen, parentCompId, parentLinkId]);

  useEffect(() => {
    if (
      !isOpen ||
      originDirtyRef.current ||
      hasPickedOriginForCurrentRelation ||
      !parentCompId ||
      !parentLinkId ||
      !childCompId ||
      !childLinkId ||
      parentCompId === childCompId
    ) {
      return;
    }

    const suggestedOrigin = resolveSuggestedBridgeOriginForVisualContact({
      assemblyState: workspace,
      parentComponentId: parentCompId,
      parentLinkId,
      childComponentId: childCompId,
      childLinkId,
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: {
          r: degToRad(rollDeg),
          p: degToRad(pitchDeg),
          y: degToRad(yawDeg),
        },
      },
    });
    if (!suggestedOrigin) {
      return;
    }

    if (
      suggestedOrigin.x === originX &&
      suggestedOrigin.y === originY &&
      suggestedOrigin.z === originZ
    ) {
      return;
    }

    applySuggestedOrigin(suggestedOrigin);
  }, [
    applySuggestedOrigin,
    workspace,
    childCompId,
    childLinkId,
    hasPickedOriginForCurrentRelation,
    endpointInputMode,
    isOpen,
    originX,
    originY,
    originZ,
    parentCompId,
    parentLinkId,
    pitchDeg,
    rollDeg,
    yawDeg,
  ]);

  useEffect(() => {
    if (!isOpen) {
      originDirtyRef.current = false;
      previousBridgeRelationSignatureRef.current = '';
      return;
    }

    onPreviewChange?.(previewBridge);
  }, [isOpen, onPreviewChange, previewBridge]);

  if (!isOpen) return null;

  return (
    <DraggableWindow
      window={windowState}
      onClose={handleClose}
      title={
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-md border border-border-black bg-element-bg p-1 text-system-blue">
            <Link2 className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className={`truncate ${FLOATING_WINDOW_TITLE_CLASS}`}>
              {t.createBridge}
            </div>
          </div>
        </div>
      }
      className={`flex flex-col overflow-hidden ${FLOATING_WINDOW_RADIUS_CLASS} border border-border-black bg-panel-bg text-text-primary shadow-2xl`}
      zIndex={bridgeCreateWindowLayer.zIndex}
      onActivate={bridgeCreateWindowLayer.onActivate}
      headerClassName={`flex ${FLOATING_WINDOW_HEADER_HEIGHT_CLASS} shrink-0 items-center justify-between gap-2 border-b border-border-black bg-element-bg px-2.5`}
      headerLeftClassName="flex min-w-0 flex-1 items-center gap-2"
      headerRightClassName="flex shrink-0 items-center gap-1"
      interactionClassName="select-none"
      showMinimizeButton={false}
      showMaximizeButton={false}
      showResizeHandles
      leftResizeHandleClassName="pointer-events-none absolute left-0 top-0 bottom-0 w-0"
      rightResizeHandleClassName="absolute resize-edge-right resize-edge-visual-right top-0 bottom-0 z-20 w-2 cursor-ew-resize after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
      bottomResizeHandleClassName="absolute resize-edge-bottom resize-edge-visual-bottom left-0 right-0 z-20 h-2 cursor-ns-resize after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
      cornerResizeHandleClassName="absolute resize-edge-bottom resize-edge-right z-30 flex h-6 w-6 cursor-nwse-resize items-end justify-end"
      cornerResizeHandle={
        <div className="mb-1 mr-1 h-2 w-2 border-b border-r border-border-strong" />
      }
      closeTitle={t.close}
      controlButtonClassName="rounded-md p-1 text-text-tertiary transition-colors hover:bg-element-hover"
      closeButtonClassName={`rounded-md p-1 ${CLOSE_BUTTON_DANGER_TERTIARY_CLASS}`}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 custom-scrollbar">
        <div className="space-y-2">
          {/* Identity row — always visible */}
          <div data-bridge-row="identity" className={topFieldGridClassName}>
            <BridgeInlineFieldRow
              label={t.name}
              htmlFor={nameInputId}
              fieldKey="name"
              className="min-w-0"
              labelClassName={compactLabelWidthClassName}
              layout={usesInlineIdentityRow ? 'contents' : 'row'}
            >
              <input
                id={nameInputId}
                type="text"
                value={name}
                onChange={(event) => handleNameChange(event.target.value)}
                onBlur={() => handleNameBlur(suggestedBridgeName)}
                placeholder={t.bridgeJointNamePlaceholder}
                className={BRIDGE_SELECT_CLASS}
              />
            </BridgeInlineFieldRow>

            <BridgeInlineFieldRow
              label={t.type}
              htmlFor={jointTypeSelectId}
              fieldKey="type"
              className="min-w-0"
              labelClassName={compactLabelWidthClassName}
              layout={usesInlineIdentityRow ? 'contents' : 'row'}
            >
              <PanelSelect
                variant="property"
                id={jointTypeSelectId}
                options={jointTypeSelectOptions}
                value={jointType}
                onChange={(event) => setJointType(event.target.value as JointType)}
                className={BRIDGE_PANEL_SELECT_CLASS}
              />
            </BridgeInlineFieldRow>
          </div>

          {validationMessages.length > 0 ? (
            <div
              data-bridge-validation
              className="space-y-1 rounded-lg border border-danger-border bg-danger-soft px-2 py-1.5"
            >
              {validationMessages.map((message) => (
                <p key={message} className="text-[9px] font-medium leading-4 text-danger">
                  {message}
                </p>
              ))}
            </div>
          ) : null}

          <BridgeEndpointChooser
            mode={endpointInputMode}
            modeAriaLabel={t.bridgeInputMode}
            geometryModeLabel={t.bridgeGeometryMode}
            linkListModeLabel={t.bridgeLinkListMode}
            liveStatus={
              geometryPickingEnabled
                ? jointPick.side === 'parent'
                  ? t.bridgePickActiveParent
                  : t.bridgePickActiveChild
                : t.bridgeLinkListMode
            }
            parentEndpoint={{
              title: sideCardTitle.parent,
              summary: parentEndpointSummary,
              detail: resolveEndpointDetail('parent'),
              componentId: parentCompId,
              linkId: parentLinkId,
              componentSummary: parentSummary,
              linkSummary: parentLinkSummary,
              active: jointPick.active && jointPick.side === 'parent',
              snapped: hasCurrentParentSnap,
              clearLabel: t.bridgeRepickBase,
            }}
            childEndpoint={{
              title: sideCardTitle.child,
              summary: childEndpointSummary,
              detail: resolveEndpointDetail('child'),
              componentId: childCompId,
              linkId: childLinkId,
              componentSummary: childSummary,
              linkSummary: childLinkSummary,
              active: jointPick.active && jointPick.side === 'child',
              snapped: hasCurrentChildSnap,
              clearLabel: t.bridgeRepickAttach,
            }}
            freePointHint={t.bridgeSnapHintFreePoint}
            parentLinkAriaLabel={t.parentLink}
            childLinkAriaLabel={t.childLink}
            parentLinkOptions={parentFlatLinkOptions}
            childLinkOptions={childFlatLinkOptions}
            parentLinkValue={parentFlatLinkValue}
            childLinkValue={childFlatLinkValue}
            onModeChange={handleEndpointInputModeChange}
            onEndpointActivate={(side) => {
              setPickTarget(side);
              jointPick.startPick(side);
            }}
            onEndpointClear={(side) => {
              jointPick.clearSide(side);
              setPickTarget(side);
              jointPick.startPick(side);
            }}
            onLinkChange={handleFlatLinkChange}
          />

          <BridgeSection
            title={t.bridgeAdvancedSettings}
            collapsible
            collapsedSummary="XYZ · RPY"
            stateDataAttribute="bridge-advanced"
          >
            <div className="min-h-0 space-y-2" data-bridge-section-content>
              {jointSupportsAxisAndLimits ? (
                <BridgeInlineFieldRow
                  label={t.hardwareInterface}
                  fieldKey="hardware-interface"
                  className="min-w-0"
                  labelClassName={fullRowLabelClassName}
                >
                  <PanelSelect
                    variant="property"
                    aria-label={t.hardwareInterface}
                    options={hardwareInterfaceSelectOptions}
                    value={hardwareInterface}
                    onChange={(event) =>
                      setHardwareInterface(event.target.value as JointHardwareInterface)
                    }
                    className={BRIDGE_PANEL_SELECT_CLASS}
                  />
                </BridgeInlineFieldRow>
              ) : null}

              <div data-bridge-section-panel="transform" className={transformPanelClassName}>
                <BridgeSection title={t.originRelativeParent}>
                  <div data-bridge-row="origin" className={xyzStackClassName}>
                    <BridgeAxisSpinnerField
                      axis="x"
                      fieldKey="origin-x"
                      label="X"
                      value={originX}
                      step={0.01}
                      precision={4}
                      onChange={handleOriginXChange}
                      className="min-w-0"
                    />
                    <BridgeAxisSpinnerField
                      axis="y"
                      fieldKey="origin-y"
                      label="Y"
                      value={originY}
                      step={0.01}
                      precision={4}
                      onChange={handleOriginYChange}
                      className="min-w-0"
                    />
                    <BridgeAxisSpinnerField
                      axis="z"
                      fieldKey="origin-z"
                      label="Z"
                      value={originZ}
                      step={0.01}
                      precision={4}
                      onChange={handleOriginZChange}
                      className="min-w-0"
                    />
                  </div>
                </BridgeSection>

                <BridgeSection title={t.rotation}>
                  <SegmentedControl
                    options={[
                      { value: 'euler_deg', label: t.eulerDegrees },
                      { value: 'euler_rad', label: t.eulerRadians },
                      { value: 'quaternion', label: t.quaternion },
                    ]}
                    value={rotationDisplayMode}
                    onChange={(value) => setRotationDisplayMode(value)}
                    size="xs"
                    className="w-full [&>button]:min-h-6 [&>button]:flex-1 [&>button]:!gap-0.5 [&>button]:!px-1.5 [&>button]:!py-0 [&>button]:!text-[9px]"
                  />

                  {rotationDisplayMode === 'quaternion' ? (
                    <div className={`mt-1.5 ${quaternionFieldGridClassName}`}>
                      <BridgeSpinnerField
                        fieldKey="quat-x"
                        label="X"
                        value={quatX}
                        step={0.001}
                        precision={4}
                        onChange={(value) =>
                          applyQuaternionRotation({ x: value, y: quatY, z: quatZ, w: quatW })
                        }
                        className="min-w-0"
                      />
                      <BridgeSpinnerField
                        fieldKey="quat-y"
                        label="Y"
                        value={quatY}
                        step={0.001}
                        precision={4}
                        onChange={(value) =>
                          applyQuaternionRotation({ x: quatX, y: value, z: quatZ, w: quatW })
                        }
                        className="min-w-0"
                      />
                      <BridgeSpinnerField
                        fieldKey="quat-z"
                        label="Z"
                        value={quatZ}
                        step={0.001}
                        precision={4}
                        onChange={(value) =>
                          applyQuaternionRotation({ x: quatX, y: quatY, z: value, w: quatW })
                        }
                        className="min-w-0"
                      />
                      <BridgeSpinnerField
                        fieldKey="quat-w"
                        label="W"
                        value={quatW}
                        step={0.001}
                        precision={4}
                        onChange={(value) =>
                          applyQuaternionRotation({ x: quatX, y: quatY, z: quatZ, w: value })
                        }
                        className="min-w-0"
                      />
                    </div>
                  ) : usesCadInspectorLayout ? (
                    <div className={`mt-1.5 ${eulerFieldGridClassName}`}>
                      {rotationAxisFields.map((field) => (
                        <div key={field.key} className="min-w-0 space-y-1">
                          <BridgeSpinnerField
                            fieldKey={`rot-${field.key}`}
                            label={field.label}
                            value={field.value}
                            step={rotationDisplayMode === 'euler_rad' ? 0.1 : 1}
                            precision={rotationDisplayMode === 'euler_rad' ? 4 : 2}
                            onChange={field.onChange}
                            className="min-w-0"
                          />
                          <BridgeQuickRotateButtonGroup
                            label={field.label}
                            decreaseLabel={quickRotateAriaLabelSuffix.decrease}
                            increaseLabel={quickRotateAriaLabelSuffix.increase}
                            decreaseText={quickRotateButtonText.decrease}
                            increaseText={quickRotateButtonText.increase}
                            onDecrease={() => handleQuickRotate(field.key, -1)}
                            onIncrease={() => handleQuickRotate(field.key, 1)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1.5 space-y-1">
                      {rotationAxisFields.map((field) => (
                        <div
                          key={field.key}
                          className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-1"
                        >
                          <BridgeSpinnerField
                            inline
                            label={field.label}
                            value={field.value}
                            step={rotationDisplayMode === 'euler_rad' ? 0.1 : 1}
                            precision={rotationDisplayMode === 'euler_rad' ? 4 : 2}
                            onChange={field.onChange}
                            className="gap-1.5"
                            labelClassName="w-[34px]"
                          />
                          <BridgeQuickRotateButtonGroup
                            label={field.label}
                            decreaseLabel={quickRotateAriaLabelSuffix.decrease}
                            increaseLabel={quickRotateAriaLabelSuffix.increase}
                            decreaseText={quickRotateButtonText.decrease}
                            increaseText={quickRotateButtonText.increase}
                            onDecrease={() => handleQuickRotate(field.key, -1)}
                            onIncrease={() => handleQuickRotate(field.key, 1)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </BridgeSection>
              </div>

              {jointSupportsAxisAndLimits ? (
                <div data-bridge-section-panel="joint" className={jointPanelClassName}>
                  <BridgeSection
                    title={t.axisRotation}
                    collapsible
                    collapsedSummary={`(${axisX}, ${axisY}, ${axisZ})`}
                  >
                    <div data-bridge-row="axis" className={xyzStackClassName}>
                      <BridgeSpinnerField
                        inline
                        fieldKey="axis-x"
                        label="X"
                        value={axisX}
                        step={0.01}
                        precision={4}
                        onChange={setAxisX}
                        className="min-w-0"
                        labelClassName={axisLabelWidthClassName}
                      />
                      <BridgeSpinnerField
                        inline
                        fieldKey="axis-y"
                        label="Y"
                        value={axisY}
                        step={0.01}
                        precision={4}
                        onChange={setAxisY}
                        className="min-w-0"
                        labelClassName={axisLabelWidthClassName}
                      />
                      <BridgeSpinnerField
                        inline
                        fieldKey="axis-z"
                        label="Z"
                        value={axisZ}
                        step={0.01}
                        precision={4}
                        onChange={setAxisZ}
                        className="min-w-0"
                        labelClassName={axisLabelWidthClassName}
                      />
                    </div>
                  </BridgeSection>

                  <BridgeSection
                    title={t.limits}
                    collapsible
                    collapsedSummary={
                      jointSupportsPositionLimits
                        ? `[${limitLower}, ${limitUpper}]`
                        : `E=${limitEffort} V=${limitVelocity}`
                    }
                  >
                    <div className={limitsGridClassName}>
                      {jointSupportsPositionLimits && usesCadInspectorLayout ? (
                        <>
                          <BridgeSpinnerField
                            fieldKey="limit-lower"
                            label={positionLowerLabel}
                            value={limitLower}
                            step={0.01}
                            precision={4}
                            onChange={setLimitLower}
                            className="min-w-0"
                          />
                          <BridgeSpinnerField
                            fieldKey="limit-upper"
                            label={positionUpperLabel}
                            value={limitUpper}
                            step={0.01}
                            precision={4}
                            onChange={setLimitUpper}
                            className="min-w-0"
                          />
                        </>
                      ) : jointSupportsPositionLimits ? (
                        <>
                          <BridgeSpinnerField
                            inline
                            label={positionLowerLabel}
                            value={limitLower}
                            step={0.01}
                            precision={4}
                            onChange={setLimitLower}
                            className="gap-1.5"
                            labelClassName={compactPositionLimitLabelClassName}
                          />
                          <BridgeSpinnerField
                            inline
                            label={positionUpperLabel}
                            value={limitUpper}
                            step={0.01}
                            precision={4}
                            onChange={setLimitUpper}
                            className="gap-1.5"
                            labelClassName={compactPositionLimitLabelClassName}
                          />
                        </>
                      ) : null}
                      {usesCadInspectorLayout ? (
                        <>
                          <BridgeSpinnerField
                            fieldKey="limit-effort"
                            label={t.effort}
                            value={limitEffort}
                            step={1}
                            precision={2}
                            min={0}
                            onChange={setLimitEffort}
                            className="min-w-0"
                          />
                          <BridgeSpinnerField
                            fieldKey="limit-velocity"
                            label={t.velocity}
                            value={limitVelocity}
                            step={0.1}
                            precision={3}
                            min={0}
                            onChange={setLimitVelocity}
                            className="min-w-0"
                          />
                        </>
                      ) : (
                        <>
                          <BridgeSpinnerField
                            inline
                            label={t.effort}
                            value={limitEffort}
                            step={1}
                            precision={2}
                            min={0}
                            onChange={setLimitEffort}
                            className="gap-1.5"
                            labelClassName={compactLimitLabelClassName}
                          />
                          <BridgeSpinnerField
                            inline
                            label={t.velocity}
                            value={limitVelocity}
                            step={0.1}
                            precision={3}
                            min={0}
                            onChange={setLimitVelocity}
                            className="gap-1.5"
                            labelClassName={compactLimitLabelClassName}
                          />
                        </>
                      )}
                    </div>
                  </BridgeSection>
                </div>
              ) : null}
            </div>
          </BridgeSection>
        </div>
      </div>

      <div
        data-bridge-footer
        className="flex shrink-0 justify-end gap-2 border-t border-border-black bg-element-bg px-2 py-2"
      >
        <Button variant="secondary" size="sm" onClick={handleClose} type="button">
          {t.cancel}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={isConfirmActuallyDisabled}
          type="button"
        >
          {t.confirm}
        </Button>
      </div>
    </DraggableWindow>
  );
};
