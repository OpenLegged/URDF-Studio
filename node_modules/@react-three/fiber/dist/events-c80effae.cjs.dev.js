'use strict';

var React = require('react');
var constants = require('react-reconciler/constants');
var THREE = require('three');
var traditional = require('zustand/traditional');
var suspendReact = require('suspend-react');
var Reconciler = require('react-reconciler');
var scheduler = require('scheduler');
var jsxRuntime = require('react/jsx-runtime');
var itsFine = require('its-fine');

function _interopDefault (e) { return e && e.__esModule ? e : { 'default': e }; }

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n["default"] = e;
  return Object.freeze(n);
}

var React__namespace = /*#__PURE__*/_interopNamespace(React);
var THREE__namespace = /*#__PURE__*/_interopNamespace(THREE);
var Reconciler__default = /*#__PURE__*/_interopDefault(Reconciler);

var threeTypes = /*#__PURE__*/Object.freeze({
  __proto__: null
});

/**
 * Returns the instance's initial (outmost) root.
 */
function findInitialRoot(instance) {
  let root = instance.root;
  while (root.getState().previousRoot) root = root.getState().previousRoot;
  return root;
}
/**
 * Safely flush async effects when testing, simulating a legacy root.
 * @deprecated Import from React instead. import { act } from 'react'
 */
// Reference with computed key to break Webpack static analysis
// https://github.com/webpack/webpack/issues/14814
const act = React__namespace['act' + ''];
const isOrthographicCamera = def => def && def.isOrthographicCamera;
const isRef = obj => obj && obj.hasOwnProperty('current');
const isColorRepresentation = value => value != null && (typeof value === 'string' || typeof value === 'number' || value.isColor);

/**
 * An SSR-friendly useLayoutEffect.
 *
 * React currently throws a warning when using useLayoutEffect on the server.
 * To get around it, we can conditionally useEffect on the server (no-op) and
 * useLayoutEffect elsewhere.
 *
 * @see https://github.com/facebook/react/issues/14927
 */
const useIsomorphicLayoutEffect = /* @__PURE__ */((_window$document, _window$navigator) => typeof window !== 'undefined' && (((_window$document = window.document) == null ? void 0 : _window$document.createElement) || ((_window$navigator = window.navigator) == null ? void 0 : _window$navigator.product) === 'ReactNative'))() ? React__namespace.useLayoutEffect : React__namespace.useEffect;
function useMutableCallback(fn) {
  const ref = React__namespace.useRef(fn);
  useIsomorphicLayoutEffect(() => void (ref.current = fn), [fn]);
  return ref;
}
/**
 * Bridges renderer Context and StrictMode from a primary renderer.
 */
function useBridge() {
  const fiber = itsFine.useFiber();
  const ContextBridge = itsFine.useContextBridge();
  return React__namespace.useMemo(() => ({
    children
  }) => {
    const strict = !!itsFine.traverseFiber(fiber, true, node => node.type === React__namespace.StrictMode);
    const Root = strict ? React__namespace.StrictMode : React__namespace.Fragment;
    return /*#__PURE__*/jsxRuntime.jsx(Root, {
      children: /*#__PURE__*/jsxRuntime.jsx(ContextBridge, {
        children: children
      })
    });
  }, [fiber, ContextBridge]);
}
function Block({
  set
}) {
  useIsomorphicLayoutEffect(() => {
    set(new Promise(() => null));
    return () => set(false);
  }, [set]);
  return null;
}

// NOTE: static members get down-level transpiled to mutations which break tree-shaking
const ErrorBoundary = /* @__PURE__ */(_ErrorBoundary => (_ErrorBoundary = class ErrorBoundary extends React__namespace.Component {
  constructor(...args) {
    super(...args);
    this.state = {
      error: false
    };
  }
  componentDidCatch(err) {
    this.props.set(err);
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}, _ErrorBoundary.getDerivedStateFromError = () => ({
  error: true
}), _ErrorBoundary))();
function calculateDpr(dpr) {
  var _window$devicePixelRa;
  // Err on the side of progress by assuming 2x dpr if we can't detect it
  // This will happen in workers where window is defined but dpr isn't.
  const target = typeof window !== 'undefined' ? (_window$devicePixelRa = window.devicePixelRatio) != null ? _window$devicePixelRa : 2 : 1;
  return Array.isArray(dpr) ? Math.min(Math.max(dpr[0], target), dpr[1]) : dpr;
}

/**
 * Returns instance root state
 */
function getRootState(obj) {
  var _r3f;
  return (_r3f = obj.__r3f) == null ? void 0 : _r3f.root.getState();
}
// A collection of compare functions
const is = {
  obj: a => a === Object(a) && !is.arr(a) && typeof a !== 'function',
  fun: a => typeof a === 'function',
  str: a => typeof a === 'string',
  num: a => typeof a === 'number',
  boo: a => typeof a === 'boolean',
  und: a => a === void 0,
  nul: a => a === null,
  arr: a => Array.isArray(a),
  equ(a, b, {
    arrays = 'shallow',
    objects = 'reference',
    strict = true
  } = {}) {
    // Wrong type or one of the two undefined, doesn't match
    if (typeof a !== typeof b || !!a !== !!b) return false;
    // Atomic, just compare a against b
    if (is.str(a) || is.num(a) || is.boo(a)) return a === b;
    const isObj = is.obj(a);
    if (isObj && objects === 'reference') return a === b;
    const isArr = is.arr(a);
    if (isArr && arrays === 'reference') return a === b;
    // Array or Object, shallow compare first to see if it's a match
    if ((isArr || isObj) && a === b) return true;
    // Last resort, go through keys
    let i;
    // Check if a has all the keys of b
    for (i in a) if (!(i in b)) return false;
    // Check if values between keys match
    if (isObj && arrays === 'shallow' && objects === 'shallow') {
      for (i in strict ? b : a) if (!is.equ(a[i], b[i], {
        strict,
        objects: 'reference'
      })) return false;
    } else {
      for (i in strict ? b : a) if (a[i] !== b[i]) return false;
    }
    // If i is undefined
    if (is.und(i)) {
      // If both arrays are empty we consider them equal
      if (isArr && a.length === 0 && b.length === 0) return true;
      // If both objects are empty we consider them equal
      if (isObj && Object.keys(a).length === 0 && Object.keys(b).length === 0) return true;
      // Otherwise match them by value
      if (a !== b) return false;
    }
    return true;
  }
};

// Collects nodes and materials from a THREE.Object3D
function buildGraph(object) {
  const data = {
    nodes: {},
    materials: {},
    meshes: {}
  };
  if (object) {
    object.traverse(obj => {
      if (obj.name) data.nodes[obj.name] = obj;
      if (obj.material && !data.materials[obj.material.name]) data.materials[obj.material.name] = obj.material;
      if (obj.isMesh && !data.meshes[obj.name]) data.meshes[obj.name] = obj;
    });
  }
  return data;
}
// Disposes an object and all its properties
function dispose(obj) {
  if (obj.type !== 'Scene') obj.dispose == null ? void 0 : obj.dispose();
  for (const p in obj) {
    const prop = obj[p];
    if ((prop == null ? void 0 : prop.type) !== 'Scene') prop == null ? void 0 : prop.dispose == null ? void 0 : prop.dispose();
  }
}
const REACT_INTERNAL_PROPS = ['children', 'key', 'ref'];

// Gets only instance props from reconciler fibers
function getInstanceProps(queue) {
  const props = {};
  for (const key in queue) {
    if (!REACT_INTERNAL_PROPS.includes(key)) props[key] = queue[key];
  }
  return props;
}

// Each object in the scene carries a small LocalState descriptor
function prepare(target, root, type, props) {
  const object = target;

  // Create instance descriptor
  let instance = object == null ? void 0 : object.__r3f;
  if (!instance) {
    instance = {
      root,
      type,
      parent: null,
      children: [],
      props: getInstanceProps(props),
      object,
      eventCount: 0,
      handlers: {},
      isHidden: false
    };
    if (object) object.__r3f = instance;
  }
  return instance;
}
function resolve(root, key) {
  if (!key.includes('-')) return {
    root,
    key,
    target: root[key]
  };

  // First try the entire key as a single property (e.g., 'foo-bar')
  if (key in root) {
    return {
      root,
      key,
      target: root[key]
    };
  }

  // Try piercing (e.g., 'material-color' -> material.color)
  let target = root;
  const parts = key.split('-');
  for (const part of parts) {
    if (typeof target !== 'object' || target === null) {
      if (target !== undefined) {
        // Property exists but has unexpected shape
        const remaining = parts.slice(parts.indexOf(part)).join('-');
        return {
          root: target,
          key: remaining,
          target: undefined
        };
      }
      // Property doesn't exist - fallback to original key
      return {
        root,
        key,
        target: undefined
      };
    }
    key = part;
    root = target;
    target = target[key];
  }
  return {
    root,
    key,
    target
  };
}

// Checks if a dash-cased string ends with an integer
const INDEX_REGEX = /-\d+$/;
function attach(parent, child) {
  if (is.str(child.props.attach)) {
    // If attaching into an array (foo-0), create one
    if (INDEX_REGEX.test(child.props.attach)) {
      const index = child.props.attach.replace(INDEX_REGEX, '');
      const {
        root,
        key
      } = resolve(parent.object, index);
      if (!Array.isArray(root[key])) root[key] = [];
    }
    const {
      root,
      key
    } = resolve(parent.object, child.props.attach);
    child.previousAttach = root[key];
    root[key] = child.object;
  } else if (is.fun(child.props.attach)) {
    child.previousAttach = child.props.attach(parent.object, child.object);
  }
}
function detach(parent, child) {
  if (is.str(child.props.attach)) {
    const {
      root,
      key
    } = resolve(parent.object, child.props.attach);
    const previous = child.previousAttach;
    // When the previous value was undefined, it means the value was never set to begin with
    if (previous === undefined) delete root[key];
    // Otherwise set the previous value
    else root[key] = previous;
  } else {
    child.previousAttach == null ? void 0 : child.previousAttach(parent.object, child.object);
  }
  delete child.previousAttach;
}
const RESERVED_PROPS = [...REACT_INTERNAL_PROPS,
// Instance props
'args', 'dispose', 'attach', 'object', 'onUpdate',
// Behavior flags
'dispose'];
const MEMOIZED_PROTOTYPES = new Map();
function getMemoizedPrototype(root) {
  let ctor = MEMOIZED_PROTOTYPES.get(root.constructor);
  try {
    if (!ctor) {
      ctor = new root.constructor();
      MEMOIZED_PROTOTYPES.set(root.constructor, ctor);
    }
  } catch (e) {
    // ...
  }
  return ctor;
}

// This function prepares a set of changes to be applied to the instance
function diffProps(instance, newProps) {
  const changedProps = {};

  // Sort through props
  for (const prop in newProps) {
    // Skip reserved keys
    if (RESERVED_PROPS.includes(prop)) continue;
    // Skip if props match
    if (is.equ(newProps[prop], instance.props[prop])) continue;

    // Props changed, add them
    changedProps[prop] = newProps[prop];

    // Reset pierced props
    for (const other in newProps) {
      if (other.startsWith(`${prop}-`)) changedProps[other] = newProps[other];
    }
  }

  // Reset removed props for HMR
  for (const prop in instance.props) {
    if (RESERVED_PROPS.includes(prop) || newProps.hasOwnProperty(prop)) continue;
    const {
      root,
      key
    } = resolve(instance.object, prop);

    // https://github.com/mrdoob/three.js/issues/21209
    // HMR/fast-refresh relies on the ability to cancel out props, but threejs
    // has no means to do this. Hence we curate a small collection of value-classes
    // with their respective constructor/set arguments
    // For removed props, try to set default values, if possible
    if (root.constructor && root.constructor.length === 0) {
      // create a blank slate of the instance and copy the particular parameter.
      const ctor = getMemoizedPrototype(root);
      if (!is.und(ctor)) changedProps[key] = ctor[key];
    } else {
      // instance does not have constructor, just set it to 0
      changedProps[key] = 0;
    }
  }
  return changedProps;
}

// https://github.com/mrdoob/three.js/pull/27042
// https://github.com/mrdoob/three.js/pull/22748
const colorMaps = ['map', 'emissiveMap', 'sheenColorMap', 'specularColorMap', 'envMap'];
const EVENT_REGEX = /^on(Pointer|Click|DoubleClick|ContextMenu|Wheel)/;
// This function applies a set of changes to the instance
function applyProps(object, props) {
  var _instance$object;
  const instance = object.__r3f;
  const rootState = instance && findInitialRoot(instance).getState();
  const prevHandlers = instance == null ? void 0 : instance.eventCount;
  for (const prop in props) {
    let value = props[prop];

    // Don't mutate reserved keys
    if (RESERVED_PROPS.includes(prop)) continue;

    // Deal with pointer events, including removing them if undefined
    if (instance && EVENT_REGEX.test(prop)) {
      if (typeof value === 'function') instance.handlers[prop] = value;else delete instance.handlers[prop];
      instance.eventCount = Object.keys(instance.handlers).length;
      continue;
    }

    // Ignore setting undefined props
    // https://github.com/pmndrs/react-three-fiber/issues/274
    if (value === undefined) continue;
    let {
      root,
      key,
      target
    } = resolve(object, prop);

    // Throw an error if we attempted to set a pierced prop to a non-object
    if (target === undefined && (typeof root !== 'object' || root === null)) {
      throw Error(`R3F: Cannot set "${prop}". Ensure it is an object before setting "${key}".`);
    }

    // Layers must be written to the mask property
    if (target instanceof THREE__namespace.Layers && value instanceof THREE__namespace.Layers) {
      target.mask = value.mask;
    }
    // Set colors if valid color representation for automatic conversion (copy)
    else if (target instanceof THREE__namespace.Color && isColorRepresentation(value)) {
      target.set(value);
    }
    // Copy if properties match signatures and implement math interface (likely read-only)
    else if (target !== null && typeof target === 'object' && typeof target.set === 'function' && typeof target.copy === 'function' && value != null && value.constructor && target.constructor === value.constructor) {
      target.copy(value);
    }
    // Set array types
    else if (target !== null && typeof target === 'object' && typeof target.set === 'function' && Array.isArray(value)) {
      if (typeof target.fromArray === 'function') target.fromArray(value);else target.set(...value);
    }
    // Set literal types
    else if (target !== null && typeof target === 'object' && typeof target.set === 'function' && typeof value === 'number') {
      // Allow setting array scalars
      if (typeof target.setScalar === 'function') target.setScalar(value);
      // Otherwise just set single value
      else target.set(value);
    }
    // Else, just overwrite the value
    else {
      var _root$key;
      root[key] = value;

      // Auto-convert sRGB texture parameters for built-in materials
      // https://github.com/pmndrs/react-three-fiber/issues/344
      // https://github.com/mrdoob/three.js/pull/25857
      if (rootState && !rootState.linear && colorMaps.includes(key) && (_root$key = root[key]) != null && _root$key.isTexture &&
      // sRGB textures must be RGBA8 since r137 https://github.com/mrdoob/three.js/pull/23129
      root[key].format === THREE__namespace.RGBAFormat && root[key].type === THREE__namespace.UnsignedByteType) {
        // NOTE: this cannot be set from the renderer (e.g. sRGB source textures rendered to P3)
        root[key].colorSpace = THREE__namespace.SRGBColorSpace;
      }
    }
  }

  // Register event handlers
  if (instance != null && instance.parent && rootState != null && rootState.internal && (_instance$object = instance.object) != null && _instance$object.isObject3D && prevHandlers !== instance.eventCount) {
    const object = instance.object;
    // Pre-emptively remove the instance from the interaction manager
    const index = rootState.internal.interaction.indexOf(object);
    if (index > -1) rootState.internal.interaction.splice(index, 1);
    // Add the instance to the interaction manager only when it has handlers
    if (instance.eventCount && object.raycast !== null) {
      rootState.internal.interaction.push(object);
    }
  }

  // Auto-attach geometries and materials
  if (instance && instance.props.attach === undefined) {
    if (instance.object.isBufferGeometry) instance.props.attach = 'geometry';else if (instance.object.isMaterial) instance.props.attach = 'material';
  }

  // Instance was updated, request a frame
  if (instance) invalidateInstance(instance);
  return object;
}
function invalidateInstance(instance) {
  var _instance$root;
  if (!instance.parent) return;
  instance.props.onUpdate == null ? void 0 : instance.props.onUpdate(instance.object);
  const state = (_instance$root = instance.root) == null ? void 0 : _instance$root.getState == null ? void 0 : _instance$root.getState();
  if (state && state.internal.frames === 0) state.invalidate();
}
function updateCamera(camera, size) {
  // Do not mess with the camera if it belongs to the user
  // https://github.com/pmndrs/react-three-fiber/issues/92
  if (camera.manual) return;
  if (isOrthographicCamera(camera)) {
    camera.left = size.width / -2;
    camera.right = size.width / 2;
    camera.top = size.height / 2;
    camera.bottom = size.height / -2;
  } else {
    camera.aspect = size.width / size.height;
  }
  camera.updateProjectionMatrix();
}
const isObject3D = object => object == null ? void 0 : object.isObject3D;

function makeId(event) {
  return (event.eventObject || event.object).uuid + '/' + event.index + event.instanceId;
}

/**
 * Release pointer captures.
 * This is called by releasePointerCapture in the API, and when an object is removed.
 */
function releaseInternalPointerCapture(capturedMap, obj, captures, pointerId) {
  const captureData = captures.get(obj);
  if (captureData) {
    captures.delete(obj);
    // If this was the last capturing object for this pointer
    if (captures.size === 0) {
      capturedMap.delete(pointerId);
      captureData.target.releasePointerCapture(pointerId);
    }
  }
}
function removeInteractivity(store, object) {
  const {
    internal
  } = store.getState();
  // Removes every trace of an object from the data store
  internal.interaction = internal.interaction.filter(o => o !== object);
  internal.initialHits = internal.initialHits.filter(o => o !== object);
  internal.hovered.forEach((value, key) => {
    if (value.eventObject === object || value.object === object) {
      // Clear out intersects, they are outdated by now
      internal.hovered.delete(key);
    }
  });
  internal.capturedMap.forEach((captures, pointerId) => {
    releaseInternalPointerCapture(internal.capturedMap, object, captures, pointerId);
  });
}
function createEvents(store) {
  /** Calculates delta */
  function calculateDistance(event) {
    const {
      internal
    } = store.getState();
    const dx = event.offsetX - internal.initialClick[0];
    const dy = event.offsetY - internal.initialClick[1];
    return Math.round(Math.sqrt(dx * dx + dy * dy));
  }

  /** Returns true if an instance has a valid pointer-event registered, this excludes scroll, clicks etc */
  function filterPointerEvents(objects) {
    return objects.filter(obj => ['Move', 'Over', 'Enter', 'Out', 'Leave'].some(name => {
      var _r3f;
      return (_r3f = obj.__r3f) == null ? void 0 : _r3f.handlers['onPointer' + name];
    }));
  }
  function intersect(event, filter) {
    const state = store.getState();
    const duplicates = new Set();
    const intersections = [];
    // Allow callers to eliminate event objects
    const eventsObjects = filter ? filter(state.internal.interaction) : state.internal.interaction;
    // Reset all raycaster cameras to undefined
    for (let i = 0; i < eventsObjects.length; i++) {
      const state = getRootState(eventsObjects[i]);
      if (state) {
        state.raycaster.camera = undefined;
      }
    }
    if (!state.previousRoot) {
      // Make sure root-level pointer and ray are set up
      state.events.compute == null ? void 0 : state.events.compute(event, state);
    }
    function handleRaycast(obj) {
      const state = getRootState(obj);
      // Skip event handling when noEvents is set, or when the raycasters camera is null
      if (!state || !state.events.enabled || state.raycaster.camera === null) return [];

      // When the camera is undefined we have to call the event layers update function
      if (state.raycaster.camera === undefined) {
        var _state$previousRoot;
        state.events.compute == null ? void 0 : state.events.compute(event, state, (_state$previousRoot = state.previousRoot) == null ? void 0 : _state$previousRoot.getState());
        // If the camera is still undefined we have to skip this layer entirely
        if (state.raycaster.camera === undefined) state.raycaster.camera = null;
      }

      // Intersect object by object
      return state.raycaster.camera ? state.raycaster.intersectObject(obj, true) : [];
    }

    // Collect events
    let hits = eventsObjects
    // Intersect objects
    .flatMap(handleRaycast)
    // Sort by event priority and distance
    .sort((a, b) => {
      const aState = getRootState(a.object);
      const bState = getRootState(b.object);
      if (!aState || !bState) return a.distance - b.distance;
      return bState.events.priority - aState.events.priority || a.distance - b.distance;
    })
    // Filter out duplicates
    .filter(item => {
      const id = makeId(item);
      if (duplicates.has(id)) return false;
      duplicates.add(id);
      return true;
    });

    // https://github.com/mrdoob/three.js/issues/16031
    // Allow custom userland intersect sort order, this likely only makes sense on the root filter
    if (state.events.filter) hits = state.events.filter(hits, state);

    // Bubble up the events, find the event source (eventObject)
    for (const hit of hits) {
      let eventObject = hit.object;
      // Bubble event up
      while (eventObject) {
        var _r3f2;
        if ((_r3f2 = eventObject.__r3f) != null && _r3f2.eventCount) intersections.push({
          ...hit,
          eventObject
        });
        eventObject = eventObject.parent;
      }
    }

    // If the interaction is captured, make all capturing targets part of the intersect.
    if ('pointerId' in event && state.internal.capturedMap.has(event.pointerId)) {
      for (let captureData of state.internal.capturedMap.get(event.pointerId).values()) {
        if (!duplicates.has(makeId(captureData.intersection))) intersections.push(captureData.intersection);
      }
    }
    return intersections;
  }

  /**  Handles intersections by forwarding them to handlers */
  function handleIntersects(intersections, event, delta, callback) {
    // If anything has been found, forward it to the event listeners
    if (intersections.length) {
      const localState = {
        stopped: false
      };
      for (const hit of intersections) {
        let state = getRootState(hit.object);

        // If the object is not managed by R3F, it might be parented to an element which is.
        // Traverse upwards until we find a managed parent and use its state instead.
        if (!state) {
          hit.object.traverseAncestors(obj => {
            const parentState = getRootState(obj);
            if (parentState) {
              state = parentState;
              return false;
            }
          });
        }
        if (state) {
          const {
            raycaster,
            pointer,
            camera,
            internal
          } = state;
          const unprojectedPoint = new THREE__namespace.Vector3(pointer.x, pointer.y, 0).unproject(camera);
          const hasPointerCapture = id => {
            var _internal$capturedMap, _internal$capturedMap2;
            return (_internal$capturedMap = (_internal$capturedMap2 = internal.capturedMap.get(id)) == null ? void 0 : _internal$capturedMap2.has(hit.eventObject)) != null ? _internal$capturedMap : false;
          };
          const setPointerCapture = id => {
            const captureData = {
              intersection: hit,
              target: event.target
            };
            if (internal.capturedMap.has(id)) {
              // if the pointerId was previously captured, we add the hit to the
              // event capturedMap.
              internal.capturedMap.get(id).set(hit.eventObject, captureData);
            } else {
              // if the pointerId was not previously captured, we create a map
              // containing the hitObject, and the hit. hitObject is used for
              // faster access.
              internal.capturedMap.set(id, new Map([[hit.eventObject, captureData]]));
            }
            event.target.setPointerCapture(id);
          };
          const releasePointerCapture = id => {
            const captures = internal.capturedMap.get(id);
            if (captures) {
              releaseInternalPointerCapture(internal.capturedMap, hit.eventObject, captures, id);
            }
          };

          // Add native event props
          let extractEventProps = {};
          // This iterates over the event's properties including the inherited ones. Native PointerEvents have most of their props as getters which are inherited, but polyfilled PointerEvents have them all as their own properties (i.e. not inherited). We can't use Object.keys() or Object.entries() as they only return "own" properties; nor Object.getPrototypeOf(event) as that *doesn't* return "own" properties, only inherited ones.
          for (let prop in event) {
            let property = event[prop];
            // Only copy over atomics, leave functions alone as these should be
            // called as event.nativeEvent.fn()
            if (typeof property !== 'function') extractEventProps[prop] = property;
          }
          let raycastEvent = {
            ...hit,
            ...extractEventProps,
            pointer,
            intersections,
            stopped: localState.stopped,
            delta,
            unprojectedPoint,
            ray: raycaster.ray,
            camera: camera,
            // Hijack stopPropagation, which just sets a flag
            stopPropagation() {
              // https://github.com/pmndrs/react-three-fiber/issues/596
              // Events are not allowed to stop propagation if the pointer has been captured
              const capturesForPointer = 'pointerId' in event && internal.capturedMap.get(event.pointerId);

              // We only authorize stopPropagation...
              if (
              // ...if this pointer hasn't been captured
              !capturesForPointer ||
              // ... or if the hit object is capturing the pointer
              capturesForPointer.has(hit.eventObject)) {
                raycastEvent.stopped = localState.stopped = true;
                // Propagation is stopped, remove all other hover records
                // An event handler is only allowed to flush other handlers if it is hovered itself
                if (internal.hovered.size && Array.from(internal.hovered.values()).find(i => i.eventObject === hit.eventObject)) {
                  // Objects cannot flush out higher up objects that have already caught the event
                  const higher = intersections.slice(0, intersections.indexOf(hit));
                  cancelPointer([...higher, hit]);
                }
              }
            },
            // there should be a distinction between target and currentTarget
            target: {
              hasPointerCapture,
              setPointerCapture,
              releasePointerCapture
            },
            currentTarget: {
              hasPointerCapture,
              setPointerCapture,
              releasePointerCapture
            },
            nativeEvent: event
          };

          // Call subscribers
          callback(raycastEvent);
          // Event bubbling may be interrupted by stopPropagation
          if (localState.stopped === true) break;
        }
      }
    }
    return intersections;
  }
  function cancelPointer(intersections) {
    const {
      internal
    } = store.getState();
    for (const hoveredObj of internal.hovered.values()) {
      // When no objects were hit or the the hovered object wasn't found underneath the cursor
      // we call onPointerOut and delete the object from the hovered-elements map
      if (!intersections.length || !intersections.find(hit => hit.object === hoveredObj.object && hit.index === hoveredObj.index && hit.instanceId === hoveredObj.instanceId)) {
        const eventObject = hoveredObj.eventObject;
        const instance = eventObject.__r3f;
        internal.hovered.delete(makeId(hoveredObj));
        if (instance != null && instance.eventCount) {
          const handlers = instance.handlers;
          // Clear out intersects, they are outdated by now
          const data = {
            ...hoveredObj,
            intersections
          };
          handlers.onPointerOut == null ? void 0 : handlers.onPointerOut(data);
          handlers.onPointerLeave == null ? void 0 : handlers.onPointerLeave(data);
        }
      }
    }
  }
  function pointerMissed(event, objects) {
    for (let i = 0; i < objects.length; i++) {
      const instance = objects[i].__r3f;
      instance == null ? void 0 : instance.handlers.onPointerMissed == null ? void 0 : instance.handlers.onPointerMissed(event);
    }
  }
  function handlePointer(name) {
    // Deal with cancelation
    switch (name) {
      case 'onPointerLeave':
      case 'onPointerCancel':
        return () => cancelPointer([]);
      case 'onLostPointerCapture':
        return event => {
          const {
            internal
          } = store.getState();
          if ('pointerId' in event && internal.capturedMap.has(event.pointerId)) {
            // If the object event interface had onLostPointerCapture, we'd call it here on every
            // object that's getting removed. We call it on the next frame because onLostPointerCapture
            // fires before onPointerUp. Otherwise pointerUp would never be called if the event didn't
            // happen in the object it originated from, leaving components in a in-between state.
            requestAnimationFrame(() => {
              // Only release if pointer-up didn't do it already
              if (internal.capturedMap.has(event.pointerId)) {
                internal.capturedMap.delete(event.pointerId);
                cancelPointer([]);
              }
            });
          }
        };
    }

    // Any other pointer goes here ...
    return function handleEvent(event) {
      const {
        onPointerMissed,
        internal
      } = store.getState();

      // prepareRay(event)
      internal.lastEvent.current = event;

      // Get fresh intersects
      const isPointerMove = name === 'onPointerMove';
      const isClickEvent = name === 'onClick' || name === 'onContextMenu' || name === 'onDoubleClick';
      const filter = isPointerMove ? filterPointerEvents : undefined;
      const hits = intersect(event, filter);
      const delta = isClickEvent ? calculateDistance(event) : 0;

      // Save initial coordinates on pointer-down
      if (name === 'onPointerDown') {
        internal.initialClick = [event.offsetX, event.offsetY];
        internal.initialHits = hits.map(hit => hit.eventObject);
      }

      // If a click yields no results, pass it back to the user as a miss
      // Missed events have to come first in order to establish user-land side-effect clean up
      if (isClickEvent && !hits.length) {
        if (delta <= 2) {
          pointerMissed(event, internal.interaction);
          if (onPointerMissed) onPointerMissed(event);
        }
      }
      // Take care of unhover
      if (isPointerMove) cancelPointer(hits);
      function onIntersect(data) {
        const eventObject = data.eventObject;
        const instance = eventObject.__r3f;

        // Check presence of handlers
        if (!(instance != null && instance.eventCount)) return;
        const handlers = instance.handlers;

        /*
        MAYBE TODO, DELETE IF NOT: 
          Check if the object is captured, captured events should not have intersects running in parallel
          But wouldn't it be better to just replace capturedMap with a single entry?
          Also, are we OK with straight up making picking up multiple objects impossible?
          
        const pointerId = (data as ThreeEvent<PointerEvent>).pointerId        
        if (pointerId !== undefined) {
          const capturedMeshSet = internal.capturedMap.get(pointerId)
          if (capturedMeshSet) {
            const captured = capturedMeshSet.get(eventObject)
            if (captured && captured.localState.stopped) return
          }
        }*/

        if (isPointerMove) {
          // Move event ...
          if (handlers.onPointerOver || handlers.onPointerEnter || handlers.onPointerOut || handlers.onPointerLeave) {
            // When enter or out is present take care of hover-state
            const id = makeId(data);
            const hoveredItem = internal.hovered.get(id);
            if (!hoveredItem) {
              // If the object wasn't previously hovered, book it and call its handler
              internal.hovered.set(id, data);
              handlers.onPointerOver == null ? void 0 : handlers.onPointerOver(data);
              handlers.onPointerEnter == null ? void 0 : handlers.onPointerEnter(data);
            } else if (hoveredItem.stopped) {
              // If the object was previously hovered and stopped, we shouldn't allow other items to proceed
              data.stopPropagation();
            }
          }
          // Call mouse move
          handlers.onPointerMove == null ? void 0 : handlers.onPointerMove(data);
        } else {
          // All other events ...
          const handler = handlers[name];
          if (handler) {
            // Forward all events back to their respective handlers with the exception of click events,
            // which must use the initial target
            if (!isClickEvent || internal.initialHits.includes(eventObject)) {
              // Missed events have to come first
              pointerMissed(event, internal.interaction.filter(object => !internal.initialHits.includes(object)));
              // Now call the handler
              handler(data);
            }
          } else {
            // Trigger onPointerMissed on all elements that have pointer over/out handlers, but not click and weren't hit
            if (isClickEvent && internal.initialHits.includes(eventObject)) {
              pointerMissed(event, internal.interaction.filter(object => !internal.initialHits.includes(object)));
            }
          }
        }
      }
      handleIntersects(hits, event, delta, onIntersect);
    };
  }
  return {
    handlePointer
  };
}

const isRenderer = def => !!(def != null && def.render);
const context = /* @__PURE__ */React__namespace.createContext(null);
const createStore = (invalidate, advance) => {
  const rootStore = traditional.createWithEqualityFn((set, get) => {
    const position = new THREE__namespace.Vector3();
    const defaultTarget = new THREE__namespace.Vector3();
    const tempTarget = new THREE__namespace.Vector3();
    function getCurrentViewport(camera = get().camera, target = defaultTarget, size = get().size) {
      const {
        width,
        height,
        top,
        left
      } = size;
      const aspect = width / height;
      if (target.isVector3) tempTarget.copy(target);else tempTarget.set(...target);
      const distance = camera.getWorldPosition(position).distanceTo(tempTarget);
      if (isOrthographicCamera(camera)) {
        return {
          width: width / camera.zoom,
          height: height / camera.zoom,
          top,
          left,
          factor: 1,
          distance,
          aspect
        };
      } else {
        const fov = camera.fov * Math.PI / 180; // convert vertical fov to radians
        const h = 2 * Math.tan(fov / 2) * distance; // visible height
        const w = h * (width / height);
        return {
          width: w,
          height: h,
          top,
          left,
          factor: width / w,
          distance,
          aspect
        };
      }
    }
    let performanceTimeout = undefined;
    const setPerformanceCurrent = current => set(state => ({
      performance: {
        ...state.performance,
        current
      }
    }));
    const pointer = new THREE__namespace.Vector2();
    const rootState = {
      set,
      get,
      // Mock objects that have to be configured
      gl: null,
      camera: null,
      raycaster: null,
      events: {
        priority: 1,
        enabled: true,
        connected: false
      },
      scene: null,
      xr: null,
      invalidate: (frames = 1) => invalidate(get(), frames),
      advance: (timestamp, runGlobalEffects) => advance(timestamp, runGlobalEffects, get()),
      legacy: false,
      linear: false,
      flat: false,
      controls: null,
      clock: new THREE__namespace.Clock(),
      pointer,
      mouse: pointer,
      frameloop: 'always',
      onPointerMissed: undefined,
      performance: {
        current: 1,
        min: 0.5,
        max: 1,
        debounce: 200,
        regress: () => {
          const state = get();
          // Clear timeout
          if (performanceTimeout) clearTimeout(performanceTimeout);
          // Set lower bound performance
          if (state.performance.current !== state.performance.min) setPerformanceCurrent(state.performance.min);
          // Go back to upper bound performance after a while unless something regresses meanwhile
          performanceTimeout = setTimeout(() => setPerformanceCurrent(get().performance.max), state.performance.debounce);
        }
      },
      size: {
        width: 0,
        height: 0,
        top: 0,
        left: 0
      },
      viewport: {
        initialDpr: 0,
        dpr: 0,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        aspect: 0,
        distance: 0,
        factor: 0,
        getCurrentViewport
      },
      setEvents: events => set(state => ({
        ...state,
        events: {
          ...state.events,
          ...events
        }
      })),
      setSize: (width, height, top = 0, left = 0) => {
        const camera = get().camera;
        const size = {
          width,
          height,
          top,
          left
        };
        set(state => ({
          size,
          viewport: {
            ...state.viewport,
            ...getCurrentViewport(camera, defaultTarget, size)
          }
        }));
      },
      setDpr: dpr => set(state => {
        const resolved = calculateDpr(dpr);
        return {
          viewport: {
            ...state.viewport,
            dpr: resolved,
            initialDpr: state.viewport.initialDpr || resolved
          }
        };
      }),
      setFrameloop: (frameloop = 'always') => {
        const clock = get().clock;

        // if frameloop === "never" clock.elapsedTime is updated using advance(timestamp)
        clock.stop();
        clock.elapsedTime = 0;
        if (frameloop !== 'never') {
          clock.start();
          clock.elapsedTime = 0;
        }
        set(() => ({
          frameloop
        }));
      },
      previousRoot: undefined,
      internal: {
        // Events
        interaction: [],
        hovered: new Map(),
        subscribers: [],
        initialClick: [0, 0],
        initialHits: [],
        capturedMap: new Map(),
        lastEvent: /*#__PURE__*/React__namespace.createRef(),
        // Updates
        active: false,
        frames: 0,
        priority: 0,
        subscribe: (ref, priority, store) => {
          const internal = get().internal;
          // If this subscription was given a priority, it takes rendering into its own hands
          // For that reason we switch off automatic rendering and increase the manual flag
          // As long as this flag is positive there can be no internal rendering at all
          // because there could be multiple render subscriptions
          internal.priority = internal.priority + (priority > 0 ? 1 : 0);
          internal.subscribers.push({
            ref,
            priority,
            store
          });
          // Register subscriber and sort layers from lowest to highest, meaning,
          // highest priority renders last (on top of the other frames)
          internal.subscribers = internal.subscribers.sort((a, b) => a.priority - b.priority);
          return () => {
            const internal = get().internal;
            if (internal != null && internal.subscribers) {
              // Decrease manual flag if this subscription had a priority
              internal.priority = internal.priority - (priority > 0 ? 1 : 0);
              // Remove subscriber from list
              internal.subscribers = internal.subscribers.filter(s => s.ref !== ref);
            }
          };
        }
      }
    };
    return rootState;
  });
  const state = rootStore.getState();
  let oldSize = state.size;
  let oldDpr = state.viewport.dpr;
  let oldCamera = state.camera;
  rootStore.subscribe(() => {
    const {
      camera,
      size,
      viewport,
      gl,
      set
    } = rootStore.getState();

    // Resize camera and renderer on changes to size and pixelratio
    if (size.width !== oldSize.width || size.height !== oldSize.height || viewport.dpr !== oldDpr) {
      oldSize = size;
      oldDpr = viewport.dpr;
      // Update camera & renderer
      updateCamera(camera, size);
      if (viewport.dpr > 0) gl.setPixelRatio(viewport.dpr);
      const updateStyle = typeof HTMLCanvasElement !== 'undefined' && gl.domElement instanceof HTMLCanvasElement;
      gl.setSize(size.width, size.height, updateStyle);
    }

    // Update viewport once the camera changes
    if (camera !== oldCamera) {
      oldCamera = camera;
      // Update viewport
      set(state => ({
        viewport: {
          ...state.viewport,
          ...state.viewport.getCurrentViewport(camera)
        }
      }));
    }
  });

  // Invalidate on any change
  rootStore.subscribe(state => invalidate(state));

  // Return root state
  return rootStore;
};

/**
 * Exposes an object's {@link Instance}.
 * @see https://docs.pmnd.rs/react-three-fiber/api/additional-exports#useInstanceHandle
 *
 * **Note**: this is an escape hatch to react-internal fields. Expect this to change significantly between versions.
 */
function useInstanceHandle(ref) {
  const instance = React__namespace.useRef(null);
  React__namespace.useImperativeHandle(instance, () => ref.current.__r3f, [ref]);
  return instance;
}

/**
 * Returns the R3F Canvas' Zustand store. Useful for [transient updates](https://github.com/pmndrs/zustand#transient-updates-for-often-occurring-state-changes).
 * @see https://docs.pmnd.rs/react-three-fiber/api/hooks#usestore
 */
function useStore() {
  const store = React__namespace.useContext(context);
  if (!store) throw new Error('R3F: Hooks can only be used within the Canvas component!');
  return store;
}

/**
 * Accesses R3F's internal state, containing renderer, canvas, scene, etc.
 * @see https://docs.pmnd.rs/react-three-fiber/api/hooks#usethree
 */
function useThree(selector = state => state, equalityFn) {
  return useStore()(selector, equalityFn);
}

/**
 * Executes a callback before render in a shared frame loop.
 * Can order effects with render priority or manually render with a positive priority.
 * @see https://docs.pmnd.rs/react-three-fiber/api/hooks#useframe
 */
function useFrame(callback, renderPriority = 0) {
  const store = useStore();
  const subscribe = store.getState().internal.subscribe;
  // Memoize ref
  const ref = useMutableCallback(callback);
  // Subscribe on mount, unsubscribe on unmount
  useIsomorphicLayoutEffect(() => subscribe(ref, renderPriority, store), [renderPriority, subscribe, store]);
  return null;
}

/**
 * Returns a node graph of an object with named nodes & materials.
 * @see https://docs.pmnd.rs/react-three-fiber/api/hooks#usegraph
 */
function useGraph(object) {
  return React__namespace.useMemo(() => buildGraph(object), [object]);
}
const memoizedLoaders = new WeakMap();
const isConstructor$1 = value => {
  var _value$prototype;
  return typeof value === 'function' && (value == null ? void 0 : (_value$prototype = value.prototype) == null ? void 0 : _value$prototype.constructor) === value;
};
function loadingFn(extensions, onProgress) {
  return function (Proto, ...input) {
    let loader;

    // Construct and cache loader if constructor was passed
    if (isConstructor$1(Proto)) {
      loader = memoizedLoaders.get(Proto);
      if (!loader) {
        loader = new Proto();
        memoizedLoaders.set(Proto, loader);
      }
    } else {
      loader = Proto;
    }

    // Apply loader extensions
    if (extensions) extensions(loader);

    // Go through the urls and load them
    return Promise.all(input.map(input => new Promise((res, reject) => loader.load(input, data => {
      if (isObject3D(data == null ? void 0 : data.scene)) Object.assign(data, buildGraph(data.scene));
      res(data);
    }, onProgress, error => reject(new Error(`Could not load ${input}: ${error == null ? void 0 : error.message}`))))));
  };
}

/**
 * Synchronously loads and caches assets with a three loader.
 *
 * Note: this hook's caller must be wrapped with `React.Suspense`
 * @see https://docs.pmnd.rs/react-three-fiber/api/hooks#useloader
 */
function useLoader(loader, input, extensions, onProgress) {
  // Use suspense to load async assets
  const keys = Array.isArray(input) ? input : [input];
  const results = suspendReact.suspend(loadingFn(extensions, onProgress), [loader, ...keys], {
    equal: is.equ
  });
  // Return the object(s)
  return Array.isArray(input) ? results : results[0];
}

/**
 * Preloads an asset into cache as a side-effect.
 */
useLoader.preload = function (loader, input, extensions) {
  const keys = Array.isArray(input) ? input : [input];
  return suspendReact.preload(loadingFn(extensions), [loader, ...keys]);
};

/**
 * Removes a loaded asset from cache.
 */
useLoader.clear = function (loader, input) {
  const keys = Array.isArray(input) ? input : [input];
  return suspendReact.clear([loader, ...keys]);
};

var packageData = {
	name: "@react-three/fiber",
	version: "9.4.2",
	description: "A React renderer for Threejs",
	keywords: [
		"react",
		"renderer",
		"fiber",
		"three",
		"threejs"
	],
	author: "Paul Henschel (https://github.com/drcmda)",
	license: "MIT",
	maintainers: [
		"Josh Ellis (https://github.com/joshuaellis)",
		"Cody Bennett (https://github.com/codyjasonbennett)",
		"Kris Baumgarter (https://github.com/krispya)"
	],
	bugs: {
		url: "https://github.com/pmndrs/react-three-fiber/issues"
	},
	homepage: "https://github.com/pmndrs/react-three-fiber#readme",
	repository: {
		type: "git",
		url: "git+https://github.com/pmndrs/react-three-fiber.git"
	},
	collective: {
		type: "opencollective",
		url: "https://opencollective.com/react-three-fiber"
	},
	main: "dist/react-three-fiber.cjs.js",
	module: "dist/react-three-fiber.esm.js",
	types: "dist/react-three-fiber.cjs.d.ts",
	"react-native": "native/dist/react-three-fiber-native.cjs.js",
	sideEffects: false,
	preconstruct: {
		entrypoints: [
			"index.tsx",
			"native.tsx"
		]
	},
	scripts: {
		prebuild: "cp ../../readme.md readme.md"
	},
	dependencies: {
		"@babel/runtime": "^7.17.8",
		"@types/react-reconciler": "^0.32.0",
		"@types/webxr": "*",
		"base64-js": "^1.5.1",
		buffer: "^6.0.3",
		"its-fine": "^2.0.0",
		"react-reconciler": "^0.31.0",
		"react-use-measure": "^2.1.7",
		scheduler: "^0.25.0",
		"suspend-react": "^0.1.3",
		"use-sync-external-store": "^1.4.0",
		zustand: "^5.0.3"
	},
	peerDependencies: {
		expo: ">=43.0",
		"expo-asset": ">=8.4",
		"expo-file-system": ">=11.0",
		"expo-gl": ">=11.0",
		react: "^19.0.0",
		"react-dom": "^19.0.0",
		"react-native": ">=0.78",
		three: ">=0.156"
	},
	peerDependenciesMeta: {
		"react-dom": {
			optional: true
		},
		"react-native": {
			optional: true
		},
		expo: {
			optional: true
		},
		"expo-asset": {
			optional: true
		},
		"expo-file-system": {
			optional: true
		},
		"expo-gl": {
			optional: true
		}
	}
};

function createReconciler(config) {
  const reconciler = Reconciler__default["default"](config);

  // @ts-ignore DefinitelyTyped is not up to date
  reconciler.injectIntoDevTools();
  return reconciler;
}
const NoEventPriority = 0;

// TODO: handle constructor overloads
// https://github.com/pmndrs/react-three-fiber/pull/2931
// https://github.com/microsoft/TypeScript/issues/37079

const catalogue = {};
const PREFIX_REGEX = /^three(?=[A-Z])/;
const toPascalCase = type => `${type[0].toUpperCase()}${type.slice(1)}`;
let i = 0;
const isConstructor = object => typeof object === 'function';
function extend(objects) {
  if (isConstructor(objects)) {
    const Component = `${i++}`;
    catalogue[Component] = objects;
    return Component;
  } else {
    Object.assign(catalogue, objects);
  }
}
function validateInstance(type, props) {
  // Get target from catalogue
  const name = toPascalCase(type);
  const target = catalogue[name];

  // Validate element target
  if (type !== 'primitive' && !target) throw new Error(`R3F: ${name} is not part of the THREE namespace! Did you forget to extend? See: https://docs.pmnd.rs/react-three-fiber/api/objects#using-3rd-party-objects-declaratively`);

  // Validate primitives
  if (type === 'primitive' && !props.object) throw new Error(`R3F: Primitives without 'object' are invalid!`);

  // Throw if an object or literal was passed for args
  if (props.args !== undefined && !Array.isArray(props.args)) throw new Error('R3F: The args prop must be an array!');
}
function createInstance(type, props, root) {
  var _props$object;
  // Remove three* prefix from elements if native element not present
  type = toPascalCase(type) in catalogue ? type : type.replace(PREFIX_REGEX, '');
  validateInstance(type, props);

  // Regenerate the R3F instance for primitives to simulate a new object
  if (type === 'primitive' && (_props$object = props.object) != null && _props$object.__r3f) delete props.object.__r3f;
  return prepare(props.object, root, type, props);
}
function hideInstance(instance) {
  if (!instance.isHidden) {
    var _instance$parent;
    if (instance.props.attach && (_instance$parent = instance.parent) != null && _instance$parent.object) {
      detach(instance.parent, instance);
    } else if (isObject3D(instance.object)) {
      instance.object.visible = false;
    }
    instance.isHidden = true;
    invalidateInstance(instance);
  }
}
function unhideInstance(instance) {
  if (instance.isHidden) {
    var _instance$parent2;
    if (instance.props.attach && (_instance$parent2 = instance.parent) != null && _instance$parent2.object) {
      attach(instance.parent, instance);
    } else if (isObject3D(instance.object) && instance.props.visible !== false) {
      instance.object.visible = true;
    }
    instance.isHidden = false;
    invalidateInstance(instance);
  }
}

// https://github.com/facebook/react/issues/20271
// This will make sure events and attach are only handled once when trees are complete
function handleContainerEffects(parent, child, beforeChild) {
  // Bail if tree isn't mounted or parent is not a container.
  // This ensures that the tree is finalized and React won't discard results to Suspense
  const state = child.root.getState();
  if (!parent.parent && parent.object !== state.scene) return;

  // Create & link object on first run
  if (!child.object) {
    var _child$props$object, _child$props$args;
    // Get target from catalogue
    const target = catalogue[toPascalCase(child.type)];

    // Create object
    child.object = (_child$props$object = child.props.object) != null ? _child$props$object : new target(...((_child$props$args = child.props.args) != null ? _child$props$args : []));
    child.object.__r3f = child;
  }

  // Set initial props
  applyProps(child.object, child.props);

  // Append instance
  if (child.props.attach) {
    attach(parent, child);
  } else if (isObject3D(child.object) && isObject3D(parent.object)) {
    const childIndex = parent.object.children.indexOf(beforeChild == null ? void 0 : beforeChild.object);
    if (beforeChild && childIndex !== -1) {
      // If the child is already in the parent's children array, move it to the new position
      // Otherwise, just insert it at the target position
      const existingIndex = parent.object.children.indexOf(child.object);
      if (existingIndex !== -1) {
        parent.object.children.splice(existingIndex, 1);
        const adjustedIndex = existingIndex < childIndex ? childIndex - 1 : childIndex;
        parent.object.children.splice(adjustedIndex, 0, child.object);
      } else {
        child.object.parent = parent.object;
        parent.object.children.splice(childIndex, 0, child.object);
        child.object.dispatchEvent({
          type: 'added'
        });
        parent.object.dispatchEvent({
          type: 'childadded',
          child: child.object
        });
      }
    } else {
      parent.object.add(child.object);
    }
  }

  // Link subtree
  for (const childInstance of child.children) handleContainerEffects(child, childInstance);

  // Tree was updated, request a frame
  invalidateInstance(child);
}
function appendChild(parent, child) {
  if (!child) return;

  // Link instances
  child.parent = parent;
  parent.children.push(child);

  // Attach tree once complete
  handleContainerEffects(parent, child);
}
function insertBefore(parent, child, beforeChild) {
  if (!child || !beforeChild) return;

  // Link instances
  child.parent = parent;
  const childIndex = parent.children.indexOf(beforeChild);
  if (childIndex !== -1) parent.children.splice(childIndex, 0, child);else parent.children.push(child);

  // Attach tree once complete
  handleContainerEffects(parent, child, beforeChild);
}
function disposeOnIdle(object) {
  if (typeof object.dispose === 'function') {
    const handleDispose = () => {
      try {
        object.dispose();
      } catch {
        // no-op
      }
    };

    // In a testing environment, cleanup immediately
    if (typeof IS_REACT_ACT_ENVIRONMENT !== 'undefined') handleDispose();
    // Otherwise, using a real GPU so schedule cleanup to prevent stalls
    else scheduler.unstable_scheduleCallback(scheduler.unstable_IdlePriority, handleDispose);
  }
}
function removeChild(parent, child, dispose) {
  if (!child) return;

  // Unlink instances
  child.parent = null;
  const childIndex = parent.children.indexOf(child);
  if (childIndex !== -1) parent.children.splice(childIndex, 1);

  // Eagerly tear down tree
  if (child.props.attach) {
    detach(parent, child);
  } else if (isObject3D(child.object) && isObject3D(parent.object)) {
    parent.object.remove(child.object);
    removeInteractivity(findInitialRoot(child), child.object);
  }

  // Allow objects to bail out of unmount disposal with dispose={null}
  const shouldDispose = child.props.dispose !== null && dispose !== false;

  // Recursively remove instance children
  for (let i = child.children.length - 1; i >= 0; i--) {
    const node = child.children[i];
    removeChild(child, node, shouldDispose);
  }
  child.children.length = 0;

  // Unlink instance object
  delete child.object.__r3f;

  // Dispose object whenever the reconciler feels like it.
  // Never dispose of primitives because their state may be kept outside of React!
  // In order for an object to be able to dispose it
  //   - has a dispose method
  //   - cannot be a <primitive object={...} />
  //   - cannot be a THREE.Scene, because three has broken its own API
  if (shouldDispose && child.type !== 'primitive' && child.object.type !== 'Scene') {
    disposeOnIdle(child.object);
  }

  // Tree was updated, request a frame for top-level instance
  if (dispose === undefined) invalidateInstance(child);
}
function setFiberRef(fiber, publicInstance) {
  for (const _fiber of [fiber, fiber.alternate]) {
    if (_fiber !== null) {
      if (typeof _fiber.ref === 'function') {
        _fiber.refCleanup == null ? void 0 : _fiber.refCleanup();
        const cleanup = _fiber.ref(publicInstance);
        if (typeof cleanup === 'function') _fiber.refCleanup = cleanup;
      } else if (_fiber.ref) {
        _fiber.ref.current = publicInstance;
      }
    }
  }
}
const reconstructed = [];
function swapInstances() {
  // Detach instance
  for (const [instance] of reconstructed) {
    const parent = instance.parent;
    if (parent) {
      if (instance.props.attach) {
        detach(parent, instance);
      } else if (isObject3D(instance.object) && isObject3D(parent.object)) {
        parent.object.remove(instance.object);
      }
      for (const child of instance.children) {
        if (child.props.attach) {
          detach(instance, child);
        } else if (isObject3D(child.object) && isObject3D(instance.object)) {
          instance.object.remove(child.object);
        }
      }
    }

    // If the old instance is hidden, we need to unhide it.
    // React assumes it can discard instances since they're pure for DOM.
    // This isn't true for us since our lifetimes are impure and longliving.
    // So, we manually check if an instance was hidden and unhide it.
    if (instance.isHidden) unhideInstance(instance);

    // Dispose of old object if able
    if (instance.object.__r3f) delete instance.object.__r3f;
    if (instance.type !== 'primitive') disposeOnIdle(instance.object);
  }

  // Update instance
  for (const [instance, props, fiber] of reconstructed) {
    instance.props = props;
    const parent = instance.parent;
    if (parent) {
      var _instance$props$objec, _instance$props$args;
      // Get target from catalogue
      const target = catalogue[toPascalCase(instance.type)];

      // Create object
      instance.object = (_instance$props$objec = instance.props.object) != null ? _instance$props$objec : new target(...((_instance$props$args = instance.props.args) != null ? _instance$props$args : []));
      instance.object.__r3f = instance;
      setFiberRef(fiber, instance.object);

      // Set initial props
      applyProps(instance.object, instance.props);
      if (instance.props.attach) {
        attach(parent, instance);
      } else if (isObject3D(instance.object) && isObject3D(parent.object)) {
        parent.object.add(instance.object);
      }
      for (const child of instance.children) {
        if (child.props.attach) {
          attach(instance, child);
        } else if (isObject3D(child.object) && isObject3D(instance.object)) {
          instance.object.add(child.object);
        }
      }

      // Tree was updated, request a frame
      invalidateInstance(instance);
    }
  }
  reconstructed.length = 0;
}

// Don't handle text instances, make it no-op
const handleTextInstance = () => {};
const NO_CONTEXT = {};
let currentUpdatePriority = NoEventPriority;

// https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberFlags.js
const NoFlags = 0;
const Update = 4;
const reconciler = /* @__PURE__ */createReconciler({
  isPrimaryRenderer: false,
  warnsIfNotActing: false,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  createInstance,
  removeChild,
  appendChild,
  appendInitialChild: appendChild,
  insertBefore,
  appendChildToContainer(container, child) {
    const scene = container.getState().scene.__r3f;
    if (!child || !scene) return;
    appendChild(scene, child);
  },
  removeChildFromContainer(container, child) {
    const scene = container.getState().scene.__r3f;
    if (!child || !scene) return;
    removeChild(scene, child);
  },
  insertInContainerBefore(container, child, beforeChild) {
    const scene = container.getState().scene.__r3f;
    if (!child || !beforeChild || !scene) return;
    insertBefore(scene, child, beforeChild);
  },
  getRootHostContext: () => NO_CONTEXT,
  getChildHostContext: () => NO_CONTEXT,
  commitUpdate(instance, type, oldProps, newProps, fiber) {
    var _newProps$args, _oldProps$args, _newProps$args2;
    validateInstance(type, newProps);
    let reconstruct = false;

    // Reconstruct primitives if object prop changes
    if (instance.type === 'primitive' && oldProps.object !== newProps.object) reconstruct = true;
    // Reconstruct instance if args were added or removed
    else if (((_newProps$args = newProps.args) == null ? void 0 : _newProps$args.length) !== ((_oldProps$args = oldProps.args) == null ? void 0 : _oldProps$args.length)) reconstruct = true;
    // Reconstruct instance if args were changed
    else if ((_newProps$args2 = newProps.args) != null && _newProps$args2.some((value, index) => {
      var _oldProps$args2;
      return value !== ((_oldProps$args2 = oldProps.args) == null ? void 0 : _oldProps$args2[index]);
    })) reconstruct = true;

    // Reconstruct when args or <primitive object={...} have changes
    if (reconstruct) {
      reconstructed.push([instance, {
        ...newProps
      }, fiber]);
    } else {
      // Create a diff-set, flag if there are any changes
      const changedProps = diffProps(instance, newProps);
      if (Object.keys(changedProps).length) {
        Object.assign(instance.props, changedProps);
        applyProps(instance.object, changedProps);
      }
    }

    // Flush reconstructed siblings when we hit the last updated child in a sequence
    const isTailSibling = fiber.sibling === null || (fiber.flags & Update) === NoFlags;
    if (isTailSibling) swapInstances();
  },
  finalizeInitialChildren: () => false,
  commitMount() {},
  getPublicInstance: instance => instance == null ? void 0 : instance.object,
  prepareForCommit: () => null,
  preparePortalMount: container => prepare(container.getState().scene, container, '', {}),
  resetAfterCommit: () => {},
  shouldSetTextContent: () => false,
  clearContainer: () => false,
  hideInstance,
  unhideInstance,
  createTextInstance: handleTextInstance,
  hideTextInstance: handleTextInstance,
  unhideTextInstance: handleTextInstance,
  scheduleTimeout: typeof setTimeout === 'function' ? setTimeout : undefined,
  cancelTimeout: typeof clearTimeout === 'function' ? clearTimeout : undefined,
  noTimeout: -1,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  detachDeletedInstance() {},
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  requestPostPaintCallback() {},
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  // true indicates already loaded
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
  NotPendingTransition: null,
  // The reconciler types use the internal ReactContext with all the hidden properties
  // so we have to cast from the public React.Context type
  HostTransitionContext: /* @__PURE__ */React__namespace.createContext(null),
  setCurrentUpdatePriority(newPriority) {
    currentUpdatePriority = newPriority;
  },
  getCurrentUpdatePriority() {
    return currentUpdatePriority;
  },
  resolveUpdatePriority() {
    var _window$event;
    if (currentUpdatePriority !== NoEventPriority) return currentUpdatePriority;
    switch (typeof window !== 'undefined' && ((_window$event = window.event) == null ? void 0 : _window$event.type)) {
      case 'click':
      case 'contextmenu':
      case 'dblclick':
      case 'pointercancel':
      case 'pointerdown':
      case 'pointerup':
        return constants.DiscreteEventPriority;
      case 'pointermove':
      case 'pointerout':
      case 'pointerover':
      case 'pointerenter':
      case 'pointerleave':
      case 'wheel':
        return constants.ContinuousEventPriority;
      default:
        return constants.DefaultEventPriority;
    }
  },
  resetFormInstance() {},
  // @ts-ignore DefinitelyTyped is not up to date
  rendererPackageName: '@react-three/fiber',
  rendererVersion: packageData.version
});

const _roots = new Map();
const shallowLoose = {
  objects: 'shallow',
  strict: false
};
function computeInitialSize(canvas, size) {
  if (!size && typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement && canvas.parentElement) {
    const {
      width,
      height,
      top,
      left
    } = canvas.parentElement.getBoundingClientRect();
    return {
      width,
      height,
      top,
      left
    };
  } else if (!size && typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return {
      width: canvas.width,
      height: canvas.height,
      top: 0,
      left: 0
    };
  }
  return {
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    ...size
  };
}
function createRoot(canvas) {
  // Check against mistaken use of createRoot
  const prevRoot = _roots.get(canvas);
  const prevFiber = prevRoot == null ? void 0 : prevRoot.fiber;
  const prevStore = prevRoot == null ? void 0 : prevRoot.store;
  if (prevRoot) console.warn('R3F.createRoot should only be called once!');

  // Report when an error was detected in a previous render
  // https://github.com/pmndrs/react-three-fiber/pull/2261
  const logRecoverableError = typeof reportError === 'function' ?
  // In modern browsers, reportError will dispatch an error event,
  // emulating an uncaught JavaScript error.
  reportError :
  // In older browsers and test environments, fallback to console.error.
  console.error;

  // Create store
  const store = prevStore || createStore(invalidate, advance);
  // Create renderer
  const fiber = prevFiber || reconciler.createContainer(store,
  // container
  constants.ConcurrentRoot,
  // tag
  null,
  // hydration callbacks
  false,
  // isStrictMode
  null,
  // concurrentUpdatesByDefaultOverride
  '',
  // identifierPrefix
  logRecoverableError,
  // onUncaughtError
  logRecoverableError,
  // onCaughtError
  logRecoverableError,
  // onRecoverableError
  null // transitionCallbacks
  );
  // Map it
  if (!prevRoot) _roots.set(canvas, {
    fiber,
    store
  });

  // Locals
  let onCreated;
  let lastCamera;
  let configured = false;
  let pending = null;
  return {
    async configure(props = {}) {
      let resolve;
      pending = new Promise(_resolve => resolve = _resolve);
      let {
        gl: glConfig,
        size: propsSize,
        scene: sceneOptions,
        events,
        onCreated: onCreatedCallback,
        shadows = false,
        linear = false,
        flat = false,
        legacy = false,
        orthographic = false,
        frameloop = 'always',
        dpr = [1, 2],
        performance,
        raycaster: raycastOptions,
        camera: cameraOptions,
        onPointerMissed
      } = props;
      let state = store.getState();

      // Set up renderer (one time only!)
      let gl = state.gl;
      if (!state.gl) {
        const defaultProps = {
          canvas: canvas,
          powerPreference: 'high-performance',
          antialias: true,
          alpha: true
        };
        const customRenderer = typeof glConfig === 'function' ? await glConfig(defaultProps) : glConfig;
        if (isRenderer(customRenderer)) {
          gl = customRenderer;
        } else {
          gl = new THREE__namespace.WebGLRenderer({
            ...defaultProps,
            ...glConfig
          });
        }
        state.set({
          gl
        });
      }

      // Set up raycaster (one time only!)
      let raycaster = state.raycaster;
      if (!raycaster) state.set({
        raycaster: raycaster = new THREE__namespace.Raycaster()
      });

      // Set raycaster options
      const {
        params,
        ...options
      } = raycastOptions || {};
      if (!is.equ(options, raycaster, shallowLoose)) applyProps(raycaster, {
        ...options
      });
      if (!is.equ(params, raycaster.params, shallowLoose)) applyProps(raycaster, {
        params: {
          ...raycaster.params,
          ...params
        }
      });

      // Create default camera, don't overwrite any user-set state
      if (!state.camera || state.camera === lastCamera && !is.equ(lastCamera, cameraOptions, shallowLoose)) {
        lastCamera = cameraOptions;
        const isCamera = cameraOptions == null ? void 0 : cameraOptions.isCamera;
        const camera = isCamera ? cameraOptions : orthographic ? new THREE__namespace.OrthographicCamera(0, 0, 0, 0, 0.1, 1000) : new THREE__namespace.PerspectiveCamera(75, 0, 0.1, 1000);
        if (!isCamera) {
          camera.position.z = 5;
          if (cameraOptions) {
            applyProps(camera, cameraOptions);
            // Preserve user-defined frustum if possible
            // https://github.com/pmndrs/react-three-fiber/issues/3160
            if (!camera.manual) {
              if ('aspect' in cameraOptions || 'left' in cameraOptions || 'right' in cameraOptions || 'bottom' in cameraOptions || 'top' in cameraOptions) {
                camera.manual = true;
                camera.updateProjectionMatrix();
              }
            }
          }
          // Always look at center by default
          if (!state.camera && !(cameraOptions != null && cameraOptions.rotation)) camera.lookAt(0, 0, 0);
        }
        state.set({
          camera
        });

        // Configure raycaster
        // https://github.com/pmndrs/react-xr/issues/300
        raycaster.camera = camera;
      }

      // Set up scene (one time only!)
      if (!state.scene) {
        let scene;
        if (sceneOptions != null && sceneOptions.isScene) {
          scene = sceneOptions;
          prepare(scene, store, '', {});
        } else {
          scene = new THREE__namespace.Scene();
          prepare(scene, store, '', {});
          if (sceneOptions) applyProps(scene, sceneOptions);
        }
        state.set({
          scene
        });
      }

      // Store events internally
      if (events && !state.events.handlers) state.set({
        events: events(store)
      });
      // Check size, allow it to take on container bounds initially
      const size = computeInitialSize(canvas, propsSize);
      if (!is.equ(size, state.size, shallowLoose)) {
        state.setSize(size.width, size.height, size.top, size.left);
      }
      // Check pixelratio
      if (dpr && state.viewport.dpr !== calculateDpr(dpr)) state.setDpr(dpr);
      // Check frameloop
      if (state.frameloop !== frameloop) state.setFrameloop(frameloop);
      // Check pointer missed
      if (!state.onPointerMissed) state.set({
        onPointerMissed
      });
      // Check performance
      if (performance && !is.equ(performance, state.performance, shallowLoose)) state.set(state => ({
        performance: {
          ...state.performance,
          ...performance
        }
      }));

      // Set up XR (one time only!)
      if (!state.xr) {
        var _gl$xr;
        // Handle frame behavior in WebXR
        const handleXRFrame = (timestamp, frame) => {
          const state = store.getState();
          if (state.frameloop === 'never') return;
          advance(timestamp, true, state, frame);
        };

        // Toggle render switching on session
        const handleSessionChange = () => {
          const state = store.getState();
          state.gl.xr.enabled = state.gl.xr.isPresenting;
          state.gl.xr.setAnimationLoop(state.gl.xr.isPresenting ? handleXRFrame : null);
          if (!state.gl.xr.isPresenting) invalidate(state);
        };

        // WebXR session manager
        const xr = {
          connect() {
            const gl = store.getState().gl;
            gl.xr.addEventListener('sessionstart', handleSessionChange);
            gl.xr.addEventListener('sessionend', handleSessionChange);
          },
          disconnect() {
            const gl = store.getState().gl;
            gl.xr.removeEventListener('sessionstart', handleSessionChange);
            gl.xr.removeEventListener('sessionend', handleSessionChange);
          }
        };

        // Subscribe to WebXR session events
        if (typeof ((_gl$xr = gl.xr) == null ? void 0 : _gl$xr.addEventListener) === 'function') xr.connect();
        state.set({
          xr
        });
      }

      // Set shadowmap
      if (gl.shadowMap) {
        const oldEnabled = gl.shadowMap.enabled;
        const oldType = gl.shadowMap.type;
        gl.shadowMap.enabled = !!shadows;
        if (is.boo(shadows)) {
          gl.shadowMap.type = THREE__namespace.PCFSoftShadowMap;
        } else if (is.str(shadows)) {
          var _types$shadows;
          const types = {
            basic: THREE__namespace.BasicShadowMap,
            percentage: THREE__namespace.PCFShadowMap,
            soft: THREE__namespace.PCFSoftShadowMap,
            variance: THREE__namespace.VSMShadowMap
          };
          gl.shadowMap.type = (_types$shadows = types[shadows]) != null ? _types$shadows : THREE__namespace.PCFSoftShadowMap;
        } else if (is.obj(shadows)) {
          Object.assign(gl.shadowMap, shadows);
        }
        if (oldEnabled !== gl.shadowMap.enabled || oldType !== gl.shadowMap.type) gl.shadowMap.needsUpdate = true;
      }
      THREE__namespace.ColorManagement.enabled = !legacy;

      // Set color space and tonemapping preferences
      if (!configured) {
        gl.outputColorSpace = linear ? THREE__namespace.LinearSRGBColorSpace : THREE__namespace.SRGBColorSpace;
        gl.toneMapping = flat ? THREE__namespace.NoToneMapping : THREE__namespace.ACESFilmicToneMapping;
      }

      // Update color management state
      if (state.legacy !== legacy) state.set(() => ({
        legacy
      }));
      if (state.linear !== linear) state.set(() => ({
        linear
      }));
      if (state.flat !== flat) state.set(() => ({
        flat
      }));

      // Set gl props
      if (glConfig && !is.fun(glConfig) && !isRenderer(glConfig) && !is.equ(glConfig, gl, shallowLoose)) applyProps(gl, glConfig);

      // Set locals
      onCreated = onCreatedCallback;
      configured = true;
      resolve();
      return this;
    },
    render(children) {
      // The root has to be configured before it can be rendered
      if (!configured && !pending) this.configure();
      pending.then(() => {
        reconciler.updateContainer( /*#__PURE__*/jsxRuntime.jsx(Provider, {
          store: store,
          children: children,
          onCreated: onCreated,
          rootElement: canvas
        }), fiber, null, () => undefined);
      });
      return store;
    },
    unmount() {
      unmountComponentAtNode(canvas);
    }
  };
}
function Provider({
  store,
  children,
  onCreated,
  rootElement
}) {
  useIsomorphicLayoutEffect(() => {
    const state = store.getState();
    // Flag the canvas active, rendering will now begin
    state.set(state => ({
      internal: {
        ...state.internal,
        active: true
      }
    }));
    // Notify that init is completed, the scene graph exists, but nothing has yet rendered
    if (onCreated) onCreated(state);
    // Connect events to the targets parent, this is done to ensure events are registered on
    // a shared target, and not on the canvas itself
    if (!store.getState().events.connected) state.events.connect == null ? void 0 : state.events.connect(rootElement);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return /*#__PURE__*/jsxRuntime.jsx(context.Provider, {
    value: store,
    children: children
  });
}
function unmountComponentAtNode(canvas, callback) {
  const root = _roots.get(canvas);
  const fiber = root == null ? void 0 : root.fiber;
  if (fiber) {
    const state = root == null ? void 0 : root.store.getState();
    if (state) state.internal.active = false;
    reconciler.updateContainer(null, fiber, null, () => {
      if (state) {
        setTimeout(() => {
          try {
            var _state$gl, _state$gl$renderLists, _state$gl2, _state$gl3;
            state.events.disconnect == null ? void 0 : state.events.disconnect();
            (_state$gl = state.gl) == null ? void 0 : (_state$gl$renderLists = _state$gl.renderLists) == null ? void 0 : _state$gl$renderLists.dispose == null ? void 0 : _state$gl$renderLists.dispose();
            (_state$gl2 = state.gl) == null ? void 0 : _state$gl2.forceContextLoss == null ? void 0 : _state$gl2.forceContextLoss();
            if ((_state$gl3 = state.gl) != null && _state$gl3.xr) state.xr.disconnect();
            dispose(state.scene);
            _roots.delete(canvas);
            if (callback) callback(canvas);
          } catch (e) {
            /* ... */
          }
        }, 500);
      }
    });
  }
}
function createPortal(children, container, state) {
  return /*#__PURE__*/jsxRuntime.jsx(Portal, {
    children: children,
    container: container,
    state: state
  });
}
function Portal({
  state = {},
  children,
  container
}) {
  /** This has to be a component because it would not be able to call useThree/useStore otherwise since
   *  if this is our environment, then we are not in r3f's renderer but in react-dom, it would trigger
   *  the "R3F hooks can only be used within the Canvas component!" warning:
   *  <Canvas>
   *    {createPortal(...)} */
  const {
    events,
    size,
    ...rest
  } = state;
  const previousRoot = useStore();
  const [raycaster] = React__namespace.useState(() => new THREE__namespace.Raycaster());
  const [pointer] = React__namespace.useState(() => new THREE__namespace.Vector2());
  const inject = useMutableCallback((rootState, injectState) => {
    let viewport = undefined;
    if (injectState.camera && size) {
      const camera = injectState.camera;
      // Calculate the override viewport, if present
      viewport = rootState.viewport.getCurrentViewport(camera, new THREE__namespace.Vector3(), size);
      // Update the portal camera, if it differs from the previous layer
      if (camera !== rootState.camera) updateCamera(camera, size);
    }
    return {
      // The intersect consists of the previous root state
      ...rootState,
      ...injectState,
      // Portals have their own scene, which forms the root, a raycaster and a pointer
      scene: container,
      raycaster,
      pointer,
      mouse: pointer,
      // Their previous root is the layer before it
      previousRoot,
      // Events, size and viewport can be overridden by the inject layer
      events: {
        ...rootState.events,
        ...injectState.events,
        ...events
      },
      size: {
        ...rootState.size,
        ...size
      },
      viewport: {
        ...rootState.viewport,
        ...viewport
      },
      // Layers are allowed to override events
      setEvents: events => injectState.set(state => ({
        ...state,
        events: {
          ...state.events,
          ...events
        }
      }))
    };
  });
  const usePortalStore = React__namespace.useMemo(() => {
    // Create a mirrored store, based on the previous root with a few overrides ...
    const store = traditional.createWithEqualityFn((set, get) => ({
      ...rest,
      set,
      get
    }));

    // Subscribe to previous root-state and copy changes over to the mirrored portal-state
    const onMutate = prev => store.setState(state => inject.current(prev, state));
    onMutate(previousRoot.getState());
    previousRoot.subscribe(onMutate);
    return store;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousRoot, container]);
  return (
    /*#__PURE__*/
    // @ts-ignore, reconciler types are not maintained
    jsxRuntime.jsx(jsxRuntime.Fragment, {
      children: reconciler.createPortal( /*#__PURE__*/jsxRuntime.jsx(context.Provider, {
        value: usePortalStore,
        children: children
      }), usePortalStore, null)
    })
  );
}

/**
 * Force React to flush any updates inside the provided callback synchronously and immediately.
 * All the same caveats documented for react-dom's `flushSync` apply here (see https://react.dev/reference/react-dom/flushSync).
 * Nevertheless, sometimes one needs to render synchronously, for example to keep DOM and 3D changes in lock-step without
 * having to revert to a non-React solution. Note: this will only flush updates within the `Canvas` root.
 */
function flushSync(fn) {
  // @ts-ignore - reconciler types are not maintained
  return reconciler.flushSyncFromReconciler(fn);
}

function createSubs(callback, subs) {
  const sub = {
    callback
  };
  subs.add(sub);
  return () => void subs.delete(sub);
}
const globalEffects = new Set();
const globalAfterEffects = new Set();
const globalTailEffects = new Set();

/**
 * Adds a global render callback which is called each frame.
 * @see https://docs.pmnd.rs/react-three-fiber/api/additional-exports#addEffect
 */
const addEffect = callback => createSubs(callback, globalEffects);

/**
 * Adds a global after-render callback which is called each frame.
 * @see https://docs.pmnd.rs/react-three-fiber/api/additional-exports#addAfterEffect
 */
const addAfterEffect = callback => createSubs(callback, globalAfterEffects);

/**
 * Adds a global callback which is called when rendering stops.
 * @see https://docs.pmnd.rs/react-three-fiber/api/additional-exports#addTail
 */
const addTail = callback => createSubs(callback, globalTailEffects);
function run(effects, timestamp) {
  if (!effects.size) return;
  for (const {
    callback
  } of effects.values()) {
    callback(timestamp);
  }
}
function flushGlobalEffects(type, timestamp) {
  switch (type) {
    case 'before':
      return run(globalEffects, timestamp);
    case 'after':
      return run(globalAfterEffects, timestamp);
    case 'tail':
      return run(globalTailEffects, timestamp);
  }
}
let subscribers;
let subscription;
function update(timestamp, state, frame) {
  // Run local effects
  let delta = state.clock.getDelta();

  // In frameloop='never' mode, clock times are updated using the provided timestamp
  if (state.frameloop === 'never' && typeof timestamp === 'number') {
    delta = timestamp - state.clock.elapsedTime;
    state.clock.oldTime = state.clock.elapsedTime;
    state.clock.elapsedTime = timestamp;
  }

  // Call subscribers (useFrame)
  subscribers = state.internal.subscribers;
  for (let i = 0; i < subscribers.length; i++) {
    subscription = subscribers[i];
    subscription.ref.current(subscription.store.getState(), delta, frame);
  }

  // Render content
  if (!state.internal.priority && state.gl.render) state.gl.render(state.scene, state.camera);

  // Decrease frame count
  state.internal.frames = Math.max(0, state.internal.frames - 1);
  return state.frameloop === 'always' ? 1 : state.internal.frames;
}
let running = false;
let useFrameInProgress = false;
let repeat;
let frame;
let state;
function loop(timestamp) {
  frame = requestAnimationFrame(loop);
  running = true;
  repeat = 0;

  // Run effects
  flushGlobalEffects('before', timestamp);

  // Render all roots
  useFrameInProgress = true;
  for (const root of _roots.values()) {
    var _state$gl$xr;
    state = root.store.getState();

    // If the frameloop is invalidated, do not run another frame
    if (state.internal.active && (state.frameloop === 'always' || state.internal.frames > 0) && !((_state$gl$xr = state.gl.xr) != null && _state$gl$xr.isPresenting)) {
      repeat += update(timestamp, state);
    }
  }
  useFrameInProgress = false;

  // Run after-effects
  flushGlobalEffects('after', timestamp);

  // Stop the loop if nothing invalidates it
  if (repeat === 0) {
    // Tail call effects, they are called when rendering stops
    flushGlobalEffects('tail', timestamp);

    // Flag end of operation
    running = false;
    return cancelAnimationFrame(frame);
  }
}

/**
 * Invalidates the view, requesting a frame to be rendered. Will globally invalidate unless passed a root's state.
 * @see https://docs.pmnd.rs/react-three-fiber/api/additional-exports#invalidate
 */
function invalidate(state, frames = 1) {
  var _state$gl$xr2;
  if (!state) return _roots.forEach(root => invalidate(root.store.getState(), frames));
  if ((_state$gl$xr2 = state.gl.xr) != null && _state$gl$xr2.isPresenting || !state.internal.active || state.frameloop === 'never') return;
  if (frames > 1) {
    // legacy support for people using frames parameters
    // Increase frames, do not go higher than 60
    state.internal.frames = Math.min(60, state.internal.frames + frames);
  } else {
    if (useFrameInProgress) {
      //called from within a useFrame, it means the user wants an additional frame
      state.internal.frames = 2;
    } else {
      //the user need a new frame, no need to increment further than 1
      state.internal.frames = 1;
    }
  }

  // If the render-loop isn't active, start it
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

/**
 * Advances the frameloop and runs render effects, useful for when manually rendering via `frameloop="never"`.
 * @see https://docs.pmnd.rs/react-three-fiber/api/additional-exports#advance
 */
function advance(timestamp, runGlobalEffects = true, state, frame) {
  if (runGlobalEffects) flushGlobalEffects('before', timestamp);
  if (!state) for (const root of _roots.values()) update(timestamp, root.store.getState());else update(timestamp, state, frame);
  if (runGlobalEffects) flushGlobalEffects('after', timestamp);
}

const DOM_EVENTS = {
  onClick: ['click', false],
  onContextMenu: ['contextmenu', false],
  onDoubleClick: ['dblclick', false],
  onWheel: ['wheel', true],
  onPointerDown: ['pointerdown', true],
  onPointerUp: ['pointerup', true],
  onPointerLeave: ['pointerleave', true],
  onPointerMove: ['pointermove', true],
  onPointerCancel: ['pointercancel', true],
  onLostPointerCapture: ['lostpointercapture', true]
};

/** Default R3F event manager for web */
function createPointerEvents(store) {
  const {
    handlePointer
  } = createEvents(store);
  return {
    priority: 1,
    enabled: true,
    compute(event, state, previous) {
      // https://github.com/pmndrs/react-three-fiber/pull/782
      // Events trigger outside of canvas when moved, use offsetX/Y by default and allow overrides
      state.pointer.set(event.offsetX / state.size.width * 2 - 1, -(event.offsetY / state.size.height) * 2 + 1);
      state.raycaster.setFromCamera(state.pointer, state.camera);
    },
    connected: undefined,
    handlers: Object.keys(DOM_EVENTS).reduce((acc, key) => ({
      ...acc,
      [key]: handlePointer(key)
    }), {}),
    update: () => {
      var _internal$lastEvent;
      const {
        events,
        internal
      } = store.getState();
      if ((_internal$lastEvent = internal.lastEvent) != null && _internal$lastEvent.current && events.handlers) events.handlers.onPointerMove(internal.lastEvent.current);
    },
    connect: target => {
      const {
        set,
        events
      } = store.getState();
      events.disconnect == null ? void 0 : events.disconnect();
      set(state => ({
        events: {
          ...state.events,
          connected: target
        }
      }));
      if (events.handlers) {
        for (const name in events.handlers) {
          const event = events.handlers[name];
          const [eventName, passive] = DOM_EVENTS[name];
          target.addEventListener(eventName, event, {
            passive
          });
        }
      }
    },
    disconnect: () => {
      const {
        set,
        events
      } = store.getState();
      if (events.connected) {
        if (events.handlers) {
          for (const name in events.handlers) {
            const event = events.handlers[name];
            const [eventName] = DOM_EVENTS[name];
            events.connected.removeEventListener(eventName, event);
          }
        }
        set(state => ({
          events: {
            ...state.events,
            connected: undefined
          }
        }));
      }
    }
  };
}

exports.Block = Block;
exports.ErrorBoundary = ErrorBoundary;
exports._roots = _roots;
exports.act = act;
exports.addAfterEffect = addAfterEffect;
exports.addEffect = addEffect;
exports.addTail = addTail;
exports.advance = advance;
exports.applyProps = applyProps;
exports.buildGraph = buildGraph;
exports.context = context;
exports.createEvents = createEvents;
exports.createPointerEvents = createPointerEvents;
exports.createPortal = createPortal;
exports.createRoot = createRoot;
exports.dispose = dispose;
exports.extend = extend;
exports.flushGlobalEffects = flushGlobalEffects;
exports.flushSync = flushSync;
exports.getRootState = getRootState;
exports.invalidate = invalidate;
exports.isRef = isRef;
exports.reconciler = reconciler;
exports.threeTypes = threeTypes;
exports.unmountComponentAtNode = unmountComponentAtNode;
exports.useBridge = useBridge;
exports.useFrame = useFrame;
exports.useGraph = useGraph;
exports.useInstanceHandle = useInstanceHandle;
exports.useIsomorphicLayoutEffect = useIsomorphicLayoutEffect;
exports.useLoader = useLoader;
exports.useMutableCallback = useMutableCallback;
exports.useStore = useStore;
exports.useThree = useThree;
