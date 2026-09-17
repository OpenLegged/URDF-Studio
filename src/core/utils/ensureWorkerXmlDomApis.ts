import { DOMParser as LinkedomDOMParser } from 'linkedom';
import { ensureWorkerImageDomApis } from './ensureWorkerImageDomApis';

type WorkerXmlScope = typeof globalThis & {
  DOMParser?: typeof DOMParser;
  XMLSerializer?: typeof XMLSerializer;
};

class WorkerXMLSerializerPolyfill {
  serializeToString(root: Node): string {
    const maybeDocument = root as Document;
    if (
      maybeDocument?.nodeType === 9
      && maybeDocument.documentElement
      && typeof maybeDocument.documentElement.toString === 'function'
    ) {
      return maybeDocument.documentElement.toString();
    }

    if (typeof (root as { toString?: () => string })?.toString === 'function') {
      return (root as { toString: () => string }).toString();
    }

    return '';
  }
}

export function ensureWorkerXmlDomApis(scope: WorkerXmlScope = globalThis as WorkerXmlScope): void {
  ensureWorkerImageDomApis(scope);

  if (typeof scope.DOMParser !== 'function') {
    scope.DOMParser = LinkedomDOMParser as unknown as typeof DOMParser;
  }

  if (typeof scope.XMLSerializer !== 'function') {
    scope.XMLSerializer = WorkerXMLSerializerPolyfill as unknown as typeof XMLSerializer;
  }
}
