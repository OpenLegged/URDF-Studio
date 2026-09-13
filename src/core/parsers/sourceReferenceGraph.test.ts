import assert from 'node:assert/strict';
import test from 'node:test';
import type { RobotFile } from '@/types';
import { collectRelatedSourceEntries } from './sourceReferenceGraph';

test('reference traversal visits cycles once, ignores comments and retains source metadata', () => {
  const rootFile: RobotFile = {
    name: 'robot/main.xml',
    format: 'mjcf',
    content: '<mujoco><include file="part.xml"/><!-- <include file="ignored.xml"/> --></mujoco>',
  };
  const availableFiles: RobotFile[] = [rootFile, {
    name: 'robot/part.xml',
    format: 'mjcf',
    content: '<mujocoinclude/>',
    blobUrl: 'blob:part',
  }, {
    name: 'robot/ignored.xml',
    format: 'mjcf',
    content: '<mujocoinclude/>',
  }];
  const originalFiles = structuredClone(availableFiles);
  const content = '<mujocoinclude><include file="main.xml"/></mujocoinclude>';
  const entries = collectRelatedSourceEntries({
    rootFile,
    availableFiles,
    allFileContents: { 'robot/part.xml': content },
  });

  assert.deepEqual(entries, [{
    path: 'robot/part.xml',
    format: 'mjcf',
    content,
    blobUrl: 'blob:part',
  }]);
  assert.deepEqual(availableFiles, originalFiles);
});

test('Xacro package references keep their package scope and omit unresolved files', () => {
  const rootFile: RobotFile = {
    name: 'robot/main.xacro',
    format: 'xacro',
    content: '<robot><xacro:include filename="$(find arm)/part.xacro"/>'
      + '<xacro:include filename="$(find missing)/part.xacro"/></robot>',
  };
  const entries = collectRelatedSourceEntries({
    rootFile,
    availableFiles: [],
    allFileContents: {
      'assets/arm/part.xacro': '<robot/>',
      'assets/other/part.xacro': '<robot/>',
    },
  });

  assert.deepEqual(entries.map((entry) => entry.path), ['assets/arm/part.xacro']);
});

test('USD references share virtual path resolution and exclude texture resources', () => {
  const rootFile: RobotFile = {
    name: 'robot/layers/main.usda',
    format: 'usd',
    content: '#usda 1.0\n(subLayers = [@../base.usda@, @../base.usda@])\nasset texture = @../albedo.png@',
  };
  const entries = collectRelatedSourceEntries({
    rootFile,
    availableFiles: [],
    allFileContents: { 'robot/base.usda': '#usda 1.0', 'robot/albedo.png': '' },
  });

  assert.deepEqual(entries.map((entry) => entry.path), ['robot/base.usda']);
});
