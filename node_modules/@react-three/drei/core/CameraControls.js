import _extends from '@babel/runtime/helpers/esm/extends';
import { Box3, MathUtils, Matrix4, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 } from 'three';
import * as React from 'react';
import { forwardRef, useMemo, useEffect } from 'react';
import { extend, useThree, useFrame } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
export { default as CameraControlsImpl } from 'camera-controls';

const CameraControls = /* @__PURE__ */forwardRef((props, ref) => {
  const {
    impl: SubclassImpl,
    camera,
    domElement,
    makeDefault,
    onControlStart,
    onControl,
    onControlEnd,
    onTransitionStart,
    onUpdate,
    onWake,
    onRest,
    onSleep,
    onStart,
    onEnd,
    onChange,
    regress,
    ...restProps
  } = props;
  const Impl = SubclassImpl !== null && SubclassImpl !== void 0 ? SubclassImpl : CameraControlsImpl;

  // useMemo is used here instead of useEffect, otherwise the useMemo below runs first and throws
  useMemo(() => {
    // to allow for tree shaking, we only import the subset of THREE that is used by camera-controls
    // see https://github.com/yomotsu/camera-controls#important
    const subsetOfTHREE = {
      Box3,
      MathUtils: {
        clamp: MathUtils.clamp
      },
      Matrix4,
      Quaternion,
      Raycaster,
      Sphere,
      Spherical,
      Vector2,
      Vector3,
      Vector4
    };
    Impl.install({
      THREE: subsetOfTHREE
    });
    extend({
      CameraControlsImpl: Impl
    });
  }, [Impl]);
  const defaultCamera = useThree(state => state.camera);
  const gl = useThree(state => state.gl);
  const invalidate = useThree(state => state.invalidate);
  const events = useThree(state => state.events);
  const setEvents = useThree(state => state.setEvents);
  const set = useThree(state => state.set);
  const get = useThree(state => state.get);
  const performance = useThree(state => state.performance);
  const explCamera = camera || defaultCamera;
  const explDomElement = domElement || events.connected || gl.domElement;
  const controls = useMemo(() => new Impl(explCamera), [Impl, explCamera]);
  useFrame((state, delta) => {
    controls.update(delta);
  }, -1);
  useEffect(() => {
    controls.connect(explDomElement);
    return () => void controls.disconnect();
  }, [explDomElement, controls]);
  useEffect(() => {
    function invalidateAndRegress() {
      invalidate();
      if (regress) performance.regress();
    }
    const handleControlStart = e => {
      invalidateAndRegress();
      onControlStart == null || onControlStart(e);
      onStart == null || onStart(e); // backwards compatibility
    };
    const handleControl = e => {
      invalidateAndRegress();
      onControl == null || onControl(e);
      onChange == null || onChange(e); // backwards compatibility
    };
    const handleControlEnd = e => {
      onControlEnd == null || onControlEnd(e);
      onEnd == null || onEnd(e); // backwards compatibility
    };
    const handleTransitionStart = e => {
      invalidateAndRegress();
      onTransitionStart == null || onTransitionStart(e);
      onChange == null || onChange(e); // backwards compatibility
    };
    const handleUpdate = e => {
      invalidateAndRegress();
      onUpdate == null || onUpdate(e);
      onChange == null || onChange(e); // backwards compatibility
    };
    const handleWake = e => {
      invalidateAndRegress();
      onWake == null || onWake(e);
      onChange == null || onChange(e); // backwards compatibility
    };
    const handleRest = e => {
      onRest == null || onRest(e);
    };
    const handleSleep = e => {
      onSleep == null || onSleep(e);
    };
    controls.addEventListener('controlstart', handleControlStart);
    controls.addEventListener('control', handleControl);
    controls.addEventListener('controlend', handleControlEnd);
    controls.addEventListener('transitionstart', handleTransitionStart);
    controls.addEventListener('update', handleUpdate);
    controls.addEventListener('wake', handleWake);
    controls.addEventListener('rest', handleRest);
    controls.addEventListener('sleep', handleSleep);
    return () => {
      controls.removeEventListener('controlstart', handleControlStart);
      controls.removeEventListener('control', handleControl);
      controls.removeEventListener('controlend', handleControlEnd);
      controls.removeEventListener('transitionstart', handleTransitionStart);
      controls.removeEventListener('update', handleUpdate);
      controls.removeEventListener('wake', handleWake);
      controls.removeEventListener('rest', handleRest);
      controls.removeEventListener('sleep', handleSleep);
    };
  }, [controls, invalidate, setEvents, regress, performance, onControlStart, onControl, onControlEnd, onTransitionStart, onUpdate, onWake, onRest, onSleep, onChange, onStart, onEnd]);
  useEffect(() => {
    if (makeDefault) {
      const old = get().controls;
      set({
        controls: controls
      });
      return () => set({
        controls: old
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [makeDefault, controls]);
  return /*#__PURE__*/React.createElement("primitive", _extends({
    ref: ref,
    object: controls
  }, restProps));
});

export { CameraControls };
