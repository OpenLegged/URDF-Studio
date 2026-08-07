function normalizeMetersPerUnit(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

export function extractStageMetersPerUnitFromLayerText(layerText) {
    if (!layerText || typeof layerText !== "string")
        return null;
    const metersPerUnitMatch = layerText.match(/\bmetersPerUnit\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    return normalizeMetersPerUnit(metersPerUnitMatch?.[1]);
}

export function resolveStageMetersPerUnit({ reportedMetersPerUnit = null, stage = null } = {}) {
    const normalizedReportedValue = normalizeMetersPerUnit(reportedMetersPerUnit);
    if (normalizedReportedValue !== null) {
        return normalizedReportedValue;
    }
    if (!stage || typeof stage.GetRootLayer !== "function") {
        return null;
    }
    try {
        const rootLayer = stage.GetRootLayer();
        const exported = rootLayer?.ExportToString?.();
        return extractStageMetersPerUnitFromLayerText(
            typeof exported === "string" ? exported : String(exported || ""),
        );
    }
    catch {
        return null;
    }
}

export function applyStageMetersPerUnitToRoot(root, options = {}) {
    const metersPerUnit = resolveStageMetersPerUnit(options) ?? 1;
    if (!root?.scale) {
        return metersPerUnit;
    }
    if (typeof root.scale.setScalar === "function") {
        root.scale.setScalar(metersPerUnit);
    }
    else {
        root.scale.x = metersPerUnit;
        root.scale.y = metersPerUnit;
        root.scale.z = metersPerUnit;
    }
    return metersPerUnit;
}
