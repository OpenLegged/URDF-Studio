import { assertCanonicalRobotData } from '@/core/robot'
import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType, type RobotData } from '@/types'

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

/** Merge only explicitly returned fields. Arrays are authored replacements. */
function mergeFields(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return structuredClone(base)
  const previous = toRecord(base)
  const next = toRecord(patch)
  if (!next) return structuredClone(patch)
  return Object.fromEntries(
    [...new Set([...Object.keys(previous ?? {}), ...Object.keys(next)])]
      .map(key => [key, mergeFields(previous?.[key], next[key])]),
  )
}

function vectorPatch(value: unknown, axes: readonly string[]): unknown {
  return Array.isArray(value)
    ? Object.fromEntries(axes.flatMap((axis, index) => value[index] === undefined ? [] : [[axis, value[index]]]))
    : value
}

function originPatch(value: unknown): unknown {
  const origin = toRecord(value)
  return origin ? {
    ...origin,
    ...(origin.xyz === undefined ? {} : { xyz: vectorPatch(origin.xyz, ['x', 'y', 'z']) }),
    ...(origin.rpy === undefined ? {} : { rpy: vectorPatch(origin.rpy, ['r', 'p', 'y']) }),
  } : value
}

function geometryPatch(value: unknown): unknown {
  const geometry = toRecord(value)
  return geometry ? {
    ...geometry,
    ...(geometry.dimensions === undefined ? {} : { dimensions: vectorPatch(geometry.dimensions, ['x', 'y', 'z']) }),
    ...(geometry.origin === undefined ? {} : { origin: originPatch(geometry.origin) }),
  } : value
}

function entityEntries(value: unknown): Array<[string, Record<string, unknown>]> {
  const entries = Array.isArray(value) ? value.map(item => ['', item]) : Object.entries(toRecord(value) ?? {})
  return entries.map(([key, item]) => {
    const entity = toRecord(item)
    const id = entity?.id ?? key
    if (!entity || typeof id !== 'string' || !id) throw new Error('AI returned an entity without a valid ID')
    return [id, { ...entity, id }]
  })
}

function defaultLink(id: string): unknown {
  const link = structuredClone(DEFAULT_LINK)
  link.id = id
  link.name = id
  for (const geometry of [link.visual, link.collision]) {
    geometry.type = GeometryType.BOX
    geometry.dimensions = { x: 0.1, y: 0.1, z: 0.1 }
  }
  link.visual.color = '#3b82f6'
  return link
}

function linkPatch(link: Record<string, unknown>, isNew: boolean): Record<string, unknown> {
  const { visualType, dimensions, color, mass, ...canonical } = link
  const flatGeometry = {
    ...(visualType === undefined ? {} : { type: visualType }),
    ...(dimensions === undefined ? {} : { dimensions: vectorPatch(dimensions, ['x', 'y', 'z']) }),
  }
  const visual = mergeFields(flatGeometry, geometryPatch(canonical.visual))
  // The compact generation schema historically uses one shape for both bodies.
  // Existing collisions are independent and must not be regenerated from visuals.
  const collision = mergeFields(
    isNew && canonical.collision === undefined ? visual : flatGeometry,
    geometryPatch(canonical.collision),
  )
  const inertial = toRecord(canonical.inertial)
  return {
    ...canonical,
    visual: mergeFields(visual, color === undefined ? {} : { color }),
    collision,
    ...(mass === undefined && canonical.inertial === undefined ? {} : {
      inertial: mergeFields(
        mass === undefined ? {} : { mass },
        inertial ? { ...inertial, ...(inertial.origin === undefined ? {} : { origin: originPatch(inertial.origin) }) } : canonical.inertial,
      ),
    }),
    ...(Array.isArray(canonical.visualBodies) ? { visualBodies: canonical.visualBodies.map(geometryPatch) } : {}),
    ...(Array.isArray(canonical.collisionBodies) ? { collisionBodies: canonical.collisionBodies.map(geometryPatch) } : {}),
  }
}

function jointPatch(joint: Record<string, unknown>): unknown {
  const { parent, child, originXYZ, originRPY, lowerLimit, upperLimit, effortLimit, velocityLimit, motorType, ...canonical } = joint
  const aliases = {
    ...(parent === undefined ? {} : { parentLinkId: parent }),
    ...(child === undefined ? {} : { childLinkId: child }),
    origin: {
      ...(originXYZ === undefined ? {} : { xyz: vectorPatch(originXYZ, ['x', 'y', 'z']) }),
      ...(originRPY === undefined ? {} : { rpy: vectorPatch(originRPY, ['r', 'p', 'y']) }),
    },
    ...(lowerLimit === undefined && upperLimit === undefined && effortLimit === undefined && velocityLimit === undefined ? {} : {
      limit: {
        ...(lowerLimit === undefined ? {} : { lower: lowerLimit }),
        ...(upperLimit === undefined ? {} : { upper: upperLimit }),
        ...(effortLimit === undefined ? {} : { effort: effortLimit }),
        ...(velocityLimit === undefined ? {} : { velocity: velocityLimit }),
      },
    }),
    ...(motorType === undefined ? {} : { hardware: { motorType } }),
  }
  return mergeFields(aliases, {
    ...canonical,
    ...(canonical.origin === undefined ? {} : { origin: originPatch(canonical.origin) }),
    ...(canonical.axis === undefined ? {} : { axis: vectorPatch(canonical.axis, ['x', 'y', 'z']) }),
  })
}

/** Normalize legacy compact replies without losing the imported model being edited. */
export function normalizeAIRobotResponse(raw: unknown, currentRobot?: RobotData): RobotData | null {
  const data = toRecord(raw)
  if (!data) return null
  const { name, links, joints, rootLinkId, rootId, ...metadata } = data
  // A returned collection is the complete authored entity set (including
  // deletions). Only an omitted collection keeps the existing membership.
  const nextLinks: Record<string, unknown> = links === undefined ? structuredClone(currentRobot?.links ?? {}) : {}
  const nextJoints: Record<string, unknown> = joints === undefined ? structuredClone(currentRobot?.joints ?? {}) : {}
  for (const [id, link] of entityEntries(links)) {
    const existing = currentRobot?.links[id]
    nextLinks[id] = mergeFields(existing ?? defaultLink(id), linkPatch(link, !existing))
  }
  for (const [id, joint] of entityEntries(joints)) {
    const baseline = currentRobot?.joints[id] ?? {
      ...structuredClone(DEFAULT_JOINT), id, name: id, type: JointType.FIXED,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
    }
    nextJoints[id] = mergeFields(baseline, jointPatch(joint))
  }
  const root = rootLinkId ?? rootId ?? currentRobot?.rootLinkId
    ?? Object.keys(nextLinks).find(id => !Object.values(nextJoints).some(joint => toRecord(joint)?.childLinkId === id))
  const { selection: _selection, ...baseline } = toRecord(currentRobot) ?? {}
  const result = {
    ...structuredClone(baseline), ...metadata,
    name: name ?? currentRobot?.name ?? 'modified_robot',
    rootLinkId: root, links: nextLinks, joints: nextJoints,
  }
  // External JSON stays unknown until the canonical boundary validates nested
  // geometry, physics, materials and topology; malformed replies fail.
  assertCanonicalRobotData(result)
  return result
}
