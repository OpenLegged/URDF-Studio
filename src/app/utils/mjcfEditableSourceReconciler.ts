import type { RobotData, RobotFile } from '@/types';

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
  availableFiles?: RobotFile[];
}

export type ReconcileMJCFEditableSourceResult =
  | { status: 'patched'; content: string; level: MJCFReconcileLevel }
  | { status: 'unsafe'; reason: string };

function validateCandidate(
  sourceFileName: string,
  content: string,
  expected: RobotData,
  availableFiles: RobotFile[],
): boolean {
  const parsed = parseMJCFEditableSource(sourceFileName, content, availableFiles);
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
 * Patch the component-owned MJCF source, resolving attachments against the
 * immutable source files. Every candidate must parse to the requested semantics;
 * edits that cannot be represented in this document defer to source draft sync.
 */
export function reconcileMJCFEditableSource({
  sourceContent,
  beforeRobot,
  afterRobot,
  sourceFileName,
  availableFiles = [],
}: ReconcileMJCFEditableSourceOptions): ReconcileMJCFEditableSourceResult {
  if (/<\s*include\b/i.test(sourceContent)) {
    return unsafe('MJCF sources with <include> require multi-file reconciliation.');
  }

  try {
    const parsedSource = parseMJCFEditableSource(sourceFileName, sourceContent, availableFiles);
    if (!parsedSource) return unsafe('The editable source is not valid MJCF.');
    if (!sourceMatches(parsedSource, beforeRobot, sourceContent)) {
      return unsafe('The editable source no longer matches the robot before this mutation.');
    }
    if (mjcfEncodingMetadataChanged(beforeRobot, afterRobot)) {
      return unsafe('The mutation changes MJCF encoding metadata without a safe local patch.');
    }

    let patchFailure: string | undefined;
    const attempt = (patch: () => string): string | null => {
      try {
        return patch();
      } catch (error) {
        // A shared geom or attached entity may require a wider patch. Keep the
        // authored text until a complete candidate passes semantic validation.
        patchFailure = error instanceof Error ? error.message : 'MJCF patch failed.';
        return null;
      }
    };
    const attributeCandidate = attempt(() => applyMJCFAttributePatches(
      sourceContent, beforeRobot, afterRobot,
    )) ?? sourceContent;
    if (validateCandidate(sourceFileName, attributeCandidate, afterRobot, availableFiles)) {
      return { status: 'patched', content: attributeCandidate, level: 'attribute' };
    }

    const nodeCandidate = attempt(() => applyMJCFNodePatches(
      attributeCandidate, beforeRobot, afterRobot,
    )) ?? attributeCandidate;
    if (validateCandidate(sourceFileName, nodeCandidate, afterRobot, availableFiles)) {
      return { status: 'patched', content: nodeCandidate, level: 'node' };
    }

    const generatedBefore = tryGenerateEditableRobotSource({
      format: 'mjcf', robotState: asMJCFRobotState(beforeRobot), sourceFileName,
    });
    const generatedAfter = tryGenerateEditableRobotSource({
      format: 'mjcf', robotState: asMJCFRobotState(afterRobot), sourceFileName,
    });
    if (generatedBefore === null || generatedAfter === null) {
      return unsafe('The robot mutation does not currently have a lossless MJCF source representation.');
    }
    // Generated entities are only patch material. Validate the complete candidate,
    // which retains the authored root, attachments and unrelated encoding metadata.
    const entityCandidate = attempt(() => applyMJCFEntityPatches({
      sourceContent: nodeCandidate, generatedContent: generatedAfter,
      beforeRobot, afterRobot,
    }));
    if (entityCandidate !== null
      && validateCandidate(sourceFileName, entityCandidate, afterRobot, availableFiles)) {
      return { status: 'patched', content: entityCandidate, level: 'entity' };
    }

    const sectionCandidate = attempt(() => applyMJCFSectionPatches({
      sourceContent: attributeCandidate, generatedBefore, generatedAfter,
      beforeRobot, afterRobot,
    }));
    if (
      sectionCandidate !== null && sectionCandidate !== sourceContent &&
      validateCandidate(sourceFileName, sectionCandidate, afterRobot, availableFiles)
    ) {
      return { status: 'patched', content: sectionCandidate, level: 'section' };
    }

    return unsafe(patchFailure ?? 'No source-preserving MJCF patch matched the requested robot semantics.');
  } catch (error) {
    return unsafe(error instanceof Error ? error.message : 'MJCF reconciliation failed.');
  }
}
