#ifndef HD_EMSCRIPTEN_MDL_PRESET_STAGE_H
#define HD_EMSCRIPTEN_MDL_PRESET_STAGE_H

#include "mdlPresetDefaults.h"
#include "pxr/pxr.h"
#include "pxr/usd/ar/asset.h"
#include "pxr/usd/ar/resolver.h"
#include "pxr/usd/sdf/assetPath.h"
#include "pxr/usd/usd/editContext.h"
#include "pxr/usd/usd/primRange.h"
#include "pxr/usd/usd/stage.h"
#include "pxr/usd/usdShade/shader.h"
#include "pxr/base/gf/vec2f.h"
#include "pxr/base/gf/vec3f.h"
#include <set>

PXR_NAMESPACE_OPEN_SCOPE
namespace HdMdlPresetStage {
struct ShaderPreset {
    HdMdlPreset::Preset preset;
    std::string sourceAsset;
    std::set<std::string> defaultedInputs;
    std::vector<std::string> unsupportedInputs;
};
using ShaderPresets = std::map<std::string, ShaderPreset>;

inline SdfValueTypeName Type(HdMdlPreset::Value const& value, std::string const& name) {
    switch (value.kind) {
    case HdMdlPreset::Value::Boolean: return SdfValueTypeNames->Bool;
    case HdMdlPreset::Value::Float2: return SdfValueTypeNames->Float2;
    case HdMdlPreset::Value::Color: return SdfValueTypeNames->Color3f;
    case HdMdlPreset::Value::Texture: return SdfValueTypeNames->Asset;
    default: return name == "uv_space_index" ? SdfValueTypeNames->Int : SdfValueTypeNames->Float;
    }
}
inline bool Set(UsdAttribute const& attr, HdMdlPreset::Value const& value, std::string const& name, std::string const& mdlPath) {
    switch (value.kind) {
    case HdMdlPreset::Value::Boolean: return attr.Set(value.boolean);
    case HdMdlPreset::Value::Float2: return attr.Set(GfVec2f(value.numbers[0], value.numbers[1]));
    case HdMdlPreset::Value::Color: return attr.Set(GfVec3f(value.numbers[0], value.numbers[1], value.numbers[2]));
    case HdMdlPreset::Value::Texture: {
        // An MDL resource is anchored to its module, not the USD layer or session.
        const std::string path = value.assetPath.empty() ? std::string()
            : ArGetResolver().CreateIdentifier(value.assetPath, ArResolvedPath(mdlPath));
        return attr.Set(SdfAssetPath(path));
    }
    default: return name == "uv_space_index" ? attr.Set(static_cast<int>(value.numbers[0])) : attr.Set(static_cast<float>(value.numbers[0]));
    }
}
inline ShaderPresets Apply(UsdStageRefPtr const& stage) {
    ShaderPresets results;
    if (!stage) return results;
    std::map<std::pair<std::string, std::string>, HdMdlPreset::Preset> cache;
    UsdEditContext context(stage, stage->GetSessionLayer());
    for (UsdPrim const& prim : stage->Traverse()) {
        if (!prim.IsA<UsdShadeShader>()) continue;
        SdfAssetPath source;
        if (!prim.GetAttribute(TfToken("info:mdl:sourceAsset")).Get(&source)) continue;
        const UsdAttribute identifierAttr = prim.GetAttribute(TfToken("info:mdl:sourceAsset:subIdentifier"));
        std::string identifier;
        TfToken identifierToken;
        if (identifierAttr.Get(&identifierToken)) identifier = identifierToken.GetString();
        else if (!identifierAttr.Get(&identifier)) continue;
        if (identifier.empty()) continue;
        ShaderPreset state;
        state.sourceAsset = source.GetResolvedPath();
        if (state.sourceAsset.empty()) {
            state.preset.subIdentifier = identifier;
            state.preset.unsupportedReason = "unresolved MDL source asset";
        } else {
            const auto key = std::make_pair(state.sourceAsset, identifier);
            auto found = cache.find(key);
            if (found == cache.end()) {
                HdMdlPreset::Preset parsed;
                parsed.subIdentifier = identifier;
                const std::shared_ptr<ArAsset> asset = ArGetResolver().OpenAsset(ArResolvedPath(state.sourceAsset));
                if (!asset || asset->GetSize() > 1024 * 1024) parsed.unsupportedReason = "MDL asset unavailable or exceeds 1 MiB";
                else {
                    const auto buffer = asset->GetBuffer();
                    if (buffer) parsed = HdMdlPreset::Parse(std::string(buffer.get(), asset->GetSize()), identifier);
                    else parsed.unsupportedReason = "MDL asset buffer unavailable";
                }
                found = cache.emplace(key, std::move(parsed)).first;
            }
            state.preset = found->second;
        }
        if (state.preset.Supported()) {
            for (auto const& entry : state.preset.inputs) {
                const std::string& name = entry.first;
                UsdAttribute attr = prim.GetAttribute(TfToken("inputs:" + name));
                // Empty assets, blocks, time samples, and even explicitly empty
                // connections are authored opinions. Never replace them with defaults.
                if (attr && (attr.HasAuthoredValueOpinion() || attr.HasAuthoredConnections())) continue;
                const SdfValueTypeName type = Type(entry.second, name);
                if ((attr && attr.GetTypeName() != type) || prim.IsInstanceProxy() || prim.IsInPrototype()) {
                    state.unsupportedInputs.push_back(name + ": incompatible or uneditable input"); continue;
                }
                if (!attr) attr = prim.CreateAttribute(TfToken("inputs:" + name), type, false);
                if (attr && Set(attr, entry.second, name, state.sourceAsset)) state.defaultedInputs.insert(name);
                else state.unsupportedInputs.push_back(name + ": default authoring failed");
            }
        }
        results.emplace(prim.GetPath().GetString(), std::move(state));
    }
    return results;
}
}  // namespace HdMdlPresetStage
PXR_NAMESPACE_CLOSE_SCOPE
#endif
