import type { RobotData } from '@/types';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import type { PreparedUsdExportCacheResult } from './usdExportBundle.ts';

export interface PreparedUsdExportCacheTransferFile {
  path: string;
  mimeType: string;
  bytes: ArrayBuffer | null;
}

export interface PreparedUsdExportCacheWorkerPayload {
  stageSourcePath?: string | null;
  robotData: RobotData;
  resolution: ViewerRobotDataResolution;
  meshFiles: PreparedUsdExportCacheTransferFile[];
}

interface SerializedPreparedUsdExportCache {
  payload: PreparedUsdExportCacheWorkerPayload;
  transferables: ArrayBuffer[];
}

type PreparedUsdExportCacheTransferBytesCarrier = PreparedUsdExportCacheResult & {
  __meshFileBytes?: Record<string, Uint8Array>;
};

function cloneBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function serializePreparedUsdExportCacheFile(
  path: string,
  blob: Blob,
  meshFileBytes: Uint8Array | null,
): Promise<PreparedUsdExportCacheTransferFile> {
  if (meshFileBytes) {
    return {
      path,
      mimeType: blob.type,
      bytes: cloneBytesToArrayBuffer(meshFileBytes),
    };
  }

  try {
    return {
      path,
      mimeType: blob.type,
      bytes: await blob.arrayBuffer(),
    };
  } catch (error) {
    throw new Error(
      `Failed to serialize USD prepared export cache mesh "${path}" (${blob.type || 'application/octet-stream'}, ${blob.size} bytes).`,
      { cause: error },
    );
  }
}

export async function serializePreparedUsdExportCacheForWorker(
  payload: PreparedUsdExportCacheResult,
): Promise<SerializedPreparedUsdExportCache> {
  const meshFileBytes =
    (payload as PreparedUsdExportCacheTransferBytesCarrier).__meshFileBytes ?? null;
  const meshFiles = await Promise.all(
    Object.entries(payload.meshFiles).map(([path, blob]) =>
      serializePreparedUsdExportCacheFile(path, blob, meshFileBytes?.[path] ?? null),
    ),
  );

  return {
    payload: {
      stageSourcePath: payload.stageSourcePath ?? null,
      robotData: payload.robotData,
      resolution: payload.resolution,
      meshFiles,
    },
    transferables: meshFiles.flatMap((file) => (file.bytes ? [file.bytes] : [])),
  };
}

export function hydratePreparedUsdExportCacheFromWorker(
  payload: PreparedUsdExportCacheWorkerPayload,
): PreparedUsdExportCacheResult {
  return {
    stageSourcePath: payload.stageSourcePath ?? null,
    robotData: payload.robotData,
    resolution: payload.resolution,
    meshFiles: Object.fromEntries(
      payload.meshFiles.map((file) => [
        file.path,
        new Blob(file.bytes ? [file.bytes] : [], { type: file.mimeType || '' }),
      ]),
    ),
  };
}
