import { Euler, Quaternion, Vector3 } from 'three';

import { replaceOrRemoveXmlAttribute } from '@/core/utils/xmlSourceTextUtils';
import type { UrdfOrigin } from '@/types';
import { findBodyInsertionPoint, parseXmlAttributes } from './mjcfEditableSourcePatchHelpers';
import { formatQuaternionWxyzFromRpy, formatVec3 } from './mjcfSourceFormatters';

function asQuaternion(origin: UrdfOrigin): Quaternion {
  return new Quaternion().setFromEuler(new Euler(origin.rpy.r, origin.rpy.p, origin.rpy.y, 'ZYX'));
}

function bodyPositionAfterOriginEdit(
  position: Vector3,
  before: UrdfOrigin,
  after: UrdfOrigin,
  rotationChanged: boolean,
): Vector3 {
  const offset = new Vector3(before.xyz.x, before.xyz.y, before.xyz.z).sub(position);
  if (!rotationChanged) {
    // Subtract the authored offset instead of adding a position delta: adding
    // (tiny - previous) to previous can erase the entire requested tiny value.
    return new Vector3(after.xyz.x, after.xyz.y, after.xyz.z).sub(offset);
  }
  // Canonical joint origins include the body's rotated joint-local offset.
  // Keep that authored offset when changing the surrounding body rotation.
  offset.applyQuaternion(asQuaternion(before).invert()).applyQuaternion(asQuaternion(after));
  return new Vector3(after.xyz.x, after.xyz.y, after.xyz.z).sub(offset);
}

/** Patch a body opening tag without replacing its geoms, comments or children. */
export function patchMJCFBodyOriginInSource(
  sourceContent: string,
  bodyName: string,
  before: UrdfOrigin,
  after: UrdfOrigin,
): string {
  const body = findBodyInsertionPoint(sourceContent, bodyName);
  if (!body) return sourceContent;
  const attributes = parseXmlAttributes(body.rawOpenTag);
  const values = attributes.pos?.trim().split(/\s+/).map(Number) ?? [0, 0, 0];
  if (values.length !== 3 || !values.every(Number.isFinite)) return sourceContent;
  const rotationChanged = before.rpy.r !== after.rpy.r
    || before.rpy.p !== after.rpy.p || before.rpy.y !== after.rpy.y;
  const position = bodyPositionAfterOriginEdit(
    new Vector3(values[0], values[1], values[2]), before, after, rotationChanged,
  );
  let tag = replaceOrRemoveXmlAttribute(body.rawOpenTag, 'pos', formatVec3(position));
  if (rotationChanged) {
    // Quaternions are independent of compiler angle/eulerseq settings.
    for (const attribute of ['euler', 'axisangle', 'xyaxes', 'zaxis']) {
      tag = replaceOrRemoveXmlAttribute(tag, attribute, null);
    }
    tag = replaceOrRemoveXmlAttribute(tag, 'quat', formatQuaternionWxyzFromRpy(after.rpy));
  }
  return sourceContent.slice(0, body.openTagStart) + tag + sourceContent.slice(body.openTagEnd);
}
