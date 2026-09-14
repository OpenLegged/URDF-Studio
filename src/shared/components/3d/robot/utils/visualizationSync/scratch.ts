import * as THREE from 'three';

// Shared module-level scratch singletons. These are intentionally a single
// instance set imported by every consumer module so that cross-function reuse
// semantics (e.g. scratchQuaternion reused by inertia sync, MJCF wrap-axis
// resolution and MJCF tendon segment transforms) stay byte-for-byte identical
// to the pre-split behavior. Never construct a per-module copy.
export const scratchLinkBox = new THREE.Box3();
export const scratchLinkSize = new THREE.Vector3();
export const scratchEuler = new THREE.Euler();
export const scratchQuaternion = new THREE.Quaternion();
export const scratchHelperObjects = new Set<THREE.Object3D>();
export const scratchMjcfSiteWorldPosition = new THREE.Vector3();
export const scratchMjcfTendonLocalStart = new THREE.Vector3();
export const scratchMjcfTendonLocalEnd = new THREE.Vector3();
export const scratchMjcfTendonSegmentVector = new THREE.Vector3();
export const scratchMjcfTendonSegmentMidpoint = new THREE.Vector3();
export const scratchMjcfTendonSegmentDirection = new THREE.Vector3();
export const scratchMjcfTendonProjectionVector = new THREE.Vector3();
export const scratchMjcfTendonProjectionOffset = new THREE.Vector3();
export const scratchMjcfTendonProjectionPoint = new THREE.Vector3();
export const scratchMjcfTendonBasisU = new THREE.Vector3();
export const scratchMjcfTendonBasisV = new THREE.Vector3();
export const scratchMjcfTendonBasisCandidate = new THREE.Vector3();
export const scratchMjcfTendonWorldScale = new THREE.Vector3();
export const mjcfTendonYAxis = new THREE.Vector3(0, 1, 0);
export const MJCF_TENDON_MIN_VISIBLE_RADIUS = 0.003;
export const MJCF_INVERSE_CYLINDER_SIDE_INSIDE_RATIO = 0.75;
