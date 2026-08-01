// @ts-ignore runtime cache-busting query suffix is resolved by browser ESM loader.
import { ThreeRenderDelegateInterface } from "../hydra/ThreeJsRenderDelegate.js";
import { collectCameraFitSelection, fitCameraToSelection, scheduleCameraRefit } from "./camera.js";
import { getUsdConfigurationMirrorPlan, getUsdDependencyExtension, getUsdDependencySuffixesForStage, inferDependencyStemForUsdPath } from "./usd-dependency-preload.js";
import { getDirectoryFromVirtualPath, isLikelyNonRenderableUsdConfig, normalizeUsdPath, parseBooleanFlag } from "./path-utils.js";
import { applyStageAxisAlignmentToRoot } from "./stage-up-axis.js";
import { applyStageMetersPerUnitToRoot } from "./stage-meters-per-unit.js";
import { getTextureLoadProgress, waitForTextureLoadReady } from "./usd-loader-progress.js";
const COLLISION_SEGMENT_PATTERN = /(?:^|\/)coll(?:isions?|iders?)(?:$|[/.])/i;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function nextAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
async function yieldToMainThread(minDelayMs = 0) {
    if (minDelayMs > 0) {
        await sleep(minDelayMs);
        return;
    }
    await nextAnimationFrame();
}
function hasDeterminateProgressCounts(loadedCount, totalCount) {
    const safeLoadedCount = Number.isFinite(loadedCount) ? Math.max(0, Math.floor(loadedCount)) : null;
    const safeTotalCount = Number.isFinite(totalCount) ? Math.max(0, Math.floor(totalCount)) : null;
    return safeLoadedCount !== null && safeTotalCount !== null && safeTotalCount > 0;
}
function resolveProgressMode({ phase, progressMode, loadedCount, totalCount, progressPercent, }) {
    if (progressMode === "count" || progressMode === "percent" || progressMode === "indeterminate") {
        return progressMode;
    }
    if (phase === "streaming-meshes" && hasDeterminateProgressCounts(loadedCount, totalCount)) {
        return "count";
    }
    if (phase === "ready" && Number.isFinite(progressPercent)) {
        return "percent";
    }
    return "indeterminate";
}
function getMeshLoadStats(renderInterface) {
    const meshes = renderInterface?.meshes || {};
    const entries = Object.entries(meshes);
    let total = 0;
    let ready = 0;
    let collisions = 0;
    let visuals = 0;
    const shouldCountMesh = (id, mesh) => {
        const normalizedId = String(id || "");
        if (!normalizedId)
            return false;
        const positionCount = Number(mesh?._mesh?.geometry?.getAttribute?.("position")?.count || 0);
        if (positionCount > 0)
            return true;
        if (normalizedId.includes(".proto_"))
            return true;
        const isTopLevelPlaceholderMesh = /^\/(?:meshes|visuals|coll(?:isions?|iders?))\//i.test(normalizedId);
        if (!isTopLevelPlaceholderMesh)
            return true;
        const resolvedPath = renderInterface?.getResolvedPrimPathForMeshId?.(normalizedId)
            || renderInterface?.getResolvedVisualTransformPrimPathForMeshId?.(normalizedId)
            || null;
        return !!resolvedPath;
    };
    for (const [id, mesh] of entries) {
        if (!shouldCountMesh(String(id || ""), mesh))
            continue;
        total += 1;
        const geometry = mesh?._mesh?.geometry;
        const positionAttribute = geometry?.getAttribute?.("position");
        if (positionAttribute && positionAttribute.count > 0)
            ready++;
        if (COLLISION_SEGMENT_PATTERN.test(id))
            collisions++;
        else
            visuals++;
    }
    return {
        total,
        ready,
        collisions,
        visuals,
    };
}
async function ensureRootPathIsLoadable(pathToLoad, usdFsHelper) {
    if (!pathToLoad)
        return false;
    if (/^[a-z]+:\/\//i.test(pathToLoad))
        return true;
    if (usdFsHelper.hasVirtualFilePath(pathToLoad))
        return true;
    if (!pathToLoad.startsWith("/"))
        return true;
    if (pathToLoad.toLowerCase().startsWith("/unitree_model/"))
        return true;
    if (pathToLoad.toLowerCase().startsWith("/piper_isaac_sim/"))
        return true;
    try {
        const response = await fetch(pathToLoad, { method: "HEAD" });
        return response.ok;
    }
    catch {
        return false;
    }
}
export async function loadUsdStage(args) {
    const { USD, usdFsHelper, messageLog, progressBar, progressLabel, showLoadUi = true, readStageMetadata, loadCollisionPrims, loadVisualPrims: requestedLoadVisualPrims, loadPassLabel, params, displayName, pathToLoad, isLoadActive, debugFileHandling = false, onResolvedFilename, applyMeshFilters, rebuildLinkAxes, renderFrame, onProgress, } = args;
    const nonBlockingLoad = parseBooleanFlag(params.get("nonBlockingLoad"), false);
    const fastLoad = parseBooleanFlag(params.get("fastLoad"), true);
    const forceDependencyPreload = parseBooleanFlag(params.get("forceDependencyPreload"), false);
    const autoLoadDependencies = parseBooleanFlag(params.get("autoLoadDependencies"), true);
    const dependenciesPreloadedToVirtualFs = parseBooleanFlag(params.get("dependenciesPreloadedToVirtualFs"), false);
    const strictOneShot = parseBooleanFlag(params.get("strictOneShot"), !nonBlockingLoad);
    const yieldDuringLoad = parseBooleanFlag(params.get("yieldDuringLoad"), true);
    const normalizedPathForDependencyDefaults = String(pathToLoad || "").toLowerCase();
    const isConfigurationUsdPath = normalizedPathForDependencyDefaults.includes("/configuration/");
    const inferredSkipSensorPayloadsOnOpen = (!isConfigurationUsdPath
        && (normalizedPathForDependencyDefaults.includes("/unitree_model/")
            || normalizedPathForDependencyDefaults.includes("/robots/")));
    const hasExplicitIncludeSensorDependency = params.has("includeSensorDependency");
    const includeSensorDependencyFallback = hasExplicitIncludeSensorDependency
        ? parseBooleanFlag(params.get("includeSensorDependency"), false)
        : !inferredSkipSensorPayloadsOnOpen;
    const skipSensorPayloadsOnOpen = parseBooleanFlag(params.get("skipSensorPayloadsOnOpen"), hasExplicitIncludeSensorDependency
        ? !includeSensorDependencyFallback
        : inferredSkipSensorPayloadsOnOpen);
    const defaultIncludeSensorDependency = normalizedPathForDependencyDefaults.includes("/unitree_model/")
        || normalizedPathForDependencyDefaults.includes("/robots/");
    const includeSensorDependency = parseBooleanFlag(params.get("includeSensorDependency"), skipSensorPayloadsOnOpen ? false : defaultIncludeSensorDependency);
    const warmupRuntimeBridge = parseBooleanFlag(params.get("warmupRuntimeBridge"), !nonBlockingLoad);
    const robotSceneSnapshotBeforeDraw = parseBooleanFlag(params.get("robotSceneSnapshotBeforeDraw"), false);
    const skipHydraFullDrawForRobotSceneSnapshot = parseBooleanFlag(params.get("skipHydraFullDrawForRobotSceneSnapshot"), false);
    const skipHydraPopulateForRobotSceneSnapshot = parseBooleanFlag(params.get("skipHydraPopulateForRobotSceneSnapshot"), false);
    const disableStageLayerTextFallbacks = parseBooleanFlag(params.get("disableStageLayerTextFallbacks"), false);
    const warmupRuntimeBridgeBeforeDraw = robotSceneSnapshotBeforeDraw;
    const warmupRobotMetadata = true;
    const resolveRobotMetadataBeforeReady = parseBooleanFlag(params.get("resolveRobotMetadataBeforeReady"), !nonBlockingLoad);
    const requireCompleteRobotMetadata = parseBooleanFlag(params.get("requireCompleteRobotMetadata"), !nonBlockingLoad);
    const disableCameraAutoFit = parseBooleanFlag(params.get("disableCameraAutoFit"), false);
    const maxCpuDraw = parseBooleanFlag(params.get("maxCpuDraw"), false);
    // Favor full-scene readiness during the loading phase to avoid long tail mesh hydration.
    const aggressiveInitialDraw = parseBooleanFlag(params.get("aggressiveInitialDraw"), !nonBlockingLoad);
    const drawBurstRenderEveryDraw = parseBooleanFlag(params.get("drawBurstRenderEveryDraw"), aggressiveInitialDraw);
    const hardwareConcurrency = Number(navigator?.hardwareConcurrency || 4);
    const defaultThreadHint = 4;
    const requestedThreadHint = Number(params.get("threads"));
    const inferredThreadHint = Number.isFinite(requestedThreadHint) && requestedThreadHint > 0
        ? Math.floor(requestedThreadHint)
        : defaultThreadHint;
    const initialDrawBurst = (() => {
        const requested = Number(params.get("initialDrawBurst"));
        const baselineBurst = maxCpuDraw
            ? Math.max(2, Math.min(16, inferredThreadHint))
            : 1;
        // Keep fast-load interactive: large draw bursts can monopolize the main
        // thread right after the first visible frame.
        const aggressiveBurst = maxCpuDraw
            ? Math.max(2, Math.min(24, inferredThreadHint * 2))
            : Math.max(2, Math.min(8, inferredThreadHint));
        const fallback = aggressiveInitialDraw
            ? Math.max(baselineBurst, aggressiveBurst)
            : baselineBurst;
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(1, Math.min(128, Math.floor(requested)));
    })();
    const initialDrawBudgetMs = (() => {
        const requested = Number(params.get("initialDrawBudgetMs"));
        const fallback = aggressiveInitialDraw
            ? (maxCpuDraw ? 2800 : 2200)
            : (maxCpuDraw ? 1200 : 700);
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0, Math.min(60000, Math.floor(requested)));
    })();
    const finalSceneDrainBudgetMs = (() => {
        const requested = Number(params.get("finalSceneDrainBudgetMs"));
        const fallback = strictOneShot
            ? (maxCpuDraw ? 12000 : 8000)
            : initialDrawBudgetMs;
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0, Math.min(120000, Math.floor(requested)));
    })();
    const initialDrawYieldMs = (() => {
        const requested = Number(params.get("initialDrawYieldMs"));
        const fallback = aggressiveInitialDraw ? 1 : 8;
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0, Math.min(1000, Math.floor(requested)));
    })();
    const initialDrawTargetReadyRatio = (() => {
        const requested = Number(params.get("initialDrawTargetReadyRatio"));
        const fallback = aggressiveInitialDraw
            ? 0.98
            : (maxCpuDraw ? 0.9 : 0.85);
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0.1, Math.min(1, requested));
    })();
    const loadVisualPrims = typeof requestedLoadVisualPrims === "boolean"
        ? requestedLoadVisualPrims
        : parseBooleanFlag(params.get("loadVisualPrims"), true);
    const maxVisualPrimsRaw = params.get("maxVisualPrims");
    let maxVisualPrims;
    if (maxVisualPrimsRaw !== null && maxVisualPrimsRaw !== "") {
        const parsedMaxVisualPrims = Number(maxVisualPrimsRaw);
        if (Number.isFinite(parsedMaxVisualPrims)) {
            maxVisualPrims = Math.max(0, Math.floor(parsedMaxVisualPrims));
        }
    }
    const profileLoad = parseBooleanFlag(params.get("profileLoad"), false);
    const profileTextureLoads = parseBooleanFlag(params.get("profileTextureLoads"), false)
        || parseBooleanFlag(params.get("profileHydraPhases"), false);
    const eagerRenderDuringLoad = parseBooleanFlag(params.get("eagerRenderDuringLoad"), true);
    const eagerRenderEveryDraw = parseBooleanFlag(params.get("eagerRenderEveryDraw"), false);
    // Force-enable proto blob fast path for performance triage.
    const enableProtoBlobFastPath = true;
    const profileStartTime = (typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now()
        : Date.now();
    const profileMarks = [];
    const callbackProfileByName = new Map();
    let driver = null;
    let lastRuntimeBridgeWarmupSummary = null;
    let profileTargetState = null;
    const profileNow = () => ((typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now()
        : Date.now());
    const markLoadPhase = (label) => {
        if (!profileLoad)
            return;
        const now = profileNow();
        profileMarks.push({
            label,
            ms: Math.round((now - profileStartTime) * 10) / 10,
        });
    };
    const addCallbackSample = (name, durationMs) => {
        if (!profileLoad)
            return;
        const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
        const existing = callbackProfileByName.get(name) || { count: 0, totalMs: 0, maxMs: 0 };
        existing.count += 1;
        existing.totalMs += safeDuration;
        existing.maxMs = Math.max(existing.maxMs, safeDuration);
        callbackProfileByName.set(name, existing);
    };
    const summarizeProfileObject = (value) => {
        if (!value || typeof value !== "object")
            return null;
        try {
            return Object.fromEntries(Object.entries(value));
        }
        catch {
            return null;
        }
    };
    const refreshNativeDriverProfiles = () => {
        let driverInitProfile = null;
        let robotSceneSnapshotProfile = null;
        try {
            driverInitProfile = typeof driver?.GetLastInitProfile === "function"
                ? summarizeProfileObject(driver.GetLastInitProfile())
                : null;
        }
        catch {
            driverInitProfile = null;
        }
        try {
            robotSceneSnapshotProfile = typeof driver?.GetLastRobotSceneSnapshotProfile === "function"
                ? summarizeProfileObject(driver.GetLastRobotSceneSnapshotProfile())
                : null;
        }
        catch {
            robotSceneSnapshotProfile = null;
        }
        try {
            if (profileTargetState && typeof profileTargetState === "object") {
                profileTargetState.driverInitProfile = driverInitProfile;
                profileTargetState.robotSceneSnapshotProfile = robotSceneSnapshotProfile;
            }
        }
        catch {
        }
        return { driverInitProfile, robotSceneSnapshotProfile };
    };
    const flushLoadProfile = (status) => {
        if (!profileLoad)
            return;
        markLoadPhase(`end:${status}`);
        const callbackProfile = Array.from(callbackProfileByName.entries())
            .map(([name, sample]) => ({
            name,
            count: Number(sample.count || 0),
            totalMs: Math.round(Number(sample.totalMs || 0) * 10) / 10,
            maxMs: Math.round(Number(sample.maxMs || 0) * 10) / 10,
        }))
            .sort((left, right) => right.totalMs - left.totalMs)
            .slice(0, 64);
        const { driverInitProfile, robotSceneSnapshotProfile } = refreshNativeDriverProfiles();
        try {
            const loadProfile = {
                status,
                normalizedPath: typeof normalizedPath === "string" ? normalizedPath : null,
                totalMs: Math.round((profileNow() - profileStartTime) * 10) / 10,
                marks: profileMarks.slice(),
                callbackProfile,
                driverInitProfile,
                robotSceneSnapshotProfile,
                runtimeBridgeWarmupSummary: lastRuntimeBridgeWarmupSummary
                    ? { ...lastRuntimeBridgeWarmupSummary }
                    : null,
                hydraPhaseProfile: window.renderInterface?.getHydraPhasePerfSnapshot?.() || null,
                meshStats: getMeshLoadStats(window.renderInterface),
            };
            window.__usdLoadProfile = loadProfile;
            if (state && typeof state === "object") {
                state.usdLoadProfile = loadProfile;
            }
        }
        catch {
            // Keep profiling best-effort; load completion must not depend on diagnostics.
        }
    };
    let eagerRenderCount = 0;
    const runEagerRender = (_phaseLabel, options = {}) => {
        if (!eagerRenderDuringLoad)
            return;
        if (typeof renderFrame !== "function")
            return;
        const forceRender = !!options.forceRender;
        if (!forceRender && !eagerRenderEveryDraw && eagerRenderCount > 0)
            return;
        const renderStart = profileNow();
        try {
            renderFrame();
            eagerRenderCount += 1;
        }
        catch {
            // Keep eager rendering best-effort and silent in hot paths.
        }
    };
    const isLoadStillActive = () => {
        if (typeof isLoadActive !== "function")
            return true;
        try {
            return isLoadActive();
        }
        catch {
            return false;
        }
    };
    let currentProgress = 0;
    let currentProgressPhase = "checking-path";
    let currentProgressMessage = null;
    let currentLoadedCount = null;
    let currentTotalCount = null;
    let currentProgressMode = "indeterminate";
    const emitProgress = (patch = {}) => {
        if (!isLoadStillActive())
            return;
        if (typeof onProgress !== "function")
            return;
        if (Object.prototype.hasOwnProperty.call(patch, "phase")) {
            currentProgressPhase = patch.phase || currentProgressPhase;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "message")) {
            currentProgressMessage = patch.message ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "loadedCount")) {
            currentLoadedCount = Number.isFinite(patch.loadedCount) ? Math.max(0, Math.floor(patch.loadedCount)) : null;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "totalCount")) {
            currentTotalCount = Number.isFinite(patch.totalCount) ? Math.max(0, Math.floor(patch.totalCount)) : null;
        }
        const nextProgressPercent = Object.prototype.hasOwnProperty.call(patch, "progressPercent")
            ? patch.progressPercent
            : currentProgress;
        currentProgressMode = resolveProgressMode({
            phase: currentProgressPhase,
            progressMode: patch.progressMode ?? currentProgressMode,
            loadedCount: currentLoadedCount,
            totalCount: currentTotalCount,
            progressPercent: nextProgressPercent,
        });
        try {
            onProgress({
                phase: currentProgressPhase,
                message: currentProgressMessage,
                progressMode: currentProgressMode,
                progressPercent: currentProgressMode === "percent" && Number.isFinite(nextProgressPercent)
                    ? Math.max(0, Math.min(100, Math.round(nextProgressPercent)))
                    : null,
                loadedCount: currentProgressMode === "count" ? currentLoadedCount : null,
                totalCount: currentProgressMode === "count" ? currentTotalCount : null,
            });
        }
        catch {
            // Keep progress emission best-effort and non-blocking.
        }
    };
    const setMessage = (text) => {
        if (!isLoadStillActive())
            return;
        if (messageLog)
            messageLog.textContent = text;
        currentProgressMessage = text ?? null;
        emitProgress({
            message: currentProgressMessage,
        });
    };
    const setProgress = (rawPercent, force = false) => {
        if (!isLoadStillActive())
            return;
        const clamped = Math.max(0, Math.min(100, Math.round(rawPercent)));
        currentProgress = force ? clamped : Math.max(currentProgress, clamped);
        if (progressBar) {
            progressBar.style.width = `${currentProgress}%`;
        }
        if (progressLabel) {
            progressLabel.textContent = `${currentProgress}%`;
        }
        emitProgress({
            progressPercent: currentProgress,
        });
    };
    const hideProgress = () => {
        if (!isLoadStillActive())
            return;
        if (!showLoadUi)
            return;
        if (progressBar?.parentElement) {
            const container = progressBar.parentElement;
            if (container.isConnected)
                container.style.display = "none";
        }
    };
    if (showLoadUi && progressBar && progressBar.parentElement) {
        progressBar.parentElement.style.display = "block";
    }
    if (showLoadUi) {
        setProgress(0, true);
    }
    if (!USD || !window.usdRoot)
        return null;
    const normalizedPath = normalizeUsdPath(pathToLoad, displayName).split("?")[0];
    if (!normalizedPath)
        return null;
    markLoadPhase("start");
    const state = {
        driver: null,
        ready: false,
        drawFailed: false,
        drawFailureReason: null,
        timeout: 40,
        endTimeCode: 0,
        normalizedPath,
        loadedCollisionPrims: !!loadCollisionPrims,
        loadedVisualPrims: !!loadVisualPrims,
    };
    profileTargetState = state;
    if (!isLoadStillActive())
        return state;
    onResolvedFilename(normalizedPath, displayName || normalizedPath);
    emitProgress({
        phase: "checking-path",
        loadedCount: null,
        totalCount: null,
    });
    setMessage("Checking file path...");
    setProgress(4);
    const canLoadRootPath = await ensureRootPathIsLoadable(normalizedPath, usdFsHelper);
    if (!isLoadStillActive())
        return state;
    if (!canLoadRootPath) {
        setMessage(`Cannot find USD file at '${normalizedPath}'.`);
        setProgress(0, true);
        hideProgress();
        state.ready = false;
        state.drawFailed = true;
        state.drawFailureReason = "root-path-unavailable";
        return state;
    }
    setProgress(10);
    markLoadPhase("root-path-checked");
    emitProgress({
        phase: "preloading-dependencies",
        loadedCount: null,
        totalCount: null,
    });
    setMessage("Preloading USD dependencies...");
    const usdModule = window.USD;
    const canWriteVirtualFs = !!usdModule
        && typeof usdModule.FS_createPath === "function"
        && typeof usdModule.FS_createDataFile === "function"
        && typeof usdModule.FS_unlink === "function";
    const loadFileAsBinary = async (requestPath) => {
        try {
            const response = await fetch(requestPath);
            if (!response.ok)
                return null;
            const binary = await response.arrayBuffer();
            if (!binary || binary.byteLength <= 0)
                return null;
            return new Uint8Array(binary);
        }
        catch (error) {
            return null;
        }
    };
    const writeBinaryToVirtualPath = (virtualPath, binaryData) => {
        if (!canWriteVirtualFs)
            return;
        const normalizedVirtualPath = normalizeUsdPath(virtualPath).split("?")[0];
        const fileName = normalizedVirtualPath.split("/").pop();
        if (!fileName)
            return;
        const directory = getDirectoryFromVirtualPath(normalizedVirtualPath);
        try {
            usdModule.FS_createPath("", directory, true, true);
        }
        catch { }
        try {
            if (usdFsHelper.hasVirtualFilePath(normalizedVirtualPath)) {
                usdModule.FS_unlink(normalizedVirtualPath);
                usdFsHelper.untrackVirtualFilePath(normalizedVirtualPath);
            }
        }
        catch { }
        try {
            usdModule.FS_createDataFile(directory, fileName, binaryData, true, true, true);
            usdFsHelper.trackVirtualFilePath(normalizedVirtualPath);
        }
        catch {
            // Keep load path resilient; missing optional dependency files are tolerated.
        }
    };
    const buildPlaceholderUsdBinary = (defaultPrimName) => {
        if (typeof TextEncoder === "undefined")
            return null;
        const normalizedPrimName = String(defaultPrimName || "Config").trim() || "Config";
        return new TextEncoder().encode([
            "#usda 1.0",
            "(",
            `    defaultPrim = "${normalizedPrimName}"`,
            ")",
            "",
            `def Xform "${normalizedPrimName}"`,
            "{",
            "}",
            "",
        ].join("\n"));
    };
    const shouldSeedMissingOptionalConfigurationPlaceholders = (!isConfigurationUsdPath
        && (normalizedPathForDependencyDefaults.includes("/unitree_model/")
            || normalizedPathForDependencyDefaults.includes("/robots/")));
    const seedMissingOptionalConfigurationPlaceholder = (fileName, defaultPrimName = "Config") => {
        if (!canWriteVirtualFs)
            return false;
        if (!fileName)
            return false;
        const placeholderBinary = buildPlaceholderUsdBinary(defaultPrimName);
        if (!placeholderBinary)
            return false;
        const rootDirectory = getDirectoryFromVirtualPath(normalizedPath);
        const configurationDirectory = rootDirectory.toLowerCase().endsWith("/configuration/")
            ? rootDirectory
            : normalizeUsdPath(`${rootDirectory}configuration/`);
        const localConfigurationPath = normalizeUsdPath(`${configurationDirectory}${fileName}`);
        const sharedConfigurationPath = normalizeUsdPath(`/configuration/${fileName}`);
        if (!usdFsHelper.hasVirtualFilePath(localConfigurationPath)) {
            writeBinaryToVirtualPath(localConfigurationPath, placeholderBinary);
        }
        if (sharedConfigurationPath !== localConfigurationPath && !usdFsHelper.hasVirtualFilePath(sharedConfigurationPath)) {
            writeBinaryToVirtualPath(sharedConfigurationPath, placeholderBinary);
        }
        return true;
    };
    const ensureVirtualFileFromCandidates = async (virtualPath, candidateFetchPaths) => {
        if (!virtualPath)
            return false;
        if (!canWriteVirtualFs)
            return false;
        const normalizedVirtualPath = normalizeUsdPath(virtualPath).split("?")[0];
        if (usdFsHelper.hasVirtualFilePath(normalizedVirtualPath))
            return true;
        for (const candidatePath of candidateFetchPaths) {
            const loadedBinary = await loadFileAsBinary(candidatePath);
            if (!loadedBinary)
                continue;
            writeBinaryToVirtualPath(normalizedVirtualPath, loadedBinary);
            return true;
        }
        return false;
    };
    const autoLoadSublayers = async (dependencyStem) => {
        if (!canWriteVirtualFs)
            return;
        const dependencyExtension = getUsdDependencyExtension(normalizedPath);
        const tryEnsureDependencyFile = async (fileName) => {
            if (!fileName)
                return;
            const existingLocalPath = getUsdConfigurationMirrorPlan(normalizedPath, fileName, {
                hasLocalVirtualFile: false,
                hasSharedVirtualFile: false,
            }).localConfigurationPath;
            const existingSharedPath = getUsdConfigurationMirrorPlan(normalizedPath, fileName, {
                hasLocalVirtualFile: false,
                hasSharedVirtualFile: false,
            }).sharedConfigurationPath;
            const hasLocalVirtualFile = !!existingLocalPath && usdFsHelper.hasVirtualFilePath(existingLocalPath);
            const hasSharedVirtualFile = !!existingSharedPath && usdFsHelper.hasVirtualFilePath(existingSharedPath);
            const { localConfigurationPath, sharedConfigurationPath, shouldWriteLocalAlias, shouldWriteSharedAlias } = getUsdConfigurationMirrorPlan(normalizedPath, fileName, {
                hasLocalVirtualFile,
                hasSharedVirtualFile,
            });
            const candidateFetchPaths = Array.from(new Set([
                localConfigurationPath,
                sharedConfigurationPath,
            ]));
            if (!shouldWriteLocalAlias && !shouldWriteSharedAlias)
                return;
            if (shouldWriteLocalAlias && hasSharedVirtualFile) {
                try {
                    const existing = usdModule.FS_readFile?.(sharedConfigurationPath);
                    if (existing && existing.length > 0) {
                        writeBinaryToVirtualPath(localConfigurationPath, existing);
                    }
                }
                catch { }
            }
            if (shouldWriteSharedAlias && hasLocalVirtualFile) {
                try {
                    const existing = usdModule.FS_readFile?.(localConfigurationPath);
                    if (existing && existing.length > 0) {
                        writeBinaryToVirtualPath(sharedConfigurationPath, existing);
                    }
                }
                catch { }
            }
            if (usdFsHelper.hasVirtualFilePath(localConfigurationPath)
                && (sharedConfigurationPath === localConfigurationPath || usdFsHelper.hasVirtualFilePath(sharedConfigurationPath))) {
                return;
            }
            let loadedBinary = null;
            for (const candidatePath of candidateFetchPaths) {
                loadedBinary = await loadFileAsBinary(candidatePath);
                if (loadedBinary)
                    break;
            }
            if (!loadedBinary) {
                const shouldSeedPlaceholder = shouldSeedMissingOptionalConfigurationPlaceholders
                    && /_(base|physics|robot)\.usd[a-z]?$/i.test(fileName);
                if (shouldSeedPlaceholder) {
                    seedMissingOptionalConfigurationPlaceholder(fileName);
                }
                return;
            }
            if (shouldWriteLocalAlias) {
                writeBinaryToVirtualPath(localConfigurationPath, loadedBinary);
            }
            if (shouldWriteSharedAlias) {
                writeBinaryToVirtualPath(sharedConfigurationPath, loadedBinary);
            }
        };
        const dependencySuffixes = getUsdDependencySuffixesForStage(normalizedPath, dependencyStem, {
            includeSensorDependency,
        });
        const dependencyFileNames = dependencySuffixes.map((suffix) => `${dependencyStem}_${suffix}${dependencyExtension}`);
        await Promise.all(dependencyFileNames.map((dependencyFileName) => tryEnsureDependencyFile(dependencyFileName)));
    };
    const seedOptionalSensorPlaceholder = (dependencyStem) => {
        if (!canWriteVirtualFs)
            return;
        if (!dependencyStem)
            return;
        if (includeSensorDependency)
            return;
        if (!skipSensorPayloadsOnOpen)
            return;
        seedMissingOptionalConfigurationPlaceholder(
            `${dependencyStem}_sensor${getUsdDependencyExtension(normalizedPath)}`,
            "Sensors",
        );
    };
    const shouldPreloadRootLayerToVirtualFs = normalizedPath.startsWith("/");
    const skipInternalDependencyPreload = dependenciesPreloadedToVirtualFs && usdFsHelper.hasVirtualFilePath(normalizedPath);
    if (!skipInternalDependencyPreload && shouldPreloadRootLayerToVirtualFs) {
        const rootLayerLoaded = await ensureVirtualFileFromCandidates(normalizedPath, [normalizedPath]);
        if (rootLayerLoaded) {
            // Root layer is available in WASM FS.
        }
    }
    const normalizedFileName = normalizedPath.split("/").pop()?.toLowerCase() || "";
    const dependencyStem = inferDependencyStemForUsdPath(normalizedPath, normalizedFileName);
    const normalizedPathLower = normalizedPath.toLowerCase();
    const shouldAutoLoadDependenciesFromVirtualFs = usdFsHelper.hasVirtualFilePath(normalizedPath);
    const shouldAutoLoadDependenciesFromUnitreePath = normalizedPathLower.startsWith("/unitree_model/");
    const isPiperSceneUsdPath = normalizedPathLower.startsWith("/piper_isaac_sim/usd/");
    const shouldAutoLoadInferredRootDependencies = shouldAutoLoadDependenciesFromVirtualFs && !isPiperSceneUsdPath;
    if (!skipInternalDependencyPreload
        && autoLoadDependencies
        && dependencyStem
        && (shouldAutoLoadInferredRootDependencies || shouldAutoLoadDependenciesFromUnitreePath || forceDependencyPreload)) {
        await autoLoadSublayers(dependencyStem);
    }
    if (dependencyStem) {
        seedOptionalSensorPlaceholder(dependencyStem);
    }
    if (!isLoadStillActive())
        return state;
    setProgress(22);
    markLoadPhase("dependency-preload-done");
    emitProgress({
        phase: "initializing-renderer",
        loadedCount: null,
        totalCount: null,
    });
    setMessage("Initializing USD driver...");
    window.usdStage = null;
    applyStageMetersPerUnitToRoot(window.usdRoot);
    const renderInterface = (window.renderInterface = new ThreeRenderDelegateInterface({
        usdRoot: window.usdRoot,
        paths: [],
        stageSourcePath: normalizedPath,
        suppressMaterialBindingApiWarnings: true,
        // Parsing fallback xform ops from raw USDA layer text is extremely expensive
        // on large Unitree assets; keep this diagnostic fallback disabled by default.
        enableXformOpFallbackFromLayerText: parseBooleanFlag(params.get("enableXformOpFallbackFromLayerText"), false),
        // Proto stage sync is force-enabled to avoid slow per-mesh bridge calls.
        enableProtoBlobFastPath,
        // Prefer one-shot final stage override batches over per-mesh fallback chains.
        preferFinalStageOverrideBatchInProtoSync: parseBooleanFlag(params.get("preferFinalStageOverrideBatchInProtoSync"), true),
        // Skip heavy per-callback geometry copies when proto blob fast-path is enabled.
        preferProtoBlobOverHydraPayload: parseBooleanFlag(params.get("preferProtoBlobOverHydraPayload"), true),
        // In snapshot/one-shot mode, all heavy bridge payloads should arrive before
        // ready; disable on-demand fallback pulls so interaction stays cache-only.
        strictOneShotSceneLoad: strictOneShot,
        autoBatchProtoBlobsOnFirstAccess: strictOneShot,
        autoBatchPrimTransformsOnFirstAccess: false,
        autoBatchCollisionProtoOverridesOnFirstAccess: false,
        autoBatchVisualProtoOverridesOnFirstAccess: false,
        deferHiddenCollisionProtoSyncInCommit: false,
        // During high-frequency Hydra sync callbacks, avoid fallback driver.GetStage()
        // lookups before window.usdStage is ready to prevent first-sync stalls.
        deferDriverStageLookupInSyncHotPath: parseBooleanFlag(params.get("deferDriverStageLookupInSyncHotPath"), true),
        // For fast interactive loads, avoid synchronous driver.GetStage() fallback unless
        // metadata access is explicitly enabled.
        allowDriverStageLookup: false,
        // Unitree root stages can skip optional sensor payloads during stage open.
        // This avoids composing/fetching sensor-only payloads on the critical path.
        skipSensorPayloadsOnOpen,
        // Worker bootstrap resolves RobotState from the direct stage snapshot and
        // never needs live Hydra rprims, so it can skip the expensive Populate.
        skipHydraPopulateForRobotSceneSnapshot,
        // Snapshot-only worker bootstrap should not reopen and stringify the USD
        // stage for JS fallback parsing after the C++ snapshot is already ready.
        disableStageLayerTextFallbacks,
        // Low-noise phase instrumentation:
        //   1) WASM payload fetch/copy
        //   2) Three.js object/build work
        //   3) renderer.render blocking time
        enableHydraPhaseInstrumentation: parseBooleanFlag(params.get("profileHydraPhases"), false),
        loadCollisionPrims: !!loadCollisionPrims,
        loadVisualPrims: !!loadVisualPrims,
        maxVisualPrims,
        stage: () => window.usdStage || null,
        setStage: (resolvedStage) => {
            window.usdStage = resolvedStage || null;
        },
        driver: () => driver,
    }));
    if (profileLoad && renderInterface && typeof renderInterface === "object") {
        const wrappedFunctionNames = new Set();
        const wrapMethod = (owner, methodName) => {
            if (!owner || typeof owner[methodName] !== "function")
                return;
            const fullName = methodName;
            if (wrappedFunctionNames.has(fullName))
                return;
            const original = owner[methodName];
            owner[methodName] = function profiledRenderInterfaceMethod(...methodArgs) {
                const startedAt = profileNow();
                let result;
                try {
                    result = original.apply(this, methodArgs);
                }
                catch (error) {
                    addCallbackSample(fullName, profileNow() - startedAt);
                    throw error;
                }
                if (result && typeof result.then === "function") {
                    return Promise.resolve(result)
                        .then((value) => {
                        addCallbackSample(fullName, profileNow() - startedAt);
                        return value;
                    })
                        .catch((error) => {
                        addCallbackSample(fullName, profileNow() - startedAt);
                        throw error;
                    });
                }
                addCallbackSample(fullName, profileNow() - startedAt);
                return result;
            };
            wrappedFunctionNames.add(fullName);
        };
        const proto = Object.getPrototypeOf(renderInterface);
        if (proto) {
            for (const name of Object.getOwnPropertyNames(proto)) {
                if (name === "constructor")
                    continue;
                wrapMethod(proto, name);
            }
        }
        for (const name of Object.keys(renderInterface)) {
            wrapMethod(renderInterface, name);
        }
    }
    setProgress(30);
    markLoadPhase("render-interface-ready");
    if (yieldDuringLoad) {
        await yieldToMainThread();
    }
    try {
        driver = new USD.HdWebSyncDriver(renderInterface, normalizedPath);
        if (driver instanceof Promise) {
            driver = await driver;
        }
    }
    catch (error) {
        console.error("Failed to create USD driver", error);
        setMessage("Failed to initialize USD renderer for this file.");
        state.ready = false;
        state.drawFailed = true;
        state.drawFailureReason = "driver-init-failed";
        hideProgress();
        flushLoadProfile("error");
        return state;
    }
    if (!isLoadStillActive()) {
        state.driver = driver || null;
        flushLoadProfile("aborted");
        return state;
    }
    if (!driver) {
        setMessage("Failed to initialize USD renderer for this file.");
        state.ready = false;
        state.drawFailed = true;
        state.drawFailureReason = "driver-init-missing";
        hideProgress();
        flushLoadProfile("error");
        return state;
    }
    refreshNativeDriverProfiles();
    try {
        if (typeof driver.SetPreferProtoBlobOverHydraPayload === "function") {
            driver.SetPreferProtoBlobOverHydraPayload(renderInterface?.preferProtoBlobOverHydraPayload !== false);
        }
    }
    catch { }
    try {
        if (typeof driver.SetPreferDirectStageRobotSceneSnapshot === "function") {
            driver.SetPreferDirectStageRobotSceneSnapshot(!!skipHydraFullDrawForRobotSceneSnapshot);
        }
    }
    catch { }
    state.driver = window.driver = driver;
    if (yieldDuringLoad) {
        await yieldToMainThread();
    }
    const runRuntimeBridgeWarmup = (phaseLabel, options = {}) => {
        if (!warmupRuntimeBridge)
            return null;
        if (phaseLabel !== "post-initial-draw" && !warmupRuntimeBridgeBeforeDraw)
            return null;
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.warmupRobotSceneSnapshotFromDriver !== "function")
            return null;
        if (!isLoadStillActive())
            return null;
        if (window.driver !== state.driver)
            return null;
        try {
            const summary = activeRenderInterface.warmupRobotSceneSnapshotFromDriver(state.driver, {
                force: options.force === true,
                stageSourcePath: normalizedPath,
                emitRobotMetadataEvent: false,
            });
            if (summary && typeof summary === "object") {
                lastRuntimeBridgeWarmupSummary = summary;
                refreshNativeDriverProfiles();
                if (state && typeof state === "object") {
                    state.runtimeBridgeWarmupSummary = { ...summary };
                }
                markLoadPhase(`runtime-bridge-warmup-${phaseLabel}`);
            }
            return summary && typeof summary === "object" ? summary : null;
        }
        catch (error) {
            console.error("[usd-loader] Failed to warm up runtime bridge during " + phaseLabel + ".", error);
            return null;
        }
    };
    const getRuntimeBridgeWarmupWarningMessage = (summary) => {
        if (!summary || typeof summary !== "object") {
            return null;
        }
        const driverStageResolveStatus = String(summary.driverStageResolveStatus || "").trim();
        const driverStageResolveError = String(summary.driverStageResolveError || "").trim();
        const subsetFailureCount = Math.max(0, Number(summary.snapshotMaterialSubsetFailureCount || 0));
        const inheritFailureCount = Math.max(0, Number(summary.snapshotMaterialInheritFailureCount || 0));
        const textureFailureCount = Math.max(0, Number(summary.snapshotTextureFailureCount || 0));
        const materialFailureCount = subsetFailureCount + inheritFailureCount + textureFailureCount;
        if (driverStageResolveStatus === "rejected") {
            return driverStageResolveError
                ? `Resolving robot metadata... stage lookup failed (${driverStageResolveError}).`
                : "Resolving robot metadata... stage lookup failed.";
        }
        if (materialFailureCount > 0) {
            const issueLabel = materialFailureCount === 1 ? "issue" : "issues";
            return `Resolving robot metadata... material fallbacks incomplete (${materialFailureCount} ${issueLabel}).`;
        }
        return null;
    };
    const getPendingProtoHydrationCount = (summary) => {
        if (!summary || typeof summary !== "object")
            return null;
        const rawPending = Number(summary.hydratedProtoMeshPendingCount ?? summary.pendingCount);
        if (Number.isFinite(rawPending) && rawPending >= 0) {
            return Math.max(0, Math.floor(rawPending));
        }
        const rawAttempted = Number(summary.hydratedProtoMeshAttemptedCount ?? summary.attemptedCount);
        const rawCompleted = Number(summary.hydratedProtoMeshCount ?? summary.completedCount);
        if (Number.isFinite(rawAttempted) && rawAttempted >= 0 && Number.isFinite(rawCompleted) && rawCompleted >= 0) {
            return Math.max(0, Math.floor(rawAttempted) - Math.floor(rawCompleted));
        }
        return null;
    };
    const hasRuntimeBridgeCompletedProtoHydration = (summary) => {
        if (!summary || typeof summary !== "object")
            return false;
        if (summary.sceneSnapshotReady !== true)
            return false;
        const pendingCount = getPendingProtoHydrationCount(summary);
        return pendingCount === 0;
    };
    const markHydrationFailure = (reason, error) => {
        console.error(`[usd-loader] ${reason} while hydrating USD meshes for ${normalizedPath}.`, error);
        state.ready = false;
        state.drawFailed = true;
        state.drawFailureReason = reason;
        setMessage(error instanceof Error && error.message
            ? error.message
            : "Failed to hydrate USD meshes before interactive readiness.");
        return null;
    };
    const runProtoHydrationPass = () => {
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.hydratePendingProtoMeshes !== "function")
            return null;
        if (!isLoadStillActive())
            return null;
        if (window.driver !== state.driver)
            return null;
        try {
            return activeRenderInterface.hydratePendingProtoMeshes({ allowDeferredFinalBatch: false }) || null;
        }
        catch (error) {
            return markHydrationFailure("proto-hydration-failed", error);
        }
    };
    const getPendingResolvedPrimHydrationCount = (summary) => {
        if (!summary || typeof summary !== "object")
            return null;
        const rawPending = Number(summary.pendingCount);
        if (Number.isFinite(rawPending) && rawPending >= 0) {
            return Math.max(0, Math.floor(rawPending));
        }
        const rawAttempted = Number(summary.attemptedCount);
        const rawCompleted = Number(summary.completedCount);
        if (Number.isFinite(rawAttempted) && rawAttempted >= 0 && Number.isFinite(rawCompleted) && rawCompleted >= 0) {
            return Math.max(0, Math.floor(rawAttempted) - Math.floor(rawCompleted));
        }
        return null;
    };
    const runResolvedPrimHydrationPass = (options = {}) => {
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.hydratePendingResolvedPrimMeshes !== "function")
            return null;
        if (!isLoadStillActive())
            return null;
        if (window.driver !== state.driver)
            return null;
        try {
            return activeRenderInterface.hydratePendingResolvedPrimMeshes({
                driver: state.driver,
                force: options.force === true,
            }) || null;
        }
        catch (error) {
            return markHydrationFailure("resolved-prim-hydration-failed", error);
        }
    };
    const ensureNoPendingMeshHydrationBeforeReady = () => {
        const protoHydrationSummary = runProtoHydrationPass();
        if (state.drawFailed)
            return false;
        // Snapshot-only loads publish the complete WASM scene snapshot instead
        // of waiting for Hydra placeholder meshes to receive Three geometry.
        // Primitive-only USDA stages can legitimately have descriptor-backed
        // placeholders with no position buffer; treating those as unresolved
        // would reintroduce a false "background hydration" failure.
        const resolvedPrimHydrationSummary = state.robotSceneSnapshotOnly === true
            ? { pendingCount: 0 }
            : runResolvedPrimHydrationPass({ force: true });
        if (state.drawFailed)
            return false;
        const pendingProtoCount = Math.max(0, Number(getPendingProtoHydrationCount(protoHydrationSummary) ?? 0));
        const pendingResolvedPrimCount = Math.max(0, Number(getPendingResolvedPrimHydrationCount(resolvedPrimHydrationSummary) ?? 0));
        if (pendingProtoCount <= 0 && pendingResolvedPrimCount <= 0) {
            return true;
        }
        markHydrationFailure("mesh-hydration-pending-before-ready", new Error(`USD mesh hydration still has pending work before ready (proto: ${pendingProtoCount}, resolved prim: ${pendingResolvedPrimCount}).`));
        return false;
    };
    const getRobotSceneStageSnapshot = () => {
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.getCachedRobotSceneSnapshot !== "function") {
            return null;
        }
        let stageSourcePath = null;
        try {
            stageSourcePath = String(activeRenderInterface.getStageSourcePath?.() || "").trim() || null;
            const snapshot = activeRenderInterface.getCachedRobotSceneSnapshot(stageSourcePath);
            if (!snapshot || typeof snapshot !== "object")
                return null;
            const stageSnapshot = snapshot.stage;
            return stageSnapshot && typeof stageSnapshot === "object" ? stageSnapshot : null;
        }
        catch (error) {
            console.error(`[usd-loader] Failed to read cached robot scene stage snapshot for ${stageSourcePath || "active-stage"}.`, error);
            return null;
        }
    };
    const syncStageAxisAlignment = () => {
        const cachedSceneStageSnapshot = getRobotSceneStageSnapshot();
        const previousRotationX = Number(window.usdRoot?.rotation?.x || 0);
        const previousScale = Number(window.usdRoot?.scale?.x || 1);
        const nextRotationX = applyStageAxisAlignmentToRoot(window.usdRoot, {
            reportedUpAxis: cachedSceneStageSnapshot?.upAxis || null,
            stage: window.usdStage,
            targetUpAxis: "z",
        });
        const nextScale = applyStageMetersPerUnitToRoot(window.usdRoot, {
            reportedMetersPerUnit: cachedSceneStageSnapshot?.metersPerUnit || null,
            stage: window.usdStage,
        });
        const axisChanged = Math.abs(previousRotationX - nextRotationX) > 1e-6;
        const scaleChanged = Math.abs(previousScale - nextScale) > 1e-9;
        if (axisChanged || scaleChanged) {
            window.usdRoot?.updateMatrixWorld?.(true);
        }
        return {
            cachedSceneStageSnapshot,
            axisChanged,
            scaleChanged,
        };
    };
    const getRobotMetadataSnapshotStats = () => {
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.getCachedRobotMetadataSnapshot !== "function") {
            return {
                hasSnapshot: false,
                jointCount: 0,
                dynamicsCount: 0,
                linkParentCount: 0,
                stale: false,
                errorFlags: [],
                truthLoadError: null,
            };
        }
        let stageSourcePath = null;
        try {
            stageSourcePath = String(activeRenderInterface.getStageSourcePath?.() || "").trim() || null;
            const snapshot = activeRenderInterface.getCachedRobotMetadataSnapshot(stageSourcePath);
            if (!snapshot || typeof snapshot !== "object") {
                return {
                    hasSnapshot: false,
                    jointCount: 0,
                    dynamicsCount: 0,
                    linkParentCount: 0,
                    stale: false,
                    errorFlags: [],
                    truthLoadError: null,
                };
            }
            const jointCount = Array.isArray(snapshot.jointCatalogEntries)
                ? snapshot.jointCatalogEntries.length
                : 0;
            const dynamicsCount = Array.isArray(snapshot.linkDynamicsEntries)
                ? snapshot.linkDynamicsEntries.length
                : 0;
            const linkParentCount = Array.isArray(snapshot.linkParentPairs)
                ? snapshot.linkParentPairs.length
                : 0;
            const errorFlags = Array.isArray(snapshot.errorFlags)
                ? snapshot.errorFlags
                    .map((entry) => String(entry || "").trim())
                    .filter((entry) => entry.length > 0)
                : [];
            const truthLoadError = String(snapshot.truthLoadError || "").trim() || null;
            return {
                hasSnapshot: true,
                jointCount,
                dynamicsCount,
                linkParentCount,
                stale: snapshot.stale === true,
                errorFlags,
                truthLoadError,
            };
        }
        catch (error) {
            console.error(`[usd-loader] Failed to read cached robot metadata snapshot stats for ${stageSourcePath || "active-stage"}.`, error);
            return {
                hasSnapshot: false,
                jointCount: 0,
                dynamicsCount: 0,
                linkParentCount: 0,
                stale: false,
                errorFlags: [],
                truthLoadError: null,
            };
        }
    };
    const buildRobotMetadataReadinessError = () => {
        const stats = getRobotMetadataSnapshotStats();
        if (!stats.hasSnapshot) {
            return new Error(`Robot metadata did not resolve for "${normalizedPath}" before interactive readiness.`);
        }
        const details = [];
        if (stats.stale === true) {
            details.push("stale");
        }
        if (Array.isArray(stats.errorFlags) && stats.errorFlags.length > 0) {
            details.push(`errorFlags=${stats.errorFlags.join(",")}`);
        }
        if (stats.truthLoadError) {
            details.push(`truthLoadError=${stats.truthLoadError}`);
        }
        return new Error(`Robot metadata for "${normalizedPath}" is not ready for interactive use${details.length > 0 ? ` (${details.join("; ")})` : ""}.`);
    };
    const hasResolvedRobotMetadataSnapshot = (options = {}) => {
        const stats = getRobotMetadataSnapshotStats();
        if (!stats.hasSnapshot)
            return false;
        if (stats.stale === true || stats.errorFlags.length > 0 || !!stats.truthLoadError) {
            return false;
        }
        const hasAnyMetadata = stats.jointCount > 0 || stats.dynamicsCount > 0 || stats.linkParentCount > 0;
        if (!hasAnyMetadata) {
            return isLikelyNonRenderableUsdConfig(normalizedPath);
        }
        if (options.requireComplete !== true)
            return true;
        // Strict one-shot: keep interaction blocked until both joint and
        // COM/inertia metadata are ready, preventing first-click long stalls.
        return stats.jointCount > 0 && stats.dynamicsCount > 0;
    };
    const isRobotMetadataReady = () => {
        return hasResolvedRobotMetadataSnapshot({
            requireComplete: requireCompleteRobotMetadata,
        });
    };
    const buildRobotMetadataWarmupOptions = (force) => {
        return {
            force,
            // In non-blocking mode, keep metadata work on idle slices instead of
            // monopolizing the main thread during the visible loading phase.
            skipIdleWait: !nonBlockingLoad,
        };
    };
    let primedRobotMetadataWarmupPromise = null;
    const startRobotMetadataWarmup = (activeRenderInterface, options = {}) => {
        if (!activeRenderInterface || typeof activeRenderInterface.startRobotMetadataWarmupForStage !== "function")
            return null;
        const warmupPhaseLabel = options.force === true
            ? "forced robot metadata warmup"
            : "robot metadata warmup";
        try {
            const maybePromise = activeRenderInterface.startRobotMetadataWarmupForStage(buildRobotMetadataWarmupOptions(options.force === true));
            const normalizedPromise = (maybePromise && typeof maybePromise.then === "function")
                ? maybePromise
                : Promise.resolve(maybePromise ?? null);
            primedRobotMetadataWarmupPromise = normalizedPromise;
            void primedRobotMetadataWarmupPromise.catch((error) => {
                console.error(`[usd-loader] ${warmupPhaseLabel} rejected for ${normalizedPath}.`, error);
            });
            return normalizedPromise;
        }
        catch (caughtError) {
            console.error(`[usd-loader] Failed to start ${warmupPhaseLabel} for ${normalizedPath}.`, caughtError);
            const rejectedPromise = Promise.reject(caughtError);
            void rejectedPromise.catch(() => { });
            primedRobotMetadataWarmupPromise = rejectedPromise;
            return rejectedPromise;
        }
    };
    const awaitRobotMetadataWarmup = async (activeRenderInterface, options) => {
        const pendingWarmup = startRobotMetadataWarmup(activeRenderInterface, options);
        if (!pendingWarmup)
            return;
        await pendingWarmup;
    };
    const ensureRobotMetadataReadyBeforeInteractive = async () => {
        if (!warmupRobotMetadata)
            return;
        if (!resolveRobotMetadataBeforeReady)
            return;
        if (!isLoadStillActive())
            return;
        if (window.driver !== state.driver)
            return;
        if (isRobotMetadataReady())
            return;
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.startRobotMetadataWarmupForStage !== "function") {
            throw new Error(`Robot metadata warmup API is unavailable for "${normalizedPath}".`);
        }
        if (primedRobotMetadataWarmupPromise) {
            await primedRobotMetadataWarmupPromise;
        }
        if (isRobotMetadataReady()) {
            markLoadPhase("robot-metadata-ready-before-interactive");
            return;
        }
        await awaitRobotMetadataWarmup(activeRenderInterface, { force: true });
        if (!isRobotMetadataReady()) {
            await awaitRobotMetadataWarmup(activeRenderInterface, { force: true });
        }
        if (!isRobotMetadataReady()) {
            throw buildRobotMetadataReadinessError();
        }
        markLoadPhase("robot-metadata-ready-before-interactive");
    };
    if (isLikelyNonRenderableUsdConfig(normalizedPath)) {
        runRuntimeBridgeWarmup("driver-init", { force: true });
        try {
            await ensureRobotMetadataReadyBeforeInteractive();
        }
        catch (error) {
            console.error("[usd-loader] Failed to resolve robot metadata before interactive readiness.", error);
            setMessage(error instanceof Error && error.message
                ? error.message
                : "Failed to resolve robot metadata before interactive readiness.");
            state.ready = false;
            state.drawFailed = true;
            state.drawFailureReason = "robot-metadata-failed";
            hideProgress();
            flushLoadProfile("error");
            return state;
        }
        if (!isLoadStillActive())
            return state;
        applyMeshFilters();
        state.ready = true;
        rebuildLinkAxes();
        setMessage("This USD config contains no renderable meshes (sensor/robot metadata only).");
        setProgress(100, true);
        hideProgress();
        flushLoadProfile("ok");
        return state;
    }
    const preDrawRuntimeBridgeWarmupSummary = robotSceneSnapshotBeforeDraw
        ? runRuntimeBridgeWarmup("pre-draw", { force: true })
        : null;
    const canCompleteFromRobotSceneSnapshotOnly = (() => {
        if (!skipHydraFullDrawForRobotSceneSnapshot) {
            return false;
        }
        if (!hasRuntimeBridgeCompletedProtoHydration(preDrawRuntimeBridgeWarmupSummary)) {
            return false;
        }
        const meshDescriptorCount = Number(preDrawRuntimeBridgeWarmupSummary?.meshDescriptorCount || 0);
        return Number.isFinite(meshDescriptorCount) && meshDescriptorCount > 0;
    })();
    if (canCompleteFromRobotSceneSnapshotOnly) {
        state.robotSceneSnapshotOnly = true;
        state.drawSkippedForRobotSceneSnapshot = true;
        markLoadPhase("robot-scene-snapshot-before-draw-ready");
        window.usdStage = null;
        const { cachedSceneStageSnapshot } = syncStageAxisAlignment();
        state.timeout = 40;
        state.endTimeCode = 0;
        if (cachedSceneStageSnapshot) {
            const stageEndTimeCode = Number(cachedSceneStageSnapshot.endTimeCode || 0);
            const stageTimeCodesPerSecond = Number(cachedSceneStageSnapshot.timeCodesPerSecond || 0);
            state.endTimeCode = Number.isFinite(stageEndTimeCode) && stageEndTimeCode > 0 ? stageEndTimeCode : 0;
            state.timeout = Number.isFinite(stageTimeCodesPerSecond) && stageTimeCodesPerSecond > 0 ? 1000 / stageTimeCodesPerSecond : 40;
        }
        emitProgress({
            phase: "resolving-metadata",
            loadedCount: null,
            totalCount: null,
        });
        setMessage("Resolving robot scene snapshot...");
        setProgress(92);
        try {
            await ensureRobotMetadataReadyBeforeInteractive();
        }
        catch (error) {
            console.error("[usd-loader] Failed to resolve robot metadata before snapshot readiness.", error);
            setMessage(error instanceof Error && error.message
                ? error.message
                : "Failed to resolve robot metadata before snapshot readiness.");
            state.ready = false;
            state.drawFailed = true;
            state.drawFailureReason = "robot-metadata-failed";
            hideProgress();
            flushLoadProfile("error");
            return state;
        }
        if (!isLoadStillActive())
            return state;
        applyMeshFilters();
        if (!ensureNoPendingMeshHydrationBeforeReady()) {
            return state;
        }
        state.ready = true;
        setProgress(100, true);
        emitProgress({
            phase: "ready",
            progressMode: "percent",
            progressPercent: 100,
            loadedCount: null,
            totalCount: null,
        });
        hideProgress();
        flushLoadProfile("ok");
        return state;
    }
    markLoadPhase("stage-transform-prefetch-done");
    emitProgress({
        phase: "streaming-meshes",
        loadedCount: null,
        totalCount: null,
    });
    setMessage("Loading meshes...");
    setProgress(38);
    markLoadPhase("driver-created");
    const runInstrumentedDriverDraw = (sourceLabel, options = {}) => {
        const renderInterface = window.renderInterface;
        const beginHydraDrawPhase = renderInterface?.beginHydraDrawPhase;
        const endHydraDrawPhase = renderInterface?.endHydraDrawPhase;
        const canProfilePhases = typeof beginHydraDrawPhase === "function" && typeof endHydraDrawPhase === "function";
        const canMarkHydraSync = typeof performance !== "undefined"
            && typeof performance.mark === "function"
            && typeof performance.measure === "function";
        if (canProfilePhases) {
            try {
                beginHydraDrawPhase.call(renderInterface, sourceLabel);
            }
            catch {
                // Keep draw resilient even when instrumentation fails.
            }
        }
        try {
            if (canMarkHydraSync) {
                try {
                    performance.mark("hydra-sync-start");
                }
                catch { }
            }
            state.driver.Draw();
            runEagerRender(sourceLabel, { forceRender: options.forceRender });
            return true;
        }
        catch (drawError) {
            state.drawFailed = true;
            state.drawFailureReason = drawError instanceof Error
                ? drawError.message
                : String(drawError || 'unknown-draw-error');
            console.error('[usd-loader] Initial Draw failed.', drawError);
            return false;
        }
        finally {
            if (canMarkHydraSync) {
                try {
                    performance.mark("hydra-sync-end");
                    performance.measure("Hydra Sync Blocking", "hydra-sync-start", "hydra-sync-end");
                }
                catch { }
            }
            if (canProfilePhases) {
                try {
                    endHydraDrawPhase.call(renderInterface);
                }
                catch {
                    // Keep draw resilient even when instrumentation fails.
                }
            }
        }
    };
    if (!isLoadStillActive())
        return state;
    const initialDrawStartMs = profileNow();
    const shouldSliceInteractiveLoadWork = nonBlockingLoad && !strictOneShot;
    const yieldBetweenInteractiveLoadSteps = async () => {
        if (!shouldSliceInteractiveLoadWork)
            return;
        await yieldToMainThread(initialDrawYieldMs);
    };
    const updateStreamingStatus = () => {
        const stats = getMeshLoadStats(window.renderInterface);
        const meshReadyPercent = Math.min(100, Math.round((stats.ready / Math.max(stats.total, 1)) * 100));
        setMessage(`Streaming meshes... ${stats.ready}/${Math.max(stats.total, 1)} ready`);
        setProgress(88 + (meshReadyPercent * 0.03));
        emitProgress({
            phase: "streaming-meshes",
            loadedCount: stats.ready,
            totalCount: Math.max(stats.total, 1),
        });
        return stats;
    };
    let stats = { total: 0, ready: 0, collisions: 0, visuals: 0 };
    if (runInstrumentedDriverDraw("load-fast", { forceRender: drawBurstRenderEveryDraw })) {
        stats = updateStreamingStatus();
    }
    await yieldBetweenInteractiveLoadSteps();
    if (!isLoadStillActive())
        return state;
    runResolvedPrimHydrationPass({ force: true });
    if (state.drawFailed)
        return state;
    updateStreamingStatus();
    await yieldBetweenInteractiveLoadSteps();
    if (!isLoadStillActive())
        return state;
    markLoadPhase("initial-draw-done");
    const postInitialDrawWarmupSummary = runRuntimeBridgeWarmup("post-initial-draw", { force: true });
    let needsFinalProtoHydrationPass = !hasRuntimeBridgeCompletedProtoHydration(postInitialDrawWarmupSummary);
    let needsFinalResolvedPrimHydrationPass = false;
    // Start robot-metadata synthesis as soon as the first runtime snapshot exists
    // so strict one-shot loads can overlap metadata work with mesh drain/finalize
    // instead of blocking a second long CPU phase right before ready.
    startRobotMetadataWarmup(window.renderInterface, { force: false });
    startRobotMetadataWarmup(window.renderInterface, { force: true });
    if (needsFinalProtoHydrationPass) {
        const postInitialDrawHydrationSummary = runProtoHydrationPass();
        if (state.drawFailed)
            return state;
        const pendingProtoHydrationCount = getPendingProtoHydrationCount(postInitialDrawHydrationSummary);
        needsFinalProtoHydrationPass = pendingProtoHydrationCount === null || pendingProtoHydrationCount > 0;
    }
    const postInitialDrawResolvedPrimHydrationSummary = runResolvedPrimHydrationPass({ force: true });
    if (state.drawFailed)
        return state;
    const pendingResolvedPrimHydrationCount = getPendingResolvedPrimHydrationCount(postInitialDrawResolvedPrimHydrationSummary);
    needsFinalResolvedPrimHydrationPass = (pendingResolvedPrimHydrationCount !== null
        && pendingResolvedPrimHydrationCount > 0);
    await yieldBetweenInteractiveLoadSteps();
    if (!isLoadStillActive())
        return state;
    if (profileTextureLoads) {
        const textureSnapshot = window.renderInterface?.registry?.getTextureLoadSnapshot?.();
        if (textureSnapshot) {
            const managerPending = Number(textureSnapshot?.manager?.pending || 0);
            void managerPending;
        }
    }
    applyMeshFilters();
    emitProgress({
        phase: "finalizing-scene",
        loadedCount: null,
        totalCount: null,
    });
    setMessage("Finishing load...");
    setProgress(92);
    if (yieldDuringLoad) {
        await yieldToMainThread();
    }
    window.usdStage = null;
    if (!isLoadStillActive())
        return state;
    markLoadPhase("stage-ready");
    markLoadPhase("stage-mesh-fastpath");
    const refreshMeshStageOverrides = () => {
        try {
            window.renderInterface?.refreshMeshStageOverrides?.({
                includeCollision: !!loadCollisionPrims,
                includeVisual: false,
            });
        }
        catch {
            // Keep load resilient and quiet.
        }
        applyMeshFilters();
    };
    const shouldRunStageOverrides = !!loadCollisionPrims || !loadVisualPrims;
    if (!shouldRunStageOverrides) {
    }
    else {
        emitProgress({
            phase: "applying-stage-fixes",
            loadedCount: null,
            totalCount: null,
        });
        setMessage("Applying transform/collision fixes...");
        refreshMeshStageOverrides();
        setProgress(96);
    }
    markLoadPhase("stage-overrides-applied");
    const drainStrictOneShotMeshReadiness = async () => {
        if (!strictOneShot || state.drawFailed)
            return;
        const drainStartedAtMs = profileNow();
        let previousReady = -1;
        let previousTotal = -1;
        let previousPendingProto = -1;
        let previousPendingResolvedPrim = -1;
        let stagnantPassCount = 0;
        let drainPassCount = 0;
        for (;;) {
            if (!isLoadStillActive())
                return;
            const hydrationSummary = runProtoHydrationPass();
            const resolvedPrimHydrationSummary = runResolvedPrimHydrationPass();
            if (state.drawFailed)
                return;
            const pendingProtoCount = Math.max(0, Number(getPendingProtoHydrationCount(hydrationSummary) ?? 0));
            const pendingResolvedPrimCount = Math.max(0, Number(getPendingResolvedPrimHydrationCount(resolvedPrimHydrationSummary) ?? 0));
            stats = updateStreamingStatus();
            const allMeshesReady = stats.total <= 0 || stats.ready >= stats.total;
            if (allMeshesReady && pendingProtoCount === 0 && pendingResolvedPrimCount === 0) {
                return;
            }
            if (pendingProtoCount > 0 && pendingResolvedPrimCount === 0 && allMeshesReady) {
                drainPassCount += 1;
                if (drainPassCount % 8 === 0) {
                    await nextAnimationFrame();
                }
                continue;
            }
            const isStagnant = (stats.ready === previousReady
                && stats.total === previousTotal
                && pendingProtoCount === previousPendingProto
                && pendingResolvedPrimCount === previousPendingResolvedPrim);
            stagnantPassCount = isStagnant ? (stagnantPassCount + 1) : 0;
            previousReady = stats.ready;
            previousTotal = stats.total;
            previousPendingProto = pendingProtoCount;
            previousPendingResolvedPrim = pendingResolvedPrimCount;
            const elapsedMs = profileNow() - drainStartedAtMs;
            if ((finalSceneDrainBudgetMs > 0 && elapsedMs >= finalSceneDrainBudgetMs) || stagnantPassCount >= 10) {
                console.error(`[usd-loader] Strict one-shot drain stopped with ${stats.ready}/${Math.max(stats.total, 1)} meshes ready and ${pendingProtoCount} pending proto meshes.`);
                return;
            }
            let drewInBurst = false;
            const burstCount = Math.max(1, aggressiveInitialDraw ? initialDrawBurst : 1);
            for (let drawIndex = 0; drawIndex < burstCount; drawIndex++) {
                if (!isLoadStillActive())
                    return;
                if (!runInstrumentedDriverDraw("load-complete", { forceRender: drawBurstRenderEveryDraw }))
                    break;
                drewInBurst = true;
            }
            if (!drewInBurst || state.drawFailed)
                return;
            drainPassCount += 1;
            if (yieldDuringLoad) {
                await yieldToMainThread(initialDrawYieldMs);
            } else if (drainPassCount % 8 === 0) {
                await nextAnimationFrame();
            }
        }
    };
    await drainStrictOneShotMeshReadiness();
    if (!isLoadStillActive())
        return state;
    markLoadPhase("strict-one-shot-drain-done");
    const { cachedSceneStageSnapshot } = syncStageAxisAlignment();
    state.timeout = 40;
    state.endTimeCode = 0;
    if (cachedSceneStageSnapshot) {
        const stageEndTimeCode = Number(cachedSceneStageSnapshot.endTimeCode || 0);
        const stageTimeCodesPerSecond = Number(cachedSceneStageSnapshot.timeCodesPerSecond || 0);
        state.endTimeCode = Number.isFinite(stageEndTimeCode) && stageEndTimeCode > 0 ? stageEndTimeCode : 0;
        state.timeout = Number.isFinite(stageTimeCodesPerSecond) && stageTimeCodesPerSecond > 0 ? 1000 / stageTimeCodesPerSecond : 40;
    }
    if (needsFinalProtoHydrationPass) {
        runProtoHydrationPass();
        if (state.drawFailed)
            return state;
    }
    if (needsFinalResolvedPrimHydrationPass) {
        runResolvedPrimHydrationPass({ force: true });
        if (state.drawFailed)
            return state;
    }
    const getCameraFitSelection = () => collectCameraFitSelection(window.usdRoot);
    const refitCameraToUsdRoot = () => {
        if (disableCameraAutoFit) {
            return;
        }
        const fitted = fitCameraToSelection(window.camera, window._controls, getCameraFitSelection(), 1.5, params);
        if (!fitted) {
            scheduleCameraRefit(window.camera, window._controls, getCameraFitSelection, params);
        }
    };
    const retryStageAxisAlignmentUntilStageMetadata = (attempt = 0) => {
        if (!isLoadStillActive()) {
            return;
        }
        const alignment = syncStageAxisAlignment();
        if (alignment.axisChanged || alignment.scaleChanged) {
            refitCameraToUsdRoot();
        }
        const hasResolvedUpAxis = typeof alignment.cachedSceneStageSnapshot?.upAxis === "string"
            && alignment.cachedSceneStageSnapshot.upAxis.trim().length > 0;
        if (hasResolvedUpAxis || attempt >= 12) {
            return;
        }
        setTimeout(() => {
            retryStageAxisAlignmentUntilStageMetadata(attempt + 1);
        }, 250);
    };
    refitCameraToUsdRoot();
    emitProgress({
        phase: "resolving-metadata",
        loadedCount: null,
        totalCount: null,
    });
    setMessage("Resolving robot metadata...");
    try {
        await ensureRobotMetadataReadyBeforeInteractive();
    }
    catch (error) {
        console.error("[usd-loader] Failed to resolve robot metadata before interactive readiness.", error);
        setMessage(error instanceof Error && error.message
            ? error.message
            : "Failed to resolve robot metadata before interactive readiness.");
        state.ready = false;
        state.drawFailed = true;
        state.drawFailureReason = "robot-metadata-failed";
        hideProgress();
        flushLoadProfile("error");
        return state;
    }
    if (!isLoadStillActive())
        return state;
    const runtimeBridgeWarmupWarningMessage = getRuntimeBridgeWarmupWarningMessage(lastRuntimeBridgeWarmupSummary);
    if (runtimeBridgeWarmupWarningMessage) {
        setMessage(runtimeBridgeWarmupWarningMessage);
    }
    retryStageAxisAlignmentUntilStageMetadata();
    rebuildLinkAxes();
    markLoadPhase("camera-and-link-axes-done");
    const root = {};
    if (usdFsHelper.canOperateOnUsdFilesystem()) {
        usdFsHelper.addPath(root, "/");
        void debugFileHandling;
    }
    const loadedMeshCount = window.renderInterface?.meshes ? Object.keys(window.renderInterface.meshes).length : 0;
    if (loadedMeshCount === 0) {
        if (!loadVisualPrims && !loadCollisionPrims) {
            setMessage("Both visual and collision meshes are disabled (showVisuals=0 & showCollisions=0).");
        }
        else if (isLikelyNonRenderableUsdConfig(normalizedPath)) {
            setMessage("This USD config contains no renderable meshes (sensor/robot metadata only).");
        }
        else {
            setMessage("No geometry loaded. If this file has external dependencies, upload the whole folder.");
        }
    }
    else {
        const stats = getMeshLoadStats(window.renderInterface);
        setMessage(`Loaded ${stats.total} meshes (visual: ${stats.visuals}, collision: ${stats.collisions}).`);
    }
    // Force one render before reporting 100% so shader compile/GPU upload cost
    // is paid while still inside the loading phase instead of after UI completion.
    runEagerRender("pre-complete", { forceRender: true });
    const textureLoadReadyResult = await waitForTextureLoadReady({
        getTextureProgress: () => getTextureLoadProgress(window.renderInterface),
        isLoadStillActive,
        emitProgress,
        setMessage,
        setProgress,
        timeoutMs: nonBlockingLoad ? 4000 : 5000,
        yieldForNextCheck: async (minDelayMs = 0) => {
            if (yieldDuringLoad) {
                await yieldToMainThread(Math.max(minDelayMs, 0));
                return;
            }
            if (minDelayMs > 0) {
                await sleep(minDelayMs);
                return;
            }
            await nextAnimationFrame();
        },
    });
    if (!isLoadStillActive())
        return state;
    runEagerRender("post-texture-drain", { forceRender: true });
    if (!ensureNoPendingMeshHydrationBeforeReady()) {
        return state;
    }
    state.ready = true;
    setProgress(100, true);
    emitProgress({
        phase: "ready",
        progressMode: "percent",
        progressPercent: 100,
        loadedCount: null,
        totalCount: null,
    });
    hideProgress();
    flushLoadProfile("ok");
    return state;
}
