import type { UsdSceneSnapshot } from '@/types';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import type { PreparedUsdExportCacheWorkerPayload } from './usdPreparedExportCacheWorkerTransfer.ts';

export interface PrepareUsdPreparedExportCacheWorkerRequest {
  type: 'prepare-usd-prepared-export-cache';
  requestId: number;
  snapshot: UsdSceneSnapshot;
  resolution: ViewerRobotDataResolution;
}

export interface PrepareUsdPreparedExportCacheWorkerResponse {
  type: 'prepare-usd-prepared-export-cache-result' | 'prepare-usd-prepared-export-cache-error';
  requestId: number;
  result?: PreparedUsdExportCacheWorkerPayload | null;
  error?: string;
}

export type UsdPreparedExportCacheWorkerRequest = PrepareUsdPreparedExportCacheWorkerRequest;
export type UsdPreparedExportCacheWorkerResponse = PrepareUsdPreparedExportCacheWorkerResponse;
