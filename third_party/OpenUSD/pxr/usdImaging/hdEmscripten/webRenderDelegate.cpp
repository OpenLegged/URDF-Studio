//
// Copyright 2016 Pixar
//
// Licensed under the Apache License, Version 2.0 (the "Apache License")
// with the following modification; you may not use this file except in
// compliance with the Apache License and the following modification to it:
// Section 6. Trademarks. is deleted and replaced with:
//
// 6. Trademarks. This License does not grant permission to use the trade
//    names, trademarks, service marks, or product names of the Licensor
//    and its affiliates, except as required to comply with Section 4(c) of
//    the License and to reproduce the content of the NOTICE file.
//
// You may obtain a copy of the Apache License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the Apache License with the above modification is
// distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the Apache License for the specific
// language governing permissions and limitations under the Apache License.
//
#include "webRenderDelegate.h"
#include "pxr/base/gf/vec2f.h"
#include "pxr/imaging/hd/bufferArray.h"
#include "pxr/imaging/hd/material.h"
#include "pxr/imaging/hd/mesh.h"
#include "pxr/imaging/hd/points.h"
#include "pxr/imaging/hd/basisCurves.h"
#include "pxr/imaging/hd/bprim.h"
#include "pxr/imaging/hd/tokens.h"
#include "pxr/imaging/hd/repr.h"
#include "pxr/imaging/hd/resourceRegistry.h"
#include "pxr/imaging/hdSt/strategyBase.h"
#include "pxr/imaging/hd/unitTestNullRenderPass.h"
#include "pxr/imaging/hd/meshUtil.h"
#include "pxr/imaging/hd/smoothNormals.h"
#include "pxr/imaging/hd/vtBufferSource.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <iostream>
#include <type_traits>
#include <utility>

using namespace emscripten;

PXR_NAMESPACE_OPEN_SCOPE

const std::map<HdInterpolation, std::string> InterpolationStrings = {
    {HdInterpolationConstant, "constant"},
    {HdInterpolationUniform, "uniform"},
    {HdInterpolationVarying, "varying"},
    {HdInterpolationVertex, "vertex"},
    {HdInterpolationFaceVarying, "facevarying"},
    {HdInterpolationInstance, "instance"}
};

void _runInMainThread(int funPointer) {
    std::function<void()>  *function = reinterpret_cast<std::function<void()>*>(funPointer);
    (*function)();
}

// Only the main thread can communicate with the JS interpreter (other threads run in web workers).
// All direct invocations of JS functions need to go through the main thread.
void runInMainThread(std::function<void()> fun) {
    emscripten_sync_run_in_main_runtime_thread(EM_FUNC_SIG_VI, _runInMainThread, (void *) &fun);
}

namespace {

constexpr float kNormalRepairDotThreshold = 0.2f;
constexpr float kNormalRepairNearZeroLengthSq = 1.0e-20f;

struct _NormalRepairVec3
{
    float x = 0.0f;
    float y = 0.0f;
    float z = 1.0f;
};

static std::string
_LowerAscii(std::string value)
{
    std::transform(
        value.begin(),
        value.end(),
        value.begin(),
        [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
    return value;
}

static bool
_IsFinite(_NormalRepairVec3 const& value)
{
    return std::isfinite(value.x) && std::isfinite(value.y) && std::isfinite(value.z);
}

static float
_LengthSq(_NormalRepairVec3 const& value)
{
    return value.x * value.x + value.y * value.y + value.z * value.z;
}

static bool
_Normalize(_NormalRepairVec3* value)
{
    if (!value || !_IsFinite(*value)) return false;
    const float lengthSq = _LengthSq(*value);
    if (!std::isfinite(lengthSq) || lengthSq <= kNormalRepairNearZeroLengthSq) {
        return false;
    }
    const float invLength = 1.0f / std::sqrt(lengthSq);
    value->x *= invLength;
    value->y *= invLength;
    value->z *= invLength;
    return true;
}

static _NormalRepairVec3
_ReadVec3(std::vector<float> const& values, size_t index)
{
    const size_t offset = index * 3;
    if (offset + 2 >= values.size()) return _NormalRepairVec3();
    return _NormalRepairVec3{values[offset], values[offset + 1], values[offset + 2]};
}

static void
_AppendVec3(std::vector<float>* values, _NormalRepairVec3 const& value)
{
    if (!values) return;
    values->push_back(value.x);
    values->push_back(value.y);
    values->push_back(value.z);
}

static void
_SetVec3(std::vector<float>* values, size_t index, _NormalRepairVec3 const& value)
{
    if (!values) return;
    const size_t offset = index * 3;
    if (offset + 2 >= values->size()) return;
    (*values)[offset] = value.x;
    (*values)[offset + 1] = value.y;
    (*values)[offset + 2] = value.z;
}

static float
_Dot(_NormalRepairVec3 const& left, _NormalRepairVec3 const& right)
{
    return left.x * right.x + left.y * right.y + left.z * right.z;
}

static bool
_TryGetFaceNormal(
    WebRenderDelegate::ProtoDataBlobRecord const& record,
    size_t triangleOffset,
    _NormalRepairVec3* outFaceNormal)
{
    if (!outFaceNormal || triangleOffset + 2 >= record.indices.size()) return false;
    const uint32_t i0 = record.indices[triangleOffset];
    const uint32_t i1 = record.indices[triangleOffset + 1];
    const uint32_t i2 = record.indices[triangleOffset + 2];
    const size_t pointCount = record.points.size() / 3;
    if (i0 >= pointCount || i1 >= pointCount || i2 >= pointCount) return false;

    const _NormalRepairVec3 p0 = _ReadVec3(record.points, i0);
    const _NormalRepairVec3 p1 = _ReadVec3(record.points, i1);
    const _NormalRepairVec3 p2 = _ReadVec3(record.points, i2);
    if (!_IsFinite(p0) || !_IsFinite(p1) || !_IsFinite(p2)) return false;

    _NormalRepairVec3 edge01{p1.x - p0.x, p1.y - p0.y, p1.z - p0.z};
    _NormalRepairVec3 edge02{p2.x - p0.x, p2.y - p0.y, p2.z - p0.z};
    _NormalRepairVec3 faceNormal{
        edge01.y * edge02.z - edge01.z * edge02.y,
        edge01.z * edge02.x - edge01.x * edge02.z,
        edge01.x * edge02.y - edge01.y * edge02.x,
    };
    if (!_Normalize(&faceNormal)) return false;
    *outFaceNormal = faceNormal;
    return true;
}

static bool
_IsFallbackCandidate(_NormalRepairVec3* normal)
{
    return !_Normalize(normal);
}

static int
_SafeTupleDimension(int dimension, int fallback)
{
    return dimension > 0 ? dimension : fallback;
}

static size_t
_FloatTupleCount(std::vector<float> const& values, int dimension)
{
    const int safeDimension = _SafeTupleDimension(dimension, 0);
    if (safeDimension <= 0 || values.empty()) return 0;
    return values.size() / static_cast<size_t>(safeDimension);
}

static bool
_ExpandFloatTuplesByIndices(
    std::vector<float> const& source,
    int dimension,
    std::vector<uint32_t> const& indices,
    std::vector<float>* outValues)
{
    if (!outValues) return false;
    outValues->clear();

    const int safeDimension = _SafeTupleDimension(dimension, 0);
    if (source.empty() || indices.empty() || safeDimension <= 0) return false;

    const size_t sourceTupleCount = source.size() / static_cast<size_t>(safeDimension);
    if (sourceTupleCount == 0) return false;

    outValues->reserve(indices.size() * static_cast<size_t>(safeDimension));
    for (uint32_t sourceIndex : indices) {
        const size_t tupleIndex = static_cast<size_t>(sourceIndex);
        if (tupleIndex >= sourceTupleCount) {
            outValues->clear();
            return false;
        }

        const size_t sourceOffset = tupleIndex * static_cast<size_t>(safeDimension);
        for (int component = 0; component < safeDimension; ++component) {
            outValues->push_back(source[sourceOffset + static_cast<size_t>(component)]);
        }
    }

    return !outValues->empty();
}

static bool
_LooksLikeExpandedPayloadWithStaleSharedIndex(
    std::vector<uint32_t> const& indices,
    size_t pointCount)
{
    if (indices.empty() || pointCount == 0 || indices.size() != pointCount) {
        return false;
    }

    bool sawNonIdentityIndex = false;
    uint32_t maxReferencedVertex = 0;
    for (size_t index = 0; index < indices.size(); ++index) {
        const uint32_t referencedVertex = indices[index];
        if (referencedVertex > maxReferencedVertex) {
            maxReferencedVertex = referencedVertex;
        }
        if (!sawNonIdentityIndex && referencedVertex != index) {
            sawNonIdentityIndex = true;
        }
    }

    return sawNonIdentityIndex
        && static_cast<size_t>(maxReferencedVertex) + 1 < pointCount;
}

static bool
_TryGetSequentialFaceNormal(
    std::vector<float> const& points,
    size_t triangleVertexOffset,
    _NormalRepairVec3* outFaceNormal)
{
    if (!outFaceNormal) return false;
    const size_t pointCount = points.size() / 3;
    if (triangleVertexOffset + 2 >= pointCount) return false;

    const _NormalRepairVec3 p0 = _ReadVec3(points, triangleVertexOffset);
    const _NormalRepairVec3 p1 = _ReadVec3(points, triangleVertexOffset + 1);
    const _NormalRepairVec3 p2 = _ReadVec3(points, triangleVertexOffset + 2);
    if (!_IsFinite(p0) || !_IsFinite(p1) || !_IsFinite(p2)) return false;

    _NormalRepairVec3 edge01{p1.x - p0.x, p1.y - p0.y, p1.z - p0.z};
    _NormalRepairVec3 edge02{p2.x - p0.x, p2.y - p0.y, p2.z - p0.z};
    _NormalRepairVec3 faceNormal{
        edge01.y * edge02.z - edge01.z * edge02.y,
        edge01.z * edge02.x - edge01.x * edge02.z,
        edge01.x * edge02.y - edge01.y * edge02.x,
    };
    if (!_Normalize(&faceNormal)) return false;

    *outFaceNormal = faceNormal;
    return true;
}

static bool
_ComputeIndexedVertexNormals(
    WebRenderDelegate::ProtoDataBlobRecord const& record,
    std::vector<float>* outNormals)
{
    if (!outNormals) return false;
    outNormals->clear();

    const size_t pointCount = record.points.size() / 3;
    const size_t indexCount = record.indices.size();
    if (pointCount == 0 || indexCount < 3) return false;

    std::vector<float> accumulated(pointCount * 3, 0.0f);
    int assignedFaceCount = 0;
    for (size_t triangleOffset = 0; triangleOffset + 2 < indexCount; triangleOffset += 3) {
        _NormalRepairVec3 faceNormal;
        if (!_TryGetFaceNormal(record, triangleOffset, &faceNormal)) continue;

        for (size_t corner = 0; corner < 3; ++corner) {
            const size_t pointIndex = static_cast<size_t>(record.indices[triangleOffset + corner]);
            if (pointIndex >= pointCount) continue;
            const size_t offset = pointIndex * 3;
            accumulated[offset] += faceNormal.x;
            accumulated[offset + 1] += faceNormal.y;
            accumulated[offset + 2] += faceNormal.z;
        }
        assignedFaceCount += 1;
    }

    if (assignedFaceCount <= 0) return false;

    outNormals->resize(pointCount * 3, 0.0f);
    int assignedNormalCount = 0;
    for (size_t pointIndex = 0; pointIndex < pointCount; ++pointIndex) {
        const size_t offset = pointIndex * 3;
        _NormalRepairVec3 normal{
            accumulated[offset],
            accumulated[offset + 1],
            accumulated[offset + 2],
        };
        if (!_Normalize(&normal)) continue;
        (*outNormals)[offset] = normal.x;
        (*outNormals)[offset + 1] = normal.y;
        (*outNormals)[offset + 2] = normal.z;
        assignedNormalCount += 1;
    }

    if (assignedNormalCount <= 0) {
        outNormals->clear();
        return false;
    }

    return true;
}

static bool
_ComputeNonIndexedFaceNormals(
    std::vector<float> const& points,
    std::vector<float>* outNormals)
{
    if (!outNormals) return false;
    outNormals->clear();

    const size_t pointCount = points.size() / 3;
    if (pointCount < 3) return false;

    outNormals->resize(pointCount * 3, 0.0f);
    int assignedFaceCount = 0;
    for (size_t triangleVertexOffset = 0; triangleVertexOffset + 2 < pointCount; triangleVertexOffset += 3) {
        _NormalRepairVec3 faceNormal;
        if (!_TryGetSequentialFaceNormal(points, triangleVertexOffset, &faceNormal)) continue;

        for (size_t corner = 0; corner < 3; ++corner) {
            _SetVec3(outNormals, triangleVertexOffset + corner, faceNormal);
        }
        assignedFaceCount += 1;
    }

    if (assignedFaceCount <= 0) {
        outNormals->clear();
        return false;
    }

    return true;
}

} // namespace

void
WebRenderDelegate::RepairProtoDataBlobNormals(
    ProtoDataBlobRecord* record,
    std::string const& normalSource)
{
    if (!record) return;

    record->normalSource = normalSource.empty() ? record->normalSource : normalSource;
    if (record->normalSource.empty()) {
        record->normalSource = "unknown";
    }
    record->normalRepairCount = 0;
    record->normalFallbackCount = 0;
    record->postRepairLowDotCount = 0;

    const size_t pointCount = record->points.size() / 3;
    const size_t indexCount = record->indices.size();
    const size_t normalCount = record->normals.size() / 3;
    if (pointCount == 0 || indexCount < 3 || normalCount == 0) {
        if (normalCount == 0) {
            record->normalSource = "none";
        }
        record->numNormals = static_cast<int>(normalCount);
        record->normalsDimension = normalCount > 0 ? 3 : 0;
        return;
    }

    const std::string lowerSource = _LowerAscii(record->normalSource);
    const bool sourceIsVertex = lowerSource.find("vertex") != std::string::npos
        || lowerSource.find("generated") != std::string::npos;
    const bool sourceIsFaceVarying = lowerSource.find("facevarying") != std::string::npos
        || lowerSource.find("face-varying") != std::string::npos
        || lowerSource.find("percorner") != std::string::npos
        || lowerSource.find("per-corner") != std::string::npos;

    enum class _NormalMode
    {
        Unsupported,
        FaceVarying,
        Vertex,
    };

    _NormalMode mode = _NormalMode::Unsupported;
    if (sourceIsFaceVarying && normalCount == indexCount) {
        mode = _NormalMode::FaceVarying;
    } else if (sourceIsVertex && normalCount == pointCount) {
        mode = _NormalMode::Vertex;
    } else if (normalCount == indexCount) {
        mode = _NormalMode::FaceVarying;
    } else if (normalCount == pointCount) {
        mode = _NormalMode::Vertex;
    }

    if (mode == _NormalMode::Unsupported) {
        record->numNormals = static_cast<int>(normalCount);
        record->normalsDimension = 3;
        return;
    }

    bool vertexModeNeedsExpansion = false;
    for (size_t triOffset = 0; triOffset + 2 < indexCount; triOffset += 3) {
        _NormalRepairVec3 faceNormal = _NormalRepairVec3();
        const bool hasFaceNormal = _TryGetFaceNormal(*record, triOffset, &faceNormal);
        for (size_t corner = 0; corner < 3; ++corner) {
            const size_t cornerOffset = triOffset + corner;
            const size_t normalIndex = mode == _NormalMode::FaceVarying
                ? cornerOffset
                : static_cast<size_t>(record->indices[cornerOffset]);
            if (normalIndex >= normalCount) continue;

            _NormalRepairVec3 normal = _ReadVec3(record->normals, normalIndex);
            const bool fallbackCandidate = _IsFallbackCandidate(&normal);
            const bool lowDot = hasFaceNormal
                && !fallbackCandidate
                && _Dot(faceNormal, normal) < kNormalRepairDotThreshold;
            if (mode == _NormalMode::Vertex && (fallbackCandidate || lowDot)) {
                vertexModeNeedsExpansion = true;
            }
            if (mode == _NormalMode::FaceVarying && (fallbackCandidate || lowDot)) {
                const _NormalRepairVec3 repaired = hasFaceNormal ? faceNormal : _NormalRepairVec3();
                _SetVec3(&record->normals, normalIndex, repaired);
                record->normalRepairCount += 1;
                if (fallbackCandidate) {
                    record->normalFallbackCount += 1;
                }
            }
        }
    }

    if (mode == _NormalMode::Vertex && vertexModeNeedsExpansion) {
        std::vector<float> expandedNormals;
        expandedNormals.reserve(indexCount * 3);
        for (size_t triOffset = 0; triOffset + 2 < indexCount; triOffset += 3) {
            _NormalRepairVec3 faceNormal = _NormalRepairVec3();
            const bool hasFaceNormal = _TryGetFaceNormal(*record, triOffset, &faceNormal);
            for (size_t corner = 0; corner < 3; ++corner) {
                const size_t cornerOffset = triOffset + corner;
                const size_t normalIndex = static_cast<size_t>(record->indices[cornerOffset]);
                _NormalRepairVec3 normal = normalIndex < normalCount
                    ? _ReadVec3(record->normals, normalIndex)
                    : _NormalRepairVec3();
                const bool fallbackCandidate = _IsFallbackCandidate(&normal);
                const bool lowDot = hasFaceNormal
                    && !fallbackCandidate
                    && _Dot(faceNormal, normal) < kNormalRepairDotThreshold;
                if (fallbackCandidate || lowDot) {
                    _AppendVec3(&expandedNormals, hasFaceNormal ? faceNormal : _NormalRepairVec3());
                    record->normalRepairCount += 1;
                    if (fallbackCandidate) {
                        record->normalFallbackCount += 1;
                    }
                } else {
                    _AppendVec3(&expandedNormals, normal);
                }
            }
        }
        if (!expandedNormals.empty()) {
            record->normals = std::move(expandedNormals);
            if (record->normalSource.find("Expanded") == std::string::npos) {
                record->normalSource += "Expanded";
            }
        }
    }

    const size_t finalNormalCount = record->normals.size() / 3;
    const bool finalNormalsAreFaceVarying = finalNormalCount == indexCount;
    const bool finalNormalsAreVertex = finalNormalCount == pointCount && !finalNormalsAreFaceVarying;
    for (size_t triOffset = 0; triOffset + 2 < indexCount; triOffset += 3) {
        _NormalRepairVec3 faceNormal;
        if (!_TryGetFaceNormal(*record, triOffset, &faceNormal)) continue;
        for (size_t corner = 0; corner < 3; ++corner) {
            const size_t cornerOffset = triOffset + corner;
            size_t normalIndex = finalNormalsAreFaceVarying
                ? cornerOffset
                : (finalNormalsAreVertex ? static_cast<size_t>(record->indices[cornerOffset]) : finalNormalCount);
            if (normalIndex >= finalNormalCount) continue;
            _NormalRepairVec3 normal = _ReadVec3(record->normals, normalIndex);
            if (!_Normalize(&normal) || _Dot(faceNormal, normal) < kNormalRepairDotThreshold) {
                record->postRepairLowDotCount += 1;
            }
        }
    }

    record->numNormals = static_cast<int>(finalNormalCount);
    record->normalsDimension = finalNormalCount > 0 ? 3 : 0;
}

void
WebRenderDelegate::FinalizeProtoDataBlobRenderBuffers(
    ProtoDataBlobRecord* record)
{
    if (!record) return;

    record->numVertices = static_cast<int>(record->points.size() / 3);
    record->numIndices = static_cast<int>(record->indices.size());
    record->uvDimension = record->uv.empty()
        ? 0
        : _SafeTupleDimension(record->uvDimension, 2);
    record->numUVs = record->uvDimension > 0
        ? static_cast<int>(_FloatTupleCount(record->uv, record->uvDimension))
        : 0;
    record->normalsDimension = record->normals.empty()
        ? 0
        : _SafeTupleDimension(record->normalsDimension, 3);
    record->numNormals = record->normalsDimension > 0
        ? static_cast<int>(_FloatTupleCount(record->normals, record->normalsDimension))
        : 0;

    const size_t pointCount = static_cast<size_t>(std::max(0, record->numVertices));
    const size_t indexCount = record->indices.size();
    if (pointCount == 0) {
        record->renderReady = false;
        record->topologyMode = "nonIndexed";
        record->valid = false;
        return;
    }

    const int normalDimension = _SafeTupleDimension(record->normalsDimension, 3);
    const int uvDimension = _SafeTupleDimension(record->uvDimension, 2);
    const size_t normalCount = _FloatTupleCount(record->normals, normalDimension);
    const size_t uvCount = _FloatTupleCount(record->uv, uvDimension);
    const std::string normalSource = _LowerAscii(record->normalSource);
    const std::string uvSource = _LowerAscii(record->uvSource);

    const bool normalSourceIsCorner =
        normalSource.find("facevarying") != std::string::npos
        || normalSource.find("face-varying") != std::string::npos
        || normalSource.find("percorner") != std::string::npos
        || normalSource.find("per-corner") != std::string::npos
        || normalSource.find("expanded") != std::string::npos;
    const bool uvSourceIsCorner =
        uvSource.find("facevarying") != std::string::npos
        || uvSource.find("face-varying") != std::string::npos
        || uvSource.find("percorner") != std::string::npos
        || uvSource.find("per-corner") != std::string::npos
        || uvSource.find("expanded") != std::string::npos;

    const bool normalsAreCornerCount = indexCount > 0 && normalCount == indexCount;
    const bool uvsAreCornerCount = indexCount > 0 && uvCount == indexCount;
    const bool normalsRequireCornerTopology = normalsAreCornerCount
        && (normalSourceIsCorner || normalCount != pointCount);
    const bool uvsRequireCornerTopology = uvsAreCornerCount
        && (uvSourceIsCorner || uvCount != pointCount);
    const bool staleExpandedIndex = normalSource.find("expanded") != std::string::npos
        && _LooksLikeExpandedPayloadWithStaleSharedIndex(record->indices, pointCount);
    const bool shouldUseNonIndexedTopology = indexCount > 0
        && (normalsRequireCornerTopology || uvsRequireCornerTopology || staleExpandedIndex);

    if (shouldUseNonIndexedTopology) {
        const std::vector<uint32_t> sourceIndices = record->indices;
        const size_t sourcePointCount = pointCount;
        const bool pointsAlreadyExpanded = staleExpandedIndex;
        bool pointsAreExpanded = pointsAlreadyExpanded;
        if (!pointsAlreadyExpanded) {
            std::vector<float> expandedPoints;
            if (_ExpandFloatTuplesByIndices(record->points, 3, sourceIndices, &expandedPoints)) {
                record->points = std::move(expandedPoints);
                pointsAreExpanded = true;
            }
        }

        if (pointsAreExpanded) {
            const size_t finalPointCount = record->points.size() / 3;

            if (!record->normals.empty()) {
                std::vector<float> expandedNormals;
                const size_t updatedNormalCount = _FloatTupleCount(record->normals, normalDimension);
                if (!pointsAlreadyExpanded
                    && updatedNormalCount == sourcePointCount
                    && _ExpandFloatTuplesByIndices(record->normals, normalDimension, sourceIndices, &expandedNormals)) {
                    record->normals = std::move(expandedNormals);
                } else if (updatedNormalCount != finalPointCount) {
                    record->normals.clear();
                }
            }

            if (!record->uv.empty()) {
                std::vector<float> expandedUv;
                const size_t updatedUvCount = _FloatTupleCount(record->uv, uvDimension);
                if (!pointsAlreadyExpanded
                    && updatedUvCount == sourcePointCount
                    && _ExpandFloatTuplesByIndices(record->uv, uvDimension, sourceIndices, &expandedUv)) {
                    record->uv = std::move(expandedUv);
                } else if (updatedUvCount != finalPointCount) {
                    record->uv.clear();
                }
            }

            record->indices.clear();
            record->topologyMode = "nonIndexed";
        } else {
            record->topologyMode = indexCount > 0 ? "indexed" : "nonIndexed";
        }
    } else {
        record->topologyMode = indexCount > 0 ? "indexed" : "nonIndexed";
    }

    const bool finalIsIndexed = record->topologyMode == "indexed" && !record->indices.empty();
    const size_t finalPointCount = record->points.size() / 3;
    const int finalUvDimension = _SafeTupleDimension(record->uvDimension, 2);
    const size_t finalUvCount = _FloatTupleCount(record->uv, finalUvDimension);
    if (!record->uv.empty() && finalUvCount != finalPointCount) {
        record->uv.clear();
    }

    const int finalNormalDimension = _SafeTupleDimension(record->normalsDimension, 3);
    const size_t finalNormalCount = _FloatTupleCount(record->normals, finalNormalDimension);
    if (!record->normals.empty() && (finalNormalDimension != 3 || finalNormalCount != finalPointCount)) {
        record->normals.clear();
    }

    if (record->normals.empty()) {
        std::vector<float> generatedNormals;
        const bool generated = finalIsIndexed
            ? _ComputeIndexedVertexNormals(*record, &generatedNormals)
            : _ComputeNonIndexedFaceNormals(record->points, &generatedNormals);
        if (generated) {
            record->normals = std::move(generatedNormals);
            record->normalSource = finalIsIndexed ? "generatedVertex" : "generatedFaceVarying";
        }
    }

    record->numVertices = static_cast<int>(record->points.size() / 3);
    record->numIndices = static_cast<int>(record->indices.size());
    record->uvDimension = record->uv.empty() ? 0 : finalUvDimension;
    record->numUVs = record->uvDimension > 0
        ? static_cast<int>(_FloatTupleCount(record->uv, record->uvDimension))
        : 0;
    record->normalsDimension = record->normals.empty() ? 0 : 3;
    record->numNormals = record->normalsDimension > 0
        ? static_cast<int>(_FloatTupleCount(record->normals, record->normalsDimension))
        : 0;
    if (record->uv.empty()) {
        record->uvSource = "none";
    }
    if (record->normals.empty()) {
        record->normalSource = "none";
    }
    record->renderReady = true;
    record->valid = record->numVertices > 0;
}

class Emscripten_Rprim final : public HdMesh {
public:
    Emscripten_Rprim(TfToken const& typeId,
                 SdfPath const& id,
                 emscripten::val renderDelegateInterface,
                 WebRenderDelegate* ownerDelegate)
     : HdMesh(id)
     , _typeId(typeId)
     , _renderDelegateInterface(renderDelegateInterface)
     , _ownerDelegate(ownerDelegate)
     , _rPrim(val::undefined())
     , _meshUtil(NULL)
     , _transform(1.0f)
     , _materialIdPath()
     , _uvPrimvar()
     , _uvPrimvarInterpolation("none")
     , _adjacencyValid(false)
     , _normalsValid(false)
     , _smoothNormals(false)
    {
      _rPrim = _renderDelegateInterface.call<val>("createRPrim", std::string(typeId.GetText()), id.GetAsString());
      if (_ownerDelegate) {
          _ownerDelegate->RegisterLiveRprimPath(id.GetAsString());
      }
    }

    virtual ~Emscripten_Rprim() {
        if (!_ownerDelegate) return;
        const std::string rprimPath = GetId().GetAsString();
        _ownerDelegate->ClearRprimDelta(rprimPath);
        _ownerDelegate->RemoveProtoDataBlob(rprimPath);
        _ownerDelegate->UnregisterLiveRprimPath(rprimPath);
    }

    void findContiguousSections(
        const VtArray<int>& faces,
        std::string const& materialId,
        std::vector<WebRenderDelegate::GeomSubsetSection>& sections,
        const VtArray<int>& faceVertexCounts) {
        if (faces.empty()) return;

        // Precompute triangle start offset per face
        const int totalFaces = static_cast<int>(faceVertexCounts.size());
        std::vector<int> triangleStartByFace(totalFaces, 0);
        for (int f = 1; f < totalFaces; ++f) {
            triangleStartByFace[f] = triangleStartByFace[f - 1] + (faceVertexCounts[f - 1] - 2) * 3;
        }

        // Copy, sort, deduplicate face ordinals
        VtArray<int> sortedFaceIndices(faces);
        std::sort(sortedFaceIndices.begin(), sortedFaceIndices.end());
        auto last = std::unique(sortedFaceIndices.begin(), sortedFaceIndices.end());
        sortedFaceIndices.erase(last, sortedFaceIndices.end());

        // Group contiguous faces into sections
        int firstFace = sortedFaceIndices[0];
        int currentStart = triangleStartByFace[firstFace];
        int currentLength = (faceVertexCounts[firstFace] - 2) * 3;

        for (size_t i = 1; i < sortedFaceIndices.size(); ++i) {
            int face = sortedFaceIndices[i];
            if (face == sortedFaceIndices[i - 1] + 1) {
                currentLength += (faceVertexCounts[face] - 2) * 3;
            } else {
                sections.push_back({currentStart, currentLength, materialId});
                currentStart = triangleStartByFace[face];
                currentLength = (faceVertexCounts[face] - 2) * 3;
            }
        }
        sections.push_back({currentStart, currentLength, materialId});
    }

    virtual void Sync(HdSceneDelegate *delegate,
                      HdRenderParam   *renderParam,
                      HdDirtyBits     *dirtyBits,
                      TfToken const   &reprToken) override
    {
        // Get the id of this mesh. This is used to get various resources associated with it.
        SdfPath const& id = GetId();
        const std::string idPath = id.GetAsString();
        const bool skipHydraPayloadForProto = _IsProtoMeshRprim()
            && _ownerDelegate
            && _ownerDelegate->GetPreferProtoBlobOverHydraPayload();

        // Materials need to be synced before primvars, to allow the JS side to apply primvar information like
        // displayColor if no other material is set.
        bool fetchedTopology = false;
        if (*dirtyBits & HdChangeTracker::DirtyMaterialId) {
            auto materialId = delegate->GetMaterialId(id);
            _materialIdPath = materialId.GetAsString();

            if (materialId.IsEmpty()){
                int refineLevel = _topology.GetRefineLevel();
                _topology = HdMeshTopology(delegate->GetMeshTopology(id), refineLevel);
                fetchedTopology = true;

                auto faceVertexCounts = _topology.GetFaceVertexCounts();
                auto geomSubsets = _topology.GetGeomSubsets();
                if (!geomSubsets.empty()){
                    std::vector<WebRenderDelegate::GeomSubsetSection> sections;
                    for (const auto& geomSubset : geomSubsets) {
                        const std::string materialID = geomSubset.materialId.GetAsString();
                        findContiguousSections(geomSubset.indices, materialID, sections, faceVertexCounts);
                    }

                    if (!sections.empty()) {
                        _ownerDelegate->QueueRprimGeomSubsetMaterial(idPath, sections);
                    }
                }
            }
            else {
                _ownerDelegate->QueueRprimMaterial(idPath, materialId.GetAsString());
            }
        }

        // Update points
        if (HdChangeTracker::IsPrimvarDirty(*dirtyBits, id, HdTokens->points)) {
            VtValue value = delegate->Get(id, HdTokens->points);
            _points = value.Get<VtVec3fArray>();
            _normalsValid = false;
            if (!_points.empty() && !skipHydraPayloadForProto) {
                _ownerDelegate->QueueRprimPoints(
                    idPath,
                    reinterpret_cast<float const*>(_points.cdata()),
                    static_cast<int>(_points.size() * 3));
            }
        }

        if (HdChangeTracker::IsTopologyDirty(*dirtyBits, id)) {
            // When pulling a new topology, we don't want to overwrite the
            // refine level or subdiv tags, which are provided separately by the
            // scene delegate, so we save and restore them.
            // TODO: This was copied from the Embree mesh class. We don't actually pull subdiv and refine information, since we're not handling that kind of geometry. We always only create a triangulated mesh.
            PxOsdSubdivTags subdivTags = _topology.GetSubdivTags();

            if (!fetchedTopology){
                int refineLevel = _topology.GetRefineLevel();
                _topology = HdMeshTopology(delegate->GetMeshTopology(id), refineLevel);
            }
            _topology.SetSubdivTags(subdivTags);

            // Triangulate the input faces.
            if (_meshUtil != NULL) delete _meshUtil;
            _meshUtil = new HdMeshUtil(&_topology, GetId());
            _meshUtil->ComputeTriangleIndices(&_triangulatedIndices, &_trianglePrimitiveParams);

            if (!_triangulatedIndices.empty() && !skipHydraPayloadForProto) {
                _ownerDelegate->QueueRprimIndices(
                    idPath,
                    reinterpret_cast<int32_t const*>(_triangulatedIndices.cdata()),
                    static_cast<int>(_triangulatedIndices.size() * 3));
            }

            _normalsValid = false;
            _adjacencyValid = false;
        }

        // Sync primvars
        if (HdChangeTracker::IsAnyPrimvarDirty(*dirtyBits, id)) {
            _SyncPrimvars(delegate, *dirtyBits, idPath, skipHydraPayloadForProto);
        }

        // TODO: Various sources, such as surface representation description, the topology scheme, or the availablity
        // of authored normals (as a primvar) can impact whether we want to calculate smooth normals or not. We ignore
        // all this and simply always generate them.
        _smoothNormals = true;

        // Update the smooth normals in steps:
        // 1. If the topology is dirty, update the adjacency table, a processed
        //    form of the topology that helps calculate smooth normals quickly.
        // 2. If the points are dirty, update the smooth normal buffer itself.
        if (_smoothNormals && !_adjacencyValid) {
            _adjacency.BuildAdjacencyTable(&_topology);
            _adjacencyValid = true;
            // If we rebuilt the adjacency table, force a rebuild of normals.
            _normalsValid = false;
        }

        if (_smoothNormals && !_normalsValid) {
            _computedNormals = Hd_SmoothNormals::ComputeSmoothNormals(
                &_adjacency, _points.size(), _points.cdata());
            _normalsValid = true;
            if (!_computedNormals.empty() && !skipHydraPayloadForProto) {
                _ownerDelegate->QueueRprimNormals(
                    idPath,
                    reinterpret_cast<float const*>(_computedNormals.cdata()),
                    static_cast<int>(_computedNormals.size() * 3));
            }
        }

        if (HdChangeTracker::IsTransformDirty(*dirtyBits, id)) {
            _transform = GfMatrix4f(delegate->GetTransform(id));
            if (!skipHydraPayloadForProto) {
                _ownerDelegate->QueueRprimTransform(
                    idPath,
                    reinterpret_cast<float const*>(_transform.data()),
                    16);
            }
        }

        _UpdateProtoDataBlobCache();
        *dirtyBits &= ~HdChangeTracker::AllSceneDirtyBits;
    }


    virtual HdDirtyBits GetInitialDirtyBitsMask() const override
    {
        // Set all bits except the varying flag
        return  (HdChangeTracker::AllSceneDirtyBits) &
                (~HdChangeTracker::Varying);
    }

    virtual HdDirtyBits _PropagateDirtyBits(HdDirtyBits bits) const override
    {
        return bits;
    }


protected:
    virtual void _InitRepr(TfToken const &reprToken,
                           HdDirtyBits *dirtyBits) override
    {
        _ReprVector::iterator it = std::find_if(_reprs.begin(), _reprs.end(),
                                                _ReprComparator(reprToken));
        if (it == _reprs.end()) {
            _reprs.emplace_back(reprToken, HdReprSharedPtr());
        }
    }

private:
    template <typename VecArrayT, size_t ComponentCount>
    static std::vector<float> _FlattenFloatTupleArray(VecArrayT const& values)
    {
        if (values.empty()) return {};
        const float* rawValues = reinterpret_cast<float const*>(values.cdata());
        return std::vector<float>(
            rawValues,
            rawValues + (values.size() * ComponentCount));
    }

    static std::vector<uint32_t> _FlattenTriangulatedIndices(VtVec3iArray const& values)
    {
        if (values.empty()) return {};
        std::vector<uint32_t> flattened(values.size() * 3);
        size_t writeIndex = 0;
        for (auto const& triangle : values) {
            flattened[writeIndex++] = static_cast<uint32_t>(std::max(0, triangle[0]));
            flattened[writeIndex++] = static_cast<uint32_t>(std::max(0, triangle[1]));
            flattened[writeIndex++] = static_cast<uint32_t>(std::max(0, triangle[2]));
        }
        return flattened;
    }

    TfToken _typeId;
    emscripten::val _renderDelegateInterface;
    WebRenderDelegate* _ownerDelegate;
    emscripten::val _rPrim;
    HdMeshUtil *_meshUtil;

    VtVec3iArray _triangulatedIndices;
    VtIntArray _trianglePrimitiveParams;
    VtVec3fArray _computedNormals;

    HdMeshTopology _topology;
    GfMatrix4f _transform;
    std::string _materialIdPath;
    VtVec3fArray _points;
    VtVec2fArray _uvPrimvar;
    std::string _uvPrimvarInterpolation;
    Hd_VertexAdjacency _adjacency;
    struct PrimvarPayload {
        std::string name;
        std::string interpolation;
        int dimension = 0;
        std::vector<float> values;
    };
    std::unordered_map<std::string, PrimvarPayload> _primvarPayloadByKey;

    bool _adjacencyValid;
    bool _normalsValid;
    bool _smoothNormals;

    bool _IsProtoMeshRprim() const
    {
        return GetId().GetAsString().find(".proto_") != std::string::npos;
    }

    bool _ShouldCapturePrimvarForProtoBlob(std::string const& name) const
    {
        return name == "st" || name == "primvars:st";
    }

    static std::string _NormalizePrimvarName(std::string const& name)
    {
        if (name.empty()) return {};

        std::string normalized = name;
        std::transform(
            normalized.begin(),
            normalized.end(),
            normalized.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        if (normalized.rfind("primvars:", 0) == 0) {
            normalized = normalized.substr(9);
        }
        return normalized;
    }

    static bool _TryGetSplitStPrimvarOrdinal(std::string const& name, int* outOrdinal)
    {
        if (outOrdinal) {
            *outOrdinal = -1;
        }

        const std::string normalized = _NormalizePrimvarName(name);
        if (normalized == "st") {
            if (outOrdinal) {
                *outOrdinal = 0;
            }
            return true;
        }
        if (normalized.rfind("st_", 0) != 0 || normalized.size() <= 3) {
            return false;
        }

        int ordinal = 0;
        for (size_t index = 3; index < normalized.size(); ++index) {
            const char ch = normalized[index];
            if (ch < '0' || ch > '9') {
                return false;
            }
            ordinal = (ordinal * 10) + static_cast<int>(ch - '0');
        }

        if (ordinal <= 0) {
            return false;
        }
        if (outOrdinal) {
            *outOrdinal = ordinal;
        }
        return true;
    }

    static size_t _GetExpectedFaceVaryingElementCount(HdMeshTopology const& topology)
    {
        const VtIntArray faceVertexCounts = topology.GetFaceVertexCounts();
        if (faceVertexCounts.empty()) return 0;

        size_t expectedCount = 0;
        for (const int countValue : faceVertexCounts) {
            if (countValue > 0) {
                expectedCount += static_cast<size_t>(countValue);
            }
        }
        return expectedCount;
    }

    bool _TryBuildMergedFaceVaryingStPrimvar(
        HdSceneDelegate* delegate,
        HdPrimvarDescriptorVector const& primvars,
        VtVec2fArray* outMergedPrimvar,
        std::string* outCanonicalPrimvarName = nullptr) const
    {
        if (!delegate || !outMergedPrimvar) return false;

        struct SplitPrimvarRecord {
            int ordinal = -1;
            std::string name;
            TfToken token;
        };

        std::vector<SplitPrimvarRecord> splitPrimvars;
        splitPrimvars.reserve(primvars.size());
        bool hasSplitSuffix = false;
        for (HdPrimvarDescriptor const& primvar : primvars) {
            const std::string name = primvar.name.GetString();
            int ordinal = -1;
            if (!_TryGetSplitStPrimvarOrdinal(name, &ordinal)) {
                continue;
            }
            if (ordinal > 0) {
                hasSplitSuffix = true;
            }
            splitPrimvars.push_back({ordinal, name, primvar.name});
        }

        if (splitPrimvars.size() <= 1 || !hasSplitSuffix) {
            return false;
        }

        std::sort(
            splitPrimvars.begin(),
            splitPrimvars.end(),
            [](SplitPrimvarRecord const& left, SplitPrimvarRecord const& right) {
                if (left.ordinal != right.ordinal) {
                    return left.ordinal < right.ordinal;
                }
                return left.name < right.name;
            });

        const size_t expectedCount = _GetExpectedFaceVaryingElementCount(_topology);
        if (expectedCount == 0) {
            return false;
        }

        VtVec2fArray mergedPrimvar;
        mergedPrimvar.reserve(expectedCount);
        for (SplitPrimvarRecord const& splitPrimvar : splitPrimvars) {
            const VtValue value = GetPrimvar(delegate, splitPrimvar.token);
            if (!value.CanCast<VtVec2fArray>()) {
                return false;
            }
            const VtVec2fArray currentPrimvar = value.Get<VtVec2fArray>();
            if (currentPrimvar.empty()) {
                continue;
            }
            for (GfVec2f const& uvValue : currentPrimvar) {
                mergedPrimvar.push_back(uvValue);
            }
        }

        if (mergedPrimvar.size() != expectedCount) {
            return false;
        }

        *outMergedPrimvar = std::move(mergedPrimvar);
        if (outCanonicalPrimvarName) {
            *outCanonicalPrimvarName = splitPrimvars.front().name;
        }
        return true;
    }

    static bool _ShouldQueuePrimvarToJs(std::string const& name)
    {
        if (name.empty()) return false;

        const std::string normalized = _NormalizePrimvarName(name);

        return normalized == "st"
            || normalized == "displaycolor"
            || normalized == "normals";
    }

    void _UpdateProtoDataBlobCache()
    {
        if (!_ownerDelegate || !_IsProtoMeshRprim()) return;

        WebRenderDelegate::ProtoDataBlobRecord record;
        record.valid = true;
        record.numVertices = static_cast<int>(_points.size());
        record.numIndices = static_cast<int>(_triangulatedIndices.size() * 3);
        record.numUVs = static_cast<int>(_uvPrimvar.size());
        record.uvDimension = record.numUVs > 0 ? 2 : 0;
        record.numNormals = static_cast<int>(_computedNormals.size());
        record.normalsDimension = record.numNormals > 0 ? 3 : 0;
        record.materialId = _materialIdPath;
        record.normalSource = "generatedVertex";
        record.uvSource = _uvPrimvar.empty() ? "none" : _uvPrimvarInterpolation;

        const HdGeomSubsets geomSubsets = _topology.GetGeomSubsets();
        if (!geomSubsets.empty()) {
            const VtIntArray faceVertexCounts = _topology.GetFaceVertexCounts();
            for (const HdGeomSubset& geomSubset : geomSubsets) {
                const std::string materialID = geomSubset.materialId.GetAsString();
                findContiguousSections(
                    geomSubset.indices,
                    materialID,
                    record.geomSubsetSections,
                    faceVertexCounts);
            }
        }

        if (!_points.empty()) {
            record.points = _FlattenFloatTupleArray<VtVec3fArray, 3>(_points);
        }

        if (!_triangulatedIndices.empty()) {
            record.indices = _FlattenTriangulatedIndices(_triangulatedIndices);
        }

        if (!_uvPrimvar.empty()) {
            record.uv = _FlattenFloatTupleArray<VtVec2fArray, 2>(_uvPrimvar);
        }

        if (!_computedNormals.empty()) {
            record.normals = _FlattenFloatTupleArray<VtVec3fArray, 3>(_computedNormals);
        }

        int matrixIndex = 0;
        for (int row = 0; row < 4; ++row) {
            for (int column = 0; column < 4; ++column) {
                record.transform[matrixIndex++] = _transform[row][column];
            }
        }

        WebRenderDelegate::RepairProtoDataBlobNormals(&record, record.normalSource);
        WebRenderDelegate::FinalizeProtoDataBlobRenderBuffers(&record);
        _ownerDelegate->UpsertProtoDataBlob(GetId().GetAsString(), record);
    }

    void _StorePrimvarPayload(std::string const& key,
                              std::string const& name,
                              std::string const& interpolation,
                              int dimension,
                              std::vector<float>&& values,
                              std::string const& rprimPath)
    {
        if (!_ownerDelegate || values.empty() || dimension <= 0 || rprimPath.empty()) return;
        PrimvarPayload &payload = _primvarPayloadByKey[key];
        payload.name = name;
        payload.interpolation = interpolation;
        payload.dimension = dimension;
        payload.values = std::move(values);
        _ownerDelegate->QueueRprimPrimvar(
            rprimPath,
            payload.name,
            payload.interpolation,
            payload.dimension,
            payload.values.data(),
            static_cast<int>(payload.values.size()));
    }

    // Send primvar data to JS
    void _SendPrimvar(const VtValue &value,
                      const std::string &name,
                      const HdInterpolation &interpolation,
                      std::string const& rprimPath,
                      bool queueToJs)
    {
        const std::string &ip = InterpolationStrings.at(interpolation);
        if (value.CanCast<VtVec2fArray>()) {
            VtVec2fArray primvarData = value.Get<VtVec2fArray>();
            if (_ShouldCapturePrimvarForProtoBlob(name)) {
                _uvPrimvar = primvarData;
                _uvPrimvarInterpolation = ip;
            }
            if (!queueToJs) return;
            std::vector<float> flattened = _FlattenFloatTupleArray<VtVec2fArray, 2>(primvarData);
            _StorePrimvarPayload(name + "|2|" + ip, name, ip, 2, std::move(flattened), rprimPath);
        }
        if (value.CanCast<VtVec3fArray>()) {
            if (!queueToJs) return;
            VtVec3fArray primvarData = value.Get<VtVec3fArray>();
            std::vector<float> flattened = _FlattenFloatTupleArray<VtVec3fArray, 3>(primvarData);
            _StorePrimvarPayload(name + "|3|" + ip, name, ip, 3, std::move(flattened), rprimPath);
        }
        if (value.CanCast<VtVec4fArray>()) {
            if (!queueToJs) return;
            VtVec4fArray primvarData = value.Get<VtVec4fArray>();
            std::vector<float> flattened = _FlattenFloatTupleArray<VtVec4fArray, 4>(primvarData);
            _StorePrimvarPayload(name + "|4|" + ip, name, ip, 4, std::move(flattened), rprimPath);
        }
    }

    void _SyncPrimvars(HdSceneDelegate *delegate,
                       HdDirtyBits      dirtyBits,
                       std::string const& rprimPath,
                       bool skipHydraPayloadForProto)
    {
        SdfPath const &id = GetId();
        for (size_t interpolation = HdInterpolationConstant;
                    interpolation < HdInterpolationCount;
                    ++interpolation) {
            HdInterpolation ip = static_cast<HdInterpolation>(interpolation);
            HdPrimvarDescriptorVector primvars = GetPrimvarDescriptors(delegate, ip);
            VtVec2fArray mergedFaceVaryingStPrimvar;
            std::string mergedFaceVaryingStCanonicalName;
            const bool hasMergedFaceVaryingSt = ip == HdInterpolationFaceVarying
                && _TryBuildMergedFaceVaryingStPrimvar(
                    delegate,
                    primvars,
                    &mergedFaceVaryingStPrimvar,
                    &mergedFaceVaryingStCanonicalName);

            size_t numPrimVars = primvars.size();
            for (size_t primVarNum = 0;
                        primVarNum < numPrimVars;
                    ++primVarNum) {
                HdPrimvarDescriptor const &primvar = primvars[primVarNum];
                if (HdChangeTracker::IsPrimvarDirty(dirtyBits,
                                                    id,
                                                    primvar.name)) {
                    const std::string primvarName = primvar.name.GetString();
                    const bool isMergedFaceVaryingStFamily = hasMergedFaceVaryingSt
                        && _TryGetSplitStPrimvarOrdinal(primvarName, nullptr);
                    if (isMergedFaceVaryingStFamily
                        && !mergedFaceVaryingStCanonicalName.empty()
                        && primvarName != mergedFaceVaryingStCanonicalName) {
                        continue;
                    }

                    const VtValue value = isMergedFaceVaryingStFamily
                        ? VtValue(mergedFaceVaryingStPrimvar)
                        : GetPrimvar(delegate, primvar.name);
                    const bool queueToJs = !skipHydraPayloadForProto
                        && _ShouldQueuePrimvarToJs(isMergedFaceVaryingStFamily ? std::string("st") : primvarName);

                    switch(ip) {
                        case HdInterpolationFaceVarying: {
                            HdVtBufferSource buffer(primvar.name, value);

                            VtValue triangulated;
                            if (!_meshUtil->ComputeTriangulatedFaceVaryingPrimvar(
                                    buffer.GetData(),
                                    buffer.GetNumElements(),
                                    buffer.GetTupleType().type,
                                    &triangulated)) {
                                TF_CODING_ERROR("[%s] Could not triangulate face-varying data.",
                                    primvar.name.GetText());
                                continue;
                            }

                            _SendPrimvar(
                                triangulated,
                                isMergedFaceVaryingStFamily ? std::string("st") : primvarName,
                                ip,
                                rprimPath,
                                queueToJs);
                            break;
                        }
                        case HdInterpolationConstant:
                        case HdInterpolationVertex: {
                            _SendPrimvar(
                                value,
                                primvarName,
                                ip,
                                rprimPath,
                                queueToJs);
                            break;
                        }
                        default:
                            TF_WARN("Unsupported interpolation type '%s' for primvar %s",
                                InterpolationStrings.at(ip).c_str(),
                                primvar.name.GetText());
                    }
                }
            }
        }
    }

    Emscripten_Rprim()                                 = delete;
    Emscripten_Rprim(const Emscripten_Rprim &)             = delete;
    Emscripten_Rprim &operator =(const Emscripten_Rprim &) = delete;
};

template <typename RprimT>
class Emscripten_PointBasedRprim final : public RprimT {
public:
    Emscripten_PointBasedRprim(TfToken const& typeId,
                               SdfPath const& id,
                               emscripten::val renderDelegateInterface,
                               WebRenderDelegate* ownerDelegate)
        : RprimT(id)
        , _typeId(typeId)
        , _ownerDelegate(ownerDelegate)
        , _rPrim(val::undefined())
        , _transform(1.0f)
    {
        _rPrim = renderDelegateInterface.call<val>(
            "createRPrim", std::string(typeId.GetText()), id.GetAsString());
        if (_ownerDelegate) {
            _ownerDelegate->RegisterLiveRprimPath(id.GetAsString());
        }
    }

    ~Emscripten_PointBasedRprim() override
    {
        if (!_ownerDelegate) return;
        const std::string rprimPath = this->GetId().GetAsString();
        _ownerDelegate->ClearRprimDelta(rprimPath);
        _ownerDelegate->UnregisterLiveRprimPath(rprimPath);
    }

    void Sync(HdSceneDelegate *delegate,
              HdRenderParam *renderParam,
              HdDirtyBits *dirtyBits,
              TfToken const& reprToken) override
    {
        const SdfPath& id = this->GetId();
        const std::string idPath = id.GetAsString();

        if (*dirtyBits & HdChangeTracker::DirtyMaterialId) {
            const SdfPath materialId = delegate->GetMaterialId(id);
            if (!materialId.IsEmpty()) {
                _ownerDelegate->QueueRprimMaterial(idPath, materialId.GetAsString());
            }
        }

        if (HdChangeTracker::IsPrimvarDirty(*dirtyBits, id, HdTokens->points)) {
            const VtValue value = delegate->Get(id, HdTokens->points);
            if (value.CanCast<VtVec3fArray>()) {
                _points = value.Get<VtVec3fArray>();
                if (!_points.empty()) {
                    _ownerDelegate->QueueRprimPoints(
                        idPath,
                        reinterpret_cast<float const*>(_points.cdata()),
                        static_cast<int>(_points.size() * 3));
                }
            }
        }

        if constexpr (std::is_same_v<RprimT, HdBasisCurves>) {
            if (HdChangeTracker::IsTopologyDirty(*dirtyBits, id)) {
                _curveTopology = delegate->GetBasisCurvesTopology(id);
                _ownerDelegate->QueueRprimCurveTopology(
                    idPath,
                    _curveTopology.GetCurveVertexCounts(),
                    _curveTopology.GetCurveIndices(),
                    _curveTopology.GetCurveType(),
                    _curveTopology.GetCurveBasis(),
                    _curveTopology.GetCurveWrap());
            }
        }

        if (HdChangeTracker::IsAnyPrimvarDirty(*dirtyBits, id)) {
            _SyncPrimvars(delegate, *dirtyBits, idPath);
        }

        if (HdChangeTracker::IsTransformDirty(*dirtyBits, id)) {
            _transform = GfMatrix4f(delegate->GetTransform(id));
            _ownerDelegate->QueueRprimTransform(
                idPath,
                reinterpret_cast<float const*>(_transform.data()),
                16);
        }

        *dirtyBits &= ~HdChangeTracker::AllSceneDirtyBits;
    }

    HdDirtyBits GetInitialDirtyBitsMask() const override
    {
        return HdChangeTracker::AllSceneDirtyBits & ~HdChangeTracker::Varying;
    }

    HdDirtyBits _PropagateDirtyBits(HdDirtyBits bits) const override
    {
        return bits;
    }

protected:
    void _InitRepr(TfToken const& reprToken, HdDirtyBits *dirtyBits) override
    {
        const auto it = std::find_if(
            this->_reprs.begin(),
            this->_reprs.end(),
            [&reprToken](auto const& entry) { return entry.first == reprToken; });
        if (it == this->_reprs.end()) {
            this->_reprs.emplace_back(reprToken, HdReprSharedPtr());
        }
    }

private:
    struct PrimvarPayload {
        std::string name;
        std::string interpolation;
        int dimension = 0;
        std::vector<float> values;
    };

    static std::string _NormalizePrimvarName(std::string value)
    {
        std::transform(
            value.begin(), value.end(), value.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        if (value.rfind("primvars:", 0) == 0) {
            value = value.substr(9);
        }
        return value;
    }

    void _QueuePrimvar(VtValue const& value,
                       HdPrimvarDescriptor const& descriptor,
                       HdInterpolation interpolation,
                       std::string const& idPath)
    {
        const std::string normalizedName = _NormalizePrimvarName(descriptor.name.GetString());
        if (normalizedName != "displaycolor" && normalizedName != "widths") return;

        PrimvarPayload payload;
        payload.name = descriptor.name.GetString();
        payload.interpolation = InterpolationStrings.at(interpolation);
        if (value.CanCast<VtVec3fArray>()) {
            const VtVec3fArray values = value.Get<VtVec3fArray>();
            payload.dimension = 3;
            const float* rawValues = reinterpret_cast<float const*>(values.cdata());
            payload.values.assign(rawValues, rawValues + values.size() * 3);
        } else if (value.CanCast<VtFloatArray>()) {
            const VtFloatArray values = value.Get<VtFloatArray>();
            payload.dimension = 1;
            payload.values.assign(values.begin(), values.end());
        }
        if (payload.values.empty() || payload.dimension <= 0) return;

        const std::string key = payload.name + "|" + payload.interpolation;
        _primvarPayloadByKey[key] = std::move(payload);
        PrimvarPayload const& stored = _primvarPayloadByKey.at(key);
        _ownerDelegate->QueueRprimPrimvar(
            idPath,
            stored.name,
            stored.interpolation,
            stored.dimension,
            stored.values.data(),
            static_cast<int>(stored.values.size()));
    }

    void _SyncPrimvars(HdSceneDelegate *delegate,
                       HdDirtyBits dirtyBits,
                       std::string const& idPath)
    {
        const SdfPath& id = this->GetId();
        for (size_t interpolation = HdInterpolationConstant;
             interpolation < HdInterpolationCount;
             ++interpolation) {
            const HdInterpolation interpolationToken =
                static_cast<HdInterpolation>(interpolation);
            const HdPrimvarDescriptorVector descriptors =
                this->GetPrimvarDescriptors(delegate, interpolationToken);
            for (HdPrimvarDescriptor const& descriptor : descriptors) {
                if (!HdChangeTracker::IsPrimvarDirty(dirtyBits, id, descriptor.name)) continue;
                _QueuePrimvar(
                    this->GetPrimvar(delegate, descriptor.name),
                    descriptor,
                    interpolationToken,
                    idPath);
            }
        }
    }

    TfToken _typeId;
    WebRenderDelegate* _ownerDelegate;
    emscripten::val _rPrim;
    GfMatrix4f _transform;
    VtVec3fArray _points;
    HdBasisCurvesTopology _curveTopology;
    std::unordered_map<std::string, PrimvarPayload> _primvarPayloadByKey;

    Emscripten_PointBasedRprim() = delete;
    Emscripten_PointBasedRprim(Emscripten_PointBasedRprim const&) = delete;
    Emscripten_PointBasedRprim& operator=(Emscripten_PointBasedRprim const&) = delete;
};

class Emscripten_Material final : public HdMaterial {
public:
    Emscripten_Material(SdfPath const& id, emscripten::val renderDelegateInterface) :
      HdMaterial(id)
     , _renderDelegateInterface(renderDelegateInterface)
     , _sPrim(val::undefined())
    {
      _sPrim = _renderDelegateInterface.call<val>("createSPrim", std::string("material"), id.GetAsString());
    }

    virtual ~Emscripten_Material() = default;

    virtual void Sync(HdSceneDelegate *sceneDelegate,
                      HdRenderParam   *renderParam,
                      HdDirtyBits     *dirtyBits) override
    {
      if (*dirtyBits == HdMaterial::Clean) {
        return;
      }
      runInMainThread([&]() {

        VtValue vtMat = sceneDelegate->GetMaterialResource(GetId());
        if (vtMat.IsHolding<HdMaterialNetworkMap>()) {
            HdMaterialNetworkMap const& hdNetworkMap =
                vtMat.UncheckedGet<HdMaterialNetworkMap>();

            for (auto& [networkId, network]: hdNetworkMap.map) {
                for (auto& node : network.nodes) {
                    val parameters = val::object();
                    for (auto &[parameterName, value] : node.parameters) {
                        parameters.set(parameterName, value._GetJsVal());
                        if (value.IsHolding<SdfAssetPath>()) {
                            SdfAssetPath assetPath = value.Get<SdfAssetPath>();
                            parameters.set("resolvedPath", assetPath.GetResolvedPath());
                        }
                    }
                    _sPrim.call<val>("updateNode", networkId.GetString(), node.path.GetAsString(), parameters);
                }

                val relationships = val::array();
                int i = 0;
                for (auto &relationship : network.relationships) {
                    val relationshipObj = val::object();
                    relationshipObj.set("inputId", relationship.inputId.GetAsString());
                    relationshipObj.set("inputName", relationship.inputName);
                    relationshipObj.set("outputId", relationship.outputId.GetAsString());
                    relationshipObj.set("outputName", relationship.outputName);
                    relationships.set(i++, relationshipObj);
                }

                _sPrim.call<val>("updateFinished", networkId.GetString(), relationships);
            }
        }
        *dirtyBits = HdMaterial::Clean;
      });
    };

    virtual HdDirtyBits GetInitialDirtyBitsMask() const override {
        return HdMaterial::AllDirty;
    }

private:
    emscripten::val _renderDelegateInterface;
    emscripten::val _sPrim;


    Emscripten_Material()                                  = delete;
    Emscripten_Material(const Emscripten_Material &)             = delete;
    Emscripten_Material &operator =(const Emscripten_Material &) = delete;
};

const TfTokenVector WebRenderDelegate::SUPPORTED_RPRIM_TYPES =
{
    HdPrimTypeTokens->mesh,
    HdPrimTypeTokens->points,
    HdPrimTypeTokens->basisCurves
};

const TfTokenVector WebRenderDelegate::SUPPORTED_SPRIM_TYPES =
{
    HdPrimTypeTokens->material
};

const TfTokenVector WebRenderDelegate::SUPPORTED_BPRIM_TYPES =
{
};

const TfTokenVector &
WebRenderDelegate::GetSupportedRprimTypes() const
{
    return SUPPORTED_RPRIM_TYPES;
}

const TfTokenVector &
WebRenderDelegate::GetSupportedSprimTypes() const
{
    return SUPPORTED_SPRIM_TYPES;
}

const TfTokenVector &
WebRenderDelegate::GetSupportedBprimTypes() const
{
    return SUPPORTED_BPRIM_TYPES;
}

HdRenderParam *
WebRenderDelegate::GetRenderParam() const
{
    return nullptr;
}

HdResourceRegistrySharedPtr
WebRenderDelegate::GetResourceRegistry() const
{
    static HdResourceRegistrySharedPtr resourceRegistry(new HdResourceRegistry);
    return resourceRegistry;
}

HdRenderPassSharedPtr
WebRenderDelegate::CreateRenderPass(HdRenderIndex *index,
                                HdRprimCollection const& collection)
{
    return HdRenderPassSharedPtr(
        new Hd_UnitTestNullRenderPass(index, collection));
}

HdInstancer *
WebRenderDelegate::CreateInstancer(HdSceneDelegate *delegate,
                                               SdfPath const& id)
{
    return new HdInstancer(delegate, id);
}

void
WebRenderDelegate::DestroyInstancer(HdInstancer *instancer)
{
    delete instancer;
}


HdRprim *
WebRenderDelegate::CreateRprim(TfToken const& typeId,
                                    SdfPath const& rprimId)
{
    if (typeId == HdPrimTypeTokens->mesh) {
        return new Emscripten_Rprim(typeId, rprimId, _renderDelegateInterface, this);
    }
    if (typeId == HdPrimTypeTokens->points) {
        return new Emscripten_PointBasedRprim<HdPoints>(
            typeId, rprimId, _renderDelegateInterface, this);
    }
    if (typeId == HdPrimTypeTokens->basisCurves) {
        return new Emscripten_PointBasedRprim<HdBasisCurves>(
            typeId, rprimId, _renderDelegateInterface, this);
    }
    TF_CODING_ERROR("Unknown Rprim Type %s", typeId.GetText());
    return nullptr;
}

void
WebRenderDelegate::DestroyRprim(HdRprim *rPrim)
{
    delete rPrim;
}

HdSprim *
WebRenderDelegate::CreateSprim(TfToken const& typeId,
                                           SdfPath const& sprimId)
{
    if (typeId == HdPrimTypeTokens->material) {
        return new Emscripten_Material(sprimId, _renderDelegateInterface);
    } else {
        TF_CODING_ERROR("Unknown Sprim Type %s", typeId.GetText());
    }

    return nullptr;
}

HdSprim *
WebRenderDelegate::CreateFallbackSprim(TfToken const& typeId)
{
    if (typeId == HdPrimTypeTokens->material) {
        return new Emscripten_Material(SdfPath::EmptyPath(), _renderDelegateInterface);
    } else {
        TF_CODING_ERROR("Unknown Sprim Type %s", typeId.GetText());
    }

    return nullptr;
}


void
WebRenderDelegate::DestroySprim(HdSprim *sPrim)
{
    delete sPrim;
}

HdBprim *
WebRenderDelegate::CreateBprim(TfToken const& typeId,
                                    SdfPath const& bprimId)
{
    TF_CODING_ERROR("Unknown Bprim Type %s", typeId.GetText());

    return nullptr;
}

HdBprim *
WebRenderDelegate::CreateFallbackBprim(TfToken const& typeId)
{
    TF_CODING_ERROR("Unknown Bprim Type %s", typeId.GetText());

    return nullptr;
}

void
WebRenderDelegate::DestroyBprim(HdBprim *bPrim)
{
    delete bPrim;
}

void
WebRenderDelegate::CommitResources(HdChangeTracker *tracker)
{
    _renderDelegateInterface.call<void>("CommitResources");
}

void
WebRenderDelegate::UpsertProtoDataBlob(std::string const& rprimPath,
                                       ProtoDataBlobRecord const& record)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_protoDataBlobMutex);
    _protoDataBlobByRprimPath[rprimPath] = record;
}

bool
WebRenderDelegate::ReadProtoDataBlob(
    std::string const& rprimPath,
    std::function<void(ProtoDataBlobRecord const&)> const& reader) const
{
    if (!reader || rprimPath.empty()) return false;
    std::lock_guard<std::mutex> lock(_protoDataBlobMutex);
    const auto found = _protoDataBlobByRprimPath.find(rprimPath);
    if (found == _protoDataBlobByRprimPath.end()) return false;
    reader(found->second);
    return true;
}

void
WebRenderDelegate::ReadAllProtoDataBlobs(
    std::function<void(std::string const&, ProtoDataBlobRecord const&)> const& reader) const
{
    if (!reader) return;
    std::lock_guard<std::mutex> lock(_protoDataBlobMutex);
    for (auto const& entry : _protoDataBlobByRprimPath) {
        reader(entry.first, entry.second);
    }
}

void
WebRenderDelegate::RemoveProtoDataBlob(std::string const& rprimPath)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_protoDataBlobMutex);
    _protoDataBlobByRprimPath.erase(rprimPath);
}

void
WebRenderDelegate::RegisterLiveRprimPath(std::string const& rprimPath)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_liveRprimPathMutex);
    if (_liveRprimPathSet.insert(rprimPath).second) {
        _liveRprimPathOrder.push_back(rprimPath);
    }
}

void
WebRenderDelegate::UnregisterLiveRprimPath(std::string const& rprimPath)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_liveRprimPathMutex);
    _liveRprimPathSet.erase(rprimPath);
}

void
WebRenderDelegate::ReadAllLiveRprimPaths(
    std::function<void(std::string const&)> const& reader) const
{
    if (!reader) return;
    std::lock_guard<std::mutex> lock(_liveRprimPathMutex);
    for (std::string const& rprimPath : _liveRprimPathOrder) {
        if (_liveRprimPathSet.find(rprimPath) == _liveRprimPathSet.end()) continue;
        reader(rprimPath);
    }
}

void
WebRenderDelegate::SetPreferProtoBlobOverHydraPayload(bool prefer)
{
    _preferProtoBlobOverHydraPayload.store(prefer, std::memory_order_release);
}

bool
WebRenderDelegate::GetPreferProtoBlobOverHydraPayload() const
{
    return _preferProtoBlobOverHydraPayload.load(std::memory_order_acquire);
}

void
WebRenderDelegate::QueueRprimMaterial(std::string const& rprimPath,
                                      std::string const& materialId)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.hasMaterialId = true;
    record.materialId = materialId;
    record.dirtyMask |= kRprimDeltaDirtyMaterial;
}

void
WebRenderDelegate::QueueRprimGeomSubsetMaterial(
    std::string const& rprimPath,
    std::vector<GeomSubsetSection> const& sections)
{
    if (rprimPath.empty() || sections.empty()) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.geomSubsetSections = sections;
    record.dirtyMask |= kRprimDeltaDirtyGeomSubsetMaterial;
}

void
WebRenderDelegate::QueueRprimPoints(std::string const& rprimPath,
                                    float const* points,
                                    int pointsCount)
{
    if (rprimPath.empty() || !points || pointsCount <= 0) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.pointsPtr = reinterpret_cast<uintptr_t>(points);
    record.pointsCount = pointsCount;
    record.dirtyMask |= kRprimDeltaDirtyPoints;
}

void
WebRenderDelegate::QueueRprimIndices(std::string const& rprimPath,
                                     int32_t const* indices,
                                     int indicesCount)
{
    if (rprimPath.empty() || !indices || indicesCount <= 0) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.indicesPtr = reinterpret_cast<uintptr_t>(indices);
    record.indicesCount = indicesCount;
    record.dirtyMask |= kRprimDeltaDirtyIndices;
}

void
WebRenderDelegate::QueueRprimNormals(std::string const& rprimPath,
                                     float const* normals,
                                     int normalsCount)
{
    if (rprimPath.empty() || !normals || normalsCount <= 0) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.normalsPtr = reinterpret_cast<uintptr_t>(normals);
    record.normalsCount = normalsCount;
    record.dirtyMask |= kRprimDeltaDirtyNormals;
}

void
WebRenderDelegate::QueueRprimTransform(std::string const& rprimPath,
                                       float const* transform,
                                       int transformCount)
{
    if (rprimPath.empty() || !transform || transformCount <= 0) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.transformPtr = reinterpret_cast<uintptr_t>(transform);
    record.transformCount = transformCount;
    record.dirtyMask |= kRprimDeltaDirtyTransform;
}

void
WebRenderDelegate::QueueRprimPrimvar(std::string const& rprimPath,
                                     std::string const& name,
                                     std::string const& interpolation,
                                     int dimension,
                                     float const* data,
                                     int dataCount)
{
    if (rprimPath.empty() || name.empty() || interpolation.empty() || dimension <= 0 || !data || dataCount <= 0) {
        return;
    }

    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    auto existing = std::find_if(
        record.primvars.begin(),
        record.primvars.end(),
        [&](RprimPrimvarDeltaRecord const& primvar) {
            return primvar.name == name
                && primvar.interpolation == interpolation
                && primvar.dimension == dimension;
        });
    if (existing == record.primvars.end()) {
        record.primvars.push_back(RprimPrimvarDeltaRecord{
            name,
            interpolation,
            dimension,
            reinterpret_cast<uintptr_t>(data),
            dataCount,
        });
    } else {
        existing->dataPtr = reinterpret_cast<uintptr_t>(data);
        existing->dataCount = dataCount;
    }
    record.dirtyMask |= kRprimDeltaDirtyPrimvars;
}

void
WebRenderDelegate::QueueRprimCurveTopology(
    std::string const& rprimPath,
    VtIntArray const& curveVertexCounts,
    VtIntArray const& curveIndices,
    TfToken const& curveType,
    TfToken const& curveBasis,
    TfToken const& curveWrap)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.curveVertexCounts.assign(curveVertexCounts.begin(), curveVertexCounts.end());
    record.curveIndices.assign(curveIndices.begin(), curveIndices.end());
    record.curveType = curveType.GetString();
    record.curveBasis = curveBasis.GetString();
    record.curveWrap = curveWrap.GetString();
    record.dirtyMask |= kRprimDeltaDirtyCurveTopology;
}

void
WebRenderDelegate::ClearRprimDelta(std::string const& rprimPath)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    _rprimDeltaByPath.erase(rprimPath);
}

emscripten::val
WebRenderDelegate::TakeRprimDeltaBatch()
{
    emscripten::val batch = emscripten::val::object();
    emscripten::val entries = emscripten::val::object();
    batch.set("entries", entries);
    batch.set("count", 0.0);

    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    int emitted = 0;
    for (std::string const& rprimPath : _rprimDeltaOrder) {
        const auto found = _rprimDeltaByPath.find(rprimPath);
        if (found == _rprimDeltaByPath.end()) continue;
        RprimDeltaRecord const& record = found->second;
        if (record.dirtyMask == 0) continue;

        emscripten::val delta = emscripten::val::object();
        delta.set("dirtyMask", static_cast<double>(record.dirtyMask));

        if (record.hasMaterialId) {
            delta.set("materialId", record.materialId);
        }

        if (!record.geomSubsetSections.empty()) {
            emscripten::val sectionArray = emscripten::val::array();
            int sectionIndex = 0;
            for (GeomSubsetSection const& section : record.geomSubsetSections) {
                emscripten::val sectionObject = emscripten::val::object();
                sectionObject.set("start", section.start);
                sectionObject.set("length", section.length);
                sectionObject.set("materialId", section.materialId);
                sectionArray.set(sectionIndex++, sectionObject);
            }
            delta.set("geomSubsetSections", sectionArray);
        }

        if (record.pointsPtr != 0 && record.pointsCount > 0) {
            delta.set("pointsPtr", static_cast<double>(record.pointsPtr));
            delta.set("pointsCount", static_cast<double>(record.pointsCount));
        }

        if (record.indicesPtr != 0 && record.indicesCount > 0) {
            delta.set("indicesPtr", static_cast<double>(record.indicesPtr));
            delta.set("indicesCount", static_cast<double>(record.indicesCount));
        }

        if (record.normalsPtr != 0 && record.normalsCount > 0) {
            delta.set("normalsPtr", static_cast<double>(record.normalsPtr));
            delta.set("normalsCount", static_cast<double>(record.normalsCount));
        }

        if (record.transformPtr != 0 && record.transformCount > 0) {
            delta.set("transformPtr", static_cast<double>(record.transformPtr));
            delta.set("transformCount", static_cast<double>(record.transformCount));
        }

        if (!record.primvars.empty()) {
            emscripten::val primvarArray = emscripten::val::array();
            int primvarIndex = 0;
            for (RprimPrimvarDeltaRecord const& primvar : record.primvars) {
                if (primvar.dataPtr == 0 || primvar.dataCount <= 0 || primvar.dimension <= 0) continue;
                emscripten::val primvarObject = emscripten::val::object();
                primvarObject.set("name", primvar.name);
                primvarObject.set("interpolation", primvar.interpolation);
                primvarObject.set("dimension", primvar.dimension);
                primvarObject.set("dataPtr", static_cast<double>(primvar.dataPtr));
                primvarObject.set("dataCount", static_cast<double>(primvar.dataCount));
                primvarArray.set(primvarIndex++, primvarObject);
            }
            if (primvarIndex > 0) {
                delta.set("primvars", primvarArray);
            }
        }

        if (!record.curveVertexCounts.empty()) {
            emscripten::val topology = emscripten::val::object();
            emscripten::val curveVertexCounts = emscripten::val::array();
            for (size_t index = 0; index < record.curveVertexCounts.size(); ++index) {
                curveVertexCounts.set(index, record.curveVertexCounts[index]);
            }
            emscripten::val curveIndices = emscripten::val::array();
            for (size_t index = 0; index < record.curveIndices.size(); ++index) {
                curveIndices.set(index, record.curveIndices[index]);
            }
            topology.set("curveVertexCounts", curveVertexCounts);
            topology.set("curveIndices", curveIndices);
            topology.set("type", record.curveType);
            topology.set("basis", record.curveBasis);
            topology.set("wrap", record.curveWrap);
            delta.set("curveTopology", topology);
        }

        entries.set(rprimPath, delta);
        emitted += 1;
    }

    _rprimDeltaByPath.clear();
    _rprimDeltaOrder.clear();
    batch.set("count", static_cast<double>(emitted));
    return batch;
}

PXR_NAMESPACE_CLOSE_SCOPE
