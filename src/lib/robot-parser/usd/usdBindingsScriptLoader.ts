export {
  appendCacheKey,
  buildUsdBindingsAssetPath,
  buildUsdBindingsScriptUrl,
} from './usdBindingsAssetPaths.ts';

let classicScriptLoadState = new WeakMap<Document, Map<string, Promise<void>>>();
let workerClassicScriptLoadState = new Map<string, Promise<void>>();

function resolveDocument(targetDocument?: Document): Document {
  const resolvedDocument = targetDocument ?? globalThis.document;
  if (!resolvedDocument) {
    throw new ReferenceError('Document is unavailable for USD bindings script loading.');
  }

  return resolvedDocument;
}

function resolveGlobalScriptUrl(src: string): string {
  const baseHref = String(globalThis.location?.href || 'http://localhost/');
  return new URL(src, baseHref).href;
}

function ensureClassicScriptLoadedInWorker(src: string): Promise<void> {
  const resolvedSrc = resolveGlobalScriptUrl(src);
  const existingPromise = workerClassicScriptLoadState.get(resolvedSrc);
  if (existingPromise) {
    return existingPromise;
  }

  const loadPromise = (async () => {
    const response = await fetch(resolvedSrc);
    if (!response.ok) {
      throw new Error(`Failed to load USD bindings script: ${resolvedSrc}`);
    }

    const scriptSource = await response.text();
    const globalEval = globalThis.eval.bind(globalThis) as (code: string) => unknown;
    globalEval(`${scriptSource}\n//# sourceURL=${resolvedSrc}`);
  })().catch((error) => {
    workerClassicScriptLoadState.delete(resolvedSrc);
    throw error;
  });

  workerClassicScriptLoadState.set(resolvedSrc, loadPromise);
  return loadPromise;
}

function getDocumentLoadState(targetDocument: Document): Map<string, Promise<void>> {
  const existingState = classicScriptLoadState.get(targetDocument);
  if (existingState) {
    return existingState;
  }

  const nextState = new Map<string, Promise<void>>();
  classicScriptLoadState.set(targetDocument, nextState);
  return nextState;
}

function resolveScriptUrl(src: string, targetDocument: Document): string {
  return new URL(src, targetDocument.baseURI).href;
}

function findExistingScript(src: string, targetDocument: Document): HTMLScriptElement | null {
  const resolvedSrc = resolveScriptUrl(src, targetDocument);
  const scripts = targetDocument.querySelectorAll('script[src]');

  for (const script of scripts) {
    if ((script as HTMLScriptElement).src === resolvedSrc) {
      return script as HTMLScriptElement;
    }
  }

  return null;
}

export function ensureClassicScriptLoaded(src: string, targetDocument?: Document): Promise<void> {
  if (!targetDocument && typeof globalThis.document === 'undefined') {
    return ensureClassicScriptLoadedInWorker(src);
  }

  const resolvedDocument = resolveDocument(targetDocument);
  const documentLoadState = getDocumentLoadState(resolvedDocument);
  const existingPromise = documentLoadState.get(src);
  if (existingPromise) {
    return existingPromise;
  }

  const existingScript = findExistingScript(src, resolvedDocument);
  if (existingScript?.dataset.loaded === 'true') {
    const resolvedPromise = Promise.resolve();
    documentLoadState.set(src, resolvedPromise);
    return resolvedPromise;
  }

  const scriptElement = existingScript ?? resolvedDocument.createElement('script');
  if (!existingScript) {
    scriptElement.src = src;
    const appendTarget =
      resolvedDocument.head ?? resolvedDocument.documentElement ?? resolvedDocument.body;
    appendTarget?.appendChild(scriptElement);
  }

  const loadPromise = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      scriptElement.removeEventListener('load', handleLoad);
      scriptElement.removeEventListener('error', handleError);
    };

    const handleLoad = () => {
      scriptElement.dataset.loaded = 'true';
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      documentLoadState.delete(src);
      scriptElement.remove();
      reject(new Error(`Failed to load USD bindings script: ${src}`));
    };

    scriptElement.addEventListener('load', handleLoad, { once: true });
    scriptElement.addEventListener('error', handleError, { once: true });
  });

  documentLoadState.set(src, loadPromise);
  return loadPromise;
}

export function resetClassicScriptLoaderForTests(): void {
  classicScriptLoadState = new WeakMap<Document, Map<string, Promise<void>>>();
  workerClassicScriptLoadState = new Map<string, Promise<void>>();
}
