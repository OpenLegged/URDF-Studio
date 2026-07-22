#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

import {
  ensureDir, collectFiles, retryPageAction, triggerRobotLoad,
} from '../../helpers/browser-helpers.mjs';

function normalizeZipPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function sanitizeTmpPrefix(prefix) {
  return String(prefix).replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'model';
}

export async function zipDir(dir) {
  const zip = new JSZip();
  for (const file of await collectFiles(dir)) {
    zip.file(normalizeZipPath(path.relative(dir, file)), await fs.readFile(file));
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

export async function resolveUploadedRobotFileName(page, expectedName, timeoutMs = 60_000) {
  const resolveSelection = (expected) => {
    const normalize = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    const basename = (value) => normalize(value).split('/').filter(Boolean).pop() ?? '';
    const matches = (candidateName, targetName) => {
      const candidate = normalize(candidateName);
      const target = normalize(targetName);
      const targetIncludesPath = target.includes('/');
      return (
        candidate === target ||
        candidate.endsWith(`/${target}`) ||
        (!targetIncludesPath && basename(candidate) === basename(target))
      );
    };
    const api = window.__URDF_STUDIO_DEBUG__;
    const snap = api?.getRegressionSnapshot?.();
    const selectedFile = snap?.selectedFile ?? null;
    const availableFiles = api?.getAvailableFiles?.() ?? [];
    const selectedMatches = selectedFile && matches(selectedFile.name, expected);
    const matchedFile =
      (selectedMatches ? selectedFile : null) ??
      availableFiles.find((file) => matches(file?.name, expected)) ??
      null;
    return {
      name: matchedFile?.name ?? null,
      selectedFile,
      availableFiles,
    };
  };

  await retryPageAction(
    () =>
      page.waitForFunction(
        (fn, resolverSource) => {
          const resolver = new Function(`return (${resolverSource})`)();
          return Boolean(resolver(fn).name);
        },
        // Large fixture archives can take more than five seconds to register
        // after upload. Preserve the caller's end-to-end timeout; navigation
        // context resets still reject early and are retried by retryPageAction.
        { timeout: timeoutMs },
        expectedName,
        resolveSelection.toString(),
      ),
    timeoutMs,
    `uploaded robot file "${expectedName}" registration`,
  );

  const result = await page.evaluate(
    (fn, resolverSource) => {
      const resolver = new Function(`return (${resolverSource})`)();
      return resolver(fn);
    },
    expectedName,
    resolveSelection.toString(),
  );
  if (!result?.name) {
    throw new Error(`Uploaded robot file "${expectedName}" was not registered: ${JSON.stringify(result)}`);
  }
  return result.name;
}

export async function importZippedModel(page, dir, fileName, timeoutMs = 60_000, tmpPrefix = 'model') {
  const zip = await zipDir(dir);
  const tmp = path.resolve(
    `tmp/regression/_${sanitizeTmpPrefix(tmpPrefix)}_${process.pid}_${Date.now()}.zip`,
  );
  await ensureDir(path.dirname(tmp));
  await fs.writeFile(tmp, zip);
  try {
    const input = await page.waitForSelector('input[type="file"]', { timeout: timeoutMs });
    await input.uploadFile(tmp);
    const resolvedFileName = await resolveUploadedRobotFileName(page, fileName, timeoutMs);
    await triggerRobotLoad(page, resolvedFileName, timeoutMs);
    return resolvedFileName;
  } finally {
    try { await fs.unlink(tmp); } catch {}
  }
}
