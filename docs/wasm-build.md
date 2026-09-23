# OpenUSD WASM 构建文档

> 最后更新：2026-05-01

## 概述

URDF Studio 使用 WebAssembly 版本的 OpenUSD 来实现 USD 场景解析和渲染。本项目内置了魔改版 OpenUSD 源码和构建脚本，确保所有开发者使用相同的 WASM 运行时。

## 目录结构

```
urdf-studio/
├── third_party/OpenUSD/        # 魔改版 OpenUSD 源码 (270M)
├── scripts/build/
│   ├── rebuild-usd-wasm.sh    # 主编译脚本
│   ├── sync-openusd-source.sh # 源码同步脚本
│   └── README.md             # 使用文档
├── public/patches/            # JS 兼容性补丁
└── public/usd/bindings/      # 编译产物输出目录
```

## 前置条件

需要：Emscripten SDK、Python 3、**CMake ≥ 3.24**、Binaryen（`wasm-opt`）。

安装步骤见 [scripts/build/README.md](../scripts/build/README.md)。

**CMake 版本陷阱**：OpenUSD 声明 3.14+ 即可，但实际需要 3.24+（用了 `LINK_LIBRARY` generator expression）；低于 3.24 会在配置阶段失败，见下文「故障排查」。

## 快速开始

### 标准编译

```bash
# 激活 emscripten 环境
source ~/.localdeps/emsdk/emsdk_env.sh

# 编译（推荐配置）
bash scripts/build/rebuild-usd-wasm.sh \
  --robot-trim \
  --usd-repo ./third_party/OpenUSD \
  --build-dir ~/.localdeps/openusd-wasm-speed
```

输出到默认 `public/usd/bindings/` 时，脚本会根据四个 bindings 文件的内容同步 `USD_BINDINGS_CACHE_KEY`，使浏览器重新获取整套资源。手动复制编译产物后也必须运行 `npm run usd:bindings:version`；`npm run usd:bindings:check` 可检查是否漏更新，应用构建会执行同一检查。请将 bindings 和版本变更一起提交，避免旧 JS 与新 WASM 的函数签名不匹配。

### 编译选项详解

| 选项 | 说明 | 推荐值 |
|------|------|--------|
| `--robot-trim` | 修剪非机器人插件，保留核心渲染/物理功能 | ✅ 使用 |
| `--debug` | 构建 debug 版本 | 默认 release |
| `--size-opt` | 优化体积 (-Oz 而非 -O3) | 不推荐 |
| `--no-strip-debug` | 保留调试信息 | 不推荐 |
| `--skip-wasm-opt` | 跳过 wasm-opt 优化 | 不推荐 |
| `--emsdk-env` | 指定 emsdk_env.sh 路径 | 默认自动检测 |
| `--dest-dir` | 指定输出目录 | 默认 `./public/usd/bindings` |

### 环境变量

```bash
JOBS=8                    # 并行编译任务数（默认自动检测）
EMSCRIPTEN_OPT_LEVEL=-O3  # C/C++ 编译优化级别
EMSCRIPTEN_ENABLE_SIMD=1  # 启用 WASM SIMD
WASM_OPT_LEVEL=-O3        # wasm-opt 优化级别
```

## 编译产物

编译完成后，以下文件会被复制到 `public/usd/bindings/`：

| 文件 | 说明 | 大小 |
|------|------|------|
| `emHdBindings.js` | WASM 模块加载器和 JS 接口 | ~200KB |
| `emHdBindings.wasm` | 编译后的 OpenUSD C++ 代码 | ~18MB |
| `emHdBindings.worker.js` | Web Worker 线程支持 | ~3KB |
| `emHdBindings.data` | 预加载的数据文件 | ~850KB |

## OpenUSD 魔改说明

本项目使用的 OpenUSD 包含以下自定义修改：

1. **Emscripten 兼容性补丁**
   - WebAssembly 环境适配
   - 文件系统 API 修改

2. **构建配置调整**
   - 针对浏览器环境的优化
   - 机器人模型相关的性能改进

3. **补丁文件** (`public/patches/`)
   - `abort.patch`: 放宽 abort 行为，允许单个资源失败后继续加载
   - `arguments_*.patch`: 参数传递兼容性修复
   - `fileSystem.patch`: 文件系统 API 适配

## 故障排查

### CMake 配置失败：`Error evaluating generator expression`

```
Error evaluating generator expression:
    $<LINK_LIBRARY:LOAD_PLUGIN,hdStorm_internal>

  Expression did not evaluate to a known generator expression
```

**原因**：CMake 版本太老，OpenUSD 需要 3.24+。升级 CMake（步骤见 `scripts/build/README.md`）。

### 前置条件未生效（emcc / wasm-opt 缺失、找不到 OpenUSD 脚本）

按顺序检查：
1. `source ~/.localdeps/emsdk/emsdk_env.sh` 是否已执行 → `emcc --version`
2. `wasm-opt --version` → 缺失时 `apt install binaryen` / `brew install binaryen`
3. `ls third_party/OpenUSD/build_scripts/build_usd.py` 确认源码路径

### 编译时间过长

- 首次编译可能需要 30-60 分钟
- 增量编译会快很多
- 可以增加 `JOBS` 参数提高并行度

## Mesh 解析器 WASM 模块（Collada / OBJ，独立于 OpenUSD）

除 OpenUSD 外，项目还内置两个**独立的、手写的** mesh 解析 WASM 模块，与上面的 OpenUSD 构建链路完全无关：

| 模块 | C++ 源（手写，单 TU） | 构建脚本 | 产物 |
| --- | --- | --- | --- |
| Collada(.dae) | `src/core/loaders/wasm/collada_mesh_parser.cpp` (~3100 行) | `scripts/build/rebuild-collada-mesh-parser-wasm.sh` | `public/wasm/collada-mesh-parser/colladaMeshParser.{js,wasm}` |
| OBJ(.obj) | `src/core/loaders/wasm/obj_parser.cpp` (~1160 行) | `scripts/build/rebuild-obj-parser-wasm.sh` | `public/wasm/obj-parser/objParser.{js,wasm}` |

### ABI：C-ABI，不是 embind

这两个模块用 **C-ABI `EXPORTED_FUNCTIONS`** 构建（**不是** embind——源码无 `emscripten/bind.h` / `EMSCRIPTEN_BINDINGS` / `--bind`）。调用方手动经 `HEAPU8` marshalling：输入字节 `_malloc` 进堆 → 调 `_parse_collada_mesh` / `_parse_obj` → 用 `_*_get_result_ptr` / `_*_get_result_size` 读出二进制结果 → `_*_free_result` 释放。消费端见 `src/core/loaders/colladaWasmParser.ts`、`objWasmParser.ts`（按路径字符串加载 glue，从不作为 TS 模块 import）。

### 重新构建

```bash
source ~/.localdeps/emsdk/emsdk_env.sh      # 或 --emsdk-env <path>
bash scripts/build/rebuild-collada-mesh-parser-wasm.sh
bash scripts/build/rebuild-obj-parser-wasm.sh
```

canonical release flag（脚本默认）：`-std=c++17 -O3 -flto -msimd128 -s MODULARIZE=1 -s EXPORT_ES6=1 -s FILESYSTEM=0 -s ALLOW_MEMORY_GROWTH=1 -s MALLOC=emmalloc`，`EXPORTED_RUNTIME_METHODS=["HEAPU8"]`。`--debug` 走 `-O0 -g3 -s ASSERTIONS=2`。环境变量 `EMSCRIPTEN_OPT_LEVEL`（默认 `-O3`）、`EMSCRIPTEN_ENABLE_SIMD`（默认 `1`）。

### ⚠️ 勿手改生成产物

`public/wasm/**` 下的 `*.js`（emscripten glue）与 `*.wasm`（二进制）是**生成产物**。**不要手改**——任何修改都会在下次跑 rebuild 脚本时被静默覆盖。改逻辑请改对应 `.cpp` 再重跑脚本。

### 单 TU 政策与豁免

两个 `.cpp` 有意保留为**单翻译单元**（单 `.cpp` + `-flto` + 匿名 `namespace` 内部链接），拆成多 TU/头文件运行时零收益、只增 header 边界摩擦；它们已被所有 JS/TS lint/style/行长门排除。详见 [architecture.md](architecture.md) §11。风格由仓库根 `.clang-format` 固定（`clang-format -i src/core/loaders/wasm/*.cpp`）。

## 相关文档

- [viewer.md](viewer.md) - USD runtime 使用说明
- [architecture.md](architecture.md) §11 - 规模门禁与 WASM 单 TU 豁免政策
- [scripts/build/README.md](../scripts/build/README.md) - 脚本详细文档

## 许可证

OpenUSD 使用 Modified Apache 2.0 License，详见 `third_party/OpenUSD/LICENSE.txt`。手写 mesh 解析器（`src/core/loaders/wasm/*.cpp`）为本项目源码。
