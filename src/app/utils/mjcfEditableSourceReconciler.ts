import type { RobotData } from '@/types';

import { alignMJCFJointLimitRoundoff } from './mjcfEditableSourceJointLimitRoundoff';
import { resolveMJCFSourceAngleUnit } from './mjcfEditableSourcePatchHelpers';
import { alignMJCFRotationRoundoff } from './mjcfEditableSourceRotation';
import { tryGenerateEditableRobotSource } from './generateEditableRobotSource';
import {
  applyMJCFAttributePatches,
  applyMJCFEntityPatches,
  applyMJCFNodePatches,
} from './mjcfEditableSourceReconcilerPatches';
import { applyMJCFSectionPatches } from './mjcfEditableSourceReconcilerSections';
import {
  asMJCFRobotState,
  mjcfCoreSemanticHash,
  mjcfEncodingMetadataChanged,
  mjcfSourceSemanticHash,
  parseMJCFEditableSource,
} from './mjcfEditableSourceReconcilerSemantics';

export type MJCFReconcileLevel = 'attribute' | 'node' | 'entity' | 'section';

export interface ReconcileMJCFEditableSourceOptions {
  sourceContent: string;
  beforeRobot: RobotData;
  afterRobot: RobotData;
  sourceFileName: string;
}

export type ReconcileMJCFEditableSourceResult =
  | { status: 'patched'; content: string; level: MJCFReconcileLevel }
  | { status: 'unsafe'; reason: string };

function validateCandidate(
  sourceFileName: string,
  content: string,
  expected: RobotData,
): boolean {
  const parsed = parseMJCFEditableSource(sourceFileName, content);
  return Boolean(parsed && sourceMatches(parsed, expected, content));
}

function sourceMatches(actual: RobotData, expected: RobotData, content: string): boolean {
  const aligned = resolveMJCFSourceAngleUnit(content) === 'degree'
    ? alignMJCFJointLimitRoundoff(actual, expected) : actual;
  return mjcfSourceSemanticHash(alignMJCFRotationRoundoff(aligned, expected))
    === mjcfSourceSemanticHash(expected);
}

function unsafe(reason: string): ReconcileMJCFEditableSourceResult {
  return { status: 'unsafe', reason };
}

/**
 * Reconcile a concrete, single-file MJCF source without replacing the complete
 * document. Every progressively wider candidate must parse to the requested
 * source semantics before it may be returned.
 */
export function reconcileMJCFEditableSource({
  sourceContent,
  beforeRobot,
  afterRobot,
  sourceFileName,
}: ReconcileMJCFEditableSourceOptions): ReconcileMJCFEditableSourceResult {
  if (/<\s*include\b/i.test(sourceContent)) {
    return unsafe('MJCF sources with <include> require multi-file reconciliation.');
  }

  try {
    const parsedSource = parseMJCFEditableSource(sourceFileName, sourceContent);
    if (!parsedSource) return unsafe('The editable source is not valid MJCF.');
    if (!sourceMatches(parsedSource, beforeRobot, sourceContent)) {
      return unsafe('The editable source no longer matches the robot before this mutation.');
    }
    if (mjcfEncodingMetadataChanged(beforeRobot, afterRobot)) {
      return unsafe('The mutation changes MJCF encoding metadata without a safe local patch.');
    }

    const generatedBefore = tryGenerateEditableRobotSource({
      format: 'mjcf',
      robotState: asMJCFRobotState(beforeRobot),
    });
    const generatedAfter = tryGenerateEditableRobotSource({
      format: 'mjcf',
      robotState: asMJCFRobotState(afterRobot),
    });
    if (generatedBefore === null || generatedAfter === null) {
      return unsafe('The robot mutation does not currently have a lossless MJCF source representation.');
    }
    const parsedGeneratedAfter = parseMJCFEditableSource(sourceFileName, generatedAfter);
    if (
      !parsedGeneratedAfter ||
      mjcfCoreSemanticHash(alignMJCFRotationRoundoff(parsedGeneratedAfter, afterRobot))
        !== mjcfCoreSemanticHash(afterRobot)
    ) {
      return unsafe('The robot mutation cannot be represented losslessly as MJCF.');
    }

    const attributeCandidate = applyMJCFAttributePatches(
      sourceContent,
      beforeRobot,
      afterRobot,
    );
    if (validateCandidate(sourceFileName, attributeCandidate, afterRobot)) {
      return { status: 'patched', content: attributeCandidate, level: 'attribute' };
    }

    const nodeCandidate = applyMJCFNodePatches(
      attributeCandidate,
      beforeRobot,
      afterRobot,
    );
    if (validateCandidate(sourceFileName, nodeCandidate, afterRobot)) {
      return { status: 'patched', content: nodeCandidate, level: 'node' };
    }

    const entityCandidate = applyMJCFEntityPatches({
      sourceContent: nodeCandidate,
      generatedContent: generatedAfter,
      beforeRobot,
      afterRobot,
    });
    if (validateCandidate(sourceFileName, entityCandidate, afterRobot)) {
      return { status: 'patched', content: entityCandidate, level: 'entity' };
    }

    const sectionCandidate = applyMJCFSectionPatches({
      sourceContent: attributeCandidate,
      generatedBefore,
      generatedAfter,
      beforeRobot,
      afterRobot,
    });
    if (
      sectionCandidate !== sourceContent &&
      validateCandidate(sourceFileName, sectionCandidate, afterRobot)
    ) {
      return { status: 'patched', content: sectionCandidate, level: 'section' };
    }

    return unsafe('No source-preserving MJCF patch matched the requested robot semantics.');
  } catch (error) {
    return unsafe(error instanceof Error ? error.message : 'MJCF reconciliation failed.');
  }
}
