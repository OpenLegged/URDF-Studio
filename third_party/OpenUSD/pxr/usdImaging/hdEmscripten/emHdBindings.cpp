#include "pxr/pxr.h"

#include "webSyncDriver.h"

#include <emscripten/bind.h>
using namespace emscripten;

std::shared_ptr<pxr::HdWebSyncDriver> CreateFromStage(emscripten::val renderDelegateInterface, pxr::UsdStageRefPtr const& stage) {
  std::shared_ptr<pxr::HdWebSyncDriver> result(new pxr::HdWebSyncDriver(renderDelegateInterface, stage));

  return result;
}

EMSCRIPTEN_BINDINGS(test_usd_imaging_emscripten) {
  class_<pxr::HdWebSyncDriver>("HdWebSyncDriver")
    .constructor<emscripten::val, std::string>()
    .class_function("CreateFromStage", &CreateFromStage)
    .function("Draw", &pxr::HdWebSyncDriver::Draw)
    .function("getFile", &pxr::HdWebSyncDriver::getFile)
    .function("GetStage", &pxr::HdWebSyncDriver::GetStage)
    .function("GetPrimPathSet", &pxr::HdWebSyncDriver::GetPrimPathSet)
    .function("GetPhysicsJointRecords", &pxr::HdWebSyncDriver::GetPhysicsJointRecords)
    .function("GetPhysicsLinkDynamicsRecords", &pxr::HdWebSyncDriver::GetPhysicsLinkDynamicsRecords)
    .function("GetRootLayerText", &pxr::HdWebSyncDriver::GetRootLayerText)
    .function("GetRobotMetadataSnapshot", &pxr::HdWebSyncDriver::GetRobotMetadataSnapshot)
    .function("GetLastInitProfile", &pxr::HdWebSyncDriver::GetLastInitProfile)
    .function("GetMaterialBindingRepairProfile", &pxr::HdWebSyncDriver::GetMaterialBindingRepairProfile)
    .function(
      "GetLastRobotSceneSnapshotProfile",
      &pxr::HdWebSyncDriver::GetLastRobotSceneSnapshotProfile)
    .function(
      "GetRobotSceneSnapshot",
      optional_override([](pxr::HdWebSyncDriver& self, emscripten::val runtimeLinkPaths, std::string const& stageSourcePath) {
        return self.GetRobotSceneSnapshot(runtimeLinkPaths, stageSourcePath);
      }))
    .function(
      "GetRobotSceneSnapshotBlob",
      optional_override([](pxr::HdWebSyncDriver& self, emscripten::val runtimeLinkPaths, std::string const& stageSourcePath) {
        return self.GetRobotSceneSnapshotBlob(runtimeLinkPaths, stageSourcePath);
      }))
    .function(
      "GetFullLoadPayload",
      optional_override([](pxr::HdWebSyncDriver& self, emscripten::val runtimeLinkPaths, std::string const& stageSourcePath, emscripten::val options) {
        return self.GetFullLoadPayload(runtimeLinkPaths, stageSourcePath, options);
      }))
    .function("ExportLoadedStageSnapshot", &pxr::HdWebSyncDriver::ExportLoadedStageSnapshot)
    .function("GetPrimTransforms", &pxr::HdWebSyncDriver::GetPrimTransforms)
    .function("GetProtoDataBlob", &pxr::HdWebSyncDriver::GetProtoDataBlob)
    .function("GetAllProtoDataBlobs", &pxr::HdWebSyncDriver::GetAllProtoDataBlobs)
    .function("GetCollisionProtoOverride", &pxr::HdWebSyncDriver::GetCollisionProtoOverride)
    .function("GetCollisionProtoOverrides", &pxr::HdWebSyncDriver::GetCollisionProtoOverrides)
    .function("GetVisualProtoOverride", &pxr::HdWebSyncDriver::GetVisualProtoOverride)
    .function("GetVisualProtoOverrides", &pxr::HdWebSyncDriver::GetVisualProtoOverrides)
    .function("GetProtoMeshOverrides", &pxr::HdWebSyncDriver::GetProtoMeshOverrides)
    .function("GetRprimDeltaBatch", &pxr::HdWebSyncDriver::GetRprimDeltaBatch)
    .function("GetFinalStageOverrideBatch", &pxr::HdWebSyncDriver::GetFinalStageOverrideBatch)
    .function("GetPrimOverrideData", &pxr::HdWebSyncDriver::GetPrimOverrideData)
    .function("GetPrimOverrideDataMap", &pxr::HdWebSyncDriver::GetPrimOverrideDataMap)
    .function("SetPreferProtoBlobOverHydraPayload", &pxr::HdWebSyncDriver::SetPreferProtoBlobOverHydraPayload)
    .function("GetPreferProtoBlobOverHydraPayload", &pxr::HdWebSyncDriver::GetPreferProtoBlobOverHydraPayload)
    .function("SetPreferDirectStageRobotSceneSnapshot", &pxr::HdWebSyncDriver::SetPreferDirectStageRobotSceneSnapshot)
    .function("GetPreferDirectStageRobotSceneSnapshot", &pxr::HdWebSyncDriver::GetPreferDirectStageRobotSceneSnapshot)
    .function("SetTime", &pxr::HdWebSyncDriver::SetTime)
    .function("GetTime", &pxr::HdWebSyncDriver::GetTime)
    .smart_ptr<std::shared_ptr<pxr::HdWebSyncDriver>>("std::shared_ptr<pxr::HdWebSyncDriver>")
    ;

  register_vector<int>("VectorInt");
  register_vector<double>("VectorDouble");
}
