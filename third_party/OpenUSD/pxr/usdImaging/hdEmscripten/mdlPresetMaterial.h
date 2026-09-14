#ifndef HD_EMSCRIPTEN_MDL_PRESET_MATERIAL_H
#define HD_EMSCRIPTEN_MDL_PRESET_MATERIAL_H
#include "mdlPresetDefaults.h"
#include <set>

namespace HdMdlPreset {
struct TextureInput {
    std::string parameter;
    Value value;
    std::string sourceOutput = "rgb";
    std::array<double, 4> sampleScale = {{1, 1, 1, 1}};
    std::array<double, 4> sampleBias = {{0, 0, 0, 0}};
};
// MDL uses column-major constructors. OmniPBR's helper returns S * R,
// with clockwise Z rotation, followed by the authored translation.
inline std::array<double, 9> TextureUvTransform(Preset const& effective) {
    auto vec2 = [&](char const* name, std::array<double, 2> fallback) {
        auto value = effective.inputs.find(name);
        return value != effective.inputs.end() && value->second.kind == Value::Float2
            ? std::array<double, 2>{{value->second.numbers[0], value->second.numbers[1]}} : fallback;
    };
    const auto scale = vec2("texture_scale", {{1, 1}}), translation = vec2("texture_translate", {{0, 0}});
    auto rotation = effective.inputs.find("texture_rotate");
    const double radians = rotation != effective.inputs.end() && rotation->second.kind == Value::Number
        ? rotation->second.numbers[0] * std::acos(-1.0) / 180.0 : 0;
    const double c = std::cos(radians), sn = std::sin(radians);
    return {{scale[0] * c, -scale[1] * sn, 0, scale[0] * sn, scale[1] * c, 0, translation[0], translation[1], 1}};
}
struct Material {
    std::map<std::string, Value> fields;
    std::map<std::string, TextureInput> textures;
    std::vector<std::string> unsupportedInputs;
};
inline Value Scalar(double number) { Value value; value.numbers[0] = number; return value; }
inline Value ColorValue(std::array<double, 3> const& numbers) { Value value; value.kind = Value::Color; value.numbers = numbers; return value; }

// This mapping implements the literal preset subset against NVIDIA's OmniPBR
// and GlassWithVolume templates. Unsupported lobes/expressions are diagnostics,
// not silently interpreted as a different MDL material family.
inline Material ResolveMaterial(Preset const& effective) {
    Material material;
    if (!effective.Supported()) { material.unsupportedInputs.push_back(effective.unsupportedReason); return material; }
    auto number = [&](char const* name, double fallback) {
        auto found = effective.inputs.find(name);
        return found != effective.inputs.end() && found->second.kind == Value::Number ? found->second.numbers[0] : fallback;
    };
    auto boolean = [&](char const* name, bool fallback) {
        auto found = effective.inputs.find(name);
        return found != effective.inputs.end() && found->second.kind == Value::Boolean ? found->second.boolean : fallback;
    };
    auto color = [&](char const* name, std::array<double, 3> fallback) {
        auto found = effective.inputs.find(name);
        return found != effective.inputs.end() && found->second.kind == Value::Color ? found->second.numbers : fallback;
    };
    auto texture = [&](char const* name) {
        auto found = effective.inputs.find(name);
        return found != effective.inputs.end() && found->second.kind == Value::Texture && !found->second.assetPath.empty();
    };
    auto addTexture = [&](char const* slot, char const* name, char const* output = "rgb") {
        if (!texture(name)) return false;
        TextureInput input; input.parameter = name; input.value = effective.inputs.at(name); input.sourceOutput = output;
        material.textures[slot] = input; return true;
    };
    const std::set<std::string> omniInputs = {
        "diffuse_color_constant", "diffuse_texture", "albedo_desaturation", "albedo_add", "albedo_brightness", "diffuse_tint",
        "reflection_roughness_constant", "reflection_roughness_texture_influence", "reflectionroughness_texture", "metallic_constant",
        "metallic_texture_influence", "metallic_texture", "specular_level", "enable_ORM_texture", "ORM_texture", "ao_to_diffuse", "ao_texture",
        "enable_emission", "emissive_color", "emissive_mask_texture", "emissive_intensity", "bump_factor", "normalmap_texture",
        "detail_bump_factor", "detail_normalmap_texture", "project_uvw", "world_or_object", "uv_space_index", "texture_translate",
        "texture_rotate", "texture_scale", "detail_texture_translate", "detail_texture_rotate", "detail_texture_scale", "flip_tangent_u", "flip_tangent_v"
    };
    const std::set<std::string> glassInputs = {"thin_walled", "transmission_color", "roughness_texture", "ior", "transmission_color_texture",
        "roughness_texture_influence", "roughness", "reflection_color_texture", "reflection_color", "depth", "normal_map_texture"};
    auto const& supportedInputs = effective.family == "OmniPBR" ? omniInputs : glassInputs;
    for (auto const& input : effective.inputs)
        if (!supportedInputs.count(input.first)) material.unsupportedInputs.push_back(input.first + ": unsupported preset parameter");
    if (effective.family == "OmniPBR") {
        material.fields["opacity"] = Scalar(1);
        material.fields["transmission"] = Scalar(0);
        material.fields["thickness"] = Scalar(0);
        const auto constant = color("diffuse_color_constant", {{.2, .2, .2}});
        const auto tint = color("diffuse_tint", {{1, 1, 1}});
        auto base = constant;
        const bool hasDiffuse = texture("diffuse_texture");
        if (hasDiffuse && number("albedo_desaturation", 0) != 0)
            material.unsupportedInputs.push_back("albedo_desaturation: nonzero texture desaturation");
        if (hasDiffuse && number("albedo_desaturation", 0) == 0) {
            base = {{1, 1, 1}};
            addTexture("mapPath", "diffuse_texture");
            auto& input = material.textures["mapPath"];
            const double brightness = number("albedo_brightness", 1), offset = number("albedo_add", 0);
            input.sampleScale = {{brightness * tint[0], brightness * tint[1], brightness * tint[2], 1}};
            input.sampleBias = {{offset * tint[0], offset * tint[1], offset * tint[2], 0}};
        }
        if (material.textures.count("mapPath") == 0)
            for (size_t i = 0; i < 3; ++i) base[i] *= tint[i];
        material.fields["color"] = ColorValue(base);
        // OmniPBRBase custom_curve_layer: F0=.08 and F90=1,
        // both weighted by specular_level. Preserve both Schlick endpoints.
        const double normalReflectivity = std::sqrt(.08);
        material.fields["ior"] = Scalar((1 + normalReflectivity) / (1 - normalReflectivity));
        material.fields["specularIntensity"] = Scalar(number("specular_level", .5));
        material.fields["specularColor"] = ColorValue({{1, 1, 1}});
        const bool orm = boolean("enable_ORM_texture", false);
        auto mixMap = [&](char const* field, char const* slot, char const* constantName, char const* influenceName,
                          char const* textureName, char const* channel, double fallback) {
            const double constantValue = number(constantName, fallback), influence = number(influenceName, 0);
            material.fields[field] = Scalar(constantValue);
            if (influence == 0) return;
            if (influence != 1) { material.unsupportedInputs.push_back(std::string(influenceName) + ": non-endpoint mix"); return; }
            if (!orm || !texture("ORM_texture")) {
                material.unsupportedInputs.push_back(std::string(textureName) + ": missing ORM or unsupported separate red-channel map"); return;
            }
            addTexture(slot, "ORM_texture", channel);
            material.fields[field] = Scalar(1);
        };
        mixMap("roughness", "roughnessMapPath", "reflection_roughness_constant", "reflection_roughness_texture_influence", "reflectionroughness_texture", "g", .5);
        mixMap("metalness", "metalnessMapPath", "metallic_constant", "metallic_texture_influence", "metallic_texture", "b", 0);
        // OmniPBR modulates base_color; Three's AO slot only changes indirect
        // illumination. A nonzero weight is not the same shader operation.
        material.fields["aoMapIntensity"] = Scalar(0);
        if (number("ao_to_diffuse", 0) != 0) {
            material.unsupportedInputs.push_back("ao_to_diffuse: base-color AO modulation is not supported");
        } else if (orm) addTexture("aoMapPath", "ORM_texture", "r");
        else addTexture("aoMapPath", "ao_texture", "r");
        if (addTexture("normalMapPath", "normalmap_texture")) {
            const double bump = number("bump_factor", 1);
            Value normalScale; normalScale.kind = Value::Float2;
            normalScale.numbers = {{bump * (boolean("flip_tangent_u", false) ? -1 : 1), bump * (boolean("flip_tangent_v", true) ? -1 : 1), 0}};
            material.fields["normalScale"] = normalScale;
        }
        if (texture("detail_normalmap_texture")) material.unsupportedInputs.push_back("detail_normalmap_texture: layered normal mapping");
        if (boolean("project_uvw", false) || number("uv_space_index", 0) != 0)
            material.unsupportedInputs.push_back("project_uvw/uv_space_index: unsupported coordinates");
        if (boolean("enable_emission", false)) material.unsupportedInputs.push_back("enable_emission: emission BSDF mapping not supported");
        if (!boolean("enable_emission", false)) {
            material.fields["emissive"] = ColorValue({{0, 0, 0}});
            material.fields["emissiveIntensity"] = Scalar(0);
        }
    } else if (effective.family == "GlassWithVolume") {
        if (!boolean("thin_walled", false)) {
            material.unsupportedInputs.push_back("thin_walled: volume BSDF mapping not supported"); return material;
        }
        material.fields["color"] = ColorValue(color("transmission_color", {{1, 1, 1}}));
        material.fields["specularColor"] = ColorValue(color("reflection_color", {{1, 1, 1}}));
        material.fields["specularIntensity"] = Scalar(1);
        material.fields["roughness"] = Scalar(number("roughness", 0));
        material.fields["ior"] = Scalar(number("ior", 1.52));
        material.fields["transmission"] = Scalar(1);
        material.fields["opacity"] = Scalar(1);
        material.fields["metalness"] = Scalar(0);
        // depth controls volume absorption in this template, not wall thickness.
        material.fields["thickness"] = Scalar(0);
        for (char const* name : {"roughness_texture", "transmission_color_texture", "reflection_color_texture", "normal_map_texture"})
            if (texture(name)) material.unsupportedInputs.push_back(std::string(name) + ": glass texture BSDF mapping not supported");
    }
    return material;
}
}  // namespace HdMdlPreset
#endif
