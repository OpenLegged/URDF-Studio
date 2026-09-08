import type { PreparedUsdPreloadFile } from './usdStageOpenPreparation.ts';

/** Materialize either preparation payload form without interpreting binary USD or textures as text. */
export async function readUsdPreloadBytes(entry: PreparedUsdPreloadFile): Promise<Uint8Array | null> {
  if (entry.bytes instanceof Uint8Array) return entry.bytes;
  if (entry.bytes instanceof ArrayBuffer) return new Uint8Array(entry.bytes);
  if (entry.blob) return new Uint8Array(await entry.blob.arrayBuffer());
  return null;
}
