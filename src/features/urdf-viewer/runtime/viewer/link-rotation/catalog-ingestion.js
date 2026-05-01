import { getRootPathFromLinkPath, isControllableRevoluteJointTypeName, normalizeLimits, pickRuntimeParentLinkPath, resolveRuntimeLinkPathsFromSourcePath, rotateAxisByQuaternion, extractJointRecordsFromLayerText, } from "./shared.js";
export function ingestJointCatalogFromStage(controller, stage, layerText, fallbackRootPaths, runtimeLinkPathIndex) {
    if (!stage)
        return 0;
    const jointRecords = extractJointRecordsFromLayerText(layerText);
    if (jointRecords.length === 0)
        return 0;
    void fallbackRootPaths;
    let imported = 0;
    for (const jointRecord of jointRecords) {
        if (jointRecord.closedLoopType) {
            continue;
        }
        if (!jointRecord.body1Path)
            continue;
        const linkPaths = resolveRuntimeLinkPathsFromSourcePath(jointRecord.body1Path, runtimeLinkPathIndex);
        if (linkPaths.length === 0)
            continue;
        for (const linkPath of linkPaths) {
            if (!linkPath)
                continue;
            const preferredRootPath = getRootPathFromLinkPath(linkPath);
            const parentCandidates = resolveRuntimeLinkPathsFromSourcePath(jointRecord.body0Path, runtimeLinkPathIndex, preferredRootPath);
            const parentLinkPath = pickRuntimeParentLinkPath(parentCandidates, preferredRootPath);
            controller.linkParentPathByLinkPath.set(linkPath, parentLinkPath);
            if (!isControllableRevoluteJointTypeName(jointRecord.jointTypeName)) {
                continue;
            }
            const jointPath = preferredRootPath
                ? `${preferredRootPath}/joints/${jointRecord.jointName}`
                : `/joints/${jointRecord.jointName}`;
            const axisToken = jointRecord.axisToken;
            const axisLocal = jointRecord.axisLocal ? jointRecord.axisLocal.clone() : rotateAxisByQuaternion(axisToken, jointRecord.localRot1);
            const limits = normalizeLimits(jointRecord.lowerLimitDeg, jointRecord.upperLimitDeg);
            const localPivotInLink = jointRecord.localPos1 ? jointRecord.localPos1.clone() : null;
            controller.applyJointCatalogEntry({
                linkPath,
                jointPath,
                parentLinkPath,
                axisToken,
                axisLocal,
                lowerLimitDeg: limits.lower,
                upperLimitDeg: limits.upper,
                ...(Number.isFinite(Number(jointRecord.angleDeg)) ? { angleDeg: Number(jointRecord.angleDeg) } : {}),
                localPivotInLink,
            });
            imported++;
        }
    }
    return imported;
}
