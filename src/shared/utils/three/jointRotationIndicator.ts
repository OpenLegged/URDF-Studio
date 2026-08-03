import * as THREE from 'three';

/**
 * Placement rules for the arrow head that marks a revolute/continuous joint's
 * positive rotation direction on its ring helper.
 *
 * Both the imperative viewer helper (`createJointAxisViz`) and the R3F helper
 * (`JointAxesVisual`) draw the ring as a `TorusGeometry` in the local XY plane,
 * with the joint axis mapped onto +Z. A torus arc sweeps counter-clockwise from
 * +X, which is exactly the right-hand-rule positive direction about +Z, so the
 * head must sit at the *end* of the sweep and point along the tangent. Marking
 * the sweep start, or pointing the head radially, makes the ring read as
 * clockwise and inverts the direction the user sees.
 */

/** Cone geometry points along +Y before any rotation is applied. */
const CONE_APEX_AXIS = new THREE.Vector3(0, 1, 0);

/** Where the arrow head sits: the far end of the counter-clockwise sweep. */
export function jointRotationArrowHeadPosition(arc: number, radius: number): THREE.Vector3 {
  return new THREE.Vector3(radius * Math.cos(arc), radius * Math.sin(arc), 0);
}

/** Orientation that aligns the cone apex with the counter-clockwise tangent. */
export function jointRotationArrowHeadQuaternion(arc: number): THREE.Quaternion {
  const tangent = new THREE.Vector3(-Math.sin(arc), Math.cos(arc), 0).normalize();
  return new THREE.Quaternion().setFromUnitVectors(CONE_APEX_AXIS, tangent);
}
