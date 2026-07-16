import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HANDOFF_BROADCAST_CHANNEL,
  HANDOFF_BROADCAST_TIMEOUT_MS,
  type HandoffBroadcastMessage,
  isAllowedHandoffOrigin,
  normalizeHandoffOrigin,
  readImportParamsFromUrl,
  stripImportParamsFromUrl,
} from '@/shared/utils/popupHandoffProtocol';
import { getRuntimeLanguageTranslations } from '@/shared/i18n';
import type { AppImportResult } from '../appExtensions';

// ---------------------------------------------------------------------------
//  Title blink utility — draws attention to an existing tab
// ---------------------------------------------------------------------------

let blinkTimer: ReturnType<typeof setInterval> | null = null;
let blinkTimeout: ReturnType<typeof setTimeout> | null = null;
let savedOriginalTitle: string | null = null;

/** Flag to prevent self-delegation: when this tab is broadcasting an import-request,
 *  its own listener must not claim it. */
let isDelegating = false;

function startTitleBlink(alertTitle: string) {
  // Clean up any existing blink first
  stopTitleBlink();

  savedOriginalTitle = document.title;
  let show = true;

  blinkTimer = setInterval(() => {
    document.title = show ? alertTitle : (savedOriginalTitle ?? document.title);
    show = !show;
  }, 800);

  // Auto-restore after 5 seconds
  blinkTimeout = setTimeout(() => stopTitleBlink(), 5000);

  // Restore immediately when user focuses this tab
  const onVis = () => {
    if (!document.hidden) {
      stopTitleBlink();
      document.removeEventListener('visibilitychange', onVis);
    }
  };
  document.addEventListener('visibilitychange', onVis);
}

function stopTitleBlink() {
  if (blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
  if (blinkTimeout) {
    clearTimeout(blinkTimeout);
    blinkTimeout = null;
  }
  if (savedOriginalTitle !== null) {
    document.title = savedOriginalTitle;
    savedOriginalTitle = null;
  }
}

export interface FileDownloadInfo {
  path: string;
  url: string;
}

interface AssetDownloadResponse {
  success: boolean;
  message?: string;
  data?: {
    files: FileDownloadInfo[];
    rootFolderName: string;
    urdfFile?: string;
  };
}

const MAX_REMOTE_IMPORT_FILE_COUNT = 2_000;
const MAX_REMOTE_IMPORT_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_REMOTE_IMPORT_SINGLE_FILE_BYTES = 512 * 1024 * 1024;
// 并行下载文件时的最大并发请求数。用 worker pool 限流，避免一次性发起全部请求
// （资产最多含 MAX_REMOTE_IMPORT_FILE_COUNT 个文件）压垮浏览器与对象存储。
const REMOTE_IMPORT_DOWNLOAD_CONCURRENCY = 8;

export interface ImportFromUrlProgress {
  /** Current file index (1-based) */
  current: number;
  /** Total number of files to download */
  total: number;
  /** Name of the file currently being downloaded */
  currentFileName?: string;
}

export type ImportPhase = 'waiting' | 'fetching' | 'downloading' | 'importing' | 'complete';

interface ImportFromUrlState {
  isImporting: boolean;
  error: string | null;
  phase: ImportPhase | null;
  progress: ImportFromUrlProgress | null;
}

type UseAssetImportFromUrlOptions = {
  handleImport: (files: readonly File[]) => Promise<AppImportResult>;
  onImportComplete?: (success: boolean) => void;
};

export function resolveAllowedRemoteImportOrigin(fromOrigin: string): string | null {
  const normalizedOrigin = normalizeHandoffOrigin(fromOrigin);
  if (!normalizedOrigin || !isAllowedHandoffOrigin(normalizedOrigin)) {
    return null;
  }

  return normalizedOrigin;
}

export function assertRemoteImportFileListWithinLimits(files: readonly FileDownloadInfo[]): void {
  if (files.length > MAX_REMOTE_IMPORT_FILE_COUNT) {
    throw new Error(
      `Remote import contains too many files (${files.length}). ` +
        `Maximum: ${MAX_REMOTE_IMPORT_FILE_COUNT}.`,
    );
  }
}

export function assertRemoteImportContentLengthWithinLimits(
  response: Response,
  currentTotalBytes: number,
): void {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return;
  }

  if (contentLength > MAX_REMOTE_IMPORT_SINGLE_FILE_BYTES) {
    throw new Error(
      `Remote file is too large (${contentLength} bytes). ` +
        `Maximum: ${MAX_REMOTE_IMPORT_SINGLE_FILE_BYTES} bytes.`,
    );
  }
  if (currentTotalBytes + contentLength > MAX_REMOTE_IMPORT_TOTAL_BYTES) {
    throw new Error(
      `Remote import is too large (${currentTotalBytes + contentLength} bytes). ` +
        `Maximum: ${MAX_REMOTE_IMPORT_TOTAL_BYTES} bytes.`,
    );
  }
}

export function assertRemoteImportBlobWithinLimits(blob: Blob, nextTotalBytes: number): void {
  if (blob.size > MAX_REMOTE_IMPORT_SINGLE_FILE_BYTES) {
    throw new Error(
      `Remote file is too large (${blob.size} bytes). ` +
        `Maximum: ${MAX_REMOTE_IMPORT_SINGLE_FILE_BYTES} bytes.`,
    );
  }
  if (nextTotalBytes > MAX_REMOTE_IMPORT_TOTAL_BYTES) {
    throw new Error(
      `Remote import is too large (${nextTotalBytes} bytes). ` +
        `Maximum: ${MAX_REMOTE_IMPORT_TOTAL_BYTES} bytes.`,
    );
  }
}

/** Converts the core import outcome into the success/failure contract used by remote handoffs. */
export function assertCompletedRemoteImport(result: AppImportResult): void {
  if (result.status === 'completed') {
    return;
  }

  throw new Error(
    result.status === 'failed'
      ? 'The downloaded files could not be imported.'
      : 'The downloaded file import was skipped.',
  );
}

/**
 * Hook to import assets from BOT-World via URL parameters.
 * Supports existing-tab detection via BroadcastChannel:
 *   - If an existing Studio tab is open, it claims the import and the new tab closes.
 *   - If no existing tab responds, the new tab handles the import itself.
 */
export function useAssetImportFromUrl(options: UseAssetImportFromUrlOptions) {
  const { handleImport, onImportComplete } = options;

  const [state, setState] = useState<ImportFromUrlState>({
    isImporting: false,
    error: null,
    phase: null,
    progress: null,
  });

  // Refs so BroadcastChannel listeners can access latest callbacks
  const handleImportRef = useRef(handleImport);
  handleImportRef.current = handleImport;
  const onImportCompleteRef = useRef(onImportComplete);
  onImportCompleteRef.current = onImportComplete;

  // -----------------------------------------------------------------------
  //  Core import logic (shared by self-import and delegated import)
  // -----------------------------------------------------------------------
  const importAssetFromBotWorld = useCallback(async (assetId: string, fromOrigin: string) => {
    const remoteImportOrigin = resolveAllowedRemoteImportOrigin(fromOrigin);
    if (!remoteImportOrigin) {
      setState({
        isImporting: false,
        error: `Unauthorized origin: ${fromOrigin}`,
        phase: null,
        progress: null,
      });
      console.error('[AssetImport] Unauthorized origin:', fromOrigin);
      return { success: false };
    }

    setState({ isImporting: true, error: null, phase: 'fetching', progress: null });

    try {
      const apiUrl = new URL('/api/download-asset', remoteImportOrigin);

      // ----------------------------------------------------------------------
      // 鉴权 token —— 切勿删除！
      //
      // 历史教训：这段 token 逻辑曾被当作“死代码”清理（commit 173cf727），
      // 直接导致从 BOT-World 导入资产时全部 401。恢复前请务必阅读本注释。
      //
      // botbase 后端的 POST /api/download-asset 由 AuthenticateToken 中间件保护
      // （botbase/internal/middleware/middleware.go），它只接受两种凭证：
      //   1. 查询参数 ?token=<VITE_API_TOKEN>
      //   2. 请求头 Authorization: Bearer <VITE_API_TOKEN>
      // 两者都缺 → 401；值不匹配 → 403。
      //
      // 不要加 credentials:'include'：该接口完全不读 cookie / session，仅校验
      // 上述静态服务级 token。加了反而会让浏览器在跨域调用时强制要求响应头
      // Access-Control-Allow-Credentials: true —— 本地 vite dev 代理没设这个头，
      // 导致从 BOT-World handoff 导入资产时 preflight 失败（生产 nginx 有配，所以
      // 线上不报错）。BotWorld 自己的同源调用也不带 credentials，两边保持一致。
      //
      // token 值由 Vite 在构建时从环境变量 VITE_API_TOKEN 注入。仓库不提交 .env
      // 是有意为之（生产由部署环境注入），本地源码看不到值 ≠ 死代码。取值必须与
      // botbase 后端 .env 的 VITE_API_TOKEN 一致（当前 urdf_studio_secret_token_2026）。
      // 参考：botbase/docs/conventions.md
      // ----------------------------------------------------------------------
      const token = import.meta.env.VITE_API_TOKEN;

      const response = await fetch(apiUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 必须保留：本接口唯一的鉴权方式，缺失则 401（见上方注释）
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ assetId }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const result: AssetDownloadResponse = await response.json();
      if (!result.success || !result.data?.files) {
        throw new Error(result.message || 'Failed to fetch asset files');
      }

      const { files, rootFolderName } = result.data;
      assertRemoteImportFileListWithinLimits(files);

      setState({
        isImporting: true,
        error: null,
        phase: 'downloading',
        progress: {
          current: 0,
          total: files.length,
          currentFileName: files[0]?.path.split('/').pop(),
        },
      });

      // 并行下载（受 REMOTE_IMPORT_DOWNLOAD_CONCURRENCY 限流的 worker pool）。
      // 不用 Promise.all(files.map(...))：那会同时发起全部请求，资产含上千文件时会
      // 压垮浏览器与对象存储。worker pool 保持稳定并发度，并按原始 index 写入
      // downloadedFiles，保证文件顺序与 files 一致（handleImport / webkitRelativePath
      // 均依赖此顺序）。任一文件失败 → Promise.all 立即 reject，由外层 catch 兜底。
      const downloadedFiles: File[] = new Array(files.length);
      let nextFileIndex = 0;
      let completedCount = 0;
      let totalDownloadedBytes = 0;

      const downloadWorker = async () => {
        while (true) {
          const index = nextFileIndex++;
          if (index >= files.length) return;
          const fileInfo = files[index];

          // 后端返回的文件 URL 自带访问凭证，且来自已鉴权的受信接口；其域名与 API 不同源
          // 属预期（浏览器直连对象存储拉取文件字节）。切勿在此加 origin 白名单或严格相等
          // 校验——那会误拒合法下载地址、导致导入失败（曾因该错误假设导致线上导入报错）。
          // 不带 credentials：URL 自带鉴权、不读 cookie，跨域带凭证反而可能触发 CORS 失败。
          const fileResp = await fetch(fileInfo.url);
          if (!fileResp.ok) {
            throw new Error(`Failed to download ${fileInfo.path}: ${fileResp.statusText}`);
          }

          const blob = await fileResp.blob();
          totalDownloadedBytes += blob.size;
          // 单文件大小检查立即生效；累计上限在并行下为 best-effort（JS 单线程下 += 不丢，
          // 但多 worker 交错检查会偏松），最终由循环外的汇总校验兜底。不再做 content-length
          // 预估校验——并行累加竞态明显且该字段常缺失。
          assertRemoteImportBlobWithinLimits(blob, totalDownloadedBytes);

          const fileName = fileInfo.path.split('/').pop() || fileInfo.path;
          const file = new File([blob], fileName, {
            type: blob.type || 'application/octet-stream',
          });
          Object.defineProperty(file, 'webkitRelativePath', {
            value: `${rootFolderName}/${fileInfo.path}`,
            configurable: true,
          });

          downloadedFiles[index] = file;

          completedCount++;
          setState((prev) => ({
            ...prev,
            progress: {
              current: completedCount,
              total: files.length,
              currentFileName: fileName,
            },
          }));
        }
      };

      const workerCount = Math.min(REMOTE_IMPORT_DOWNLOAD_CONCURRENCY, files.length);
      await Promise.all(Array.from({ length: workerCount }, () => downloadWorker()));

      // 并行下累计字节检查是 best-effort，此处对总量做一次确定性兜底。
      if (totalDownloadedBytes > MAX_REMOTE_IMPORT_TOTAL_BYTES) {
        throw new Error(
          `Remote import is too large (${totalDownloadedBytes} bytes). ` +
            `Maximum: ${MAX_REMOTE_IMPORT_TOTAL_BYTES} bytes.`,
        );
      }

      setState({
        isImporting: true,
        error: null,
        phase: 'importing',
        progress: { current: files.length, total: files.length },
      });
      const importResult = await handleImportRef.current(downloadedFiles);
      assertCompletedRemoteImport(importResult);

      setState({ isImporting: false, error: null, phase: 'complete', progress: null });

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[AssetImport] Import failed:', message);
      setState({ isImporting: false, error: message, phase: null, progress: null });
      return { success: false };
    }
  }, []);

  // -----------------------------------------------------------------------
  //  BroadcastChannel: listen for import requests from new tabs.
  //  When this (existing) tab receives an import-request, it claims it
  //  by sending import-accepted, then performs the import.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const channel = new BroadcastChannel(HANDOFF_BROADCAST_CHANNEL);

    channel.onmessage = (event: MessageEvent<HandoffBroadcastMessage>) => {
      const msg = event.data;
      if (msg?.type === 'import-request' && !isDelegating) {
        // Claim the import immediately
        channel.postMessage({
          type: 'import-accepted',
          assetId: msg.assetId,
        } satisfies HandoffBroadcastMessage);

        // Perform the import in this existing tab
        void importAssetFromBotWorld(msg.assetId, msg.fromOrigin).then((result) => {
          onImportCompleteRef.current?.(result.success);
        });

        const { t } = getRuntimeLanguageTranslations();
        startTitleBlink(t.botWorldImportTitleBlink);
      }
    };

    return () => channel.close();
  }, [importAssetFromBotWorld]);

  // -----------------------------------------------------------------------
  //  On mount: if URL has import params, show waiting overlay, try
  //  delegating to an existing tab. If no tab responds, handle here.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = readImportParamsFromUrl(window.location.href);
    if (!params) return;

    // Clean URL immediately to prevent re-processing
    const nextUrl = stripImportParamsFromUrl(window.location.href);
    window.history.replaceState(window.history.state, '', nextUrl);

    // Show waiting overlay while checking for existing tab
    setState({ isImporting: true, error: null, phase: 'waiting', progress: null });

    const channel = new BroadcastChannel(HANDOFF_BROADCAST_CHANNEL);
    let settled = false;

    const cleanup = () => {
      settled = true;
      channel.close();
    };

    // Listen for an existing tab accepting the import
    channel.onmessage = (event: MessageEvent<HandoffBroadcastMessage>) => {
      const msg = event.data;
      if (msg?.type === 'import-accepted' && msg.assetId === params.assetId && !settled) {
        cleanup();
        isDelegating = false;
        // Existing tab claimed it — close this new tab
        try {
          window.close();
        } catch {
          /* close() may be blocked */
        }
      }
    };

    // Broadcast the import request
    isDelegating = true;
    channel.postMessage({
      type: 'import-request',
      assetId: params.assetId,
      fromOrigin: params.fromOrigin,
    } satisfies HandoffBroadcastMessage);

    // If no existing tab responds, handle import here
    setTimeout(() => {
      if (!settled) {
        cleanup();
        isDelegating = false;
        void importAssetFromBotWorld(params.assetId, params.fromOrigin).then((result) => {
          onImportCompleteRef.current?.(result.success);
        });
      }
    }, HANDOFF_BROADCAST_TIMEOUT_MS);

    // No cleanup — the channel is closed by either the import-accepted
    // handler or the timeout. Closing it in cleanup would break Strict
    // Mode (channel dies before import-accepted arrives → double import).
  }, [importAssetFromBotWorld]);

  return {
    ...state,
    importAssetFromBotWorld,
  };
}
