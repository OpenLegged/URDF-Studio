#ifndef PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_TESTDRIVER_H
#define PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_TESTDRIVER_H

/// \file usdImaging/emscripteTest/testdriver.h

#include "pxr/pxr.h"
#include "pxr/usdImaging/usdImaging/delegate.h"

#include "pxr/imaging/hd/changeTracker.h"
#include "pxr/imaging/hd/engine.h"
#include "pxr/imaging/hd/renderIndex.h"
#include "pxr/imaging/hd/renderPass.h"
#include "pxr/imaging/hd/rprim.h"
#include "pxr/imaging/hd/rprimCollection.h"
#include "pxr/imaging/hd/tokens.h"
#include "pxr/usd/ar/asset.h"
#include "pxr/usd/ar/resolver.h"
#include "pxr/usd/ar/resolverContextBinder.h"
#include "pxr/base/tf/stringUtils.h"
#include "pxr/base/vt/array.h"
#include "pxr/base/gf/quatd.h"
#include "pxr/base/gf/vec2d.h"
#include "pxr/base/gf/vec2f.h"
#include "pxr/base/gf/vec3f.h"
#include "pxr/base/gf/vec3d.h"
#include "pxr/usd/sdf/assetPath.h"
#include "pxr/usd/usdGeom/xformable.h"
#include "pxr/usd/usdGeom/xformCache.h"
#include "pxr/usd/usdGeom/imageable.h"
#include "pxr/usd/usdGeom/metrics.h"
#include "pxr/usd/usdGeom/mesh.h"
#include "pxr/usd/usdGeom/pointBased.h"
#include "pxr/usd/usdGeom/points.h"
#include "pxr/usd/usdGeom/basisCurves.h"
#include "pxr/usd/usdGeom/primvar.h"
#include "pxr/usd/usdGeom/subset.h"
#include "pxr/usd/usdGeom/cube.h"
#include "pxr/usd/usdGeom/sphere.h"
#include "pxr/usd/usdGeom/cylinder.h"
#include "pxr/usd/usdGeom/capsule.h"
#include "pxr/usd/usd/stageLoadRules.h"
#include "pxr/usd/usd/variantSets.h"
#include "pxr/usd/usdShade/material.h"
#include "pxr/usd/usdShade/materialBindingAPI.h"
#include "pxr/usd/usd/primFlags.h"
#include "pxr/usd/usd/primRange.h"

#include "webRenderDelegate.h"
#include "pxr/imaging/hd/unitTestNullRenderPass.h"
#include <emscripten/bind.h>
#include "pxr/usd/usdSkel/bakeSkinning.h"
#include "pxr/usd/usdSkel/bindingAPI.h"
#include "pxr/usd/usdSkel/root.h"
#include "pxr/usd/usdSkel/skeleton.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <cmath>
#include <cstdio>
#include <initializer_list>
#include <memory>
#include <mutex>
#include <vector>
#include <string>
#include <utility>
#include <unordered_map>
#include <unordered_set>

PXR_NAMESPACE_OPEN_SCOPE

using HdRenderPassSharedPtr = std::shared_ptr<HdRenderPass>;

/// A simple test task that just causes sync processing
class WebSyncTask final : public HdTask
{
public:
    WebSyncTask(HdRenderPassSharedPtr const &renderPass,
                        TfTokenVector const &renderTags)
        : HdTask(SdfPath::EmptyPath())
        , _renderPass(renderPass)
        , _renderTags(renderTags)
    {
    }

    virtual void Sync(HdSceneDelegate* delegate,
                      HdTaskContext* ctx,
                      HdDirtyBits* dirtyBits) override {
        _renderPass->Sync();

        *dirtyBits = HdChangeTracker::Clean;
    }

    virtual void Prepare(HdTaskContext* ctx,
                         HdRenderIndex* renderIndex) override {
    }

    virtual void Execute(HdTaskContext* ctx) override {
    }

    virtual const TfTokenVector &GetRenderTags() const override {
        return _renderTags;
    }

private:
    HdRenderPassSharedPtr _renderPass;
    TfTokenVector _renderTags;
};

/// \class HdWebSyncDriver
///
/// A driver that syncs to the Emscripten Web Renderer.
///
/// \note This test driver uses a Null render delegate, so
/// no images are produced.  It just syncs between Hydra and
/// a Web Renderer.
///
class HdWebSyncDriver final {
public:
    HdWebSyncDriver(emscripten::val renderDelegateInterface,
                                    std::string const& usdFilePath)
        : _engine()
        , _renderDelegate(renderDelegateInterface)
        , _renderIndex(nullptr)
        , _delegate(nullptr)
        , _geometryPass()
        , _stage()
    {
        HdRprimCollection collection = HdRprimCollection(
                HdTokens->geometry,
                HdReprSelector(HdReprTokens->hull));

        TfTokenVector renderTags;
        renderTags.push_back(HdRenderTagTokens->geometry);

        _Init(_OpenStageForPathWithProfile(renderDelegateInterface, usdFilePath),
              collection,
              SdfPath::AbsoluteRootPath(),
              renderTags,
              _ShouldSkipHydraPopulateForRobotSceneSnapshot(renderDelegateInterface));
    }

    HdWebSyncDriver(emscripten::val renderDelegateInterface,
                                    UsdStageRefPtr const& usdStage)
        : _engine()
        , _renderDelegate(renderDelegateInterface)
        , _renderIndex(nullptr)
        , _delegate(nullptr)
        , _geometryPass()
        , _stage()
    {
        HdRprimCollection collection = HdRprimCollection(
                HdTokens->geometry,
                HdReprSelector(HdReprTokens->hull));

        TfTokenVector renderTags;
        renderTags.push_back(HdRenderTagTokens->geometry);

        _Init(usdStage,
              collection,
              SdfPath::AbsoluteRootPath(),
              renderTags,
              false);
    }

    ~HdWebSyncDriver()
    {
        delete _delegate;
        delete _renderIndex;
    }

    void Draw() {
        _delegate->ApplyPendingUpdates();
        HdTaskSharedPtrVector tasks = {
            std::make_shared<WebSyncTask>(_geometryPass, _renderTags)
        };
        _engine.Execute(&_delegate->GetRenderIndex(), &tasks);
    }

    void getFile(std::string filename, emscripten::val callback) {
        auto& resolver = ArGetResolver();
        ArResolverContextBinder binder(&resolver, _stage->GetPathResolverContext());

        std::shared_ptr<ArAsset> asset = resolver.OpenAsset(ArResolvedPath(filename));
        if (!asset) {
            callback(emscripten::val::undefined());
            return;
        }

        std::shared_ptr<const char> buffer = asset->GetBuffer();
        if (!buffer) {
            callback(emscripten::val::undefined());
            return;
        }

        size_t bufferSize = asset->GetSize();
        callback(emscripten::val(emscripten::typed_memory_view(bufferSize, buffer.get())));
    }
    void SetTime(double time) {
        _delegate->SetTime(time);
    }

    void SetPreferProtoBlobOverHydraPayload(bool prefer) {
        _renderDelegate.SetPreferProtoBlobOverHydraPayload(prefer);
    }

    bool GetPreferProtoBlobOverHydraPayload() const {
        return _renderDelegate.GetPreferProtoBlobOverHydraPayload();
    }

    void SetPreferDirectStageRobotSceneSnapshot(bool prefer) {
        _preferDirectStageRobotSceneSnapshot = prefer;
    }

    bool GetPreferDirectStageRobotSceneSnapshot() const {
        return _preferDirectStageRobotSceneSnapshot;
    }

    double GetTime() {
        return _delegate->GetTime().GetValue();
    }

    /// Marks an rprim in the RenderIndex as dirty with the given dirty flags.
    void MarkRprimDirty(SdfPath path, HdDirtyBits flag) {
        _delegate->GetRenderIndex().GetChangeTracker()
            .MarkRprimDirty(path, flag);
    }

    /// Returns the underlying delegate for this driver.
    UsdImagingDelegate& GetDelegate() {
        return *_delegate;
    }

    /// Returns the populated UsdStage for this driver.
    UsdStageRefPtr const& GetStage() {
        return _stage;
    }

    emscripten::val GetPrimTransforms() {
        emscripten::val result = emscripten::val::object();
        result.set("format", std::string("packed-v1"));
        result.set("paths", emscripten::val::array());
        result.set("world", _FloatVectorToJsFloat32Array({}));
        result.set("local", _FloatVectorToJsFloat32Array({}));
        result.set("stride", 16.0);
        result.set("count", 0.0);

        if (!_stage) {
            return result;
        }

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        const GfMatrix4d identity(1.0);
        std::vector<std::string> primPaths;
        std::vector<float> worldValues;
        std::vector<float> localValues;

        for (const UsdPrim& rootPrim : _stage->GetPseudoRoot().GetChildren()) {
            _CollectPrimTransformsRecursive(
                rootPrim,
                identity,
                timeCode,
                &primPaths,
                &worldValues,
                &localValues);
        }

        result.set("paths", _StringVectorToJsArray(primPaths));
        result.set("world", _FloatVectorToJsFloat32Array(worldValues));
        result.set("local", _FloatVectorToJsFloat32Array(localValues));
        result.set("count", static_cast<double>(primPaths.size()));
        return result;
    }

    emscripten::val GetPrimTransformsForPaths(emscripten::val primPaths) {
        return _BuildPrimTransformsForNormalizedPaths(
            _NormalizeUniquePathsFromJsArray(primPaths));
    }

    emscripten::val GetLastInitProfile() const {
        return _DriverInitProfileToJsVal(_lastInitProfile);
    }

    emscripten::val GetLastRobotSceneSnapshotProfile() const {
        return _RobotSceneSnapshotProfileToJsVal(_lastRobotSceneSnapshotProfile);
    }

    emscripten::val GetPrimPathSet() {
        emscripten::val primPaths = emscripten::val::array();
        if (!_stage) return primPaths;

        int index = 0;
        std::unordered_set<std::string> seenPaths;
        seenPaths.reserve(4096);
        auto appendPrimPath = [&](UsdPrim const& prim) {
            if (!prim) return;
            const std::string path = prim.GetPath().GetString();
            if (path.empty()) return;
            if (!seenPaths.insert(path).second) return;
            primPaths.set(index++, path);
        };

        // Default traversal excludes instance proxies, which means many authored
        // collision/visual mesh prims inside instance hierarchies are absent
        // from the JS-side path index.
        for (const UsdPrim& prim : _stage->Traverse()) {
            appendPrimPath(prim);
        }

        // Include instance-proxy paths so JS can resolve prims like:
        // /<robot>/<link>/collisions/<name>/mesh
        const Usd_PrimFlagsPredicate proxyPredicate = UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
        for (const UsdPrim& prim : UsdPrimRange::Stage(_stage, proxyPredicate)) {
            appendPrimPath(prim);
        }
        return primPaths;
    }

    emscripten::val GetRootLayerText() {
        emscripten::val result = emscripten::val::null();
        if (!_stage) return result;
        const SdfLayerHandle rootLayer = _stage->GetRootLayer();
        if (!rootLayer) return result;
        std::string text;
        if (rootLayer->ExportToString(&text) && !text.empty()) {
            result = emscripten::val(text);
        }
        return result;
    }

    emscripten::val GetPhysicsJointRecords() {
        emscripten::val records = emscripten::val::array();
        if (!_stage) return records;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        int recordIndex = 0;
        const Usd_PrimFlagsPredicate predicate = UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);

        for (const UsdPrim& prim : UsdPrimRange::Stage(_stage, predicate)) {
            if (!prim) continue;

            const std::string primTypeName = prim.GetTypeName().GetString();
            const std::string normalizedTypeName = _ToLowerAscii(primTypeName);
            if (normalizedTypeName.find("joint") == std::string::npos) continue;

            emscripten::val record = emscripten::val::object();
            const std::string primPath = prim.GetPath().GetString();
            record.set("path", primPath);
            record.set("jointPath", primPath);
            record.set("jointName", prim.GetName().GetString());
            record.set("jointTypeName", primTypeName);
            record.set("jointType", primTypeName);
            record.set("body0Path", _ReadFirstRelationshipTargetPath(prim.GetRelationship(TfToken("physics:body0"))));
            record.set("body1Path", _ReadFirstRelationshipTargetPath(prim.GetRelationship(TfToken("physics:body1"))));
            record.set("axisToken", _ReadAxisToken(prim, timeCode));

            std::array<double, 3> localPos0 = {0.0, 0.0, 0.0};
            if (_TryReadVec3Attr(prim.GetAttribute(TfToken("physics:localPos0")), timeCode, &localPos0)) {
                record.set("localPos0", _Vec3ToJsArray(localPos0));
            }

            std::array<double, 3> localPos1 = {0.0, 0.0, 0.0};
            if (_TryReadVec3Attr(prim.GetAttribute(TfToken("physics:localPos1")), timeCode, &localPos1)) {
                record.set("localPos1", _Vec3ToJsArray(localPos1));
            }

            std::array<double, 4> localRot0Wxyz = {1.0, 0.0, 0.0, 0.0};
            if (_TryReadQuatWxyzAttr(prim.GetAttribute(TfToken("physics:localRot0")), timeCode, &localRot0Wxyz)) {
                record.set("localRot0Wxyz", _Vec4ToJsArray(localRot0Wxyz));
            }

            std::array<double, 4> localRot1Wxyz = {1.0, 0.0, 0.0, 0.0};
            if (_TryReadQuatWxyzAttr(prim.GetAttribute(TfToken("physics:localRot1")), timeCode, &localRot1Wxyz)) {
                record.set("localRot1Wxyz", _Vec4ToJsArray(localRot1Wxyz));
            }

            double lowerLimit = 0.0;
            if (_TryReadDoubleAttr(prim, "physics:lowerLimit", timeCode, &lowerLimit)) {
                record.set("lowerLimitDeg", lowerLimit);
            }

            double upperLimit = 0.0;
            if (_TryReadDoubleAttr(prim, "physics:upperLimit", timeCode, &upperLimit)) {
                record.set("upperLimitDeg", upperLimit);
            }

            records.set(recordIndex++, record);
        }

        return records;
    }

    emscripten::val GetPhysicsLinkDynamicsRecords() {
        emscripten::val records = emscripten::val::array();
        if (!_stage) return records;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        const UsdPrim defaultPrim = _stage->GetDefaultPrim();
        const std::string defaultPrimPath = defaultPrim ? defaultPrim.GetPath().GetString() : std::string();
        const std::string defaultPrimPrefix = defaultPrimPath.empty()
            ? std::string()
            : (defaultPrimPath + "/");
        int recordIndex = 0;

        for (const UsdPrim& prim : _stage->Traverse()) {
            if (!prim) continue;

            if (!defaultPrimPrefix.empty()) {
                const std::string primPath = prim.GetPath().GetString();
                if (primPath != defaultPrimPath && primPath.rfind(defaultPrimPrefix, 0) != 0) {
                    continue;
                }
            }

            const std::string primPath = prim.GetPath().GetString();
            if (primPath.empty()) continue;
            if (primPath.find("/visuals") != std::string::npos) continue;
            if (primPath.find("/collisions") != std::string::npos) continue;
            if (primPath.find("/Looks") != std::string::npos) continue;
            if (primPath.find("/joints") != std::string::npos) continue;

            const std::string primTypeName = _ToLowerAscii(prim.GetTypeName().GetString());
            if (!primTypeName.empty() && primTypeName != "xform") {
                continue;
            }

            double mass = 0.0;
            const bool hasPhysicsMassApi = _PrimHasAppliedApiSchema(prim, "PhysicsMassAPI");
            const bool hasMass = _TryReadDoubleAttr(prim, "physics:mass", timeCode, &mass);

            std::array<double, 3> centerOfMassLocal = {0.0, 0.0, 0.0};
            const bool hasCenterOfMass = _TryReadVec3Attr(
                prim.GetAttribute(TfToken("physics:centerOfMass")),
                timeCode,
                &centerOfMassLocal);

            std::array<double, 3> diagonalInertia = {0.0, 0.0, 0.0};
            const bool hasDiagonalInertia = _TryReadVec3Attr(
                prim.GetAttribute(TfToken("physics:diagonalInertia")),
                timeCode,
                &diagonalInertia);

            std::array<double, 4> principalAxesLocalWxyz = {1.0, 0.0, 0.0, 0.0};
            const bool hasPrincipalAxes = _TryReadQuatWxyzAttr(
                prim.GetAttribute(TfToken("physics:principalAxes")),
                timeCode,
                &principalAxesLocalWxyz);

            if (!_HasMeaningfulPhysicsDynamics(
                    hasMass,
                    mass,
                    hasPhysicsMassApi,
                    hasCenterOfMass,
                    centerOfMassLocal,
                    hasDiagonalInertia,
                    diagonalInertia,
                    hasPrincipalAxes,
                    principalAxesLocalWxyz)) {
                continue;
            }

            emscripten::val record = emscripten::val::object();
            record.set("linkPath", primPath);
            record.set("mass", hasMass ? emscripten::val(mass) : emscripten::val::null());
            record.set("centerOfMassLocal", hasCenterOfMass
                ? _Vec3ToJsArray(centerOfMassLocal)
                : _Vec3ToJsArray(std::array<double, 3>{0.0, 0.0, 0.0}));
            record.set("diagonalInertia", hasDiagonalInertia
                ? _Vec3ToJsArray(diagonalInertia)
                : (hasPhysicsMassApi
                    ? _Vec3ToJsArray(std::array<double, 3>{0.0, 0.0, 0.0})
                    : emscripten::val::null()));
            record.set("principalAxesLocalWxyz", hasPrincipalAxes
                ? _Vec4ToJsArray(principalAxesLocalWxyz)
                : _Vec4ToJsArray(std::array<double, 4>{1.0, 0.0, 0.0, 0.0}));
            records.set(recordIndex++, record);
        }

        return records;
    }

    // Build a lightweight robot metadata snapshot directly in WASM/C++.
    // This avoids heavy JS-side stage traversal/parsing on the main thread.
    emscripten::val GetRobotMetadataSnapshot(
        emscripten::val linkPaths,
        std::string const& stageSourcePath = std::string()) {
        return _BuildRobotMetadataSnapshotFromNormalizedLinkPaths(
            _NormalizeUniquePathsFromJsArray(linkPaths),
            stageSourcePath);
    }

    emscripten::val GetRobotSceneSnapshot(
        emscripten::val runtimeLinkPaths,
        std::string const& stageSourcePath = std::string()) {
        emscripten::val snapshot = emscripten::val::object();
        emscripten::val stageInfo = emscripten::val::object();
        emscripten::val robotTree = emscripten::val::object();
        emscripten::val physics = emscripten::val::object();
        emscripten::val render = emscripten::val::object();
        emscripten::val buffers = emscripten::val::object();
        emscripten::val emptyArray = emscripten::val::array();
        emscripten::val emptyObject = emscripten::val::object();
        RobotSceneSnapshotProfile snapshotProfile;
        const double snapshotStartedAtMs = _NowSteadyMs();
        const double inputDecodeStartedAtMs = snapshotStartedAtMs;
        const std::vector<std::string> requestedRuntimeLinkPaths =
            _NormalizeUniquePathsFromJsArray(runtimeLinkPaths);
        snapshotProfile.inputDecodeMs = _NowSteadyMs() - inputDecodeStartedAtMs;
        snapshotProfile.requestedRuntimeLinkPathCount =
            static_cast<int>(requestedRuntimeLinkPaths.size());

        snapshot.set("generatedAtMs", 0.0);
        snapshot.set("stage", stageInfo);
        snapshot.set("robotTree", robotTree);
        snapshot.set("physics", physics);
        snapshot.set("render", render);
        snapshot.set("buffers", buffers);
        snapshot.set("robotMetadataSnapshot", emptyObject);
        snapshot.set("driverInitProfile", _DriverInitProfileToJsVal(_lastInitProfile));
        snapshot.set("nativeProfile", emscripten::val::object());

        stageInfo.set("stageSourcePath", emscripten::val::null());
        stageInfo.set("rootLayerIdentifier", emscripten::val::null());
        stageInfo.set("defaultPrimPath", emscripten::val::null());
        stageInfo.set("upAxis", emscripten::val::null());
        stageInfo.set("startTimeCode", 0.0);
        stageInfo.set("endTimeCode", 0.0);
        stageInfo.set("timeCodesPerSecond", 0.0);
        stageInfo.set("framesPerSecond", 0.0);
        stageInfo.set("metersPerUnit", 0.0);

        robotTree.set("linkParentPairs", emptyArray);
        robotTree.set("jointCatalogEntries", emptyArray);
        robotTree.set("rootLinkPaths", emptyArray);

        physics.set("linkDynamicsEntries", emptyArray);

        render.set("primPathSet", emscripten::val::undefined());
        render.set("primTransforms", emptyObject);
        render.set("protoDataBlobs", emscripten::val::undefined());
        render.set("finalStageOverrideBatch", emscripten::val::undefined());
        render.set("meshDescriptorFormat", std::string("packed-v2"));
        render.set("meshDescriptorStrings", emptyArray);
        render.set("meshDescriptorHeaderStride", 30.0);
        render.set("meshDescriptorScalarStride", 6.0);
        render.set("meshDescriptorHeaders", emptyArray);
        render.set("meshDescriptorScalars", emptyArray);
        render.set("meshDescriptorGeomSubsetSections", emptyObject);
        render.set("meshDescriptorDiagnostics", emptyObject);
        render.set("meshDescriptors", emptyArray);
        render.set("materials", emptyArray);

        buffers.set("positions", emptyArray);
        buffers.set("indices", emptyArray);
        buffers.set("normals", emptyArray);
        buffers.set("uvs", emptyArray);
        buffers.set("transforms", emptyArray);
        buffers.set("rangesByMeshId", emscripten::val::undefined());

        if (!_stage) {
            snapshotProfile.totalMs = _NowSteadyMs() - snapshotStartedAtMs;
            _lastRobotSceneSnapshotProfile = snapshotProfile;
            snapshot.set(
                "nativeProfile",
                _RobotSceneSnapshotProfileToJsVal(snapshotProfile));
            return snapshot;
        }

        snapshot.set("generatedAtMs", _NowSteadyMs());

        const double stageInfoStartedAtMs = _NowSteadyMs();
        std::string normalizedStageSourcePath = TfStringTrim(stageSourcePath);
        const size_t queryMarker = normalizedStageSourcePath.find('?');
        if (queryMarker != std::string::npos) {
            normalizedStageSourcePath = normalizedStageSourcePath.substr(0, queryMarker);
        }

        const SdfLayerHandle rootLayer = _stage->GetRootLayer();
        const std::string rootLayerIdentifier = rootLayer ? rootLayer->GetIdentifier() : std::string();
        if (normalizedStageSourcePath.empty()) {
            normalizedStageSourcePath = rootLayerIdentifier;
        }
        const UsdPrim defaultPrim = _stage->GetDefaultPrim();
        const std::string defaultPrimPath = defaultPrim && defaultPrim.IsValid()
            ? defaultPrim.GetPath().GetString()
            : std::string();

        const TfToken upAxisToken = UsdGeomGetStageUpAxis(_stage);
        const double metersPerUnit = UsdGeomGetStageMetersPerUnit(_stage);

        stageInfo.set(
            "stageSourcePath",
            normalizedStageSourcePath.empty() ? emscripten::val::null() : emscripten::val(normalizedStageSourcePath));
        stageInfo.set(
            "rootLayerIdentifier",
            rootLayerIdentifier.empty() ? emscripten::val::null() : emscripten::val(rootLayerIdentifier));
        stageInfo.set(
            "defaultPrimPath",
            defaultPrimPath.empty() ? emscripten::val::null() : emscripten::val(defaultPrimPath));
        stageInfo.set(
            "upAxis",
            upAxisToken.IsEmpty() ? emscripten::val::null() : emscripten::val(upAxisToken.GetString()));
        stageInfo.set("startTimeCode", _stage->GetStartTimeCode());
        stageInfo.set("endTimeCode", _stage->GetEndTimeCode());
        stageInfo.set("timeCodesPerSecond", _stage->GetTimeCodesPerSecond());
        stageInfo.set("framesPerSecond", _stage->GetFramesPerSecond());
        stageInfo.set("metersPerUnit", metersPerUnit);
        snapshotProfile.stageInfoMs = _NowSteadyMs() - stageInfoStartedAtMs;

        auto makeFloat32ArrayCopy = [](std::vector<float> const& values) {
            emscripten::val ctor = emscripten::val::global("Float32Array");
            if (values.empty()) {
                return ctor.new_(0);
            }
            return ctor.new_(emscripten::val(emscripten::typed_memory_view(values.size(), values.data())));
        };
        auto makeUint32ArrayCopy = [](std::vector<uint32_t> const& values) {
            emscripten::val ctor = emscripten::val::global("Uint32Array");
            if (values.empty()) {
                return ctor.new_(0);
            }
            return ctor.new_(emscripten::val(emscripten::typed_memory_view(values.size(), values.data())));
        };
        auto makeInt32ArrayCopy = [](std::vector<int32_t> const& values) {
            emscripten::val ctor = emscripten::val::global("Int32Array");
            if (values.empty()) {
                return ctor.new_(0);
            }
            return ctor.new_(emscripten::val(emscripten::typed_memory_view(values.size(), values.data())));
        };
        std::vector<std::string> meshDescriptorStrings;
        std::unordered_map<std::string, int32_t> meshDescriptorStringToIndex;
        std::vector<int32_t> meshDescriptorHeaders;
        std::vector<float> meshDescriptorScalars;
        emscripten::val meshDescriptorGeomSubsetSections = emscripten::val::object();
        emscripten::val meshDescriptorDiagnostics = emscripten::val::object();
        std::vector<float> positionPool;
        std::vector<uint32_t> indexPool;
        std::vector<float> normalPool;
        std::vector<float> uvPool;
        std::vector<float> transformPool;
        std::unordered_set<std::string> snapshotRuntimeLinkPathSet;
        std::vector<std::string> snapshotRuntimeLinkPaths;
        std::unordered_set<std::string> directStageResolvedPrimPaths;
        std::unordered_set<std::string> directStageMeshIds;
        int directStageVisualDescriptorCount = 0;
        std::unordered_set<std::string> snapshotTransformPathSet;
        std::vector<std::string> snapshotTransformPaths;
        constexpr int kMeshDescriptorHeaderStride = 30;
        constexpr int kMeshDescriptorScalarStride = 6;

        auto appendSnapshotTransformPath = [&](std::string const& rawPath) {
            const std::string normalizedPath = _NormalizeRuntimePathToken(rawPath);
            if (normalizedPath.empty() || normalizedPath == "/") return;
            if (!snapshotTransformPathSet.insert(normalizedPath).second) return;
            snapshotTransformPaths.push_back(normalizedPath);
        };
        appendSnapshotTransformPath(defaultPrimPath);

        auto appendPackedStringIndex = [&](std::string const& rawValue) {
            const std::string value = TfStringTrim(rawValue);
            if (value.empty()) {
                return static_cast<int32_t>(-1);
            }
            auto it = meshDescriptorStringToIndex.find(value);
            if (it != meshDescriptorStringToIndex.end()) {
                return it->second;
            }
            const int32_t index = static_cast<int32_t>(meshDescriptorStrings.size());
            meshDescriptorStrings.push_back(value);
            meshDescriptorStringToIndex.emplace(value, index);
            return index;
        };
        auto appendPackedRangeTriplet = [&](std::vector<int32_t>* headerValues,
                                            std::pair<size_t, size_t> const& range,
                                            int stride) {
            headerValues->push_back(range.second > 0 ? static_cast<int32_t>(range.first) : static_cast<int32_t>(-1));
            headerValues->push_back(static_cast<int32_t>(range.second));
            headerValues->push_back(range.second > 0 ? std::max(1, stride) : 0);
        };
        auto appendFloatVectorComponents = [&](std::vector<float>& destination,
                                               std::vector<float> const& source,
                                               size_t expectedCount) {
            const size_t offset = destination.size();
            if (source.empty() || expectedCount == 0) {
                return std::make_pair(offset, static_cast<size_t>(0));
            }
            const size_t copyCount = std::min(expectedCount, source.size());
            destination.insert(destination.end(), source.begin(), source.begin() + copyCount);
            return std::make_pair(offset, copyCount);
        };
        auto appendUintVectorComponents = [&](std::vector<uint32_t>& destination,
                                              std::vector<uint32_t> const& source,
                                              size_t expectedCount) {
            const size_t offset = destination.size();
            if (source.empty() || expectedCount == 0) {
                return std::make_pair(offset, static_cast<size_t>(0));
            }
            const size_t copyCount = std::min(expectedCount, source.size());
            destination.insert(destination.end(), source.begin(), source.begin() + copyCount);
            return std::make_pair(offset, copyCount);
        };
        auto appendMatrixComponents = [&](std::vector<float>& destination, GfMatrix4d const& matrix) {
            const size_t offset = destination.size();
            for (int row = 0; row < 4; ++row) {
                for (int column = 0; column < 4; ++column) {
                    destination.push_back(static_cast<float>(matrix[row][column]));
                }
            }
            return std::make_pair(offset, static_cast<size_t>(16));
        };
        auto appendPackedDescriptorFromSnapshotOverride =
            [&](std::string const& meshId,
                std::string const& sectionName,
                bool applyGeometry,
                uint32_t sectionDirtyMask,
                SnapshotPrimOverrideData const& rawEntry) {
            if (meshId.empty()) return;
            appendSnapshotTransformPath(meshId);
            appendSnapshotTransformPath(rawEntry.resolvedPrimPath);

            const bool valid = rawEntry.valid;
            const int32_t dirtyMask = static_cast<int32_t>(rawEntry.dirtyMask | sectionDirtyMask);
            const int32_t meshIdIndex = appendPackedStringIndex(meshId);
            const int32_t sectionNameIndex = appendPackedStringIndex(sectionName);
            const int32_t resolvedPrimPathIndex = appendPackedStringIndex(rawEntry.resolvedPrimPath);
            const int32_t primTypeIndex = appendPackedStringIndex(rawEntry.primType);
            const int32_t axisIndex = appendPackedStringIndex(rawEntry.axis);
            const float sizeValue = rawEntry.hasSize
                ? static_cast<float>(rawEntry.size)
                : static_cast<float>(NAN);
            const float radiusValue = rawEntry.hasRadius
                ? static_cast<float>(rawEntry.radius)
                : static_cast<float>(NAN);
            const float heightValue = rawEntry.hasHeight
                ? static_cast<float>(rawEntry.height)
                : static_cast<float>(NAN);
            const std::array<float, 3> extentSizeValue = {
                rawEntry.hasExtentSize ? static_cast<float>(rawEntry.extentSize[0]) : static_cast<float>(NAN),
                rawEntry.hasExtentSize ? static_cast<float>(rawEntry.extentSize[1]) : static_cast<float>(NAN),
                rawEntry.hasExtentSize ? static_cast<float>(rawEntry.extentSize[2]) : static_cast<float>(NAN),
            };

            int numVertices = 0;
            int numIndices = 0;
            int numNormals = 0;
            int normalsDimension = 0;
            int numUVs = 0;
            int uvDimension = 0;
            int32_t materialIdIndex = -1;

            std::pair<size_t, size_t> positionRange = {0, 0};
            std::pair<size_t, size_t> indexRange = {0, 0};
            std::pair<size_t, size_t> normalRange = {0, 0};
            std::pair<size_t, size_t> uvRange = {0, 0};

            if (rawEntry.hasMeshPayload) {
                WebRenderDelegate::ProtoDataBlobRecord const& meshPayload = rawEntry.meshPayload;
                numVertices = std::max(0, meshPayload.numVertices);
                numIndices = std::max(0, meshPayload.numIndices);
                numNormals = std::max(0, meshPayload.numNormals);
                normalsDimension = std::max(1, meshPayload.normalsDimension > 0 ? meshPayload.normalsDimension : 3);
                numUVs = std::max(0, meshPayload.numUVs);
                uvDimension = std::max(1, meshPayload.uvDimension > 0 ? meshPayload.uvDimension : 2);

                positionRange = appendFloatVectorComponents(
                    positionPool,
                    meshPayload.points,
                    numVertices > 0 ? static_cast<size_t>(numVertices * 3) : 0);
                indexRange = appendUintVectorComponents(
                    indexPool,
                    meshPayload.indices,
                    static_cast<size_t>(numIndices));
                normalRange = appendFloatVectorComponents(
                    normalPool,
                    meshPayload.normals,
                    numNormals > 0 ? static_cast<size_t>(numNormals * normalsDimension) : 0);
                uvRange = appendFloatVectorComponents(
                    uvPool,
                    meshPayload.uv,
                    numUVs > 0 ? static_cast<size_t>(numUVs * uvDimension) : 0);
                materialIdIndex = appendPackedStringIndex(meshPayload.materialId);
                if (numUVs > 0) {
                    snapshotProfile.meshUvPayloadCount += 1;
                } else if (meshPayload.uvSource == "skippedColorOnly") {
                    snapshotProfile.skippedUvPayloadMeshCount += 1;
                }
                if (!meshPayload.geomSubsetSections.empty()) {
                    meshDescriptorGeomSubsetSections.set(
                        meshId,
                        _GeomSubsetSectionsToJsArray(meshPayload.geomSubsetSections));
                }
                meshDescriptorDiagnostics.set(
                    meshId,
                    _NormalDiagnosticsToJsVal(meshPayload));
            }
            if (materialIdIndex < 0) {
                materialIdIndex = appendPackedStringIndex(rawEntry.materialId);
            }

            const auto transformRange = appendMatrixComponents(transformPool, rawEntry.worldTransform);

            meshDescriptorHeaders.push_back(meshIdIndex);
            meshDescriptorHeaders.push_back(sectionNameIndex);
            meshDescriptorHeaders.push_back(resolvedPrimPathIndex);
            meshDescriptorHeaders.push_back(primTypeIndex);
            meshDescriptorHeaders.push_back(axisIndex);
            meshDescriptorHeaders.push_back(materialIdIndex);
            meshDescriptorHeaders.push_back(valid ? 1 : 0);
            meshDescriptorHeaders.push_back(applyGeometry ? 1 : 0);
            meshDescriptorHeaders.push_back(dirtyMask);
            appendPackedRangeTriplet(&meshDescriptorHeaders, positionRange, 3);
            appendPackedRangeTriplet(&meshDescriptorHeaders, indexRange, 1);
            appendPackedRangeTriplet(&meshDescriptorHeaders, normalRange, normalsDimension > 0 ? normalsDimension : 3);
            appendPackedRangeTriplet(&meshDescriptorHeaders, uvRange, uvDimension > 0 ? uvDimension : 2);
            appendPackedRangeTriplet(&meshDescriptorHeaders, transformRange, 16);
            meshDescriptorHeaders.push_back(numVertices);
            meshDescriptorHeaders.push_back(numIndices);
            meshDescriptorHeaders.push_back(numNormals);
            meshDescriptorHeaders.push_back(numUVs);
            meshDescriptorHeaders.push_back(uvDimension);
            meshDescriptorHeaders.push_back(normalsDimension);

            meshDescriptorScalars.push_back(sizeValue);
            meshDescriptorScalars.push_back(radiusValue);
            meshDescriptorScalars.push_back(heightValue);
            meshDescriptorScalars.push_back(extentSizeValue[0]);
            meshDescriptorScalars.push_back(extentSizeValue[1]);
            meshDescriptorScalars.push_back(extentSizeValue[2]);
        };

        double liveRprimScanMs = 0.0;
        int liveRprimPathCount = 0;
        int liveMeshDescriptorCount = 0;
        auto appendLiveRprimSnapshotDescriptors = [&]() {
            const double liveRprimScanStartedAtMs = _NowSteadyMs();
            const int descriptorCountBefore = static_cast<int>(
                meshDescriptorHeaders.size() / kMeshDescriptorHeaderStride);
            try {
                const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
                UsdGeomXformCache xformCache(timeCode);
                const std::vector<std::string> acceptableTypes = {
                    "mesh", "cube", "sphere", "cylinder", "capsule", "points", "basiscurves"};
                _EnsureProtoCandidateMapsPrimed(acceptableTypes);

                _renderDelegate.ReadAllLiveRprimPaths(
                    [&](std::string const& rprimPath) {
                        ++liveRprimPathCount;
                        if (rprimPath.find(".proto_") == std::string::npos) return;
                        const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(rprimPath);
                        if (!proto.valid) return;
                        if (proto.sectionName != "collisions" && proto.sectionName != "visuals") return;
                        if (!proto.linkPath.empty() && snapshotRuntimeLinkPathSet.insert(proto.linkPath).second) {
                            snapshotRuntimeLinkPaths.push_back(proto.linkPath);
                            appendSnapshotTransformPath(proto.linkPath);
                        }

                        WebRenderDelegate::ProtoDataBlobRecord reusableMeshPayload;
                        const bool hasReusableMeshPayload = _renderDelegate.ReadProtoDataBlob(
                            rprimPath,
                            [&](WebRenderDelegate::ProtoDataBlobRecord const& record) {
                                reusableMeshPayload = record;
                            });
                        WebRenderDelegate::ProtoDataBlobRecord const* reusableMeshPayloadPtr =
                            hasReusableMeshPayload ? &reusableMeshPayload : nullptr;

                        SnapshotPrimOverrideData overrideData;
                        bool valid = false;
                        bool applyGeometry = false;
                        uint32_t sectionDirtyMask = 0;
                        if (proto.sectionName == "collisions") {
                            valid = _BuildCollisionSnapshotOverride(
                                rprimPath,
                                timeCode,
                                &xformCache,
                                &overrideData,
                                &_collisionCandidateMapCache,
                                reusableMeshPayloadPtr);
                            applyGeometry = true;
                            sectionDirtyMask = (
                                kFinalStageDirtySectionCollision
                                | kFinalStageDirtyApplyGeometry);
                        } else {
                            valid = _BuildVisualSnapshotOverride(
                                rprimPath,
                                timeCode,
                                &xformCache,
                                &overrideData,
                                &_visualCandidateMapCache,
                                reusableMeshPayloadPtr);
                            applyGeometry = false;
                            sectionDirtyMask = kFinalStageDirtySectionVisual;
                        }

                        if (!valid || !overrideData.valid) return;

                        appendPackedDescriptorFromSnapshotOverride(
                            rprimPath,
                            proto.sectionName,
                            applyGeometry,
                            sectionDirtyMask,
                            overrideData);
                    });
            } catch (...) {
            }
            const int descriptorCountAfter = static_cast<int>(
                meshDescriptorHeaders.size() / kMeshDescriptorHeaderStride);
            liveMeshDescriptorCount += std::max(0, descriptorCountAfter - descriptorCountBefore);
            liveRprimScanMs += _NowSteadyMs() - liveRprimScanStartedAtMs;
        };

        if (!_preferDirectStageRobotSceneSnapshot) {
            appendLiveRprimSnapshotDescriptors();
        }

        const double directStagePrimScanStartedAtMs = _NowSteadyMs();
        if (meshDescriptorHeaders.empty()) {
            try {
                const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
                UsdGeomXformCache xformCache(timeCode);
                const std::vector<std::string> acceptableTypes = {
                    "mesh", "cube", "sphere", "cylinder", "capsule", "points", "basiscurves"};
                _EnsureProtoCandidateMapsPrimed(acceptableTypes);

                auto makeProtoTypeForPrimType = [](std::string const& primType) {
                    const std::string normalized = _ToLowerAscii(primType);
                    if (normalized == "cube") return std::string("box");
                    if (normalized == "sphere"
                        || normalized == "cylinder"
                        || normalized == "capsule"
                        || normalized == "mesh") {
                        return normalized;
                    }
                    return std::string("mesh");
                };
                auto appendDirectSnapshotCandidates =
                    [&](ProtoCandidateMap const& candidateMap,
                        std::string const& sectionName,
                        bool applyGeometry,
                        uint32_t sectionDirtyMask) {
                    std::vector<std::string> containerPaths;
                    containerPaths.reserve(candidateMap.size());
                    for (auto const& item : candidateMap) {
                        if (!item.first.empty()) {
                            containerPaths.push_back(item.first);
                        }
                    }
                    std::sort(containerPaths.begin(), containerPaths.end());

                    for (std::string const& containerPath : containerPaths) {
                        const auto found = candidateMap.find(containerPath);
                        if (found == candidateMap.end()) continue;
                        const std::string linkPath = _GetParentPath(containerPath);
                        if (!linkPath.empty()) {
                            if (snapshotRuntimeLinkPathSet.insert(linkPath).second) {
                                snapshotRuntimeLinkPaths.push_back(linkPath);
                            }
                            appendSnapshotTransformPath(linkPath);
                        }
                        appendSnapshotTransformPath(containerPath);

                        std::unordered_map<std::string, int> nextFallbackIndexByProtoType;
                        std::unordered_set<std::string> emittedMeshIds;
                        for (PrimCandidate const& candidate : found->second) {
                            const UsdPrim prim = candidate.second;
                            std::string primPath = candidate.first;
                            if (!prim) continue;
                            if (primPath.empty()) {
                                primPath = prim.GetPath().GetString();
                            }
                            if (primPath.empty()) continue;

                            // A directory named "visuals" is only a convention, not
                            // stronger than composed USD visibility. Scene exporters
                            // may keep collision geometry below such a directory while
                            // hiding its parent. Leave those prims for the generic pass,
                            // which can classify CollisionAPI geometry and expose it
                            // only when no portable visible geometry exists.
                            if (sectionName == "visuals") {
                                const UsdGeomImageable imageable(prim);
                                if (imageable
                                    && imageable.ComputeVisibility(timeCode)
                                        == UsdGeomTokens->invisible) {
                                    continue;
                                }
                            }

                            const std::string primType = _GetSupportedPrimTypeName(prim);
                            if (primType.empty()) continue;
                            const std::string protoType = makeProtoTypeForPrimType(primType);
                            int fallbackIndex = nextFallbackIndexByProtoType[protoType];
                            const int inferredIndex = _InferProtoIndexFromCandidatePrimPath(
                                containerPath,
                                primPath,
                                protoType,
                                fallbackIndex);
                            int protoIndex = inferredIndex >= 0 ? inferredIndex : fallbackIndex;
                            if (protoIndex < 0) protoIndex = 0;

                            std::string meshId;
                            for (;;) {
                                meshId = containerPath
                                    + std::string(".proto_")
                                    + protoType
                                    + std::string("_id")
                                    + std::to_string(protoIndex);
                                if (emittedMeshIds.insert(meshId).second) break;
                                ++protoIndex;
                            }
                            nextFallbackIndexByProtoType[protoType] =
                                std::max(nextFallbackIndexByProtoType[protoType], protoIndex + 1);
                            directStageMeshIds.insert(meshId);

                            SnapshotPrimOverrideData overrideData;
                            if (!_BuildSnapshotPrimOverrideDataFromPrim(
                                    prim,
                                    primPath,
                                    timeCode,
                                    &xformCache,
                                    &overrideData)) {
                                continue;
                            }

                            directStageResolvedPrimPaths.insert(primPath);
                            appendPackedDescriptorFromSnapshotOverride(
                                meshId,
                                sectionName,
                                applyGeometry,
                                sectionDirtyMask,
                                overrideData);
                            if (sectionName == "visuals") {
                                directStageVisualDescriptorCount += 1;
                            }
                            snapshotProfile.directStagePrimPathCount += 1;
                        }
                    }
                };

                appendDirectSnapshotCandidates(
                    _visualCandidateMapCache,
                    "visuals",
                    false,
                    kFinalStageDirtySectionVisual);
                appendDirectSnapshotCandidates(
                    _collisionCandidateMapCache,
                    "collisions",
                    true,
                    kFinalStageDirtySectionCollision | kFinalStageDirtyApplyGeometry);

                // Robot exports commonly place renderable prims below /visuals or
                // /collisions, but ordinary USD scenes do not. Traverse the composed
                // stage as a general fallback so standard imageable geometry is not
                // silently dropped by the fast robot-snapshot path.
                std::vector<std::pair<std::string, UsdPrim>> genericScenePrims;
                const Usd_PrimFlagsPredicate predicate =
                    UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
                for (UsdPrim const& prim : UsdPrimRange::Stage(_stage, predicate)) {
                    if (!prim) continue;
                    const std::string primType = _GetSupportedPrimTypeName(prim);
                    if (primType.empty() || !_ContainsString(acceptableTypes, primType)) continue;
                    const std::string primPath = prim.GetPath().GetString();
                    if (primPath.empty() || directStageResolvedPrimPaths.count(primPath) > 0) continue;
                    genericScenePrims.push_back({primPath, prim});
                }
                std::sort(
                    genericScenePrims.begin(),
                    genericScenePrims.end(),
                    [](auto const& left, auto const& right) {
                        return left.first < right.first;
                    });

                bool hasGenericVisualCandidate = false;
                for (auto const& candidate : genericScenePrims) {
                    const std::string& primPath = candidate.first;
                    const UsdPrim prim = candidate.second;
                    const bool collisionPath =
                        primPath.find("/collisions/") != std::string::npos;
                    const UsdGeomImageable imageable(prim);
                    const bool visible =
                        !imageable
                        || imageable.ComputeVisibility(timeCode) != UsdGeomTokens->invisible;
                    if (visible && !collisionPath) {
                        hasGenericVisualCandidate = true;
                        break;
                    }
                }
                // Some vendor scenes render a proprietary Volume while keeping a
                // standard collision mesh hidden as the only portable geometry.
                // If this runtime cannot find any supported visual candidate,
                // publish that collision geometry through the visual channel as
                // a compatibility fallback instead of returning a blank scene.
                const bool promoteCollisionFallbackToVisual =
                    directStageVisualDescriptorCount == 0
                    && !hasGenericVisualCandidate;

                std::unordered_map<std::string, int> nextGenericIndexByContainerAndType;
                auto appendGenericDescriptor =
                    [&](std::string const& linkPath,
                        std::string const& sectionName,
                        bool applyGeometry,
                        uint32_t sectionDirtyMask,
                        SnapshotPrimOverrideData const& overrideData) {
                    const std::string protoType =
                        makeProtoTypeForPrimType(overrideData.primType);
                    const std::string syntheticContainerPath =
                        linkPath + std::string("/") + sectionName;
                    const std::string genericIndexKey =
                        syntheticContainerPath + std::string("|") + protoType;
                    int protoIndex = nextGenericIndexByContainerAndType[genericIndexKey];
                    std::string meshId;
                    for (;;) {
                        meshId = syntheticContainerPath
                            + std::string(".proto_")
                            + protoType
                            + std::string("_id")
                            + std::to_string(protoIndex);
                        if (directStageMeshIds.insert(meshId).second) {
                            break;
                        }
                        ++protoIndex;
                    }
                    nextGenericIndexByContainerAndType[genericIndexKey] = protoIndex + 1;

                    appendPackedDescriptorFromSnapshotOverride(
                        meshId,
                        sectionName,
                        applyGeometry,
                        sectionDirtyMask,
                        overrideData);
                    if (sectionName == "visuals") {
                        directStageVisualDescriptorCount += 1;
                    }
                };
                for (auto const& candidate : genericScenePrims) {
                    const std::string& primPath = candidate.first;
                    const UsdPrim prim = candidate.second;
                    const bool collisionPath =
                        primPath.find("/collisions/") != std::string::npos;
                    const bool collisionEnabled = _PrimHasEnabledCollision(prim, timeCode);
                    const UsdGeomImageable imageable(prim);
                    const bool visible =
                        !imageable
                        || imageable.ComputeVisibility(timeCode) != UsdGeomTokens->invisible;
                    if (!visible && !collisionEnabled && !collisionPath) {
                        continue;
                    }

                    const bool collisionSemantic =
                        collisionPath || (!visible && collisionEnabled);
                    const bool useCollisionSection =
                        collisionSemantic && !promoteCollisionFallbackToVisual;
                    std::string linkPath = defaultPrimPath;
                    if (linkPath.empty()) {
                        linkPath = _GetParentPath(primPath);
                    }
                    if (!linkPath.empty()) {
                        if (snapshotRuntimeLinkPathSet.insert(linkPath).second) {
                            snapshotRuntimeLinkPaths.push_back(linkPath);
                        }
                        appendSnapshotTransformPath(linkPath);
                    }
                    if (linkPath.empty()) {
                        continue;
                    }

                    SnapshotPrimOverrideData overrideData;
                    if (!_BuildSnapshotPrimOverrideDataFromPrim(
                            prim,
                            primPath,
                            timeCode,
                            &xformCache,
                            &overrideData)) {
                        continue;
                    }

                    if (promoteCollisionFallbackToVisual && collisionSemantic) {
                        // Keep the compatibility visual publication, and also expose
                        // the collision role so collision toggles and inspectors can
                        // observe the same vendor-authored geometry.
                        appendGenericDescriptor(
                            linkPath,
                            "visuals",
                            false,
                            kFinalStageDirtySectionVisual,
                            overrideData);
                        appendGenericDescriptor(
                            linkPath,
                            "collisions",
                            true,
                            kFinalStageDirtySectionCollision | kFinalStageDirtyApplyGeometry,
                            overrideData);
                    } else {
                        const std::string sectionName =
                            useCollisionSection ? "collisions" : "visuals";
                        appendGenericDescriptor(
                            linkPath,
                            sectionName,
                            useCollisionSection,
                            useCollisionSection
                                ? (kFinalStageDirtySectionCollision | kFinalStageDirtyApplyGeometry)
                                : kFinalStageDirtySectionVisual,
                            overrideData);
                    }
                    directStageResolvedPrimPaths.insert(primPath);
                    snapshotProfile.directStagePrimPathCount += 1;
                }
            } catch (...) {
            }
        }
        snapshotProfile.directStagePrimScanMs = _NowSteadyMs() - directStagePrimScanStartedAtMs;
        if (meshDescriptorHeaders.empty() && _preferDirectStageRobotSceneSnapshot) {
            appendLiveRprimSnapshotDescriptors();
        }
        snapshotProfile.liveRprimScanMs = liveRprimScanMs;
        snapshotProfile.liveRprimPathCount = liveRprimPathCount;
        snapshotProfile.liveMeshDescriptorCount = liveMeshDescriptorCount;
        snapshotProfile.directMeshDescriptorCount = std::max(
            0,
            static_cast<int>(meshDescriptorHeaders.size() / kMeshDescriptorHeaderStride)
                - snapshotProfile.liveMeshDescriptorCount);

        std::sort(snapshotRuntimeLinkPaths.begin(), snapshotRuntimeLinkPaths.end());
        std::vector<std::string> metadataLinkPaths = snapshotRuntimeLinkPaths.empty()
            ? requestedRuntimeLinkPaths
            : snapshotRuntimeLinkPaths;
        snapshotProfile.resolvedRuntimeLinkPathCount =
            static_cast<int>(metadataLinkPaths.size());
        snapshotProfile.meshDescriptorCount = static_cast<int>(
            meshDescriptorHeaders.size() / kMeshDescriptorHeaderStride);
        snapshot.set(
            "snapshotSource",
            snapshotProfile.meshDescriptorCount <= 0
                ? std::string("empty")
                : (snapshotProfile.liveMeshDescriptorCount > 0
                    ? std::string("hydra-live-rprim")
                    : std::string("usd-stage-direct")));
        const double metadataStartedAtMs = _NowSteadyMs();
        std::vector<std::pair<std::string, std::string>> metadataLinkParentPairs;
        emscripten::val robotMetadataSnapshot =
            _BuildRobotMetadataSnapshotFromNormalizedLinkPaths(
                metadataLinkPaths,
                normalizedStageSourcePath,
                &metadataLinkParentPairs);
        snapshotProfile.metadataMs = _NowSteadyMs() - metadataStartedAtMs;
        snapshot.set("robotMetadataSnapshot", robotMetadataSnapshot);
        for (std::string const& linkPath : metadataLinkPaths) {
            appendSnapshotTransformPath(linkPath);
        }
        for (std::pair<std::string, std::string> const& pair : metadataLinkParentPairs) {
            appendSnapshotTransformPath(pair.first);
            appendSnapshotTransformPath(pair.second);
        }
        try {
            robotTree.set("linkParentPairs", robotMetadataSnapshot["linkParentPairs"]);
            robotTree.set("jointCatalogEntries", robotMetadataSnapshot["jointCatalogEntries"]);
            physics.set("linkDynamicsEntries", robotMetadataSnapshot["linkDynamicsEntries"]);
        } catch (...) {
        }

        std::sort(snapshotTransformPaths.begin(), snapshotTransformPaths.end());
        snapshotProfile.resolvedTransformPathCount =
            static_cast<int>(snapshotTransformPaths.size());
        const double primTransformsStartedAtMs = _NowSteadyMs();
        const emscripten::val primTransformSnapshot =
            _BuildPrimTransformsForNormalizedPaths(snapshotTransformPaths);
        snapshotProfile.primTransformsMs =
            _NowSteadyMs() - primTransformsStartedAtMs;
        render.set("primTransforms", primTransformSnapshot);
        try {
            render.set("primPathSet", primTransformSnapshot["paths"]);
        } catch (...) {
            render.set("primPathSet", _StringVectorToJsArray(snapshotTransformPaths));
        }

        const double materialRecordsStartedAtMs = _NowSteadyMs();
        emscripten::val snapshotMaterials =
            _BuildSnapshotMaterialRecords(UsdTimeCode::Default());
        snapshotProfile.materialRecordsMs =
            _NowSteadyMs() - materialRecordsStartedAtMs;
        try {
            snapshotProfile.materialCount = snapshotMaterials["length"].as<int>();
        } catch (...) {
            snapshotProfile.materialCount = 0;
        }

        const double marshalStartedAtMs = _NowSteadyMs();
        render.set("meshDescriptorFormat", std::string("packed-v2"));
        render.set("meshDescriptorStrings", _StringVectorToJsArray(meshDescriptorStrings));
        render.set("meshDescriptorHeaderStride", static_cast<double>(kMeshDescriptorHeaderStride));
        render.set("meshDescriptorScalarStride", static_cast<double>(kMeshDescriptorScalarStride));
        render.set("meshDescriptorHeaders", makeInt32ArrayCopy(meshDescriptorHeaders));
        render.set("meshDescriptorScalars", makeFloat32ArrayCopy(meshDescriptorScalars));
        render.set("meshDescriptorGeomSubsetSections", meshDescriptorGeomSubsetSections);
        render.set("meshDescriptorDiagnostics", meshDescriptorDiagnostics);
        render.set("meshDescriptors", emscripten::val::array());
        render.set("materials", snapshotMaterials);
        buffers.set("positions", makeFloat32ArrayCopy(positionPool));
        buffers.set("indices", makeUint32ArrayCopy(indexPool));
        buffers.set("normals", makeFloat32ArrayCopy(normalPool));
        buffers.set("uvs", makeFloat32ArrayCopy(uvPool));
        buffers.set("transforms", makeFloat32ArrayCopy(transformPool));
        buffers.set("rangesByMeshId", emscripten::val::undefined());
        snapshotProfile.marshalMs = _NowSteadyMs() - marshalStartedAtMs;
        snapshotProfile.totalMs = _NowSteadyMs() - snapshotStartedAtMs;
        _lastRobotSceneSnapshotProfile = snapshotProfile;
        snapshot.set(
            "nativeProfile",
            _RobotSceneSnapshotProfileToJsVal(snapshotProfile));

        return snapshot;
    }

    emscripten::val GetRobotSceneSnapshotBlob(
        emscripten::val runtimeLinkPaths,
        std::string const& stageSourcePath = std::string()) {
        emscripten::val payload = emscripten::val::object();
        payload.set("format", std::string("robot-scene-snapshot-blob-v1"));
        payload.set("transport", std::string("packed-object-v1"));
        payload.set("snapshot", GetRobotSceneSnapshot(runtimeLinkPaths, stageSourcePath));
        payload.set("driverInitProfile", _DriverInitProfileToJsVal(_lastInitProfile));
        payload.set(
            "nativeProfile",
            _RobotSceneSnapshotProfileToJsVal(_lastRobotSceneSnapshotProfile));
        return payload;
    }

    emscripten::val GetFullLoadPayload(
        emscripten::val runtimeLinkPaths,
        std::string const& stageSourcePath = std::string(),
        emscripten::val options = emscripten::val::object()) {
        emscripten::val payload =
            GetRobotSceneSnapshotBlob(runtimeLinkPaths, stageSourcePath);
        payload.set("format", std::string("usd-full-load-payload-v1"));
        payload.set("version", 1.0);
        payload.set("transport", std::string("packed-object-v1"));
        if (options.isUndefined() || options.isNull()) {
            payload.set("options", emscripten::val::object());
        } else {
            payload.set("options", options);
        }
        return payload;
    }

    emscripten::val ExportLoadedStageSnapshot(emscripten::val options = emscripten::val::object()) {
        emscripten::val result = emscripten::val::object();
        result.set("ok", false);
        result.set("flattened", false);
        result.set("content", emscripten::val::null());
        result.set("stageSourcePath", emscripten::val::null());
        result.set("rootLayerIdentifier", emscripten::val::null());
        result.set("defaultPrimPath", emscripten::val::null());
        result.set("outputFileName", emscripten::val::null());
        result.set("exportMode", emscripten::val::null());
        if (!_stage) return result;

        bool flattenStage = false;
        std::string requestedStageSourcePath;
        try {
            flattenStage = options["flattenStage"].as<bool>();
        } catch (...) {
            flattenStage = false;
        }
        try {
            requestedStageSourcePath = TfStringTrim(options["stageSourcePath"].as<std::string>());
        } catch (...) {
            requestedStageSourcePath.clear();
        }

        const SdfLayerHandle rootLayer = _stage->GetRootLayer();
        const std::string rootLayerIdentifier = rootLayer ? rootLayer->GetIdentifier() : std::string();
        std::string resolvedStageSourcePath = requestedStageSourcePath.empty()
            ? rootLayerIdentifier
            : requestedStageSourcePath;
        const size_t queryMarker = resolvedStageSourcePath.find('?');
        if (queryMarker != std::string::npos) {
            resolvedStageSourcePath = resolvedStageSourcePath.substr(0, queryMarker);
        }

        const UsdPrim defaultPrim = _stage->GetDefaultPrim();
        const std::string defaultPrimPath = defaultPrim && defaultPrim.IsValid()
            ? defaultPrim.GetPath().GetString()
            : std::string();

        std::string exportedText;
        bool exported = false;
        if (flattenStage) {
            exported = _stage->ExportToString(&exportedText, false);
        } else if (rootLayer) {
            exported = rootLayer->ExportToString(&exportedText);
        }
        if (!exported || exportedText.empty()) {
            return result;
        }

        auto getPathStem = [](std::string const& filePath) -> std::string {
            if (filePath.empty()) return std::string("stage");
            const size_t slashIndex = filePath.find_last_of('/');
            const std::string fileName = slashIndex == std::string::npos
                ? filePath
                : filePath.substr(slashIndex + 1);
            const size_t dotIndex = fileName.find_last_of('.');
            if (dotIndex == std::string::npos || dotIndex == 0) return fileName.empty() ? std::string("stage") : fileName;
            return fileName.substr(0, dotIndex);
        };
        auto getPathExtension = [](std::string const& filePath) -> std::string {
            if (filePath.empty()) return std::string(".usd");
            const size_t slashIndex = filePath.find_last_of('/');
            const size_t dotIndex = filePath.find_last_of('.');
            if (dotIndex == std::string::npos || (slashIndex != std::string::npos && dotIndex < slashIndex)) {
                return std::string(".usd");
            }
            return filePath.substr(dotIndex);
        };

        const std::string outputFileName = getPathStem(resolvedStageSourcePath)
            + std::string(".viewer_roundtrip")
            + getPathExtension(resolvedStageSourcePath);

        result.set("ok", true);
        result.set("flattened", flattenStage);
        result.set("content", exportedText);
        result.set(
            "stageSourcePath",
            resolvedStageSourcePath.empty() ? emscripten::val::null() : emscripten::val(resolvedStageSourcePath));
        result.set(
            "rootLayerIdentifier",
            rootLayerIdentifier.empty() ? emscripten::val::null() : emscripten::val(rootLayerIdentifier));
        result.set(
            "defaultPrimPath",
            defaultPrimPath.empty() ? emscripten::val::null() : emscripten::val(defaultPrimPath));
        result.set("outputFileName", outputFileName);
        result.set("exportMode", flattenStage ? "flattened-stage" : "root-layer");
        return result;
    }

    emscripten::val GetProtoDataBlob(std::string const& protoPath) {
        emscripten::val result = emscripten::val::object();
        result.set("valid", false);
        if (protoPath.empty() || protoPath[0] != '/') return result;

        bool found = _renderDelegate.ReadProtoDataBlob(
            protoPath,
            [&](WebRenderDelegate::ProtoDataBlobRecord const& record) {
                result = _ProtoDataBlobRecordToJsVal(record);
            });
        if (!found) return result;
        return result;
    }

    emscripten::val GetAllProtoDataBlobs() {
        emscripten::val blobs = emscripten::val::object();
        _renderDelegate.ReadAllProtoDataBlobs(
            [&](std::string const& rprimPath, WebRenderDelegate::ProtoDataBlobRecord const& record) {
                if (rprimPath.empty()) return;
                blobs.set(rprimPath, _ProtoDataBlobRecordToJsVal(record));
            });
        return blobs;
    }

    emscripten::val GetCollisionProtoOverride(std::string const& meshId) {
        emscripten::val result = emscripten::val::object();
        result.set("valid", false);
        if (!_stage || meshId.empty()) return result;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        return _BuildCollisionProtoOverride(meshId, timeCode, &xformCache);
    }

    emscripten::val GetCollisionProtoOverrides() {
        emscripten::val overrides = emscripten::val::object();
        if (!_stage) return overrides;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        const std::vector<std::string> acceptableTypes = {"mesh", "cube", "sphere", "cylinder", "capsule"};
        _EnsureProtoCandidateMapsPrimed(acceptableTypes);
        _renderDelegate.ReadAllProtoDataBlobs(
            [&](std::string const& rprimPath, WebRenderDelegate::ProtoDataBlobRecord const&) {
                if (rprimPath.find(".proto_") == std::string::npos) return;
                const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(rprimPath);
                if (!proto.valid || proto.sectionName != "collisions") return;
                overrides.set(rprimPath, _BuildCollisionProtoOverride(rprimPath, timeCode, &xformCache, &_collisionCandidateMapCache));
            });
        return overrides;
    }

    emscripten::val GetVisualProtoOverride(std::string const& meshId) {
        emscripten::val result = emscripten::val::object();
        result.set("valid", false);
        if (!_stage || meshId.empty()) return result;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        return _BuildVisualProtoOverride(meshId, timeCode, &xformCache);
    }

    emscripten::val GetVisualProtoOverrides() {
        emscripten::val overrides = emscripten::val::object();
        if (!_stage) return overrides;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        const std::vector<std::string> acceptableTypes = {"mesh", "cube", "sphere", "cylinder", "capsule"};
        _EnsureProtoCandidateMapsPrimed(acceptableTypes);
        _renderDelegate.ReadAllProtoDataBlobs(
            [&](std::string const& rprimPath, WebRenderDelegate::ProtoDataBlobRecord const&) {
                if (rprimPath.find(".proto_") == std::string::npos) return;
                const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(rprimPath);
                if (!proto.valid || proto.sectionName != "visuals") return;
                overrides.set(rprimPath, _BuildVisualProtoOverride(rprimPath, timeCode, &xformCache, &_visualCandidateMapCache));
            });
        return overrides;
    }

    // One-shot proto override payload for both collision and visual proto meshes.
    // This avoids multiple large JS<->WASM bridge calls and duplicate stage scans.
    emscripten::val GetProtoMeshOverrides() {
        emscripten::val bundle = emscripten::val::object();
        emscripten::val collisionOverrides = emscripten::val::object();
        emscripten::val visualOverrides = emscripten::val::object();
        bundle.set("collision", collisionOverrides);
        bundle.set("visual", visualOverrides);
        bundle.set("collisionCount", 0.0);
        bundle.set("visualCount", 0.0);
        if (!_stage) return bundle;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        const std::vector<std::string> acceptableTypes = {"mesh", "cube", "sphere", "cylinder", "capsule"};
        _EnsureProtoCandidateMapsPrimed(acceptableTypes);

        size_t collisionCount = 0;
        size_t visualCount = 0;
        _renderDelegate.ReadAllProtoDataBlobs(
            [&](std::string const& rprimPath, WebRenderDelegate::ProtoDataBlobRecord const&) {
                if (rprimPath.find(".proto_") == std::string::npos) return;
                const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(rprimPath);
                if (!proto.valid) return;

                if (proto.sectionName == "collisions") {
                    emscripten::val overrideData = _BuildCollisionProtoOverride(
                        rprimPath,
                        timeCode,
                        &xformCache,
                        &_collisionCandidateMapCache);
                    bool valid = false;
                    try {
                        valid = overrideData["valid"].as<bool>();
                    } catch (...) {
                        valid = false;
                    }
                    if (!valid) return;
                    collisionOverrides.set(rprimPath, overrideData);
                    ++collisionCount;
                    return;
                }

                if (proto.sectionName == "visuals") {
                    emscripten::val overrideData = _BuildVisualProtoOverride(
                        rprimPath,
                        timeCode,
                        &xformCache,
                        &_visualCandidateMapCache);
                    bool valid = false;
                    try {
                        valid = overrideData["valid"].as<bool>();
                    } catch (...) {
                        valid = false;
                    }
                    if (!valid) return;
                    visualOverrides.set(rprimPath, overrideData);
                    ++visualCount;
                }
            });

        bundle.set("collisionCount", static_cast<double>(collisionCount));
        bundle.set("visualCount", static_cast<double>(visualCount));
        return bundle;
    }

    // Pull and clear the per-frame dirty RPrim delta batch prepared by WebRenderDelegate::Sync.
    emscripten::val GetRprimDeltaBatch() {
        return _renderDelegate.TakeRprimDeltaBatch();
    }

    // One-shot final stage override batch for all proto meshes.
    // Each entry includes final geometry descriptor + world matrix + dirty mask.
    emscripten::val GetFinalStageOverrideBatch() {
        emscripten::val bundle = emscripten::val::object();
        emscripten::val entries = emscripten::val::object();
        bundle.set("entries", entries);
        bundle.set("count", 0.0);
        bundle.set("collisionCount", 0.0);
        bundle.set("visualCount", 0.0);
        bundle.set("protoMeshCount", 0.0);
        if (!_stage) return bundle;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        const std::vector<std::string> acceptableTypes = {"mesh", "cube", "sphere", "cylinder", "capsule"};
        _EnsureProtoCandidateMapsPrimed(acceptableTypes);

        size_t totalCount = 0;
        size_t collisionCount = 0;
        size_t visualCount = 0;
        size_t protoMeshCount = 0;
        _renderDelegate.ReadAllLiveRprimPaths(
            [&](std::string const& rprimPath) {
                if (rprimPath.find(".proto_") == std::string::npos) return;
                const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(rprimPath);
                if (!proto.valid) return;
                if (proto.sectionName != "collisions" && proto.sectionName != "visuals") return;
                ++protoMeshCount;

                emscripten::val overrideData = emscripten::val::object();
                if (proto.sectionName == "collisions") {
                    overrideData = _BuildCollisionProtoOverride(
                        rprimPath,
                        timeCode,
                        &xformCache,
                        &_collisionCandidateMapCache);
                } else if (proto.sectionName == "visuals") {
                    overrideData = _BuildVisualProtoOverride(
                        rprimPath,
                        timeCode,
                        &xformCache,
                        &_visualCandidateMapCache);
                } else {
                    return;
                }

                bool valid = false;
                try {
                    valid = overrideData["valid"].as<bool>();
                } catch (...) {
                    valid = false;
                }
                if (!valid) return;

                uint32_t dirtyMask = 0;
                try {
                    dirtyMask = static_cast<uint32_t>(overrideData["dirtyMask"].as<double>());
                } catch (...) {
                    dirtyMask = 0;
                }

                if (proto.sectionName == "collisions") {
                    dirtyMask |= kFinalStageDirtySectionCollision;
                    dirtyMask |= kFinalStageDirtyApplyGeometry;
                    overrideData.set("applyGeometry", true);
                    ++collisionCount;
                } else {
                    dirtyMask |= kFinalStageDirtySectionVisual;
                    overrideData.set("applyGeometry", false);
                    ++visualCount;
                }

                overrideData.set("sectionName", proto.sectionName);
                overrideData.set("dirtyMask", static_cast<double>(dirtyMask));
                entries.set(rprimPath, overrideData);
                ++totalCount;
            });

        bundle.set("count", static_cast<double>(totalCount));
        bundle.set("collisionCount", static_cast<double>(collisionCount));
        bundle.set("visualCount", static_cast<double>(visualCount));
        bundle.set("protoMeshCount", static_cast<double>(protoMeshCount));
        return bundle;
    }

    emscripten::val GetPrimOverrideData(std::string const& primPath) {
        emscripten::val result = emscripten::val::object();
        result.set("valid", false);
        if (!_stage || primPath.empty() || primPath[0] != '/') return result;

        const SdfPath sdfPath(primPath);
        if (sdfPath.IsEmpty()) return result;
        const UsdPrim prim = _stage->GetPrimAtPath(sdfPath);
        if (!prim) return result;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        return _BuildPrimOverrideDataFromPrim(prim, primPath, timeCode, &xformCache);
    }

    emscripten::val GetPrimOverrideDataMap(emscripten::val primPaths) {
        emscripten::val result = emscripten::val::object();
        if (!_stage || primPaths.isUndefined() || primPaths.isNull()) return result;

        int length = 0;
        try {
            length = primPaths["length"].as<int>();
        } catch (...) {
            return result;
        }
        if (length <= 0) return result;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        std::unordered_set<std::string> visited;
        visited.reserve(static_cast<size_t>(length));

        for (int index = 0; index < length; ++index) {
            std::string primPath;
            try {
                primPath = primPaths[index].as<std::string>();
            } catch (...) {
                continue;
            }
            if (primPath.empty() || primPath[0] != '/') continue;
            if (!visited.insert(primPath).second) continue;

            const SdfPath sdfPath(primPath);
            if (sdfPath.IsEmpty()) continue;
            const UsdPrim prim = _stage->GetPrimAtPath(sdfPath);
            if (!prim) continue;

            emscripten::val overrideData = _BuildPrimOverrideDataFromPrim(prim, primPath, timeCode, &xformCache);
            bool isValid = false;
            try {
                isValid = overrideData["valid"].as<bool>();
            } catch (...) {
                isValid = false;
            }
            if (!isValid) continue;
            result.set(primPath, overrideData);
        }

        return result;
    }

private:
    HdEngine _engine;
    WebRenderDelegate _renderDelegate;
    HdRenderIndex       *_renderIndex;
    UsdImagingDelegate  *_delegate;
    HdRenderPassSharedPtr _geometryPass;
    UsdStageRefPtr _stage;
    TfTokenVector _renderTags;

    struct ProtoMeshIdentifier {
        bool valid = false;
        std::string meshId;
        std::string containerPath;
        std::string linkPath;
        std::string linkName;
        std::string sectionName;
        std::string protoType;
        int protoIndex = -1;
    };

    struct SnapshotPrimOverrideData {
        bool valid = false;
        std::string resolvedPrimPath;
        std::string primType;
        std::string materialId;
        GfMatrix4d worldTransform = GfMatrix4d(1.0);
        uint32_t dirtyMask = 0;
        bool hasExtentSize = false;
        std::array<double, 3> extentSize = {0.0, 0.0, 0.0};
        bool hasSize = false;
        double size = 0.0;
        bool hasRadius = false;
        double radius = 0.0;
        bool hasHeight = false;
        double height = 0.0;
        std::string axis;
        bool hasMeshPayload = false;
        WebRenderDelegate::ProtoDataBlobRecord meshPayload;
    };

    using PrimCandidate = std::pair<std::string, UsdPrim>;
    using ProtoCandidateMap = std::unordered_map<std::string, std::vector<PrimCandidate>>;
    using CollisionCandidateMap = ProtoCandidateMap;
    using VisualCandidateMap = ProtoCandidateMap;

    mutable bool _protoCandidateMapsPrimed = false;
    mutable CollisionCandidateMap _collisionCandidateMapCache;
    mutable VisualCandidateMap _visualCandidateMapCache;
    mutable std::unordered_map<std::string, ProtoMeshIdentifier> _protoMeshIdentifierCache;
    mutable std::mutex _primOverrideMeshPayloadMutex;
    mutable std::unordered_map<std::string, WebRenderDelegate::ProtoDataBlobRecord> _primOverrideMeshPayloadCache;
    mutable std::unordered_map<std::string, bool> _materialTextureUsageCache;
    bool _preferDirectStageRobotSceneSnapshot = false;
    double _lastStageOpenMs = 0.0;

    struct DriverInitProfile {
        double totalMs = 0.0;
        double stageOpenMs = 0.0;
        double renderIndexCreateMs = 0.0;
        double delegateCreateMs = 0.0;
        double stageAssignMs = 0.0;
        double clearProtoCacheMs = 0.0;
        double skinningDetectMs = 0.0;
        double bakeSkinningMs = 0.0;
        double stageSaveMs = 0.0;
        double populateMs = 0.0;
        double geometryPassMs = 0.0;
        double renderTagsMs = 0.0;
        bool stageSaveSkipped = false;
        bool bakeSkinningSkipped = false;
        bool stageHasSkinning = false;
        bool hydraPopulateSkipped = false;
    };

    struct RobotSceneSnapshotProfile {
        double totalMs = 0.0;
        double inputDecodeMs = 0.0;
        double stageInfoMs = 0.0;
        double liveRprimScanMs = 0.0;
        double directStagePrimScanMs = 0.0;
        double metadataMs = 0.0;
        double primTransformsMs = 0.0;
        double materialRecordsMs = 0.0;
        double marshalMs = 0.0;
        int requestedRuntimeLinkPathCount = 0;
        int resolvedRuntimeLinkPathCount = 0;
        int resolvedTransformPathCount = 0;
        int meshDescriptorCount = 0;
        int liveRprimPathCount = 0;
        int liveMeshDescriptorCount = 0;
        int directStagePrimPathCount = 0;
        int directMeshDescriptorCount = 0;
        int materialCount = 0;
        int meshUvPayloadCount = 0;
        int skippedUvPayloadMeshCount = 0;
    };

    DriverInitProfile _lastInitProfile;
    RobotSceneSnapshotProfile _lastRobotSceneSnapshotProfile;

    static constexpr uint32_t kFinalStageDirtyGeometryDescriptor = 1u << 0;
    static constexpr uint32_t kFinalStageDirtyWorldTransform = 1u << 1;
    static constexpr uint32_t kFinalStageDirtyResolvedPrimPath = 1u << 2;
    static constexpr uint32_t kFinalStageDirtyExtent = 1u << 3;
    static constexpr uint32_t kFinalStageDirtyPrimitiveParams = 1u << 4;
    static constexpr uint32_t kFinalStageDirtySectionCollision = 1u << 8;
    static constexpr uint32_t kFinalStageDirtySectionVisual = 1u << 9;
    static constexpr uint32_t kFinalStageDirtyApplyGeometry = 1u << 10;

    ProtoMeshIdentifier _GetCachedProtoMeshIdentifier(std::string const& meshId) const {
        if (meshId.empty()) return ProtoMeshIdentifier();
        const auto found = _protoMeshIdentifierCache.find(meshId);
        if (found != _protoMeshIdentifierCache.end()) {
            return found->second;
        }
        const ProtoMeshIdentifier parsed = _ParseProtoMeshIdentifier(meshId);
        _protoMeshIdentifierCache.emplace(meshId, parsed);
        return parsed;
    }

    std::string _TryDeriveRuntimeLinkPathFromRprimPath(std::string const& rprimPath) const {
        const std::string normalizedRprimPath = _NormalizeRuntimePathToken(rprimPath);
        if (normalizedRprimPath.empty()) return std::string();

        const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(normalizedRprimPath);
        if (proto.valid && !proto.linkPath.empty()) {
            return proto.linkPath;
        }

        const std::string lowered = _ToLowerAscii(normalizedRprimPath);
        static const std::array<std::string, 4> kSectionMarkers = {
            "/visuals",
            "/visual",
            "/collisions",
            "/collision",
        };
        for (std::string const& marker : kSectionMarkers) {
            size_t markerPos = lowered.find(marker);
            while (markerPos != std::string::npos) {
                const size_t afterMarker = markerPos + marker.size();
                if (afterMarker >= lowered.size()
                    || lowered[afterMarker] == '/'
                    || lowered[afterMarker] == '.') {
                    return _NormalizeRuntimePathToken(normalizedRprimPath.substr(0, markerPos));
                }
                markerPos = lowered.find(marker, markerPos + 1);
            }
        }

        return std::string();
    }

    std::vector<std::string> _CollectRuntimeLinkPathsFromLiveRprims() const {
        std::vector<std::string> runtimeLinkPaths;
        std::unordered_set<std::string> runtimeLinkPathSet;
        try {
            _renderDelegate.ReadAllLiveRprimPaths(
                [&](std::string const& rprimPath) {
                    const std::string linkPath = _TryDeriveRuntimeLinkPathFromRprimPath(rprimPath);
                    if (linkPath.empty()) return;
                    if (!runtimeLinkPathSet.insert(linkPath).second) return;
                    runtimeLinkPaths.push_back(linkPath);
                });
        } catch (...) {
        }
        std::sort(runtimeLinkPaths.begin(), runtimeLinkPaths.end());
        return runtimeLinkPaths;
    }

    static double _NowSteadyMs() {
        const auto now = std::chrono::steady_clock::now().time_since_epoch();
        return std::chrono::duration<double, std::milli>(now).count();
    }

    static emscripten::val _DriverInitProfileToJsVal(
        DriverInitProfile const& profile) {
        emscripten::val result = emscripten::val::object();
        result.set("totalMs", profile.totalMs);
        result.set("stageOpenMs", profile.stageOpenMs);
        result.set("totalWithStageOpenMs", profile.totalMs + profile.stageOpenMs);
        result.set("renderIndexCreateMs", profile.renderIndexCreateMs);
        result.set("delegateCreateMs", profile.delegateCreateMs);
        result.set("stageAssignMs", profile.stageAssignMs);
        result.set("clearProtoCacheMs", profile.clearProtoCacheMs);
        result.set("skinningDetectMs", profile.skinningDetectMs);
        result.set("bakeSkinningMs", profile.bakeSkinningMs);
        result.set("stageSaveMs", profile.stageSaveMs);
        result.set("populateMs", profile.populateMs);
        result.set("geometryPassMs", profile.geometryPassMs);
        result.set("renderTagsMs", profile.renderTagsMs);
        result.set("stageSaveSkipped", profile.stageSaveSkipped);
        result.set("bakeSkinningSkipped", profile.bakeSkinningSkipped);
        result.set("stageHasSkinning", profile.stageHasSkinning);
        result.set("hydraPopulateSkipped", profile.hydraPopulateSkipped);
        return result;
    }

    static emscripten::val _RobotSceneSnapshotProfileToJsVal(
        RobotSceneSnapshotProfile const& profile) {
        emscripten::val result = emscripten::val::object();
        result.set("totalMs", profile.totalMs);
        result.set("inputDecodeMs", profile.inputDecodeMs);
        result.set("stageInfoMs", profile.stageInfoMs);
        result.set("liveRprimScanMs", profile.liveRprimScanMs);
        result.set("directStagePrimScanMs", profile.directStagePrimScanMs);
        result.set("metadataMs", profile.metadataMs);
        result.set("primTransformsMs", profile.primTransformsMs);
        result.set("materialRecordsMs", profile.materialRecordsMs);
        result.set("marshalMs", profile.marshalMs);
        result.set(
            "requestedRuntimeLinkPathCount",
            static_cast<double>(profile.requestedRuntimeLinkPathCount));
        result.set(
            "resolvedRuntimeLinkPathCount",
            static_cast<double>(profile.resolvedRuntimeLinkPathCount));
        result.set(
            "resolvedTransformPathCount",
            static_cast<double>(profile.resolvedTransformPathCount));
        result.set(
            "meshDescriptorCount",
            static_cast<double>(profile.meshDescriptorCount));
        result.set(
            "liveRprimPathCount",
            static_cast<double>(profile.liveRprimPathCount));
        result.set(
            "liveMeshDescriptorCount",
            static_cast<double>(profile.liveMeshDescriptorCount));
        result.set(
            "directStagePrimPathCount",
            static_cast<double>(profile.directStagePrimPathCount));
        result.set(
            "directMeshDescriptorCount",
            static_cast<double>(profile.directMeshDescriptorCount));
        result.set(
            "materialCount",
            static_cast<double>(profile.materialCount));
        result.set(
            "meshUvPayloadCount",
            static_cast<double>(profile.meshUvPayloadCount));
        result.set(
            "skippedUvPayloadMeshCount",
            static_cast<double>(profile.skippedUvPayloadMeshCount));
        return result;
    }

    static std::vector<std::string> _NormalizeUniquePathsFromJsArray(
        emscripten::val values) {
        std::unordered_set<std::string> pathSet;
        std::vector<std::string> normalizedPaths;

        int valueCount = 0;
        try {
            valueCount = values["length"].as<int>();
        } catch (...) {
            valueCount = 0;
        }
        if (valueCount <= 0) {
            return normalizedPaths;
        }

        pathSet.reserve(static_cast<size_t>(valueCount));
        normalizedPaths.reserve(static_cast<size_t>(valueCount));
        for (int index = 0; index < valueCount; ++index) {
            std::string rawValue;
            try {
                rawValue = values[index].as<std::string>();
            } catch (...) {
                continue;
            }
            const std::string normalizedPath =
                _NormalizeRuntimePathToken(rawValue);
            if (normalizedPath.empty() || normalizedPath == "/") continue;
            if (!pathSet.insert(normalizedPath).second) continue;
            normalizedPaths.push_back(normalizedPath);
        }
        return normalizedPaths;
    }

    emscripten::val _BuildPrimTransformsForNormalizedPaths(
        std::vector<std::string> const& requestedPaths) {
        emscripten::val result = emscripten::val::object();
        result.set("format", std::string("packed-v1"));
        result.set("paths", emscripten::val::array());
        result.set("world", _FloatVectorToJsFloat32Array({}));
        result.set("local", _FloatVectorToJsFloat32Array({}));
        result.set("stride", 16.0);
        result.set("count", 0.0);

        if (!_stage || requestedPaths.empty()) {
            return result;
        }

        std::vector<std::string> orderedPaths;
        orderedPaths.reserve(requestedPaths.size() * 4);
        std::unordered_set<std::string> orderedPathSet;
        orderedPathSet.reserve(requestedPaths.size() * 4);
        auto appendOrderedPath = [&](std::string const& rawPath) {
            const std::string normalizedPath =
                _NormalizeRuntimePathToken(rawPath);
            if (normalizedPath.empty() || normalizedPath == "/") return;
            if (!orderedPathSet.insert(normalizedPath).second) return;
            orderedPaths.push_back(normalizedPath);
        };
        for (std::string const& requestedPath : requestedPaths) {
            SdfPath currentPath(requestedPath);
            if (currentPath.IsEmpty()) continue;
            while (!currentPath.IsEmpty()
                   && currentPath != SdfPath::AbsoluteRootPath()) {
                appendOrderedPath(currentPath.GetString());
                currentPath = currentPath.GetParentPath();
            }
        }
        if (orderedPaths.empty()) {
            return result;
        }

        std::sort(
            orderedPaths.begin(),
            orderedPaths.end(),
            [](std::string const& left, std::string const& right) {
                const size_t leftDepth = static_cast<size_t>(
                    std::count(left.begin(), left.end(), '/'));
                const size_t rightDepth = static_cast<size_t>(
                    std::count(right.begin(), right.end(), '/'));
                if (leftDepth != rightDepth) {
                    return leftDepth < rightDepth;
                }
                return left < right;
            });

        const UsdTimeCode timeCode =
            _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        std::vector<std::string> validPrimPaths;
        std::vector<float> worldValues;
        std::vector<float> localValues;
        validPrimPaths.reserve(orderedPaths.size());
        worldValues.reserve(orderedPaths.size() * 16);
        localValues.reserve(orderedPaths.size() * 16);

        for (std::string const& primPath : orderedPaths) {
            const SdfPath sdfPath(primPath);
            if (sdfPath.IsEmpty()) continue;
            const UsdPrim prim = _stage->GetPrimAtPath(sdfPath);
            if (!prim) continue;

            GfMatrix4d localMatrix(1.0);
            bool resetsXformStack = false;
            const UsdGeomXformable xformable(prim);
            if (xformable) {
                xformable.GetLocalTransformation(
                    &localMatrix,
                    &resetsXformStack,
                    timeCode);
            }

            GfMatrix4d worldMatrix(1.0);
            try {
                worldMatrix = xformCache.GetLocalToWorldTransform(prim);
            } catch (...) {
                worldMatrix = localMatrix;
            }

            validPrimPaths.push_back(primPath);
            _AppendMatrix4dRowMajor(&localValues, localMatrix);
            _AppendMatrix4dRowMajor(&worldValues, worldMatrix);
        }

        result.set("paths", _StringVectorToJsArray(validPrimPaths));
        result.set("world", _FloatVectorToJsFloat32Array(worldValues));
        result.set("local", _FloatVectorToJsFloat32Array(localValues));
        result.set("count", static_cast<double>(validPrimPaths.size()));
        return result;
    }

    emscripten::val _BuildRobotMetadataSnapshotFromNormalizedLinkPaths(
        std::vector<std::string> const& normalizedLinkPaths,
        std::string const& stageSourcePath,
        std::vector<std::pair<std::string, std::string>>* outLinkParentPairsSorted = nullptr) {
        emscripten::val snapshot = emscripten::val::object();
        emscripten::val emptyPairs = emscripten::val::array();
        emscripten::val emptyJointEntries = emscripten::val::array();
        emscripten::val emptyDynamicsEntries = emscripten::val::array();
        snapshot.set("stageSourcePath", emscripten::val::null());
        snapshot.set("generatedAtMs", 0.0);
        snapshot.set("source", "mesh-only");
        snapshot.set("linkParentPairs", emptyPairs);
        snapshot.set("jointCatalogEntries", emptyJointEntries);
        snapshot.set("linkDynamicsEntries", emptyDynamicsEntries);
        if (!_stage) return snapshot;

        auto axisVectorFromToken = [](std::string const& axisToken) -> GfVec3d {
            const std::string token = _ToLowerAscii(axisToken);
            if (token == "y") return GfVec3d(0.0, 1.0, 0.0);
            if (token == "z") return GfVec3d(0.0, 0.0, 1.0);
            return GfVec3d(1.0, 0.0, 0.0);
        };

        auto rotateAxisByQuaternionWxyz =
            [&](std::string const& axisToken,
                std::array<double, 4> const& localRotWxyz)
                -> std::array<double, 3> {
            GfVec3d axis = axisVectorFromToken(axisToken);
            const double w = localRotWxyz[0];
            const double x = localRotWxyz[1];
            const double y = localRotWxyz[2];
            const double z = localRotWxyz[3];
            GfQuatd quat(w, GfVec3d(x, y, z));
            const double quatLen = quat.GetLength();
            if (std::isfinite(quatLen) && quatLen > 1e-6) {
                quat.Normalize();
                axis = quat.Transform(axis);
            }
            const double axisLen = axis.GetLength();
            if (!std::isfinite(axisLen) || axisLen <= 1e-12) {
                return {1.0, 0.0, 0.0};
            }
            axis /= axisLen;
            return {axis[0], axis[1], axis[2]};
        };

        std::string normalizedStageSourcePath = TfStringTrim(stageSourcePath);
        const size_t queryMarker = normalizedStageSourcePath.find('?');
        if (queryMarker != std::string::npos) {
            normalizedStageSourcePath =
                normalizedStageSourcePath.substr(0, queryMarker);
        }
        if (!normalizedStageSourcePath.empty()) {
            snapshot.set("stageSourcePath", normalizedStageSourcePath);
        }

        std::unordered_set<std::string> linkPathSet;
        std::vector<std::string> sortedLinkPaths = normalizedLinkPaths;
        linkPathSet.insert(sortedLinkPaths.begin(), sortedLinkPaths.end());
        if (sortedLinkPaths.empty()) {
            sortedLinkPaths = _CollectRuntimeLinkPathsFromLiveRprims();
            linkPathSet.insert(sortedLinkPaths.begin(), sortedLinkPaths.end());
        }

        const UsdPrim defaultPrim = _stage->GetDefaultPrim();
        const std::string defaultPrimPath =
            defaultPrim ? defaultPrim.GetPath().GetString() : std::string();
        const std::string defaultPrimPrefix =
            defaultPrimPath.empty() ? std::string() : (defaultPrimPath + "/");
        auto isWithinDefaultPrim = [&](std::string const& primPath) {
            return defaultPrimPath.empty()
                || primPath == defaultPrimPath
                || primPath.rfind(defaultPrimPrefix, 0) == 0;
        };
        auto addDiscoveredLinkPath = [&](std::string const& rawPath) {
            const std::string normalizedPath = _NormalizeRuntimePathToken(rawPath);
            if (normalizedPath.empty() || normalizedPath == "/") return;
            if (!isWithinDefaultPrim(normalizedPath)) return;
            linkPathSet.insert(normalizedPath);
        };

        const UsdTimeCode discoveryTimeCode =
            _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        const Usd_PrimFlagsPredicate discoveryPredicate =
            UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
        for (UsdPrim const& prim : UsdPrimRange::Stage(_stage, discoveryPredicate)) {
            if (!prim) continue;
            const std::string primTypeName = prim.GetTypeName().GetString();
            if (primTypeName == "PhysicsRevoluteJoint"
                || primTypeName == "PhysicsPrismaticJoint"
                || primTypeName == "PhysicsFixedJoint") {
                addDiscoveredLinkPath(
                    _ReadFirstRelationshipTargetPath(
                        prim.GetRelationship(TfToken("physics:body0"))));
                addDiscoveredLinkPath(
                    _ReadFirstRelationshipTargetPath(
                        prim.GetRelationship(TfToken("physics:body1"))));
                continue;
            }

            const std::string primPath = prim.GetPath().GetString();
            if (primPath.empty() || !isWithinDefaultPrim(primPath)) continue;
            if (primPath.find("/visuals") != std::string::npos) continue;
            if (primPath.find("/collisions") != std::string::npos) continue;
            if (primPath.find("/Looks") != std::string::npos) continue;
            if (primPath.find("/joints") != std::string::npos) continue;

            const std::string normalizedTypeName =
                _ToLowerAscii(prim.GetTypeName().GetString());
            if (!normalizedTypeName.empty() && normalizedTypeName != "xform") {
                continue;
            }

            double mass = 0.0;
            const bool hasPhysicsMassApi = _PrimHasAppliedApiSchema(prim, "PhysicsMassAPI");
            const bool hasMass =
                _TryReadDoubleAttr(prim, "physics:mass", discoveryTimeCode, &mass);
            std::array<double, 3> centerOfMassLocal = {0.0, 0.0, 0.0};
            const bool hasCenterOfMass = _TryReadVec3Attr(
                prim.GetAttribute(TfToken("physics:centerOfMass")),
                discoveryTimeCode,
                &centerOfMassLocal);
            std::array<double, 3> diagonalInertia = {0.0, 0.0, 0.0};
            const bool hasDiagonalInertia = _TryReadVec3Attr(
                prim.GetAttribute(TfToken("physics:diagonalInertia")),
                discoveryTimeCode,
                &diagonalInertia);
            std::array<double, 4> principalAxesLocalWxyz = {
                1.0, 0.0, 0.0, 0.0};
            const bool hasPrincipalAxes = _TryReadQuatWxyzAttr(
                prim.GetAttribute(TfToken("physics:principalAxes")),
                discoveryTimeCode,
                &principalAxesLocalWxyz);

            if (_HasMeaningfulPhysicsDynamics(
                    hasMass,
                    mass,
                    hasPhysicsMassApi,
                    hasCenterOfMass,
                    centerOfMassLocal,
                    hasDiagonalInertia,
                    diagonalInertia,
                    hasPrincipalAxes,
                    principalAxesLocalWxyz)) {
                addDiscoveredLinkPath(primPath);
            }
        }

        sortedLinkPaths.assign(linkPathSet.begin(), linkPathSet.end());
        std::sort(sortedLinkPaths.begin(), sortedLinkPaths.end());

        snapshot.set("generatedAtMs", _NowSteadyMs());
        if (sortedLinkPaths.empty()) {
            return snapshot;
        }

        std::unordered_map<std::string, std::vector<std::string>>
            runtimeLinkPathsByName;
        std::vector<std::string> rootPaths;
        std::unordered_set<std::string> rootPathSet;
        runtimeLinkPathsByName.reserve(sortedLinkPaths.size());
        rootPathSet.reserve(sortedLinkPaths.size());

        for (std::string const& linkPath : sortedLinkPaths) {
            const std::string linkName = _GetPathBasename(linkPath);
            if (!linkName.empty()) {
                runtimeLinkPathsByName[linkName].push_back(linkPath);
            }
            const std::string rootPath = _GetRootPathFromPrimPath(linkPath);
            if (!rootPath.empty() && rootPathSet.insert(rootPath).second) {
                rootPaths.push_back(rootPath);
            }
        }
        std::sort(rootPaths.begin(), rootPaths.end());
        for (auto& item : runtimeLinkPathsByName) {
            std::vector<std::string>& paths = item.second;
            std::sort(paths.begin(), paths.end());
            paths.erase(std::unique(paths.begin(), paths.end()), paths.end());
        }

        auto sortByPreferredRoot =
            [&](std::vector<std::string>* paths,
                std::string const& preferredRootPath) {
            if (!paths) return;
            std::sort(
                paths->begin(),
                paths->end(),
                [&](std::string const& left, std::string const& right) {
                    const int leftPreferred =
                        (!preferredRootPath.empty()
                         && _GetRootPathFromPrimPath(left) == preferredRootPath)
                        ? 0
                        : 1;
                    const int rightPreferred =
                        (!preferredRootPath.empty()
                         && _GetRootPathFromPrimPath(right) == preferredRootPath)
                        ? 0
                        : 1;
                    if (leftPreferred != rightPreferred) {
                        return leftPreferred < rightPreferred;
                    }
                    return left < right;
                });
        };

        auto resolveRuntimeLinkPathsFromSourcePath =
            [&](std::string const& sourcePath,
                std::string const& preferredRootPath)
                -> std::vector<std::string> {
            std::vector<std::string> matches;
            const std::string normalizedSourcePath =
                _NormalizeRuntimePathToken(sourcePath);
            if (normalizedSourcePath.empty()) return matches;

            auto addMatch = [&](std::string const& candidatePath) {
                if (candidatePath.empty()) return;
                if (linkPathSet.find(candidatePath) == linkPathSet.end()) return;
                if (std::find(matches.begin(), matches.end(), candidatePath)
                    != matches.end()) {
                    return;
                }
                matches.push_back(candidatePath);
            };

            addMatch(normalizedSourcePath);

            const std::string linkName = _GetPathBasename(normalizedSourcePath);
            if (!linkName.empty()) {
                const auto found = runtimeLinkPathsByName.find(linkName);
                if (found != runtimeLinkPathsByName.end()) {
                    for (std::string const& candidatePath : found->second) {
                        addMatch(candidatePath);
                    }
                }
            }

            const std::string sourceWithoutRoot =
                _GetPathWithoutRoot(normalizedSourcePath);
            if (!sourceWithoutRoot.empty() && sourceWithoutRoot != "/") {
                if (!preferredRootPath.empty()) {
                    addMatch(preferredRootPath + sourceWithoutRoot);
                }
                for (std::string const& rootPath : rootPaths) {
                    if (!preferredRootPath.empty()
                        && rootPath == preferredRootPath) {
                        continue;
                    }
                    addMatch(rootPath + sourceWithoutRoot);
                }
            }

            sortByPreferredRoot(&matches, preferredRootPath);
            return matches;
        };

        struct JointCatalogRecord {
            std::string jointPath;
            std::string jointName;
            std::string jointType;
            std::string parentLinkPath;
            std::string axisToken;
            std::array<double, 3> axisLocal = {1.0, 0.0, 0.0};
            std::array<double, 3> localPos0 = {0.0, 0.0, 0.0};
            bool hasLocalPos0 = false;
            std::array<double, 4> localRot0Wxyz = {1.0, 0.0, 0.0, 0.0};
            bool hasLocalRot0Wxyz = false;
            std::array<double, 3> localPivotInLink = {0.0, 0.0, 0.0};
            bool hasLocalPivotInLink = false;
            std::array<double, 4> localRot1Wxyz = {1.0, 0.0, 0.0, 0.0};
            bool hasLocalRot1Wxyz = false;
            double lowerLimitDeg = -180.0;
            double upperLimitDeg = 180.0;
        };

        std::unordered_map<std::string, JointCatalogRecord>
            stageJointRecordByChildLinkPath;
        std::unordered_map<std::string, std::string>
            linkParentPathByChildLinkPath;
        stageJointRecordByChildLinkPath.reserve(sortedLinkPaths.size());
        linkParentPathByChildLinkPath.reserve(sortedLinkPaths.size());

        const UsdTimeCode timeCode =
            _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        const Usd_PrimFlagsPredicate predicate =
            UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
        for (UsdPrim const& prim : UsdPrimRange::Stage(_stage, predicate)) {
            const std::string typeName = prim.GetTypeName().GetString();
            if (typeName != "PhysicsRevoluteJoint"
                && typeName != "PhysicsPrismaticJoint"
                && typeName != "PhysicsFixedJoint") {
                continue;
            }

            std::string body0;
            std::string body1;
            body0 = _NormalizeRuntimePathToken(
                _ReadFirstRelationshipTargetPath(
                    prim.GetRelationship(TfToken("physics:body0"))));
            body1 = _NormalizeRuntimePathToken(
                _ReadFirstRelationshipTargetPath(
                    prim.GetRelationship(TfToken("physics:body1"))));
            if (body1.empty()) continue;

            const std::string preferredRootPath = _GetRootPathFromPrimPath(body1);
            std::vector<std::string> childMatches =
                resolveRuntimeLinkPathsFromSourcePath(body1, preferredRootPath);
            if (childMatches.empty()) continue;
            std::vector<std::string> parentMatches =
                resolveRuntimeLinkPathsFromSourcePath(body0, preferredRootPath);

            std::string axisToken = "x";
            axisToken = _ReadAxisToken(prim, timeCode);
            std::array<double, 3> localPos0 = {0.0, 0.0, 0.0};
            const bool hasLocalPos0 =
                _TryReadVec3Attr(
                    prim.GetAttribute(TfToken("physics:localPos0")),
                    timeCode,
                    &localPos0);
            std::array<double, 4> localRot0Wxyz = {1.0, 0.0, 0.0, 0.0};
            const bool hasLocalRot0 =
                _TryReadQuatWxyzAttr(
                    prim.GetAttribute(TfToken("physics:localRot0")),
                    timeCode,
                    &localRot0Wxyz);
            std::array<double, 4> localRot1Wxyz = {1.0, 0.0, 0.0, 0.0};
            const bool hasLocalRot1 =
                _TryReadQuatWxyzAttr(
                    prim.GetAttribute(TfToken("physics:localRot1")),
                    timeCode,
                    &localRot1Wxyz);
            const std::array<double, 3> axisLocal =
                rotateAxisByQuaternionWxyz(axisToken, localRot1Wxyz);
            std::array<double, 3> localPos1 = {0.0, 0.0, 0.0};
            const bool hasLocalPivot =
                _TryReadVec3Attr(
                    prim.GetAttribute(TfToken("physics:localPos1")),
                    timeCode,
                    &localPos1);

            double lowerLimitDeg = -180.0;
            double upperLimitDeg = 180.0;
            const bool hasLowerLimit =
                _TryReadDoubleAttr(prim, "physics:lowerLimit", timeCode,
                                   &lowerLimitDeg);
            const bool hasUpperLimit =
                _TryReadDoubleAttr(prim, "physics:upperLimit", timeCode,
                                   &upperLimitDeg);
            if (!hasLowerLimit && !hasUpperLimit) {
                lowerLimitDeg = -180.0;
                upperLimitDeg = 180.0;
            } else {
                if (!hasLowerLimit) lowerLimitDeg = -180.0;
                if (!hasUpperLimit) upperLimitDeg = 180.0;
            }

            const std::string jointPath = prim.GetPath().GetString();
            const std::string jointName = prim.GetName().GetString();
            const std::string jointType = typeName == "PhysicsPrismaticJoint"
                ? std::string("prismatic")
                : (typeName == "PhysicsFixedJoint"
                    ? std::string("fixed")
                    : std::string("revolute"));

            for (std::string const& childLinkPath : childMatches) {
                JointCatalogRecord record;
                record.jointPath = jointPath;
                record.jointName = jointName;
                record.jointType = jointType;
                record.parentLinkPath =
                    parentMatches.empty() ? std::string() : parentMatches.front();
                record.axisToken = axisToken;
                record.axisLocal = axisLocal;
                record.localPos0 = localPos0;
                record.hasLocalPos0 = hasLocalPos0;
                record.localRot0Wxyz = localRot0Wxyz;
                record.hasLocalRot0Wxyz = hasLocalRot0;
                record.localPivotInLink = localPos1;
                record.hasLocalPivotInLink = hasLocalPivot;
                record.localRot1Wxyz = localRot1Wxyz;
                record.hasLocalRot1Wxyz = hasLocalRot1;
                record.lowerLimitDeg = lowerLimitDeg;
                record.upperLimitDeg = upperLimitDeg;
                stageJointRecordByChildLinkPath[childLinkPath] = record;
                linkParentPathByChildLinkPath[childLinkPath] =
                    record.parentLinkPath;
            }
        }

        emscripten::val jointCatalogEntries = emscripten::val::array();
        int jointCatalogIndex = 0;
        for (std::string const& childLinkPath : sortedLinkPaths) {
            const auto found = stageJointRecordByChildLinkPath.find(childLinkPath);
            if (found == stageJointRecordByChildLinkPath.end()) continue;
            JointCatalogRecord const& record = found->second;
            emscripten::val entry = emscripten::val::object();
            entry.set("jointPath", record.jointPath);
            entry.set("jointName", record.jointName);
            entry.set("jointType", record.jointType);
            entry.set("childLinkPath", childLinkPath);
            entry.set(
                "parentLinkPath",
                record.parentLinkPath.empty()
                    ? emscripten::val::null()
                    : emscripten::val(record.parentLinkPath));
            entry.set("axisToken", record.axisToken);
            entry.set("axisLocal", _Vec3ToJsArray(record.axisLocal));
            entry.set(
                "localPos0",
                record.hasLocalPos0
                    ? _Vec3ToJsArray(record.localPos0)
                    : emscripten::val::null());
            entry.set(
                "localRot0Wxyz",
                record.hasLocalRot0Wxyz
                    ? _Vec4ToJsArray(record.localRot0Wxyz)
                    : emscripten::val::null());
            entry.set(
                "localPivotInLink",
                record.hasLocalPivotInLink
                    ? _Vec3ToJsArray(record.localPivotInLink)
                    : emscripten::val::null());
            entry.set(
                "localPos1",
                record.hasLocalPivotInLink
                    ? _Vec3ToJsArray(record.localPivotInLink)
                    : emscripten::val::null());
            entry.set(
                "localRot1Wxyz",
                record.hasLocalRot1Wxyz
                    ? _Vec4ToJsArray(record.localRot1Wxyz)
                    : emscripten::val::null());
            entry.set("lowerLimitDeg", record.lowerLimitDeg);
            entry.set("upperLimitDeg", record.upperLimitDeg);
            jointCatalogEntries.set(jointCatalogIndex++, entry);
        }

        emscripten::val linkDynamicsEntries = emscripten::val::array();
        int dynamicsIndex = 0;
        for (std::string const& linkPath : sortedLinkPaths) {
            const SdfPath linkSdfPath(linkPath);
            if (linkSdfPath.IsEmpty()) continue;
            const UsdPrim linkPrim = _stage->GetPrimAtPath(linkSdfPath);
            if (!linkPrim) continue;

            double mass = 0.0;
            const bool hasPhysicsMassApi = _PrimHasAppliedApiSchema(linkPrim, "PhysicsMassAPI");
            const bool hasMass =
                _TryReadDoubleAttr(linkPrim, "physics:mass", timeCode, &mass);
            std::array<double, 3> centerOfMassLocal = {0.0, 0.0, 0.0};
            const bool hasCenterOfMass = _TryReadVec3Attr(
                linkPrim.GetAttribute(TfToken("physics:centerOfMass")),
                timeCode,
                &centerOfMassLocal);
            std::array<double, 3> diagonalInertia = {0.0, 0.0, 0.0};
            const bool hasDiagonalInertia = _TryReadVec3Attr(
                linkPrim.GetAttribute(TfToken("physics:diagonalInertia")),
                timeCode,
                &diagonalInertia);
            std::array<double, 4> principalAxesLocalWxyz = {
                1.0, 0.0, 0.0, 0.0};
            const bool hasPrincipalAxes = _TryReadQuatWxyzAttr(
                linkPrim.GetAttribute(TfToken("physics:principalAxes")),
                timeCode,
                &principalAxesLocalWxyz);

            if (!_HasMeaningfulPhysicsDynamics(
                    hasMass,
                    mass,
                    hasPhysicsMassApi,
                    hasCenterOfMass,
                    centerOfMassLocal,
                    hasDiagonalInertia,
                    diagonalInertia,
                    hasPrincipalAxes,
                    principalAxesLocalWxyz)) {
                continue;
            }

            emscripten::val entry = emscripten::val::object();
            entry.set("linkPath", linkPath);
            entry.set(
                "mass",
                hasMass ? emscripten::val(mass) : emscripten::val::null());
            entry.set(
                "centerOfMassLocal",
                hasCenterOfMass
                    ? _Vec3ToJsArray(centerOfMassLocal)
                    : _Vec3ToJsArray(std::array<double, 3>{0.0, 0.0, 0.0}));
            entry.set(
                "diagonalInertia",
                hasDiagonalInertia
                    ? _Vec3ToJsArray(diagonalInertia)
                    : (hasPhysicsMassApi
                        ? _Vec3ToJsArray(std::array<double, 3>{0.0, 0.0, 0.0})
                        : emscripten::val::null()));
            entry.set(
                "principalAxesLocalWxyz",
                hasPrincipalAxes
                    ? _Vec4ToJsArray(principalAxesLocalWxyz)
                    : _Vec4ToJsArray(std::array<double, 4>{1.0, 0.0, 0.0, 0.0}));
            linkDynamicsEntries.set(dynamicsIndex++, entry);
        }

        std::vector<std::pair<std::string, std::string>> linkParentPairsSorted;
        linkParentPairsSorted.reserve(linkParentPathByChildLinkPath.size());
        for (auto const& item : linkParentPathByChildLinkPath) {
            if (item.first.empty()) continue;
            linkParentPairsSorted.push_back(item);
        }
        std::sort(
            linkParentPairsSorted.begin(),
            linkParentPairsSorted.end(),
            [](std::pair<std::string, std::string> const& left,
               std::pair<std::string, std::string> const& right) {
                return left.first < right.first;
            });
        if (outLinkParentPairsSorted) {
            *outLinkParentPairsSorted = linkParentPairsSorted;
        }

        emscripten::val linkParentPairs = emscripten::val::array();
        int pairIndex = 0;
        for (std::pair<std::string, std::string> const& item
             : linkParentPairsSorted) {
            emscripten::val pair = emscripten::val::array();
            pair.set(0, item.first);
            if (item.second.empty()) {
                pair.set(1, emscripten::val::null());
            } else {
                pair.set(1, item.second);
            }
            linkParentPairs.set(pairIndex++, pair);
        }

        const bool hasStageMetadata =
            pairIndex > 0 || jointCatalogIndex > 0 || dynamicsIndex > 0;
        snapshot.set(
            "source",
            hasStageMetadata ? std::string("usd-stage-cpp")
                             : std::string("mesh-only"));
        snapshot.set("linkParentPairs", linkParentPairs);
        snapshot.set("jointCatalogEntries", jointCatalogEntries);
        snapshot.set("linkDynamicsEntries", linkDynamicsEntries);
        return snapshot;
    }

    void _EnsureProtoCandidateMapsPrimed(
        std::vector<std::string> const& acceptedTypes) const {
        if (_protoCandidateMapsPrimed) return;
        _collisionCandidateMapCache = _BuildCollisionCandidateMap(acceptedTypes);
        _visualCandidateMapCache = _BuildVisualCandidateMap(acceptedTypes);
        _protoCandidateMapsPrimed = true;
    }

    static emscripten::val _Matrix4dToJsArray(GfMatrix4d const& matrix) {
        emscripten::val values = emscripten::val::array();
        int index = 0;
        for (int row = 0; row < 4; ++row) {
            for (int column = 0; column < 4; ++column) {
                values.set(index++, matrix[row][column]);
            }
        }
        return values;
    }

    static void _AppendMatrix4dRowMajor(std::vector<float>* values, GfMatrix4d const& matrix) {
        if (!values) return;
        values->reserve(values->size() + 16);
        for (int row = 0; row < 4; ++row) {
            for (int column = 0; column < 4; ++column) {
                values->push_back(static_cast<float>(matrix[row][column]));
            }
        }
    }

    static emscripten::val _FloatVectorToJsFloat32Array(std::vector<float> const& values) {
        emscripten::val ctor = emscripten::val::global("Float32Array");
        if (values.empty()) {
            return ctor.new_(0);
        }
        return ctor.new_(emscripten::val(emscripten::typed_memory_view(values.size(), values.data())));
    }

    static emscripten::val _StringVectorToJsArray(std::vector<std::string> const& values) {
        emscripten::val array = emscripten::val::array();
        for (size_t index = 0; index < values.size(); ++index) {
            array.set(static_cast<unsigned>(index), values[index]);
        }
        return array;
    }

    static emscripten::val _Float16ToJsArray(std::array<float, 16> const& values16) {
        emscripten::val values = emscripten::val::array();
        for (int index = 0; index < 16; ++index) {
            values.set(index, values16[index]);
        }
        return values;
    }

    static double _PointerToJsNumber(void const* ptr) {
        if (!ptr) return 0.0;
        return static_cast<double>(reinterpret_cast<uintptr_t>(ptr));
    }

    static std::string _ToLowerAscii(std::string const& value) {
        std::string lowered = value;
        std::transform(
            lowered.begin(),
            lowered.end(),
            lowered.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return lowered;
    }

    static std::string _GetPathBasename(std::string const& path) {
        if (path.empty()) return std::string();
        const size_t lastSlash = path.find_last_of('/');
        if (lastSlash == std::string::npos) return path;
        if (lastSlash + 1 >= path.size()) return std::string();
        return path.substr(lastSlash + 1);
    }

    static std::string _GetParentPath(std::string const& path) {
        if (path.empty()) return std::string();
        const size_t lastSlash = path.find_last_of('/');
        if (lastSlash == std::string::npos || lastSlash == 0) return std::string();
        return path.substr(0, lastSlash);
    }

    static std::string _NormalizeRuntimePathToken(std::string value) {
        value = TfStringTrim(value);
        if (value.empty()) return std::string();
        value.erase(
            std::remove_if(
                value.begin(),
                value.end(),
                [](char ch) { return ch == '<' || ch == '>'; }),
            value.end());
        value = TfStringTrim(value);
        if (value.empty()) return std::string();
        if (value[0] != '/') value = "/" + value;
        while (value.size() > 1 && value.back() == '/') {
            value.pop_back();
        }
        return value;
    }

    static std::string _GetRootPathFromPrimPath(std::string const& primPath) {
        if (primPath.empty() || primPath[0] != '/') return std::string();
        const size_t secondSlash = primPath.find('/', 1);
        if (secondSlash == std::string::npos) return primPath;
        return primPath.substr(0, secondSlash);
    }

    static std::string _GetPathWithoutRoot(std::string const& primPath) {
        const std::string rootPath = _GetRootPathFromPrimPath(primPath);
        if (rootPath.empty()) return std::string();
        if (primPath.size() <= rootPath.size()) return "/";
        return primPath.substr(rootPath.size());
    }

    static std::string _GetPreferredShaderName(std::string const& materialName) {
        if (materialName.empty()) return std::string("Shader");
        const std::string lowered = _ToLowerAscii(materialName);
        if (lowered == "material_dark" || lowered == "material_white") return std::string("Shader");
        if (materialName.size() == 18 && TfStringStartsWith(lowered, "material_")) {
            bool looksNumeric = true;
            for (size_t index = 9; index < materialName.size(); ++index) {
                if (!std::isdigit(static_cast<unsigned char>(materialName[index]))) {
                    looksNumeric = false;
                    break;
                }
            }
            if (looksNumeric) return std::string("Shader");
        }
        return materialName;
    }

    static std::string _NormalizeMaterialTexturePath(std::string const& value) {
        std::string normalized = TfStringTrim(value);
        if (normalized.empty()) return std::string();
        while (!normalized.empty() && normalized.front() == '@') {
            normalized.erase(normalized.begin());
        }
        while (!normalized.empty() && normalized.back() == '@') {
            normalized.pop_back();
        }
        std::replace(normalized.begin(), normalized.end(), '\\', '/');
        if (TfStringStartsWith(normalized, "./")) {
            normalized = normalized.substr(2);
        }
        return normalized;
    }

    static bool _TryInferColorFromMaterialName(
        std::string const& materialName,
        std::array<double, 3>* outColor) {
        if (!outColor) return false;
        const std::string normalized = TfStringTrim(materialName);
        if (normalized.size() < 6) return false;
        const std::string suffix = normalized.substr(normalized.size() - 6);
        for (char ch : suffix) {
            if (!std::isxdigit(static_cast<unsigned char>(ch))) {
                return false;
            }
        }
        const int parsed = std::stoi(suffix, nullptr, 16);
        (*outColor)[0] = static_cast<double>((parsed >> 16) & 0xff) / 255.0;
        (*outColor)[1] = static_cast<double>((parsed >> 8) & 0xff) / 255.0;
        (*outColor)[2] = static_cast<double>(parsed & 0xff) / 255.0;
        return true;
    }

    static bool _TryReadBoolAttr(
        UsdAttribute const& attribute,
        UsdTimeCode const& timeCode,
        bool* outValue) {
        if (!attribute || !outValue) return false;

        bool boolValue = false;
        if (attribute.Get(&boolValue, timeCode)) {
            *outValue = boolValue;
            return true;
        }

        int intValue = 0;
        if (attribute.Get(&intValue, timeCode)) {
            *outValue = intValue != 0;
            return true;
        }

        std::string stringValue;
        if (attribute.Get(&stringValue, timeCode)) {
            const std::string lowered = _ToLowerAscii(TfStringTrim(stringValue));
            if (lowered == "true" || lowered == "yes" || lowered == "on") {
                *outValue = true;
                return true;
            }
            if (lowered == "false" || lowered == "no" || lowered == "off") {
                *outValue = false;
                return true;
            }
        }

        TfToken tokenValue;
        if (attribute.Get(&tokenValue, timeCode) && !tokenValue.IsEmpty()) {
            const std::string lowered = _ToLowerAscii(tokenValue.GetString());
            if (lowered == "true" || lowered == "yes" || lowered == "on") {
                *outValue = true;
                return true;
            }
            if (lowered == "false" || lowered == "no" || lowered == "off") {
                *outValue = false;
                return true;
            }
        }

        return false;
    }

    static bool _TryReadStringAttr(
        UsdAttribute const& attribute,
        UsdTimeCode const& timeCode,
        std::string* outValue) {
        if (!attribute || !outValue) return false;

        std::string stringValue;
        if (attribute.Get(&stringValue, timeCode) && !stringValue.empty()) {
            *outValue = stringValue;
            return true;
        }

        TfToken tokenValue;
        if (attribute.Get(&tokenValue, timeCode) && !tokenValue.IsEmpty()) {
            *outValue = tokenValue.GetString();
            return true;
        }

        return false;
    }

    static bool _TryReadVec2Attr(
        UsdAttribute const& attribute,
        UsdTimeCode const& timeCode,
        std::array<double, 2>* outValue) {
        if (!attribute || !outValue) return false;

        GfVec2f valueF(0.0f);
        if (attribute.Get(&valueF, timeCode)) {
            (*outValue)[0] = static_cast<double>(valueF[0]);
            (*outValue)[1] = static_cast<double>(valueF[1]);
            return true;
        }

        GfVec2d valueD(0.0);
        if (attribute.Get(&valueD, timeCode)) {
            (*outValue)[0] = valueD[0];
            (*outValue)[1] = valueD[1];
            return true;
        }

        double scalarValue = 0.0;
        if (_TryReadDoubleAttr(attribute.GetPrim(), attribute.GetName().GetText(), timeCode, &scalarValue)) {
            (*outValue)[0] = scalarValue;
            (*outValue)[1] = scalarValue;
            return true;
        }

        return false;
    }

    static bool _TryReadTexturePathAttr(
        UsdAttribute const& attribute,
        UsdTimeCode const& timeCode,
        std::string* outValue) {
        if (!attribute || !outValue) return false;

        SdfAssetPath assetPath;
        if (attribute.Get(&assetPath, timeCode)) {
            const std::string resolvedPath = _NormalizeMaterialTexturePath(assetPath.GetResolvedPath());
            if (!resolvedPath.empty()) {
                *outValue = resolvedPath;
                return true;
            }
            const std::string authoredPath = _NormalizeMaterialTexturePath(assetPath.GetAssetPath());
            if (!authoredPath.empty()) {
                *outValue = authoredPath;
                return true;
            }
        }

        std::string stringValue;
        if (_TryReadStringAttr(attribute, timeCode, &stringValue)) {
            const std::string normalized = _NormalizeMaterialTexturePath(stringValue);
            if (!normalized.empty()) {
                *outValue = normalized;
                return true;
            }
        }

        return false;
    }

    static bool _TryReadDisplayColor(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode,
        std::array<double, 3>* outColor,
        double* outOpacity = nullptr) {
        if (!prim || !outColor) return false;

        for (UsdPrim current = prim; current; current = current.GetParent()) {
            bool hasColor = false;
            const UsdAttribute displayColorAttr = current.GetAttribute(TfToken("primvars:displayColor"));
            if (displayColorAttr) {
                VtVec3fArray colorF;
                if (displayColorAttr.Get(&colorF, timeCode) && !colorF.empty()) {
                    (*outColor)[0] = static_cast<double>(colorF[0][0]);
                    (*outColor)[1] = static_cast<double>(colorF[0][1]);
                    (*outColor)[2] = static_cast<double>(colorF[0][2]);
                    hasColor = true;
                } else {
                    VtVec3dArray colorD;
                    if (displayColorAttr.Get(&colorD, timeCode) && !colorD.empty()) {
                        (*outColor)[0] = colorD[0][0];
                        (*outColor)[1] = colorD[0][1];
                        (*outColor)[2] = colorD[0][2];
                        hasColor = true;
                    }
                }
            }
            if (!hasColor) {
                continue;
            }

            if (outOpacity) {
                *outOpacity = 1.0;
                const UsdAttribute displayOpacityAttr = current.GetAttribute(TfToken("primvars:displayOpacity"));
                if (displayOpacityAttr) {
                    VtFloatArray opacityF;
                    if (displayOpacityAttr.Get(&opacityF, timeCode) && !opacityF.empty() && std::isfinite(opacityF[0])) {
                        *outOpacity = static_cast<double>(opacityF[0]);
                    } else {
                        VtDoubleArray opacityD;
                        if (displayOpacityAttr.Get(&opacityD, timeCode) && !opacityD.empty() && std::isfinite(opacityD[0])) {
                            *outOpacity = opacityD[0];
                        }
                    }
                }
                *outOpacity = std::max(0.0, std::min(1.0, *outOpacity));
            }

            return true;
        }

        return false;
    }

    static std::string _ColorToHexString(std::array<double, 3> const& color) {
        char buffer[7] = {0};
        const int r = std::max(0, std::min(255, static_cast<int>(std::lround(color[0] * 255.0))));
        const int g = std::max(0, std::min(255, static_cast<int>(std::lround(color[1] * 255.0))));
        const int b = std::max(0, std::min(255, static_cast<int>(std::lround(color[2] * 255.0))));
        std::snprintf(buffer, sizeof(buffer), "%02X%02X%02X", r, g, b);
        return std::string(buffer);
    }

    static std::string _BuildDisplayColorMaterialId(
        std::array<double, 3> const& color,
        double opacity = 1.0) {
        const int opacityByte = std::max(0, std::min(255, static_cast<int>(std::lround(std::max(0.0, std::min(1.0, opacity)) * 255.0))));
        char opacityBuffer[3] = {0};
        std::snprintf(opacityBuffer, sizeof(opacityBuffer), "%02X", opacityByte);
        return std::string("/__viewer_snapshot_materials__/displayColor_")
            + _ColorToHexString(color)
            + std::string("_")
            + std::string(opacityBuffer);
    }

    static emscripten::val _BuildDisplayColorMaterialRecord(
        std::array<double, 3> const& color,
        double opacity = 1.0) {
        const std::string materialId = _BuildDisplayColorMaterialId(color, opacity);
        emscripten::val record = emscripten::val::object();
        record.set("materialId", materialId);
        record.set("name", std::string("displayColor_") + _ColorToHexString(color));
        record.set("color", _Vec3ToJsArray(color));
        record.set("colorSource", std::string("display-color"));
        if (opacity < 1.0) {
          record.set("opacity", std::max(0.0, std::min(1.0, opacity)));
        }
        return record;
    }

    static std::string _ResolveDisplayColorMaterialId(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode) {
        std::array<double, 3> color = {0.0, 0.0, 0.0};
        double opacity = 1.0;
        if (!_TryReadDisplayColor(prim, timeCode, &color, &opacity)) {
            return std::string();
        }
        return _BuildDisplayColorMaterialId(color, opacity);
    }

    static std::string _ResolveBoundMaterialId(UsdPrim const& prim) {
        if (!prim) return std::string();
        UsdRelationship bindingRel;
        const UsdShadeMaterial boundMaterial = UsdShadeMaterialBindingAPI(prim).ComputeBoundMaterial(
            UsdShadeTokens->allPurpose,
            &bindingRel,
            true);
        if (boundMaterial && boundMaterial.GetPrim()) {
            return boundMaterial.GetPath().GetString();
        }
        return _ReadFirstRelationshipTargetPath(bindingRel);
    }

    static bool _IsUsableMaterialShaderPrim(UsdPrim const& shaderPrim) {
        if (!shaderPrim) return false;

        const std::string shaderType = _ToLowerAscii(shaderPrim.GetTypeName().GetString());
        if (shaderType == "shader") return true;
        if (!shaderType.empty() && shaderType != "shader") return false;

        const TfTokenVector propertyNames = shaderPrim.GetPropertyNames();
        if (propertyNames.empty()) return false;
        for (TfToken const& propertyName : propertyNames) {
            const std::string property = propertyName.GetString();
            if (property == "info:id"
                || TfStringStartsWith(property, "inputs:")
                || TfStringStartsWith(property, "outputs:")) {
                return true;
            }
        }
        return false;
    }

    UsdPrim _FindMaterialShaderPrim(UsdPrim const& materialPrim) const {
        if (!materialPrim || !_stage) return UsdPrim();

        const std::string materialPath = materialPrim.GetPath().GetString();
        const std::string materialName = _GetPathBasename(materialPath);
        std::vector<std::string> candidateNames;
        auto addCandidate = [&candidateNames](std::string const& name) {
            if (name.empty()) return;
            if (std::find(candidateNames.begin(), candidateNames.end(), name) != candidateNames.end()) return;
            candidateNames.push_back(name);
        };

        addCandidate("Shader");
        addCandidate(_GetPreferredShaderName(materialName));
        addCandidate(materialName);
        addCandidate("PreviewSurface");
        addCandidate("UsdPreviewSurface");
        addCandidate("surfaceShader");
        addCandidate("Surface");
        addCandidate("PBRShader");
        addCandidate("MtlxStandardSurface");
        addCandidate("mtlxstandard_surface");
        addCandidate("ND_standard_surface_surfaceshader");

        for (std::string const& candidateName : candidateNames) {
            const std::string shaderPath = materialPath + std::string("/") + candidateName;
            const UsdPrim shaderPrim = _stage->GetPrimAtPath(SdfPath(shaderPath));
            if (_IsUsableMaterialShaderPrim(shaderPrim)) {
                return shaderPrim;
            }
        }

        for (UsdPrim const& child : materialPrim.GetChildren()) {
            if (_IsUsableMaterialShaderPrim(child)) {
                return child;
            }
        }

        return UsdPrim();
    }

    emscripten::val _BuildSnapshotMaterialRecord(
        UsdPrim const& materialPrim,
        UsdTimeCode const& timeCode) const {
        emscripten::val record = emscripten::val::object();
        if (!materialPrim) return record;

        const std::string materialId = materialPrim.GetPath().GetString();
        const std::string materialName = _GetPathBasename(materialId);
        record.set("materialId", materialId);
        record.set("name", materialName.empty() ? materialId : materialName);

        std::array<double, 3> inferredColor = {0.0, 0.0, 0.0};
        if (_TryInferColorFromMaterialName(materialName, &inferredColor)) {
            record.set("color", _Vec3ToJsArray(inferredColor));
            record.set("colorSource", std::string("material-name"));
        }

        const UsdPrim shaderPrim = _FindMaterialShaderPrim(materialPrim);
        if (!shaderPrim) {
            return record;
        }

        const std::string shaderPath = shaderPrim.GetPath().GetString();
        record.set("shaderPath", shaderPath);
        record.set("shaderName", _GetPathBasename(shaderPath));

        auto tryReadDoubleAny = [&](std::initializer_list<char const*> attributeNames, double* outValue) {
            for (char const* attributeName : attributeNames) {
                if (_TryReadDoubleAttr(shaderPrim, attributeName, timeCode, outValue)) {
                    return true;
                }
            }
            return false;
        };
        auto tryReadBoolAny = [&](std::initializer_list<char const*> attributeNames, bool* outValue) {
            for (char const* attributeName : attributeNames) {
                if (_TryReadBoolAttr(shaderPrim.GetAttribute(TfToken(attributeName)), timeCode, outValue)) {
                    return true;
                }
            }
            return false;
        };
        auto tryReadStringAny = [&](std::initializer_list<char const*> attributeNames, std::string* outValue) {
            for (char const* attributeName : attributeNames) {
                if (_TryReadStringAttr(shaderPrim.GetAttribute(TfToken(attributeName)), timeCode, outValue)) {
                    return true;
                }
            }
            return false;
        };
        auto tryReadVec3Any = [&](std::initializer_list<char const*> attributeNames, std::array<double, 3>* outValue) {
            for (char const* attributeName : attributeNames) {
                if (_TryReadVec3Attr(shaderPrim.GetAttribute(TfToken(attributeName)), timeCode, outValue)) {
                    return true;
                }
            }
            return false;
        };
        auto tryReadVec2Any = [&](std::initializer_list<char const*> attributeNames, std::array<double, 2>* outValue) {
            for (char const* attributeName : attributeNames) {
                if (_TryReadVec2Attr(shaderPrim.GetAttribute(TfToken(attributeName)), timeCode, outValue)) {
                    return true;
                }
            }
            return false;
        };
        auto setScalar = [&](char const* fieldName, std::initializer_list<char const*> attributeNames, bool clamp01 = false, bool enforceMin = false, double minValue = 0.0) {
            double value = 0.0;
            if (!tryReadDoubleAny(attributeNames, &value) || !std::isfinite(value)) return false;
            if (clamp01) {
                value = std::max(0.0, std::min(1.0, value));
            }
            if (enforceMin) {
                value = std::max(minValue, value);
            }
            record.set(fieldName, value);
            return true;
        };
        auto setColor = [&](char const* fieldName, std::initializer_list<char const*> attributeNames) {
            std::array<double, 3> value = {0.0, 0.0, 0.0};
            if (!tryReadVec3Any(attributeNames, &value)) return false;
            record.set(fieldName, _Vec3ToJsArray(value));
            return true;
        };
        auto setVec2 = [&](char const* fieldName, std::initializer_list<char const*> attributeNames) {
            std::array<double, 2> value = {0.0, 0.0};
            if (!tryReadVec2Any(attributeNames, &value)) return false;
            emscripten::val array = emscripten::val::array();
            array.set(0, value[0]);
            array.set(1, value[1]);
            record.set(fieldName, array);
            return true;
        };
        auto setTexture = [&](char const* fieldName, std::initializer_list<char const*> attributeNames) {
            std::string texturePath;
            for (char const* attributeName : attributeNames) {
                if (std::string(attributeName) == "inputs:ORM_texture") {
                    bool ormTextureEnabled = true;
                    (void)tryReadBoolAny({ "inputs:enable_ORM_texture" }, &ormTextureEnabled);
                    if (!ormTextureEnabled) continue;
                }
                if (_TryReadTexturePathAttr(
                        shaderPrim.GetAttribute(TfToken(attributeName)),
                        timeCode,
                        &texturePath)
                    && !texturePath.empty()) {
                    record.set(fieldName, texturePath);
                    return true;
                }
            }
            return false;
        };

        std::string shaderInfoId;
        if (tryReadStringAny({
                "info:id",
                "info:mdl:sourceAsset:subIdentifier",
                "info:mdl:sourceAsset"
            }, &shaderInfoId)) {
            record.set("shaderInfoId", shaderInfoId);
            if (_ToLowerAscii(shaderInfoId).find("omnipbr") != std::string::npos) {
                record.set("isOmniPbr", true);
            }
        }

        bool opacityEnabled = true;
        if (tryReadBoolAny({ "inputs:enable_opacity", "inputs:enableOpacity" }, &opacityEnabled)) {
            record.set("opacityEnabled", opacityEnabled);
        }
        bool opacityTextureEnabled = true;
        if (tryReadBoolAny({ "inputs:enable_opacity_texture", "inputs:enableOpacityTexture" }, &opacityTextureEnabled)) {
            record.set("opacityTextureEnabled", opacityTextureEnabled);
        }
        bool emissiveEnabled = true;
        if (tryReadBoolAny({ "inputs:enable_emission", "inputs:enableEmission" }, &emissiveEnabled)) {
            record.set("emissiveEnabled", emissiveEnabled);
        }

        const bool hasBaseColor = setColor("color", {
            "inputs:diffuseColor",
            "inputs:diffuse_color_constant",
            "inputs:diffuse_color",
            "inputs:baseColor",
            "inputs:base_color",
            "inputs:base_color_constant",
            "inputs:albedo",
            "inputs:albedo_constant",
        });
        if (hasBaseColor) {
            record.set("colorSpace", std::string("linear"));
            record.set("colorSource", std::string("authored"));
        }
        (void)hasBaseColor;

        const bool roughnessAssigned = setScalar("roughness", {
            "inputs:roughness",
            "inputs:roughness_constant",
            "inputs:reflection_roughness",
            "inputs:reflection_roughness_constant",
            "inputs:specular_roughness",
        }, true);
        bool isOmniPbr = false;
        try {
            isOmniPbr = record["isOmniPbr"].as<bool>();
        } catch (...) {
            isOmniPbr = false;
        }
        if (!roughnessAssigned && isOmniPbr) {
            record.set("roughness", 0.5);
        }

        setScalar("metalness", {
            "inputs:metallic",
            "inputs:metallic_constant",
            "inputs:metalness",
            "inputs:metalness_constant",
        }, true);
        setScalar("opacity", { "inputs:opacity", "inputs:opacity_constant" }, true);
        setScalar("alphaTest", {
            "inputs:opacityThreshold",
            "inputs:opacity_threshold",
            "inputs:alphaCutoff",
            "inputs:alpha_cutoff",
        }, true);
        setScalar("clearcoat", { "inputs:clearcoat", "inputs:coat" }, true);
        setScalar("clearcoatRoughness", {
            "inputs:clearcoatRoughness",
            "inputs:clearcoat_roughness",
            "inputs:coat_roughness",
        }, true);
        setScalar("specularIntensity", {
            "inputs:specular",
            "inputs:specular_weight",
            "inputs:specular_intensity",
            "inputs:specularIntensity",
        }, true);
        setScalar("ior", { "inputs:ior", "inputs:indexOfRefraction" }, false, true, 1.0);
        setScalar("transmission", { "inputs:transmission", "inputs:transmission_weight" }, true);
        setScalar("thickness", { "inputs:thickness", "inputs:thickness_constant" }, false, true, 0.0);
        setScalar("attenuationDistance", { "inputs:attenuationDistance", "inputs:attenuation_distance" }, false, true, 0.0);
        setScalar("aoMapIntensity", { "inputs:ao_strength", "inputs:occlusion_strength", "inputs:occlusion" }, true);
        setScalar("sheen", { "inputs:sheen", "inputs:sheen_weight" }, true);
        setScalar("sheenRoughness", { "inputs:sheenRoughness", "inputs:sheen_roughness" }, true);
        setScalar("iridescence", { "inputs:iridescence", "inputs:iridescence_weight" }, true);
        setScalar("iridescenceIOR", { "inputs:iridescenceIOR", "inputs:iridescence_ior" }, false, true, 1.0);
        setScalar("anisotropy", { "inputs:anisotropy", "inputs:anisotropy_level" }, true);
        setScalar("anisotropyRotation", { "inputs:anisotropyRotation", "inputs:anisotropy_rotation" });
        setScalar("emissiveIntensity", { "inputs:emissive_intensity" }, false, true, 0.0);

        if (setColor("specularColor", { "inputs:specularColor", "inputs:specular_color" })) {
            record.set("specularColorSpace", std::string("linear"));
        }
        setColor("attenuationColor", { "inputs:attenuationColor", "inputs:attenuation_color" });
        setColor("sheenColor", { "inputs:sheenColor", "inputs:sheen_color" });
        if (setColor("emissive", {
            "inputs:emissiveColor",
            "inputs:emissive_color",
            "inputs:emissive_color_constant",
        })) {
            record.set("emissiveColorSpace", std::string("linear"));
        }

        setVec2("normalScale", { "inputs:normalScale", "inputs:normal_scale" });
        setVec2("clearcoatNormalScale", { "inputs:clearcoatNormalScale", "inputs:clearcoat_normal_scale" });

        setTexture("mapPath", {
            "inputs:diffuse_texture",
            "inputs:diffuseColor_texture",
            "inputs:diffuse_color_texture",
            "inputs:baseColor_texture",
            "inputs:base_color_texture",
            "inputs:albedo_texture",
        });
        setTexture("emissiveMapPath", {
            "inputs:emissiveColor_texture",
            "inputs:emissive_color_texture",
            "inputs:emissive_texture",
            "inputs:emissive_mask_texture",
        });
        setTexture("roughnessMapPath", {
            "inputs:roughness_texture",
            "inputs:reflectionroughness_texture",
            "inputs:reflection_roughness_texture",
            "inputs:specular_roughness_texture",
            "inputs:ORM_texture",
        });
        setTexture("metalnessMapPath", {
            "inputs:metallic_texture",
            "inputs:metalness_texture",
            "inputs:ORM_texture",
        });
        setTexture("normalMapPath", {
            "inputs:normal_texture",
            "inputs:normalmap_texture",
            "inputs:normal_map_texture",
            "inputs:detail_normalmap_texture",
        });
        setTexture("aoMapPath", {
            "inputs:occlusion_texture",
            "inputs:occlusion_map",
            "inputs:ao_texture",
            "inputs:ORM_texture",
        });
        setTexture("alphaMapPath", {
            "inputs:opacity_texture",
            "inputs:opacity_mask_texture",
            "inputs:opacityMask_texture",
        });
        setTexture("clearcoatMapPath", { "inputs:clearcoat_texture", "inputs:coat_texture" });
        setTexture("clearcoatRoughnessMapPath", {
            "inputs:clearcoatRoughness_texture",
            "inputs:clearcoat_roughness_texture",
            "inputs:coat_roughness_texture",
        });
        setTexture("clearcoatNormalMapPath", {
            "inputs:clearcoatNormal_texture",
            "inputs:clearcoat_normal_texture",
        });
        setTexture("specularColorMapPath", {
            "inputs:specularColor_texture",
            "inputs:specular_color_texture",
        });
        setTexture("specularIntensityMapPath", {
            "inputs:specular_texture",
            "inputs:specular_intensity_texture",
        });
        setTexture("transmissionMapPath", {
            "inputs:transmission_texture",
            "inputs:transmission_weight_texture",
        });
        setTexture("thicknessMapPath", { "inputs:thickness_texture" });
        setTexture("sheenColorMapPath", {
            "inputs:sheenColor_texture",
            "inputs:sheen_color_texture",
        });
        setTexture("sheenRoughnessMapPath", {
            "inputs:sheenRoughness_texture",
            "inputs:sheen_roughness_texture",
        });
        setTexture("anisotropyMapPath", { "inputs:anisotropy_texture" });
        setTexture("iridescenceMapPath", {
            "inputs:iridescence_texture",
            "inputs:iridescence_weight_texture",
        });
        setTexture("iridescenceThicknessMapPath", {
            "inputs:iridescenceThickness_texture",
            "inputs:iridescence_thickness_texture",
        });

        return record;
    }

    emscripten::val _BuildSnapshotMaterialRecords(UsdTimeCode const& timeCode) const {
        emscripten::val records = emscripten::val::array();
        if (!_stage) return records;

        unsigned int index = 0;
        std::unordered_set<std::string> seenMaterialIds;
        for (UsdPrim const& prim : _stage->Traverse()) {
            if (!prim) continue;
            const std::string primType = _ToLowerAscii(prim.GetTypeName().GetString());
            if (primType != "material") continue;
            const emscripten::val record = _BuildSnapshotMaterialRecord(prim, timeCode);
            std::string materialId;
            try {
                materialId = record["materialId"].as<std::string>();
            } catch (...) {
                materialId.clear();
            }
            if (!materialId.empty()) {
                seenMaterialIds.insert(materialId);
            }
            records.set(index++, record);
        }
        for (UsdPrim const& prim : _stage->Traverse()) {
            if (!prim) continue;
            if (_GetSupportedPrimTypeName(prim).empty()) continue;
            const std::string boundMaterialId = _ResolveBoundMaterialId(prim);
            if (!boundMaterialId.empty()) continue;
            std::array<double, 3> color = {0.0, 0.0, 0.0};
            double opacity = 1.0;
            if (!_TryReadDisplayColor(prim, timeCode, &color, &opacity)) continue;
            const std::string syntheticMaterialId = _BuildDisplayColorMaterialId(color, opacity);
            if (syntheticMaterialId.empty() || seenMaterialIds.count(syntheticMaterialId) > 0) continue;
            seenMaterialIds.insert(syntheticMaterialId);
            records.set(index++, _BuildDisplayColorMaterialRecord(color, opacity));
        }
        return records;
    }

    static bool _IsSyntheticDisplayColorMaterialId(std::string const& materialId) {
        return TfStringStartsWith(
            materialId,
            std::string("/__viewer_snapshot_materials__/displayColor_"));
    }

    static bool _TryReadTexturePathAny(
        UsdPrim const& shaderPrim,
        UsdTimeCode const& timeCode,
        std::initializer_list<char const*> attributeNames) {
        if (!shaderPrim) return false;
        std::string texturePath;
        for (char const* attributeName : attributeNames) {
            if (_TryReadTexturePathAttr(shaderPrim.GetAttribute(TfToken(attributeName)), timeCode, &texturePath)
                && !texturePath.empty()) {
                return true;
            }
        }
        return false;
    }

    static bool _PrimHasAuthoredTexturePath(
        UsdPrim const& shaderPrim,
        UsdTimeCode const& timeCode) {
        if (!shaderPrim) return false;

        if (_TryReadTexturePathAny(shaderPrim, timeCode, {
                "inputs:file",
                "inputs:diffuse_texture",
                "inputs:diffuseColor_texture",
                "inputs:diffuse_color_texture",
                "inputs:baseColor_texture",
                "inputs:base_color_texture",
                "inputs:albedo_texture",
                "inputs:emissiveColor_texture",
                "inputs:emissive_color_texture",
                "inputs:emissive_texture",
                "inputs:emissive_mask_texture",
                "inputs:roughness_texture",
                "inputs:reflectionroughness_texture",
                "inputs:reflection_roughness_texture",
                "inputs:specular_roughness_texture",
                "inputs:metallic_texture",
                "inputs:metalness_texture",
                "inputs:normal_texture",
                "inputs:normalmap_texture",
                "inputs:normal_map_texture",
                "inputs:detail_normalmap_texture",
                "inputs:occlusion_texture",
                "inputs:occlusion_map",
                "inputs:ao_texture",
                "inputs:ORM_texture",
                "inputs:opacity_texture",
                "inputs:opacity_mask_texture",
                "inputs:opacityMask_texture"})) {
            return true;
        }

        const TfTokenVector propertyNames = shaderPrim.GetPropertyNames();
        for (TfToken const& propertyName : propertyNames) {
            const std::string property = propertyName.GetString();
            const std::string lowered = _ToLowerAscii(property);
            if (!TfStringStartsWith(lowered, "inputs:")) {
                continue;
            }
            if (lowered != "inputs:file"
                && lowered.find("texture") == std::string::npos
                && lowered.find("map") == std::string::npos) {
                continue;
            }
            std::string texturePath;
            if (_TryReadTexturePathAttr(shaderPrim.GetAttribute(propertyName), timeCode, &texturePath)
                && !texturePath.empty()) {
                return true;
            }
        }

        return false;
    }

    bool _MaterialPrimUsesTextureCoordinates(
        UsdPrim const& materialPrim,
        UsdTimeCode const& timeCode) const {
        if (!materialPrim) return false;

        const UsdPrim preferredShader = _FindMaterialShaderPrim(materialPrim);
        if (_PrimHasAuthoredTexturePath(preferredShader, timeCode)) {
            return true;
        }

        for (UsdPrim const& child : UsdPrimRange(materialPrim)) {
            if (!child || child == materialPrim) continue;
            if (_PrimHasAuthoredTexturePath(child, timeCode)) {
                return true;
            }
        }

        return false;
    }

    bool _MaterialIdUsesTextureCoordinates(
        std::string const& materialId,
        UsdTimeCode const& timeCode) const {
        const std::string normalizedMaterialId = TfStringTrim(materialId);
        if (normalizedMaterialId.empty()
            || _IsSyntheticDisplayColorMaterialId(normalizedMaterialId)
            || !_stage) {
            return false;
        }

        const auto cached = _materialTextureUsageCache.find(normalizedMaterialId);
        if (cached != _materialTextureUsageCache.end()) {
            return cached->second;
        }

        bool usesTextureCoordinates = false;
        try {
            const UsdPrim materialPrim = _stage->GetPrimAtPath(SdfPath(normalizedMaterialId));
            usesTextureCoordinates = _MaterialPrimUsesTextureCoordinates(materialPrim, timeCode);
        } catch (...) {
            usesTextureCoordinates = true;
        }
        _materialTextureUsageCache[normalizedMaterialId] = usesTextureCoordinates;
        return usesTextureCoordinates;
    }

    bool _PrimMaterialBindingsUseTextureCoordinates(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode,
        std::string const& fallbackMaterialId) const {
        if (!prim) return false;
        if (_MaterialIdUsesTextureCoordinates(fallbackMaterialId, timeCode)) {
            return true;
        }

        const std::vector<UsdGeomSubset> materialSubsets =
            UsdShadeMaterialBindingAPI(prim).GetMaterialBindSubsets();
        for (UsdGeomSubset const& subset : materialSubsets) {
            if (!subset) continue;
            std::string materialId = _ReadFirstRelationshipTargetPath(
                UsdShadeMaterialBindingAPI(subset.GetPrim()).GetDirectBindingRel(
                    UsdShadeTokens->allPurpose));
            if (materialId.empty()) {
                materialId = _ResolveBoundMaterialId(subset.GetPrim());
            }
            if (_MaterialIdUsesTextureCoordinates(materialId, timeCode)) {
                return true;
            }
        }

        return false;
    }

    static bool _ContainsString(std::vector<std::string> const& values, std::string const& needle) {
        return std::find(values.begin(), values.end(), needle) != values.end();
    }

    static std::string _GetSupportedPrimTypeName(UsdPrim const& prim) {
        if (!prim) return std::string();

        const std::string authoredType = _ToLowerAscii(prim.GetTypeName().GetString());
        if (authoredType == "mesh"
            || authoredType == "cube"
            || authoredType == "sphere"
            || authoredType == "cylinder"
            || authoredType == "capsule"
            || authoredType == "points"
            || authoredType == "basiscurves") {
            return authoredType;
        }

        if (UsdGeomMesh(prim)) return "mesh";
        if (UsdGeomCube(prim)) return "cube";
        if (UsdGeomSphere(prim)) return "sphere";
        if (UsdGeomCylinder(prim)) return "cylinder";
        if (UsdGeomCapsule(prim)) return "capsule";
        if (UsdGeomPoints(prim)) return "points";
        if (UsdGeomBasisCurves(prim)) return "basiscurves";
        return std::string();
    }

    static void _AppendUniqueCandidate(
        std::vector<std::string>* candidates,
        std::string const& path) {
        if (!candidates || path.empty()) return;
        if (std::find(candidates->begin(), candidates->end(), path) != candidates->end()) return;
        candidates->push_back(path);
    }

    static ProtoMeshIdentifier _ParseProtoMeshIdentifier(std::string const& meshId) {
        ProtoMeshIdentifier result;
        if (meshId.empty()) return result;
        const size_t protoMarker = meshId.rfind(".proto_");
        if (protoMarker == std::string::npos) return result;

        const std::string containerPath = meshId.substr(0, protoMarker);
        const std::string suffix = meshId.substr(protoMarker + 7);
        const size_t idMarker = suffix.rfind("_id");
        if (containerPath.empty() || idMarker == std::string::npos || idMarker + 3 >= suffix.size()) {
            return result;
        }

        const std::string protoType = _ToLowerAscii(suffix.substr(0, idMarker));
        const std::string protoIndexText = suffix.substr(idMarker + 3);
        if (protoType.empty() || protoIndexText.empty()) return result;

        int protoIndex = -1;
        try {
            protoIndex = std::stoi(protoIndexText);
        } catch (...) {
            return result;
        }
        if (protoIndex < 0) return result;

        const size_t lastSlash = containerPath.find_last_of('/');
        if (lastSlash == std::string::npos || lastSlash == 0 || lastSlash + 1 >= containerPath.size()) {
            return result;
        }
        const std::string linkPath = containerPath.substr(0, lastSlash);
        const std::string sectionName = _ToLowerAscii(containerPath.substr(lastSlash + 1));
        const std::string linkName = _GetPathBasename(linkPath);
        if (linkPath.empty() || sectionName.empty() || linkName.empty()) return result;

        result.valid = true;
        result.meshId = meshId;
        result.containerPath = containerPath;
        result.linkPath = linkPath;
        result.linkName = linkName;
        result.sectionName = sectionName;
        result.protoType = protoType;
        result.protoIndex = protoIndex;
        return result;
    }

    static std::vector<std::string> _GetExpectedPrimTypesForProtoType(std::string const& protoType) {
        std::vector<std::string> expected;
        const std::string normalizedType = _ToLowerAscii(protoType);
        if (normalizedType == "box") {
            expected.push_back("cube");
        } else if (normalizedType == "sphere") {
            expected.push_back("sphere");
        } else if (normalizedType == "cylinder") {
            expected.push_back("cylinder");
        } else if (normalizedType == "capsule") {
            expected.push_back("capsule");
        } else if (normalizedType == "mesh") {
            expected.push_back("mesh");
            expected.push_back("cube");
            expected.push_back("sphere");
            expected.push_back("cylinder");
            expected.push_back("capsule");
        }
        return expected;
    }

    static std::vector<std::string> _GetExpectedCollisionPrimTypes(ProtoMeshIdentifier const& proto) {
        if (!proto.valid || proto.sectionName != "collisions") return {};
        return _GetExpectedPrimTypesForProtoType(proto.protoType);
    }

    static std::vector<std::string> _GetExpectedVisualPrimTypes(ProtoMeshIdentifier const& proto) {
        if (!proto.valid || proto.sectionName != "visuals") return {};
        return _GetExpectedPrimTypesForProtoType(proto.protoType);
    }

    static int _ParseNonNegativeIntegerPrefix(
        std::string const& value,
        size_t offset) {
        if (offset >= value.size()) return -1;
        int result = 0;
        bool sawDigit = false;
        for (size_t index = offset; index < value.size(); ++index) {
            const char ch = value[index];
            if (ch < '0' || ch > '9') break;
            sawDigit = true;
            result = (result * 10) + static_cast<int>(ch - '0');
        }
        return sawDigit ? result : -1;
    }

    static int _InferProtoIndexFromCandidatePrimPath(
        std::string const& containerPath,
        std::string const& primPath,
        std::string const& protoType,
        int fallbackIndex) {
        if (containerPath.empty() || primPath.empty()) {
            return fallbackIndex;
        }
        if (primPath.size() <= containerPath.size()
            || primPath.compare(0, containerPath.size(), containerPath) != 0) {
            return fallbackIndex;
        }

        std::string remainder = primPath.substr(containerPath.size());
        while (!remainder.empty() && remainder.front() == '/') {
            remainder.erase(remainder.begin());
        }
        if (remainder.empty()) {
            return fallbackIndex;
        }
        const size_t slash = remainder.find('/');
        const std::string firstSegment = slash == std::string::npos
            ? remainder
            : remainder.substr(0, slash);
        const std::string loweredSegment = _ToLowerAscii(firstSegment);

        if (TfStringStartsWith(loweredSegment, "mesh_")) {
            const int parsed = _ParseNonNegativeIntegerPrefix(loweredSegment, 5);
            if (parsed >= 0) return parsed;
        }

        std::vector<std::string> prefixes;
        const std::string normalizedProtoType = _ToLowerAscii(protoType);
        if (!normalizedProtoType.empty()) {
            prefixes.push_back(normalizedProtoType + std::string("_"));
        }
        if (normalizedProtoType == "box") {
            prefixes.push_back("cube_");
        } else if (normalizedProtoType == "cube") {
            prefixes.push_back("box_");
        }
        for (std::string const& prefix : prefixes) {
            if (!TfStringStartsWith(loweredSegment, prefix)) continue;
            const int parsed = _ParseNonNegativeIntegerPrefix(
                loweredSegment,
                prefix.size());
            if (parsed >= 0) return parsed;
        }

        return fallbackIndex;
    }

    static std::vector<std::string> _BuildProtoPrimPathCandidates(
        ProtoMeshIdentifier const& proto,
        bool includeGenericFallbacks = true) {
        std::vector<std::string> candidates;
        if (!proto.valid) return candidates;

        if (proto.protoType == "mesh") {
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/collision_mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/visual_mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/cube");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/sphere");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/cylinder");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/capsule");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex));
            if (includeGenericFallbacks && proto.protoIndex == 0) {
                _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "/mesh");
                _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "_" + proto.sectionName + "/mesh");
                _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "_link/mesh");
                _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh");
                _AppendUniqueCandidate(&candidates, proto.containerPath + "/collision_mesh");
                _AppendUniqueCandidate(&candidates, proto.containerPath + "/visual_mesh");
                _AppendUniqueCandidate(&candidates, proto.containerPath + "/cube");
                _AppendUniqueCandidate(&candidates, proto.containerPath + "/sphere");
                _AppendUniqueCandidate(&candidates, proto.containerPath + "/cylinder");
                _AppendUniqueCandidate(&candidates, proto.containerPath + "/capsule");
            }
            return candidates;
        }

        const std::string usdType = proto.protoType == "box" ? "cube" : proto.protoType;
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/" + proto.protoType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/" + usdType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.protoType + "_" + std::to_string(proto.protoIndex) + "/" + proto.protoType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.protoType + "_" + std::to_string(proto.protoIndex) + "/" + usdType);
        if (includeGenericFallbacks && proto.protoIndex == 0) {
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + usdType);
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.protoType);
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "/" + usdType);
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "/" + proto.protoType);
        }
        return candidates;
    }

    static std::string _NormalizeLinkToken(std::string value) {
        std::string lowered = _ToLowerAscii(value);
        if (lowered.size() > 5 && lowered.substr(lowered.size() - 5) == "_link") {
            lowered = lowered.substr(0, lowered.size() - 5);
        }
        return lowered;
    }

    static std::string _GetParentPathBasename(std::string const& primPath) {
        if (primPath.empty()) return std::string();
        const size_t lastSlash = primPath.find_last_of('/');
        if (lastSlash == std::string::npos || lastSlash == 0) return std::string();
        return _GetPathBasename(primPath.substr(0, lastSlash));
    }

    static bool _IsLikelyLinkNamedCandidatePath(
        ProtoMeshIdentifier const& proto,
        std::string const& primPath) {
        if (!proto.valid || primPath.empty()) return false;
        const std::string linkToken = _NormalizeLinkToken(proto.linkName);
        if (linkToken.empty()) return false;

        const std::string parentName = _NormalizeLinkToken(_GetParentPathBasename(primPath));
        if (parentName.empty()) return false;
        if (parentName == linkToken) return true;
        if (parentName.find(linkToken) != std::string::npos) return true;
        return false;
    }

    static void _PrepareProtoDiscoveredCandidates(
        ProtoMeshIdentifier const& proto,
        std::vector<std::string> const& expectedTypes,
        std::vector<PrimCandidate>* discovered) {
        if (!discovered) return;
        if (discovered->empty()) return;

        std::unordered_set<std::string> seenPaths;
        std::vector<PrimCandidate> filtered;
        filtered.reserve(discovered->size());
        for (PrimCandidate const& candidate : *discovered) {
            if (!candidate.second) continue;
            if (candidate.first.empty()) continue;
            if (!seenPaths.insert(candidate.first).second) continue;
            const std::string candidateType = _GetSupportedPrimTypeName(candidate.second);
            if (candidateType.empty() || !_ContainsString(expectedTypes, candidateType)) continue;
            filtered.push_back(candidate);
        }
        if (filtered.empty()) {
            discovered->clear();
            return;
        }

        if (proto.protoType == "mesh" && filtered.size() > 1) {
            const auto preferred = std::find_if(
                filtered.begin(),
                filtered.end(),
                [&](PrimCandidate const& candidate) {
                    return _IsLikelyLinkNamedCandidatePath(proto, candidate.first);
                });
            if (preferred != filtered.end() && preferred != filtered.begin()) {
                std::rotate(filtered.begin(), preferred, preferred + 1);
            }
        }

        *discovered = std::move(filtered);
    }

    bool _TryResolveSupportedCollisionPrim(
        UsdPrim const& candidatePrim,
        std::vector<std::string> const& expectedTypes,
        UsdPrim* outPrim,
        std::string* outPrimPath,
        std::string* outPrimType) const {
        if (!candidatePrim || !outPrim || !outPrimPath || !outPrimType) return false;

        auto tryAcceptPrim = [&](UsdPrim const& prim) {
            if (!prim) return false;
            const std::string primType = _GetSupportedPrimTypeName(prim);
            if (primType.empty() || !_ContainsString(expectedTypes, primType)) return false;
            const std::string primPath = prim.GetPath().GetString();
            if (primPath.empty()) return false;
            *outPrim = prim;
            *outPrimPath = primPath;
            *outPrimType = primType;
            return true;
        };

        if (tryAcceptPrim(candidatePrim)) return true;

        const Usd_PrimFlagsPredicate predicate = UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
        for (UsdPrim const& descendant : candidatePrim.GetFilteredDescendants(predicate)) {
            if (tryAcceptPrim(descendant)) return true;
        }
        return false;
    }

    bool _ResolveProtoPrim(
        ProtoMeshIdentifier const& proto,
        std::vector<std::string> const& expectedTypes,
        bool collisionSection,
        ProtoCandidateMap const* candidateMap,
        UsdPrim* outPrim,
        std::string* outPrimPath,
        std::string* outPrimType) const {
        if (!_stage || !proto.valid || !outPrim || !outPrimPath || !outPrimType) return false;
        if (expectedTypes.empty()) return false;

        const std::vector<std::string> indexCandidates = _BuildProtoPrimPathCandidates(proto, false);
        for (std::string const& candidatePath : indexCandidates) {
            if (candidatePath.empty()) continue;
            const SdfPath sdfPath(candidatePath);
            if (sdfPath.IsEmpty()) continue;
            const UsdPrim candidatePrim = _stage->GetPrimAtPath(sdfPath);
            if (!candidatePrim) continue;
            if (_TryResolveSupportedCollisionPrim(
                candidatePrim,
                expectedTypes,
                outPrim,
                outPrimPath,
                outPrimType)) {
                return true;
            }
        }

        std::vector<PrimCandidate> discovered;
        if (candidateMap) {
            const auto found = candidateMap->find(proto.containerPath);
            if (found != candidateMap->end()) {
                discovered = found->second;
            }
        } else if (collisionSection) {
            CollisionCandidateMap fallbackMap = _BuildCollisionCandidateMap(expectedTypes);
            const auto found = fallbackMap.find(proto.containerPath);
            if (found != fallbackMap.end()) {
                discovered = found->second;
            }
        } else {
            VisualCandidateMap fallbackMap = _BuildVisualCandidateMap(expectedTypes);
            const auto found = fallbackMap.find(proto.containerPath);
            if (found != fallbackMap.end()) {
                discovered = found->second;
            }
        }

        _PrepareProtoDiscoveredCandidates(proto, expectedTypes, &discovered);

        if (!discovered.empty()) {
            const size_t discoveredSize = discovered.size();
            if (proto.protoIndex > 0 && static_cast<size_t>(proto.protoIndex) >= discoveredSize) {
                return false;
            }
            const size_t pickedIndex = (
                proto.protoIndex >= 0
                && static_cast<size_t>(proto.protoIndex) < discoveredSize)
                ? static_cast<size_t>(proto.protoIndex)
                : 0;
            const UsdPrim pickedPrim = discovered[pickedIndex].second;
            const std::string pickedPrimType = _GetSupportedPrimTypeName(pickedPrim);
            if (pickedPrimType.empty()) return false;
            *outPrim = pickedPrim;
            *outPrimPath = discovered[pickedIndex].first;
            *outPrimType = pickedPrimType;
            return true;
        }

        if (proto.protoIndex == 0) {
            const std::vector<std::string> genericCandidates = _BuildProtoPrimPathCandidates(proto, true);
            for (std::string const& candidatePath : genericCandidates) {
                if (candidatePath.empty()) continue;
                const SdfPath sdfPath(candidatePath);
                if (sdfPath.IsEmpty()) continue;
                const UsdPrim candidatePrim = _stage->GetPrimAtPath(sdfPath);
                if (!candidatePrim) continue;
                if (_TryResolveSupportedCollisionPrim(
                    candidatePrim,
                    expectedTypes,
                    outPrim,
                    outPrimPath,
                    outPrimType)) {
                    return true;
                }
            }
        }

        return false;
    }

    bool _ResolveCollisionProtoPrim(
        ProtoMeshIdentifier const& proto,
        UsdPrim* outPrim,
        std::string* outPrimPath,
        std::string* outPrimType,
        CollisionCandidateMap const* candidateMap = nullptr) const {
        const std::vector<std::string> expectedTypes = _GetExpectedCollisionPrimTypes(proto);
        return _ResolveProtoPrim(
            proto,
            expectedTypes,
            true,
            candidateMap,
            outPrim,
            outPrimPath,
            outPrimType);
    }

    bool _ResolveVisualProtoPrim(
        ProtoMeshIdentifier const& proto,
        UsdPrim* outPrim,
        std::string* outPrimPath,
        std::string* outPrimType,
        VisualCandidateMap const* candidateMap = nullptr) const {
        const std::vector<std::string> expectedTypes = _GetExpectedVisualPrimTypes(proto);
        return _ResolveProtoPrim(
            proto,
            expectedTypes,
            false,
            candidateMap,
            outPrim,
            outPrimPath,
            outPrimType);
    }

    ProtoCandidateMap _BuildProtoCandidateMap(
        std::vector<std::string> const& acceptedTypes,
        std::string const& sectionMarker,
        size_t sectionContainerLength) const {
        ProtoCandidateMap candidateMap;
        if (!_stage || acceptedTypes.empty()) return candidateMap;
        if (sectionMarker.empty() || sectionContainerLength == 0) return candidateMap;

        const Usd_PrimFlagsPredicate predicate = UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
        for (UsdPrim const& prim : UsdPrimRange::Stage(_stage, predicate)) {
            if (!prim) continue;
            const std::string primType = _GetSupportedPrimTypeName(prim);
            if (primType.empty() || !_ContainsString(acceptedTypes, primType)) continue;

            const std::string primPath = prim.GetPath().GetString();
            const size_t markerPos = primPath.find(sectionMarker);
            if (markerPos == std::string::npos) continue;

            const size_t containerEnd = markerPos + sectionContainerLength;
            if (containerEnd <= 0 || containerEnd > primPath.size()) continue;
            const std::string containerPath = primPath.substr(0, containerEnd);
            if (containerPath.empty()) continue;

            candidateMap[containerPath].push_back({primPath, prim});
        }
        return candidateMap;
    }

    CollisionCandidateMap _BuildCollisionCandidateMap(
        std::vector<std::string> const& acceptedTypes) const {
        return _BuildProtoCandidateMap(
            acceptedTypes,
            "/collisions/",
            std::string("/collisions").size());
    }

    VisualCandidateMap _BuildVisualCandidateMap(
        std::vector<std::string> const& acceptedTypes) const {
        return _BuildProtoCandidateMap(
            acceptedTypes,
            "/visuals/",
            std::string("/visuals").size());
    }

    static bool _TryReadExtentSize(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode,
        std::array<double, 3>* outExtentSize) {
        if (!outExtentSize) return false;
        UsdAttribute extentAttr = prim.GetAttribute(TfToken("extent"));
        if (!extentAttr) return false;

        VtVec3fArray extentF;
        if (extentAttr.Get(&extentF, timeCode) && extentF.size() >= 2) {
            (*outExtentSize)[0] = std::abs(static_cast<double>(extentF[1][0] - extentF[0][0]));
            (*outExtentSize)[1] = std::abs(static_cast<double>(extentF[1][1] - extentF[0][1]));
            (*outExtentSize)[2] = std::abs(static_cast<double>(extentF[1][2] - extentF[0][2]));
            return true;
        }

        VtVec3dArray extentD;
        if (extentAttr.Get(&extentD, timeCode) && extentD.size() >= 2) {
            (*outExtentSize)[0] = std::abs(extentD[1][0] - extentD[0][0]);
            (*outExtentSize)[1] = std::abs(extentD[1][1] - extentD[0][1]);
            (*outExtentSize)[2] = std::abs(extentD[1][2] - extentD[0][2]);
            return true;
        }
        return false;
    }

    static bool _TryReadDoubleAttr(
        UsdPrim const& prim,
        char const* attrName,
        UsdTimeCode const& timeCode,
        double* outValue) {
        if (!attrName || !outValue) return false;
        UsdAttribute attribute = prim.GetAttribute(TfToken(attrName));
        if (!attribute) return false;

        double valueDouble = 0.0;
        if (attribute.Get(&valueDouble, timeCode) && std::isfinite(valueDouble)) {
            *outValue = valueDouble;
            return true;
        }

        float valueFloat = 0.0f;
        if (attribute.Get(&valueFloat, timeCode) && std::isfinite(valueFloat)) {
            *outValue = static_cast<double>(valueFloat);
            return true;
        }
        return false;
    }

    static std::string _ReadAxisToken(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode) {
        std::string axis = "X";
        const std::array<TfToken, 2> axisAttrNames = {
            TfToken("physics:axis"),
            TfToken("axis")
        };
        for (TfToken const& axisAttrName : axisAttrNames) {
            UsdAttribute axisAttr = prim.GetAttribute(axisAttrName);
            if (!axisAttr) continue;

            TfToken axisToken;
            if (axisAttr.Get(&axisToken, timeCode) && !axisToken.IsEmpty()) {
                axis = axisToken.GetString();
                break;
            }

            std::string axisString;
            if (axisAttr.Get(&axisString, timeCode) && !axisString.empty()) {
                axis = axisString;
                break;
            }
        }
        axis = _ToLowerAscii(axis);
        if (axis == "x") return "X";
        if (axis == "y") return "Y";
        if (axis == "z") return "Z";
        return "X";
    }

    static std::string _ReadGeomAxisToken(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode) {
        std::string axis = "Z";
        UsdAttribute axisAttr = prim.GetAttribute(TfToken("axis"));
        if (axisAttr) {
            TfToken axisToken;
            if (axisAttr.Get(&axisToken, timeCode) && !axisToken.IsEmpty()) {
                axis = axisToken.GetString();
            } else {
                std::string axisString;
                if (axisAttr.Get(&axisString, timeCode) && !axisString.empty()) {
                    axis = axisString;
                }
            }
        }

        axis = _ToLowerAscii(axis);
        if (axis == "x") return "X";
        if (axis == "y") return "Y";
        if (axis == "z") return "Z";
        return "Z";
    }

    static void _Matrix4dToFloat16(
        GfMatrix4d const& matrix,
        std::array<float, 16>* outValues) {
        if (!outValues) return;
        int index = 0;
        for (int row = 0; row < 4; ++row) {
            for (int column = 0; column < 4; ++column) {
                (*outValues)[index++] = static_cast<float>(matrix[row][column]);
            }
        }
    }

    static bool _TryTriangulateFaceVertexIndices(
        VtIntArray const& faceVertexCounts,
        VtIntArray const& faceVertexIndices,
        std::vector<uint32_t>* outIndices) {
        if (!outIndices) return false;
        outIndices->clear();
        if (faceVertexIndices.empty()) return false;

        if (faceVertexCounts.empty()) {
            outIndices->reserve(faceVertexIndices.size());
            for (int indexValue : faceVertexIndices) {
                if (indexValue < 0) return false;
                outIndices->push_back(static_cast<uint32_t>(indexValue));
            }
            return !outIndices->empty();
        }

        size_t cursor = 0;
        for (int countValue : faceVertexCounts) {
            const int count = countValue > 0 ? countValue : 0;
            const size_t countSize = static_cast<size_t>(count);
            if (cursor + countSize > faceVertexIndices.size()) {
                break;
            }

            if (count >= 3) {
                const int firstIndex = faceVertexIndices[cursor];
                if (firstIndex < 0) return false;
                for (int vertexIndex = 1; vertexIndex < count - 1; ++vertexIndex) {
                    const int secondIndex = faceVertexIndices[cursor + static_cast<size_t>(vertexIndex)];
                    const int thirdIndex = faceVertexIndices[cursor + static_cast<size_t>(vertexIndex + 1)];
                    if (secondIndex < 0 || thirdIndex < 0) return false;
                    outIndices->push_back(static_cast<uint32_t>(firstIndex));
                    outIndices->push_back(static_cast<uint32_t>(secondIndex));
                    outIndices->push_back(static_cast<uint32_t>(thirdIndex));
                }
            }
            cursor += countSize;
            if (cursor >= faceVertexIndices.size()) break;
        }

        return !outIndices->empty();
    }

    static std::string _NormalizeSplitUvPrimvarName(std::string const& name) {
        if (name.empty()) return {};

        std::string normalized = name;
        std::transform(
            normalized.begin(),
            normalized.end(),
            normalized.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return normalized;
    }

    static bool _TryGetSplitUvPrimvarOrdinal(std::string const& name, int* outOrdinal) {
        if (outOrdinal) {
            *outOrdinal = -1;
        }

        const std::string normalized = _NormalizeSplitUvPrimvarName(name);
        if (normalized == "primvars:st" || normalized == "st") {
            if (outOrdinal) {
                *outOrdinal = 0;
            }
            return true;
        }
        if (normalized.rfind("primvars:st_", 0) != 0 && normalized.rfind("st_", 0) != 0) {
            return false;
        }

        const size_t prefixLength = normalized.rfind("primvars:", 0) == 0 ? 12 : 3;
        if (normalized.size() <= prefixLength) {
            return false;
        }

        int ordinal = 0;
        for (size_t index = prefixLength; index < normalized.size(); ++index) {
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

    static bool _TryTriangulateFaceVaryingVec2f(
        VtIntArray const& faceVertexCounts,
        VtVec2fArray const& sourceValues,
        VtVec2fArray* outValues) {
        if (!outValues) return false;
        outValues->clear();
        if (sourceValues.empty()) return false;

        if (faceVertexCounts.empty()) {
            *outValues = sourceValues;
            return true;
        }

        size_t expectedSourceCount = 0;
        size_t totalTriangleCount = 0;
        for (const int countValue : faceVertexCounts) {
            const size_t count = countValue > 0 ? static_cast<size_t>(countValue) : static_cast<size_t>(0);
            expectedSourceCount += count;
            if (count >= 3) {
                totalTriangleCount += (count - 2);
            }
        }

        if (expectedSourceCount == 0 || sourceValues.size() < expectedSourceCount || totalTriangleCount == 0) {
            return false;
        }

        outValues->reserve(totalTriangleCount * 3);
        size_t cursor = 0;
        for (const int countValue : faceVertexCounts) {
            const size_t count = countValue > 0 ? static_cast<size_t>(countValue) : static_cast<size_t>(0);
            if (count >= 3) {
                if (cursor + count > sourceValues.size()) {
                    outValues->clear();
                    return false;
                }
                const GfVec2f first = sourceValues[cursor];
                for (size_t vertexIndex = 1; vertexIndex + 1 < count; ++vertexIndex) {
                    outValues->push_back(first);
                    outValues->push_back(sourceValues[cursor + vertexIndex]);
                    outValues->push_back(sourceValues[cursor + vertexIndex + 1]);
                }
            }
            cursor += count;
            if (cursor >= sourceValues.size()) {
                break;
            }
        }

        return !outValues->empty();
    }

    static bool _TryTriangulateFaceVaryingVec3f(
        VtIntArray const& faceVertexCounts,
        VtVec3fArray const& sourceValues,
        VtVec3fArray* outValues) {
        if (!outValues) return false;
        outValues->clear();
        if (sourceValues.empty()) return false;

        if (faceVertexCounts.empty()) {
            *outValues = sourceValues;
            return true;
        }

        size_t expectedSourceCount = 0;
        size_t totalTriangleCount = 0;
        for (const int countValue : faceVertexCounts) {
            const size_t count = countValue > 0 ? static_cast<size_t>(countValue) : static_cast<size_t>(0);
            expectedSourceCount += count;
            if (count >= 3) {
                totalTriangleCount += (count - 2);
            }
        }

        if (expectedSourceCount == 0 || sourceValues.size() < expectedSourceCount || totalTriangleCount == 0) {
            return false;
        }

        outValues->reserve(totalTriangleCount * 3);
        size_t cursor = 0;
        for (const int countValue : faceVertexCounts) {
            const size_t count = countValue > 0 ? static_cast<size_t>(countValue) : static_cast<size_t>(0);
            if (count >= 3) {
                if (cursor + count > sourceValues.size()) {
                    outValues->clear();
                    return false;
                }
                const GfVec3f first = sourceValues[cursor];
                for (size_t vertexIndex = 1; vertexIndex + 1 < count; ++vertexIndex) {
                    outValues->push_back(first);
                    outValues->push_back(sourceValues[cursor + vertexIndex]);
                    outValues->push_back(sourceValues[cursor + vertexIndex + 1]);
                }
            }
            cursor += count;
            if (cursor >= sourceValues.size()) {
                break;
            }
        }

        return !outValues->empty();
    }

    static bool _TryReadSplitFaceVaryingUvPrimvars(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode,
        size_t expectedFaceVaryingCount,
        VtVec2fArray* outValues) {
        if (!outValues) return false;
        outValues->clear();
        if (!prim || expectedFaceVaryingCount == 0) return false;

        struct SplitUvPrimvarRecord {
            int ordinal = -1;
            std::string name;
        };

        std::vector<SplitUvPrimvarRecord> splitUvPrimvars;
        splitUvPrimvars.reserve(8);
        bool hasSplitSuffix = false;
        const TfTokenVector propertyNames = prim.GetPropertyNames();
        for (TfToken const& propertyNameToken : propertyNames) {
            const std::string propertyName = propertyNameToken.GetString();
            int ordinal = -1;
            if (!_TryGetSplitUvPrimvarOrdinal(propertyName, &ordinal)) {
                continue;
            }
            if (ordinal > 0) {
                hasSplitSuffix = true;
            }
            splitUvPrimvars.push_back({ordinal, propertyName});
        }

        if (splitUvPrimvars.size() <= 1 || !hasSplitSuffix) {
            return false;
        }

        std::sort(
            splitUvPrimvars.begin(),
            splitUvPrimvars.end(),
            [](SplitUvPrimvarRecord const& left, SplitUvPrimvarRecord const& right) {
                if (left.ordinal != right.ordinal) {
                    return left.ordinal < right.ordinal;
                }
                return left.name < right.name;
            });

        VtVec2fArray mergedValues;
        mergedValues.reserve(expectedFaceVaryingCount);
        for (SplitUvPrimvarRecord const& splitUvPrimvar : splitUvPrimvars) {
            const UsdAttribute uvAttr = prim.GetAttribute(TfToken(splitUvPrimvar.name));
            if (!uvAttr) {
                return false;
            }

            VtVec2fArray uvF;
            if (uvAttr.Get(&uvF, timeCode) && !uvF.empty()) {
                for (GfVec2f const& uvValue : uvF) {
                    mergedValues.push_back(uvValue);
                }
                continue;
            }

            VtVec2dArray uvD;
            if (uvAttr.Get(&uvD, timeCode) && !uvD.empty()) {
                for (GfVec2d const& uv : uvD) {
                    mergedValues.push_back(GfVec2f(
                        static_cast<float>(uv[0]),
                        static_cast<float>(uv[1])));
                }
                continue;
            }

            return false;
        }

        if (mergedValues.size() != expectedFaceVaryingCount) {
            return false;
        }

        *outValues = std::move(mergedValues);
        return true;
    }

    static bool _BuildGeomSubsetSectionsFromPrim(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode,
        VtIntArray const& faceVertexCounts,
        std::string const& fallbackMaterialId,
        std::vector<WebRenderDelegate::GeomSubsetSection>* outSections) {
        if (!outSections) return false;
        outSections->clear();
        if (!prim || faceVertexCounts.empty()) return false;

        UsdShadeMaterialBindingAPI bindingApi(prim);
        const std::vector<UsdGeomSubset> materialSubsets = bindingApi.GetMaterialBindSubsets();
        if (materialSubsets.empty()) return false;

        std::vector<int> triangleStartByFace(faceVertexCounts.size() + 1, 0);
        for (size_t faceIndex = 0; faceIndex < faceVertexCounts.size(); ++faceIndex) {
            const int vertexCount = std::max(0, static_cast<int>(faceVertexCounts[faceIndex]));
            const int triangleIndexCount = vertexCount >= 3 ? ((vertexCount - 2) * 3) : 0;
            triangleStartByFace[faceIndex + 1] = triangleStartByFace[faceIndex] + triangleIndexCount;
        }

        std::vector<int> sortedFaceIndices;
        for (UsdGeomSubset const& subset : materialSubsets) {
            if (!subset) continue;

            VtIntArray subsetFaceIndices;
            if (!subset.GetIndicesAttr().Get(&subsetFaceIndices, timeCode) || subsetFaceIndices.empty()) {
                continue;
            }

            sortedFaceIndices.clear();
            sortedFaceIndices.reserve(subsetFaceIndices.size());
            for (int faceIndex : subsetFaceIndices) {
                if (faceIndex < 0) continue;
                const size_t faceIndexSize = static_cast<size_t>(faceIndex);
                if (faceIndexSize >= faceVertexCounts.size()) continue;
                sortedFaceIndices.push_back(faceIndex);
            }
            if (sortedFaceIndices.empty()) continue;

            std::sort(sortedFaceIndices.begin(), sortedFaceIndices.end());
            sortedFaceIndices.erase(
                std::unique(sortedFaceIndices.begin(), sortedFaceIndices.end()),
                sortedFaceIndices.end());

            std::string materialId = _ReadFirstRelationshipTargetPath(
                UsdShadeMaterialBindingAPI(subset.GetPrim()).GetDirectBindingRel(
                    UsdShadeTokens->allPurpose));
            if (materialId.empty()) {
                materialId = _ResolveBoundMaterialId(subset.GetPrim());
            }
            if (materialId.empty()) {
                materialId = fallbackMaterialId;
            }

            int currentStart = -1;
            int currentLength = 0;
            int previousFaceIndex = -2;
            auto flushCurrentSection = [&]() {
                if (currentStart < 0 || currentLength <= 0) return;
                outSections->push_back({currentStart, currentLength, materialId});
            };

            for (int faceIndex : sortedFaceIndices) {
                const int faceStart = triangleStartByFace[static_cast<size_t>(faceIndex)];
                const int faceLength = triangleStartByFace[static_cast<size_t>(faceIndex + 1)] - faceStart;
                if (faceLength <= 0) continue;

                const bool isContiguousFace = (
                    currentStart >= 0
                    && faceIndex == (previousFaceIndex + 1)
                    && (currentStart + currentLength) == faceStart);
                if (!isContiguousFace) {
                    flushCurrentSection();
                    currentStart = faceStart;
                    currentLength = faceLength;
                } else {
                    currentLength += faceLength;
                }
                previousFaceIndex = faceIndex;
            }

            flushCurrentSection();
        }

        return !outSections->empty();
    }

    static bool _BuildMeshPayloadRecordFromPrim(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode,
        GfMatrix4d const& worldMatrix,
        bool includeTextureCoordinates,
        WebRenderDelegate::ProtoDataBlobRecord* outRecord) {
        if (!outRecord) return false;

        *outRecord = WebRenderDelegate::ProtoDataBlobRecord();
        const UsdGeomMesh mesh(prim);
        if (!mesh) return false;

        const UsdAttribute pointsAttr = mesh.GetPointsAttr();
        VtVec3fArray pointsF;
        if (pointsAttr.Get(&pointsF, timeCode) && !pointsF.empty()) {
            outRecord->points.reserve(pointsF.size() * 3);
            for (GfVec3f const& point : pointsF) {
                outRecord->points.push_back(point[0]);
                outRecord->points.push_back(point[1]);
                outRecord->points.push_back(point[2]);
            }
        } else {
            VtVec3dArray pointsD;
            if (pointsAttr.Get(&pointsD, timeCode) && !pointsD.empty()) {
                outRecord->points.reserve(pointsD.size() * 3);
                for (GfVec3d const& point : pointsD) {
                    outRecord->points.push_back(static_cast<float>(point[0]));
                    outRecord->points.push_back(static_cast<float>(point[1]));
                    outRecord->points.push_back(static_cast<float>(point[2]));
                }
            }
        }
        if (outRecord->points.empty()) return false;

        VtIntArray faceVertexIndices;
        VtIntArray faceVertexCounts;
        mesh.GetFaceVertexIndicesAttr().Get(&faceVertexIndices, timeCode);
        mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts, timeCode);
        _TryTriangulateFaceVertexIndices(faceVertexCounts, faceVertexIndices, &outRecord->indices);

        size_t expectedFaceVaryingCount = !faceVertexCounts.empty()
            ? static_cast<size_t>(0)
            : faceVertexIndices.size();
        if (!faceVertexCounts.empty()) {
            for (const int countValue : faceVertexCounts) {
                if (countValue > 0) {
                    expectedFaceVaryingCount += static_cast<size_t>(countValue);
                }
            }
        }

        std::string uvSource = "none";
        if (!includeTextureCoordinates) {
            uvSource = "skippedColorOnly";
        } else {
            VtVec2fArray uvValues;
            if (_TryReadSplitFaceVaryingUvPrimvars(prim, timeCode, expectedFaceVaryingCount, &uvValues)) {
                uvSource = "faceVarying";
            } else {
                const UsdAttribute uvAttr = prim.GetAttribute(TfToken("primvars:st"));
                if (uvAttr) {
                    const UsdGeomPrimvar uvPrimvar(uvAttr);
                    const TfToken uvInterpolation = uvPrimvar
                        ? uvPrimvar.GetInterpolation()
                        : TfToken();
                    VtVec2fArray uvF;
                    if (uvAttr.Get(&uvF, timeCode) && !uvF.empty()) {
                        uvValues = std::move(uvF);
                    } else {
                        VtVec2dArray uvD;
                        if (uvAttr.Get(&uvD, timeCode) && !uvD.empty()) {
                            uvValues.reserve(uvD.size());
                            for (GfVec2d const& uv : uvD) {
                                uvValues.push_back(GfVec2f(
                                    static_cast<float>(uv[0]),
                                    static_cast<float>(uv[1])));
                            }
                        }
                    }
                    if (!uvValues.empty()) {
                        if (uvInterpolation == UsdGeomTokens->faceVarying) {
                            uvSource = "faceVarying";
                        } else if (uvInterpolation == UsdGeomTokens->vertex
                            || uvInterpolation == UsdGeomTokens->varying) {
                            uvSource = "vertex";
                        } else {
                            uvSource = "authored";
                        }
                    }
                }
            }

            if (!uvValues.empty()) {
                VtVec2fArray triangulatedUvValues;
                VtVec2fArray const* finalUvValues = &uvValues;
                if (uvSource == "faceVarying"
                    && _TryTriangulateFaceVaryingVec2f(faceVertexCounts, uvValues, &triangulatedUvValues)) {
                    finalUvValues = &triangulatedUvValues;
                }

                outRecord->uv.reserve(finalUvValues->size() * 2);
                for (GfVec2f const& uv : *finalUvValues) {
                    outRecord->uv.push_back(uv[0]);
                    outRecord->uv.push_back(uv[1]);
                }
            }
        }
        outRecord->uvSource = uvSource;

        const UsdAttribute normalsAttr = mesh.GetNormalsAttr();
        std::string normalSource = "none";
        if (normalsAttr) {
            VtVec3fArray normalValues;
            VtVec3fArray normalsF;
            if (normalsAttr.Get(&normalsF, timeCode) && !normalsF.empty()) {
                normalValues = std::move(normalsF);
            } else {
                VtVec3dArray normalsD;
                if (normalsAttr.Get(&normalsD, timeCode) && !normalsD.empty()) {
                    normalValues.reserve(normalsD.size());
                    for (GfVec3d const& normal : normalsD) {
                        normalValues.push_back(GfVec3f(
                            static_cast<float>(normal[0]),
                            static_cast<float>(normal[1]),
                            static_cast<float>(normal[2])));
                    }
                }
            }

            if (!normalValues.empty()) {
                const TfToken normalsInterpolation = mesh.GetNormalsInterpolation();
                VtVec3fArray triangulatedNormalValues;
                VtVec3fArray const* finalNormalValues = &normalValues;
                if (normalsInterpolation == UsdGeomTokens->faceVarying) {
                    normalSource = "authoredFaceVarying";
                    if (normalValues.size() == outRecord->indices.size()) {
                        finalNormalValues = &normalValues;
                    } else if (_TryTriangulateFaceVaryingVec3f(
                            faceVertexCounts,
                            normalValues,
                            &triangulatedNormalValues)) {
                        finalNormalValues = &triangulatedNormalValues;
                    }
                } else if (normalsInterpolation == UsdGeomTokens->vertex
                    || normalsInterpolation == UsdGeomTokens->varying) {
                    normalSource = "authoredVertex";
                } else {
                    normalSource = "authored";
                }

                outRecord->normals.reserve(finalNormalValues->size() * 3);
                for (GfVec3f const& normal : *finalNormalValues) {
                    outRecord->normals.push_back(normal[0]);
                    outRecord->normals.push_back(normal[1]);
                    outRecord->normals.push_back(normal[2]);
                }
            }
        }
        outRecord->normalSource = normalSource;

        _Matrix4dToFloat16(worldMatrix, &outRecord->transform);
        outRecord->materialId = _ResolveBoundMaterialId(prim);
        if (outRecord->materialId.empty()) {
            outRecord->materialId = _ResolveDisplayColorMaterialId(prim, timeCode);
        }
        _BuildGeomSubsetSectionsFromPrim(
            prim,
            timeCode,
            faceVertexCounts,
            outRecord->materialId,
            &outRecord->geomSubsetSections);
        outRecord->numVertices = static_cast<int>(outRecord->points.size() / 3);
        outRecord->numIndices = static_cast<int>(outRecord->indices.size());
        outRecord->numUVs = static_cast<int>(outRecord->uv.size() / 2);
        outRecord->uvDimension = outRecord->numUVs > 0 ? 2 : 0;
        outRecord->numNormals = static_cast<int>(outRecord->normals.size() / 3);
        outRecord->normalsDimension = outRecord->numNormals > 0 ? 3 : 0;
        WebRenderDelegate::RepairProtoDataBlobNormals(outRecord, outRecord->normalSource);
        WebRenderDelegate::FinalizeProtoDataBlobRenderBuffers(outRecord);
        outRecord->valid = outRecord->numVertices > 0;
        return outRecord->valid;
    }

    static emscripten::val _Vec3ToJsArray(std::array<double, 3> const& value) {
        emscripten::val out = emscripten::val::array();
        out.set(0, value[0]);
        out.set(1, value[1]);
        out.set(2, value[2]);
        return out;
    }

    static emscripten::val _Vec4ToJsArray(std::array<double, 4> const& value) {
        emscripten::val out = emscripten::val::array();
        out.set(0, value[0]);
        out.set(1, value[1]);
        out.set(2, value[2]);
        out.set(3, value[3]);
        return out;
    }

    static bool _HasSignificantDouble(double value, double epsilon = 1e-9) {
        return std::isfinite(value) && std::abs(value) > epsilon;
    }

    static bool _HasSignificantVec3(
        std::array<double, 3> const& value,
        double epsilon = 1e-9) {
        return _HasSignificantDouble(value[0], epsilon)
            || _HasSignificantDouble(value[1], epsilon)
            || _HasSignificantDouble(value[2], epsilon);
    }

    static bool _HasNonIdentityQuatWxyz(
        std::array<double, 4> const& value,
        double epsilon = 1e-9) {
        if (!std::isfinite(value[0])
            || !std::isfinite(value[1])
            || !std::isfinite(value[2])
            || !std::isfinite(value[3])) {
            return false;
        }

        const double length = std::sqrt(
            value[0] * value[0]
            + value[1] * value[1]
            + value[2] * value[2]
            + value[3] * value[3]);
        if (length <= epsilon) {
            return false;
        }

        const double normalizedW = value[0] / length;
        const double normalizedX = value[1] / length;
        const double normalizedY = value[2] / length;
        const double normalizedZ = value[3] / length;
        return std::abs(normalizedX) > epsilon
            || std::abs(normalizedY) > epsilon
            || std::abs(normalizedZ) > epsilon
            || std::abs(std::abs(normalizedW) - 1.0) > epsilon;
    }

    static bool _HasMeaningfulPhysicsDynamics(
        bool hasMass,
        double mass,
        bool hasPhysicsMassApi,
        bool hasCenterOfMass,
        std::array<double, 3> const& centerOfMassLocal,
        bool hasDiagonalInertia,
        std::array<double, 3> const& diagonalInertia,
        bool hasPrincipalAxes,
        std::array<double, 4> const& principalAxesLocalWxyz) {
        return hasPhysicsMassApi
            || (hasMass && _HasSignificantDouble(mass))
            || (hasCenterOfMass && _HasSignificantVec3(centerOfMassLocal))
            || (hasDiagonalInertia && _HasSignificantVec3(diagonalInertia))
            || (hasPrincipalAxes && _HasNonIdentityQuatWxyz(principalAxesLocalWxyz));
    }

    static bool _PrimHasAppliedApiSchema(UsdPrim const& prim, char const* schemaName) {
        if (!prim || !schemaName || schemaName[0] == '\0') {
            return false;
        }

        TfTokenVector const appliedSchemas = prim.GetAppliedSchemas();
        for (TfToken const& schemaToken : appliedSchemas) {
            const std::string schema = schemaToken.GetString();
            if (schema == schemaName) {
                return true;
            }
            if (schema.rfind(std::string(schemaName) + ":", 0) == 0) {
                return true;
            }
        }
        return false;
    }

    static bool _PrimHasEnabledCollision(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode) {
        if (!prim) {
            return false;
        }

        const UsdAttribute collisionEnabledAttr =
            prim.GetAttribute(TfToken("physics:collisionEnabled"));
        if (collisionEnabledAttr) {
            bool collisionEnabled = true;
            if (collisionEnabledAttr.Get(&collisionEnabled, timeCode)) {
                return collisionEnabled;
            }
            return true;
        }

        const TfTokenVector appliedSchemas = prim.GetAppliedSchemas();
        for (TfToken const& schemaToken : appliedSchemas) {
            const std::string schema = _ToLowerAscii(schemaToken.GetString());
            if (schema.find("collisionapi") != std::string::npos) {
                return true;
            }
        }
        return false;
    }

    static emscripten::val _GeomSubsetSectionsToJsArray(
        std::vector<WebRenderDelegate::GeomSubsetSection> const& sections) {
        emscripten::val out = emscripten::val::array();
        int index = 0;
        for (WebRenderDelegate::GeomSubsetSection const& section : sections) {
            emscripten::val sectionObject = emscripten::val::object();
            sectionObject.set("start", section.start);
            sectionObject.set("length", section.length);
            sectionObject.set("materialId", section.materialId);
            out.set(index++, sectionObject);
        }
        return out;
    }

    static std::string _ReadFirstRelationshipTargetPath(UsdRelationship const& relationship) {
        if (!relationship) return std::string();
        SdfPathVector targets;
        if (!relationship.GetTargets(&targets) || targets.empty()) return std::string();
        return targets[0].GetString();
    }

    static bool _TryReadVec3Attr(
        UsdAttribute const& attribute,
        UsdTimeCode const& timeCode,
        std::array<double, 3>* outValue) {
        if (!attribute || !outValue) return false;

        GfVec3f valueF(0.0f);
        if (attribute.Get(&valueF, timeCode)) {
            (*outValue)[0] = static_cast<double>(valueF[0]);
            (*outValue)[1] = static_cast<double>(valueF[1]);
            (*outValue)[2] = static_cast<double>(valueF[2]);
            return true;
        }

        GfVec3d valueD(0.0);
        if (attribute.Get(&valueD, timeCode)) {
            (*outValue)[0] = valueD[0];
            (*outValue)[1] = valueD[1];
            (*outValue)[2] = valueD[2];
            return true;
        }

        return false;
    }

    static bool _TryReadQuatWxyzAttr(
        UsdAttribute const& attribute,
        UsdTimeCode const& timeCode,
        std::array<double, 4>* outValue) {
        if (!attribute || !outValue) return false;

        GfQuatf valueQuatf;
        if (attribute.Get(&valueQuatf, timeCode)) {
            const GfVec3f imaginary = valueQuatf.GetImaginary();
            (*outValue)[0] = static_cast<double>(valueQuatf.GetReal());
            (*outValue)[1] = static_cast<double>(imaginary[0]);
            (*outValue)[2] = static_cast<double>(imaginary[1]);
            (*outValue)[3] = static_cast<double>(imaginary[2]);
            return true;
        }

        GfQuatd valueQuatd;
        if (attribute.Get(&valueQuatd, timeCode)) {
            const GfVec3d imaginary = valueQuatd.GetImaginary();
            (*outValue)[0] = valueQuatd.GetReal();
            (*outValue)[1] = imaginary[0];
            (*outValue)[2] = imaginary[1];
            (*outValue)[3] = imaginary[2];
            return true;
        }

        return false;
    }

    emscripten::val _ProtoDataBlobRecordToJsVal(
        WebRenderDelegate::ProtoDataBlobRecord const& record) const {
        emscripten::val blob = emscripten::val::object();
        blob.set("valid", record.valid);
        blob.set("numVertices", record.numVertices);
        blob.set("numIndices", record.numIndices);
        blob.set("numUVs", record.numUVs);
        blob.set("uvDimension", record.uvDimension);
        blob.set("numNormals", record.numNormals);
        blob.set("normalsDimension", record.normalsDimension);
        blob.set("materialId", record.materialId);
        blob.set("renderReady", record.renderReady);
        blob.set("topologyMode", record.topologyMode);
        blob.set("uvSource", record.uvSource);
        blob.set("normalSource", record.normalSource);
        blob.set("normalRepairCount", record.normalRepairCount);
        blob.set("normalFallbackCount", record.normalFallbackCount);
        blob.set("postRepairLowDotCount", record.postRepairLowDotCount);
        blob.set("pointsPtr", _PointerToJsNumber(record.points.empty() ? nullptr : record.points.data()));
        blob.set("indicesPtr", _PointerToJsNumber(record.indices.empty() ? nullptr : record.indices.data()));
        blob.set("uvPtr", _PointerToJsNumber(record.uv.empty() ? nullptr : record.uv.data()));
        blob.set("normalsPtr", _PointerToJsNumber(record.normals.empty() ? nullptr : record.normals.data()));
        blob.set("transformPtr", _PointerToJsNumber(record.transform.data()));
        // Keep a small transform fallback in case pointer access is disabled.
        blob.set("transform", _Float16ToJsArray(record.transform));
        blob.set("geomSubsetSections", _GeomSubsetSectionsToJsArray(record.geomSubsetSections));
        return blob;
    }

    static emscripten::val _NormalDiagnosticsToJsVal(
        WebRenderDelegate::ProtoDataBlobRecord const& record) {
        emscripten::val diagnostics = emscripten::val::object();
        diagnostics.set("normalSource", record.normalSource);
        diagnostics.set("normalRepairCount", record.normalRepairCount);
        diagnostics.set("normalFallbackCount", record.normalFallbackCount);
        diagnostics.set("postRepairLowDotCount", record.postRepairLowDotCount);
        return diagnostics;
    }

    static bool _BuildPointBasedPayloadRecordFromPrim(
        UsdPrim const& prim,
        std::string const& primType,
        UsdTimeCode const& timeCode,
        GfMatrix4d const& worldMatrix,
        WebRenderDelegate::ProtoDataBlobRecord* outRecord) {
        if (!outRecord || !prim) return false;
        *outRecord = WebRenderDelegate::ProtoDataBlobRecord();

        VtVec3fArray authoredPoints;
        const UsdGeomPointBased pointBased(prim);
        if (!pointBased || !pointBased.GetPointsAttr().Get(&authoredPoints, timeCode)
            || authoredPoints.empty()) {
            return false;
        }

        auto appendPoint = [&](GfVec3f const& point) {
            outRecord->points.push_back(point[0]);
            outRecord->points.push_back(point[1]);
            outRecord->points.push_back(point[2]);
        };
        auto appendSegment = [&](GfVec3f const& left, GfVec3f const& right) {
            appendPoint(left);
            appendPoint(right);
        };

        if (primType == "points") {
            outRecord->points.reserve(authoredPoints.size() * 3);
            for (GfVec3f const& point : authoredPoints) {
                appendPoint(point);
            }
        } else {
            const UsdGeomBasisCurves curves(prim);
            VtIntArray curveVertexCounts;
            if (!curves || !curves.GetCurveVertexCountsAttr().Get(&curveVertexCounts, timeCode)
                || curveVertexCounts.empty()) {
                return false;
            }

            TfToken typeToken = UsdGeomTokens->linear;
            TfToken basisToken = UsdGeomTokens->bezier;
            TfToken wrapToken = UsdGeomTokens->nonperiodic;
            curves.GetTypeAttr().Get(&typeToken, timeCode);
            curves.GetBasisAttr().Get(&basisToken, timeCode);
            curves.GetWrapAttr().Get(&wrapToken, timeCode);
            const std::string curveType = _ToLowerAscii(typeToken.GetString());
            const std::string basis = _ToLowerAscii(basisToken.GetString());
            const std::string wrap = _ToLowerAscii(wrapToken.GetString());
            constexpr int kCurveSubdivisions = 12;
            size_t pointOffset = 0;

            auto evaluateCubic = [&](std::array<GfVec3f, 4> const& controls, float t) {
                const float t2 = t * t;
                const float t3 = t2 * t;
                std::array<float, 4> weights;
                if (basis == "bspline") {
                    weights = {
                        std::pow(1.0f - t, 3.0f) / 6.0f,
                        (3.0f * t3 - 6.0f * t2 + 4.0f) / 6.0f,
                        (-3.0f * t3 + 3.0f * t2 + 3.0f * t + 1.0f) / 6.0f,
                        t3 / 6.0f,
                    };
                } else if (basis == "catmullrom" || basis == "centripetalcatmullrom") {
                    weights = {
                        (-t3 + 2.0f * t2 - t) / 2.0f,
                        (3.0f * t3 - 5.0f * t2 + 2.0f) / 2.0f,
                        (-3.0f * t3 + 4.0f * t2 + t) / 2.0f,
                        (t3 - t2) / 2.0f,
                    };
                } else {
                    const float oneMinusT = 1.0f - t;
                    weights = {
                        oneMinusT * oneMinusT * oneMinusT,
                        3.0f * oneMinusT * oneMinusT * t,
                        3.0f * oneMinusT * t2,
                        t3,
                    };
                }
                GfVec3f result(0.0f);
                for (size_t index = 0; index < controls.size(); ++index) {
                    result += controls[index] * weights[index];
                }
                return result;
            };

            for (int authoredCount : curveVertexCounts) {
                const size_t count = authoredCount > 0 ? static_cast<size_t>(authoredCount) : 0;
                if (count == 0 || pointOffset + count > authoredPoints.size()) {
                    pointOffset += count;
                    continue;
                }

                auto pointAt = [&](size_t index) -> GfVec3f const& {
                    return authoredPoints[pointOffset + (index % count)];
                };
                if (curveType != "cubic") {
                    if (wrap == "segmented") {
                        for (size_t index = 0; index + 1 < count; index += 2) {
                            appendSegment(pointAt(index), pointAt(index + 1));
                        }
                    } else {
                        for (size_t index = 0; index + 1 < count; ++index) {
                            appendSegment(pointAt(index), pointAt(index + 1));
                        }
                        if (wrap == "periodic" && count > 2) {
                            appendSegment(pointAt(count - 1), pointAt(0));
                        }
                    }
                    pointOffset += count;
                    continue;
                }

                const bool periodic = wrap == "periodic";
                const size_t segmentCount = basis == "bezier"
                    ? (periodic ? count / 3 : (count > 0 ? (count - 1) / 3 : 0))
                    : (periodic ? count : (count >= 4 ? count - 3 : 0));
                for (size_t segment = 0; segment < segmentCount; ++segment) {
                    const size_t start = basis == "bezier" ? segment * 3 : segment;
                    const std::array<GfVec3f, 4> controls = {
                        pointAt(start), pointAt(start + 1), pointAt(start + 2), pointAt(start + 3),
                    };
                    for (int step = 0; step < kCurveSubdivisions; ++step) {
                        const float leftT = static_cast<float>(step) / kCurveSubdivisions;
                        const float rightT = static_cast<float>(step + 1) / kCurveSubdivisions;
                        appendSegment(
                            evaluateCubic(controls, leftT),
                            evaluateCubic(controls, rightT));
                    }
                }
                pointOffset += count;
            }
        }

        if (outRecord->points.empty()) return false;
        _Matrix4dToFloat16(worldMatrix, &outRecord->transform);
        outRecord->materialId = _ResolveBoundMaterialId(prim);
        if (outRecord->materialId.empty()) {
            outRecord->materialId = _ResolveDisplayColorMaterialId(prim, timeCode);
        }
        outRecord->numVertices = static_cast<int>(outRecord->points.size() / 3);
        outRecord->numIndices = 0;
        outRecord->numNormals = 0;
        outRecord->numUVs = 0;
        outRecord->normalsDimension = 0;
        outRecord->uvDimension = 0;
        outRecord->renderReady = true;
        outRecord->topologyMode = "nonIndexed";
        outRecord->valid = outRecord->numVertices > 0;
        return outRecord->valid;
    }

    bool _BuildSnapshotPrimOverrideDataFromPrim(
        UsdPrim const& prim,
        std::string const& primPath,
        UsdTimeCode const& timeCode,
        UsdGeomXformCache* xformCache,
        SnapshotPrimOverrideData* out,
        WebRenderDelegate::ProtoDataBlobRecord const* reusableMeshPayload = nullptr) const {
        if (!out) return false;
        *out = SnapshotPrimOverrideData();
        if (!prim || primPath.empty() || !xformCache) return false;

        const std::string primType = _GetSupportedPrimTypeName(prim);
        if (primType.empty()) return false;

        uint32_t dirtyMask = (
            kFinalStageDirtyGeometryDescriptor
            | kFinalStageDirtyWorldTransform
            | kFinalStageDirtyResolvedPrimPath);
        const GfMatrix4d worldMatrix = xformCache->GetLocalToWorldTransform(prim);

        out->valid = true;
        out->resolvedPrimPath = primPath;
        out->primType = primType;
        out->materialId = _ResolveBoundMaterialId(prim);
        if (out->materialId.empty()) {
            out->materialId = _ResolveDisplayColorMaterialId(prim, timeCode);
        }
        out->worldTransform = worldMatrix;

        if (primType == "mesh") {
            if (reusableMeshPayload
                && reusableMeshPayload->valid
                && reusableMeshPayload->numVertices > 0) {
                out->hasMeshPayload = true;
                out->meshPayload = *reusableMeshPayload;
                _Matrix4dToFloat16(worldMatrix, &out->meshPayload.transform);
                if (out->meshPayload.materialId.empty()) {
                    out->meshPayload.materialId = out->materialId;
                }
            } else {
                WebRenderDelegate::ProtoDataBlobRecord meshPayloadRecord;
                const bool includeTextureCoordinates =
                    _PrimMaterialBindingsUseTextureCoordinates(prim, timeCode, out->materialId);
                if (_BuildMeshPayloadRecordFromPrim(
                        prim,
                        timeCode,
                        worldMatrix,
                        includeTextureCoordinates,
                        &meshPayloadRecord)) {
                    out->hasMeshPayload = true;
                    out->meshPayload = std::move(meshPayloadRecord);
                }
            }
        } else if (primType == "points" || primType == "basiscurves") {
            WebRenderDelegate::ProtoDataBlobRecord pointBasedPayloadRecord;
            if (!_BuildPointBasedPayloadRecordFromPrim(
                  prim,
                  primType,
                  timeCode,
                  worldMatrix,
                  &pointBasedPayloadRecord)) {
                return false;
            }
            out->hasMeshPayload = true;
            out->meshPayload = std::move(pointBasedPayloadRecord);
        }

        if (_TryReadExtentSize(prim, timeCode, &out->extentSize)) {
            out->hasExtentSize = true;
            dirtyMask |= kFinalStageDirtyExtent;
        }

        if (primType == "cube") {
            if (_TryReadDoubleAttr(prim, "size", timeCode, &out->size)) {
                out->hasSize = true;
                dirtyMask |= kFinalStageDirtyPrimitiveParams;
            }
        } else if (primType == "sphere" || primType == "cylinder" || primType == "capsule") {
            if (_TryReadDoubleAttr(prim, "radius", timeCode, &out->radius)) {
                out->hasRadius = true;
                dirtyMask |= kFinalStageDirtyPrimitiveParams;
            }
            if (primType == "cylinder" || primType == "capsule") {
                if (_TryReadDoubleAttr(prim, "height", timeCode, &out->height)) {
                    out->hasHeight = true;
                    dirtyMask |= kFinalStageDirtyPrimitiveParams;
                }
                out->axis = _ReadGeomAxisToken(prim, timeCode);
                dirtyMask |= kFinalStageDirtyPrimitiveParams;
            }
        }

        out->dirtyMask = dirtyMask;
        return out->valid;
    }

    bool _BuildCollisionSnapshotOverride(
        std::string const& meshId,
        UsdTimeCode const& timeCode,
        UsdGeomXformCache* xformCache,
        SnapshotPrimOverrideData* out,
        CollisionCandidateMap const* candidateMap = nullptr,
        WebRenderDelegate::ProtoDataBlobRecord const* reusableMeshPayload = nullptr) const {
        if (!out) return false;
        *out = SnapshotPrimOverrideData();
        if (!_stage || !xformCache) return false;

        const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(meshId);
        if (!proto.valid || proto.sectionName != "collisions") return false;

        UsdPrim resolvedPrim;
        std::string resolvedPrimPath;
        std::string ignoredResolvedPrimType;
        if (!_ResolveCollisionProtoPrim(
                proto,
                &resolvedPrim,
                &resolvedPrimPath,
                &ignoredResolvedPrimType,
                candidateMap)) {
            return false;
        }

        if (!_BuildSnapshotPrimOverrideDataFromPrim(
                resolvedPrim,
                resolvedPrimPath,
                timeCode,
                xformCache,
                out,
                reusableMeshPayload)) {
            return false;
        }

        return out->valid;
    }

    bool _BuildVisualSnapshotOverride(
        std::string const& meshId,
        UsdTimeCode const& timeCode,
        UsdGeomXformCache* xformCache,
        SnapshotPrimOverrideData* out,
        VisualCandidateMap const* candidateMap = nullptr,
        WebRenderDelegate::ProtoDataBlobRecord const* reusableMeshPayload = nullptr) const {
        if (!out) return false;
        *out = SnapshotPrimOverrideData();
        if (!_stage || !xformCache) return false;

        const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(meshId);
        if (!proto.valid || proto.sectionName != "visuals") return false;

        UsdPrim resolvedPrim;
        std::string resolvedPrimPath;
        std::string ignoredResolvedPrimType;
        if (!_ResolveVisualProtoPrim(
                proto,
                &resolvedPrim,
                &resolvedPrimPath,
                &ignoredResolvedPrimType,
                candidateMap)) {
            return false;
        }

        if (!_BuildSnapshotPrimOverrideDataFromPrim(
                resolvedPrim,
                resolvedPrimPath,
                timeCode,
                xformCache,
                out,
                reusableMeshPayload)) {
            return false;
        }

        return out->valid;
    }

    emscripten::val _BuildCollisionProtoOverride(
        std::string const& meshId,
        UsdTimeCode const& timeCode,
        UsdGeomXformCache* xformCache,
        CollisionCandidateMap const* candidateMap = nullptr) const {
        emscripten::val out = emscripten::val::object();
        out.set("valid", false);
        if (!_stage || !xformCache) return out;

        SnapshotPrimOverrideData nativeOverride;
        if (!_BuildCollisionSnapshotOverride(
                meshId,
                timeCode,
                xformCache,
                &nativeOverride,
                candidateMap)) {
            return out;
        }

        out = _BuildPrimOverrideDataFromPrim(
            _stage->GetPrimAtPath(SdfPath(nativeOverride.resolvedPrimPath)),
            nativeOverride.resolvedPrimPath,
            timeCode,
            xformCache);
        out.set("meshId", meshId);
        if (nativeOverride.hasMeshPayload) {
            try {
                emscripten::val payload = out["meshPayload"];
                if (!payload.isUndefined() && !payload.isNull()) {
                    if (!nativeOverride.meshPayload.materialId.empty()) {
                        payload.set("materialId", nativeOverride.meshPayload.materialId);
                    }
                    if (!nativeOverride.meshPayload.geomSubsetSections.empty()) {
                        emscripten::val sections = _GeomSubsetSectionsToJsArray(
                            nativeOverride.meshPayload.geomSubsetSections);
                        payload.set("geomSubsetSections", sections);
                        out.set("geomSubsetSections", sections);
                    }
                }
            } catch (...) {
            }
        }
        return out;
    }

    emscripten::val _BuildVisualProtoOverride(
        std::string const& meshId,
        UsdTimeCode const& timeCode,
        UsdGeomXformCache* xformCache,
        VisualCandidateMap const* candidateMap = nullptr) const {
        emscripten::val out = emscripten::val::object();
        out.set("valid", false);
        if (!_stage || !xformCache) return out;

        SnapshotPrimOverrideData nativeOverride;
        if (!_BuildVisualSnapshotOverride(
                meshId,
                timeCode,
                xformCache,
                &nativeOverride,
                candidateMap)) {
            return out;
        }

        out = _BuildPrimOverrideDataFromPrim(
            _stage->GetPrimAtPath(SdfPath(nativeOverride.resolvedPrimPath)),
            nativeOverride.resolvedPrimPath,
            timeCode,
            xformCache);
        out.set("meshId", meshId);
        if (nativeOverride.hasMeshPayload) {
            try {
                emscripten::val payload = out["meshPayload"];
                if (!payload.isUndefined() && !payload.isNull()) {
                    if (!nativeOverride.meshPayload.materialId.empty()) {
                        payload.set("materialId", nativeOverride.meshPayload.materialId);
                    }
                    if (!nativeOverride.meshPayload.geomSubsetSections.empty()) {
                        emscripten::val sections = _GeomSubsetSectionsToJsArray(
                            nativeOverride.meshPayload.geomSubsetSections);
                        payload.set("geomSubsetSections", sections);
                        out.set("geomSubsetSections", sections);
                    }
                }
            } catch (...) {
            }
        }
        return out;
    }

    emscripten::val _BuildPrimOverrideDataFromPrim(
        UsdPrim const& prim,
        std::string const& primPath,
        UsdTimeCode const& timeCode,
        UsdGeomXformCache* xformCache) const {
        emscripten::val out = emscripten::val::object();
        out.set("valid", false);
        SnapshotPrimOverrideData nativeOverride;
        if (!_BuildSnapshotPrimOverrideDataFromPrim(
                prim,
                primPath,
                timeCode,
                xformCache,
                &nativeOverride)) {
            return out;
        }

        out.set("valid", true);
        out.set("resolvedPrimPath", nativeOverride.resolvedPrimPath);
        out.set("primType", nativeOverride.primType);
        out.set("worldTransform", _Matrix4dToJsArray(nativeOverride.worldTransform));

        if (nativeOverride.hasMeshPayload) {
            emscripten::val payload = emscripten::val::object();
            {
                std::lock_guard<std::mutex> lock(_primOverrideMeshPayloadMutex);
                WebRenderDelegate::ProtoDataBlobRecord& cached = _primOverrideMeshPayloadCache[primPath];
                cached = std::move(nativeOverride.meshPayload);
                payload = _ProtoDataBlobRecordToJsVal(cached);
                if (!cached.geomSubsetSections.empty()) {
                    out.set("geomSubsetSections", _GeomSubsetSectionsToJsArray(cached.geomSubsetSections));
                }
            }

            out.set("meshPayload", payload);
            // Keep flattened fields for compatibility with existing blob readers.
            out.set("numVertices", payload["numVertices"]);
            out.set("numIndices", payload["numIndices"]);
            out.set("numUVs", payload["numUVs"]);
            out.set("uvDimension", payload["uvDimension"]);
            out.set("numNormals", payload["numNormals"]);
            out.set("normalsDimension", payload["normalsDimension"]);
            out.set("renderReady", payload["renderReady"]);
            out.set("topologyMode", payload["topologyMode"]);
            out.set("uvSource", payload["uvSource"]);
            out.set("normalSource", payload["normalSource"]);
            out.set("normalRepairCount", payload["normalRepairCount"]);
            out.set("normalFallbackCount", payload["normalFallbackCount"]);
            out.set("postRepairLowDotCount", payload["postRepairLowDotCount"]);
            out.set("pointsPtr", payload["pointsPtr"]);
            out.set("indicesPtr", payload["indicesPtr"]);
            out.set("uvPtr", payload["uvPtr"]);
            out.set("normalsPtr", payload["normalsPtr"]);
            out.set("transformPtr", payload["transformPtr"]);
            out.set("transform", payload["transform"]);
        }

        if (nativeOverride.hasExtentSize) {
            out.set("extentSize", _Vec3ToJsArray(nativeOverride.extentSize));
        }

        if (nativeOverride.hasSize) {
            out.set("size", nativeOverride.size);
        }
        if (nativeOverride.hasRadius) {
            out.set("radius", nativeOverride.radius);
        }
        if (nativeOverride.hasHeight) {
            out.set("height", nativeOverride.height);
        }
        if (!nativeOverride.axis.empty()) {
            out.set("axis", nativeOverride.axis);
        }

        out.set("dirtyMask", static_cast<double>(nativeOverride.dirtyMask));
        return out;
    }

    void _CollectPrimTransformsRecursive(
        UsdPrim const& prim,
        GfMatrix4d const& parentWorldMatrix,
        UsdTimeCode const& timeCode,
        std::vector<std::string>* primPaths,
        std::vector<float>* worldValues,
        std::vector<float>* localValues) {
        if (!prim) return;

        GfMatrix4d localMatrix(1.0);
        bool resetsXformStack = false;
        const UsdGeomXformable xformable(prim);
        if (xformable) {
            xformable.GetLocalTransformation(&localMatrix, &resetsXformStack, timeCode);
        }

        const GfMatrix4d worldMatrix = resetsXformStack
            ? localMatrix
            : (parentWorldMatrix * localMatrix);
        const std::string primPath = prim.GetPath().GetString();
        if (!primPath.empty()) {
            if (primPaths) {
                primPaths->push_back(primPath);
            }
            _AppendMatrix4dRowMajor(localValues, localMatrix);
            _AppendMatrix4dRowMajor(worldValues, worldMatrix);
        }

        for (UsdPrim const& child : prim.GetChildren()) {
            _CollectPrimTransformsRecursive(
                child,
                worldMatrix,
                timeCode,
                primPaths,
                worldValues,
                localValues);
        }
    }

    static bool _StageRequiresSkinningBake(UsdStageRefPtr const& stage) {
        if (!stage) return false;

        for (UsdPrim const& prim : stage->Traverse()) {
            if (!prim) continue;
            if (prim.IsA<UsdSkelRoot>()
                || prim.IsA<UsdSkelSkeleton>()
                || prim.HasAPI<UsdSkelBindingAPI>()) {
                return true;
            }
        }

        return false;
    }

    void _Init(UsdStageRefPtr const& usdStage,
               HdRprimCollection const &collection,
               SdfPath const &delegateId,
               TfTokenVector const &renderTags,
               bool skipHydraPopulateForRobotSceneSnapshot = false) {
        DriverInitProfile initProfile;
        const double initStartedAtMs = _NowSteadyMs();
        initProfile.stageOpenMs = _lastStageOpenMs;
        initProfile.hydraPopulateSkipped = skipHydraPopulateForRobotSceneSnapshot;

        const double renderIndexStartedAtMs = _NowSteadyMs();
        _renderIndex = HdRenderIndex::New(&_renderDelegate, HdDriverVector());
        TF_VERIFY(_renderIndex != nullptr);
        initProfile.renderIndexCreateMs =
            _NowSteadyMs() - renderIndexStartedAtMs;

        const double delegateCreateStartedAtMs = _NowSteadyMs();
        _delegate = new UsdImagingDelegate(_renderIndex, delegateId);
        initProfile.delegateCreateMs =
            _NowSteadyMs() - delegateCreateStartedAtMs;

        const double stageAssignStartedAtMs = _NowSteadyMs();
        _stage = usdStage;
        initProfile.stageAssignMs = _NowSteadyMs() - stageAssignStartedAtMs;

        const double clearProtoCacheStartedAtMs = _NowSteadyMs();
        {
            std::lock_guard<std::mutex> lock(_primOverrideMeshPayloadMutex);
            _primOverrideMeshPayloadCache.clear();
        }
        _materialTextureUsageCache.clear();
        initProfile.clearProtoCacheMs =
            _NowSteadyMs() - clearProtoCacheStartedAtMs;

        if (skipHydraPopulateForRobotSceneSnapshot) {
            initProfile.stageHasSkinning = false;
            initProfile.bakeSkinningSkipped = true;
        } else {
            const double skinningDetectStartedAtMs = _NowSteadyMs();
            initProfile.stageHasSkinning = _StageRequiresSkinningBake(_stage);
            initProfile.skinningDetectMs =
                _NowSteadyMs() - skinningDetectStartedAtMs;

            const double bakeSkinningStartedAtMs = _NowSteadyMs();
            if (initProfile.stageHasSkinning) {
                UsdSkelBakeSkinning(_stage->Traverse());
            } else {
                initProfile.bakeSkinningSkipped = true;
            }
            initProfile.bakeSkinningMs =
                _NowSteadyMs() - bakeSkinningStartedAtMs;
        }
        initProfile.stageSaveSkipped = true;

        if (!skipHydraPopulateForRobotSceneSnapshot) {
            const double populateStartedAtMs = _NowSteadyMs();
            _delegate->Populate(_stage->GetPseudoRoot());
            initProfile.populateMs = _NowSteadyMs() - populateStartedAtMs;
        }

        const double geometryPassStartedAtMs = _NowSteadyMs();
        _geometryPass = HdRenderPassSharedPtr(
                       new Hd_UnitTestNullRenderPass(_renderIndex, collection));
        initProfile.geometryPassMs =
            _NowSteadyMs() - geometryPassStartedAtMs;

        const double renderTagsStartedAtMs = _NowSteadyMs();
        _renderTags = renderTags;
        initProfile.renderTagsMs = _NowSteadyMs() - renderTagsStartedAtMs;
        initProfile.totalMs = _NowSteadyMs() - initStartedAtMs;
        _lastInitProfile = initProfile;
    }

    static bool _ReadJsBooleanOption(
        emscripten::val const& object,
        char const* key,
        bool fallback = false) {
        try {
            if (object.isUndefined() || object.isNull() || !key || !*key) {
                return fallback;
            }
            emscripten::val value = object[key];
            if (value.isUndefined() || value.isNull()) {
                return fallback;
            }

            const std::string typeName = value.typeOf().as<std::string>();
            if (typeName == "boolean") {
                return value.as<bool>();
            }
            if (typeName == "number") {
                return value.as<double>() != 0.0;
            }
            if (typeName == "string") {
                std::string normalized = TfStringTrim(value.as<std::string>());
                std::transform(
                    normalized.begin(),
                    normalized.end(),
                    normalized.begin(),
                    [](unsigned char c) {
                        return static_cast<char>(std::tolower(c));
                    });
                if (normalized == "1"
                    || normalized == "true"
                    || normalized == "yes"
                    || normalized == "on") {
                    return true;
                }
                if (normalized == "0"
                    || normalized == "false"
                    || normalized == "no"
                    || normalized == "off") {
                    return false;
                }
            }
        } catch (...) {
        }
        return fallback;
    }

    static bool _ShouldSkipSensorPayloadsOnOpen(
        emscripten::val const& renderDelegateInterface) {
        try {
            if (renderDelegateInterface.isUndefined()
                || renderDelegateInterface.isNull()) {
                return false;
            }
            emscripten::val config = renderDelegateInterface["config"];
            return _ReadJsBooleanOption(config, "skipSensorPayloadsOnOpen", false);
        } catch (...) {
            return false;
        }
    }

    UsdStageRefPtr _OpenStageForPathWithProfile(
        emscripten::val const& renderDelegateInterface,
        std::string const& usdFilePath) {
        const double stageOpenStartedAtMs = _NowSteadyMs();
        UsdStageRefPtr stage = _OpenStageForPath(renderDelegateInterface, usdFilePath);
        _lastStageOpenMs = _NowSteadyMs() - stageOpenStartedAtMs;
        return stage;
    }

    static bool _ShouldSkipHydraPopulateForRobotSceneSnapshot(
        emscripten::val const& renderDelegateInterface) {
        try {
            if (renderDelegateInterface.isUndefined()
                || renderDelegateInterface.isNull()) {
                return false;
            }
            emscripten::val config = renderDelegateInterface["config"];
            return _ReadJsBooleanOption(
                config,
                "skipHydraPopulateForRobotSceneSnapshot",
                false);
        } catch (...) {
            return false;
        }
    }

    static bool _IsSkippableSensorPayloadPrim(UsdPrim const& prim) {
        if (!prim || !prim.HasPayload()) {
            return false;
        }

        const SdfPath primPath = prim.GetPath();
        const std::string pathText = primPath.GetString();
        if (pathText.find("{Sensor=Sensors}") != std::string::npos) {
            return true;
        }

        try {
            const std::string selection =
                prim.GetVariantSets().GetVariantSelection("Sensor");
            return selection == "Sensors";
        } catch (...) {
            return false;
        }
    }

    static UsdStageRefPtr _OpenStageForPath(
        emscripten::val const& renderDelegateInterface,
        std::string const& usdFilePath) {
        if (!_ShouldSkipSensorPayloadsOnOpen(renderDelegateInterface)) {
            return UsdStage::Open(usdFilePath);
        }

        UsdStageRefPtr stage = UsdStage::Open(usdFilePath, UsdStage::LoadNone);
        if (!stage) {
            return stage;
        }

        SdfPathSet loadSet;
        for (UsdPrim const& prim : stage->Traverse()) {
            if (!prim || !prim.HasPayload()) {
                continue;
            }
            if (_IsSkippableSensorPayloadPrim(prim)) {
                continue;
            }
            loadSet.insert(prim.GetPath());
        }

        try {
            if (!loadSet.empty()) {
                stage->LoadAndUnload(loadSet, SdfPathSet(), UsdLoadWithDescendants);
            }
        } catch (...) {
            return UsdStage::Open(usdFilePath);
        }
        return stage;
    }
};

PXR_NAMESPACE_CLOSE_SCOPE

#endif //PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_TESTDRIVER_H
