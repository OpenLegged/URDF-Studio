// @ts-nocheck
import { Color, Matrix4, Quaternion, Euler, Vector3 } from 'three';
import { getDefaultMaterial } from './default-material-state.js';
// @ts-ignore copied into public/vendor by scripts/sync-vendor.cjs; published via @openlegged/usd-text-parser.
import { normalizeUsdPathToken as normalizeUsdPathTokenFromPackage, extractUsdAssetReferencesFromLayerText as extractUsdAssetReferencesFromPackage, extractReferencePrimTargets as extractReferencePrimTargetsFromPackage, findMatchingClosingBraceIndex as findMatchingClosingBraceIndexFromPackage, extractScopeBodyText as extractScopeBodyTextFromPackage, parseVisualSemanticChildNamesFromLayerText as parseVisualSemanticChildNamesFromPackage, parseGuideCollisionReferencesFromLayerText as parseGuideCollisionReferencesFromPackage, parseColliderEntriesFromLayerText as parseColliderEntriesFromPackage, extractJointRecordsFromLayerText as extractJointRecordsFromPackage, parseLinkDynamicsPatchesFromLayerText as parseLinkDynamicsPatchesFromPackage, parseXformOpFallbacksFromLayerText as parseXformOpFallbacksFromPackage, } from '../../vendor/usd-text-parser/index.js';
export const debugTextures = false;
export const debugMaterials = false;
export const debugMeshes = false;
export const debugPrims = false;
export const debugInstancer = false;
export const disableTextures = false;
export const disableMaterials = false;
export const transformEpsilon = 1e-5;
export const defaultGrayComponent = new Color(0x888888).r;
export const hydraCallbackErrorCounts = new Map();
export const maxHydraCallbackErrorLogsPerMethod = 5;
export const materialBindingRepairMaxLayerTextLength = 2000000;
export const materialBindingWarningHandlers = new Set();
let materialBindingWarningInterceptorInstalled = false;
let activeMaterialBindingWarningOwner = null;
export const rawConsoleWarn = console.warn.bind(console);
export const rawConsoleError = console.error.bind(console);
export function disposeUsdHandle(usdModule, handle) {
    if (!handle)
        return;
    try {
        if (typeof handle.isDeleted === 'function' && handle.isDeleted()) {
            return;
        }
    }
    catch {
        // Ignore deleted-state probe failures and attempt direct disposal.
    }
    let deleted = false;
    try {
        if (typeof handle.delete === 'function') {
            handle.delete();
            deleted = true;
        }
    }
    catch (error) {
        rawConsoleWarn('[HydraDelegate] Failed to dispose USD handle.', error);
    }
    if (!deleted)
        return;
    try {
        usdModule?.flushPendingDeletes?.();
    }
    catch {
        // Flush is best-effort.
    }
}
export function logHydraCallbackError(label, error) {
    const key = String(label || "unknown");
    const previousCount = hydraCallbackErrorCounts.get(key) || 0;
    const nextCount = previousCount + 1;
    hydraCallbackErrorCounts.set(key, nextCount);
    if (previousCount >= maxHydraCallbackErrorLogsPerMethod)
        return;
    console.error(`[HydraDelegate] ${key} callback failed`, error);
}
export function wrapHydraCallbackObject(target, label) {
    if (!target || typeof target !== "object")
        return target;
    const wrappedMethods = new Map();
    return new Proxy(target, {
        get(currentTarget, property, receiver) {
            const value = Reflect.get(currentTarget, property, receiver);
            if (typeof value !== "function")
                return value;
            if (wrappedMethods.has(property)) {
                return wrappedMethods.get(property);
            }
            const wrappedMethod = (...args) => {
                try {
                    const result = value.apply(currentTarget, args);
                    if (result && typeof result.then === "function") {
                        return result.catch((error) => {
                            logHydraCallbackError(`${label}.${String(property)}`, error);
                            throw error;
                        });
                    }
                    return result;
                }
                catch (error) {
                    logHydraCallbackError(`${label}.${String(property)}`, error);
                    throw error;
                }
            };
            wrappedMethods.set(property, wrappedMethod);
            return wrappedMethod;
        },
    });
}
export function isNonZero(value, epsilon = transformEpsilon) {
    return Math.abs(value) > epsilon;
}
export function hasNonZeroTranslation(matrix, epsilon = transformEpsilon) {
    const elements = matrix.elements;
    return isNonZero(elements[12], epsilon) || isNonZero(elements[13], epsilon) || isNonZero(elements[14], epsilon);
}
export function getMatrixMaxElementDelta(lhs, rhs) {
    if (!lhs || !rhs || !lhs.elements || !rhs.elements)
        return Number.POSITIVE_INFINITY;
    let maxDelta = 0;
    for (let elementIndex = 0; elementIndex < 16; elementIndex++) {
        const lhsValue = Number(lhs.elements[elementIndex] || 0);
        const rhsValue = Number(rhs.elements[elementIndex] || 0);
        const delta = Math.abs(lhsValue - rhsValue);
        if (delta > maxDelta)
            maxDelta = delta;
    }
    return maxDelta;
}
export function getRootPathFromPrimPath(primPath) {
    if (!primPath || !primPath.startsWith('/'))
        return null;
    const firstSegment = primPath.split('/').filter(Boolean)[0] || null;
    return firstSegment ? `/${firstSegment}` : null;
}
export function getPathBasename(path) {
    if (!path || typeof path !== 'string')
        return '';
    const normalized = path.trim().replace(/[<>]/g, '');
    if (!normalized)
        return '';
    const segments = normalized.split('/').filter(Boolean);
    return segments[segments.length - 1] || '';
}
export function normalizeUsdPathToken(path) {
    return normalizeUsdPathTokenFromPackage(path);
}
export function extractUsdAssetReferencesFromLayerText(layerText, { baseOnly = false } = {}) {
    return extractUsdAssetReferencesFromPackage(layerText, { baseOnly });
}
export function isPotentiallyLargeBaseAssetPath(path) {
    const normalizedPath = String(path || '').toLowerCase();
    if (!normalizedPath)
        return false;
    const hasBaseToken = /(^|[\/_.-])base([\/_.-]|$)/.test(normalizedPath);
    if (!hasBaseToken)
        return false;
    if (normalizedPath.includes('collision') || normalizedPath.includes('collider') || normalizedPath.includes('guide')) {
        return false;
    }
    return true;
}
export function resolveUsdAssetPath(baseUsdPath, assetPath) {
    const normalizedAssetPath = String(assetPath || '').trim();
    if (!normalizedAssetPath)
        return null;
    if (/^[a-z]+:\/\//i.test(normalizedAssetPath))
        return normalizedAssetPath;
    if (normalizedAssetPath.startsWith('/'))
        return normalizedAssetPath;
    if (!baseUsdPath)
        return null;
    const baseWithoutQuery = String(baseUsdPath || '').split('?')[0];
    if (!baseWithoutQuery)
        return null;
    const baseSegments = baseWithoutQuery.split('/').filter(Boolean);
    if (baseSegments.length === 0)
        return null;
    baseSegments.pop();
    for (const segment of normalizedAssetPath.split('/')) {
        if (!segment || segment === '.')
            continue;
        if (segment === '..') {
            if (baseSegments.length > 0)
                baseSegments.pop();
            continue;
        }
        baseSegments.push(segment);
    }
    return `/${baseSegments.join('/')}`;
}
export function parseVector3Text(value, fallback = [0, 0, 0]) {
    const source = String(value || '').trim();
    if (!source)
        return fallback.slice(0, 3);
    const parts = source.split(/\s+/).map((entry) => Number(entry));
    if (parts.length < 3 || parts.some((entry) => !Number.isFinite(entry))) {
        return fallback.slice(0, 3);
    }
    return [parts[0], parts[1], parts[2]];
}
export function toQuaternionWxyzFromRpy(rpy) {
    const roll = Number(rpy?.[0] || 0);
    const pitch = Number(rpy?.[1] || 0);
    const yaw = Number(rpy?.[2] || 0);
    if (!Number.isFinite(roll) || !Number.isFinite(pitch) || !Number.isFinite(yaw)) {
        return [1, 0, 0, 0];
    }
    // URDF uses roll/pitch/yaw in the same convention as ROS `setRPY`, i.e.
    // R = Rz(yaw) * Ry(pitch) * Rx(roll). In three.js this matches `ZYX` order.
    const quaternion = new Quaternion().setFromEuler(new Euler(roll, pitch, yaw, 'ZYX')).normalize();
    return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
}
export function toMatrixFromUrdfOrigin(originXyz, originQuatWxyz) {
    const translation = new Vector3(originXyz[0], originXyz[1], originXyz[2]);
    const rotation = new Quaternion(originQuatWxyz[1], originQuatWxyz[2], originQuatWxyz[3], originQuatWxyz[0]).normalize();
    const matrix = new Matrix4();
    matrix.compose(translation, rotation, new Vector3(1, 1, 1));
    return matrix;
}
export function getCollisionGeometryTypeFromUrdfElement(collisionElement) {
    const geometryElement = collisionElement?.querySelector?.('geometry');
    if (!geometryElement)
        return 'mesh';
    if (geometryElement.querySelector('box'))
        return 'box';
    if (geometryElement.querySelector('sphere'))
        return 'sphere';
    if (geometryElement.querySelector('cylinder'))
        return 'cylinder';
    if (geometryElement.querySelector('capsule'))
        return 'capsule';
    if (geometryElement.querySelector('mesh'))
        return 'mesh';
    return 'mesh';
}
function toFiniteNumberOrNull(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return null;
    return numeric;
}
function diagonalizeSymmetricMatrix3(matrix3x3) {
    const a = [
        [Number(matrix3x3?.[0]?.[0] || 0), Number(matrix3x3?.[0]?.[1] || 0), Number(matrix3x3?.[0]?.[2] || 0)],
        [Number(matrix3x3?.[1]?.[0] || 0), Number(matrix3x3?.[1]?.[1] || 0), Number(matrix3x3?.[1]?.[2] || 0)],
        [Number(matrix3x3?.[2]?.[0] || 0), Number(matrix3x3?.[2]?.[1] || 0), Number(matrix3x3?.[2]?.[2] || 0)],
    ];
    const v = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
    ];
    const sweepPairs = [
        [0, 1],
        [0, 2],
        [1, 2],
    ];
    const maxSweeps = 20;
    for (let sweep = 0; sweep < maxSweeps; sweep++) {
        let changed = false;
        for (const [p, q] of sweepPairs) {
            const apq = Number(a[p][q] || 0);
            if (!Number.isFinite(apq) || Math.abs(apq) <= 1e-12)
                continue;
            const app = Number(a[p][p] || 0);
            const aqq = Number(a[q][q] || 0);
            const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
            const c = Math.cos(theta);
            const s = Math.sin(theta);
            for (let row = 0; row < 3; row++) {
                const arp = Number(a[row][p] || 0);
                const arq = Number(a[row][q] || 0);
                a[row][p] = c * arp - s * arq;
                a[row][q] = s * arp + c * arq;
            }
            for (let col = 0; col < 3; col++) {
                const apc = Number(a[p][col] || 0);
                const aqc = Number(a[q][col] || 0);
                a[p][col] = c * apc - s * aqc;
                a[q][col] = s * apc + c * aqc;
            }
            a[p][q] = 0;
            a[q][p] = 0;
            for (let row = 0; row < 3; row++) {
                const vrp = Number(v[row][p] || 0);
                const vrq = Number(v[row][q] || 0);
                v[row][p] = c * vrp - s * vrq;
                v[row][q] = s * vrp + c * vrq;
            }
            changed = true;
        }
        if (!changed)
            break;
    }
    const eigenPairs = [
        { value: Number(a[0][0] || 0), axis: new Vector3(Number(v[0][0] || 0), Number(v[1][0] || 0), Number(v[2][0] || 0)) },
        { value: Number(a[1][1] || 0), axis: new Vector3(Number(v[0][1] || 0), Number(v[1][1] || 0), Number(v[2][1] || 0)) },
        { value: Number(a[2][2] || 0), axis: new Vector3(Number(v[0][2] || 0), Number(v[1][2] || 0), Number(v[2][2] || 0)) },
    ];
    eigenPairs.sort((left, right) => right.value - left.value);
    const xAxis = eigenPairs[0].axis.lengthSq() > 1e-12 ? eigenPairs[0].axis.clone().normalize() : new Vector3(1, 0, 0);
    let yAxis = eigenPairs[1].axis.lengthSq() > 1e-12 ? eigenPairs[1].axis.clone().normalize() : new Vector3(0, 1, 0);
    let zAxis = new Vector3().crossVectors(xAxis, yAxis);
    if (zAxis.lengthSq() <= 1e-12) {
        zAxis = eigenPairs[2].axis.lengthSq() > 1e-12 ? eigenPairs[2].axis.clone().normalize() : new Vector3(0, 0, 1);
        yAxis = new Vector3().crossVectors(zAxis, xAxis).normalize();
    }
    else {
        zAxis.normalize();
        yAxis = new Vector3().crossVectors(zAxis, xAxis).normalize();
    }
    if (new Vector3().crossVectors(xAxis, yAxis).dot(zAxis) < 0) {
        zAxis.multiplyScalar(-1);
    }
    const rotationMatrix = new Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const quaternion = new Quaternion().setFromRotationMatrix(rotationMatrix).normalize();
    return {
        diagonalInertia: [
            Math.max(0, Number(eigenPairs[0].value || 0)),
            Math.max(0, Number(eigenPairs[1].value || 0)),
            Math.max(0, Number(eigenPairs[2].value || 0)),
        ],
        principalAxesLocalWxyz: [quaternion.w, quaternion.x, quaternion.y, quaternion.z],
    };
}
function multiplyQuaternionWxyz(leftWxyz, rightWxyz) {
    const left = new Quaternion(Number(leftWxyz?.[1] ?? 0), Number(leftWxyz?.[2] ?? 0), Number(leftWxyz?.[3] ?? 0), Number(leftWxyz?.[0] ?? 1)).normalize();
    const right = new Quaternion(Number(rightWxyz?.[1] ?? 0), Number(rightWxyz?.[2] ?? 0), Number(rightWxyz?.[3] ?? 0), Number(rightWxyz?.[0] ?? 1)).normalize();
    const combined = left.multiply(right).normalize();
    return [combined.w, combined.x, combined.y, combined.z];
}
export function parseUrdfTruthFromText(urdfText) {
    const text = String(urdfText || '');
    if (!text.trim())
        return null;
    if (typeof DOMParser !== 'function')
        return null;
    try {
        const document = new DOMParser().parseFromString(text, 'application/xml');
        if (!document || document.querySelector('parsererror'))
            return null;
        const collisionsByLinkName = new Map();
        const visualsByLinkName = new Map();
        const jointByChildLinkName = new Map();
        const inertialByLinkName = new Map();
        const linkElements = Array.from(document.querySelectorAll('robot > link'));
        for (const linkElement of linkElements) {
            const linkName = String(linkElement.getAttribute('name') || '').trim();
            if (!linkName)
                continue;
            const allEntries = [];
            const byType = new Map();
            const collisionElements = Array.from(linkElement.querySelectorAll(':scope > collision'));
            for (const collisionElement of collisionElements) {
                const originElement = collisionElement.querySelector('origin');
                const originXyz = parseVector3Text(originElement?.getAttribute('xyz'), [0, 0, 0]);
                const originRpy = parseVector3Text(originElement?.getAttribute('rpy'), [0, 0, 0]);
                const originQuatWxyz = toQuaternionWxyzFromRpy(originRpy);
                const geometryType = getCollisionGeometryTypeFromUrdfElement(collisionElement);
                const entry = {
                    linkName,
                    geometryType,
                    originXyz,
                    originRpy,
                    originQuatWxyz,
                    localMatrix: toMatrixFromUrdfOrigin(originXyz, originQuatWxyz),
                };
                allEntries.push(entry);
                const typedEntries = byType.get(geometryType) || [];
                typedEntries.push(entry);
                byType.set(geometryType, typedEntries);
            }
            collisionsByLinkName.set(linkName, {
                all: allEntries,
                byType,
            });
            const visualEntries = [];
            const visualElements = Array.from(linkElement.querySelectorAll(':scope > visual'));
            for (const visualElement of visualElements) {
                const originElement = visualElement.querySelector('origin');
                const originXyz = parseVector3Text(originElement?.getAttribute('xyz'), [0, 0, 0]);
                const originRpy = parseVector3Text(originElement?.getAttribute('rpy'), [0, 0, 0]);
                const originQuatWxyz = toQuaternionWxyzFromRpy(originRpy);
                visualEntries.push({
                    linkName,
                    originXyz,
                    originRpy,
                    originQuatWxyz,
                    localMatrix: toMatrixFromUrdfOrigin(originXyz, originQuatWxyz),
                });
            }
            visualsByLinkName.set(linkName, visualEntries);
            const inertialElement = linkElement.querySelector(':scope > inertial');
            if (inertialElement) {
                const inertialOriginElement = inertialElement.querySelector('origin');
                const inertialOriginXyz = parseVector3Text(inertialOriginElement?.getAttribute('xyz'), [0, 0, 0]);
                const inertialOriginRpy = parseVector3Text(inertialOriginElement?.getAttribute('rpy'), [0, 0, 0]);
                const inertialOriginQuatWxyz = toQuaternionWxyzFromRpy(inertialOriginRpy);
                const mass = toFiniteNumberOrNull(inertialElement.querySelector('mass')?.getAttribute('value'));
                const inertiaElement = inertialElement.querySelector('inertia');
                const ixx = toFiniteNumberOrNull(inertiaElement?.getAttribute('ixx'));
                const ixy = toFiniteNumberOrNull(inertiaElement?.getAttribute('ixy'));
                const ixz = toFiniteNumberOrNull(inertiaElement?.getAttribute('ixz'));
                const iyy = toFiniteNumberOrNull(inertiaElement?.getAttribute('iyy'));
                const iyz = toFiniteNumberOrNull(inertiaElement?.getAttribute('iyz'));
                const izz = toFiniteNumberOrNull(inertiaElement?.getAttribute('izz'));
                const inertiaAllFinite = (ixx !== null
                    && ixy !== null
                    && ixz !== null
                    && iyy !== null
                    && iyz !== null
                    && izz !== null);
                let diagonalInertia = null;
                let principalAxesLocalWxyz = inertialOriginQuatWxyz.slice(0, 4);
                if (inertiaAllFinite) {
                    const inertialTensor = [
                        [ixx, ixy, ixz],
                        [ixy, iyy, iyz],
                        [ixz, iyz, izz],
                    ];
                    const principalInInertialFrame = diagonalizeSymmetricMatrix3(inertialTensor);
                    diagonalInertia = principalInInertialFrame.diagonalInertia;
                    principalAxesLocalWxyz = multiplyQuaternionWxyz(inertialOriginQuatWxyz, principalInInertialFrame.principalAxesLocalWxyz);
                }
                else if (ixx !== null && iyy !== null && izz !== null) {
                    diagonalInertia = [Math.max(0, ixx), Math.max(0, iyy), Math.max(0, izz)];
                }
                const hasInertialData = (mass !== null
                    || (diagonalInertia && diagonalInertia.some((value) => Math.abs(value) > 1e-12))
                    || inertialOriginXyz.some((value) => Math.abs(Number(value) || 0) > 1e-12));
                if (hasInertialData) {
                    inertialByLinkName.set(linkName, {
                        linkName,
                        mass,
                        centerOfMassLocal: inertialOriginXyz,
                        diagonalInertia,
                        principalAxesLocalWxyz,
                        inertiaTensorInInertialFrame: inertiaAllFinite
                            ? { ixx, ixy, ixz, iyy, iyz, izz }
                            : null,
                    });
                }
            }
        }
        const jointElements = Array.from(document.querySelectorAll('robot > joint'));
        for (const jointElement of jointElements) {
            const jointName = String(jointElement.getAttribute('name') || '').trim();
            const jointType = String(jointElement.getAttribute('type') || '').trim().toLowerCase();
            const parentLinkName = String(jointElement.querySelector('parent')?.getAttribute('link') || '').trim();
            const childLinkName = String(jointElement.querySelector('child')?.getAttribute('link') || '').trim();
            if (!childLinkName)
                continue;
            const originElement = jointElement.querySelector('origin');
            const originXyz = parseVector3Text(originElement?.getAttribute('xyz'), [0, 0, 0]);
            const originRpy = parseVector3Text(originElement?.getAttribute('rpy'), [0, 0, 0]);
            const originQuatWxyz = toQuaternionWxyzFromRpy(originRpy);
            const axisVectorRaw = parseVector3Text(jointElement.querySelector('axis')?.getAttribute('xyz'), [1, 0, 0]);
            const axisLength = Math.hypot(axisVectorRaw[0], axisVectorRaw[1], axisVectorRaw[2]) || 0;
            const axisLocal = axisLength > 1e-8
                ? [axisVectorRaw[0] / axisLength, axisVectorRaw[1] / axisLength, axisVectorRaw[2] / axisLength]
                : [1, 0, 0];
            let lowerLimitDeg = null;
            let upperLimitDeg = null;
            if (jointType === 'continuous') {
                lowerLimitDeg = -180;
                upperLimitDeg = 180;
            }
            else {
                const limitElement = jointElement.querySelector('limit');
                const lowerLimitRaw = Number(limitElement?.getAttribute('lower'));
                const upperLimitRaw = Number(limitElement?.getAttribute('upper'));
                const lowerLimitRad = Number.isFinite(lowerLimitRaw) ? lowerLimitRaw : null;
                const upperLimitRad = Number.isFinite(upperLimitRaw) ? upperLimitRaw : null;
                lowerLimitDeg = lowerLimitRad !== null ? (lowerLimitRad * 180) / Math.PI : null;
                upperLimitDeg = upperLimitRad !== null ? (upperLimitRad * 180) / Math.PI : null;
            }
            jointByChildLinkName.set(childLinkName, {
                jointName,
                jointType,
                parentLinkName: parentLinkName || null,
                childLinkName,
                axisLocal,
                lowerLimitDeg,
                upperLimitDeg,
                originXyz,
                originRpy,
                originQuatWxyz,
                localMatrix: toMatrixFromUrdfOrigin(originXyz, originQuatWxyz),
            });
        }
        return {
            collisionsByLinkName,
            visualsByLinkName,
            jointByChildLinkName,
            inertialByLinkName,
        };
    }
    catch {
        return null;
    }
}
export function resolveUrdfTruthFileNameForStagePath(stageSourcePath) {
    const normalizedPath = String(stageSourcePath || '').trim().toLowerCase();
    if (!normalizedPath)
        return null;
    const fileName = normalizedPath.split('/').pop() || '';
    const stem = fileName.replace(/\.usd[a-z]?$/i, '');
    const knownMapping = {
        g1_29dof_rev_1_0: 'g1_29dof_rev_1_0.urdf',
        g1_23dof_rev_1_0: 'g1_23dof_rev_1_0.urdf',
        go2: 'go2_description.urdf',
        go2w: 'go2w_description.urdf',
        h1: 'h1.urdf',
        h1_2: 'h1_2.urdf',
        h1_2_handless: 'h1_2_handless.urdf',
        b2: 'b2_description.urdf',
        b2w: 'b2w_description.urdf',
    };
    if (stem && knownMapping[stem]) {
        return knownMapping[stem];
    }
    const knownEntries = Object.entries(knownMapping).sort((left, right) => right[0].length - left[0].length);
    for (const [token, urdfFileName] of knownEntries) {
        if (normalizedPath.includes(token))
            return urdfFileName;
    }
    if (!stem)
        return null;
    return `${stem}.urdf`;
}
export function shouldAllowLargeBaseAssetScan(stageSourcePath) {
    const normalizedStagePath = String(stageSourcePath || '').trim().toLowerCase();
    if (!normalizedStagePath)
        return false;
    const urdfFileName = String(resolveUrdfTruthFileNameForStagePath(stageSourcePath) || '').toLowerCase();
    const allowedUrdfFileNames = new Set([
        'g1_29dof_rev_1_0.urdf',
        'g1_23dof_rev_1_0.urdf',
        'go2_description.urdf',
        'go2w_description.urdf',
        'h1.urdf',
        'h1_2.urdf',
        'h1_2_handless.urdf',
        'b2_description.urdf',
        'b2w_description.urdf',
    ]);
    if (allowedUrdfFileNames.has(urdfFileName)) {
        return true;
    }
    if (normalizedStagePath.includes('/unitree_model/go2/'))
        return true;
    if (normalizedStagePath.includes('/unitree_model/go2w/'))
        return true;
    if (normalizedStagePath.includes('/unitree_model/g1/'))
        return true;
    if (normalizedStagePath.includes('/unitree_model/h1/'))
        return true;
    if (normalizedStagePath.includes('/unitree_model/h1-2/'))
        return true;
    if (normalizedStagePath.includes('/unitree_model/b2/'))
        return true;
    if (normalizedStagePath.includes('/unitree_model/b2w/'))
        return true;
    return false;
}
export function extractReferencePrimTargets(value) {
    return extractReferencePrimTargetsFromPackage(value);
}
export function extractScopeBodyText(layerText, scopeName) {
    return extractScopeBodyTextFromPackage(layerText, scopeName);
}
const USD_PRIM_HEADER_REGEX = /^\s*(?:def|over|class)(?:\s+(\w+))?\s+"([^"]+)"/gm;
const VISUAL_SCOPE_NAMES = new Set(['visuals']);
const COLLISION_SCOPE_NAMES = new Set(['collider', 'colliders', 'collision', 'collisions']);
function buildUsdPathFromSegments(segments) {
    if (!Array.isArray(segments) || segments.length === 0) {
        return '';
    }
    return normalizeUsdPathToken(`/${segments.filter(Boolean).join('/')}`);
}
function walkUsdNamedPrimBlocks(source, visitor, parentSegments = []) {
    if (!source || typeof source !== 'string' || typeof visitor !== 'function') {
        return;
    }
    const headerRegex = new RegExp(USD_PRIM_HEADER_REGEX);
    let match = null;
    while ((match = headerRegex.exec(source))) {
        const primType = String(match[1] || '').trim();
        const primName = String(match[2] || '').trim();
        if (!primName) {
            continue;
        }
        const openingBraceIndex = source.indexOf('{', headerRegex.lastIndex);
        if (openingBraceIndex < 0) {
            continue;
        }
        const closingBraceIndex = findMatchingClosingBraceIndexFromPackage(source, openingBraceIndex);
        if (closingBraceIndex < 0) {
            continue;
        }
        const pathSegments = parentSegments.concat(primName);
        const primPath = buildUsdPathFromSegments(pathSegments);
        const primText = source.slice(match.index, closingBraceIndex + 1);
        const bodyText = source.slice(openingBraceIndex + 1, closingBraceIndex);
        visitor({
            name: primName,
            primType,
            path: primPath,
            pathSegments,
            text: primText,
            body: bodyText,
        });
        walkUsdNamedPrimBlocks(bodyText, visitor, pathSegments);
        headerRegex.lastIndex = closingBraceIndex + 1;
    }
}
function extractImmediatePropertyTextFromPrimBody(bodyText) {
    if (!bodyText || typeof bodyText !== 'string') {
        return '';
    }
    const nestedPrimRegex = new RegExp(USD_PRIM_HEADER_REGEX);
    const nestedPrimMatch = nestedPrimRegex.exec(bodyText);
    if (!nestedPrimMatch || typeof nestedPrimMatch.index !== 'number') {
        return bodyText;
    }
    return bodyText.slice(0, nestedPrimMatch.index);
}
function parseScopedLinkEntryPath(primPath, scopeNames) {
    const normalizedPath = normalizeUsdPathToken(primPath);
    if (!normalizedPath || !(scopeNames instanceof Set) || scopeNames.size === 0) {
        return null;
    }
    const segments = normalizedPath.split('/').filter(Boolean);
    for (let index = 0; index < segments.length; index += 1) {
        const scopeName = String(segments[index] || '').trim().toLowerCase();
        if (!scopeNames.has(scopeName)) {
            continue;
        }
        if (index === 0) {
            const linkName = String(segments[index + 1] || '').trim();
            const entryName = String(segments[index + 2] || '').trim();
            return {
                normalizedPath,
                segments,
                scopeName,
                scopeIndex: index,
                linkName,
                entryName,
                entryPath: buildUsdPathFromSegments(segments.slice(0, Math.min(segments.length, 3))),
            };
        }
        const linkName = String(segments[index - 1] || '').trim();
        const entryName = String(segments[index + 1] || '').trim();
        return {
            normalizedPath,
            segments,
            scopeName,
            scopeIndex: index,
            linkName,
            entryName,
            entryPath: buildUsdPathFromSegments(segments.slice(0, Math.min(segments.length, index + 2))),
        };
    }
    return null;
}
function addScopedEntry(targetMap, linkName, entryName, referencePath = null) {
    const normalizedLinkName = String(linkName || '').trim();
    const normalizedEntryName = String(entryName || '').trim();
    const normalizedReferencePath = referencePath ? normalizeUsdPathToken(referencePath) : null;
    if (!normalizedLinkName || !normalizedEntryName) {
        return;
    }
    const existingEntries = targetMap.get(normalizedLinkName) || [];
    if (existingEntries.some((entry) => entry.entryName === normalizedEntryName && entry.referencePath === normalizedReferencePath)) {
        return;
    }
    existingEntries.push({
        entryName: normalizedEntryName,
        referencePath: normalizedReferencePath,
    });
    targetMap.set(normalizedLinkName, existingEntries);
}
function unescapeUsdStringValue(value) {
    return String(value || '')
        .replace(/\\\"/g, '"')
        .replace(/\\\\/g, '\\');
}
function extractUsdMaterialBindingTarget(metadataText) {
    if (!metadataText || typeof metadataText !== 'string') {
        return '';
    }
    const bindingMatch = metadataText.match(/\brel\s+material:binding(?:[:\w-]+)?\s*=\s*<([^>]+)>/i);
    return bindingMatch?.[1] ? normalizeUsdPathToken(bindingMatch[1]) : '';
}
function parseUsdIntegerArrayLiteral(arrayLiteral) {
    const raw = String(arrayLiteral || '').trim();
    if (!raw) {
        return [];
    }
    return raw
        .split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .map((value) => Math.floor(value));
}
function compressUsdFaceIndicesToContiguousRanges(indices) {
    if (!Array.isArray(indices) || indices.length === 0) {
        return [];
    }
    const sortedUniqueIndices = Array.from(new Set(indices))
        .sort((left, right) => left - right);
    if (sortedUniqueIndices.length === 0) {
        return [];
    }
    const ranges = [];
    let rangeStart = sortedUniqueIndices[0];
    let rangeEnd = rangeStart;
    for (let index = 1; index < sortedUniqueIndices.length; index += 1) {
        const currentValue = sortedUniqueIndices[index];
        if (currentValue === rangeEnd + 1) {
            rangeEnd = currentValue;
            continue;
        }
        ranges.push({
            start: rangeStart,
            length: rangeEnd - rangeStart + 1,
        });
        rangeStart = currentValue;
        rangeEnd = currentValue;
    }
    ranges.push({
        start: rangeStart,
        length: rangeEnd - rangeStart + 1,
    });
    return ranges;
}
export function parseVisualSemanticChildNamesFromLayerText(layerText) {
    const linkToChildNames = new Map();
    walkUsdNamedPrimBlocks(layerText, ({ path }) => {
        const scopedPath = parseScopedLinkEntryPath(path, VISUAL_SCOPE_NAMES);
        if (!scopedPath?.linkName || !scopedPath.entryName) {
            return;
        }
        const existingNames = linkToChildNames.get(scopedPath.linkName) || [];
        if (!existingNames.includes(scopedPath.entryName)) {
            existingNames.push(scopedPath.entryName);
            linkToChildNames.set(scopedPath.linkName, existingNames);
        }
    });
    return linkToChildNames;
}
export function parseGuideCollisionReferencesFromLayerText(layerText) {
    const linkToGuideEntries = new Map();
    walkUsdNamedPrimBlocks(layerText, ({ path, text, body }) => {
        const scopedPath = parseScopedLinkEntryPath(path, COLLISION_SCOPE_NAMES);
        if (!scopedPath?.linkName || !scopedPath.entryName || scopedPath.normalizedPath !== scopedPath.entryPath) {
            return;
        }
        const openingBraceIndex = text.indexOf('{');
        const headerText = openingBraceIndex >= 0 ? text.slice(0, openingBraceIndex) : text;
        const immediateProperties = extractImmediatePropertyTextFromPrimBody(body);
        const metadataText = `${headerText}\n${immediateProperties}`;
        const hasGuidePurpose = /(?:^|\s)(?:uniform\s+)?token\s+purpose\s*=\s*(?:"guide"|guide)\b/i.test(metadataText);
        const referencePaths = extractReferencePrimTargets(metadataText);
        if (!hasGuidePurpose && referencePaths.length === 0) {
            return;
        }
        if (referencePaths.length === 0) {
            addScopedEntry(linkToGuideEntries, scopedPath.linkName, scopedPath.entryName, null);
            return;
        }
        for (const referencePath of referencePaths) {
            addScopedEntry(linkToGuideEntries, scopedPath.linkName, scopedPath.entryName, referencePath);
        }
    });
    return linkToGuideEntries;
}
export function parseColliderEntriesFromLayerText(layerText) {
    const linkToColliderEntries = new Map();
    walkUsdNamedPrimBlocks(layerText, ({ path }) => {
        const scopedPath = parseScopedLinkEntryPath(path, COLLISION_SCOPE_NAMES);
        if (!scopedPath?.linkName || !scopedPath.entryName || scopedPath.normalizedPath !== scopedPath.entryPath) {
            return;
        }
        addScopedEntry(linkToColliderEntries, scopedPath.linkName, scopedPath.entryName, null);
    });
    return linkToColliderEntries;
}
export function parseUrdfMaterialMetadataFromLayerText(layerText) {
    const materialMetadataByPrimPath = new Map();
    walkUsdNamedPrimBlocks(layerText, ({ path, text, body }) => {
        const openingBraceIndex = text.indexOf('{');
        const headerText = openingBraceIndex >= 0 ? text.slice(0, openingBraceIndex) : text;
        const immediateProperties = extractImmediatePropertyTextFromPrimBody(body);
        const metadataText = `${headerText}\n${immediateProperties}`;
        const colorMatch = metadataText.match(/urdf:materialColor\s*=\s*"([^"]+)"/i);
        const textureMatch = metadataText.match(/urdf:materialTexture\s*=\s*"([^"]+)"/i);
        if (!colorMatch && !textureMatch) {
            return;
        }
        const normalizedPath = normalizeUsdPathToken(path);
        if (!normalizedPath) {
            return;
        }
        const existingMetadata = materialMetadataByPrimPath.get(normalizedPath) || {};
        if (colorMatch?.[1]) {
            existingMetadata.color = unescapeUsdStringValue(colorMatch[1]);
        }
        if (textureMatch?.[1]) {
            existingMetadata.texture = unescapeUsdStringValue(textureMatch[1]);
        }
        materialMetadataByPrimPath.set(normalizedPath, existingMetadata);
    });
    return materialMetadataByPrimPath;
}
export function parseUsdMaterialBindingsFromLayerText(layerText) {
    const materialBindingsByPrimPath = new Map();
    const referenceTargetsByPrimPath = new Map();
    const mergeBindingEntry = (primPath, rawEntry) => {
        const normalizedPrimPath = normalizeUsdPathToken(primPath);
        if (!normalizedPrimPath || !rawEntry || typeof rawEntry !== 'object') {
            return;
        }
        const existingEntry = materialBindingsByPrimPath.get(normalizedPrimPath) || {
            materialId: null,
            geomSubsetSections: [],
        };
        const nextMaterialId = normalizeUsdPathToken(rawEntry.materialId || '');
        if (!existingEntry.materialId && nextMaterialId) {
            existingEntry.materialId = nextMaterialId;
        }
        const rawSections = Array.isArray(rawEntry.geomSubsetSections)
            ? rawEntry.geomSubsetSections
            : [];
        const mergedSections = Array.isArray(existingEntry.geomSubsetSections)
            ? existingEntry.geomSubsetSections.slice()
            : [];
        const knownSectionKeys = new Set(mergedSections.map((section) => `${section.start}:${section.length}:${section.materialId}`));
        for (const rawSection of rawSections) {
            const start = Number(rawSection?.start);
            const length = Number(rawSection?.length);
            const materialId = normalizeUsdPathToken(rawSection?.materialId || '');
            if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0 || !materialId) {
                continue;
            }
            const nextSection = {
                start: Math.max(0, Math.floor(start)),
                length: Math.max(0, Math.floor(length)),
                materialId,
            };
            const sectionKey = `${nextSection.start}:${nextSection.length}:${nextSection.materialId}`;
            if (knownSectionKeys.has(sectionKey)) {
                continue;
            }
            knownSectionKeys.add(sectionKey);
            mergedSections.push(nextSection);
        }
        mergedSections.sort((left, right) => {
            if (left.start !== right.start) {
                return left.start - right.start;
            }
            if (left.length !== right.length) {
                return left.length - right.length;
            }
            return String(left.materialId || '').localeCompare(String(right.materialId || ''));
        });
        if (existingEntry.materialId || mergedSections.length > 0) {
            materialBindingsByPrimPath.set(normalizedPrimPath, {
                materialId: existingEntry.materialId || null,
                geomSubsetSections: mergedSections,
            });
        }
    };
    walkUsdNamedPrimBlocks(layerText, ({ primType, path, text, body, pathSegments }) => {
        const openingBraceIndex = text.indexOf('{');
        const headerText = openingBraceIndex >= 0 ? text.slice(0, openingBraceIndex) : text;
        const immediateProperties = extractImmediatePropertyTextFromPrimBody(body);
        const metadataText = `${headerText}\n${immediateProperties}`;
        const normalizedPrimType = String(primType || '').trim().toLowerCase();
        const materialId = extractUsdMaterialBindingTarget(metadataText);
        const referenceTargets = extractReferencePrimTargets(metadataText)
            .map((target) => normalizeUsdPathToken(target))
            .filter(Boolean);
        const normalizedPath = normalizeUsdPathToken(path);
        if (normalizedPath && referenceTargets.length > 0) {
            referenceTargetsByPrimPath.set(normalizedPath, referenceTargets);
        }
        if (normalizedPrimType === 'geomsubset') {
            if (!materialId || !Array.isArray(pathSegments) || pathSegments.length < 2) {
                return;
            }
            const parentPrimPath = buildUsdPathFromSegments(pathSegments.slice(0, -1));
            if (!parentPrimPath) {
                return;
            }
            const indicesMatch = metadataText.match(/\bint\[\]\s+indices\s*=\s*\[([\s\S]*?)\]/i);
            const faceIndices = parseUsdIntegerArrayLiteral(indicesMatch?.[1] || '');
            const geomSubsetSections = compressUsdFaceIndicesToContiguousRanges(faceIndices)
                .map((range) => ({
                ...range,
                materialId,
            }));
            if (geomSubsetSections.length === 0) {
                return;
            }
            mergeBindingEntry(parentPrimPath, {
                materialId: null,
                geomSubsetSections,
            });
            return;
        }
        if (!materialId) {
            return;
        }
        mergeBindingEntry(path, {
            materialId,
            geomSubsetSections: [],
        });
    });
    Array.from(materialBindingsByPrimPath.entries()).forEach(([primPath, entry]) => {
        const referenceTargets = referenceTargetsByPrimPath.get(primPath) || [];
        referenceTargets.forEach((referenceTarget) => {
            mergeBindingEntry(referenceTarget, entry);
        });
    });
    return materialBindingsByPrimPath;
}
export function findMatchingClosingBraceIndex(source, openingBraceIndex) {
    return findMatchingClosingBraceIndexFromPackage(source, openingBraceIndex);
}
function parseVector3FromTupleLiteral(tupleLiteral) {
    if (!tupleLiteral)
        return null;
    const source = String(tupleLiteral || '')
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((part) => Number.isFinite(part));
    if (source.length < 3)
        return null;
    return [source[0], source[1], source[2]];
}
function parseQuaternionWxyzFromTupleLiteral(tupleLiteral) {
    if (!tupleLiteral)
        return null;
    const source = String(tupleLiteral || '')
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((part) => Number.isFinite(part));
    if (source.length < 4)
        return null;
    const quaternion = new Quaternion(source[1], source[2], source[3], source[0]);
    if (!Number.isFinite(quaternion.lengthSq()) || quaternion.lengthSq() <= 1e-12)
        return null;
    quaternion.normalize();
    return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
}
function normalizeAxisToken(value) {
    const token = String(value || 'X').trim().toUpperCase();
    if (token.startsWith('Y'))
        return 'Y';
    if (token.startsWith('Z'))
        return 'Z';
    return 'X';
}
export function extractJointRecordsFromLayerText(layerText) {
    return extractJointRecordsFromPackage(layerText);
}
function countBracesOutsideStrings(source) {
    let openCount = 0;
    let closeCount = 0;
    let insideString = false;
    for (let cursor = 0; cursor < source.length; cursor++) {
        const character = source[cursor];
        const previousCharacter = cursor > 0 ? source[cursor - 1] : '';
        if (character === '"' && previousCharacter !== '\\') {
            insideString = !insideString;
            continue;
        }
        if (insideString)
            continue;
        if (character === '{')
            openCount++;
        else if (character === '}')
            closeCount++;
    }
    return { openCount, closeCount };
}
function composeChildPrimPath(parentPrimPath, childPrimName) {
    const normalizedChildName = String(childPrimName || '').trim();
    if (!normalizedChildName)
        return '';
    if (normalizedChildName.startsWith('/'))
        return normalizeUsdPathToken(normalizedChildName);
    if (!parentPrimPath)
        return `/${normalizedChildName}`;
    return `${parentPrimPath}/${normalizedChildName}`;
}
function ensureLinkDynamicsPatch(target, linkPath) {
    const normalizedLinkPath = normalizeUsdPathToken(linkPath);
    if (!normalizedLinkPath)
        return null;
    const existing = target.get(normalizedLinkPath);
    if (existing)
        return existing;
    const created = {};
    target.set(normalizedLinkPath, created);
    return created;
}
export function parseLinkDynamicsPatchesFromLayerText(layerText) {
    return parseLinkDynamicsPatchesFromPackage(layerText);
}
export function parseXformOpFallbacksFromLayerText(layerText) {
    return parseXformOpFallbacksFromPackage(layerText);
}
export function stringifyConsoleArgs(args) {
    return (Array.isArray(args) ? args : [args]).map((value) => {
        if (typeof value === 'string')
            return value;
        try {
            return JSON.stringify(value);
        }
        catch {
            return String(value);
        }
    }).join(' ');
}
export function isMaterialBindingApiWarningMessage(message) {
    if (!message)
        return false;
    return message.includes('BindingsAtPrim') && message.includes('MaterialBindingAPI');
}
export function extractPrimPathFromMaterialBindingWarning(message) {
    if (!message)
        return null;
    const match = message.match(/path\s*\(([^)]+)\)/i);
    const path = String(match?.[1] || '').trim();
    return path || null;
}
export function getRawConsoleMethod(level = 'warn') {
    return level === 'error' ? rawConsoleError : rawConsoleWarn;
}
export function installMaterialBindingApiWarningInterceptor() {
    if (materialBindingWarningInterceptorInstalled)
        return;
    const dispatch = (level, args) => {
        const message = stringifyConsoleArgs(args);
        if (!isMaterialBindingApiWarningMessage(message))
            return false;
        let suppressed = false;
        for (const handler of materialBindingWarningHandlers) {
            if (typeof handler !== 'function')
                continue;
            try {
                suppressed = handler({ message, args, level }) || suppressed;
            }
            catch { }
        }
        return suppressed;
    };
    console.warn = (...args) => {
        if (dispatch('warn', args))
            return;
        rawConsoleWarn(...args);
    };
    console.error = (...args) => {
        if (dispatch('error', args))
            return;
        rawConsoleError(...args);
    };
    materialBindingWarningInterceptorInstalled = true;
}
export function registerMaterialBindingApiWarningHandler(handler) {
    if (typeof handler !== 'function')
        return;
    installMaterialBindingApiWarningInterceptor();
    materialBindingWarningHandlers.add(handler);
}
export function unregisterMaterialBindingApiWarningHandler(handler) {
    if (typeof handler !== 'function')
        return;
    materialBindingWarningHandlers.delete(handler);
}
export function isLikelyDefaultGrayMaterial(material, epsilon = 2 / 255) {
    if (!material || !material.color)
        return false;
    if (material === getDefaultMaterial())
        return false;
    if (material.map || material.emissiveMap || material.alphaMap || material.normalMap)
        return false;
    const delta = Math.max(Math.abs(material.color.r - defaultGrayComponent), Math.abs(material.color.g - defaultGrayComponent), Math.abs(material.color.b - defaultGrayComponent));
    return delta <= epsilon;
}
export function isMatrixApproximatelyIdentity(matrix, epsilon = 1e-4) {
    if (!matrix || !Array.isArray(matrix.elements) || matrix.elements.length < 16)
        return false;
    const expected = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ];
    for (let i = 0; i < 16; i++) {
        if (Math.abs(matrix.elements[i] - expected[i]) > epsilon)
            return false;
    }
    return true;
}
export function isLikelyInverseTransform(candidateMatrix, referenceMatrix, epsilon = 1e-4) {
    if (!candidateMatrix || !referenceMatrix)
        return false;
    const product = candidateMatrix.clone().multiply(referenceMatrix);
    return isMatrixApproximatelyIdentity(product, epsilon);
}
export function isIdentityQuaternion(quaternion, epsilon = 1e-4) {
    if (!quaternion)
        return true;
    return (Math.abs(quaternion.x) <= epsilon &&
        Math.abs(quaternion.y) <= epsilon &&
        Math.abs(quaternion.z) <= epsilon &&
        Math.abs(quaternion.w - 1) <= epsilon);
}
export function toArrayLike(value) {
    if (Array.isArray(value))
        return value;
    if (ArrayBuffer.isView(value))
        return Array.from(value);
    if (value && typeof value !== 'string' && typeof value.length === 'number') {
        try {
            return Array.from(value);
        }
        catch { }
    }
    if (value && typeof value !== 'string' && typeof value[Symbol.iterator] === 'function') {
        try {
            return Array.from(value);
        }
        catch { }
    }
    return null;
}
function toFiniteNumberLocal(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return undefined;
    return numeric;
}
export function toFiniteVector2Tuple(value) {
    const arrayValue = toArrayLike(value);
    if (arrayValue && arrayValue.length >= 2) {
        const x = toFiniteNumberLocal(arrayValue[0]);
        const y = toFiniteNumberLocal(arrayValue[1]);
        if (x !== undefined && y !== undefined) {
            return [x, y];
        }
    }
    if (!value || typeof value !== 'object')
        return null;
    const x = toFiniteNumberLocal(value.x ?? value.X ?? value[0]);
    const y = toFiniteNumberLocal(value.y ?? value.Y ?? value[1]);
    if (x !== undefined && y !== undefined) {
        return [x, y];
    }
    return null;
}
export function toFiniteVector3Tuple(value) {
    const arrayValue = toArrayLike(value);
    if (arrayValue && arrayValue.length >= 3) {
        const x = toFiniteNumberLocal(arrayValue[0]);
        const y = toFiniteNumberLocal(arrayValue[1]);
        const z = toFiniteNumberLocal(arrayValue[2]);
        if (x !== undefined && y !== undefined && z !== undefined) {
            return [x, y, z];
        }
    }
    if (!value || typeof value !== 'object')
        return null;
    const x = toFiniteNumberLocal(value.x ?? value.X ?? value[0]);
    const y = toFiniteNumberLocal(value.y ?? value.Y ?? value[1]);
    const z = toFiniteNumberLocal(value.z ?? value.Z ?? value[2]);
    if (x !== undefined && y !== undefined && z !== undefined) {
        return [x, y, z];
    }
    const i = toFiniteNumberLocal(value.i ?? value.I);
    const j = toFiniteNumberLocal(value.j ?? value.J);
    const k = toFiniteNumberLocal(value.k ?? value.K);
    if (i !== undefined && j !== undefined && k !== undefined) {
        return [i, j, k];
    }
    return null;
}
export function toFiniteQuaternionWxyzTuple(value) {
    const arrayValue = toArrayLike(value);
    if (arrayValue && arrayValue.length >= 4) {
        const w = toFiniteNumberLocal(arrayValue[0]);
        const x = toFiniteNumberLocal(arrayValue[1]);
        const y = toFiniteNumberLocal(arrayValue[2]);
        const z = toFiniteNumberLocal(arrayValue[3]);
        if (w !== undefined && x !== undefined && y !== undefined && z !== undefined) {
            return [w, x, y, z];
        }
    }
    if (!value || typeof value !== 'object')
        return null;
    const real = toFiniteNumberLocal(value.real ?? value.r ?? value.w ?? value.W ?? value[0]);
    const imaginaryTuple = toFiniteVector3Tuple(value.imaginary ?? value.imag ?? value.vector);
    if (real !== undefined && imaginaryTuple) {
        return [real, imaginaryTuple[0], imaginaryTuple[1], imaginaryTuple[2]];
    }
    const x = toFiniteNumberLocal(value.x ?? value.X ?? value.i ?? value.I ?? value[1]);
    const y = toFiniteNumberLocal(value.y ?? value.Y ?? value.j ?? value.J ?? value[2]);
    const z = toFiniteNumberLocal(value.z ?? value.Z ?? value.k ?? value.K ?? value[3]);
    const w = toFiniteNumberLocal(value.w ?? value.W ?? value.real ?? value.r ?? value[0]);
    if (w !== undefined && x !== undefined && y !== undefined && z !== undefined) {
        return [w, x, y, z];
    }
    return null;
}
export function getPathWithoutRoot(primPath) {
    if (!primPath || !primPath.startsWith('/'))
        return '';
    const rootPath = getRootPathFromPrimPath(primPath);
    if (!rootPath)
        return primPath;
    return primPath.slice(rootPath.length) || '/';
}
export function remapRootPathIfNeeded(path, sourceRootPath, targetRootPath) {
    if (!path || !sourceRootPath || !targetRootPath)
        return path;
    if (sourceRootPath === targetRootPath)
        return path;
    if (path === sourceRootPath)
        return targetRootPath;
    if (!path.startsWith(`${sourceRootPath}/`))
        return path;
    return `${targetRootPath}${path.slice(sourceRootPath.length)}`;
}
const MAX_PROTO_IDENTIFIER_CACHE_ENTRIES = 65536;
const protoMeshIdentifierCache = new Map();
const protoPrimPathCandidatesCache = new Map();
const genericSemanticChildPrimNames = new Set([
    'mesh',
    'visual_mesh',
    'collision_mesh',
    'cube',
    'sphere',
    'cylinder',
    'capsule',
    'scene',
    'root',
]);
const genericSemanticChildPrimNamePatterns = [
    /^mesh_\d+$/i,
    /^visual_\d+$/i,
    /^collision_\d+$/i,
    /^group(?:_\d+)?$/i,
    /^xform(?:_\d+)?$/i,
];
function isGenericSemanticChildPrimName(candidateLinkName) {
    const normalizedCandidateLinkName = String(candidateLinkName || '').trim().toLowerCase();
    if (!normalizedCandidateLinkName)
        return true;
    if (genericSemanticChildPrimNames.has(normalizedCandidateLinkName)) {
        return true;
    }
    return genericSemanticChildPrimNamePatterns.some((pattern) => pattern.test(candidateLinkName));
}
function setBoundedProtoCacheEntry(cache, key, value) {
    if (!cache || !key)
        return;
    if (cache.has(key)) {
        cache.delete(key);
    }
    cache.set(key, value);
    if (cache.size <= MAX_PROTO_IDENTIFIER_CACHE_ENTRIES)
        return;
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
        cache.delete(oldestKey);
    }
}
export function parseProtoMeshIdentifier(meshId) {
    if (!meshId || typeof meshId !== 'string')
        return null;
    if (protoMeshIdentifierCache.has(meshId)) {
        return protoMeshIdentifierCache.get(meshId) || null;
    }
    const match = meshId.match(/^(.*)\.proto_([a-z]+)_id(\d+)$/i);
    if (!match) {
        setBoundedProtoCacheEntry(protoMeshIdentifierCache, meshId, null);
        return null;
    }
    const containerPath = match[1];
    const protoType = String(match[2] || '').toLowerCase();
    const protoIndex = Number(match[3]);
    if (!containerPath || !Number.isFinite(protoIndex)) {
        setBoundedProtoCacheEntry(protoMeshIdentifierCache, meshId, null);
        return null;
    }
    const lastSlash = containerPath.lastIndexOf('/');
    if (lastSlash <= 0) {
        setBoundedProtoCacheEntry(protoMeshIdentifierCache, meshId, null);
        return null;
    }
    const linkPath = containerPath.substring(0, lastSlash);
    const sectionName = containerPath.substring(lastSlash + 1).toLowerCase();
    const linkName = linkPath.split('/').pop() || '';
    const parsed = {
        containerPath,
        linkPath,
        linkName,
        sectionName,
        protoType,
        protoIndex,
    };
    setBoundedProtoCacheEntry(protoMeshIdentifierCache, meshId, parsed);
    return parsed;
}
function hasNamedSemanticLink(validLinkNames, candidateLinkName) {
    if (!validLinkNames || !candidateLinkName)
        return false;
    if (typeof validLinkNames.has === 'function') {
        try {
            return validLinkNames.has(candidateLinkName);
        }
        catch {
            return false;
        }
    }
    if (Array.isArray(validLinkNames)) {
        return validLinkNames.includes(candidateLinkName);
    }
    if (typeof validLinkNames === 'object') {
        return Object.prototype.hasOwnProperty.call(validLinkNames, candidateLinkName);
    }
    return false;
}
export function resolveSemanticChildLinkTargetFromResolvedPrimPath({ owningLinkPath, resolvedPrimPath, sectionName, validLinkNames, }) {
    const normalizedOwningLinkPath = normalizeUsdPathToken(owningLinkPath);
    const normalizedResolvedPrimPath = normalizeUsdPathToken(resolvedPrimPath);
    const normalizedSectionName = String(sectionName || '').trim().toLowerCase();
    if (!normalizedOwningLinkPath
        || !normalizedResolvedPrimPath
        || (normalizedSectionName !== 'visuals' && normalizedSectionName !== 'collisions')) {
        return null;
    }
    const resolvedSegments = normalizedResolvedPrimPath.split('/').filter(Boolean);
    if (resolvedSegments.length === 0)
        return null;
    const sectionIndex = resolvedSegments.findIndex((segment) => String(segment || '').toLowerCase() === normalizedSectionName);
    if (sectionIndex < 0 || sectionIndex + 1 >= resolvedSegments.length)
        return null;
    const candidateLinkName = String(resolvedSegments[sectionIndex + 1] || '').trim();
    if (!candidateLinkName)
        return null;
    if (isGenericSemanticChildPrimName(candidateLinkName)) {
        return null;
    }
    if (validLinkNames && !hasNamedSemanticLink(validLinkNames, candidateLinkName)) {
        return null;
    }
    const owningLinkParentPath = normalizedOwningLinkPath.slice(0, normalizedOwningLinkPath.lastIndexOf('/'));
    const semanticLinkPath = owningLinkParentPath
        ? `${owningLinkParentPath}/${candidateLinkName}`
        : normalizedOwningLinkPath;
    return {
        linkName: candidateLinkName,
        linkPath: semanticLinkPath,
    };
}
export function getExpectedPrimTypesForProtoType(protoType) {
    const normalizedType = String(protoType || '').toLowerCase();
    if (normalizedType === 'box')
        return ['cube'];
    if (normalizedType === 'sphere')
        return ['sphere'];
    if (normalizedType === 'cylinder')
        return ['cylinder'];
    if (normalizedType === 'capsule')
        return ['capsule'];
    if (normalizedType === 'mesh')
        return ['mesh'];
    return [];
}
export function getExpectedPrimTypesForCollisionProto(proto) {
    if (!proto)
        return [];
    const expected = getExpectedPrimTypesForProtoType(proto.protoType);
    if (proto.sectionName !== 'collisions')
        return expected;
    if (proto.protoType !== 'mesh')
        return expected;
    return ['mesh', 'cube', 'sphere', 'cylinder', 'capsule'];
}
export function getSafePrimTypeName(prim) {
    if (!prim || typeof prim.GetTypeName !== 'function')
        return '';
    try {
        return String(prim.GetTypeName() || '').toLowerCase();
    }
    catch {
        return '';
    }
}
export function buildProtoPrimPathCandidates(meshId) {
    if (protoPrimPathCandidatesCache.has(meshId)) {
        const cached = protoPrimPathCandidatesCache.get(meshId);
        return Array.isArray(cached) ? cached.slice() : [];
    }
    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto) {
        setBoundedProtoCacheEntry(protoPrimPathCandidatesCache, meshId, []);
        return [];
    }
    const { containerPath, linkName, sectionName, protoType, protoIndex, } = proto;
    const candidates = [];
    const candidateSet = new Set();
    const addCandidate = (path) => {
        if (!path || candidateSet.has(path))
            return;
        candidateSet.add(path);
        candidates.push(path);
    };
    if (protoType === 'mesh') {
        addCandidate(`${containerPath}/mesh_${protoIndex}/mesh`);
        addCandidate(`${containerPath}/mesh_${protoIndex}/collision_mesh`);
        addCandidate(`${containerPath}/mesh_${protoIndex}/visual_mesh`);
        addCandidate(`${containerPath}/mesh_${protoIndex}/cube`);
        addCandidate(`${containerPath}/mesh_${protoIndex}/sphere`);
        addCandidate(`${containerPath}/mesh_${protoIndex}/cylinder`);
        addCandidate(`${containerPath}/mesh_${protoIndex}/capsule`);
        addCandidate(`${containerPath}/${linkName}/mesh`);
        addCandidate(`${containerPath}/${linkName}_${sectionName}/mesh`);
        addCandidate(`${containerPath}/${linkName}_link/mesh`);
        addCandidate(`${containerPath}/mesh`);
        addCandidate(`${containerPath}/collision_mesh`);
        addCandidate(`${containerPath}/visual_mesh`);
        addCandidate(`${containerPath}/cube`);
        addCandidate(`${containerPath}/sphere`);
        addCandidate(`${containerPath}/cylinder`);
        addCandidate(`${containerPath}/capsule`);
        setBoundedProtoCacheEntry(protoPrimPathCandidatesCache, meshId, candidates);
        return candidates.slice();
    }
    const usdType = protoType === 'box' ? 'cube' : protoType;
    addCandidate(`${containerPath}/mesh_${protoIndex}/${protoType}`);
    addCandidate(`${containerPath}/mesh_${protoIndex}/${usdType}`);
    addCandidate(`${containerPath}/${protoType}_${protoIndex}/${protoType}`);
    addCandidate(`${containerPath}/${protoType}_${protoIndex}/${usdType}`);
    addCandidate(`${containerPath}/${usdType}`);
    addCandidate(`${containerPath}/${protoType}`);
    addCandidate(`${containerPath}/${linkName}/${usdType}`);
    addCandidate(`${containerPath}/${linkName}/${protoType}`);
    setBoundedProtoCacheEntry(protoPrimPathCandidatesCache, meshId, candidates);
    return candidates.slice();
}
export function setActiveMaterialBindingWarningOwner(owner) {
    activeMaterialBindingWarningOwner = owner || null;
}
export function getActiveMaterialBindingWarningOwner() {
    return activeMaterialBindingWarningOwner;
}
