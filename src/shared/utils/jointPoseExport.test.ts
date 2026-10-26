import assert from 'node:assert/strict';
import test from 'node:test';
import { buildJointPose, jointPoseFileName, serializeJointPose } from './jointPoseExport';

test('pose capture includes zero joints and actual rotations and translations at full precision', () => {
  const robot = {
    name: 'robot',
    joints: {
      elbow: { name: 'elbow', type: 'revolute', angle: 0.8, referencePosition: 0.2 },
      slide: { name: 'slide', type: 'prismatic', angle: 0.1, referencePosition: 0.05 },
      wheel: { name: 'wheel', type: 'continuous', angle: 0 },
      mount: { name: 'mount', type: 'fixed' },
      base: { name: 'base', type: 'floating' },
      ball: { name: 'ball', type: 'ball' },
    },
  };
  const angles = { elbow: 0.1234567890123456, slide: 0.01543210987654321 };
  const pose = buildJointPose(robot, angles);
  assert.deepEqual(pose.joints, [
    { id: 'elbow', name: 'elbow', type: 'revolute', position: angles.elbow, unit: 'rad' },
    { id: 'slide', name: 'slide', type: 'prismatic', position: angles.slide, unit: 'm' },
    { id: 'wheel', name: 'wheel', type: 'continuous', position: 0, unit: 'rad' },
  ]);
  const json: unknown = JSON.parse(serializeJointPose(pose, 'json'));
  assert.deepEqual(json, pose);
  const csv = serializeJointPose(pose, 'csv');
  assert.ok(csv.startsWith('\uFEFFjoint_id,joint_name,joint_type,position,unit\r\n'));
  assert.ok(csv.includes(`"${angles.elbow}","rad"`));
  assert.ok(csv.includes(`"${angles.slide}","m"`));
  assert.ok(csv.includes('"wheel","wheel","continuous","0","rad"'));
  assert.equal(buildJointPose(robot, {}).joints[0].position, 0.8);
});

test('runtime IDs disambiguate same-named joints and captured poses do not follow later edits', () => {
  const robot = {
    joints: {
      left: { name: 'hinge', jointType: 'revolute', jointValue: [0.1] },
      right: { name: 'hinge', jointType: 'revolute', jointValue: [0.2] },
    },
  };
  const angles = { left: 0, right: -0.7, hinge: 3 };
  const pose = buildJointPose(robot, angles, 'assembly');
  angles.right = 0.9;
  robot.joints.left.jointValue[0] = 8;
  assert.deepEqual(
    pose.joints.map(({ id, position }) => ({ id, position })),
    [
      { id: 'left', position: 0 },
      { id: 'right', position: -0.7 },
    ],
  );
});

test('pose capture accepts authored-name angles and runtime jointValue with a zero default', () => {
  const pose = buildJointPose(
    {
      joints: {
        runtime_a: { name: 'authored', jointType: 'revolute', jointValue: 0.3 },
        runtime_b: { name: 'runtime', jointType: 'prismatic', jointValue: [0.125] },
        new_joint: { type: 'revolute' },
      },
    },
    { authored: -0.2 },
  );
  assert.deepEqual(
    pose.joints.map((joint) => joint.position),
    [-0.2, 0.125, 0],
  );
});

test('invalid positions fail instead of becoming zero or JSON null', () => {
  const robot = { joints: { hinge: { type: 'revolute', angle: 0.2 } } };
  assert.throws(() => buildJointPose(robot, { hinge: NaN }), /non-finite/);
  assert.throws(
    () => buildJointPose({ joints: { hinge: { type: 'revolute', angle: Infinity } } }, {}),
    /non-finite/,
  );
  const pose = buildJointPose(robot, {});
  for (const format of ['json', 'csv'] as const) {
    assert.throws(
      () => serializeJointPose({ ...pose, joints: [{ ...pose.joints[0], position: NaN }] }, format),
      /non-finite/,
    );
  }
});

test('CSV preserves commas, quotes, and newlines in joint identities', () => {
  const pose = buildJointPose(
    { joints: { 'id,1': { name: 'joint "left"\nslide', type: 'prismatic', angle: 0.02 } } },
    {},
  );
  assert.equal(
    serializeJointPose(pose, 'csv'),
    '\uFEFFjoint_id,joint_name,joint_type,position,unit\r\n"id,1","joint ""left""\nslide","prismatic","0.02","m"\r\n',
  );
});

test('CSV keeps formula-like joint identities as text, including hidden leading characters', () => {
  const identities = ['=1+1', '+1+1', '-1+1', '@SUM(1,2)', '  =1+1', '\t+1+1', '\r\n-1+1', '\u0000@SUM(1,2)', '\u007f=1+1', '\uFEFF=1+1'];
  for (const identity of identities) {
    const pose = buildJointPose({ joints: { [identity]: { name: identity, type: 'continuous', angle: -0.25 } } }, {});
    const safeIdentity = `"'${identity}"`;
    assert.equal(
      serializeJointPose(pose, 'csv'),
      `\uFEFFjoint_id,joint_name,joint_type,position,unit\r\n${safeIdentity},${safeIdentity},"continuous","-0.25","rad"\r\n`,
      `CSV must treat ${JSON.stringify(identity)} as a label rather than a formula`,
    );
    assert.deepEqual(JSON.parse(serializeJointPose(pose, 'json')), pose, 'JSON preserves the original identity');
    assert.equal(pose.joints[0].name, identity, 'CSV encoding does not mutate the captured pose');
  }
});

test('CSV does not add text markers to numeric positions or ordinary numeric labels', () => {
  const pose = buildJointPose({ joints: { '123': { name: 'joint-1', type: 'prismatic', angle: -1.2345678901234567 } } }, {});
  assert.equal(
    serializeJointPose(pose, 'csv'),
    '\uFEFFjoint_id,joint_name,joint_type,position,unit\r\n"123","joint-1","prismatic","-1.2345678901234567","m"\r\n',
  );
});

test('pose filenames avoid duplicate extensions and unsafe path characters', () => {
  assert.equal(jointPoseFileName(' squat.json ', 'json'), 'squat.json');
  assert.equal(jointPoseFileName('squat.JSON', 'csv'), 'squat.csv');
  assert.equal(jointPoseFileName('手部/姿态:\u0000', 'json'), '手部_姿态__.json');
  assert.equal(jointPoseFileName('...', 'json'), null);
  assert.equal(jointPoseFileName(' ', 'csv'), null);
});
