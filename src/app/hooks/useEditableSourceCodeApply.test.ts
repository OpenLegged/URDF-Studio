import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createComponentSourceDraft,
  createSingleComponentWorkspace,
  createSourceSemanticRobotHash,
  normalizeComponentRobot,
} from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { regressionDebugState, setRegressionEditableSourceApplyResult } from '@/shared/debug/regressionState';
import { DEFAULT_LINK, type RobotData } from '@/types';
import type { ApplyEditableSourceChangeOptions, ApplyEditableSourceChangeResult } from '@/app/utils/applyEditableSourceChange';
import {
  applyPreparedEditableSourceCodeChange,
  commitPreparedComponentSourceApply,
} from './useEditableSourceCodeApply.ts';

function robot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
}

function robotState(name: string) {
  return {
    ...robot(name),
    selection: { type: null, id: null },
  };
}

function incrementalLinkResult(nextName = 'base'): ApplyEditableSourceChangeResult {
  return {
    mode: 'incremental-patch',
    patch: {
      kind: 'urdf-link-fragment-update',
      previousLinkId: 'base',
      previousLinkName: 'base',
      nextLink: {
        ...structuredClone(DEFAULT_LINK),
        id: nextName,
        name: nextName,
        visual: {
          ...structuredClone(DEFAULT_LINK.visual),
          dimensions: { x: 0.13, y: 0.5, z: 0.13 },
        },
      },
    },
    diagnostics: {
      attempted: true,
      dirtyRangeCount: 1,
      dirtySpanBytes: 12,
      dirtySpanLimitBytes: 128,
      patchKind: 'urdf-link-fragment-update',
      skipReason: null,
    },
  };
}

function missingLinkIncrementalResult(): ApplyEditableSourceChangeResult {
  return {
    mode: 'incremental-patch',
    patch: {
      kind: 'urdf-link-fragment-update',
      previousLinkId: 'missing-link',
      previousLinkName: 'missing-link',
      nextLink: {
        ...structuredClone(DEFAULT_LINK),
        id: 'missing-link',
        name: 'missing-link',
      },
    },
    diagnostics: {
      attempted: true,
      dirtyRangeCount: 1,
      dirtySpanBytes: 12,
      dirtySpanLimitBytes: 128,
      patchKind: 'urdf-link-fragment-update',
      skipReason: null,
    },
  };
}


function reset() {
  const workspace = createSingleComponentWorkspace(robot('before'), {
    componentId: 'arm',
    sourceFile: 'library/arm.urdf',
  });
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  const initialDraft = createComponentSourceDraft({
    componentId: 'arm',
    format: 'urdf',
    content: '<robot name="before"/>',
    robot: workspace.components.arm.robot,
  });
  useAssetsStore.setState({
    availableFiles: [{
      name: 'library/arm.urdf',
      format: 'urdf',
      content: '<robot name="immutable-template"/>',
    }],
    componentSourceDrafts: { arm: initialDraft },
  });
  setRegressionEditableSourceApplyResult(null);
  return { workspace, initialDraft, revision: useWorkspaceStore.getState().revision };
}

test('prepared full-source apply atomically replaces target robot and matching draft', () => {
  const { revision } = reset();
  const nextRobot = robot('after');
  const nextDraft = createComponentSourceDraft({
    componentId: 'arm',
    format: 'urdf',
    content: '<robot name="after"/>',
    robot: nextRobot,
  });

  assert.equal(commitPreparedComponentSourceApply({
    componentId: 'arm',
    expectedWorkspaceRevision: revision,
    robot: nextRobot,
    draft: nextDraft,
  }), true);
  assert.equal(useWorkspaceStore.getState().workspace.components.arm.robot.name, 'after');
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts.arm, nextDraft);
  assert.equal(
    useAssetsStore.getState().availableFiles[0].content,
    '<robot name="immutable-template"/>',
  );
});

test('invalid prepared result changes neither canonical workspace nor draft', () => {
  const { revision, initialDraft } = reset();
  const nextRobot = robot('invalid');
  const invalidDraft = {
    ...createComponentSourceDraft({
      componentId: 'arm',
      format: 'urdf',
      content: '<robot name="invalid"/>',
      robot: nextRobot,
    }),
    robotSnapshotHash: 'corrupt',
  };

  assert.equal(commitPreparedComponentSourceApply({
    componentId: 'arm',
    expectedWorkspaceRevision: revision,
    robot: nextRobot,
    draft: invalidDraft,
  }), false);
  assert.equal(useWorkspaceStore.getState().workspace.components.arm.robot.name, 'before');
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts.arm, initialDraft);
});

test('late revision loses CAS and cannot commit workspace or draft', () => {
  const { revision, initialDraft } = reset();
  const nextRobot = robot('late');
  const nextDraft = createComponentSourceDraft({
    componentId: 'arm',
    format: 'urdf',
    content: '<robot name="late"/>',
    robot: nextRobot,
  });
  useWorkspaceStore.getState().renameWorkspace('concurrent edit');

  assert.equal(commitPreparedComponentSourceApply({
    componentId: 'arm',
    expectedWorkspaceRevision: revision,
    robot: nextRobot,
    draft: nextDraft,
  }), false);
  assert.equal(useWorkspaceStore.getState().workspace.components.arm.robot.name, 'before');
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts.arm, initialDraft);
});

test('source-only text edit can refresh a matching draft without adding workspace history', () => {
  const { revision } = reset();
  const currentRobot = useWorkspaceStore.getState().workspace.components.arm.robot;
  const nextDraft = createComponentSourceDraft({
    componentId: 'arm',
    format: 'urdf',
    content: '<!-- comment --><robot name="before"/>',
    robot: currentRobot,
  });
  const historyCount = useWorkspaceStore.getState().history.past.length;

  assert.equal(commitPreparedComponentSourceApply({
    componentId: 'arm',
    expectedWorkspaceRevision: revision,
    robot: currentRobot,
    draft: nextDraft,
  }), true);
  assert.equal(useWorkspaceStore.getState().revision, revision);
  assert.equal(useWorkspaceStore.getState().history.past.length, historyCount);
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts.arm, nextDraft);
});

test('material source apply hashes the same normalized robot committed to the component', () => {
  const { revision } = reset();
  const parsedRobot = robot('material_robot');
  parsedRobot.links.base.visual = {
    ...parsedRobot.links.base.visual,
    color: '#ffffff',
  };
  parsedRobot.materials = { base: { color: '#123456' } };
  const normalizedRobot = normalizeComponentRobot(parsedRobot);
  const draft = createComponentSourceDraft({
    componentId: 'arm',
    format: 'urdf',
    content: '<robot name="material_robot"><material name="base" /></robot>',
    robot: normalizedRobot,
  });

  assert.equal(commitPreparedComponentSourceApply({
    componentId: 'arm',
    expectedWorkspaceRevision: revision,
    robot: parsedRobot,
    draft,
  }), true);
  const committedRobot = useWorkspaceStore.getState().workspace.components.arm.robot;
  const committedDraft = useAssetsStore.getState().componentSourceDrafts.arm;
  assert.equal(committedRobot.links.base.visual.color, '#123456');
  assert.equal(committedDraft.robotSnapshotHash, createSourceSemanticRobotHash(committedRobot));
});

test('editable source apply sends dirty ranges and commits an incremental patch', async () => {
  const { initialDraft, revision } = reset();
  const calls: ApplyEditableSourceChangeOptions[] = [];

  const applied = await applyPreparedEditableSourceCodeChange({
    allFileContents: { 'library/arm.urdf': initialDraft.content },
    applyEditableSourceChange: async (options) => {
      calls.push(options);
      return incrementalLinkResult();
    },
    applyRequest: { dirtyRanges: [{ startOffset: 8, endOffset: 20 }] },
    availableFiles: useAssetsStore.getState().availableFiles,
    componentId: 'arm',
    draft: initialDraft,
    expectedWorkspaceRevision: revision,
    robot: useWorkspaceStore.getState().workspace.components.arm.robot,
    sourceFileName: 'library/arm.urdf',
    newCode: '<robot name="before"><link name="base"/></robot>',
  });

  assert.equal(applied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].previousContent, '<robot name="before"/>');
  assert.deepEqual(calls[0].dirtyRanges, [{ startOffset: 8, endOffset: 20 }]);
  assert.equal(calls[0].attemptIncrementalPatch, true);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.arm.robot.links.base.visual.dimensions.x,
    0.13,
  );
  assert.equal(regressionDebugState.lastEditableSourceApplyResult?.mode, 'incremental-patch');
  assert.equal(
    regressionDebugState.lastEditableSourceApplyResult?.patchKind,
    'urdf-link-fragment-update',
  );
});

test('editable source apply commits full parse diagnostics when no patch is available', async () => {
  const { initialDraft, revision } = reset();

  const applied = await applyPreparedEditableSourceCodeChange({
    allFileContents: { 'library/arm.urdf': initialDraft.content },
    applyEditableSourceChange: async () => ({
      mode: 'full-parse',
      state: robotState('full'),
      diagnostics: {
        attempted: true,
        dirtyRangeCount: 1,
        dirtySpanBytes: 9000,
        dirtySpanLimitBytes: 128,
        patchKind: null,
        skipReason: 'dirty-span-too-large',
      },
    }),
    applyRequest: { dirtyRanges: [{ startOffset: 0, endOffset: 9000 }] },
    availableFiles: useAssetsStore.getState().availableFiles,
    componentId: 'arm',
    draft: initialDraft,
    expectedWorkspaceRevision: revision,
    robot: useWorkspaceStore.getState().workspace.components.arm.robot,
    sourceFileName: 'library/arm.urdf',
    newCode: '<robot name="full"/>',
  });

  assert.equal(applied, true);
  assert.equal(useWorkspaceStore.getState().workspace.components.arm.robot.name, 'full');
  assert.equal(regressionDebugState.lastEditableSourceApplyResult?.mode, 'full-parse');
  assert.equal(regressionDebugState.lastEditableSourceApplyResult?.skipReason, 'dirty-span-too-large');
});

test('editable source apply falls back to full parse when local incremental apply fails', async () => {
  const { initialDraft, revision } = reset();
  let callCount = 0;

  const applied = await applyPreparedEditableSourceCodeChange({
    allFileContents: { 'library/arm.urdf': initialDraft.content },
    applyEditableSourceChange: async () => {
      callCount += 1;
      if (callCount === 1) {
        return missingLinkIncrementalResult();
      }
      return {
        mode: 'full-parse',
        state: robotState('fallback-full'),
        diagnostics: {
          attempted: false,
          dirtyRangeCount: 1,
          dirtySpanBytes: 12,
          dirtySpanLimitBytes: 128,
          patchKind: null,
          skipReason: 'incremental-patch-not-requested',
        },
      };
    },
    applyRequest: { dirtyRanges: [{ startOffset: 8, endOffset: 20 }] },
    availableFiles: useAssetsStore.getState().availableFiles,
    componentId: 'arm',
    draft: initialDraft,
    expectedWorkspaceRevision: revision,
    robot: useWorkspaceStore.getState().workspace.components.arm.robot,
    sourceFileName: 'library/arm.urdf',
    newCode: '<robot name="fallback-full"/>',
  });

  assert.equal(applied, true);
  assert.equal(callCount, 2);
  assert.equal(useWorkspaceStore.getState().workspace.components.arm.robot.name, 'fallback-full');
  assert.equal(regressionDebugState.lastEditableSourceApplyResult?.mode, 'full-parse');
  assert.equal(
    regressionDebugState.lastEditableSourceApplyResult?.skipReason,
    'incremental-patch-apply-failed',
  );
});

test('editable source apply ignores stale worker results before committing', async () => {
  const { initialDraft, revision } = reset();

  const applied = await applyPreparedEditableSourceCodeChange({
    allFileContents: { 'library/arm.urdf': initialDraft.content },
    applyEditableSourceChange: async () => incrementalLinkResult(),
    availableFiles: useAssetsStore.getState().availableFiles,
    componentId: 'arm',
    draft: initialDraft,
    expectedWorkspaceRevision: revision,
    isCurrentRequest: () => false,
    robot: useWorkspaceStore.getState().workspace.components.arm.robot,
    sourceFileName: 'library/arm.urdf',
    newCode: '<robot name="before"><link name="base"/></robot>',
  });

  assert.equal(applied, false);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.arm.robot.links.base.visual.dimensions.x,
    0.05,
  );
  assert.equal(regressionDebugState.lastEditableSourceApplyResult, null);
});
