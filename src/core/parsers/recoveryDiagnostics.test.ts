import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultWorkspace } from '@/core/robot/canonicalWorkspace';
import type { RobotData, RobotImportRecoveryDiagnostic } from '@/types';

import { attachParserRecoveryDiagnostics } from './recoveryDiagnostics.ts';

function createRobot(): RobotData {
  const workspace = createDefaultWorkspace('recovery_diagnostics');
  return structuredClone(Object.values(workspace.components)[0].robot);
}

const OMITTED_VISUAL: RobotImportRecoveryDiagnostic = {
  code: 'parser_visual_omitted',
  severity: 'warning',
  category: 'geometry',
  message: 'A malformed visual was omitted.',
  action: 'omitted',
  source: { tag: 'visual', name: 'bad_visual' },
};

test('attachParserRecoveryDiagnostics merges and deduplicates parser recovery facts', () => {
  const once = attachParserRecoveryDiagnostics(createRobot(), [OMITTED_VISUAL]);
  const twice = attachParserRecoveryDiagnostics(once, [OMITTED_VISUAL]);

  assert.equal(twice.inspectionContext?.recovery?.recoveredItemCount, 1);
  assert.equal(twice.inspectionContext?.recovery?.diagnosticCounts.warning, 1);
  assert.deepEqual(
    twice.inspectionContext?.recovery?.diagnostics.map((diagnostic) => diagnostic.code),
    ['parser_visual_omitted'],
  );
});

test('attachParserRecoveryDiagnostics preserves existing unretained diagnostic counts', () => {
  const robot = createRobot();
  robot.inspectionContext = {
    sourceFormat: 'urdf',
    recovery: {
      diagnostics: [],
      diagnosticCounts: { error: 0, warning: 3, info: 0 },
      recoveredItemCount: 3,
      omittedDiagnosticCount: 3,
    },
  };

  const merged = attachParserRecoveryDiagnostics(robot, [OMITTED_VISUAL]);

  assert.equal(merged.inspectionContext?.recovery?.recoveredItemCount, 4);
  assert.equal(merged.inspectionContext?.recovery?.diagnosticCounts.warning, 4);
  assert.equal(merged.inspectionContext?.recovery?.omittedDiagnosticCount, 3);
});
