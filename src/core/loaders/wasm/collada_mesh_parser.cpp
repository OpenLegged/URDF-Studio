#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

struct Input {
  std::string semantic;
  std::string source;
  uint32_t offset = 0;
  uint32_t set = 0;
};

struct Source;

enum class ResolvedInputKind : uint8_t {
  Position,
  Normal,
  Texcoord0,
  Texcoord1,
  Color,
  Vertex,
};

struct ResolvedInput {
  ResolvedInputKind kind = ResolvedInputKind::Position;
  uint32_t offset = 0;
  uint32_t itemSize = 0;
  const Source* source = nullptr;
  std::vector<ResolvedInput> vertexInputs;
};

struct Source {
  std::vector<float> values;
  uint32_t stride = 1;
};

struct Material {
  std::string name;
  std::string model = "phong";
  std::string diffuseTexture;
  std::string normalTexture;
  std::string specularTexture;
  std::string emissiveTexture;
  std::string lightTexture;
  float r = 1.0f;
  float g = 1.0f;
  float b = 1.0f;
  float a = 1.0f;
  float specularR = 0.066625f;
  float specularG = 0.066625f;
  float specularB = 0.066625f;
  float emissiveR = 0.0f;
  float emissiveG = 0.0f;
  float emissiveB = 0.0f;
  float shininess = 30.0f;
  bool doubleSided = false;
  bool transparent = false;
};

struct Group {
  uint32_t start = 0;
  uint32_t count = 0;
  uint32_t materialIndex = 0;
};

struct Geometry {
  std::string id;
  std::string name;
  std::string primitiveKind = "mesh";
  std::vector<float> positions;
  std::vector<float> normals;
  std::vector<float> uvs;
  std::vector<float> uv1s;
  std::vector<float> colors;
  bool hasNormals = false;
  bool hasUvs = false;
  bool hasUv1s = false;
  bool hasColors = false;
  uint32_t uvItemSize = 2;
  uint32_t uv1ItemSize = 2;
  uint32_t colorItemSize = 3;
  std::vector<std::string> materialSymbols;
  std::unordered_map<std::string, uint32_t> materialIndexBySymbol;
  std::vector<Group> groups;
};

struct Node {
  std::string name;
  std::string geometryId;
  std::vector<std::string> geometryIds;
  float matrix[16] = {
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  };
  std::unordered_map<std::string, std::string> materialTargetBySymbol;
};

struct XmlBlock {
  const char* start = nullptr;
  const char* end = nullptr;
};

struct ParseState {
  float unitScale = 1.0f;
  std::unordered_map<std::string, std::string> imagePathById;
  std::unordered_map<std::string, Material> materialsById;
  std::unordered_map<std::string, Geometry> geometriesById;
  std::unordered_map<std::string, std::vector<std::string>> geometryIdsBySourceId;
  std::unordered_map<std::string, XmlBlock> libraryNodesById;
  std::vector<Node> nodes;
};

std::string errorMessage;

struct BinaryWriter {
  uint8_t* data = nullptr;
  uint32_t size = 0;
  uint32_t capacity = 0;
  bool failed = false;

  explicit BinaryWriter(uint32_t initialCapacity = 0) {
    if (initialCapacity > 0) {
      reserve(initialCapacity);
    }
  }

  ~BinaryWriter() {
    if (data != nullptr) {
      std::free(data);
    }
  }

  bool reserve(uint32_t nextCapacity) {
    if (failed || nextCapacity <= capacity) {
      return !failed;
    }

    void* nextData = std::realloc(data, nextCapacity);
    if (nextData == nullptr) {
      failed = true;
      errorMessage = "Failed to allocate Collada parser result buffer.";
      return false;
    }

    data = static_cast<uint8_t*>(nextData);
    capacity = nextCapacity;
    return true;
  }

  bool ensure(uint32_t extraBytes) {
    if (failed) {
      return false;
    }
    if (extraBytes > std::numeric_limits<uint32_t>::max() - size) {
      failed = true;
      errorMessage = "Collada parser result buffer exceeds supported size.";
      return false;
    }

    const uint32_t required = size + extraBytes;
    if (required <= capacity) {
      return true;
    }

    uint32_t nextCapacity = capacity == 0 ? 4096u : capacity;
    while (nextCapacity < required) {
      if (nextCapacity > std::numeric_limits<uint32_t>::max() / 2u) {
        nextCapacity = required;
        break;
      }
      nextCapacity *= 2u;
    }
    return reserve(nextCapacity);
  }

  void append(const void* source, uint32_t byteLength) {
    if (!ensure(byteLength)) {
      return;
    }
    std::memcpy(data + size, source, byteLength);
    size += byteLength;
  }

  void align4() {
    while ((size & 3u) != 0u) {
      u8(0);
    }
  }

  void u8(uint8_t value) {
    append(&value, 1);
  }

  void u32(uint32_t value) {
    const uint8_t raw[4] = {
      static_cast<uint8_t>(value & 0xffu),
      static_cast<uint8_t>((value >> 8u) & 0xffu),
      static_cast<uint8_t>((value >> 16u) & 0xffu),
      static_cast<uint8_t>((value >> 24u) & 0xffu),
    };
    append(raw, sizeof(raw));
  }

  void f32(float value) {
    align4();
    const auto* raw = reinterpret_cast<const uint8_t*>(&value);
    append(raw, sizeof(float));
  }

  void string(const std::string& value) {
    u32(static_cast<uint32_t>(value.size()));
    append(value.data(), static_cast<uint32_t>(value.size()));
  }

  void floatArray(const std::vector<float>& values) {
    align4();
    const auto* raw = reinterpret_cast<const uint8_t*>(values.data());
    append(raw, static_cast<uint32_t>(values.size() * sizeof(float)));
  }

  uint8_t* release(uint32_t& releasedSize) {
    releasedSize = size;
    uint8_t* released = data;
    data = nullptr;
    size = 0;
    capacity = 0;
    return released;
  }
};

uint8_t* resultPtr = nullptr;
uint32_t resultSize = 0;

struct ColladaParserTimings {
  double featureCheckMs = 0.0;
  double upAxisMs = 0.0;
  double unitScaleMs = 0.0;
  double imagesMs = 0.0;
  double materialsMs = 0.0;
  double geometriesMs = 0.0;
  double libraryNodesMs = 0.0;
  double visualSceneMs = 0.0;
  double writeResultMs = 0.0;
};

ColladaParserTimings lastParseTimings;

double monotonicNowMs() {
  const auto now = std::chrono::steady_clock::now().time_since_epoch();
  return std::chrono::duration<double, std::milli>(now).count();
}

const char* skipWhitespace(const char* cursor, const char* end) {
  while (cursor < end && (*cursor == ' ' || *cursor == '\t' || *cursor == '\n' || *cursor == '\r')) {
    ++cursor;
  }
  return cursor;
}

bool parseFloat(const char*& cursor, const char* end, float& out) {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end) {
    return false;
  }

  double sign = 1.0;
  if (*cursor == '+' || *cursor == '-') {
    if (*cursor == '-') {
      sign = -1.0;
    }
    ++cursor;
  }

  bool hasDigits = false;
  double value = 0.0;
  while (cursor < end && *cursor >= '0' && *cursor <= '9') {
    hasDigits = true;
    value = value * 10.0 + static_cast<double>(*cursor - '0');
    ++cursor;
  }

  if (cursor < end && *cursor == '.') {
    ++cursor;
    double scale = 0.1;
    while (cursor < end && *cursor >= '0' && *cursor <= '9') {
      hasDigits = true;
      value += static_cast<double>(*cursor - '0') * scale;
      scale *= 0.1;
      ++cursor;
    }
  }

  if (!hasDigits) {
    return false;
  }

  int exponent = 0;
  int exponentSign = 1;
  if (cursor < end && (*cursor == 'e' || *cursor == 'E')) {
    const char* exponentStart = cursor;
    ++cursor;
    if (cursor < end && (*cursor == '+' || *cursor == '-')) {
      if (*cursor == '-') {
        exponentSign = -1;
      }
      ++cursor;
    }

    bool hasExponentDigits = false;
    while (cursor < end && *cursor >= '0' && *cursor <= '9') {
      hasExponentDigits = true;
      exponent = exponent * 10 + (*cursor - '0');
      ++cursor;
    }

    if (!hasExponentDigits) {
      cursor = exponentStart;
    } else if (exponent != 0) {
      value *= std::pow(10.0, static_cast<double>(exponentSign * exponent));
    }
  }

  out = static_cast<float>(sign * value);
  return true;
}

bool parseInt(const char*& cursor, const char* end, int& out) {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end) {
    return false;
  }

  int sign = 1;
  if (*cursor == '+' || *cursor == '-') {
    if (*cursor == '-') {
      sign = -1;
    }
    ++cursor;
  }

  bool hasDigits = false;
  int value = 0;
  while (cursor < end && *cursor >= '0' && *cursor <= '9') {
    hasDigits = true;
    value = value * 10 + (*cursor - '0');
    ++cursor;
  }

  if (!hasDigits) {
    return false;
  }

  out = sign * value;
  return true;
}

std::string makeString(const char* start, const char* end) {
  return start < end ? std::string(start, end) : std::string();
}

// Skip over an XML comment block (<!-- ... -->) or CDATA section
// (<![CDATA[ ... ]]>) starting at `cursor`. Returns the position right
// after the comment/CDATA end marker, or `cursor` unchanged if the input
// at `cursor` is not the start of one of these blocks.
const char* skipXmlCommentOrCdata(const char* cursor, const char* end) {
  if (cursor + 4 <= end && cursor[0] == '<' && cursor[1] == '!' &&
      cursor[2] == '-' && cursor[3] == '-') {
    const char* probe = cursor + 4;
    while (probe + 3 <= end) {
      if (probe[0] == '-' && probe[1] == '-' && probe[2] == '>') {
        return probe + 3;
      }
      ++probe;
    }
    return end;
  }

  if (cursor + 9 <= end && cursor[0] == '<' && cursor[1] == '!' &&
      cursor[2] == '[' && cursor[3] == 'C' && cursor[4] == 'D' &&
      cursor[5] == 'A' && cursor[6] == 'T' && cursor[7] == 'A' &&
      cursor[8] == '[') {
    const char* probe = cursor + 9;
    while (probe + 3 <= end) {
      if (probe[0] == ']' && probe[1] == ']' && probe[2] == '>') {
        return probe + 3;
      }
      ++probe;
    }
    return end;
  }

  return cursor;
}

const char* findText(const char* start, const char* end, const char* text) {
  const size_t length = std::strlen(text);
  if (length == 0 || start >= end) {
    return nullptr;
  }
  const char* cursor = start;
  while (cursor + length <= end) {
    if (*cursor == '<') {
      const char* afterSkip = skipXmlCommentOrCdata(cursor, end);
      if (afterSkip != cursor) {
        cursor = afterSkip;
        continue;
      }
    }
    if (std::memcmp(cursor, text, length) == 0) {
      return cursor;
    }
    ++cursor;
  }
  return nullptr;
}

const char* findChar(const char* start, const char* end, char value) {
  const char* cursor = start;
  while (cursor < end) {
    if (*cursor == '<') {
      const char* afterSkip = skipXmlCommentOrCdata(cursor, end);
      if (afterSkip != cursor) {
        cursor = afterSkip;
        continue;
      }
    }
    if (*cursor == value) {
      return cursor;
    }
    ++cursor;
  }
  return nullptr;
}

bool startsWith(const char* cursor, const char* end, const char* text) {
  const size_t length = std::strlen(text);
  return cursor + length <= end && std::memcmp(cursor, text, length) == 0;
}

bool asciiEqualsIgnoreCase(const std::string& left, const char* right) {
  const size_t rightLength = std::strlen(right);
  if (left.size() != rightLength) {
    return false;
  }
  for (size_t index = 0; index < rightLength; ++index) {
    char a = left[index];
    char b = right[index];
    if (a >= 'A' && a <= 'Z') {
      a = static_cast<char>(a + ('a' - 'A'));
    }
    if (b >= 'A' && b <= 'Z') {
      b = static_cast<char>(b + ('a' - 'A'));
    }
    if (a != b) {
      return false;
    }
  }
  return true;
}

std::string trimAsciiWhitespace(const std::string& value) {
  size_t start = 0;
  while (start < value.size() && (
    value[start] == ' ' || value[start] == '\t' || value[start] == '\n' || value[start] == '\r'
  )) {
    ++start;
  }

  size_t end = value.size();
  while (end > start && (
    value[end - 1] == ' ' || value[end - 1] == '\t' || value[end - 1] == '\n' || value[end - 1] == '\r'
  )) {
    --end;
  }

  return value.substr(start, end - start);
}

std::string readAttribute(const char* tagStart, const char* tagEnd, const char* name) {
  const size_t nameLength = std::strlen(name);
  const char* cursor = tagStart;
  while (cursor < tagEnd) {
    cursor = findText(cursor, tagEnd, name);
    if (!cursor) {
      return {};
    }

    const bool leftBoundary =
      cursor == tagStart || cursor[-1] == ' ' || cursor[-1] == '\t' || cursor[-1] == '\n' || cursor[-1] == '\r';
    const char* afterName = cursor + nameLength;
    if (leftBoundary && afterName < tagEnd && *afterName == '=') {
      const char* valueStart = afterName + 1;
      if (valueStart < tagEnd && (*valueStart == '"' || *valueStart == '\'')) {
        const char quote = *valueStart;
        ++valueStart;
        const char* valueEnd = findChar(valueStart, tagEnd, quote);
        if (valueEnd) {
          return makeString(valueStart, valueEnd);
        }
      }
    }

    cursor = afterName;
  }

  return {};
}

std::string stripFragment(const std::string& value) {
  if (!value.empty() && value[0] == '#') {
    return value.substr(1);
  }
  return value;
}

bool isSelfClosingXmlTag(const char* elementStart, const char* tagEnd) {
  const char* cursor = tagEnd;
  while (cursor > elementStart &&
         (cursor[-1] == ' ' || cursor[-1] == '\t' || cursor[-1] == '\n' || cursor[-1] == '\r')) {
    --cursor;
  }
  return cursor > elementStart && cursor[-1] == '/';
}

bool parseFirstTextElement(
  const char* start,
  const char* end,
  const char* elementName,
  std::string& out
) {
  const std::string openPattern = std::string("<") + elementName;
  const std::string closePattern = std::string("</") + elementName + ">";
  const char* elementStart = findText(start, end, openPattern.c_str());
  if (!elementStart) {
    return false;
  }
  const char* tagEnd = findChar(elementStart, end, '>');
  const char* elementEnd = tagEnd ? findText(tagEnd + 1, end, closePattern.c_str()) : nullptr;
  if (!tagEnd || !elementEnd) {
    return false;
  }
  out = trimAsciiWhitespace(makeString(tagEnd + 1, elementEnd));
  return true;
}

bool parseFirstFloatElement(
  const char* start,
  const char* end,
  const char* elementName,
  float& out
) {
  std::string text;
  if (!parseFirstTextElement(start, end, elementName, text)) {
    return false;
  }
  const char* cursor = text.data();
  const char* textEnd = cursor + text.size();
  return parseFloat(cursor, textEnd, out);
}

bool parseFirstColorElement(
  const char* start,
  const char* end,
  float& r,
  float& g,
  float& b,
  float& a
) {
  const char* colorStart = findText(start, end, "<color");
  if (!colorStart) {
    return false;
  }
  const char* colorTagEnd = findChar(colorStart, end, '>');
  const char* colorEnd = colorTagEnd ? findText(colorTagEnd + 1, end, "</color>") : nullptr;
  if (!colorTagEnd || !colorEnd) {
    return false;
  }

  std::vector<float> color;
  const char* cursor = colorTagEnd + 1;
  while (true) {
    cursor = skipWhitespace(cursor, colorEnd);
    if (cursor >= colorEnd) {
      break;
    }
    float value = 0.0f;
    if (!parseFloat(cursor, colorEnd, value)) {
      errorMessage = "Failed to parse Collada material color.";
      return false;
    }
    color.push_back(value);
  }
  if (color.size() < 3) {
    return false;
  }
  r = color[0];
  g = color[1];
  b = color[2];
  a = color.size() >= 4 ? color[3] : 1.0f;
  return true;
}

bool hasUnsupportedColladaFeature(const char* start, const char* end) {
  const char* cursor = start;
  while (cursor < end) {
    if (*cursor != '<') {
      ++cursor;
      continue;
    }

    const char* afterSkip = skipXmlCommentOrCdata(cursor, end);
    if (afterSkip != cursor) {
      cursor = afterSkip;
      continue;
    }

    const char* token = nullptr;
    if (startsWith(cursor, end, "<controller")) {
      token = "<controller";
    } else if (startsWith(cursor, end, "<instance_controller")) {
      token = "<instance_controller";
    } else if (startsWith(cursor, end, "<skin")) {
      token = "<skin";
    } else if (startsWith(cursor, end, "<morph")) {
      token = "<morph";
    }

    if (token) {
      errorMessage = std::string("Unsupported Collada feature for fast WASM parser: ") + token;
      return true;
    }

    ++cursor;
  }
  return false;
}

size_t readPositiveSizeAttribute(const char* tagStart, const char* tagEnd, const char* name) {
  const std::string text = readAttribute(tagStart, tagEnd, name);
  if (text.empty()) {
    return 0;
  }

  const char* cursor = text.data();
  const char* end = cursor + text.size();
  int value = 0;
  if (!parseInt(cursor, end, value) || value <= 0) {
    return 0;
  }

  return static_cast<size_t>(value);
}

bool findOptionalElementContentBlock(
  const char* start,
  const char* end,
  const char* openPattern,
  const char* closePattern,
  const char* elementName,
  XmlBlock& out
) {
  out = {};
  const char* elementStart = findText(start, end, openPattern);
  if (!elementStart) {
    return true;
  }

  const char* tagEnd = findChar(elementStart, end, '>');
  if (!tagEnd) {
    errorMessage = std::string("Malformed Collada ") + elementName + " tag.";
    return false;
  }

  if (isSelfClosingXmlTag(elementStart, tagEnd)) {
    out = {tagEnd, tagEnd};
    return true;
  }

  const char* elementEnd = findText(tagEnd + 1, end, closePattern);
  if (!elementEnd) {
    errorMessage = std::string("Malformed Collada ") + elementName + " block.";
    return false;
  }

  out = {tagEnd + 1, elementEnd};
  return true;
}

bool parseFloatList(
  const char* start,
  const char* end,
  std::vector<float>& out,
  size_t expectedCount = 0
) {
  if (expectedCount > 0) {
    out.reserve(out.size() + expectedCount);
  }

  const char* cursor = start;
  while (true) {
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) {
      return true;
    }
    float value = 0.0f;
    if (!parseFloat(cursor, end, value)) {
      errorMessage = "Failed to parse float list in Collada asset.";
      return false;
    }
    out.push_back(value);
  }
}

bool parseIntList(
  const char* start,
  const char* end,
  std::vector<int>& out,
  size_t expectedCount = 0
) {
  if (expectedCount > 0) {
    out.reserve(out.size() + expectedCount);
  }

  const char* cursor = start;
  while (true) {
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) {
      return true;
    }
    int value = 0;
    if (!parseInt(cursor, end, value)) {
      errorMessage = "Failed to parse integer list in Collada asset.";
      return false;
    }
    out.push_back(value);
  }
}

void setIdentityMatrix(float matrix[16]) {
  for (uint32_t index = 0; index < 16; ++index) {
    matrix[index] = 0.0f;
  }
  matrix[0] = 1.0f;
  matrix[5] = 1.0f;
  matrix[10] = 1.0f;
  matrix[15] = 1.0f;
}

void copyMatrix(const float source[16], float target[16]) {
  for (uint32_t index = 0; index < 16; ++index) {
    target[index] = source[index];
  }
}

void multiplyMatrices(const float left[16], const float right[16], float out[16]) {
  float result[16];
  for (uint32_t row = 0; row < 4; ++row) {
    for (uint32_t column = 0; column < 4; ++column) {
      float value = 0.0f;
      for (uint32_t index = 0; index < 4; ++index) {
        value += left[row * 4 + index] * right[index * 4 + column];
      }
      result[row * 4 + column] = value;
    }
  }
  copyMatrix(result, out);
}

void multiplyMatrixInPlace(float target[16], const float transform[16]) {
  multiplyMatrices(target, transform, target);
}

void makeTranslationMatrix(float x, float y, float z, float matrix[16]) {
  setIdentityMatrix(matrix);
  matrix[3] = x;
  matrix[7] = y;
  matrix[11] = z;
}

void makeScaleMatrix(float x, float y, float z, float matrix[16]) {
  setIdentityMatrix(matrix);
  matrix[0] = x;
  matrix[5] = y;
  matrix[10] = z;
}

bool makeRotationMatrix(float x, float y, float z, float angleDegrees, float matrix[16]) {
  const float length = std::sqrt(x * x + y * y + z * z);
  if (length <= std::numeric_limits<float>::epsilon()) {
    errorMessage = "Collada rotate transform has a zero-length axis.";
    return false;
  }
  x /= length;
  y /= length;
  z /= length;

  const float angle = angleDegrees * 3.14159265358979323846f / 180.0f;
  const float c = std::cos(angle);
  const float s = std::sin(angle);
  const float t = 1.0f - c;

  setIdentityMatrix(matrix);
  matrix[0] = t * x * x + c;
  matrix[1] = t * x * y - s * z;
  matrix[2] = t * x * z + s * y;
  matrix[4] = t * x * y + s * z;
  matrix[5] = t * y * y + c;
  matrix[6] = t * y * z - s * x;
  matrix[8] = t * x * z - s * y;
  matrix[9] = t * y * z + s * x;
  matrix[10] = t * z * z + c;
  return true;
}

bool parseUnitScale(const char* start, const char* end, ParseState& state) {
  const char* unitStart = findText(start, end, "<unit");
  if (!unitStart) {
    return true;
  }
  const char* unitEnd = findChar(unitStart, end, '>');
  if (!unitEnd) {
    return true;
  }
  const std::string meter = readAttribute(unitStart, unitEnd, "meter");
  if (meter.empty()) {
    return true;
  }
  const char* cursor = meter.data();
  const char* meterEnd = cursor + meter.size();
  float value = 1.0f;
  if (parseFloat(cursor, meterEnd, value) && value > 0.0f) {
    state.unitScale = value;
  }
  return true;
}

bool validateSupportedUpAxis(const char* start, const char* end) {
  const char* upAxisStart = findText(start, end, "<up_axis");
  if (!upAxisStart) {
    return true;
  }
  const char* upAxisTagEnd = findChar(upAxisStart, end, '>');
  const char* upAxisEnd = upAxisTagEnd ? findText(upAxisTagEnd, end, "</up_axis>") : nullptr;
  if (!upAxisTagEnd || !upAxisEnd) {
    errorMessage = "Malformed Collada up_axis block.";
    return false;
  }

  return true;
}

bool parseImages(const char* start, const char* end, ParseState& state) {
  const char* cursor = start;
  while ((cursor = findText(cursor, end, "<image")) != nullptr) {
    const char* tagEnd = findChar(cursor, end, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada image tag.";
      return false;
    }
    const char afterName = cursor + 6 <= tagEnd ? cursor[6] : '\0';
    if (afterName != ' ' && afterName != '\t' && afterName != '\n' && afterName != '\r' && afterName != '/' && afterName != '>') {
      cursor = tagEnd + 1;
      continue;
    }
    const std::string imageId = readAttribute(cursor, tagEnd, "id");
    if (isSelfClosingXmlTag(cursor, tagEnd)) {
      cursor = tagEnd + 1;
      continue;
    }
    const char* imageEnd = findText(tagEnd, end, "</image>");
    if (!imageEnd) {
      errorMessage = "Malformed Collada image block.";
      return false;
    }

    std::string initFrom;
    if (!imageId.empty() && parseFirstTextElement(tagEnd + 1, imageEnd, "init_from", initFrom) && !initFrom.empty()) {
      state.imagePathById[imageId] = initFrom;
    }
    cursor = imageEnd + 8;
  }
  return true;
}

std::string resolveTextureReference(
  const std::string& textureId,
  const std::unordered_map<std::string, std::string>& surfaceImageBySid,
  const std::unordered_map<std::string, std::string>& samplerSurfaceBySid,
  const ParseState& state
) {
  if (textureId.empty()) {
    return {};
  }

  auto sampler = samplerSurfaceBySid.find(textureId);
  if (sampler != samplerSurfaceBySid.end()) {
    auto surface = surfaceImageBySid.find(sampler->second);
    if (surface != surfaceImageBySid.end()) {
      auto image = state.imagePathById.find(surface->second);
      if (image != state.imagePathById.end()) {
        return image->second;
      }
      return surface->second;
    }
  }

  auto surface = surfaceImageBySid.find(textureId);
  if (surface != surfaceImageBySid.end()) {
    auto image = state.imagePathById.find(surface->second);
    if (image != state.imagePathById.end()) {
      return image->second;
    }
    return surface->second;
  }

  auto image = state.imagePathById.find(textureId);
  return image == state.imagePathById.end() ? std::string() : image->second;
}

std::string readParameterTextureUrl(
  const char* parameterStart,
  const char* parameterEnd,
  const std::unordered_map<std::string, std::string>& surfaceImageBySid,
  const std::unordered_map<std::string, std::string>& samplerSurfaceBySid,
  const ParseState& state
) {
  const char* textureStart = findText(parameterStart, parameterEnd, "<texture");
  if (!textureStart) {
    return {};
  }
  const char* textureEnd = findChar(textureStart, parameterEnd, '>');
  if (!textureEnd) {
    return {};
  }
  return resolveTextureReference(
    readAttribute(textureStart, textureEnd, "texture"),
    surfaceImageBySid,
    samplerSurfaceBySid,
    state
  );
}

bool parseEffectNewparams(
  const char* profileStart,
  const char* profileEnd,
  std::unordered_map<std::string, std::string>& surfaceImageBySid,
  std::unordered_map<std::string, std::string>& samplerSurfaceBySid
) {
  const char* cursor = profileStart;
  while ((cursor = findText(cursor, profileEnd, "<newparam")) != nullptr) {
    const char* tagEnd = findChar(cursor, profileEnd, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada effect newparam tag.";
      return false;
    }
    const std::string sid = readAttribute(cursor, tagEnd, "sid");
    const char* newparamEnd = findText(tagEnd, profileEnd, "</newparam>");
    if (!newparamEnd) {
      errorMessage = "Malformed Collada effect newparam block.";
      return false;
    }
    if (!sid.empty()) {
      const char* surfaceStart = findText(tagEnd + 1, newparamEnd, "<surface");
      if (surfaceStart) {
        const char* surfaceTagEnd = findChar(surfaceStart, newparamEnd, '>');
        const char* surfaceEnd = surfaceTagEnd ? findText(surfaceTagEnd, newparamEnd, "</surface>") : nullptr;
        std::string initFrom;
        if (surfaceEnd && parseFirstTextElement(surfaceTagEnd + 1, surfaceEnd, "init_from", initFrom) && !initFrom.empty()) {
          surfaceImageBySid[sid] = initFrom;
        }
      }

      const char* samplerStart = findText(tagEnd + 1, newparamEnd, "<sampler2D");
      if (samplerStart) {
        const char* samplerTagEnd = findChar(samplerStart, newparamEnd, '>');
        const char* samplerEnd = samplerTagEnd ? findText(samplerTagEnd, newparamEnd, "</sampler2D>") : nullptr;
        std::string source;
        if (samplerEnd && parseFirstTextElement(samplerTagEnd + 1, samplerEnd, "source", source) && !source.empty()) {
          samplerSurfaceBySid[sid] = source;
        }
      }
    }
    cursor = newparamEnd + 11;
  }
  return true;
}

const char* findMaterialParameterBlock(
  const char* start,
  const char* end,
  const char* name,
  const char** outTagEnd
) {
  const std::string openPattern = std::string("<") + name;
  const std::string closePattern = std::string("</") + name + ">";
  const char* parameterStart = findText(start, end, openPattern.c_str());
  if (!parameterStart) {
    return nullptr;
  }
  const char* tagEnd = findChar(parameterStart, end, '>');
  const char* parameterEnd = tagEnd ? findText(tagEnd + 1, end, closePattern.c_str()) : nullptr;
  if (!tagEnd || !parameterEnd) {
    return nullptr;
  }
  *outTagEnd = tagEnd;
  return parameterEnd;
}

bool parseEffectParameterColorAndTexture(
  const char* techniqueStart,
  const char* techniqueEnd,
  const char* parameterName,
  float& r,
  float& g,
  float& b,
  float& a,
  std::string& textureUrl,
  const std::unordered_map<std::string, std::string>& surfaceImageBySid,
  const std::unordered_map<std::string, std::string>& samplerSurfaceBySid,
  const ParseState& state
) {
  const char* parameterTagEnd = nullptr;
  const char* parameterEnd = findMaterialParameterBlock(techniqueStart, techniqueEnd, parameterName, &parameterTagEnd);
  if (!parameterEnd) {
    return true;
  }
  if (!parseFirstColorElement(parameterTagEnd + 1, parameterEnd, r, g, b, a) && !errorMessage.empty()) {
    return false;
  }
  textureUrl = readParameterTextureUrl(parameterTagEnd + 1, parameterEnd, surfaceImageBySid, samplerSurfaceBySid, state);
  return true;
}

bool parseTransparency(const char* techniqueStart, const char* techniqueEnd, Material& material) {
  const char* transparentStart = findText(techniqueStart, techniqueEnd, "<transparent");
  const char* transparentTagEnd = transparentStart ? findChar(transparentStart, techniqueEnd, '>') : nullptr;
  const char* transparentEnd = transparentTagEnd ? findText(transparentTagEnd + 1, techniqueEnd, "</transparent>") : nullptr;
  const char* transparencyTagEnd = nullptr;
  const char* transparencyEnd = findMaterialParameterBlock(techniqueStart, techniqueEnd, "transparency", &transparencyTagEnd);
  if (!transparentEnd && !transparencyEnd) {
    return true;
  }

  float transparency = 1.0f;
  if (transparencyEnd) {
    parseFirstFloatElement(transparencyTagEnd + 1, transparencyEnd, "float", transparency);
  }

  float r = 1.0f;
  float g = 1.0f;
  float b = 1.0f;
  float a = 1.0f;
  bool hasTransparentTexture = false;
  std::string opaque = "A_ONE";
  if (transparentEnd) {
    opaque = readAttribute(transparentStart, transparentTagEnd, "opaque");
    if (opaque.empty()) {
      opaque = "A_ONE";
    }
    hasTransparentTexture = findText(transparentTagEnd + 1, transparentEnd, "<texture") != nullptr;
    if (!parseFirstColorElement(transparentTagEnd + 1, transparentEnd, r, g, b, a) && !errorMessage.empty()) {
      return false;
    }
  }

  if (hasTransparentTexture) {
    material.transparent = true;
    return true;
  }

  float opacity = material.a;
  if (opaque == "A_ONE") {
    opacity = a * transparency;
  } else if (opaque == "RGB_ZERO") {
    opacity = 1.0f - (r * transparency);
  } else if (opaque == "A_ZERO") {
    opacity = 1.0f - (a * transparency);
  } else if (opaque == "RGB_ONE") {
    opacity = r * transparency;
  }

  if (opacity <= 0.0f) {
    opacity = 1.0f;
  }
  material.a = std::max(0.0f, std::min(1.0f, opacity));
  material.transparent = material.a < 1.0f;
  return true;
}

bool parseEffectsAndMaterials(const char* start, const char* end, ParseState& state) {
  std::unordered_map<std::string, Material> materialsByEffectId;
  XmlBlock effectsBlock;
  if (!findOptionalElementContentBlock(
        start,
        end,
        "<library_effects",
        "</library_effects>",
        "library_effects",
        effectsBlock
      )) {
    return false;
  }

  const char* effectsStart = effectsBlock.start ? effectsBlock.start : start;
  const char* effectsEnd = effectsBlock.end ? effectsBlock.end : end;
  const char* cursor = effectsStart;
  while ((cursor = findText(cursor, effectsEnd, "<effect")) != nullptr) {
    const char* tagEnd = findChar(cursor, effectsEnd, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada effect tag.";
      return false;
    }
    const std::string effectId = readAttribute(cursor, tagEnd, "id");
    const char* effectEnd = findText(tagEnd, effectsEnd, "</effect>");
    if (!effectEnd) {
      errorMessage = "Malformed Collada effect block.";
      return false;
    }

    Material material;
    std::unordered_map<std::string, std::string> surfaceImageBySid;
    std::unordered_map<std::string, std::string> samplerSurfaceBySid;
    const char* profileStart = findText(tagEnd + 1, effectEnd, "<profile_COMMON");
    const char* profileTagEnd = profileStart ? findChar(profileStart, effectEnd, '>') : nullptr;
    const char* profileEnd = profileTagEnd ? findText(profileTagEnd + 1, effectEnd, "</profile_COMMON>") : nullptr;
    if (profileStart && profileTagEnd && profileEnd) {
      if (!parseEffectNewparams(profileTagEnd + 1, profileEnd, surfaceImageBySid, samplerSurfaceBySid)) {
        return false;
      }

      const char* techniqueStart = findText(profileTagEnd + 1, profileEnd, "<technique");
      const char* techniqueTagEnd = techniqueStart ? findChar(techniqueStart, profileEnd, '>') : nullptr;
      const char* techniqueEnd = techniqueTagEnd ? findText(techniqueTagEnd + 1, profileEnd, "</technique>") : nullptr;
      if (techniqueStart && techniqueTagEnd && techniqueEnd) {
        const char* shaderStart = nullptr;
        const char* shaderTagEnd = nullptr;
        const char* shaderEnd = nullptr;
        const char* shaderNames[] = {"phong", "blinn", "lambert", "constant"};
        for (const char* shaderName : shaderNames) {
          const std::string openPattern = std::string("<") + shaderName;
          const char* candidate = findText(techniqueTagEnd + 1, techniqueEnd, openPattern.c_str());
          if (!candidate || (shaderStart && candidate >= shaderStart)) {
            continue;
          }
          const char* candidateTagEnd = findChar(candidate, techniqueEnd, '>');
          const std::string closePattern = std::string("</") + shaderName + ">";
          const char* candidateEnd = candidateTagEnd ? findText(candidateTagEnd + 1, techniqueEnd, closePattern.c_str()) : nullptr;
          if (candidateTagEnd && candidateEnd) {
            shaderStart = candidate;
            shaderTagEnd = candidateTagEnd;
            shaderEnd = candidateEnd;
            material.model = shaderName;
          }
        }

        if (shaderStart && shaderTagEnd && shaderEnd) {
          if (!parseEffectParameterColorAndTexture(
                shaderTagEnd + 1,
                shaderEnd,
                "diffuse",
                material.r,
                material.g,
                material.b,
                material.a,
                material.diffuseTexture,
                surfaceImageBySid,
                samplerSurfaceBySid,
                state
              )) {
            return false;
          }

          float ignoredAlpha = 1.0f;
          if (!parseEffectParameterColorAndTexture(
                shaderTagEnd + 1,
                shaderEnd,
                "specular",
                material.specularR,
                material.specularG,
                material.specularB,
                ignoredAlpha,
                material.specularTexture,
                surfaceImageBySid,
                samplerSurfaceBySid,
                state
              )) {
            return false;
          }

          ignoredAlpha = 1.0f;
          if (!parseEffectParameterColorAndTexture(
                shaderTagEnd + 1,
                shaderEnd,
                "emission",
                material.emissiveR,
                material.emissiveG,
                material.emissiveB,
                ignoredAlpha,
                material.emissiveTexture,
                surfaceImageBySid,
                samplerSurfaceBySid,
                state
              )) {
            return false;
          }

          float ambientR = 1.0f;
          float ambientG = 1.0f;
          float ambientB = 1.0f;
          ignoredAlpha = 1.0f;
          if (!parseEffectParameterColorAndTexture(
                shaderTagEnd + 1,
                shaderEnd,
                "ambient",
                ambientR,
                ambientG,
                ambientB,
                ignoredAlpha,
                material.lightTexture,
                surfaceImageBySid,
                samplerSurfaceBySid,
                state
              )) {
            return false;
          }

          const char* bumpTagEnd = nullptr;
          const char* bumpEnd = findMaterialParameterBlock(shaderTagEnd + 1, shaderEnd, "bump", &bumpTagEnd);
          if (bumpEnd) {
            material.normalTexture = readParameterTextureUrl(
              bumpTagEnd + 1,
              bumpEnd,
              surfaceImageBySid,
              samplerSurfaceBySid,
              state
            );
          }

          const char* shininessTagEnd = nullptr;
          const char* shininessEnd = findMaterialParameterBlock(shaderTagEnd + 1, shaderEnd, "shininess", &shininessTagEnd);
          if (shininessEnd) {
            parseFirstFloatElement(shininessTagEnd + 1, shininessEnd, "float", material.shininess);
          }

          if (!parseTransparency(shaderTagEnd + 1, shaderEnd, material)) {
            return false;
          }
        }

        const char* doubleSidedTextStart = findText(techniqueTagEnd + 1, techniqueEnd, "<double_sided");
        if (!doubleSidedTextStart) {
          doubleSidedTextStart = findText(profileTagEnd + 1, profileEnd, "<double_sided");
        }
        if (doubleSidedTextStart) {
          const char* doubleSidedTagEnd = findChar(doubleSidedTextStart, profileEnd, '>');
          const char* doubleSidedEnd = doubleSidedTagEnd ? findText(doubleSidedTagEnd + 1, profileEnd, "</double_sided>") : nullptr;
          if (doubleSidedEnd) {
            int value = 0;
            const char* valueCursor = doubleSidedTagEnd + 1;
            if (parseInt(valueCursor, doubleSidedEnd, value)) {
              material.doubleSided = value == 1;
            }
          }
        }

        const char* extraBumpTagEnd = nullptr;
        const char* extraBumpEnd = findMaterialParameterBlock(techniqueTagEnd + 1, techniqueEnd, "bump", &extraBumpTagEnd);
        if (extraBumpEnd && material.normalTexture.empty()) {
          material.normalTexture = readParameterTextureUrl(
            extraBumpTagEnd + 1,
            extraBumpEnd,
            surfaceImageBySid,
            samplerSurfaceBySid,
            state
          );
        }
      }
    }

    if (!effectId.empty()) {
      materialsByEffectId.emplace(effectId, material);
    }
    cursor = effectEnd + 9;
  }

  XmlBlock materialsBlock;
  if (!findOptionalElementContentBlock(
        start,
        end,
        "<library_materials",
        "</library_materials>",
        "library_materials",
        materialsBlock
      )) {
    return false;
  }

  const char* materialsStart = materialsBlock.start ? materialsBlock.start : start;
  const char* materialsEnd = materialsBlock.end ? materialsBlock.end : end;
  cursor = materialsStart;
  while ((cursor = findText(cursor, materialsEnd, "<material")) != nullptr) {
    const char* tagEnd = findChar(cursor, materialsEnd, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada material tag.";
      return false;
    }
    const std::string materialId = readAttribute(cursor, tagEnd, "id");
    const std::string materialName = readAttribute(cursor, tagEnd, "name");
    const char* materialEnd = findText(tagEnd, materialsEnd, "</material>");
    if (!materialEnd) {
      errorMessage = "Malformed Collada material block.";
      return false;
    }

    Material material;
    material.name = materialName;
    const char* instanceEffect = findText(tagEnd, materialEnd, "<instance_effect");
    if (instanceEffect) {
      const char* instanceEffectEnd = findChar(instanceEffect, materialEnd, '>');
      if (instanceEffectEnd) {
        const std::string effectId = stripFragment(readAttribute(instanceEffect, instanceEffectEnd, "url"));
        auto effect = materialsByEffectId.find(effectId);
        if (effect != materialsByEffectId.end()) {
          material = effect->second;
          material.name = materialName;
        }
      }
    }

    if (!materialId.empty()) {
      state.materialsById.emplace(materialId, material);
    }
    cursor = materialEnd + 11;
  }

  return true;
}

bool parseSourcesAndVertices(
  const char* meshStart,
  const char* meshEnd,
  std::unordered_map<std::string, Source>& sources,
  std::unordered_map<std::string, std::vector<Input>>& vertexInputsById
) {
  const char* cursor = meshStart;
  while ((cursor = findText(cursor, meshEnd, "<source")) != nullptr) {
    const char* tagEnd = findChar(cursor, meshEnd, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada source tag.";
      return false;
    }
    const std::string sourceId = readAttribute(cursor, tagEnd, "id");
    if (isSelfClosingXmlTag(cursor, tagEnd)) {
      cursor = tagEnd + 1;
      continue;
    }
    const char* sourceEnd = findText(tagEnd, meshEnd, "</source>");
    if (!sourceEnd) {
      errorMessage = "Malformed Collada source block.";
      return false;
    }

    Source source;
    const char* floatArray = findText(tagEnd, sourceEnd, "<float_array");
    if (!floatArray) {
      cursor = sourceEnd + 9;
      continue;
    }
    const char* floatArrayTagEnd = findChar(floatArray, sourceEnd, '>');
    const bool selfClosingFloatArray = floatArrayTagEnd && isSelfClosingXmlTag(floatArray, floatArrayTagEnd);
    const char* floatArrayEnd = floatArrayTagEnd && !selfClosingFloatArray ? findText(floatArrayTagEnd, sourceEnd, "</float_array>") : nullptr;
    const size_t floatArrayCount = floatArrayTagEnd
      ? readPositiveSizeAttribute(floatArray, floatArrayTagEnd, "count")
      : 0;
    if (!floatArrayEnd) {
      if (!selfClosingFloatArray) {
        errorMessage = "Malformed Collada float_array block.";
        return false;
      }
    } else if (!parseFloatList(floatArrayTagEnd + 1, floatArrayEnd, source.values, floatArrayCount)) {
      return false;
    }
    if (selfClosingFloatArray) {
      const std::string count = readAttribute(floatArray, floatArrayTagEnd, "count");
      if (!count.empty() && count != "0") {
        errorMessage = "Self-closing Collada float_array declares non-zero data.";
        return false;
      }
    }

    const char* accessor = findText(tagEnd, sourceEnd, "<accessor");
    if (accessor) {
      const char* accessorEnd = findChar(accessor, sourceEnd, '>');
      const std::string stride = accessorEnd ? readAttribute(accessor, accessorEnd, "stride") : "";
      if (!stride.empty()) {
        const char* strideCursor = stride.data();
        const char* strideEnd = strideCursor + stride.size();
        int strideValue = 1;
        if (parseInt(strideCursor, strideEnd, strideValue) && strideValue > 0) {
          source.stride = static_cast<uint32_t>(strideValue);
        }
      }
    }

    if (!sourceId.empty()) {
      sources.emplace(sourceId, std::move(source));
    }
    cursor = sourceEnd + 9;
  }

  cursor = meshStart;
  while ((cursor = findText(cursor, meshEnd, "<vertices")) != nullptr) {
    const char* tagEnd = findChar(cursor, meshEnd, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada vertices tag.";
      return false;
    }
    const std::string verticesId = readAttribute(cursor, tagEnd, "id");
    const char* verticesEnd = findText(tagEnd, meshEnd, "</vertices>");
    if (!verticesEnd) {
      errorMessage = "Malformed Collada vertices block.";
      return false;
    }

    std::vector<Input> vertexInputs;
    const char* input = findText(tagEnd, verticesEnd, "<input");
    while (input) {
      const char* inputEnd = findChar(input, verticesEnd, '>');
      if (!inputEnd) {
        errorMessage = "Malformed Collada vertices input.";
        return false;
      }
      Input parsed;
      parsed.semantic = readAttribute(input, inputEnd, "semantic");
      parsed.source = readAttribute(input, inputEnd, "source");
      if (parsed.semantic == "TEXCOORD") {
        const std::string texcoordSet = readAttribute(input, inputEnd, "set");
        if (!texcoordSet.empty()) {
          const char* setCursor = texcoordSet.data();
          const char* setEnd = setCursor + texcoordSet.size();
          int setValue = 0;
          if (parseInt(setCursor, setEnd, setValue) && setValue > 0) {
            parsed.set = static_cast<uint32_t>(setValue);
          }
        }
      }
      if (parsed.semantic == "POSITION" ||
          parsed.semantic == "NORMAL" ||
          parsed.semantic == "COLOR" ||
          (parsed.semantic == "TEXCOORD" && parsed.set <= 1)) {
        vertexInputs.push_back(std::move(parsed));
      }
      input = findText(inputEnd, verticesEnd, "<input");
    }
    if (!verticesId.empty() && !vertexInputs.empty()) {
      vertexInputsById[verticesId] = std::move(vertexInputs);
    }

    cursor = verticesEnd + 11;
  }

  return true;
}

uint32_t ensureGeometryMaterial(Geometry& geometry, const std::string& symbol) {
  const std::string key = symbol.empty() ? "default" : symbol;
  auto existing = geometry.materialIndexBySymbol.find(key);
  if (existing != geometry.materialIndexBySymbol.end()) {
    return existing->second;
  }
  const auto index = static_cast<uint32_t>(geometry.materialSymbols.size());
  geometry.materialSymbols.push_back(key);
  geometry.materialIndexBySymbol.emplace(key, index);
  return index;
}

void ensureGroup(Geometry& geometry, uint32_t materialIndex) {
  const uint32_t start = static_cast<uint32_t>(geometry.positions.size() / 3);
  if (!geometry.groups.empty() && geometry.groups.back().materialIndex == materialIndex) {
    return;
  }
  geometry.groups.push_back({start, 0, materialIndex});
}

void reserveGeometryVertices(Geometry& geometry, size_t additionalVertexCount) {
  if (additionalVertexCount == 0) {
    return;
  }

  geometry.positions.reserve(geometry.positions.size() + additionalVertexCount * 3u);
  if (geometry.hasNormals) {
    geometry.normals.reserve(geometry.normals.size() + additionalVertexCount * 3u);
  }
  if (geometry.hasUvs) {
    geometry.uvs.reserve(geometry.uvs.size() + additionalVertexCount * geometry.uvItemSize);
  }
  if (geometry.hasUv1s) {
    geometry.uv1s.reserve(geometry.uv1s.size() + additionalVertexCount * geometry.uv1ItemSize);
  }
  if (geometry.hasColors) {
    geometry.colors.reserve(geometry.colors.size() + additionalVertexCount * geometry.colorItemSize);
  }
}

float srgbChannelToLinear(float value) {
  if (value <= 0.04045f) {
    return value * 0.0773993808f;
  }
  return std::pow(value * 0.9478672986f + 0.0521327014f, 2.4f);
}

const Source* resolveInputSource(
  const Input& input,
  const std::unordered_map<std::string, Source>& sources
) {
  std::string sourceId = stripFragment(input.source);
  auto source = sources.find(sourceId);
  return source == sources.end() ? nullptr : &source->second;
}

const Source* resolveInputSourceReference(
  const std::string& sourceReference,
  const std::unordered_map<std::string, Source>& sources
) {
  std::string sourceId = stripFragment(sourceReference);
  auto source = sources.find(sourceId);
  return source == sources.end() ? nullptr : &source->second;
}

const std::vector<Input>* resolveVertexInputs(
  const Input& input,
  const std::unordered_map<std::string, std::vector<Input>>& vertexInputsById
) {
  const std::string verticesId = stripFragment(input.source);
  auto vertexInputs = vertexInputsById.find(verticesId);
  if (vertexInputs != vertexInputsById.end()) {
    return &vertexInputs->second;
  }

  const size_t slash = verticesId.find_last_of('/');
  if (slash != std::string::npos && slash + 1 < verticesId.size()) {
    vertexInputs = vertexInputsById.find(verticesId.substr(slash + 1));
    if (vertexInputs != vertexInputsById.end()) {
      return &vertexInputs->second;
    }
  }

  return nullptr;
}

bool resolveAttributeInput(
  const Input& input,
  const std::unordered_map<std::string, Source>& sources,
  ResolvedInput& out
) {
  out.offset = input.offset;
  out.source = resolveInputSourceReference(input.source, sources);
  if (!out.source) {
    errorMessage = "Collada primitive input references an unknown source.";
    return false;
  }

  if (input.semantic == "POSITION") {
    out.kind = ResolvedInputKind::Position;
    out.itemSize = 3;
    return true;
  }

  if (input.semantic == "NORMAL") {
    out.kind = ResolvedInputKind::Normal;
    out.itemSize = 3;
    return true;
  }

  if (input.semantic == "TEXCOORD") {
    out.kind = input.set == 0 ? ResolvedInputKind::Texcoord0 : ResolvedInputKind::Texcoord1;
    out.itemSize = out.source->stride > 0 ? out.source->stride : 2;
    return true;
  }

  if (input.semantic == "COLOR") {
    out.kind = ResolvedInputKind::Color;
    out.itemSize = out.source->stride > 0 ? out.source->stride : 3;
    return true;
  }

  errorMessage = "Collada primitive input has an unsupported semantic.";
  return false;
}

bool resolvePrimitiveInputs(
  const std::vector<Input>& inputs,
  const std::unordered_map<std::string, Source>& sources,
  const std::unordered_map<std::string, std::vector<Input>>& vertexInputsById,
  std::vector<ResolvedInput>& out
) {
  out.clear();
  out.reserve(inputs.size());

  for (const Input& input : inputs) {
    ResolvedInput resolved;
    resolved.offset = input.offset;

    if (input.semantic == "VERTEX") {
      const std::vector<Input>* vertexInputs = resolveVertexInputs(input, vertexInputsById);
      if (!vertexInputs) {
        errorMessage = "Collada vertices input references an unknown source.";
        return false;
      }

      resolved.kind = ResolvedInputKind::Vertex;
      resolved.vertexInputs.reserve(vertexInputs->size());
      for (const Input& vertexInput : *vertexInputs) {
        ResolvedInput resolvedVertexInput;
        if (!resolveAttributeInput(vertexInput, sources, resolvedVertexInput)) {
          return false;
        }
        resolved.vertexInputs.push_back(std::move(resolvedVertexInput));
      }
      out.push_back(std::move(resolved));
      continue;
    }

    if (!resolveAttributeInput(input, sources, resolved)) {
      return false;
    }
    out.push_back(std::move(resolved));
  }

  return true;
}

bool appendAttribute(
  const Source& source,
  int sourceIndex,
  uint32_t itemSize,
  std::vector<float>& target,
  bool convertSrgbToLinear = false
) {
  if (sourceIndex < 0) {
    errorMessage = "Collada primitive contains a negative source index.";
    return false;
  }
  const auto start = static_cast<size_t>(sourceIndex) * source.stride;
  if (start + itemSize > source.values.size()) {
    errorMessage = "Collada primitive references a source index outside the available range.";
    return false;
  }
  for (uint32_t index = 0; index < itemSize; ++index) {
    const float value = source.values[start + index];
    target.push_back(convertSrgbToLinear && index < 3 ? srgbChannelToLinear(value) : value);
  }
  return true;
}

bool appendResolvedInputAttribute(
  Geometry& geometry,
  const Input& input,
  const Source& source,
  int sourceIndex,
  bool& wrotePosition,
  bool& wroteNormal,
  bool& wroteUv,
  bool& wroteUv1,
  bool& wroteColor
) {
  if (input.semantic == "POSITION") {
    if (!appendAttribute(source, sourceIndex, 3, geometry.positions)) {
      return false;
    }
    wrotePosition = true;
  } else if (input.semantic == "NORMAL") {
    if (!appendAttribute(source, sourceIndex, 3, geometry.normals)) {
      return false;
    }
    geometry.hasNormals = true;
    wroteNormal = true;
  } else if (input.semantic == "TEXCOORD") {
    const uint32_t itemSize = source.stride > 0 ? source.stride : 2;
    if (input.set == 0) {
      geometry.uvItemSize = itemSize;
      if (!appendAttribute(source, sourceIndex, itemSize, geometry.uvs)) {
        return false;
      }
      geometry.hasUvs = true;
      wroteUv = true;
    } else if (input.set == 1) {
      geometry.uv1ItemSize = itemSize;
      if (!appendAttribute(source, sourceIndex, itemSize, geometry.uv1s)) {
        return false;
      }
      geometry.hasUv1s = true;
      wroteUv1 = true;
    }
  } else if (input.semantic == "COLOR") {
    const uint32_t itemSize = source.stride > 0 ? source.stride : 3;
    geometry.colorItemSize = itemSize;
    if (!appendAttribute(source, sourceIndex, itemSize, geometry.colors, true)) {
      return false;
    }
    geometry.hasColors = true;
    wroteColor = true;
  }
  return true;
}

bool appendResolvedAttribute(
  Geometry& geometry,
  const ResolvedInput& input,
  int sourceIndex
) {
  if (!input.source) {
    errorMessage = "Collada primitive input references an unknown source.";
    return false;
  }

  const Source& source = *input.source;
  if (sourceIndex < 0) {
    errorMessage = "Collada primitive contains a negative source index.";
    return false;
  }
  const auto start = static_cast<size_t>(sourceIndex) * source.stride;
  if (start + input.itemSize > source.values.size()) {
    errorMessage = "Collada primitive references a source index outside the available range.";
    return false;
  }

  std::vector<float>* target = nullptr;
  bool convertSrgbToLinear = false;
  switch (input.kind) {
    case ResolvedInputKind::Position:
      target = &geometry.positions;
      break;
    case ResolvedInputKind::Normal:
      target = &geometry.normals;
      geometry.hasNormals = true;
      break;
    case ResolvedInputKind::Texcoord0:
      target = &geometry.uvs;
      geometry.uvItemSize = input.itemSize;
      geometry.hasUvs = true;
      break;
    case ResolvedInputKind::Texcoord1:
      target = &geometry.uv1s;
      geometry.uv1ItemSize = input.itemSize;
      geometry.hasUv1s = true;
      break;
    case ResolvedInputKind::Color:
      target = &geometry.colors;
      geometry.colorItemSize = input.itemSize;
      geometry.hasColors = true;
      convertSrgbToLinear = true;
      break;
    case ResolvedInputKind::Vertex:
      errorMessage = "Collada vertex input must be expanded before appending attributes.";
      return false;
  }

  for (uint32_t index = 0; index < input.itemSize; ++index) {
    const float value = source.values[start + index];
    target->push_back(convertSrgbToLinear && index < 3 ? srgbChannelToLinear(value) : value);
  }
  return true;
}

bool appendResolvedPrimitiveVertex(
  Geometry& geometry,
  const std::vector<ResolvedInput>& inputs,
  const std::vector<int>& indices,
  size_t tupleStart,
  uint32_t tupleStride
) {
  bool wrotePosition = false;
  bool wroteNormal = false;
  bool wroteUv = false;
  bool wroteUv1 = false;
  bool wroteColor = false;

  for (const ResolvedInput& input : inputs) {
    if (input.offset >= tupleStride) {
      errorMessage = "Collada primitive input offset exceeds tuple stride.";
      return false;
    }

    const int sourceIndex = indices[tupleStart + input.offset];
    if (input.kind == ResolvedInputKind::Vertex) {
      for (const ResolvedInput& vertexInput : input.vertexInputs) {
        if (!appendResolvedAttribute(geometry, vertexInput, sourceIndex)) {
          return false;
        }
        if (vertexInput.kind == ResolvedInputKind::Position) {
          wrotePosition = true;
        } else if (vertexInput.kind == ResolvedInputKind::Normal) {
          wroteNormal = true;
        } else if (vertexInput.kind == ResolvedInputKind::Texcoord0) {
          wroteUv = true;
        } else if (vertexInput.kind == ResolvedInputKind::Texcoord1) {
          wroteUv1 = true;
        } else if (vertexInput.kind == ResolvedInputKind::Color) {
          wroteColor = true;
        }
      }
      continue;
    }

    if (!appendResolvedAttribute(geometry, input, sourceIndex)) {
      return false;
    }
    if (input.kind == ResolvedInputKind::Position) {
      wrotePosition = true;
    } else if (input.kind == ResolvedInputKind::Normal) {
      wroteNormal = true;
    } else if (input.kind == ResolvedInputKind::Texcoord0) {
      wroteUv = true;
    } else if (input.kind == ResolvedInputKind::Texcoord1) {
      wroteUv1 = true;
    } else if (input.kind == ResolvedInputKind::Color) {
      wroteColor = true;
    }
  }

  if (!wrotePosition) {
    errorMessage = "Collada primitive vertex is missing position data.";
    return false;
  }
  if (geometry.hasNormals && !wroteNormal) {
    geometry.normals.push_back(0.0f);
    geometry.normals.push_back(0.0f);
    geometry.normals.push_back(1.0f);
  }
  if (geometry.hasUvs && !wroteUv) {
    for (uint32_t index = 0; index < geometry.uvItemSize; ++index) {
      geometry.uvs.push_back(0.0f);
    }
  }
  if (geometry.hasUv1s && !wroteUv1) {
    for (uint32_t index = 0; index < geometry.uv1ItemSize; ++index) {
      geometry.uv1s.push_back(0.0f);
    }
  }
  if (geometry.hasColors && !wroteColor) {
    for (uint32_t index = 0; index < geometry.colorItemSize; ++index) {
      geometry.colors.push_back(index == 3 ? 1.0f : 0.0f);
    }
  }
  return true;
}

bool appendPrimitiveVertex(
  Geometry& geometry,
  const std::vector<Input>& inputs,
  const std::unordered_map<std::string, Source>& sources,
  const std::unordered_map<std::string, std::vector<Input>>& vertexInputsById,
  const std::vector<int>& indices,
  size_t tupleStart,
  uint32_t tupleStride
) {
  bool wrotePosition = false;
  bool wroteNormal = false;
  bool wroteUv = false;
  bool wroteUv1 = false;
  bool wroteColor = false;

  for (const Input& input : inputs) {
    if (input.offset >= tupleStride) {
      errorMessage = "Collada primitive input offset exceeds tuple stride.";
      return false;
    }
    const int sourceIndex = indices[tupleStart + input.offset];
    if (input.semantic == "VERTEX") {
      const std::string verticesId = stripFragment(input.source);
      auto vertexInputs = vertexInputsById.find(verticesId);
      if (vertexInputs == vertexInputsById.end()) {
        const size_t slash = verticesId.find_last_of('/');
        if (slash != std::string::npos && slash + 1 < verticesId.size()) {
          vertexInputs = vertexInputsById.find(verticesId.substr(slash + 1));
        }
      }
      if (vertexInputs == vertexInputsById.end()) {
        errorMessage = "Collada primitive VERTEX input references an unknown vertices block.";
        return false;
      }
      for (const Input& vertexInput : vertexInputs->second) {
        const Source* source = resolveInputSource(vertexInput, sources);
        if (!source) {
          errorMessage = "Collada vertices input references an unknown source.";
          return false;
        }
        if (!appendResolvedInputAttribute(
          geometry,
          vertexInput,
          *source,
          sourceIndex,
          wrotePosition,
          wroteNormal,
          wroteUv,
          wroteUv1,
          wroteColor
        )) {
          return false;
        }
      }
    } else {
      const Source* source = resolveInputSource(input, sources);
      if (!source) {
        errorMessage = "Collada primitive input references an unknown source.";
        return false;
      }
      if (!appendResolvedInputAttribute(
        geometry,
        input,
        *source,
        sourceIndex,
        wrotePosition,
        wroteNormal,
        wroteUv,
        wroteUv1,
        wroteColor
      )) {
        return false;
      }
    }
  }

  if (!wrotePosition) {
    errorMessage = "Collada primitive is missing VERTEX input.";
    return false;
  }
  if (geometry.hasNormals && !wroteNormal) {
    geometry.normals.push_back(0.0f);
    geometry.normals.push_back(0.0f);
    geometry.normals.push_back(1.0f);
  }
  if (geometry.hasUvs && !wroteUv) {
    for (uint32_t index = 0; index < geometry.uvItemSize; ++index) {
      geometry.uvs.push_back(0.0f);
    }
  }
  if (geometry.hasUv1s && !wroteUv1) {
    for (uint32_t index = 0; index < geometry.uv1ItemSize; ++index) {
      geometry.uv1s.push_back(0.0f);
    }
  }
  if (geometry.hasColors && !wroteColor) {
    for (uint32_t index = 0; index < geometry.colorItemSize; ++index) {
      geometry.colors.push_back(index == 3 ? 1.0f : 0.0f);
    }
  }
  return true;
}

bool appendTriangleFromPolygon(
  Geometry& geometry,
  const std::vector<ResolvedInput>& inputs,
  const std::vector<int>& indices,
  size_t polygonStart,
  uint32_t tupleStride,
  uint32_t a,
  uint32_t b,
  uint32_t c
) {
  const size_t tupleA = polygonStart + static_cast<size_t>(a) * tupleStride;
  const size_t tupleB = polygonStart + static_cast<size_t>(b) * tupleStride;
  const size_t tupleC = polygonStart + static_cast<size_t>(c) * tupleStride;
  return appendResolvedPrimitiveVertex(geometry, inputs, indices, tupleA, tupleStride) &&
         appendResolvedPrimitiveVertex(geometry, inputs, indices, tupleB, tupleStride) &&
         appendResolvedPrimitiveVertex(geometry, inputs, indices, tupleC, tupleStride);
}

bool parsePrimitiveInputs(
  const char* primitiveStart,
  const char* primitiveTagEnd,
  std::vector<Input>& inputs,
  uint32_t& tupleStride
) {
  const char* input = primitiveStart;
  tupleStride = 0;
  while ((input = findText(input, primitiveTagEnd, "<input")) != nullptr) {
    const char* inputEnd = findChar(input, primitiveTagEnd, '>');
    if (!inputEnd) {
      errorMessage = "Malformed Collada primitive input.";
      return false;
    }
    Input parsed;
    parsed.semantic = readAttribute(input, inputEnd, "semantic");
    parsed.source = readAttribute(input, inputEnd, "source");
    if (parsed.semantic == "TEXCOORD") {
      const std::string texcoordSet = readAttribute(input, inputEnd, "set");
      if (!texcoordSet.empty()) {
        const char* setCursor = texcoordSet.data();
        const char* setEnd = setCursor + texcoordSet.size();
        int setValue = 0;
        if (parseInt(setCursor, setEnd, setValue) && setValue > 0) {
          parsed.set = static_cast<uint32_t>(setValue);
        }
      }
    }
    const std::string offset = readAttribute(input, inputEnd, "offset");
    if (!offset.empty()) {
      const char* cursor = offset.data();
      const char* end = cursor + offset.size();
      int offsetValue = 0;
      if (parseInt(cursor, end, offsetValue) && offsetValue >= 0) {
        parsed.offset = static_cast<uint32_t>(offsetValue);
      }
    }
    tupleStride = std::max(tupleStride, parsed.offset + 1);
    if (parsed.semantic == "VERTEX" ||
        parsed.semantic == "NORMAL" ||
        parsed.semantic == "COLOR" ||
        (parsed.semantic == "TEXCOORD" && parsed.set <= 1)) {
      inputs.push_back(std::move(parsed));
    }
    input = inputEnd + 1;
  }

  if (tupleStride == 0 || inputs.empty()) {
    errorMessage = "Collada primitive has no supported inputs.";
    return false;
  }
  return true;
}

bool parsePrimitive(
  const char* primitiveStart,
  const char* primitiveEnd,
  const char* primitiveName,
  Geometry& geometry,
  const std::unordered_map<std::string, Source>& sources,
  const std::unordered_map<std::string, std::vector<Input>>& vertexInputsById
) {
  const char* tagEnd = findChar(primitiveStart, primitiveEnd, '>');
  if (!tagEnd) {
    errorMessage = "Malformed Collada primitive tag.";
    return false;
  }

  std::vector<Input> inputs;
  uint32_t tupleStride = 0;
  if (!parsePrimitiveInputs(primitiveStart, primitiveEnd, inputs, tupleStride)) {
    return false;
  }
  std::vector<ResolvedInput> resolvedInputs;
  if (!resolvePrimitiveInputs(inputs, sources, vertexInputsById, resolvedInputs)) {
    return false;
  }

  bool primitiveHasNormals = false;
  bool primitiveHasUvs = false;
  bool primitiveHasUv1s = false;
  bool primitiveHasColors = false;
  uint32_t primitiveUvItemSize = geometry.uvItemSize;
  uint32_t primitiveUv1ItemSize = geometry.uv1ItemSize;
  uint32_t primitiveColorItemSize = geometry.colorItemSize;
  const auto inspectResolvedInput = [&](const ResolvedInput& input) {
    if (input.kind == ResolvedInputKind::Vertex) {
      for (const ResolvedInput& vertexInput : input.vertexInputs) {
        if (vertexInput.kind == ResolvedInputKind::Normal) {
          primitiveHasNormals = true;
        } else if (vertexInput.kind == ResolvedInputKind::Texcoord0) {
          primitiveHasUvs = true;
          primitiveUvItemSize = vertexInput.itemSize;
        } else if (vertexInput.kind == ResolvedInputKind::Texcoord1) {
          primitiveHasUv1s = true;
          primitiveUv1ItemSize = vertexInput.itemSize;
        } else if (vertexInput.kind == ResolvedInputKind::Color) {
          primitiveHasColors = true;
          primitiveColorItemSize = vertexInput.itemSize;
        }
      }
      return;
    }

    if (input.kind == ResolvedInputKind::Normal) {
      primitiveHasNormals = true;
    } else if (input.kind == ResolvedInputKind::Texcoord0) {
      primitiveHasUvs = true;
      primitiveUvItemSize = input.itemSize;
    } else if (input.kind == ResolvedInputKind::Texcoord1) {
      primitiveHasUv1s = true;
      primitiveUv1ItemSize = input.itemSize;
    } else if (input.kind == ResolvedInputKind::Color) {
      primitiveHasColors = true;
      primitiveColorItemSize = input.itemSize;
    }
  };
  for (const ResolvedInput& input : resolvedInputs) {
    inspectResolvedInput(input);
  }

  const uint32_t existingVertexCount = static_cast<uint32_t>(geometry.positions.size() / 3);
  if (!geometry.hasNormals && primitiveHasNormals && existingVertexCount > 0) {
    for (uint32_t index = 0; index < existingVertexCount; ++index) {
      geometry.normals.push_back(0.0f);
      geometry.normals.push_back(0.0f);
      geometry.normals.push_back(1.0f);
    }
  }
  if (!geometry.hasUvs && primitiveHasUvs && existingVertexCount > 0) {
    geometry.uvItemSize = primitiveUvItemSize;
    geometry.uvs.resize(static_cast<size_t>(existingVertexCount) * geometry.uvItemSize, 0.0f);
  }
  if (!geometry.hasUv1s && primitiveHasUv1s && existingVertexCount > 0) {
    geometry.uv1ItemSize = primitiveUv1ItemSize;
    geometry.uv1s.resize(static_cast<size_t>(existingVertexCount) * geometry.uv1ItemSize, 0.0f);
  }
  if (!geometry.hasColors && primitiveHasColors && existingVertexCount > 0) {
    geometry.colorItemSize = primitiveColorItemSize;
    for (uint32_t vertex = 0; vertex < existingVertexCount; ++vertex) {
      for (uint32_t index = 0; index < geometry.colorItemSize; ++index) {
        geometry.colors.push_back(index == 3 ? 1.0f : 0.0f);
      }
    }
  }

  geometry.hasNormals = geometry.hasNormals || primitiveHasNormals;
  geometry.hasUvs = geometry.hasUvs || primitiveHasUvs;
  geometry.hasUv1s = geometry.hasUv1s || primitiveHasUv1s;
  geometry.hasColors = geometry.hasColors || primitiveHasColors;

  const std::string materialSymbol = readAttribute(primitiveStart, tagEnd, "material");
  const std::string declaredCountText = readAttribute(primitiveStart, tagEnd, "count");
  int declaredCount = -1;
  if (!declaredCountText.empty()) {
    const char* declaredCountCursor = declaredCountText.data();
    const char* declaredCountEnd = declaredCountCursor + declaredCountText.size();
    if (!parseInt(declaredCountCursor, declaredCountEnd, declaredCount) || declaredCount < 0) {
      errorMessage = "Collada primitive has an invalid count attribute.";
      return false;
    }
  }
  const uint32_t materialIndex = ensureGeometryMaterial(geometry, materialSymbol);
  ensureGroup(geometry, materialIndex);

  const char* pStart = findText(tagEnd, primitiveEnd, "<p>");
  const char* pEnd = pStart ? findText(pStart, primitiveEnd, "</p>") : nullptr;
  if (!pStart || !pEnd) {
    errorMessage = "Collada primitive is missing index list.";
    return false;
  }

  uint32_t appendedVertices = 0;
  std::vector<int> indices;
  size_t expectedIndexCount = 0;
  if (declaredCount > 0 && tupleStride > 0) {
    if (std::strcmp(primitiveName, "triangles") == 0) {
      expectedIndexCount = static_cast<size_t>(declaredCount) * 3u * tupleStride;
    } else if (std::strcmp(primitiveName, "lines") == 0) {
      expectedIndexCount = static_cast<size_t>(declaredCount) * 2u * tupleStride;
    }
  }
  if (!parseIntList(pStart + 3, pEnd, indices, expectedIndexCount)) {
    return false;
  }

  if (std::strcmp(primitiveName, "triangles") == 0) {
    if (indices.size() % tupleStride != 0) {
      errorMessage = "Collada triangles index list length is not divisible by tuple stride.";
      return false;
    }
    const size_t vertexCount = indices.size() / tupleStride;
    if (vertexCount % 3u != 0) {
      errorMessage = "Collada triangles vertex count is not divisible by three.";
      return false;
    }
    const size_t triangleCount = vertexCount / 3u;
    if (declaredCount >= 0 && triangleCount != static_cast<size_t>(declaredCount)) {
      errorMessage = "Collada triangles count does not match index data.";
      return false;
    }
    reserveGeometryVertices(geometry, vertexCount);
    for (size_t triangle = 0; triangle < triangleCount; ++triangle) {
      const size_t polygonStart = triangle * 3u * tupleStride;
      if (!appendTriangleFromPolygon(geometry, resolvedInputs, indices, polygonStart, tupleStride, 0, 1, 2)) {
        return false;
      }
      appendedVertices += 3;
    }
  } else if (std::strcmp(primitiveName, "lines") == 0 || std::strcmp(primitiveName, "linestrips") == 0) {
    if (indices.size() % tupleStride != 0) {
      errorMessage = "Collada lines index list length is not divisible by tuple stride.";
      return false;
    }
    const size_t vertexCount = indices.size() / tupleStride;
    if (std::strcmp(primitiveName, "lines") == 0) {
      if (vertexCount % 2u != 0) {
        errorMessage = "Collada lines vertex count is not divisible by two.";
        return false;
      }
      const size_t lineCount = vertexCount / 2u;
      if (declaredCount >= 0 && lineCount != static_cast<size_t>(declaredCount)) {
        errorMessage = "Collada lines count does not match index data.";
        return false;
      }
    }
    reserveGeometryVertices(geometry, vertexCount);
    for (size_t vertex = 0; vertex < vertexCount; ++vertex) {
      if (!appendResolvedPrimitiveVertex(geometry, resolvedInputs, indices, vertex * tupleStride, tupleStride)) {
        return false;
      }
      appendedVertices += 1;
    }
  } else if (std::strcmp(primitiveName, "polygons") == 0) {
    uint32_t polygonCount = 0;
    const char* polygonCursor = tagEnd;
    while ((polygonCursor = findText(polygonCursor, primitiveEnd, "<p>")) != nullptr) {
      const char* polygonEnd = findText(polygonCursor, primitiveEnd, "</p>");
      if (!polygonEnd) {
        errorMessage = "Malformed Collada polygons index list.";
        return false;
      }
      std::vector<int> polygonIndices;
      if (!parseIntList(polygonCursor + 3, polygonEnd, polygonIndices, tupleStride * 4u)) {
        return false;
      }
      if (polygonIndices.size() % tupleStride != 0) {
        errorMessage = "Collada polygons index list length is not divisible by tuple stride.";
        return false;
      }
      const uint32_t vcount = static_cast<uint32_t>(polygonIndices.size() / tupleStride);
      if (vcount < 3) {
        errorMessage = "Collada polygons contains a polygon with fewer than three vertices.";
        return false;
      }
      if (vcount == 4) {
        if (!appendTriangleFromPolygon(geometry, resolvedInputs, polygonIndices, 0, tupleStride, 0, 1, 3) ||
            !appendTriangleFromPolygon(geometry, resolvedInputs, polygonIndices, 0, tupleStride, 1, 2, 3)) {
          return false;
        }
        appendedVertices += 6;
      } else {
        for (uint32_t index = 1; index + 1 < vcount; ++index) {
          if (!appendTriangleFromPolygon(geometry, resolvedInputs, polygonIndices, 0, tupleStride, 0, index, index + 1)) {
            return false;
          }
          appendedVertices += 3;
        }
      }
      polygonCount += 1;
      polygonCursor = polygonEnd + 4;
    }
    if (declaredCount >= 0 && polygonCount != static_cast<uint32_t>(declaredCount)) {
      errorMessage = "Collada polygons count does not match p data.";
      return false;
    }
  } else {
    const char* vcountStart = findText(tagEnd, primitiveEnd, "<vcount>");
    const char* vcountEnd = vcountStart ? findText(vcountStart, primitiveEnd, "</vcount>") : nullptr;
    if (!vcountStart || !vcountEnd) {
      errorMessage = "Collada polylist is missing vcount.";
      return false;
    }
    std::vector<int> vcounts;
    if (!parseIntList(
          vcountStart + 8,
          vcountEnd,
          vcounts,
          declaredCount > 0 ? static_cast<size_t>(declaredCount) : 0
        )) {
      return false;
    }
    if (declaredCount >= 0 && vcounts.size() != static_cast<size_t>(declaredCount)) {
      errorMessage = "Collada polylist count does not match vcount data.";
      return false;
    }

    size_t triangulatedVertexCount = 0;
    for (int vcount : vcounts) {
      if (vcount >= 3) {
        triangulatedVertexCount += static_cast<size_t>(vcount == 4 ? 6 : (vcount - 2) * 3);
      }
    }
    reserveGeometryVertices(geometry, triangulatedVertexCount);

    size_t polygonStart = 0;
    for (int vcount : vcounts) {
      if (vcount < 3) {
        errorMessage = "Collada polylist contains a polygon with fewer than three vertices.";
        return false;
      }
      if (polygonStart + static_cast<size_t>(vcount) * tupleStride > indices.size()) {
        errorMessage = "Collada polylist index list ended before vcount data.";
        return false;
      }
      if (vcount == 4) {
        if (!appendTriangleFromPolygon(geometry, resolvedInputs, indices, polygonStart, tupleStride, 0, 1, 3) ||
            !appendTriangleFromPolygon(geometry, resolvedInputs, indices, polygonStart, tupleStride, 1, 2, 3)) {
          return false;
        }
        appendedVertices += 6;
      } else {
        for (uint32_t index = 1; index + 1 < static_cast<uint32_t>(vcount); ++index) {
          if (!appendTriangleFromPolygon(geometry, resolvedInputs, indices, polygonStart, tupleStride, 0, index, index + 1)) {
            return false;
          }
          appendedVertices += 3;
        }
      }
      polygonStart += static_cast<size_t>(vcount) * tupleStride;
    }
    if (polygonStart != indices.size()) {
      errorMessage = "Collada polylist index list has trailing data.";
      return false;
    }
  }

  geometry.groups.back().count += appendedVertices;
  return true;
}

bool parseGeometries(const char* start, const char* end, ParseState& state) {
  const char* cursor = start;
  while ((cursor = findText(cursor, end, "<geometry")) != nullptr) {
    const char* tagEnd = findChar(cursor, end, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada geometry tag.";
      return false;
    }
    const char* geometryEnd = findText(tagEnd, end, "</geometry>");
    if (!geometryEnd) {
      errorMessage = "Malformed Collada geometry block.";
      return false;
    }
    const char* meshStart = findText(tagEnd, geometryEnd, "<mesh>");
    const char* meshEnd = meshStart ? findText(meshStart, geometryEnd, "</mesh>") : nullptr;
    if (!meshStart || !meshEnd) {
      cursor = geometryEnd + 11;
      continue;
    }

    const std::string sourceGeometryId = readAttribute(cursor, tagEnd, "id");
    const std::string sourceGeometryName = readAttribute(cursor, tagEnd, "name");
    Geometry meshGeometry;
    meshGeometry.id = sourceGeometryId;
    meshGeometry.name = sourceGeometryName;
    meshGeometry.primitiveKind = "mesh";
    Geometry lineGeometry;
    lineGeometry.id = sourceGeometryId + "#lines";
    lineGeometry.name = sourceGeometryName.empty() ? sourceGeometryId + "_lines" : sourceGeometryName + "_lines";
    lineGeometry.primitiveKind = "lines";
    Geometry lineStripGeometry;
    lineStripGeometry.id = sourceGeometryId + "#linestrips";
    lineStripGeometry.name = sourceGeometryName.empty() ? sourceGeometryId + "_linestrips" : sourceGeometryName + "_linestrips";
    lineStripGeometry.primitiveKind = "linestrips";

    std::unordered_map<std::string, Source> sources;
    std::unordered_map<std::string, std::vector<Input>> vertexInputsById;
    if (!parseSourcesAndVertices(meshStart, meshEnd, sources, vertexInputsById)) {
      return false;
    }

    const char* primitiveCursor = meshStart;
    while (primitiveCursor < meshEnd) {
      const char* triangles = findText(primitiveCursor, meshEnd, "<triangles");
      const char* polylist = findText(primitiveCursor, meshEnd, "<polylist");
      const char* polygons = findText(primitiveCursor, meshEnd, "<polygons");
      const char* lines = findText(primitiveCursor, meshEnd, "<lines");
      const char* linestrips = findText(primitiveCursor, meshEnd, "<linestrips");
      const char* primitiveStart = nullptr;
      const char* primitiveName = nullptr;
      if (triangles && (!primitiveStart || triangles < primitiveStart)) {
        primitiveStart = triangles;
        primitiveName = "triangles";
      }
      if (polylist && (!primitiveStart || polylist < primitiveStart)) {
        primitiveStart = polylist;
        primitiveName = "polylist";
      }
      if (polygons && (!primitiveStart || polygons < primitiveStart)) {
        primitiveStart = polygons;
        primitiveName = "polygons";
      }
      if (lines && (!linestrips || lines < linestrips) && (!primitiveStart || lines < primitiveStart)) {
        primitiveStart = lines;
        primitiveName = "lines";
      }
      if (linestrips && (!primitiveStart || linestrips < primitiveStart)) {
        primitiveStart = linestrips;
        primitiveName = "linestrips";
      }
      if (!primitiveStart) {
        break;
      }
      const char* primitiveClose =
        std::strcmp(primitiveName, "triangles") == 0
          ? findText(primitiveStart, meshEnd, "</triangles>")
          : (std::strcmp(primitiveName, "polylist") == 0
              ? findText(primitiveStart, meshEnd, "</polylist>")
              : (std::strcmp(primitiveName, "polygons") == 0
                  ? findText(primitiveStart, meshEnd, "</polygons>")
                  : (std::strcmp(primitiveName, "lines") == 0
                      ? findText(primitiveStart, meshEnd, "</lines>")
                      : findText(primitiveStart, meshEnd, "</linestrips>"))));
      if (!primitiveClose) {
        errorMessage = "Malformed Collada primitive block.";
        return false;
      }
      const char* primitiveEnd = primitiveClose +
        (std::strcmp(primitiveName, "triangles") == 0 ? 12 :
          (std::strcmp(primitiveName, "lines") == 0 ? 8 :
            (std::strcmp(primitiveName, "linestrips") == 0 ? 13 : 11)));
      Geometry& targetGeometry =
        std::strcmp(primitiveName, "lines") == 0
          ? lineGeometry
          : (std::strcmp(primitiveName, "linestrips") == 0 ? lineStripGeometry : meshGeometry);
      if (!parsePrimitive(primitiveStart, primitiveEnd, primitiveName, targetGeometry, sources, vertexInputsById)) {
        return false;
      }
      primitiveCursor = primitiveEnd;
    }

    auto registerGeometry = [&](Geometry&& geometry) {
      if (sourceGeometryId.empty() || geometry.positions.empty()) {
        return;
      }
      state.geometryIdsBySourceId[sourceGeometryId].push_back(geometry.id);
      state.geometriesById.emplace(geometry.id, std::move(geometry));
    };
    registerGeometry(std::move(meshGeometry));
    registerGeometry(std::move(lineGeometry));
    registerGeometry(std::move(lineStripGeometry));
    if (!sourceGeometryId.empty() && state.geometryIdsBySourceId.find(sourceGeometryId) == state.geometryIdsBySourceId.end()) {
      state.geometryIdsBySourceId[sourceGeometryId] = {};
    }
    cursor = geometryEnd + 11;
  }

  if (state.geometriesById.empty()) {
    errorMessage = "Collada fast parser found no supported mesh geometries.";
    return false;
  }
  return true;
}

const char* findMatchingNodeEnd(const char* nodeStart, const char* end) {
  const char* cursor = nodeStart;
  int depth = 0;
  while (cursor < end) {
    const char* nextOpen = findText(cursor, end, "<node");
    const char* nextClose = findText(cursor, end, "</node>");
    if (!nextClose) {
      return nullptr;
    }
    if (nextOpen && nextOpen < nextClose) {
      const char* tagEnd = findChar(nextOpen, end, '>');
      if (!tagEnd) {
        return nullptr;
      }
      const bool selfClosing = tagEnd > nextOpen && tagEnd[-1] == '/';
      if (!selfClosing) {
        depth += 1;
      }
      cursor = tagEnd + 1;
      continue;
    }
    depth -= 1;
    const char* closeEnd = nextClose + 7;
    if (depth == 0) {
      return closeEnd;
    }
    cursor = closeEnd;
  }
  return nullptr;
}

std::string readElementName(const char* elementStart, const char* tagEnd) {
  const char* cursor = elementStart;
  if (cursor < tagEnd && *cursor == '<') {
    ++cursor;
  }
  if (cursor < tagEnd && *cursor == '/') {
    ++cursor;
  }
  const char* nameStart = cursor;
  while (cursor < tagEnd &&
         *cursor != ' ' &&
         *cursor != '\t' &&
         *cursor != '\n' &&
         *cursor != '\r' &&
         *cursor != '/' &&
         *cursor != '>') {
    ++cursor;
  }
  return makeString(nameStart, cursor);
}

bool isSelfClosingTag(const char* elementStart, const char* tagEnd) {
  const char* cursor = tagEnd;
  while (cursor > elementStart &&
         (cursor[-1] == ' ' || cursor[-1] == '\t' || cursor[-1] == '\n' || cursor[-1] == '\r')) {
    --cursor;
  }
  return cursor > elementStart && cursor[-1] == '/';
}

const char* findMatchingElementEnd(const char* elementStart, const char* searchEnd, const std::string& elementName) {
  const char* tagEnd = findChar(elementStart, searchEnd, '>');
  if (!tagEnd) {
    return nullptr;
  }
  if (isSelfClosingTag(elementStart, tagEnd)) {
    return tagEnd + 1;
  }

  int depth = 1;
  const char* cursor = tagEnd + 1;
  while (cursor < searchEnd) {
    const char* nextOpen = findChar(cursor, searchEnd, '<');
    if (!nextOpen) {
      return nullptr;
    }
    const char* nextTagEnd = findChar(nextOpen, searchEnd, '>');
    if (!nextTagEnd) {
      return nullptr;
    }
    if (nextOpen + 1 < nextTagEnd && (nextOpen[1] == '!' || nextOpen[1] == '?')) {
      cursor = nextTagEnd + 1;
      continue;
    }

    const bool closing = nextOpen + 1 < nextTagEnd && nextOpen[1] == '/';
    const std::string nextName = readElementName(nextOpen, nextTagEnd);
    if (nextName == elementName) {
      if (closing) {
        depth -= 1;
        if (depth == 0) {
          return nextTagEnd + 1;
        }
      } else if (!isSelfClosingTag(nextOpen, nextTagEnd)) {
        depth += 1;
      }
    }
    cursor = nextTagEnd + 1;
  }
  return nullptr;
}

bool parseLibraryNodes(const char* start, const char* end, ParseState& state) {
  const char* libraryStart = findText(start, end, "<library_nodes");
  if (!libraryStart) {
    return true;
  }
  const char* libraryTagEnd = findChar(libraryStart, end, '>');
  if (libraryTagEnd && isSelfClosingTag(libraryStart, libraryTagEnd)) {
    return true;
  }
  const char* libraryEnd = libraryTagEnd ? findText(libraryTagEnd + 1, end, "</library_nodes>") : nullptr;
  if (!libraryTagEnd || !libraryEnd) {
    errorMessage = "Malformed Collada library_nodes block.";
    return false;
  }

  const char* cursor = libraryTagEnd + 1;
  while (cursor < libraryEnd) {
    const char* elementStart = findChar(cursor, libraryEnd, '<');
    if (!elementStart) {
      break;
    }
    const char* tagEnd = findChar(elementStart, libraryEnd, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada library_nodes child tag.";
      return false;
    }
    if (elementStart + 1 < tagEnd && (elementStart[1] == '/' || elementStart[1] == '!' || elementStart[1] == '?')) {
      cursor = tagEnd + 1;
      continue;
    }
    const std::string name = readElementName(elementStart, tagEnd);
    const char* elementEnd = findMatchingElementEnd(elementStart, libraryEnd, name);
    if (!elementEnd) {
      errorMessage = "Malformed Collada library_nodes child block.";
      return false;
    }
    if (name == "node") {
      std::string id = readAttribute(elementStart, tagEnd, "id");
      if (id.empty()) {
        id = readAttribute(elementStart, tagEnd, "name");
      }
      if (!id.empty()) {
        state.libraryNodesById[id] = {elementStart, elementEnd};
      }
    }
    cursor = elementEnd;
  }
  return true;
}

bool applyNodeTransform(const char* transformTagEnd, const char* transformEnd, const std::string& name, Node& node) {
  if (name == "skew" || name == "lookat") {
    errorMessage = "Unsupported Collada node transform for fast WASM parser.";
    return false;
  }

  std::vector<float> values;
  if (!parseFloatList(transformTagEnd + 1, transformEnd, values)) {
    return false;
  }

  float transform[16];
  if (name == "matrix") {
    if (values.size() != 16) {
      errorMessage = "Collada matrix transform does not contain 16 numbers.";
      return false;
    }
    for (size_t index = 0; index < 16; ++index) {
      transform[index] = values[index];
    }
  } else if (name == "translate") {
    if (values.size() < 3) {
      errorMessage = "Collada translate transform does not contain 3 numbers.";
      return false;
    }
    makeTranslationMatrix(values[0], values[1], values[2], transform);
  } else if (name == "rotate") {
    if (values.size() < 4) {
      errorMessage = "Collada rotate transform does not contain 4 numbers.";
      return false;
    }
    if (!makeRotationMatrix(values[0], values[1], values[2], values[3], transform)) {
      return false;
    }
  } else if (name == "scale") {
    if (values.size() < 3) {
      errorMessage = "Collada scale transform does not contain 3 numbers.";
      return false;
    }
    makeScaleMatrix(values[0], values[1], values[2], transform);
  } else {
    return true;
  }

  multiplyMatrixInPlace(node.matrix, transform);
  return true;
}

bool parseNodeTransforms(const char* nodeContentStart, const char* nodeEnd, Node& node) {
  const char* cursor = nodeContentStart;
  while (cursor < nodeEnd) {
    const char* elementStart = findChar(cursor, nodeEnd, '<');
    if (!elementStart) {
      return true;
    }
    const char* tagEnd = findChar(elementStart, nodeEnd, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada node child tag.";
      return false;
    }
    if (elementStart + 1 < tagEnd && (elementStart[1] == '/' || elementStart[1] == '!' || elementStart[1] == '?')) {
      cursor = tagEnd + 1;
      continue;
    }

    const std::string name = readElementName(elementStart, tagEnd);
    const char* elementEnd = findMatchingElementEnd(elementStart, nodeEnd, name);
    if (!elementEnd) {
      errorMessage = "Malformed Collada node child block.";
      return false;
    }

    if (name == "matrix" || name == "translate" || name == "rotate" || name == "scale" || name == "skew" || name == "lookat") {
      if (isSelfClosingTag(elementStart, tagEnd)) {
        errorMessage = "Collada transform element is missing values.";
        return false;
      }
      const std::string closePattern = std::string("</") + name;
      const char* transformEnd = findText(tagEnd + 1, elementEnd, closePattern.c_str());
      if (!transformEnd) {
        errorMessage = "Malformed Collada transform block.";
        return false;
      }
      if (!applyNodeTransform(tagEnd, transformEnd, name, node)) {
        return false;
      }
    }
    cursor = elementEnd;
  }
  return true;
}

bool appendInstanceGeometryNode(
  const char* nodeStart,
  const char* nodeTagEnd,
  const char* instanceGeometry,
  const char* instanceGeometryEnd,
  const char* instanceElementEnd,
  const float worldMatrix[16],
  const std::string& parentName,
  ParseState& state
) {
  Node node;
  node.name = readAttribute(nodeStart, nodeTagEnd, "name");
  if (node.name.empty()) {
    node.name = readAttribute(nodeStart, nodeTagEnd, "id");
  }
  const std::string instanceName = readAttribute(instanceGeometry, instanceGeometryEnd, "name");
  if (!instanceName.empty()) {
    node.name = instanceName;
  }
  // When the node itself carries no name (and the instance_geometry has no
  // name override), fall back to the nearest named ancestor node.  This keeps
  // submesh lookups (e.g. SDF `<submesh><name>Propeller</name>`) working when
  // an authored `<node name="Propeller">` wraps a transform-only intermediate
  // `<node>` that ultimately hosts the `<instance_geometry>`.
  if (node.name.empty() && !parentName.empty()) {
    node.name = parentName;
  }
  node.geometryId = stripFragment(readAttribute(instanceGeometry, instanceGeometryEnd, "url"));
  if (node.geometryId.empty()) {
    errorMessage = "Collada instance_geometry is missing url.";
    return false;
  }
  auto geometryIds = state.geometryIdsBySourceId.find(node.geometryId);
  if (geometryIds != state.geometryIdsBySourceId.end()) {
    if (geometryIds->second.empty()) {
      return true;
    }
    node.geometryIds = geometryIds->second;
  } else {
    node.geometryIds.push_back(node.geometryId);
  }
  copyMatrix(worldMatrix, node.matrix);

  const char* materialCursor = instanceGeometryEnd;
  while ((materialCursor = findText(materialCursor, instanceElementEnd, "<instance_material")) != nullptr) {
    const char* materialEnd = findChar(materialCursor, instanceElementEnd, '>');
    if (!materialEnd) {
      errorMessage = "Malformed Collada instance_material tag.";
      return false;
    }
    const std::string symbol = readAttribute(materialCursor, materialEnd, "symbol");
    const std::string target = stripFragment(readAttribute(materialCursor, materialEnd, "target"));
    if (!symbol.empty() && !target.empty()) {
      node.materialTargetBySymbol[symbol] = target;
    }
    materialCursor = materialEnd + 1;
  }

  state.nodes.push_back(std::move(node));
  return true;
}

bool parseNodeBlock(
  const char* nodeStart,
  const char* nodeEnd,
  const float parentMatrix[16],
  const std::string& parentName,
  ParseState& state,
  uint32_t depth = 0
) {
  if (depth > 64) {
    errorMessage = "Collada instance_node nesting is too deep.";
    return false;
  }

  const char* nodeTagEnd = findChar(nodeStart, nodeEnd, '>');
  if (!nodeTagEnd) {
    errorMessage = "Malformed Collada node tag.";
    return false;
  }

  Node localNode;
  if (!parseNodeTransforms(nodeTagEnd + 1, nodeEnd, localNode)) {
    return false;
  }

  // Resolve this node's own name so we can propagate it to unnamed children.
  // A node with only an `id` attribute (no `name`) is still considered named
  // for propagation purposes; only completely anonymous `<node>` elements
  // fall through to the inherited ancestor name.
  std::string ownName = readAttribute(nodeStart, nodeTagEnd, "name");
  if (ownName.empty()) {
    ownName = readAttribute(nodeStart, nodeTagEnd, "id");
  }
  const std::string childInheritedName = ownName.empty() ? parentName : ownName;

  float worldMatrix[16];
  multiplyMatrices(parentMatrix, localNode.matrix, worldMatrix);

  const char* cursor = nodeTagEnd + 1;
  while (cursor < nodeEnd) {
    const char* elementStart = findChar(cursor, nodeEnd, '<');
    if (!elementStart) {
      break;
    }
    const char* tagEnd = findChar(elementStart, nodeEnd, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada node child tag.";
      return false;
    }
    if (elementStart + 1 < tagEnd && (elementStart[1] == '/' || elementStart[1] == '!' || elementStart[1] == '?')) {
      cursor = tagEnd + 1;
      continue;
    }

    const std::string name = readElementName(elementStart, tagEnd);
    const char* elementEnd = findMatchingElementEnd(elementStart, nodeEnd, name);
    if (!elementEnd) {
      errorMessage = "Malformed Collada node child block.";
      return false;
    }

    if (name == "instance_geometry") {
      if (!appendInstanceGeometryNode(nodeStart, nodeTagEnd, elementStart, tagEnd, elementEnd, worldMatrix, childInheritedName, state)) {
        return false;
      }
    } else if (name == "instance_node") {
      const std::string nodeId = stripFragment(readAttribute(elementStart, tagEnd, "url"));
      auto libraryNode = state.libraryNodesById.find(nodeId);
      if (libraryNode == state.libraryNodesById.end()) {
        errorMessage = "Collada instance_node references an unknown library node.";
        return false;
      }
      if (!parseNodeBlock(libraryNode->second.start, libraryNode->second.end, worldMatrix, childInheritedName, state, depth + 1)) {
        return false;
      }
    } else if (name == "node") {
      if (!parseNodeBlock(elementStart, elementEnd, worldMatrix, childInheritedName, state, depth + 1)) {
        return false;
      }
    }

    cursor = elementEnd;
  }

  return true;
}

bool parseVisualSceneNodes(const char* start, const char* end, ParseState& state) {
  const char* sceneStart = findText(start, end, "<visual_scene");
  if (!sceneStart) {
    errorMessage = "Collada fast parser found no visual_scene.";
    return false;
  }
  const char* sceneTagEnd = findChar(sceneStart, end, '>');
  const char* sceneEnd = sceneTagEnd ? findText(sceneTagEnd, end, "</visual_scene>") : nullptr;
  if (!sceneTagEnd || !sceneEnd) {
    errorMessage = "Malformed Collada visual_scene block.";
    return false;
  }

  float identity[16];
  setIdentityMatrix(identity);

  const char* cursor = sceneTagEnd + 1;
  while (cursor < sceneEnd) {
    const char* elementStart = findChar(cursor, sceneEnd, '<');
    if (!elementStart) {
      break;
    }
    const char* tagEnd = findChar(elementStart, sceneEnd, '>');
    if (!tagEnd) {
      errorMessage = "Malformed Collada visual_scene child tag.";
      return false;
    }
    if (elementStart + 1 < tagEnd && (elementStart[1] == '/' || elementStart[1] == '!' || elementStart[1] == '?')) {
      cursor = tagEnd + 1;
      continue;
    }

    const std::string name = readElementName(elementStart, tagEnd);
    const char* elementEnd = findMatchingElementEnd(elementStart, sceneEnd, name);
    if (!elementEnd) {
      errorMessage = "Malformed Collada visual_scene child block.";
      return false;
    }
    if (name == "node" && !parseNodeBlock(elementStart, elementEnd, identity, std::string(), state)) {
      return false;
    }
    cursor = elementEnd;
  }

  if (state.nodes.empty()) {
    errorMessage = "Collada fast parser found no instance_geometry nodes.";
    return false;
  }
  return true;
}

uint32_t rgbToHex(float r, float g, float b) {
  const auto channel = [](float value) -> uint32_t {
    if (!std::isfinite(value)) {
      return 0;
    }
    return static_cast<uint32_t>(std::max(0.0f, std::min(255.0f, std::round(value * 255.0f))));
  };
  return (channel(r) << 16u) | (channel(g) << 8u) | channel(b);
}

uint32_t colorToHex(const Material& material) {
  return rgbToHex(material.r, material.g, material.b);
}

bool writeResult(const ParseState& state, BinaryWriter& writer) {
  writer.u32(0x34434d44u); // DMC4: DMC3 plus primitive kind for line primitives.
  writer.f32(state.unitScale);
  uint32_t outputNodeCount = 0;
  for (const Node& node : state.nodes) {
    outputNodeCount += static_cast<uint32_t>(node.geometryIds.empty() ? 1 : node.geometryIds.size());
  }
  writer.u32(outputNodeCount);

  for (const Node& node : state.nodes) {
    std::vector<std::string> fallbackGeometryIds;
    const std::vector<std::string>* geometryIds = &node.geometryIds;
    if (node.geometryIds.empty()) {
      fallbackGeometryIds.push_back(node.geometryId);
      geometryIds = &fallbackGeometryIds;
    }
    for (const std::string& geometryId : *geometryIds) {
      auto geometryEntry = state.geometriesById.find(geometryId);
      if (geometryEntry == state.geometriesById.end()) {
        errorMessage = "Collada node references an unsupported geometry.";
        return false;
      }
      const Geometry& geometry = geometryEntry->second;

      std::string outputName = node.name.empty() ? geometry.name : node.name;
      if (geometry.primitiveKind != "mesh" && !outputName.empty()) {
        outputName += "_";
        outputName += geometry.primitiveKind;
      }
      writer.string(outputName);
      writer.string(geometry.primitiveKind);
      for (float value : node.matrix) {
        writer.f32(value);
      }

      writer.u32(static_cast<uint32_t>(geometry.materialSymbols.size()));
      for (const std::string& symbol : geometry.materialSymbols) {
      std::string materialId = symbol;
      auto target = node.materialTargetBySymbol.find(symbol);
      if (target != node.materialTargetBySymbol.end()) {
        materialId = target->second;
      }

      Material material;
      auto materialEntry = state.materialsById.find(materialId);
      if (materialEntry != state.materialsById.end()) {
        material = materialEntry->second;
      } else if (symbol != "default") {
        material.name = symbol;
      }
      writer.string(material.name.empty() && symbol == "default" ? std::string() : (material.name.empty() ? symbol : material.name));
      writer.u32(colorToHex(material));
      writer.f32(material.a);
      writer.string(material.model);
      writer.string(material.diffuseTexture);
      writer.string(material.normalTexture);
      writer.string(material.specularTexture);
      writer.string(material.emissiveTexture);
      writer.string(material.lightTexture);
      writer.u32(rgbToHex(material.specularR, material.specularG, material.specularB));
      writer.u32(rgbToHex(material.emissiveR, material.emissiveG, material.emissiveB));
      writer.f32(material.shininess);
      writer.u8(material.doubleSided ? 1 : 0);
      writer.u8(material.transparent ? 1 : 0);
      }

      const uint32_t vertexCount = static_cast<uint32_t>(geometry.positions.size() / 3);
      writer.u32(vertexCount);
      writer.floatArray(geometry.positions);
      writer.u8(geometry.hasNormals ? 1 : 0);
      if (geometry.hasNormals) {
        writer.floatArray(geometry.normals);
      }
      writer.u8(geometry.hasUvs ? 1 : 0);
      if (geometry.hasUvs) {
        writer.u32(geometry.uvItemSize);
        writer.floatArray(geometry.uvs);
      }
      writer.u8(geometry.hasUv1s ? 1 : 0);
      if (geometry.hasUv1s) {
        writer.u32(geometry.uv1ItemSize);
        writer.floatArray(geometry.uv1s);
      }
      writer.u8(geometry.hasColors ? 1 : 0);
      if (geometry.hasColors) {
        writer.u32(geometry.colorItemSize);
        writer.floatArray(geometry.colors);
      }

      writer.u32(static_cast<uint32_t>(geometry.groups.size()));
      for (const Group& group : geometry.groups) {
        writer.u32(group.start);
        writer.u32(group.count);
        writer.u32(group.materialIndex);
      }
    }
  }

  return true;
}

bool parseCollada(const uint8_t* data, uint32_t length, BinaryWriter& writer) {
  const char* start = reinterpret_cast<const char*>(data);
  const char* end = start + length;

  ParseState state;
  lastParseTimings = {};

  const auto measure = [](double& target, const auto& run) -> bool {
    const double started = monotonicNowMs();
    const bool ok = run();
    target = monotonicNowMs() - started;
    return ok;
  };

  return measure(lastParseTimings.featureCheckMs, [&]() {
           return !hasUnsupportedColladaFeature(start, end);
         }) &&
         measure(lastParseTimings.upAxisMs, [&]() {
           return validateSupportedUpAxis(start, end);
         }) &&
         measure(lastParseTimings.unitScaleMs, [&]() {
           return parseUnitScale(start, end, state);
         }) &&
         measure(lastParseTimings.imagesMs, [&]() {
           XmlBlock block;
           if (!findOptionalElementContentBlock(
                 start,
                 end,
                 "<library_images",
                 "</library_images>",
                 "library_images",
                 block
               )) {
             return false;
           }
           return block.start ? parseImages(block.start, block.end, state) : parseImages(start, end, state);
         }) &&
         measure(lastParseTimings.materialsMs, [&]() {
           return parseEffectsAndMaterials(start, end, state);
         }) &&
         measure(lastParseTimings.geometriesMs, [&]() {
           XmlBlock block;
           if (!findOptionalElementContentBlock(
                 start,
                 end,
                 "<library_geometries",
                 "</library_geometries>",
                 "library_geometries",
                 block
               )) {
             return false;
           }
           return block.start ? parseGeometries(block.start, block.end, state) : parseGeometries(start, end, state);
         }) &&
         measure(lastParseTimings.libraryNodesMs, [&]() {
           return parseLibraryNodes(start, end, state);
         }) &&
         measure(lastParseTimings.visualSceneMs, [&]() {
           XmlBlock block;
           if (!findOptionalElementContentBlock(
                 start,
                 end,
                 "<library_visual_scenes",
                 "</library_visual_scenes>",
                 "library_visual_scenes",
                 block
               )) {
             return false;
           }
           return block.start
             ? parseVisualSceneNodes(block.start, block.end, state)
             : parseVisualSceneNodes(start, end, state);
         }) &&
         measure(lastParseTimings.writeResultMs, [&]() {
           return writeResult(state, writer);
         });
}

} // namespace

extern "C" {

int parse_collada_mesh(const uint8_t* data, uint32_t length) {
  if (resultPtr != nullptr) {
    std::free(resultPtr);
    resultPtr = nullptr;
    resultSize = 0;
  }
  errorMessage.clear();

  BinaryWriter writer(length);
  if (!parseCollada(data, length, writer) || writer.failed) {
    return 0;
  }

  resultPtr = writer.release(resultSize);
  if (resultPtr == nullptr || resultSize == 0) {
    errorMessage = "Collada parser returned an empty result buffer.";
    resultPtr = nullptr;
    resultSize = 0;
    return 0;
  }
  return 1;
}

uintptr_t collada_mesh_parser_get_result_ptr() {
  return reinterpret_cast<uintptr_t>(resultPtr);
}

uint32_t collada_mesh_parser_get_result_size() {
  return resultSize;
}

uintptr_t collada_mesh_parser_get_error_ptr() {
  return reinterpret_cast<uintptr_t>(errorMessage.data());
}

uint32_t collada_mesh_parser_get_error_size() {
  return static_cast<uint32_t>(errorMessage.size());
}

double collada_mesh_parser_get_last_timing_ms(uint32_t metricIndex) {
  switch (metricIndex) {
    case 0:
      return lastParseTimings.featureCheckMs;
    case 1:
      return lastParseTimings.upAxisMs;
    case 2:
      return lastParseTimings.unitScaleMs;
    case 3:
      return lastParseTimings.imagesMs;
    case 4:
      return lastParseTimings.materialsMs;
    case 5:
      return lastParseTimings.geometriesMs;
    case 6:
      return lastParseTimings.libraryNodesMs;
    case 7:
      return lastParseTimings.visualSceneMs;
    case 8:
      return lastParseTimings.writeResultMs;
    default:
      return 0.0;
  }
}

void collada_mesh_parser_free_result() {
  if (resultPtr != nullptr) {
    std::free(resultPtr);
    resultPtr = nullptr;
  }
  resultSize = 0;
}

}
