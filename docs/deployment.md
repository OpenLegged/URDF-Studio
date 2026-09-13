# 部署与传输层优化

本文记录 URDF Studio 静态部署的传输层要求与参考配置。背景：应用层（代码分包、懒加载、USD WASM 空闲预取）已经就位，首访和回访体验的瓶颈在传输层——压缩、缓存策略、HTTP 协议版本。

## 实测基线（优化前，2026-09 线上冷缓存实测）

| 指标 | 数值 |
| --- | --- |
| 首访总传输 | ~29 MiB（9.3 MiB JS/CSS + ~20 MiB USD wasm 预取） |
| JS/CSS 传输 | 未压缩直出（服务器未启用 gzip/br） |
| wasm 缓存 | 仅 ETag/Last-Modified 协商，无 `Cache-Control` |
| 协议 | HTTP/1.1（ALPN 协商拒绝 h2，18 个并行 script 挤 6 条 TCP 连接） |
| load 事件 | ~2.9s（8.7 MiB 无压缩 JS 为主要成分） |

## 构建产物（`npm run build` 已自动完成）

`scripts/build/precompress.mjs` 在 build 末尾对 `dist/` 内所有可压缩产物生成预压缩 sidecar：

- `<file>.br`：文本用 brotli q11，≥1 MiB 的二进制（wasm/.data）用 q5（q11 对 19 MiB wasm 要 ~28s 只多省 ~0.5 MiB）
- `<file>.gz`：gzip -9，兜底不支持 brotli 的客户端

实测效果：首访传输 29 MiB → ~6 MiB（brotli，约 21%）/ ~7 MiB（gzip）。

注意：sidecar 文件必须随 `dist/` 一起部署上传。部署管线（rsync/OSS 同步等）需确认包含 `*.br`/`*.gz`；可用 `npm run precompress:check` 在部署前校验产物完整性。

缓存失效依赖文件名哈希（`/assets/*`）与版本参数（`/usd/bindings/*?v=`），见 `src/lib/robot-parser/usd/usdBindingsAssetPaths.ts` 的 `USD_BINDINGS_CACHE_KEY`。

## nginx 参考配置

需要包含 `ngx_http_brotli_static_module`（nginx-brotli）与 `ngx_http_gzip_static_module`。

```nginx
# 缓存策略集中到 map，避免 add_header 的继承陷阱
map $uri $cache_control {
    default                  "no-cache";
    ~^/assets/               "public, max-age=31536000, immutable";
    ~^/usd/bindings/         "public, max-age=31536000, immutable";
    ~^/fonts/                "public, max-age=31536000, immutable";
    ~^/logos/                "public, max-age=31536000, immutable";
    ~^/wasm/                 "public, max-age=86400";
    ~^/sitemap\.xml          "public, max-age=86400";
    ~^/manifest\.webmanifest "public, max-age=86400";
}

server {
    listen 443 ssl;
    http2 on;                # nginx >= 1.25.1；旧版本写 listen 443 ssl http2;
    server_name urdf.enkeebot.com;

    root /var/www/urdf-studio/dist;
    index index.html;

    # 跨域隔离：USD WASM 的 SharedArrayBuffer/pthread 必需 COOP+COEP。
    # COEP 取值二选一：
    #   credentialless —— 允许无 CORP 头的跨域子资源（如统计脚本），较新的
    #                      Chrome/Firefox 支持，当前线上即此配置；
    #   require-corp   —— 兼容性最好，但要求所有跨域子资源带 CORP/CORS 头，
    #                      与仓库 public/_headers 一致。
    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy credentialless always;
    add_header Cross-Origin-Resource-Policy same-site always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Cache-Control $cache_control always;

    # 预压缩优先：客户端声明 br 时直接发送 .br 静态文件（零运行时 CPU），
    # 否则回退 .gz（brotli_static 与 gzip_static 同开时，支持 br 的客户端拿 br）。
    brotli_static on;
    gzip_static on;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

要点：

1. **HTML（`/`、`/zh/`、`/en/`）必须 `no-cache`**：它引用的 chunk 文件名每次部署都变，缓存旧 HTML 会把用户钉死在旧 chunk 上。
2. **`/assets/*` 与 `/usd/bindings/*` 可以 `immutable` 一年**：URL 带内容哈希或 `?v=` 版本参数，发新版本即换 URL，无需失效。
3. **`/wasm/*` 是固定路径**（objParser/colladaMeshParser，无版本参数），只给 1 天 TTL 平衡更新时效与回访开销。
4. **HTTP/2 必须在流量入口层打开**。当前线上 `Server: BLB` 在 ALPN 里只接受 http/1.1——如果入口是 BLB/CDN，需要在那一层开 h2，或让 nginx 直接对外。HTTP/3 (QUIC) 可选，是下一步。
5. wasm 的 `Content-Type: application/wasm` 必须保持（`WebAssembly.instantiate` 依赖）。

## CDN（Cloudflare 等）

- Cloudflare 类 CDN 会自动做传输压缩（动态 brotli 低档），但**预压缩静态文件仍建议保留**：q11 压得比边缘动态压缩更小，且边缘零成本。
- `public/_headers`（build 会拷到 `dist/_headers`）已写好上述缓存与安全头策略，Cloudflare Pages 类主机可直接消费；nginx 部署则以上节配置为准。
- 前置 CDN 时确认 COOP/COEP 响应头原样透传，不要被 CDN 规则覆盖掉——丢掉这两个头 USD WASM 的 pthread 会直接不可用。

## 部署后验证

```bash
# 1. 压缩生效：应看到 content-encoding: br（或 gzip）
curl -sH 'Accept-Encoding: br' -D - -o /dev/null \
  https://urdf.enkeebot.com/assets/three-core-XXXX.js | grep -iE 'content-encoding|content-length'

# 2. 长缓存生效：应看到 immutable
curl -sI 'https://urdf.enkeebot.com/usd/bindings/emHdBindings.wasm?v=20260318a' | grep -i cache-control

# 3. 文档不缓存
curl -sI 'https://urdf.enkeebot.com/' | grep -i cache-control   # 期望 no-cache

# 4. HTTP/2
curl -sI --http2 https://urdf.enkeebot.com/ -o /dev/null -w '%{http_version}\n'  # 期望 2

# 5. 跨域隔离头仍在
curl -sI https://urdf.enkeebot.com/ | grep -i cross-origin
```

## 行业实践对照

| 实践 | 本仓库 | 头部公司 |
| --- | --- | --- |
| 内容寻址文件名 + immutable 长缓存 | ✅（hash chunk + `?v=`） | Google/Meta/Netflix 等全员标配 |
| HTML 不缓存（作为"部署指针"） | ✅（`no-cache`） | 同上 |
| 构建期预压缩静态 brotli（高压缩档） | ✅（本脚本） | Cloudflare、Netflix、Shopify 等；动态压缩只能用低档（CF 边缘约 q4-5），静态才用得起 q11 |
| HTTP/2 多路复用 | 配置已给，待入口层启用 | 全员；Google/Meta/Cloudflare 已推进 HTTP/3 (QUIC) |
| 103 Early Hints（提前推 modulepreload） | 未做，可选 | Cloudflare/Google 在推 |
| CDN 边缘缓存 + 分层回源 | 取决于部署侧 | 全员 |
| Service Worker 离线缓存 | 未做（大 wasm 回访全靠 HTTP 缓存） | Google Docs、Twitter Lite 等 |
| RUM 真实用户监控 + Lighthouse CI | 未做 | 全员 |

进一步的升级项（CDN、HTTP/3、Early Hints、SW）都属于部署/边缘层，仓库侧已把静态产物和缓存语义准备到位。
