function toFiniteNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string" && value.trim() === "")
        return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return null;
    return numeric;
}
function normalizePath(value) {
    const trimmed = String(value || "").trim().replace(/[<>]/g, "");
    if (!trimmed)
        return null;
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
function toAxisToken(value) {
    const token = String(value || "").trim().toUpperCase();
    if (token.startsWith("Y"))
        return "Y";
    if (token.startsWith("Z"))
        return "Z";
    return "X";
}
function toVector3Tuple(value, fallback) {
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 3)
        return fallback;
    const x = toFiniteNumber(source[0]);
    const y = toFiniteNumber(source[1]);
    const z = toFiniteNumber(source[2]);
    if (x === null || y === null || z === null)
        return fallback;
    return [x, y, z];
}
function toQuaternionTuple(value, fallback) {
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 4)
        return fallback;
    const x = toFiniteNumber(source[0]);
    const y = toFiniteNumber(source[1]);
    const z = toFiniteNumber(source[2]);
    const w = toFiniteNumber(source[3]);
    if (x === null || y === null || z === null || w === null)
        return fallback;
    return [x, y, z, w];
}
function toQuaternionWxyzTuple(value, fallback) {
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 4)
        return fallback;
    const w = toFiniteNumber(source[0]);
    const x = toFiniteNumber(source[1]);
    const y = toFiniteNumber(source[2]);
    const z = toFiniteNumber(source[3]);
    if (x === null || y === null || z === null || w === null)
        return fallback;
    return [w, x, y, z];
}
function toQuaternionWxyzTupleAsXyzw(value, fallback) {
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 4)
        return fallback;
    const w = toFiniteNumber(source[0]);
    const x = toFiniteNumber(source[1]);
    const y = toFiniteNumber(source[2]);
    const z = toFiniteNumber(source[3]);
    if (x === null || y === null || z === null || w === null)
        return fallback;
    return [x, y, z, w];
}
function toCollisionPrimitiveCounts(value) {
    if (!value || typeof value !== "object")
        return {};
    const output = {};
    for (const [shape, countRaw] of Object.entries(value)) {
        const count = Number(countRaw);
        if (!shape || !Number.isFinite(count) || count <= 0)
            continue;
        output[String(shape)] = Math.floor(count);
    }
    return output;
}
function buildInvalidRenderRobotMetadataError(snapshot, context) {
    const details = [];
    if (snapshot?.stale === true) {
        details.push("stale");
    }
    if (Array.isArray(snapshot?.errorFlags) && snapshot.errorFlags.length > 0) {
        details.push(`errorFlags=${snapshot.errorFlags.join(",")}`);
    }
    if (snapshot?.truthLoadError) {
        details.push(`truthLoadError=${snapshot.truthLoadError}`);
    }
    const suffix = details.length > 0
        ? ` (${details.join("; ")})`
        : "";
    return new Error(`${context}${suffix}`);
}
function buildRenderRobotMetadataReadError(stageSourcePath, cause) {
    const target = stageSourcePath || "active-stage";
    return new Error(`Failed to read cached render robot metadata snapshot for "${target}".`, {
        cause,
    });
}
function shouldLogRobotMetadataErrors(options) {
    return options?.logErrors !== false;
}
function isRenderRobotMetadataSnapshotReady(snapshot) {
    if (!snapshot || typeof snapshot !== "object")
        return false;
    if (snapshot.stale === true)
        return false;
    if (Array.isArray(snapshot.errorFlags) && snapshot.errorFlags.length > 0)
        return false;
    if (typeof snapshot.truthLoadError === "string" && snapshot.truthLoadError.trim().length > 0)
        return false;
    return true;
}
export function normalizeRenderRobotMetadataSnapshot(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const normalizedErrorFlags = (Array.isArray(raw.errorFlags)
        ? raw.errorFlags
        : (raw.errorFlags && typeof raw.errorFlags.length === "number"
            ? Array.from(raw.errorFlags)
            : []))
        .map((entry) => String(entry || "").trim())
        .filter((entry) => entry.length > 0);
    const truthLoadError = String(raw.truthLoadError || "").trim() || null;
    const stale = raw.stale === true || normalizedErrorFlags.length > 0 || !!truthLoadError;
    const normalizedJointCatalogEntries = [];
    const rawJointCatalogEntries = Array.isArray(raw.jointCatalogEntries)
        ? raw.jointCatalogEntries
        : [];
    for (const entry of rawJointCatalogEntries) {
        const linkPath = normalizePath(entry?.linkPath || entry?.childLinkPath);
        if (!linkPath)
            continue;
        const jointPath = normalizePath(entry?.jointPath);
        const jointName = String(entry?.jointName || "").trim();
        const jointType = String(entry?.jointType || "PhysicsJoint").trim() || "PhysicsJoint";
        const jointTypeNameRaw = String(entry?.jointTypeName || "").trim();
        const parentLinkPath = normalizePath(entry?.parentLinkPath);
        const lowerLimitDeg = toFiniteNumber(entry?.lowerLimitDeg);
        const upperLimitDeg = toFiniteNumber(entry?.upperLimitDeg);
        const angleDeg = toFiniteNumber(entry?.angleDeg);
        const driveDamping = toFiniteNumber(entry?.driveDamping);
        const driveMaxForce = toFiniteNumber(entry?.driveMaxForce);
        const localPivotSource = entry?.localPivotInLink;
        const originXyzSource = entry?.originXyz;
        const originQuatWxyzSource = entry?.originQuatWxyz;
        normalizedJointCatalogEntries.push({
            linkPath,
            jointPath,
            jointName: jointName || (jointPath ? jointPath.split("/").pop() || "" : ""),
            jointType,
            jointTypeName: jointTypeNameRaw || null,
            parentLinkPath,
            axisToken: toAxisToken(entry?.axisToken),
            axisLocal: toVector3Tuple(entry?.axisLocal, [1, 0, 0]),
            lowerLimitDeg: lowerLimitDeg ?? -180,
            upperLimitDeg: upperLimitDeg ?? 180,
            angleDeg: angleDeg ?? null,
            driveDamping: driveDamping ?? null,
            driveMaxForce: driveMaxForce ?? null,
            localPivotInLink: Array.isArray(localPivotSource)
                ? toVector3Tuple(localPivotSource, [0, 0, 0])
                : null,
            originXyz: originXyzSource && typeof originXyzSource.length === "number"
                ? toVector3Tuple(originXyzSource, [0, 0, 0])
                : null,
            originQuatWxyz: originQuatWxyzSource && typeof originQuatWxyzSource.length === "number"
                ? toQuaternionWxyzTuple(originQuatWxyzSource, [1, 0, 0, 0])
                : null,
        });
    }
    const normalizedLinkDynamicsEntries = [];
    const rawLinkDynamicsEntries = Array.isArray(raw.linkDynamicsEntries)
        ? raw.linkDynamicsEntries
        : [];
    for (const entry of rawLinkDynamicsEntries) {
        const linkPath = normalizePath(entry?.linkPath);
        if (!linkPath)
            continue;
        const mass = toFiniteNumber(entry?.mass);
        const diagonalInertiaSource = entry?.diagonalInertia;
        const diagonalInertia = Array.isArray(diagonalInertiaSource)
            ? toVector3Tuple(diagonalInertiaSource, [0, 0, 0])
            : null;
        normalizedLinkDynamicsEntries.push({
            linkPath,
            mass,
            centerOfMassLocal: toVector3Tuple(entry?.centerOfMassLocal, [0, 0, 0]),
            diagonalInertia,
            principalAxesLocal: Array.isArray(entry?.principalAxesLocal)
                ? toQuaternionTuple(entry?.principalAxesLocal, [0, 0, 0, 1])
                : toQuaternionWxyzTupleAsXyzw(entry?.principalAxesLocalWxyz, [0, 0, 0, 1]),
        });
    }
    const meshCountsByLinkPathRaw = raw.meshCountsByLinkPath;
    const meshCountsByLinkPath = {};
    if (meshCountsByLinkPathRaw && typeof meshCountsByLinkPathRaw === "object") {
        for (const [rawLinkPath, rawCounts] of Object.entries(meshCountsByLinkPathRaw)) {
            const linkPath = normalizePath(rawLinkPath);
            if (!linkPath)
                continue;
            const visualMeshCount = Number(rawCounts?.visualMeshCount);
            const collisionMeshCount = Number(rawCounts?.collisionMeshCount);
            meshCountsByLinkPath[linkPath] = {
                visualMeshCount: Number.isFinite(visualMeshCount) ? Math.max(0, Math.floor(visualMeshCount)) : 0,
                collisionMeshCount: Number.isFinite(collisionMeshCount) ? Math.max(0, Math.floor(collisionMeshCount)) : 0,
                collisionPrimitiveCounts: toCollisionPrimitiveCounts(rawCounts?.collisionPrimitiveCounts),
            };
        }
    }
    const linkParentPairsRaw = Array.isArray(raw.linkParentPairs)
        ? raw.linkParentPairs
        : [];
    const linkParentPairs = [];
    for (const pair of linkParentPairsRaw) {
        if (!Array.isArray(pair) || pair.length <= 0)
            continue;
        const childLinkPath = normalizePath(pair[0]);
        if (!childLinkPath)
            continue;
        const parentLinkPath = normalizePath(pair[1]) || null;
        linkParentPairs.push([childLinkPath, parentLinkPath]);
    }
    return {
        stageSourcePath: String(raw.stageSourcePath || "").trim() || null,
        generatedAtMs: Number.isFinite(Number(raw.generatedAtMs))
            ? Number(raw.generatedAtMs)
            : Date.now(),
        source: String(raw.source || "unknown"),
        linkParentPairs,
        jointCatalogEntries: normalizedJointCatalogEntries,
        linkDynamicsEntries: normalizedLinkDynamicsEntries,
        meshCountsByLinkPath,
        ...(stale ? { stale: true } : {}),
        ...(normalizedErrorFlags.length > 0 ? { errorFlags: normalizedErrorFlags } : {}),
        ...(truthLoadError ? { truthLoadError } : {}),
    };
}
export function getRenderRobotMetadataSnapshot(renderInterface, stageSourcePath = null, options = {}) {
    const getter = renderInterface?.getCachedRobotMetadataSnapshot;
    if (typeof getter !== "function")
        return null;
    try {
        const snapshot = normalizeRenderRobotMetadataSnapshot(getter.call(renderInterface, stageSourcePath || null));
        return isRenderRobotMetadataSnapshotReady(snapshot) ? snapshot : null;
    }
    catch (error) {
        const wrappedError = buildRenderRobotMetadataReadError(stageSourcePath, error);
        if (shouldLogRobotMetadataErrors(options)) {
            console.error(`[robot-metadata] ${wrappedError.message}`, error);
        }
        if (options?.strictErrors === true) {
            throw wrappedError;
        }
        return null;
    }
}
export async function warmupRenderRobotMetadataSnapshot(renderInterface, options = {}) {
    const starter = renderInterface?.startRobotMetadataWarmupForStage;
    const stageSourcePath = String(options.stageSourcePath || "").trim() || null;
    const logErrors = shouldLogRobotMetadataErrors(options);
    const starterOptions = { ...options };
    delete starterOptions.stageSourcePath;
    delete starterOptions.logErrors;
    if (typeof starter !== "function") {
        return getRenderRobotMetadataSnapshot(renderInterface, stageSourcePath, {
            strictErrors: true,
            logErrors,
        });
    }
    let maybePromise;
    try {
        maybePromise = stageSourcePath
            ? starter.call(renderInterface, stageSourcePath, starterOptions)
            : starter.call(renderInterface, starterOptions);
    }
    catch (error) {
        const wrappedError = new Error(`Failed to warm up render robot metadata snapshot for "${stageSourcePath || "active-stage"}".`, {
            cause: error,
        });
        if (logErrors) {
            console.error(`[robot-metadata] ${wrappedError.message}`, error);
        }
        throw wrappedError;
    }
    let resolved;
    try {
        resolved = (maybePromise && typeof maybePromise.then === "function")
            ? await maybePromise
            : maybePromise;
    }
    catch (error) {
        const wrappedError = new Error(`Render robot metadata warmup rejected for "${stageSourcePath || "active-stage"}".`, {
            cause: error,
        });
        if (logErrors) {
            console.error(`[robot-metadata] ${wrappedError.message}`, error);
        }
        throw wrappedError;
    }
    const snapshot = normalizeRenderRobotMetadataSnapshot(resolved)
        || getRenderRobotMetadataSnapshot(renderInterface, stageSourcePath, {
            strictErrors: true,
            logErrors,
        });
    if (!snapshot)
        return null;
    if (!isRenderRobotMetadataSnapshotReady(snapshot)) {
        throw buildInvalidRenderRobotMetadataError(
            snapshot,
            `Render robot metadata snapshot for "${stageSourcePath || snapshot.stageSourcePath || "active-stage"}" is not usable.`,
        );
    }
    return snapshot;
}
