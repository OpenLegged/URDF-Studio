import type { RobotData } from '@/types';
import { collectXmlElementBounds, getElementAttribute } from '@/app/hooks/source-preserving-export/xmlSourcePatch';
import { tryGenerateEditableRobotSource } from './generateEditableRobotSource';
import {
  asSdfRobotState,
  findGeneratedSdfModel,
  findSourceSdfModel,
  getSdfJointOriginRepresentation,
  patchControlledSdfModelSections,
  patchSdfFineGrainedAttributes,
  patchSdfLinkNodes,
  patchSdfModelEntities,
  patchSdfModelOpenTag,
  validateSdfCandidate,
  type SdfEditableSourceReconcileLevel as SdfEditableSourceReconcileLevelValue,
} from './sdfEditableSourceReconcilerHelpers';

export interface ReconcileSdfEditableSourceOptions {
  sourceContent: string;
  beforeRobot: RobotData;
  afterRobot: RobotData;
  sourceFileName: string;
}

export type SdfEditableSourceReconcileLevel = SdfEditableSourceReconcileLevelValue;

export type ReconcileSdfEditableSourceResult =
  | { status: 'patched'; content: string; level: SdfEditableSourceReconcileLevel }
  | { status: 'unsafe'; reason: string };

function unsafe(reason: string): ReconcileSdfEditableSourceResult {
  return { status: 'unsafe', reason };
}

/**
 * Reconcile SDF editable source without replacing the whole document. The
 * patch grows from model/entity attributes to direct link child nodes, then
 * link/joint entities, then controlled model sections; every candidate is
 * parsed and semantically checked before being returned.
 */
export function reconcileSdfEditableSource({
  sourceContent,
  beforeRobot,
  afterRobot,
  sourceFileName,
}: ReconcileSdfEditableSourceOptions): ReconcileSdfEditableSourceResult {
  try {
    const sourceRoot = collectXmlElementBounds(sourceContent).find((element) => element.tagName === 'sdf');
    const sdfVersion = sourceRoot ? getElementAttribute(sourceContent, sourceRoot, 'version') ?? undefined : undefined;
    const requiresWorldPoses = /^1\.[0-6]$/.test(sdfVersion ?? '');
    const beforeRepresentation = requiresWorldPoses ? getSdfJointOriginRepresentation(
      sourceFileName,
      tryGenerateEditableRobotSource({ format: 'sdf', robotState: asSdfRobotState(beforeRobot), sdfVersion }),
      beforeRobot,
    ) : null;
    if (!validateSdfCandidate(sourceFileName, sourceContent, beforeRobot, beforeRepresentation)) {
      return unsafe('The editable SDF source no longer matches the robot before this mutation.');
    }

    const generatedContent = tryGenerateEditableRobotSource({
      format: 'sdf',
      robotState: asSdfRobotState(afterRobot),
      sdfVersion,
    });
    if (generatedContent === null) {
      return unsafe('The robot mutation does not currently have a lossless SDF source representation.');
    }
    const afterRepresentation = requiresWorldPoses
      ? getSdfJointOriginRepresentation(sourceFileName, generatedContent, afterRobot)
      : null;
    const generatedModel = findGeneratedSdfModel(generatedContent);
    const sourceModel = findSourceSdfModel(sourceContent, beforeRobot.name);
    if (!generatedModel || !sourceModel) {
      return unsafe('Cannot safely locate the SDF model to patch.');
    }

    const patched = patchSdfModelOpenTag(
      sourceContent,
      sourceModel.bounds,
      generatedModel.bounds,
      generatedContent,
    );
    if (!findSourceSdfModel(patched, afterRobot.name)) {
      return unsafe('Cannot re-locate the SDF model after model-name patching.');
    }

    const attributePatched = patchSdfFineGrainedAttributes(
      patched,
      beforeRobot,
      afterRobot,
    );
    if (validateSdfCandidate(sourceFileName, attributePatched, afterRobot, afterRepresentation)) {
      return { status: 'patched', content: attributePatched, level: 'attribute' };
    }

    const nodePatched = patchSdfLinkNodes({
      sourceContent: attributePatched,
      generatedContent,
      beforeRobot,
      afterRobot,
    });
    if (
      nodePatched !== attributePatched &&
      validateSdfCandidate(sourceFileName, nodePatched, afterRobot, afterRepresentation)
    ) {
      return { status: 'patched', content: nodePatched, level: 'node' };
    }

    const entitySourceModel = findSourceSdfModel(nodePatched, afterRobot.name);
    if (!entitySourceModel) {
      return unsafe('Cannot re-locate the SDF model before entity patching.');
    }
    const entityPatched = patchSdfModelEntities({
      sourceContent: nodePatched,
      sourceModel: entitySourceModel.bounds,
      generatedContent,
      generatedModel: generatedModel.bounds,
      beforeRobot,
      afterRobot,
    });
    if (validateSdfCandidate(sourceFileName, entityPatched.content, afterRobot, afterRepresentation)) {
      return {
        status: 'patched',
        content: entityPatched.content,
        level: entityPatched.level,
      };
    }

    const latestSourceModel = findSourceSdfModel(nodePatched, afterRobot.name);
    if (!latestSourceModel) {
      return unsafe('Cannot re-locate the SDF model before section patching.');
    }
    const sectionPatched = patchControlledSdfModelSections({
      sourceContent: nodePatched,
      sourceModel: latestSourceModel.bounds,
      generatedContent,
      generatedModel: generatedModel.bounds,
    });
    if (!validateSdfCandidate(sourceFileName, sectionPatched, afterRobot, afterRepresentation)) {
      return unsafe('The patched SDF did not preserve the requested robot semantics.');
    }
    return { status: 'patched', content: sectionPatched, level: 'section' };
  } catch (error) {
    return unsafe(error instanceof Error ? error.message : 'SDF reconciliation failed.');
  }
}
