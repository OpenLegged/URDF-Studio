# USD WASM 构建脚本

本目录包含用于编译 OpenUSD WebAssembly 版本的构建脚本。

## 目录结构

```
scripts/build/
├── rebuild-usd-wasm.sh                   # OpenUSD 主编译脚本
├── sync-openusd-source.sh                # OpenUSD 源码同步脚本
├── rebuild-collada-mesh-parser-wasm.sh   # Collada(.dae) mesh 解析器（独立 C-ABI 模块）
├── rebuild-obj-parser-wasm.sh            # OBJ(.obj) mesh 解析器（独立 C-ABI 模块）
├── precompress.mjs                       # 构建后对 dist/ 产物预生成 .br/.gz（npm run build 自动执行）
└── README.md                             # 本文档
```

相关目录：
```
third_party/OpenUSD/           # OpenUSD 源码（已魔改版本）
public/patches/               # 编译后 JS 兼容性补丁
public/usd/bindings/           # 编译产物输出目录
```

## 前置条件

1. **Emscripten SDK**
   ```bash
   # 安装 EMSDK（如果未安装）
   git clone https://github.com/emscripten-core/emsdk.git ~/.localdeps/emsdk
   cd ~/.localdeps/emsdk
   ./emsdk install latest
   ./emsdk activate latest
   source ./emsdk_env.sh
   ```

2. **Python 3** - 运行 build_usd.py

3. **wasm-opt** - 来自 Binaryen
   ```bash
   # Ubuntu/Debian
   sudo apt install binaryen
   ```

## 快速开始

### 编译 WASM

```bash
# 激活 emscripten 环境
source ~/.localdeps/emsdk/emsdk_env.sh

# 编译（使用项目内置的 OpenUSD 源码）
bash scripts/build/rebuild-usd-wasm.sh \
  --robot-trim \
  --usd-repo ./third_party/OpenUSD \
  --build-dir ~/.localdeps/openusd-wasm-speed
```

### 编译选项

| 选项 | 说明 |
|------|------|
| `--robot-trim` | 修剪非机器人插件，保留核心渲染/物理功能（推荐） |
| `--debug` | 构建 debug 版本（默认 release） |
| `--size-opt` | 优化体积（使用 -Oz 而非 -O3） |
| `--no-strip-debug` | 保留调试信息 |
| `--skip-wasm-opt` | 跳过 wasm-opt 优化步骤 |
| `--emsdk-env` | 指定 emsdk_env.sh 路径 |
| `--dest-dir` | 指定输出目录（默认 `./public/usd/bindings`） |

### 环境变量

```bash
JOBS=8                    # 并行编译任务数
EMSCRIPTEN_OPT_LEVEL=-O3  # C/C++ 编译优化级别
EMSCRIPTEN_ENABLE_SIMD=1  # 启用 WASM SIMD
WASM_OPT_LEVEL=-O3        # wasm-opt 优化级别
```

## 输出产物

编译完成后，以下文件会被复制到 `public/usd/bindings/`：

| 文件 | 说明 |
|------|------|
| `emHdBindings.js` | WASM 模块加载器和 JS 接口 |
| `emHdBindings.wasm` | 编译后的 OpenUSD C++ 代码 |
| `emHdBindings.worker.js` | Web Worker 线程支持 |
| `emHdBindings.data` | 预加载的数据文件 |

## OpenUSD 源码

项目使用内置的魔改版本 OpenUSD，位于 `third_party/OpenUSD/`。

### 主要修改

1. Emscripten 兼容性补丁
2. 针对 WASM 的构建配置调整
3. 机器人模型相关的性能优化

### 同步源码

如果有外部 OpenUSD 源码需要同步：

```bash
bash scripts/build/sync-openusd-source.sh
```

默认从 `~/.localdeps/OpenUSD` 同步到 `third_party/OpenUSD`。

## 故障排查

### 缺少 emcc 命令

确保已激活 emscripten 环境：
```bash
source ~/.localdeps/emsdk/emsdk_env.sh
emcc --version
```

### 构建失败

检查 OpenUSD 源码路径是否正确：
```bash
ls -la third_party/OpenUSD/build_scripts/build_usd.py
```

### wasm-opt 缺失

安装 Binaryen：
```bash
# Ubuntu/Debian
sudo apt install binaryen

# macOS
brew install binaryen
```

## Mesh 解析器构建（Collada / OBJ）

`rebuild-collada-mesh-parser-wasm.sh` 与 `rebuild-obj-parser-wasm.sh` 编译两个**独立于 OpenUSD** 的手写 C-ABI mesh 解析模块（**非 embind**），与 USD 构建无依赖关系。

```bash
source ~/.localdeps/emsdk/emsdk_env.sh     # 或 --emsdk-env <path>
bash scripts/build/rebuild-collada-mesh-parser-wasm.sh   # -> public/wasm/collada-mesh-parser/colladaMeshParser.{js,wasm}
bash scripts/build/rebuild-obj-parser-wasm.sh            # -> public/wasm/obj-parser/objParser.{js,wasm}
```

- 源码：`src/core/loaders/wasm/collada_mesh_parser.cpp`、`obj_parser.cpp`（各为单翻译单元，有意保留不拆，见 [docs/architecture.md](../../docs/architecture.md) §11）。
- 选项：`--debug`（`-O0 -g3 -s ASSERTIONS=2`）、`--source <path>`、`--dest-dir <path>`、`--emsdk-env <path>`；环境变量 `EMSCRIPTEN_OPT_LEVEL`（默认 `-O3`）、`EMSCRIPTEN_ENABLE_SIMD`（默认 `1`，加 `-msimd128`）。release 默认 `-std=c++17 -O3 -flto`。
- **⚠️ 勿手改 `public/wasm/**` 下的 `.js`/`.wasm` 生成产物**——下次构建会静默覆盖；改逻辑改 `.cpp` 重跑脚本。
- 详细说明见 [docs/wasm-build.md](../../docs/wasm-build.md) §Mesh 解析器 WASM 模块。

## 许可证

OpenUSD 使用 Modified Apache 2.0 License，详见 `third_party/OpenUSD/LICENSE.txt`。手写 mesh 解析器（`src/core/loaders/wasm/*.cpp`）为本项目源码。
