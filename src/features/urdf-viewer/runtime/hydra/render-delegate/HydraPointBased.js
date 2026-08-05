// @ts-nocheck
import {
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Matrix4,
    Points,
    PointsMaterial,
} from 'three';

import { normalizeHydraPath } from './shared.js';

const CURVE_SUBDIVISIONS = 12;

function toStableFloat32Array(values) {
    if (!values || typeof values.length !== 'number') return null;
    return Float32Array.from(values, (value) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? numericValue : 0;
    });
}

function toStableIndexArray(values) {
    if (!values || typeof values.length !== 'number') return [];
    return Array.from(values, (value) => Math.max(0, Math.floor(Number(value) || 0)));
}

function normalizeCurveTopology(topology) {
    if (!topology || typeof topology !== 'object') return null;
    const curveVertexCounts = toStableIndexArray(topology.curveVertexCounts)
        .filter((count) => count > 0);
    if (curveVertexCounts.length === 0) return null;
    return {
        curveVertexCounts,
        curveIndices: toStableIndexArray(topology.curveIndices),
        type: String(topology.type || 'linear').trim().toLowerCase(),
        basis: String(topology.basis || 'bezier').trim().toLowerCase(),
        wrap: String(topology.wrap || 'nonperiodic').trim().toLowerCase(),
    };
}

function evaluateCubicWeights(basis, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    if (basis === 'bspline') {
        return [
            ((1 - t) ** 3) / 6,
            (3 * t3 - 6 * t2 + 4) / 6,
            (-3 * t3 + 3 * t2 + 3 * t + 1) / 6,
            t3 / 6,
        ];
    }
    if (basis === 'catmullrom' || basis === 'centripetalcatmullrom') {
        return [
            (-t3 + 2 * t2 - t) / 2,
            (3 * t3 - 5 * t2 + 2) / 2,
            (-3 * t3 + 4 * t2 + t) / 2,
            (t3 - t2) / 2,
        ];
    }
    const oneMinusT = 1 - t;
    return [oneMinusT ** 3, 3 * oneMinusT * oneMinusT * t, 3 * oneMinusT * t2, t3];
}

function evaluateTuple(values, itemSize, indices, weights) {
    const tuple = new Array(itemSize).fill(0);
    for (let controlIndex = 0; controlIndex < 4; controlIndex += 1) {
        const sourceOffset = indices[controlIndex] * itemSize;
        const weight = weights[controlIndex];
        for (let component = 0; component < itemSize; component += 1) {
            tuple[component] += Number(values[sourceOffset + component] || 0) * weight;
        }
    }
    return tuple;
}

function appendTuple(target, tuple) {
    for (const value of tuple) target.push(value);
}

export class HydraPointBased {
    constructor(typeId, id, hydraInterface, instancerId = null) {
        this._typeId = String(typeId || '').trim().toLowerCase();
        this._id = normalizeHydraPath(id);
        this._interface = hydraInterface;
        this._instancerId = normalizeHydraPath(instancerId);
        this._geometry = new BufferGeometry();
        this._points = null;
        this._colors = null;
        this._colorInterpolation = null;
        this._widths = null;
        this._curveTopology = null;
        this._pendingMaterialId = null;
        this._isCurve = this._typeId === 'basiscurves';
        const material = this._isCurve
            ? new LineBasicMaterial({ color: 0xffffff })
            : new PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: true });
        this._mesh = this._isCurve
            ? new LineSegments(this._geometry, material)
            : new Points(this._geometry, material);
        this._mesh.matrixAutoUpdate = false;
        this._mesh.name = this._id.split('/').pop() || this._id;
        this._mesh.userData.usdPrimPath = this._id;
        this._mesh.userData.usdPrimType = this._isCurve ? 'BasisCurves' : 'Points';
        hydraInterface.config.usdRoot.add(this._mesh);
    }

    updatePoints(points) {
        this._points = toStableFloat32Array(points);
    }

    updateCurveTopology(topology) {
        this._curveTopology = normalizeCurveTopology(topology);
    }

    setTransform(matrix) {
        if (!matrix || typeof matrix.length !== 'number' || matrix.length < 16) return;
        const values = Array.from(matrix).slice(0, 16).map(Number);
        if (values.some((value) => !Number.isFinite(value))) return;
        this._mesh.matrix.copy(new Matrix4().set(...values).transpose());
    }

    setVisible(visible) {
        this._mesh.visible = visible !== false;
    }

    setMaterial(materialId) {
        this._pendingMaterialId = normalizeHydraPath(materialId);
        const sourceMaterial = this._interface?.materials?.[this._pendingMaterialId]?._material;
        if (sourceMaterial?.color) {
            this._mesh.material.color.copy(sourceMaterial.color);
        }
        if (Number.isFinite(sourceMaterial?.opacity)) {
            this._mesh.material.opacity = sourceMaterial.opacity;
            this._mesh.material.transparent = sourceMaterial.transparent === true || sourceMaterial.opacity < 1;
        }
    }

    setDisplayColor(data, interpolation) {
        const colors = toStableFloat32Array(data);
        if (!colors || colors.length < 3) return;
        this._colors = colors;
        this._colorInterpolation = String(interpolation || 'constant').toLowerCase();
        if (this._colorInterpolation === 'constant') {
            this._mesh.material.color.setRGB(colors[0], colors[1], colors[2]);
            this._mesh.material.vertexColors = false;
        }
    }

    setWidths(data) {
        this._widths = toStableFloat32Array(data);
        if (this._mesh.isPoints && this._widths?.length > 0) {
            const width = Array.from(this._widths).find((value) => Number.isFinite(value) && value > 0);
            if (width) this._mesh.material.size = width;
        }
    }

    updatePrimvar(name, data, dimension, interpolation) {
        const normalizedName = String(name || '').toLowerCase().replace(/^primvars:/, '');
        if (normalizedName === 'displaycolor' && Number(dimension) === 3) {
            this.setDisplayColor(data, interpolation);
        }
        if (normalizedName === 'widths' && Number(dimension) === 1) {
            this.setWidths(data);
        }
    }

    _getControlColor(pointIndex, curveIndex) {
        if (!this._colors || this._colors.length < 3) return null;
        if (this._colorInterpolation === 'constant') return [this._colors[0], this._colors[1], this._colors[2]];
        const colorIndex = this._colorInterpolation === 'uniform' ? curveIndex : pointIndex;
        const offset = colorIndex * 3;
        if (offset + 2 >= this._colors.length) return null;
        return [this._colors[offset], this._colors[offset + 1], this._colors[offset + 2]];
    }

    _appendLinearCurve(output, colors, pointIndices, curveIndex, wrap) {
        const appendSegment = (leftIndex, rightIndex) => {
            const pointCount = Math.floor(this._points.length / 3);
            if (leftIndex >= pointCount || rightIndex >= pointCount) return;
            appendTuple(output, this._points.subarray(leftIndex * 3, leftIndex * 3 + 3));
            appendTuple(output, this._points.subarray(rightIndex * 3, rightIndex * 3 + 3));
            const leftColor = this._getControlColor(leftIndex, curveIndex);
            const rightColor = this._getControlColor(rightIndex, curveIndex);
            if (leftColor && rightColor) {
                appendTuple(colors, leftColor);
                appendTuple(colors, rightColor);
            }
        };
        if (wrap === 'segmented') {
            for (let index = 0; index + 1 < pointIndices.length; index += 2) {
                appendSegment(pointIndices[index], pointIndices[index + 1]);
            }
            return;
        }
        for (let index = 0; index + 1 < pointIndices.length; index += 1) {
            appendSegment(pointIndices[index], pointIndices[index + 1]);
        }
        if (wrap === 'periodic' && pointIndices.length > 2) {
            appendSegment(pointIndices.at(-1), pointIndices[0]);
        }
    }

    _getCubicControlWindows(pointIndices, basis, wrap) {
        const periodic = wrap === 'periodic';
        const windows = [];
        if (basis === 'bezier') {
            const segmentCount = periodic
                ? Math.floor(pointIndices.length / 3)
                : Math.floor((pointIndices.length - 1) / 3);
            for (let segment = 0; segment < segmentCount; segment += 1) {
                const start = segment * 3;
                windows.push([0, 1, 2, 3].map((offset) => pointIndices[(start + offset) % pointIndices.length]));
            }
            return windows;
        }
        const segmentCount = periodic ? pointIndices.length : Math.max(0, pointIndices.length - 3);
        for (let segment = 0; segment < segmentCount; segment += 1) {
            windows.push([0, 1, 2, 3].map((offset) => pointIndices[(segment + offset) % pointIndices.length]));
        }
        return windows;
    }

    _appendCubicCurve(output, colors, pointIndices, curveIndex, basis, wrap) {
        const controlWindows = this._getCubicControlWindows(pointIndices, basis, wrap);
        for (const controlIndices of controlWindows) {
            for (let step = 0; step < CURVE_SUBDIVISIONS; step += 1) {
                for (const t of [step / CURVE_SUBDIVISIONS, (step + 1) / CURVE_SUBDIVISIONS]) {
                    const weights = evaluateCubicWeights(basis, t);
                    appendTuple(output, evaluateTuple(this._points, 3, controlIndices, weights));
                    if (this._colors && this._colorInterpolation !== 'constant') {
                        const controlColors = controlIndices.flatMap((pointIndex) => (
                            this._getControlColor(pointIndex, curveIndex) || [1, 1, 1]
                        ));
                        appendTuple(colors, evaluateTuple(controlColors, 3, [0, 1, 2, 3], weights));
                    }
                }
            }
        }
    }

    _rebuildCurveGeometry() {
        if (!this._points || !this._curveTopology) return;
        const positions = [];
        const colors = [];
        const topology = this._curveTopology;
        let controlOffset = 0;
        for (let curveIndex = 0; curveIndex < topology.curveVertexCounts.length; curveIndex += 1) {
            const controlCount = topology.curveVertexCounts[curveIndex];
            const pointIndices = topology.curveIndices.length > 0
                ? topology.curveIndices.slice(controlOffset, controlOffset + controlCount)
                : Array.from({ length: controlCount }, (_, index) => controlOffset + index);
            if (topology.type === 'cubic') {
                this._appendCubicCurve(positions, colors, pointIndices, curveIndex, topology.basis, topology.wrap);
            }
            else {
                this._appendLinearCurve(positions, colors, pointIndices, curveIndex, topology.wrap);
            }
            controlOffset += controlCount;
        }
        this._geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        if (colors.length === positions.length) {
            this._geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
            this._mesh.material.vertexColors = true;
            this._mesh.material.color.set(new Color(0xffffff));
        }
        else {
            this._geometry.deleteAttribute('color');
            this._mesh.material.vertexColors = false;
        }
        this._geometry.computeBoundingBox();
        this._geometry.computeBoundingSphere();
    }

    _rebuildPointGeometry() {
        if (!this._points) return;
        this._geometry.setAttribute('position', new Float32BufferAttribute(this._points, 3));
        const vertexColor = this._colors
            && (this._colorInterpolation === 'vertex' || this._colorInterpolation === 'varying')
            && this._colors.length === this._points.length;
        if (vertexColor) {
            this._geometry.setAttribute('color', new Float32BufferAttribute(this._colors, 3));
            this._mesh.material.vertexColors = true;
            this._mesh.material.color.set(new Color(0xffffff));
        }
        this._geometry.computeBoundingBox();
        this._geometry.computeBoundingSphere();
    }

    applyUpdates(updates) {
        if (!updates || typeof updates !== 'object') return;
        if (updates.points) this.updatePoints(updates.points);
        if (updates.curveTopology) this.updateCurveTopology(updates.curveTopology);
        for (const primvar of updates.primvars || []) {
            this.updatePrimvar(primvar.name, primvar.data, primvar.dimension, primvar.interpolation);
        }
        if (updates.materialId) this.setMaterial(updates.materialId);
        if (updates.transform) this.setTransform(updates.transform);
        if (Object.prototype.hasOwnProperty.call(updates, 'visible')) this.setVisible(updates.visible);
        if (this._isCurve) this._rebuildCurveGeometry();
        else this._rebuildPointGeometry();
    }

    commit() {
        if (this._pendingMaterialId) this.setMaterial(this._pendingMaterialId);
    }

    dispose() {
        this._mesh.parent?.remove?.(this._mesh);
        this._geometry.dispose();
        this._mesh.material.dispose();
    }
}
