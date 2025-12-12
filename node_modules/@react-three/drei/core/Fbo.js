import * as React from 'react';
import { forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

// 👇 uncomment when TS version supports function overloads
// export function useFBO(settings?: FBOSettings)
function useFBO(/** Width in pixels, or settings (will render fullscreen by default) */
width, /** Height in pixels */
height, /**Settings */
settings) {
  const size = useThree(state => state.size);
  const viewport = useThree(state => state.viewport);
  const _width = typeof width === 'number' ? width : size.width * viewport.dpr;
  const _height = typeof height === 'number' ? height : size.height * viewport.dpr;
  const _settings = (typeof width === 'number' ? settings : width) || {};
  const {
    samples = 0,
    depth,
    ...targetSettings
  } = _settings;
  const depthBuffer = depth !== null && depth !== void 0 ? depth : _settings.depthBuffer; // backwards compatibility for deprecated `depth` prop

  const target = React.useMemo(() => {
    const target = new THREE.WebGLRenderTarget(_width, _height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      ...targetSettings
    });
    if (depthBuffer) {
      target.depthTexture = new THREE.DepthTexture(_width, _height, THREE.FloatType);
    }
    target.samples = samples;
    return target;
  }, []);
  React.useLayoutEffect(() => {
    target.setSize(_width, _height);
    if (samples) target.samples = samples;
  }, [samples, target, _width, _height]);
  React.useEffect(() => {
    return () => target.dispose();
  }, []);
  return target;
}

//
// Fbo component
//

const Fbo = /* @__PURE__ */forwardRef(({
  children,
  width,
  height,
  ...settings
}, fref) => {
  const target = useFBO(width, height, settings);
  useImperativeHandle(fref, () => target, [target]); // expose target through ref

  return /*#__PURE__*/React.createElement(React.Fragment, null, children == null ? void 0 : children(target));
});

export { Fbo, useFBO };
