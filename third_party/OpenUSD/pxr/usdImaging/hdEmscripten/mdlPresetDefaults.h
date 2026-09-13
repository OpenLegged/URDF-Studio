#ifndef HD_EMSCRIPTEN_MDL_PRESET_DEFAULTS_H
#define HD_EMSCRIPTEN_MDL_PRESET_DEFAULTS_H

#include <array>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <map>
#include <limits>
#include <string>
#include <utility>
#include <vector>

// Deliberately not an MDL evaluator. Only literal arguments in a forwarding
// material preset are accepted; expressions/functions/import execution fail closed.
namespace HdMdlPreset {
struct Value {
    enum Kind { Number, Boolean, Float2, Color, Texture } kind = Number;
    std::array<double, 3> numbers = {{0, 0, 0}};
    bool boolean = false;
    std::string assetPath;
    std::string sourceColorSpace = "auto";
};
// USD colorSpace metadata has priority over a preset texture's gamma.
// Unknown color-management spaces require an explicit unsupported diagnostic.
inline bool ResolveTextureColorSpace(std::string token, std::string* result) {
    for (char& c : token) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (token.empty() || token == "auto") { *result = "auto"; return true; }
    if (token == "raw") { *result = "raw"; return true; }
    if (token == "srgb") { *result = "sRGB"; return true; }
    return false;
}
struct Preset {
    std::string family;
    std::string subIdentifier;
    std::map<std::string, Value> inputs;
    std::string unsupportedReason;
    bool Supported() const { return !family.empty() && unsupportedReason.empty(); }
};
namespace detail {
struct Token { std::string text; bool quoted = false; };
class Parser {
public:
    Parser(std::string const& text, std::string const& identifier) : _identifier(identifier) {
        if (text.size() > 1024 * 1024) { _error = "preset exceeds 1 MiB"; return; }
        for (size_t i = 0; i < text.size();) {
            const unsigned char c = static_cast<unsigned char>(text[i]);
            if (std::isspace(c)) { ++i; continue; }
            if (text.compare(i, 2, "//") == 0) {
                const size_t end = text.find('\n', i + 2); i = end == std::string::npos ? text.size() : end; continue;
            }
            if (text.compare(i, 2, "/*") == 0) {
                const size_t end = text.find("*/", i + 2);
                if (end == std::string::npos) { _error = "unterminated comment"; return; }
                i = end + 2; continue;
            }
            if (c == '"') {
                std::string value; bool closed = false; ++i;
                while (i < text.size()) {
                    char next = text[i++];
                    if (next == '"') { closed = true; break; }
                    if (next == '\\') {
                        if (i == text.size()) break;
                        next = text[i++];
                        if (next != '\\' && next != '"') { _error = "unsupported string escape"; return; }
                    }
                    if (static_cast<unsigned char>(next) < 32) { _error = "control character in resource"; return; }
                    value.push_back(next);
                }
                if (!closed) { _error = "unterminated string"; return; }
                _tokens.push_back({value, true});
            } else if (std::isalpha(c) || c == '_') {
                const size_t start = i++;
                while (i < text.size() && (std::isalnum(static_cast<unsigned char>(text[i])) || text[i] == '_')) ++i;
                _tokens.push_back({text.substr(start, i - start), false});
            } else if (std::isdigit(c) || (c == '.' && i + 1 < text.size() && std::isdigit(static_cast<unsigned char>(text[i + 1])))) {
                const size_t start = i++;
                while (i < text.size() && (std::isdigit(static_cast<unsigned char>(text[i])) || text[i] == '.')) ++i;
                if (i < text.size() && (text[i] == 'e' || text[i] == 'E')) {
                    ++i; if (i < text.size() && (text[i] == '+' || text[i] == '-')) ++i;
                    while (i < text.size() && std::isdigit(static_cast<unsigned char>(text[i]))) ++i;
                }
                if (i < text.size() && (text[i] == 'f' || text[i] == 'F' || text[i] == 'd' || text[i] == 'D')) ++i;
                _tokens.push_back({text.substr(start, i - start), false});
            } else if (text.compare(i, 2, "::") == 0 || text.compare(i, 2, "..") == 0) {
                _tokens.push_back({text.substr(i, 2), false}); i += 2;
            } else { _tokens.push_back({text.substr(i++, 1), false}); }
            if (_tokens.size() > 16384) { _error = "too many preset tokens"; return; }
        }
    }
    Preset Parse() {
        Preset result; result.subIdentifier = _identifier;
        if (!_error.empty()) return Fail(result, _error);
        if (!Take("mdl")) return Fail(result, "missing MDL version");
        double version = 0;
        if (!Number(&version) || !Take(";")) return Fail(result, "invalid MDL version");
        std::map<std::string, std::string> imports;
        while (Peek("using") || Peek("import")) {
            const bool usingImport = Take("using");
            if (!usingImport) Take("import");
            std::string path;
            while (_position < _tokens.size() && !Peek(usingImport ? "import" : ";")) {
                if (_tokens[_position].quoted) return Fail(result, "unsupported import path");
                path += _tokens[_position++].text;
            }
            if (usingImport) {
                if (!Take("import") || _position >= _tokens.size()) return Fail(result, "invalid import");
                const std::string symbol = _tokens[_position++].text;
                if (symbol == "OmniPBR" && path == "::OmniPBR") imports[symbol] = "OmniPBR";
                if (symbol == "GlassWithVolume" && path == "..::Templates::GlassWithVolume") imports[symbol] = "GlassWithVolume";
            }
            if (!Take(";")) return Fail(result, "unsupported import declaration");
        }
        if (!Take("export") || !Take("material") || !Take(_identifier)
            || !Take("(") || !Take("*") || !Take(")") || !Take("="))
            return Fail(result, "expected selected forwarding material (*)");
        if (_position == _tokens.size() || _tokens[_position].quoted) return Fail(result, "missing preset family");
        const auto family = imports.find(_tokens[_position++].text);
        if (family == imports.end()) return Fail(result, "unsupported preset family or import");
        result.family = family->second;
        if (!Take("(")) return Fail(result, "expected literal named arguments");
        while (!Peek(")")) {
            if (_position == _tokens.size()) return Fail(result, "unterminated preset arguments");
            const Token name = _tokens[_position++];
            if (name.quoted || !IsIdentifier(name.text) || !Take(":")) return Fail(result, "expected named argument");
            Value value;
            if (!Literal(&value)) return Fail(result, "unsupported expression for " + name.text);
            if (result.inputs.size() >= 128) return Fail(result, "too many preset inputs");
            if (name.text == "uv_space_index" && (value.kind != Value::Number || value.numbers[0] < 0
                || value.numbers[0] > std::numeric_limits<int>::max() || std::floor(value.numbers[0]) != value.numbers[0]))
                return Fail(result, "invalid integer uv_space_index");
            if (!result.inputs.emplace(name.text, value).second) return Fail(result, "duplicate argument " + name.text);
            if (!Take(",")) break;
        }
        if (!Take(")") || !Take(";") || _position != _tokens.size()) return Fail(result, "unsupported trailing declaration/expression");
        return result;
    }
private:
    static Preset Fail(Preset result, std::string const& reason) {
        result.inputs.clear(); result.unsupportedReason = reason; return result;
    }
    static bool IsIdentifier(std::string const& value) {
        if (value.empty() || !(std::isalpha(static_cast<unsigned char>(value[0])) || value[0] == '_')) return false;
        for (char c : value) if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '_')) return false;
        return true;
    }
    bool Peek(std::string const& value) const { return _position < _tokens.size() && !_tokens[_position].quoted && _tokens[_position].text == value; }
    bool Take(std::string const& value) { if (!Peek(value)) return false; ++_position; return true; }
    bool Number(double* result) {
        const size_t before = _position;
        const bool negative = Take("-"); if (!negative) Take("+");
        if (_position == _tokens.size() || _tokens[_position].quoted) { _position = before; return false; }
        std::string value = _tokens[_position].text;
        if (value.empty() || !(std::isdigit(static_cast<unsigned char>(value[0])) || value[0] == '.')) { _position = before; return false; }
        if (value.back() == 'f' || value.back() == 'F' || value.back() == 'd' || value.back() == 'D') value.pop_back();
        char* end = nullptr; const double number = std::strtod(value.c_str(), &end);
        if (!end || *end || !std::isfinite(number) || std::abs(number) > std::numeric_limits<float>::max()) { _position = before; return false; }
        ++_position; *result = negative ? -number : number; return true;
    }
    bool Literal(Value* value) {
        if (Take("true")) { value->kind = Value::Boolean; value->boolean = true; return true; }
        if (Take("false")) { value->kind = Value::Boolean; value->boolean = false; return true; }
        if (Number(&value->numbers[0])) return true;
        const bool color = Take("color");
        if (color || Take("float2")) {
            value->kind = color ? Value::Color : Value::Float2;
            if (!Take("(") || !Number(&value->numbers[0])) return false;
            value->numbers[1] = value->numbers[2] = value->numbers[0];
            if (Take(",")) {
                if (!Number(&value->numbers[1])) return false;
                if (color && (!Take(",") || !Number(&value->numbers[2]))) return false;
            }
            return Take(")");
        }
        if (!Take("texture_2d") || !Take("(")) return false;
        value->kind = Value::Texture;
        if (Take(")")) return true;
        if (_position == _tokens.size() || !_tokens[_position].quoted) return false;
        value->assetPath = _tokens[_position++].text;
        if (Take(",")) {
            if (!Take("::") || !Take("tex") || !Take("::") || _position == _tokens.size()) return false;
            const std::string gamma = _tokens[_position++].text;
            if (gamma == "gamma_srgb") value->sourceColorSpace = "sRGB";
            else if (gamma == "gamma_linear") value->sourceColorSpace = "raw";
            else if (gamma != "gamma_default") return false;
        }
        return Take(")");
    }
    std::vector<Token> _tokens;
    size_t _position = 0;
    std::string _identifier, _error;
};
}  // namespace detail
inline Preset Parse(std::string const& text, std::string const& subIdentifier) {
    return detail::Parser(text, subIdentifier).Parse();
}
}  // namespace HdMdlPreset
#endif
