import { useCallback, useRef, useState } from 'react';
import { JointType, type JointHardwareInterface } from '@/types';
import {
  bridgeEulerDegreesToQuaternion,
  bridgeQuaternionToEulerDegrees,
  normalizeBridgeQuaternion,
} from '../../utils/bridgePreview';
import type { BridgePickTarget } from '../../utils/bridgeSelection';
import type {
  BridgeEndpointInputMode,
  BridgeEulerAxisKey,
  BridgeRotationDisplayMode,
} from './bridgeCreateModalTypes';
import { BRIDGE_ROTATION_SHORTCUT_DEGREES } from './bridgeCreateModalStyles';
import { normalizeBridgeDegreesAngle } from './bridgeCreateModalUtils';

interface UseBridgeCreateDraftOptions {
  defaultLimitEffort: number;
  defaultLimitLower: number;
  defaultLimitUpper: number;
  defaultLimitVelocity: number;
}

function useBridgeDraftName() {
  const [name, setName] = useState('');
  const customizedRef = useRef(false);
  const valueRef = useRef('');
  const syncSuggestedName = useCallback((suggestedName: string) => {
    if (customizedRef.current || valueRef.current === suggestedName) return;
    valueRef.current = suggestedName;
    setName(suggestedName);
  }, []);
  const handleNameChange = useCallback((value: string) => {
    customizedRef.current = true;
    valueRef.current = value;
    setName(value);
  }, []);
  const handleNameBlur = useCallback((suggestedName: string) => {
    if (valueRef.current.trim()) return;
    customizedRef.current = false;
    valueRef.current = suggestedName;
    setName(suggestedName);
  }, []);
  const resetName = useCallback(() => {
    customizedRef.current = false;
    valueRef.current = '';
    setName('');
  }, []);
  return { handleNameBlur, handleNameChange, name, resetName, syncSuggestedName };
}

export function useBridgeCreateDraft({
  defaultLimitEffort,
  defaultLimitLower,
  defaultLimitUpper,
  defaultLimitVelocity,
}: UseBridgeCreateDraftOptions) {
  const { handleNameBlur, handleNameChange, name, resetName, syncSuggestedName } =
    useBridgeDraftName();
  const [parentCompId, setParentCompId] = useState('');
  const [parentLinkId, setParentLinkId] = useState('');
  const [childCompId, setChildCompId] = useState('');
  const [childLinkId, setChildLinkId] = useState('');
  const [endpointInputMode, setEndpointInputMode] = useState<BridgeEndpointInputMode>('geometry');
  const [jointType, setJointType] = useState<JointType>(JointType.FIXED);
  const [hardwareInterface, setHardwareInterface] = useState<JointHardwareInterface>('position');
  const [originX, setOriginX] = useState(0);
  const [originY, setOriginY] = useState(0);
  const [originZ, setOriginZ] = useState(0);
  const [rotationDisplayMode, setRotationDisplayMode] =
    useState<BridgeRotationDisplayMode>('euler_deg');
  const [rollDeg, setRollDeg] = useState(0);
  const [pitchDeg, setPitchDeg] = useState(0);
  const [yawDeg, setYawDeg] = useState(0);
  const [quatX, setQuatX] = useState(0);
  const [quatY, setQuatY] = useState(0);
  const [quatZ, setQuatZ] = useState(0);
  const [quatW, setQuatW] = useState(1);
  const [axisX, setAxisX] = useState(0);
  const [axisY, setAxisY] = useState(0);
  const [axisZ, setAxisZ] = useState(1);
  const eulerDegreesRef = useRef({ r: 0, p: 0, y: 0 });
  const [limitLower, setLimitLower] = useState(defaultLimitLower);
  const [limitUpper, setLimitUpper] = useState(defaultLimitUpper);
  const [limitEffort, setLimitEffort] = useState(defaultLimitEffort);
  const [limitVelocity, setLimitVelocity] = useState(defaultLimitVelocity);
  const [pickTarget, setPickTarget] = useState<BridgePickTarget>('parent');
  const originDirtyRef = useRef(false);
  const previousBridgeRelationSignatureRef = useRef('');

  const applyEulerRotation = useCallback((nextEulerDeg: { r: number; p: number; y: number }) => {
    eulerDegreesRef.current = nextEulerDeg;
    setRollDeg(nextEulerDeg.r);
    setPitchDeg(nextEulerDeg.p);
    setYawDeg(nextEulerDeg.y);

    const nextQuaternion = bridgeEulerDegreesToQuaternion(nextEulerDeg);
    setQuatX(nextQuaternion.x);
    setQuatY(nextQuaternion.y);
    setQuatZ(nextQuaternion.z);
    setQuatW(nextQuaternion.w);
  }, []);

  const applyQuaternionRotation = useCallback(
    (nextQuaternionValue: { x: number; y: number; z: number; w: number }) => {
      const normalizedQuaternion = normalizeBridgeQuaternion(nextQuaternionValue);
      setQuatX(normalizedQuaternion.x);
      setQuatY(normalizedQuaternion.y);
      setQuatZ(normalizedQuaternion.z);
      setQuatW(normalizedQuaternion.w);

      const nextEulerDegrees = bridgeQuaternionToEulerDegrees(normalizedQuaternion);
      eulerDegreesRef.current = nextEulerDegrees;
      setRollDeg(nextEulerDegrees.r);
      setPitchDeg(nextEulerDegrees.p);
      setYawDeg(nextEulerDegrees.y);
    },
    [],
  );

  const handleQuickRotate = useCallback(
    (axis: BridgeEulerAxisKey, direction: 1 | -1) => {
      const currentEuler = eulerDegreesRef.current;
      const delta = BRIDGE_ROTATION_SHORTCUT_DEGREES * direction;
      applyEulerRotation({
        r: axis === 'r' ? normalizeBridgeDegreesAngle(currentEuler.r + delta) : currentEuler.r,
        p: axis === 'p' ? normalizeBridgeDegreesAngle(currentEuler.p + delta) : currentEuler.p,
        y: axis === 'y' ? normalizeBridgeDegreesAngle(currentEuler.y + delta) : currentEuler.y,
      });
    },
    [applyEulerRotation],
  );

  const applySuggestedOrigin = useCallback((nextOrigin: { x: number; y: number; z: number }) => {
    originDirtyRef.current = false;
    setOriginX(nextOrigin.x);
    setOriginY(nextOrigin.y);
    setOriginZ(nextOrigin.z);
  }, []);

  // Joint-origin picking writes both position and orientation at once. Marking
  // the origin dirty stops the visual-contact auto-suggest from overwriting it.
  const applyPickedOrigin = useCallback(
    (
      position: { x: number; y: number; z: number },
      rotationDeg: { r: number; p: number; y: number },
    ) => {
      originDirtyRef.current = true;
      setOriginX(position.x);
      setOriginY(position.y);
      setOriginZ(position.z);
      applyEulerRotation(rotationDeg);
    },
    [applyEulerRotation],
  );

  const handleOriginXChange = useCallback((value: number) => {
    originDirtyRef.current = true;
    setOriginX(value);
  }, []);

  const handleOriginYChange = useCallback((value: number) => {
    originDirtyRef.current = true;
    setOriginY(value);
  }, []);

  const handleOriginZChange = useCallback((value: number) => {
    originDirtyRef.current = true;
    setOriginZ(value);
  }, []);

  const resetForm = useCallback(() => {
    resetName();
    setParentCompId('');
    setParentLinkId('');
    setChildCompId('');
    setChildLinkId('');
    setEndpointInputMode('geometry');
    setJointType(JointType.FIXED);
    setHardwareInterface('position');
    setOriginX(0);
    setOriginY(0);
    setOriginZ(0);
    setRotationDisplayMode('euler_deg');
    eulerDegreesRef.current = { r: 0, p: 0, y: 0 };
    setRollDeg(0);
    setPitchDeg(0);
    setYawDeg(0);
    setQuatX(0);
    setQuatY(0);
    setQuatZ(0);
    setQuatW(1);
    setAxisX(0);
    setAxisY(0);
    setAxisZ(1);
    setLimitLower(defaultLimitLower);
    setLimitUpper(defaultLimitUpper);
    setLimitEffort(defaultLimitEffort);
    setLimitVelocity(defaultLimitVelocity);
    setPickTarget('parent');
    originDirtyRef.current = false;
    previousBridgeRelationSignatureRef.current = '';
  }, [defaultLimitEffort, defaultLimitLower, defaultLimitUpper, defaultLimitVelocity, resetName]);

  return {
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
  };
}
