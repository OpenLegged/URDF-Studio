import assert from 'node:assert/strict'
import test from 'node:test'
import { createJoint, createLink } from '@/core/robot'
import { GeometryType, JointType, type RobotData } from '@/types'
import { normalizeAIRobotResponse } from './normalizeRobotData'

function meshRobot(): RobotData {
  const names = ['base_link', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'finger1', 'finger2', 'finger3']
  const links = Object.fromEntries(names.map(id => {
    const link = createLink({ id, name: id })
    for (const geometry of [link.visual, link.collision]) {
      geometry.type = GeometryType.MESH
      geometry.meshPath = `C:/Users/user/Desktop/robots/webots_latest/webots_latest/ur1/meshes/${id}.STL`
      geometry.dimensions = { x: 1, y: 1, z: 1 }
    }
    link.visual.origin.xyz.z = 0.123
    link.collision.origin.xyz.x = -0.25
    link.inertial = { mass: 1.125, origin: { xyz: { x: 0, y: 0, z: 0.031 }, rpy: { r: 0, p: 0, y: 0 } }, inertia: { ixx: 0.00198, ixy: 1e-19, ixz: -5e-20, iyy: 0.00198, iyz: 0, izz: 0.00325 } }
    return [id, link]
  }))
  const joints = Object.fromEntries(names.slice(1).map((id, index) => {
    const joint = createJoint({ id: `j${index + 1}`, parentLinkId: names[index], childLinkId: id, type: JointType.REVOLUTE })
    joint.dynamics = { damping: 0.2, friction: 0.03 }
    joint.hardware.armature = 0.001
    return [joint.id, joint]
  }))
  joints.j2.mimic = { joint: 'j1', multiplier: -1, offset: 0.1 }
  links.base_link.visual.authoredMaterials = [{ name: 'paint', color: '#123456', texture: 'ur1/textures/paint.png', roughness: 0.4 }]
  links.base_link.visualBodies = [structuredClone(links.l1.visual)]
  links.base_link.collisionBodies = [structuredClone(links.l2.collision)]
  return { name: 'ur1', rootLinkId: 'base_link', links, joints, materials: { paint: { texture: 'ur1/textures/paint.png' } } }
}

test('mesh robot edits retain all meshes, transforms, physical properties and secondary geometry', () => {
  const current = meshRobot()
  const before = structuredClone(current)
  const result = normalizeAIRobotResponse({
    name: 'ur1', rootLinkId: 'base_link',
    links: Object.values(current.links).map(link => ({ id: link.id, name: link.name, visualType: 'mesh' })),
    joints: Object.values(current.joints).map(joint => ({ id: joint.id, ...(joint.id === 'j1' ? { upperLimit: 2.5 } : {}) })),
  }, current)
  assert.ok(result)
  assert.deepEqual(result.links, current.links)
  assert.equal(result.joints.j1.limit?.upper, 2.5)
  assert.deepEqual(result.joints.j2, current.joints.j2)
  assert.deepEqual(result.materials, current.materials)
  assert.deepEqual(current, before, 'normalization must not mutate the live workspace')
  result.links.l1.visual.meshPath = 'edited.stl'
  assert.equal(current.links.l1.visual.meshPath, before.links.l1.visual.meshPath)
})

test('joint-only replies keep omitted links, retain member fields and accept zero values', () => {
  const current = meshRobot()
  const result = normalizeAIRobotResponse({ joints: { ...current.joints, j1: { id: 'j1', upperLimit: 0, effortLimit: 0, originXYZ: [0, 0, 0], hardware: { armature: 0 } } } }, current)
  assert.ok(result)
  assert.deepEqual(result.links, current.links)
  assert.deepEqual(result.joints.j2, current.joints.j2)
  assert.equal(result.joints.j1.limit?.upper, 0)
  assert.equal(result.joints.j1.limit?.effort, 0)
  assert.equal(result.joints.j1.limit?.lower, current.joints.j1.limit?.lower)
  assert.deepEqual(result.joints.j1.origin.xyz, { x: 0, y: 0, z: 0 })
  assert.equal(result.joints.j1.hardware.armature, 0)
})

test('explicit nested mesh, scale, material and inertial edits override only those fields', () => {
  const current = meshRobot()
  const result = normalizeAIRobotResponse({ links: { ...current.links, base_link: {
    visual: { meshPath: 'ur1/meshes/replacement.STL', dimensions: [2, 3, 4], origin: { xyz: { x: 0.5 } }, authoredMaterials: [{ name: 'new', color: '#abcdef' }] },
    inertial: { mass: 0, inertia: { ixy: 0 } },
  } } }, current)
  assert.ok(result)
  assert.equal(result.links.base_link.visual.meshPath, 'ur1/meshes/replacement.STL')
  assert.deepEqual(result.links.base_link.visual.dimensions, { x: 2, y: 3, z: 4 })
  assert.deepEqual(result.links.base_link.visual.origin.xyz, { x: 0.5, y: 0, z: 0.123 })
  assert.deepEqual(result.links.base_link.collision, current.links.base_link.collision)
  assert.deepEqual(result.links.base_link.visual.authoredMaterials, [{ name: 'new', color: '#abcdef' }])
  assert.equal(result.links.base_link.inertial?.mass, 0)
  assert.equal(result.links.base_link.inertial?.inertia.ixx, current.links.base_link.inertial?.inertia.ixx)
})

test('explicit compact shape edits and zero mass are applied to existing entities', () => {
  const current = meshRobot()
  const result = normalizeAIRobotResponse({ links: { ...current.links, l1: { id: 'l1', visualType: 'box', dimensions: [0.2, 0.3, 0.4], color: '#ffffff', mass: 0 } } }, current)
  assert.ok(result)
  assert.equal(result.links.l1.visual.type, GeometryType.BOX)
  assert.equal(result.links.l1.collision.type, GeometryType.BOX)
  assert.deepEqual(result.links.l1.visual.dimensions, { x: 0.2, y: 0.3, z: 0.4 })
  assert.equal(result.links.l1.inertial?.mass, 0)
})

test('new canonical mesh robots retain nested mesh data and independent collisions', () => {
  const current = meshRobot()
  const result = normalizeAIRobotResponse(current)
  assert.ok(result)
  assert.deepEqual(result, current)
})

test('compact generation still creates new entities with explicit geometry and limits', () => {
  const result = normalizeAIRobotResponse({ name: 'new', links: [
    { id: 'base', visualType: 'box', dimensions: [1, 2, 3], mass: 0 },
    { id: 'arm', visualType: 'cylinder', dimensions: [0.1, 0.5, 0.1] },
  ], joints: [{ id: 'joint', parent: 'base', child: 'arm', type: 'revolute', axis: [0, 1, 0], lowerLimit: 0, upperLimit: 1, motorType: 'servo' }] })
  assert.ok(result)
  assert.equal(result.rootLinkId, 'base')
  assert.equal(result.links.base.inertial?.mass, 0)
  assert.deepEqual(result.links.base.visual.dimensions, { x: 1, y: 2, z: 3 })
  assert.equal(result.joints.joint.limit?.lower, 0)
  assert.equal(result.joints.joint.hardware.motorType, 'servo')
})

test('malformed external fields fail validation instead of replacing the workspace with bad data', () => {
  const current = meshRobot()
  assert.throws(() => normalizeAIRobotResponse({ links: { base_link: { visual: { dimensions: { x: 'bad' } } } } }, current), /Invalid canonical RobotData/)
})

test('full entity collections can delete a child and its joint without restoring them from the baseline', () => {
  const current = meshRobot()
  const result = normalizeAIRobotResponse({ links: [{ id: 'base_link' }], joints: [] }, current)
  assert.ok(result)
  assert.deepEqual(result.links, { base_link: current.links.base_link })
  assert.deepEqual(result.joints, {})
  assert.equal(Object.keys(current.links).length, 10)
  assert.equal(Object.keys(current.joints).length, 9)
})

test('omitting both entity collections preserves the model while editing its name', () => {
  const current = meshRobot()
  const result = normalizeAIRobotResponse({ name: 'renamed' }, current)
  assert.ok(result)
  assert.equal(result.name, 'renamed')
  assert.deepEqual(result.links, current.links)
  assert.deepEqual(result.joints, current.joints)
})
