export interface AppBuildInfo {
  app: string;
  revision: string | null;
  coreRevision: string | null;
  builtAt: string;
  dirty: boolean | null;
}

export function createAppBuildInfo(options: {
  app: string;
  root: string;
  coreRoot?: string;
  warn?: (message: string) => void;
}): AppBuildInfo;
