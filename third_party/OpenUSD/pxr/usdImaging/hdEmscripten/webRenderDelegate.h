#ifndef PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_RENDER_DELEGATE_H
#define PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_RENDER_DELEGATE_H

#include "pxr/pxr.h"
#include "pxr/imaging/hd/renderDelegate.h"
#include "pxr/imaging/hd/instancer.h"
#include "pxr/imaging/hd/mesh.h"
#include "pxr/imaging/hd/enums.h"
#include "pxr/imaging/hd/vertexAdjacency.h"
#include "pxr/base/gf/matrix4f.h"
#include "pxr/base/gf/vec2f.h"
#include "pxr/base/gf/vec3f.h"
#include "pxr/base/gf/vec4f.h"
#include "pxr/base/gf/vec2d.h"
#include "pxr/base/gf/vec3d.h"
#include "pxr/base/gf/vec4d.h"
#include "pxr/base/gf/vec2i.h"
#include "pxr/base/gf/vec3i.h"
#include "pxr/base/gf/vec4i.h"

#include <emscripten/bind.h>
#include <emscripten/threading.h>

#include <atomic>
#include <array>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

PXR_NAMESPACE_OPEN_SCOPE

class WebRenderDelegate final : public HdRenderDelegate
{
public:
    struct GeomSubsetSection
    {
        int start = 0;
        int length = 0;
        std::string materialId;
    };

    struct ProtoDataBlobRecord
    {
        bool valid = false;
        int numVertices = 0;
        int numIndices = 0;
        int numUVs = 0;
        int uvDimension = 0;
        int numNormals = 0;
        int normalsDimension = 0;
        std::vector<float> points;
        std::vector<uint32_t> indices;
        std::vector<float> uv;
        std::vector<float> normals;
        std::array<float, 16> transform = {0.0f};
        std::string materialId;
        std::vector<GeomSubsetSection> geomSubsetSections;
        std::string normalSource = "none";
        std::string uvSource = "none";
        bool renderReady = false;
        std::string topologyMode = "indexed";
        int normalRepairCount = 0;
        int normalFallbackCount = 0;
        int postRepairLowDotCount = 0;
    };

    struct RprimPrimvarDeltaRecord
    {
        std::string name;
        std::string interpolation;
        int dimension = 0;
        uintptr_t dataPtr = 0;
        int dataCount = 0;
    };

    struct RprimDeltaRecord
    {
        uint32_t dirtyMask = 0;
        bool hasMaterialId = false;
        std::string materialId;
        std::vector<GeomSubsetSection> geomSubsetSections;
        uintptr_t pointsPtr = 0;
        int pointsCount = 0;
        uintptr_t indicesPtr = 0;
        int indicesCount = 0;
        uintptr_t normalsPtr = 0;
        int normalsCount = 0;
        uintptr_t transformPtr = 0;
        int transformCount = 0;
        std::vector<RprimPrimvarDeltaRecord> primvars;
        std::vector<int32_t> curveVertexCounts;
        std::vector<int32_t> curveIndices;
        std::string curveType;
        std::string curveBasis;
        std::string curveWrap;
    };

    enum RprimDeltaDirtyMask : uint32_t
    {
        kRprimDeltaDirtyMaterial = 1u << 0,
        kRprimDeltaDirtyGeomSubsetMaterial = 1u << 1,
        kRprimDeltaDirtyPoints = 1u << 2,
        kRprimDeltaDirtyIndices = 1u << 3,
        kRprimDeltaDirtyPrimvars = 1u << 4,
        kRprimDeltaDirtyNormals = 1u << 5,
        kRprimDeltaDirtyTransform = 1u << 6,
        kRprimDeltaDirtyCurveTopology = 1u << 7,
    };

    WebRenderDelegate(emscripten::val renderDelegateInterface) :
             _renderDelegateInterface(renderDelegateInterface)
    {

    };
    virtual ~WebRenderDelegate() = default;

    virtual const TfTokenVector &GetSupportedRprimTypes() const override;
    virtual const TfTokenVector &GetSupportedSprimTypes() const override;
    virtual const TfTokenVector &GetSupportedBprimTypes() const override;
    virtual HdRenderParam *GetRenderParam() const override;
    virtual HdResourceRegistrySharedPtr GetResourceRegistry() const override;

    ////////////////////////////////////////////////////////////////////////////
    ///
    /// Renderpass factory
    ///
    ////////////////////////////////////////////////////////////////////////////

    virtual HdRenderPassSharedPtr CreateRenderPass(HdRenderIndex *index,
                HdRprimCollection const& collection) override;

    ////////////////////////////////////////////////////////////////////////////
    ///
    /// Instancer Factory
    ///
    ////////////////////////////////////////////////////////////////////////////

    virtual HdInstancer *CreateInstancer(HdSceneDelegate *delegate,
                                         SdfPath const& id) override;

    virtual void DestroyInstancer(HdInstancer *instancer) override;

    ////////////////////////////////////////////////////////////////////////////
    ///
    /// Prim Factories
    ///
    ////////////////////////////////////////////////////////////////////////////

    virtual HdRprim *CreateRprim(TfToken const& typeId,
                                 SdfPath const& rprimId) override;

    virtual void DestroyRprim(HdRprim *rPrim) override;

    virtual HdSprim *CreateSprim(TfToken const& typeId,
                                 SdfPath const& sprimId) override;

    virtual HdSprim *CreateFallbackSprim(TfToken const& typeId) override;
    virtual void DestroySprim(HdSprim *sprim) override;

    virtual HdBprim *CreateBprim(TfToken const& typeId,
                                 SdfPath const& bprimId) override;

    virtual HdBprim *CreateFallbackBprim(TfToken const& typeId) override;

    virtual void DestroyBprim(HdBprim *bprim) override;

    ////////////////////////////////////////////////////////////////////////////
    ///
    /// Sync, Execute & Dispatch Hooks
    ///
    ////////////////////////////////////////////////////////////////////////////

    virtual void CommitResources(HdChangeTracker *tracker) override;

    void UpsertProtoDataBlob(std::string const& rprimPath,
                             ProtoDataBlobRecord const& record);
    static void RepairProtoDataBlobNormals(ProtoDataBlobRecord* record,
                                           std::string const& normalSource);
    static void FinalizeProtoDataBlobRenderBuffers(ProtoDataBlobRecord* record);
    bool ReadProtoDataBlob(
        std::string const& rprimPath,
        std::function<void(ProtoDataBlobRecord const&)> const& reader) const;
    void ReadAllProtoDataBlobs(
        std::function<void(std::string const&, ProtoDataBlobRecord const&)> const& reader) const;
    void RemoveProtoDataBlob(std::string const& rprimPath);
    void RegisterLiveRprimPath(std::string const& rprimPath);
    void UnregisterLiveRprimPath(std::string const& rprimPath);
    void ReadAllLiveRprimPaths(
        std::function<void(std::string const&)> const& reader) const;

    void QueueRprimMaterial(std::string const& rprimPath,
                            std::string const& materialId);
    void QueueRprimGeomSubsetMaterial(std::string const& rprimPath,
                                      std::vector<GeomSubsetSection> const& sections);
    void QueueRprimPoints(std::string const& rprimPath,
                          float const* points,
                          int pointsCount);
    void QueueRprimIndices(std::string const& rprimPath,
                           int32_t const* indices,
                           int indicesCount);
    void QueueRprimNormals(std::string const& rprimPath,
                           float const* normals,
                           int normalsCount);
    void QueueRprimTransform(std::string const& rprimPath,
                             float const* transform,
                             int transformCount);
    void QueueRprimPrimvar(std::string const& rprimPath,
                           std::string const& name,
                           std::string const& interpolation,
                           int dimension,
                           float const* data,
                           int dataCount);
    void QueueRprimCurveTopology(std::string const& rprimPath,
                                 VtIntArray const& curveVertexCounts,
                                 VtIntArray const& curveIndices,
                                 TfToken const& curveType,
                                 TfToken const& curveBasis,
                                 TfToken const& curveWrap);
    void ClearRprimDelta(std::string const& rprimPath);
    emscripten::val TakeRprimDeltaBatch();
    void SetPreferProtoBlobOverHydraPayload(bool prefer);
    bool GetPreferProtoBlobOverHydraPayload() const;

private:
    static const TfTokenVector SUPPORTED_RPRIM_TYPES;
    static const TfTokenVector SUPPORTED_SPRIM_TYPES;
    static const TfTokenVector SUPPORTED_BPRIM_TYPES;

    WebRenderDelegate(
                                const WebRenderDelegate &) = delete;
    WebRenderDelegate &operator =(
                                const WebRenderDelegate &) = delete;

    emscripten::val _renderDelegateInterface;
    mutable std::mutex _protoDataBlobMutex;
    std::unordered_map<std::string, ProtoDataBlobRecord> _protoDataBlobByRprimPath;
    mutable std::mutex _liveRprimPathMutex;
    std::unordered_set<std::string> _liveRprimPathSet;
    std::vector<std::string> _liveRprimPathOrder;
    mutable std::mutex _rprimDeltaMutex;
    std::unordered_map<std::string, RprimDeltaRecord> _rprimDeltaByPath;
    std::vector<std::string> _rprimDeltaOrder;
    std::atomic<bool> _preferProtoBlobOverHydraPayload{true};
};

PXR_NAMESPACE_CLOSE_SCOPE

#endif // PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_RENDER_DELEGATE_H
