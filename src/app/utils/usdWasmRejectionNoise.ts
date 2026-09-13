type UsdWasmRejectionScope = Pick<Window, 'crossOriginIsolated'> & {
  SharedArrayBuffer?: unknown;
};

const SAB_TRANSFER_REQUIRES_ISOLATION =
  'SharedArrayBuffer transfer requires self.crossOriginIsolated';

/**
 * Detects the one Emscripten pthread-pool rejection that leaks out of the vendored
 * `emHdBindings.js` when the USD WASM boot is attempted on a plain-HTTP LAN page.
 *
 * That rejection originates inside an internal `new Promise` in the vendored runtime
 * (no app-level `.catch` can reach it), so it surfaces as an unhandled rejection. It only
 * happens when the browser genuinely cannot provide `SharedArrayBuffer`; the one-shot
 * `[usd-wasm]` warning from `warnUsdRuntimeEnvironment` already explains the cause and
 * remedies. This predicate lets the global handler drop that duplicate without swallowing
 * anything else.
 */
export function isExpectedUsdWasmSharedArrayBufferRejection(
  reason: unknown,
  scope: UsdWasmRejectionScope | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  const resolvedScope: UsdWasmRejectionScope | undefined =
    scope ?? (typeof window === 'undefined' ? undefined : window);

  if (!(reason instanceof Error)) {
    return false;
  }

  if (!reason.message.includes(SAB_TRANSFER_REQUIRES_ISOLATION)) {
    return false;
  }

  return (
    resolvedScope?.crossOriginIsolated !== true &&
    typeof resolvedScope?.SharedArrayBuffer === 'undefined'
  );
}
