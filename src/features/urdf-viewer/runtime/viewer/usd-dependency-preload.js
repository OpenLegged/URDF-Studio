import { getDirectoryFromVirtualPath, normalizeUsdPath } from "./path-utils.js";
import { inferUsdDependencyStemForPath } from "../../../../lib/robot-parser/usd/usdDependencyPathRules.js";

export function inferDependencyStemForUsdPath(stagePath, fileName) {
    return inferUsdDependencyStemForPath(stagePath, fileName);
}

export function getUsdDependencyExtension(stagePath) {
    const normalizedPath = String(stagePath || "").toLowerCase();
    if (normalizedPath.endsWith(".usda"))
        return ".usda";
    if (normalizedPath.endsWith(".usdc"))
        return ".usdc";
    return ".usd";
}

export function getUsdConfigurationMirrorPaths(stagePath, fileName) {
    const normalizedStagePath = normalizeUsdPath(stagePath);
    const normalizedFileName = String(fileName || "").trim();
    if (!normalizedStagePath || !normalizedFileName) {
        return {
            localConfigurationPath: "",
            sharedConfigurationPath: "",
        };
    }
    const rootDirectory = getDirectoryFromVirtualPath(normalizedStagePath);
    const configurationDirectory = rootDirectory.toLowerCase().endsWith("/configuration/")
        ? rootDirectory
        : normalizeUsdPath(`${rootDirectory}configuration/`);
    return {
        localConfigurationPath: normalizeUsdPath(`${configurationDirectory}${normalizedFileName}`),
        sharedConfigurationPath: normalizeUsdPath(`/configuration/${normalizedFileName}`),
    };
}

export function getUsdConfigurationMirrorPlan(stagePath, fileName, options = {}) {
    const { localConfigurationPath, sharedConfigurationPath } = getUsdConfigurationMirrorPaths(stagePath, fileName);
    const hasLocalVirtualFile = options?.hasLocalVirtualFile === true;
    const hasSharedVirtualFile = options?.hasSharedVirtualFile === true;
    return {
        localConfigurationPath,
        sharedConfigurationPath,
        shouldWriteLocalAlias: !!localConfigurationPath && !hasLocalVirtualFile,
        shouldWriteSharedAlias: !!sharedConfigurationPath
            && sharedConfigurationPath !== localConfigurationPath
            && !hasSharedVirtualFile,
    };
}

export function getUsdDependencySuffixesForStage(stagePath, dependencyStem, options = {}) {
    if (!dependencyStem) {
        return [];
    }
    const normalizedPath = normalizeUsdPath(stagePath).toLowerCase();
    const rootFileStem = normalizedPath.split("/").pop()?.replace(/\.usd[a-z]?$/i, "") || "";
    const includeSensorDependency = options?.includeSensorDependency === true;
    if (dependencyStem === "h1_2_handless") {
        return ["base", "physics", "robot"];
    }
    const suffixes = rootFileStem === dependencyStem && dependencyStem.endsWith("_description")
        ? ["base", "physics", "robot"]
        : ["base", "physics"];
    if (includeSensorDependency) {
        suffixes.push("sensor");
    }
    return suffixes;
}
