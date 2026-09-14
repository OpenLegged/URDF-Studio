import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/app';
import { AppErrorBoundary } from '@/app/components/AppErrorBoundary';
import { useUIStore } from '@/store';
import {
  getInitialLanguageFromUrl,
  hideSeoLanguagePathFromUserUrl,
} from '@/app/utils/initialLanguage';
import { getRuntimeLanguageTranslations } from '@/shared/i18n';
import { isExpectedUsdWasmSharedArrayBufferRejection } from '@/app/utils/usdWasmRejectionNoise';
import '@/styles/index.css';

// ponytail: 全局安全网 —— React 渲染期之外的错误（未 await 的 Promise reject、
// 同步抛出）在生产默认会被静默吞掉。这里落完整日志，让崩溃可诊断。
// 接到 App 内 toast 需要一个 React 侧订阅桥（toast 状态在 App 内），按需再加。
function logGlobalError(label: string, detail: unknown): void {
  console.error(`[URDF Studio] ${label}:`, detail);
}

function handleGlobalError(event: ErrorEvent): void {
  logGlobalError(
    getRuntimeLanguageTranslations().t.globalUncaughtError,
    event.error ?? event.message,
  );
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  // 该 rejection 来自 vendored emHdBindings 的内部 Promise（无法从调用链 catch），
  // 仅在浏览器确实不提供 SharedArrayBuffer 时出现，此时 [usd-wasm] 一次性警告
  // 已给出原因与修复方式，这里静默去重避免重复噪音。
  if (isExpectedUsdWasmSharedArrayBufferRejection(event.reason)) {
    // preventDefault() 同时抑制 Chrome 自带的 "Uncaught (in promise)" 控制台条目。
    event.preventDefault();
    return;
  }
  logGlobalError(getRuntimeLanguageTranslations().t.globalUnhandledRejection, event.reason);
}

window.addEventListener('error', handleGlobalError);
window.addEventListener('unhandledrejection', handleUnhandledRejection);
import.meta.hot?.dispose(() => {
  window.removeEventListener('error', handleGlobalError);
  window.removeEventListener('unhandledrejection', handleUnhandledRejection);
});

// SEO emits a Chinese static entry at /zh/. Use it as an initial language hint
// for direct visits, then hide the SEO-only path before the interactive app runs.
const urlLanguage = getInitialLanguageFromUrl();
if (urlLanguage !== null) {
  useUIStore.getState().setLang(urlLanguage);
  hideSeoLanguagePathFromUserUrl();
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
