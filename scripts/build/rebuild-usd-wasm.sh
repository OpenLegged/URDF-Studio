#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Speed-first OpenUSD WASM rebuild for URDF Studio.

Usage:
  scripts/build/rebuild-usd-wasm.sh --usd-repo <path> --build-dir <path> [options]

Required:
  --usd-repo <path>     OpenUSD repo root (must contain build_scripts/build_usd.py)
  --build-dir <path>    Build output directory used by build_usd.py

Optional:
  --emsdk-env <path>    Path to emsdk_env.sh (sourced before build)
  --dest-dir <path>     Destination for emHdBindings.* (default: ./public/usd/bindings)
  --debug               Build debug variant (default: release)
  --robot-trim          Trim non-robot plugins while keeping robot-critical
                        rendering/physics metadata behavior
  --size-opt            Prefer smaller wasm output (sets wasm-opt level to -Oz)
  --no-strip-debug      Keep DWARF/debug/producers metadata in wasm output
  --skip-wasm-opt       Skip wasm-opt speed pass
  --help                Show this help

Environment:
  JOBS=<n>              Parallel build workers (default: detected CPU cores)
  EMSCRIPTEN_OPT_LEVEL=-O3
                        C/C++ compile/link optimization level for hdEmscripten
                        targets (default: -O3)
  EMSCRIPTEN_ENABLE_SIMD=1
                        Enable wasm SIMD in the compiler/linker flags
  WASM_OPT_LEVEL=-O3    wasm-opt optimization level (default: -O3)

Example:
  scripts/build/rebuild-usd-wasm.sh \
    --robot-trim \
    --emsdk-env ~/.localdeps/emsdk/emsdk_env.sh \
    --usd-repo ./third_party/OpenUSD \
    --build-dir ~/.localdeps/openusd-wasm-speed
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

prefer_non_android_cmake() {
  local entry
  local clean_path=""
  local separator=""
  local -a path_entries

  IFS=':' read -r -a path_entries <<< "$PATH"
  for entry in "${path_entries[@]}"; do
    case "$entry" in
      "$HOME"/Android/Sdk/cmake/*/bin|*/Android/Sdk/cmake/*/bin)
        continue
        ;;
    esac
    clean_path="${clean_path}${separator}${entry}"
    separator=":"
  done

  export PATH="$clean_path"
  if [[ -d "${HOME}/.local/bin" ]]; then
    export PATH="${HOME}/.local/bin:${PATH}"
  fi
}

detect_cpu_count() {
  if command -v nproc >/dev/null 2>&1; then
    nproc
    return
  fi
  if command -v sysctl >/dev/null 2>&1; then
    sysctl -n hw.ncpu
    return
  fi
  echo 8
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PATCH_DIR="${ROOT_DIR}/public/patches"

USD_REPO=""
BUILD_DIR=""
EMSDK_ENV=""
DEST_DIR="${ROOT_DIR}/public/usd/bindings"
BUILD_VARIANT="release"
SKIP_WASM_OPT=0
WASM_OPT_LEVEL="${WASM_OPT_LEVEL:--O3}"
SIZE_OPT=0
ROBOT_TRIM=0
STRIP_DEBUG=1
JOBS="${JOBS:-$(detect_cpu_count)}"
EMSCRIPTEN_OPT_LEVEL="${EMSCRIPTEN_OPT_LEVEL:--O3}"
EMSCRIPTEN_ENABLE_SIMD="${EMSCRIPTEN_ENABLE_SIMD:-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --usd-repo)
      USD_REPO="${2:-}"
      shift 2
      ;;
    --build-dir)
      BUILD_DIR="${2:-}"
      shift 2
      ;;
    --emsdk-env)
      EMSDK_ENV="${2:-}"
      shift 2
      ;;
    --dest-dir)
      DEST_DIR="${2:-}"
      shift 2
      ;;
    --debug)
      BUILD_VARIANT="debug"
      shift
      ;;
    --robot-trim)
      ROBOT_TRIM=1
      shift
      ;;
    --size-opt)
      SIZE_OPT=1
      shift
      ;;
    --no-strip-debug)
      STRIP_DEBUG=0
      shift
      ;;
    --skip-wasm-opt)
      SKIP_WASM_OPT=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$USD_REPO" || -z "$BUILD_DIR" ]]; then
  usage
  exit 1
fi

if [[ "$SIZE_OPT" -eq 1 ]]; then
  EMSCRIPTEN_OPT_LEVEL="-Oz"
  WASM_OPT_LEVEL="-Oz"
fi

EMSCRIPTEN_ENABLE_SIMD_CMAKE="ON"
if [[ "${EMSCRIPTEN_ENABLE_SIMD}" == "0" ]]; then
  EMSCRIPTEN_ENABLE_SIMD_CMAKE="OFF"
fi

if [[ -n "$EMSDK_ENV" ]]; then
  if [[ ! -f "$EMSDK_ENV" ]]; then
    echo "emsdk env file not found: $EMSDK_ENV" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$EMSDK_ENV"
fi

if [[ -n "${EMSDK:-}" && -d "${EMSDK}/upstream/bin" ]]; then
  export PATH="${EMSDK}/upstream/bin:${PATH}"
fi

prefer_non_android_cmake

require_cmd python3
require_cmd patch
require_cmd emcc
require_cmd cmake

if [[ "$SKIP_WASM_OPT" -eq 0 ]]; then
  require_cmd wasm-opt
fi

echo "Using cmake: $(command -v cmake) ($(cmake --version | head -n 1))"

if [[ ! -f "${USD_REPO}/build_scripts/build_usd.py" ]]; then
  echo "Invalid usd repo path, missing build script: ${USD_REPO}/build_scripts/build_usd.py" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"
mkdir -p "$DEST_DIR"
BUILD_DIR="$(cd "$BUILD_DIR" && pwd)"
DEST_DIR="$(cd "$DEST_DIR" && pwd)"

if [[ "$DEST_DIR" -ef "${ROOT_DIR}/public/usd/bindings" ]]; then
  require_cmd node
fi

export CMAKE_BUILD_PARALLEL_LEVEL="${JOBS}"
echo "[1/5] Building OpenUSD WASM (${BUILD_VARIANT}, jobs=${CMAKE_BUILD_PARALLEL_LEVEL})"
build_usd_script="${USD_REPO}/build_scripts/build_usd.py"
build_usd_runner_script="${build_usd_script}"

build_usd_args=(
  --build-target wasm
  --prefer-speed-over-safety
  --cmake-build-args "-DPXR_HD_EMSCRIPTEN_OPT_LEVEL=${EMSCRIPTEN_OPT_LEVEL} -DPXR_HD_EMSCRIPTEN_ENABLE_SIMD=${EMSCRIPTEN_ENABLE_SIMD_CMAKE}"
)
if [[ "$BUILD_VARIANT" == "debug" ]]; then
  build_usd_args+=(
    --build-variant debug
  )
fi

if [[ "$ROBOT_TRIM" -eq 1 ]]; then
  echo "  - robot-trim enabled: keeping JS bindings/WebGPU pipeline, trimming extra plugins"
  build_usd_args+=(
    --no-materialx
    --no-alembic
    --no-draco
    --no-openimageio
    --no-opencolorio
    --no-openvdb
    --no-ptex
    --no-embree
    --no-prman
  )
fi

python3 "${build_usd_runner_script}" "${build_usd_args[@]}" "$BUILD_DIR"

BIN_DIR="${BUILD_DIR}/bin"
for required_file in emHdBindings.js emHdBindings.wasm emHdBindings.worker.js emHdBindings.data; do
  if [[ ! -f "${BIN_DIR}/${required_file}" ]]; then
    echo "Build output missing: ${BIN_DIR}/${required_file}" >&2
    exit 1
  fi
done

if [[ -f "${BUILD_DIR}/build/OpenUSD/CMakeCache.txt" ]]; then
  echo "  - OpenUSD CMake feature flags:"
  grep -E 'PXR_ENABLE_WEBGPU_SUPPORT:BOOL=|PXR_PREFER_SAFETY_OVER_SPEED:BOOL=' "${BUILD_DIR}/build/OpenUSD/CMakeCache.txt" || true
fi

if [[ "$SKIP_WASM_OPT" -eq 0 ]]; then
  echo "[2/5] Running wasm-opt (${WASM_OPT_LEVEL})"
  wasm_opt_args=(
    "${WASM_OPT_LEVEL}"
    --enable-bulk-memory
    --enable-threads
    --enable-simd
  )
  if [[ "$STRIP_DEBUG" -eq 1 ]]; then
    wasm_opt_args+=(
      --strip-debug
      --strip-dwarf
      --strip-producers
    )
  fi
  wasm-opt \
    "${wasm_opt_args[@]}" \
    -o "${BIN_DIR}/emHdBindings.wasm" \
    "${BIN_DIR}/emHdBindings.wasm"
else
  echo "[2/5] Skipping wasm-opt"
fi

BINDINGS_JS="${BIN_DIR}/emHdBindings.js"

apply_patch_file() {
  local patch_file="$1"
  local label="$2"
  if [[ ! -f "$patch_file" ]]; then
    echo "  - skip ${label}: patch not found (${patch_file})"
    return
  fi
  if patch --batch --forward --silent -r /dev/null "$BINDINGS_JS" < "$patch_file" >/dev/null 2>&1; then
    echo "  - applied ${label}"
  else
    echo "  - skipped ${label} (already applied or no matching hunk)"
  fi
}

echo "[3/5] Applying JS compatibility patches"
apply_patch_file "${PATCH_DIR}/arguments_1.patch" "arguments_1"
apply_patch_file "${PATCH_DIR}/arguments_2.patch" "arguments_2"
apply_patch_file "${PATCH_DIR}/abort.patch" "abort"
apply_patch_file "${PATCH_DIR}/fileSystem.patch" "fileSystem"

python3 - "$BINDINGS_JS" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
changed = False

def replace_first(text: str, candidates, replacement: str):
    for candidate in candidates:
        if candidate in text:
            return text.replace(candidate, replacement, 1), True
    return text, False

def replace_last(text: str, candidates, replacement: str):
    for candidate in candidates:
        index = text.rfind(candidate)
        if index >= 0:
            return text[:index] + replacement + text[index + len(candidate):], True
    return text, False

if "var getUsdModule = (() => {" in text:
    text = text.replace("var getUsdModule = (() => {", "var getUsdModule = ((args) => {", 1)
    changed = True

if "urlModifier: args?.urlModifier" not in text:
    text, did_replace = replace_first(
        text,
        (
            "var Module=moduleArg;",
            "var Module = moduleArg;",
        ),
        """var Module=moduleArg;
Module = {
  locateFile: (path, prefix) => {
    if (!prefix && _scriptDir)
      prefix = _scriptDir.substr(0, _scriptDir.lastIndexOf("/") + 1);
    return prefix + path;
  },
  ...args,
  urlModifier: args?.urlModifier,
  ...Module,
};
moduleArg = Module;""",
    )
    changed = changed or did_replace

old_abort = """      what = "Aborted(" + what + ")";
      err(what);
      ABORT = true;
"""
minified_abort = 'err(what);ABORT=true;EXITSTATUS=1;'
if "allow continued loading after one failed asset" not in text:
    if old_abort in text:
        text = text.replace(
            old_abort,
            """      what = "Aborted(" + what + ")";
      err(what);
      // ABORT = true; // allow continued loading after one failed asset
""",
            1,
        )
        changed = True
    elif minified_abort in text:
        text = text.replace(
            minified_abort,
            'err(what);/* allow continued loading after one failed asset */EXITSTATUS=1;',
            1,
        )
        changed = True

cleaned_text = re.sub(
    r'\s*Module\["FS_readdir"\]\s*=\s*FS\.readdir;\s*Module\["FS_analyzePath"\]\s*=\s*FS\.analyzePath;\s*Module\["FS_readFile"\]\s*=\s*FS\.readFile;\s*Module\["FS_writeFile"\]\s*=\s*FS\.writeFile;\s*$',
    '\n',
    text,
    count=1,
)
if cleaned_text != text:
    text = cleaned_text
    changed = True

has_fs_exports = re.search(
    r'Module\["PThread"\]\s*=\s*PThread;\s*Module\["FS_readdir"\]\s*=\s*FS\.readdir;\s*Module\["FS_analyzePath"\]\s*=\s*FS\.analyzePath;\s*Module\["FS_readFile"\]\s*=\s*FS\.readFile;\s*Module\["FS_writeFile"\]\s*=\s*FS\.writeFile;',
    text,
)
if not has_fs_exports:
    text, did_replace = replace_last(
        text,
        (
            'Module["PThread"]=PThread;',
            'Module["PThread"] = PThread;',
        ),
        """Module["PThread"]=PThread;
Module["FS_readdir"]=FS.readdir;
Module["FS_analyzePath"]=FS.analyzePath;
Module["FS_readFile"]=FS.readFile;
Module["FS_writeFile"]=FS.writeFile;""",
    )
    changed = changed or did_replace

if 'globalThis["USD_WASM_MODULE"] = getUsdModule;' not in text:
    export_anchor = "if (typeof exports === 'object' && typeof module === 'object')"
    if export_anchor in text:
        text = text.replace(
            export_anchor,
            """if (typeof globalThis === 'object') globalThis["USD_WASM_MODULE"] = getUsdModule;
""" + export_anchor,
            1,
        )
        changed = True

if changed:
    path.write_text(text, encoding="utf-8")
    print("  - applied fallback text patches")
else:
    print("  - fallback text patches not needed")
PY

echo "[4/5] Copying bindings into ${DEST_DIR}"
cp "${BIN_DIR}/emHdBindings.js" "${DEST_DIR}/emHdBindings.js"
cp "${BIN_DIR}/emHdBindings.wasm" "${DEST_DIR}/emHdBindings.wasm"
cp "${BIN_DIR}/emHdBindings.worker.js" "${DEST_DIR}/emHdBindings.worker.js"
cp "${BIN_DIR}/emHdBindings.data" "${DEST_DIR}/emHdBindings.data"

if [[ "$DEST_DIR" -ef "${ROOT_DIR}/public/usd/bindings" ]]; then
  node "${SCRIPT_DIR}/usd-bindings-version.mjs"
fi

echo "[5/5] Done. Output sizes:"
ls -lh "${DEST_DIR}/emHdBindings.js" \
       "${DEST_DIR}/emHdBindings.wasm" \
       "${DEST_DIR}/emHdBindings.worker.js" \
       "${DEST_DIR}/emHdBindings.data"

report_transfer_size() {
  local file="$1"
  local raw_bytes
  raw_bytes="$(wc -c < "$file" | tr -d ' ')"
  if command -v gzip >/dev/null 2>&1; then
    local gzip_bytes
    gzip_bytes="$(gzip -9 -c "$file" | wc -c | tr -d ' ')"
    echo "  - $(basename "$file"): raw=${raw_bytes} bytes, gzip=${gzip_bytes} bytes"
  else
    echo "  - $(basename "$file"): raw=${raw_bytes} bytes"
  fi
}

echo "Transfer-size estimate (raw + gzip):"
report_transfer_size "${DEST_DIR}/emHdBindings.js"
report_transfer_size "${DEST_DIR}/emHdBindings.wasm"
report_transfer_size "${DEST_DIR}/emHdBindings.worker.js"
report_transfer_size "${DEST_DIR}/emHdBindings.data"

echo "Rebuild complete."
