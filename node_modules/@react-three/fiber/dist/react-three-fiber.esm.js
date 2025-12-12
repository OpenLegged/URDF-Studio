import { e as extend, u as useBridge, a as useMutableCallback, b as useIsomorphicLayoutEffect, c as createRoot, i as isRef, E as ErrorBoundary, B as Block, d as unmountComponentAtNode, f as createPointerEvents } from './events-1eccaf1c.esm.js';
export { t as ReactThreeFiber, _ as _roots, x as act, k as addAfterEffect, j as addEffect, l as addTail, n as advance, s as applyProps, y as buildGraph, q as context, g as createEvents, o as createPortal, c as createRoot, w as dispose, f as events, e as extend, h as flushGlobalEffects, p as flushSync, v as getRootState, m as invalidate, r as reconciler, d as unmountComponentAtNode, D as useFrame, F as useGraph, z as useInstanceHandle, G as useLoader, A as useStore, C as useThree } from './events-1eccaf1c.esm.js';
import * as React from 'react';
import * as THREE from 'three';
import useMeasure from 'react-use-measure';
import { FiberProvider } from 'its-fine';
import { jsx } from 'react/jsx-runtime';
import 'react-reconciler/constants';
import 'zustand/traditional';
import 'suspend-react';
import 'react-reconciler';
import 'scheduler';

function CanvasImpl({
  ref,
  children,
  fallback,
  resize,
  style,
  gl,
  events = createPointerEvents,
  eventSource,
  eventPrefix,
  shadows,
  linear,
  flat,
  legacy,
  orthographic,
  frameloop,
  dpr,
  performance,
  raycaster,
  camera,
  scene,
  onPointerMissed,
  onCreated,
  ...props
}) {
  // Create a known catalogue of Threejs-native elements
  // This will include the entire THREE namespace by default, users can extend
  // their own elements by using the createRoot API instead
  React.useMemo(() => extend(THREE), []);
  const Bridge = useBridge();
  const [containerRef, containerRect] = useMeasure({
    scroll: true,
    debounce: {
      scroll: 50,
      resize: 0
    },
    ...resize
  });
  const canvasRef = React.useRef(null);
  const divRef = React.useRef(null);
  React.useImperativeHandle(ref, () => canvasRef.current);
  const handlePointerMissed = useMutableCallback(onPointerMissed);
  const [block, setBlock] = React.useState(false);
  const [error, setError] = React.useState(false);

  // Suspend this component if block is a promise (2nd run)
  if (block) throw block;
  // Throw exception outwards if anything within canvas throws
  if (error) throw error;
  const root = React.useRef(null);
  useIsomorphicLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (containerRect.width > 0 && containerRect.height > 0 && canvas) {
      if (!root.current) root.current = createRoot(canvas);
      async function run() {
        await root.current.configure({
          gl,
          scene,
          events,
          shadows,
          linear,
          flat,
          legacy,
          orthographic,
          frameloop,
          dpr,
          performance,
          raycaster,
          camera,
          size: containerRect,
          // Pass mutable reference to onPointerMissed so it's free to update
          onPointerMissed: (...args) => handlePointerMissed.current == null ? void 0 : handlePointerMissed.current(...args),
          onCreated: state => {
            // Connect to event source
            state.events.connect == null ? void 0 : state.events.connect(eventSource ? isRef(eventSource) ? eventSource.current : eventSource : divRef.current);
            // Set up compute function
            if (eventPrefix) {
              state.setEvents({
                compute: (event, state) => {
                  const x = event[eventPrefix + 'X'];
                  const y = event[eventPrefix + 'Y'];
                  state.pointer.set(x / state.size.width * 2 - 1, -(y / state.size.height) * 2 + 1);
                  state.raycaster.setFromCamera(state.pointer, state.camera);
                }
              });
            }
            // Call onCreated callback
            onCreated == null ? void 0 : onCreated(state);
          }
        });
        root.current.render( /*#__PURE__*/jsx(Bridge, {
          children: /*#__PURE__*/jsx(ErrorBoundary, {
            set: setError,
            children: /*#__PURE__*/jsx(React.Suspense, {
              fallback: /*#__PURE__*/jsx(Block, {
                set: setBlock
              }),
              children: children != null ? children : null
            })
          })
        }));
      }
      run();
    }
  });
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) return () => unmountComponentAtNode(canvas);
  }, []);

  // When the event source is not this div, we need to set pointer-events to none
  // Or else the canvas will block events from reaching the event source
  const pointerEvents = eventSource ? 'none' : 'auto';
  return /*#__PURE__*/jsx("div", {
    ref: divRef,
    style: {
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      pointerEvents,
      ...style
    },
    ...props,
    children: /*#__PURE__*/jsx("div", {
      ref: containerRef,
      style: {
        width: '100%',
        height: '100%'
      },
      children: /*#__PURE__*/jsx("canvas", {
        ref: canvasRef,
        style: {
          display: 'block'
        },
        children: fallback
      })
    })
  });
}

/**
 * A DOM canvas which accepts threejs elements as children.
 * @see https://docs.pmnd.rs/react-three-fiber/api/canvas
 */
function Canvas(props) {
  return /*#__PURE__*/jsx(FiberProvider, {
    children: /*#__PURE__*/jsx(CanvasImpl, {
      ...props
    })
  });
}

export { Canvas };
