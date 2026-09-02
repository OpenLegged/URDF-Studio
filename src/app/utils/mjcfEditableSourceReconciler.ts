import type { RobotData } from '@/types';

import { generateEditableRobotSource } from './generateEditableRobotSource';
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
  expectedHash: string,
): boolean {
  const parsed = parseMJCFEditableSource(sourceFileName, content);
  return Boolean(parsed && mjcfSourceSemanticHash(parsed) === expectedHash);
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
    if (mjcfSourceSemanticHash(parsedSource) !== mjcfSourceSemanticHash(beforeRobot)) {
      return unsafe('The editable source no longer matches the robot before this mutation.');
    }
    if (mjcfEncodingMetadataChanged(beforeRobot, afterRobot)) {
      return unsafe('The mutation changes MJCF encoding metadata without a safe local patch.');
    }

    const generatedBefore = generateEditableRobotSource({
      format: 'mjcf',
      robotState: asMJCFRobotState(beforeRobot),
    });
    const generatedAfter = generateEditableRobotSource({
      format: 'mjcf',
      robotState: asMJCFRobotState(afterRobot),
    });
    const parsedGeneratedAfter = parseMJCFEditableSource(sourceFileName, generatedAfter);
    if (
      !parsedGeneratedAfter ||
      mjcfCoreSemanticHash(parsedGeneratedAfter) !== mjcfCoreSemanticHash(afterRobot)
    ) {
      return unsafe('The robot mutation cannot be represented losslessly as MJCF.');
    }
    const expectedHash = mjcfSourceSemanticHash(afterRobot);

    const attributeCandidate = applyMJCFAttributePatches(
      sourceContent,
      beforeRobot,
      afterRobot,
    );
    if (validateCandidate(sourceFileName, attributeCandidate, expectedHash)) {
      return { status: 'patched', content: attributeCandidate, level: 'attribute' };
    }

    const nodeCandidate = applyMJCFNodePatches(
      attributeCandidate,
      beforeRobot,
      afterRobot,
    );
    if (validateCandidate(sourceFileName, nodeCandidate, expectedHash)) {
      return { status: 'patched', content: nodeCandidate, level: 'node' };
    }

    const entityCandidate = applyMJCFEntityPatches({
      sourceContent: nodeCandidate,
      generatedContent: generatedAfter,
      beforeRobot,
      afterRobot,
    });
    if (validateCandidate(sourceFileName, entityCandidate, expectedHash)) {
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
      validateCandidate(sourceFileName, sectionCandidate, expectedHash)
    ) {
      return { status: 'patched', content: sectionCandidate, level: 'section' };
    }

    return unsafe('No source-preserving MJCF patch matched the requested robot semantics.');
  } catch (error) {
    return unsafe(error instanceof Error ? error.message : 'MJCF reconciliation failed.');
  }
}
