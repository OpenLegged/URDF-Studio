#!/usr/bin/env node

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import puppeteer from 'puppeteer';
import { buildBrowserLaunchArgs } from '../helpers/browser-helpers.mjs';

const DEFAULT_SITE_URL = 'http://127.0.0.1:4173';
const DEFAULT_OUTPUT_PATH = path.resolve('tmp/regression/unitree-browser-selected.json');
const DEFAULT_SITE_TIMEOUT_MS = 120_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 240_000;
const DEFAULT_SEED_TIMEOUT_MS = 900_000;
const POST_READY_SILENT_WINDOW_MS = 750;
const MAX_CAPTURE_TEXT_USD_BYTES = 1024 * 1024;
const LARGE_TEXT_USD_SEED_BYTES = MAX_CAPTURE_TEXT_USD_BYTES + 32;
const DEFAULT_START_COMMAND = (host, port) =>
  `npm run dev -- --host ${host} --port ${port} --strictPort`;
const TEXT_FILE_EXTENSIONS = new Set(['.json', '.mdl', '.mtl', '.txt', '.urdf', '.usda', '.xml']);
const MESH_EXTENSIONS = new Set(['.dae', '.glb', '.gltf', '.obj', '.stl']);
const BUILTIN_MODEL_FIXTURES = {
  Go2: {
    sourceRoot: path.resolve('test/unitree_model/Go2'),
    exposedRoot: 'unitree_model/Go2',
    loadFileName: 'unitree_model/Go2/usd/go2.usd',
  },
  Go2W: {
    sourceRoot: path.resolve('test/unitree_model/Go2W'),
    exposedRoot: 'unitree_model/Go2W',
    loadFileName: 'unitree_model/Go2W/usd/go2w.usd',
  },
  B2: {
    sourceRoot: path.resolve('test/unitree_model/B2'),
    exposedRoot: 'unitree_model/B2',
    loadFileName: 'unitree_model/B2/usd/b2.usd',
  },
  H1: {
    sourceRoot: path.resolve('test/unitree_model/H1/h1'),
    exposedRoot: 'unitree_model/H1/h1',
    loadFileName: 'unitree_model/H1/h1/usd/h1.usd',
  },
  'H1-2': {
    sourceRoot: path.resolve('test/unitree_model/H1-2/h1_2'),
    exposedRoot: 'unitree_model/H1-2/h1_2',
    loadFileName: 'unitree_model/H1-2/h1_2/h1_2.usd',
  },
  'H1-2-Handless': {
    sourceRoot: path.resolve('test/unitree_model/H1-2/h1_2_handless'),
    exposedRoot: 'unitree_model/H1-2/h1_2_handless',
    loadFileName: 'unitree_model/H1-2/h1_2_handless/h1_2_handless.usd',
  },
  'G1-23DoF': {
    sourceRoot: path.resolve('test/unitree_model/G1/23dof'),
    exposedRoot: 'unitree_model/G1/23dof',
    loadFileName: 'unitree_model/G1/23dof/usd/g1_23dof_rev_1_0/g1_23dof_rev_1_0.usd',
  },
  'G1-29DoF': {
    sourceRoot: path.resolve('test/unitree_model/G1/29dof'),
    exposedRoot: 'unitree_model/G1/29dof',
    loadFileName: 'unitree_model/G1/29dof/usd/g1_29dof_rev_1_0/g1_29dof_rev_1_0.usd',
  },
};

function fail(message) {
  throw new Error(message);
}

function parseInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

function normalizeSiteUrl(siteUrl) {
  const normalized = new URL(siteUrl);
  normalized.searchParams.set('regressionDebug', '1');
  return normalized.toString();
}

function buildHelpText({ scriptName, defaultOutputPath }) {
  return `Usage:
  node scripts/test/browser/${scriptName} [options]

Options:
  --site-url <url>          URDF Studio site URL. Default: ${DEFAULT_SITE_URL}
  --output <path>           Result JSON path. Default: ${defaultOutputPath}
  --model <name>            Model key or file name to load. Repeatable.
  --site-timeout-ms <ms>    Site startup/connect timeout. Default: ${DEFAULT_SITE_TIMEOUT_MS}
  --timeout-ms <ms>         Per-model timeout. Default: ${DEFAULT_OPERATION_TIMEOUT_MS}
  --start-command <cmd>     Override auto-start command when the site is offline.
  --preserve-usd-root       Load the requested USD root directly instead of synthetic roundtrip roots.
  --no-start                Fail instead of starting the site automatically.
  --headed                  Launch headed browser instead of headless.
  --help                    Show this help.
`;
}

function parseArgs(argv, config) {
  const options = {
    siteUrl: DEFAULT_SITE_URL,
    outputPath: config.defaultOutputPath,
    models: [],
    siteTimeoutMs: DEFAULT_SITE_TIMEOUT_MS,
    timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
    startCommand: null,
    preserveUsdRoot: false,
    noStart: false,
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (value == null) {
        fail(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case '--site-url':
        options.siteUrl = nextValue();
        break;
      case '--output':
        options.outputPath = path.resolve(nextValue());
        break;
      case '--model':
        options.models.push(nextValue());
        break;
      case '--site-timeout-ms':
        options.siteTimeoutMs = parseInteger(nextValue(), '--site-timeout-ms');
        break;
      case '--timeout-ms':
        options.timeoutMs = parseInteger(nextValue(), '--timeout-ms');
        break;
      case '--start-command':
        options.startCommand = nextValue();
        break;
      case '--preserve-usd-root':
        options.preserveUsdRoot = true;
        break;
      case '--no-start':
        options.noStart = true;
        break;
      case '--headed':
        options.headed = true;
        break;
      case '--help':
      case '-h':
        process.stdout.write(buildHelpText(config));
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  options.models = [...new Set(options.models.map((value) => value.trim()).filter(Boolean))];
  options.siteUrl = normalizeSiteUrl(options.siteUrl);

  if (options.models.length === 0) {
    fail('At least one --model must be provided.');
  }

  return options;
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function collectFiles(rootDir) {
  const files = [];

  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await visit(rootDir);
  return files;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function isSiteReachable(siteUrl, timeoutMs) {
  try {
    const response = await fetchWithTimeout(siteUrl, Math.min(timeoutMs, 10_000));
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureSite(options) {
  const targetUrl = new URL(options.siteUrl);
  const siteBaseUrl = `${targetUrl.protocol}//${targetUrl.host}`;
  if (await isSiteReachable(siteBaseUrl, options.siteTimeoutMs)) {
    return { stop: async () => {}, siteBaseUrl };
  }

  if (options.noStart) {
    fail(`Site is not reachable at ${siteBaseUrl} and --no-start was provided.`);
  }

  const host = targetUrl.hostname;
  const port = targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80');
  const command = options.startCommand || DEFAULT_START_COMMAND(host, port);
  const child = spawn(command, {
    cwd: process.cwd(),
    env: process.env,
    shell: true,
    detached: true,
    stdio: 'inherit',
  });

  const deadline = Date.now() + options.siteTimeoutMs;
  while (Date.now() < deadline) {
    if (await isSiteReachable(siteBaseUrl, options.siteTimeoutMs)) {
      return {
        siteBaseUrl,
        stop: async () => {
          if (child.exitCode != null || child.signalCode != null) {
            return;
          }
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {}
          await delay(500);
        },
      };
    }
    if (child.exitCode != null) {
      fail(`Site start command exited early with code ${child.exitCode}.`);
    }
    await delay(500);
  }

  fail(`Timed out waiting for URDF Studio at ${siteBaseUrl}.`);
}

async function openRegressionPage(options) {
  const browser = await puppeteer.launch({
    headless: options.headed ? false : true,
    args: buildPuppeteerLaunchArgs(),
    protocolTimeout: Math.max(options.timeoutMs * 2, 600_000),
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];

  page.on('console', (message) => {
    const type = String(message.type() || '').toLowerCase();
    if (type === 'error') {
      consoleErrors.push({
        type,
        text: message.text(),
        location: message.location(),
      });
      return;
    }
    if (type === 'warn' || type === 'warning') {
      if (isIgnorableBrowserConsoleWarning(message.text())) {
        return;
      }
      consoleWarnings.push({
        type,
        text: message.text(),
        location: message.location(),
      });
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push({
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
  });

  await page.goto(options.siteUrl, {
    waitUntil: 'domcontentloaded',
    timeout: options.timeoutMs,
  });
  await page.waitForFunction(() => Boolean(globalThis.window && window.__URDF_STUDIO_DEBUG__), {
    timeout: options.timeoutMs,
  });
  await waitForRegressionDebugAppHandlers(page, options.timeoutMs);
  await evaluateWithRetry(page, () => {
    window.__URDF_STUDIO_DEBUG__?.setBeforeUnloadPromptEnabled?.(false);
  });

  return {
    browser,
    consoleErrors,
    consoleWarnings,
    page,
    pageErrors,
  };
}

export function buildPuppeteerLaunchArgs() {
  return buildBrowserLaunchArgs();
}

export function isIgnorableBrowserConsoleWarning(text) {
  const message = String(text || '');
  return (
    message.includes('GL Driver Message') &&
    message.includes('Performance') &&
    message.includes('ReadPixels')
  );
}

async function waitForRegressionDebugAppHandlers(page, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const ready = await evaluateWithRetry(page, () => {
      const api = window.__URDF_STUDIO_DEBUG__;
      if (
        !api?.getRegressionSnapshot ||
        !api?.resetFixtureFiles ||
        !api?.seedFixtureFile ||
        !api?.loadRobotByName
      ) {
        return false;
      }
      const resetResult = api.resetFixtureFiles();
      return resetResult?.ok === true && Number.isFinite(Number(resetResult.availableFileCount));
    });
    if (ready) {
      return;
    }
    await delay(250);
  }

  throw new Error('Timed out waiting for regression debug app handlers.');
}

async function evaluateWithRetry(page, pageFunction, ...args) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await page.evaluate(pageFunction, ...args);
    } catch (error) {
      lastError = error;
      if (!isRetryableRuntimeError(error) || attempt === 3) {
        throw error;
      }
      await delay(250 * (attempt + 1));
    }
  }

  throw lastError ?? new Error('page.evaluate failed.');
}

function normalizeFileName(value) {
  return String(value || '').replace(/^\/+/, '');
}

function normalizeRelativeFixturePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function escapeUsdAssetPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/@/g, '\\@');
}

function buildSyntheticUnitreeUsdRoot({
  defaultPrim,
  baseLayerPath,
  physicsLayerPath,
  sensorLayerPath,
  robotLayerPath,
}) {
  const variantSetNames = ['Physics', 'Sensor'];
  if (robotLayerPath) {
    variantSetNames.push('Robot');
  }

  const renderVariant = (name, selectedVariant, variants) => {
    const lines = [
      `    variantSet "${name}" = {`,
      ...variants.map(({ variantName, layerPath }) => {
        if (!layerPath) {
          return `        "${variantName}" {\n\n        }`;
        }

        const directive = name === 'Physics' && variantName === 'None' ? 'references' : 'payload';
        const body =
          name === 'Physics' && variantName === 'None'
            ? [
                '            over "joints" (',
                '                active = false',
                '            )',
                '            {',
                '            }',
                '',
              ]
            : [''];

        return [
          `        "${variantName}" (`,
          `            prepend ${directive} = @${escapeUsdAssetPath(layerPath)}@`,
          '        ) {',
          ...body.map((line) => `            ${line}`.trimEnd()),
          '        }',
        ].join('\n');
      }),
      '    }',
    ];

    return { selectedVariant, text: lines.join('\n') };
  };

  const physicsVariant = renderVariant('Physics', 'PhysX', [
    { variantName: 'None', layerPath: baseLayerPath },
    { variantName: 'PhysX', layerPath: physicsLayerPath },
  ]);
  const sensorVariant = renderVariant('Sensor', 'Sensors', [
    { variantName: 'None', layerPath: null },
    { variantName: 'Sensors', layerPath: sensorLayerPath },
  ]);
  const robotVariant = robotLayerPath
    ? renderVariant('Robot', 'Robot', [
        { variantName: 'None', layerPath: null },
        { variantName: 'Robot', layerPath: robotLayerPath },
      ])
    : null;

  return [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${defaultPrim}"`,
    '    metersPerUnit = 1',
    '    upAxis = "Z"',
    ')',
    '',
    `def Xform "${defaultPrim}" (`,
    '    variants = {',
    `        string Physics = "${physicsVariant.selectedVariant}"`,
    ...(robotVariant ? [`        string Robot = "${robotVariant.selectedVariant}"`] : []),
    `        string Sensor = "${sensorVariant.selectedVariant}"`,
    '    }',
    `    prepend variantSets = [${variantSetNames.map((name) => `"${name}"`).join(', ')}]`,
    ')',
    '{',
    physicsVariant.text,
    sensorVariant.text,
    ...(robotVariant ? [robotVariant.text] : []),
    '}',
    '',
  ].join('\n');
}

function buildSyntheticUnitreeFixtureOverride(fixture, relativeFiles) {
  const normalizedLoadPath = normalizeRelativeFixturePath(
    normalizeFileName(fixture.loadFileName).replace(`${fixture.exposedRoot}/`, ''),
  );
  if (!normalizedLoadPath.toLowerCase().endsWith('.usd')) {
    return null;
  }

  const viewerRoundtripPath = normalizedLoadPath.replace(/\.usd$/i, '.viewer_roundtrip.usd');
  if (relativeFiles.includes(viewerRoundtripPath)) {
    return {
      loadFileName: `${fixture.exposedRoot}/${viewerRoundtripPath}`,
      inlineFile: null,
    };
  }

  const rootDir =
    path.posix.dirname(normalizedLoadPath) === '.' ? '' : path.posix.dirname(normalizedLoadPath);
  const rootBaseName = path.posix.basename(normalizedLoadPath, '.usd');
  const configurationDir = rootDir ? `${rootDir}/configuration` : 'configuration';
  const baseCandidates = relativeFiles
    .filter((relativePath) => relativePath.startsWith(`${configurationDir}/`))
    .filter((relativePath) => /_base\.usd$/i.test(relativePath));

  const preferredBasePath = `${configurationDir}/${rootBaseName}_base.usd`;
  const basePath =
    baseCandidates.find((relativePath) => relativePath === preferredBasePath) ??
    (baseCandidates.length === 1 ? baseCandidates[0] : null);
  if (!basePath) {
    return null;
  }

  const defaultPrim = path.posix.basename(basePath).replace(/_base\.usd$/i, '');
  const physicsPath = `${configurationDir}/${defaultPrim}_physics.usd`;
  const sensorPath = `${configurationDir}/${defaultPrim}_sensor.usd`;
  if (!relativeFiles.includes(physicsPath) || !relativeFiles.includes(sensorPath)) {
    return null;
  }

  const robotPath = `${configurationDir}/${defaultPrim}_robot.usd`;
  const syntheticPath = viewerRoundtripPath;

  return {
    loadFileName: `${fixture.exposedRoot}/${syntheticPath}`,
    inlineFile: {
      exposedName: `${fixture.exposedRoot}/${syntheticPath}`,
      format: 'usd',
      seedTextContent: buildSyntheticUnitreeUsdRoot({
        defaultPrim,
        baseLayerPath: path.posix.relative(path.posix.dirname(syntheticPath), basePath),
        physicsLayerPath: path.posix.relative(path.posix.dirname(syntheticPath), physicsPath),
        sensorLayerPath: path.posix.relative(path.posix.dirname(syntheticPath), sensorPath),
        robotLayerPath: relativeFiles.includes(robotPath)
          ? path.posix.relative(path.posix.dirname(syntheticPath), robotPath)
          : null,
      }),
      inlineBlobContent: buildSyntheticUnitreeUsdRoot({
        defaultPrim,
        baseLayerPath: path.posix.relative(path.posix.dirname(syntheticPath), basePath),
        physicsLayerPath: path.posix.relative(path.posix.dirname(syntheticPath), physicsPath),
        sensorLayerPath: path.posix.relative(path.posix.dirname(syntheticPath), sensorPath),
        robotLayerPath: relativeFiles.includes(robotPath)
          ? path.posix.relative(path.posix.dirname(syntheticPath), robotPath)
          : null,
      }),
    },
  };
}

function resolveFixtureDescriptor(modelKey) {
  const builtInFixture = BUILTIN_MODEL_FIXTURES[modelKey];
  if (builtInFixture) {
    return builtInFixture;
  }

  const absoluteModelPath = path.resolve(modelKey);
  if ((modelKey.endsWith('.usd') || modelKey.endsWith('.usda')) && existsSync(absoluteModelPath)) {
    const sourceRoot = path.dirname(absoluteModelPath);
    const exposedRoot = path.basename(sourceRoot);
    return {
      sourceRoot,
      exposedRoot,
      loadFileName: `${exposedRoot}/${path.basename(absoluteModelPath)}`.replace(/\\/g, '/'),
    };
  }

  if (modelKey.endsWith('.usda')) {
    const rootSegment = modelKey.split('/')[0];
    if (!rootSegment) {
      return null;
    }
    return {
      sourceRoot: path.resolve('test/unitree_ros_usda', rootSegment),
      exposedRoot: rootSegment,
      loadFileName: modelKey,
    };
  }

  return null;
}

function resolveSeededFileFormat(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.usd' || extension === '.usda') {
    return 'usd';
  }
  if (extension === '.urdf') {
    return 'urdf';
  }
  if (extension === '.xml') {
    return 'mjcf';
  }
  if (MESH_EXTENSIONS.has(extension)) {
    return 'mesh';
  }
  return 'asset';
}

function shouldCaptureTextContent(fileName) {
  return TEXT_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

async function isLikelyTextUsdFile(filePath) {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(32);
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0, bytesRead).toString('utf8');
    return prefix.trimStart().startsWith('#usda');
  } finally {
    await fileHandle.close();
  }
}

async function readUsdTextSeedPrefix(filePath, byteCount = LARGE_TEXT_USD_SEED_BYTES) {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fileHandle.close();
  }
}

async function resolveSeedContent(sourcePath, exposedName) {
  const extension = path.extname(exposedName).toLowerCase();
  if (extension === '.usda') {
    const { size } = await fs.stat(sourcePath);
    if (size <= MAX_CAPTURE_TEXT_USD_BYTES) {
      return { captureTextContent: true, seedTextContent: null };
    }
    return {
      captureTextContent: false,
      seedTextContent: await readUsdTextSeedPrefix(sourcePath),
    };
  }

  if (extension === '.usd') {
    const isTextUsd = await isLikelyTextUsdFile(sourcePath);
    if (!isTextUsd) {
      return { captureTextContent: false, seedTextContent: null };
    }
    const { size } = await fs.stat(sourcePath);
    if (size > MAX_CAPTURE_TEXT_USD_BYTES) {
      return {
        captureTextContent: false,
        seedTextContent: await readUsdTextSeedPrefix(sourcePath),
      };
    }
    return { captureTextContent: true, seedTextContent: null };
  }

  return {
    captureTextContent: shouldCaptureTextContent(exposedName),
    seedTextContent: null,
  };
}

async function buildSeedDescriptor(modelKey, options = {}) {
  const fixture = resolveFixtureDescriptor(modelKey);
  if (!fixture) {
    return null;
  }

  if (!(await pathExists(fixture.sourceRoot))) {
    return null;
  }

  const sourceFiles = await collectFiles(fixture.sourceRoot);
  const relativeFiles = sourceFiles.map((sourcePath) =>
    path.relative(fixture.sourceRoot, sourcePath).replace(/\\/g, '/'),
  );
  const normalizedLoadPath = normalizeRelativeFixturePath(
    normalizeFileName(fixture.loadFileName).replace(`${fixture.exposedRoot}/`, ''),
  );
  const seedSourceFiles = options.preserveUsdRoot
    ? sourceFiles.filter((sourcePath) => {
        const relativePath = normalizeRelativeFixturePath(
          path.relative(fixture.sourceRoot, sourcePath).replace(/\\/g, '/'),
        );
        return (
          relativePath === normalizedLoadPath || !/\.viewer_roundtrip\.usd$/i.test(relativePath)
        );
      })
    : sourceFiles;
  const fixtureOverride = options.preserveUsdRoot
    ? null
    : buildSyntheticUnitreeFixtureOverride(fixture, relativeFiles);

  return {
    loadFileName: fixtureOverride?.loadFileName ?? fixture.loadFileName,
    files: [
      ...(await Promise.all(
        seedSourceFiles.map(async (sourcePath) => {
          const relativePath = path.relative(fixture.sourceRoot, sourcePath).replace(/\\/g, '/');
          const exposedName = `${fixture.exposedRoot}/${relativePath}`.replace(/\\/g, '/');
          const sourceUrlPath = `/${path.relative(process.cwd(), sourcePath).replace(/\\/g, '/')}`;
          const resolvedSeedContent = await resolveSeedContent(sourcePath, exposedName);
          return {
            sourceUrlPath,
            exposedName,
            format: resolveSeededFileFormat(exposedName),
            captureTextContent: resolvedSeedContent.captureTextContent,
            ...(typeof resolvedSeedContent.seedTextContent === 'string'
              ? { seedTextContent: resolvedSeedContent.seedTextContent }
              : {}),
          };
        }),
      )),
      ...(fixtureOverride?.inlineFile ? [fixtureOverride.inlineFile] : []),
    ],
  };
}

async function createInlineBlobUrl(page, { content, mimeType }) {
  return await evaluateWithRetry(
    page,
    ({ inlineContent, inlineMimeType }) =>
      URL.createObjectURL(new Blob([inlineContent], { type: inlineMimeType })),
    {
      inlineContent: content,
      inlineMimeType: mimeType,
    },
  );
}

async function beginSeedFixtureFile(page, file) {
  await evaluateWithRetry(
    page,
    (seedFile) => {
      const requestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
      window.__codexBrowserRegressionSeed = {
        requestId,
        exposedName: seedFile.exposedName,
        status: 'pending',
        error: null,
      };

      void (async () => {
        const normalizePath = (value) =>
          String(value || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, '');

        const directUrl =
          typeof seedFile.blobUrl === 'string' && seedFile.blobUrl
            ? seedFile.blobUrl
            : new URL(seedFile.sourceUrlPath, location.origin).toString();
        const exposedName = normalizePath(seedFile.exposedName);
        let content = '';
        if (typeof seedFile.seedTextContent === 'string') {
          content = seedFile.seedTextContent;
        } else if (seedFile.captureTextContent) {
          const response = await fetch(seedFile.sourceUrlPath, {
            cache: 'no-store',
          });
          if (!response.ok) {
            throw new Error(
              `Failed to fetch fixture file ${seedFile.sourceUrlPath}: ${response.status}`,
            );
          }
          content = await response.text();
        }

        const api = window.__URDF_STUDIO_DEBUG__;
        if (api?.seedFixtureFile) {
          const seedResult = api.seedFixtureFile({
            name: exposedName,
            content,
            format: seedFile.format,
            blobUrl: directUrl,
            addFileContent: seedFile.captureTextContent === true,
          });
          if (!seedResult?.ok) {
            throw new Error('Regression debug API failed to seed fixture file.');
          }
          if (window.__codexBrowserRegressionSeed?.requestId !== requestId) {
            return;
          }
          window.__codexBrowserRegressionSeed = {
            ...window.__codexBrowserRegressionSeed,
            status: 'done',
          };
          return;
        }

        const { useAssetsStore } = await import('/src/store/assetsStore.ts');
        const state = useAssetsStore.getState();
        state.addAsset(exposedName, directUrl);
        state.addRobotFile({
          name: exposedName,
          content,
          format: seedFile.format,
          blobUrl: directUrl,
        });
        if (seedFile.captureTextContent) {
          state.addFileContent(exposedName, content);
        }

        if (window.__codexBrowserRegressionSeed?.requestId !== requestId) {
          return;
        }
        window.__codexBrowserRegressionSeed = {
          ...window.__codexBrowserRegressionSeed,
          status: 'done',
        };
      })().catch((error) => {
        if (window.__codexBrowserRegressionSeed?.requestId !== requestId) {
          return;
        }
        window.__codexBrowserRegressionSeed = {
          ...window.__codexBrowserRegressionSeed,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      });
    },
    file,
  );
}

async function waitForSeedFixtureFile(page, file, timeoutMs = DEFAULT_SEED_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const seedStatus = await evaluateWithRetry(
      page,
      () => window.__codexBrowserRegressionSeed ?? null,
    );
    if (seedStatus?.status === 'done') {
      return;
    }
    if (seedStatus?.status === 'error') {
      throw new Error(seedStatus.error || 'Unknown fixture seed failure.');
    }
    await delay(250);
  }

  throw new Error(`Timed out seeding fixture file "${file.exposedName}".`);
}

async function seedFixtureFiles(page, seedDescriptor) {
  if (!seedDescriptor) {
    return null;
  }

  const preparedFiles = [];
  for (const file of seedDescriptor.files) {
    if (typeof file.inlineBlobContent === 'string') {
      preparedFiles.push({
        ...file,
        blobUrl: await createInlineBlobUrl(page, {
          content: file.inlineBlobContent,
          mimeType: 'text/plain;charset=utf-8',
        }),
      });
      continue;
    }

    preparedFiles.push(file);
  }

  await evaluateWithRetry(page, async () => {
    const api = window.__URDF_STUDIO_DEBUG__;
    if (api?.resetFixtureFiles) {
      api.resetFixtureFiles();
      return;
    }

    const { useAssetsStore } = await import('/src/store/assetsStore.ts');
    const state = useAssetsStore.getState();
    state.revokeAllAssets?.();
    state.setAssets({});
    state.setAvailableFiles([]);
    state.setAllFileContents({});
    state.clearUsdSceneSnapshots?.();
    state.clearUsdPreparedExportCaches?.();
    state.setSelectedFile(null);
    state.resetDocumentLoadState?.();
  });

  for (const file of preparedFiles) {
    await beginSeedFixtureFile(page, file);
    await waitForSeedFixtureFile(page, file);
  }

  return await evaluateWithRetry(
    page,
    async (descriptor) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      if (api?.getRegressionSnapshot) {
        return {
          loadFileName: descriptor.loadFileName,
          availableFileCount: api.getRegressionSnapshot()?.availableFiles?.length ?? 0,
        };
      }

      const { useAssetsStore } = await import('/src/store/assetsStore.ts');
      const state = useAssetsStore.getState();
      state.setSelectedFile(null);
      state.resetDocumentLoadState?.();
      return {
        loadFileName: descriptor.loadFileName,
        availableFileCount: state.availableFiles.length,
      };
    },
    {
      loadFileName: seedDescriptor.loadFileName,
    },
  );
}

async function assertSourceImportsAvailable(page) {
  const probe = await evaluateWithRetry(page, async () => {
    try {
      await import('/src/store/assetsStore.ts');
      return { ok: true, message: null };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  if (!probe?.ok) {
    fail(
      `The target site does not support direct /src module imports. Use a Vite dev server, not preview. Details: ${probe?.message || 'unknown error'}`,
    );
  }
}

function findLatestEntry(entries, fileNames, step) {
  const normalizedNames = new Set(
    fileNames.filter(Boolean).map((value) => normalizeFileName(value)),
  );
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.step !== step) {
      continue;
    }
    if (normalizedNames.size === 0) {
      return entry;
    }
    if (normalizedNames.has(normalizeFileName(entry.sourceFileName))) {
      return entry;
    }
  }
  return null;
}

function createHistoryEntrySignature(entry) {
  return JSON.stringify([
    normalizeFileName(entry?.sourceFileName),
    entry?.step ?? null,
    entry?.status ?? null,
    entry?.timestamp ?? null,
    typeof entry?.durationMs === 'number' ? entry.durationMs : null,
  ]);
}

function filterHistoryEntriesForFiles(entries, fileNames) {
  const normalizedNames = new Set(
    fileNames.filter(Boolean).map((value) => normalizeFileName(value)),
  );
  return Array.isArray(entries)
    ? entries.filter((entry) => {
        if (!entry) {
          return false;
        }
        if (normalizedNames.size === 0) {
          return true;
        }
        return normalizedNames.has(normalizeFileName(entry.sourceFileName));
      })
    : [];
}

export function summarizePostReadyHistoryDelta(beforeHistory, afterHistory, fileNames) {
  const beforeEntries = filterHistoryEntriesForFiles(beforeHistory, fileNames);
  const afterEntries = filterHistoryEntriesForFiles(afterHistory, fileNames);
  const remainingBeforeSignatures = new Map();

  beforeEntries.forEach((entry) => {
    const signature = createHistoryEntrySignature(entry);
    remainingBeforeSignatures.set(signature, (remainingBeforeSignatures.get(signature) ?? 0) + 1);
  });

  const newEntries = [];
  afterEntries.forEach((entry) => {
    const signature = createHistoryEntrySignature(entry);
    const remainingCount = remainingBeforeSignatures.get(signature) ?? 0;
    if (remainingCount > 0) {
      remainingBeforeSignatures.set(signature, remainingCount - 1);
      return;
    }
    newEntries.push(entry);
  });

  return {
    historyDelta: newEntries.length,
    newSteps: newEntries
      .map((entry) => (typeof entry?.step === 'string' ? entry.step : null))
      .filter(Boolean),
  };
}

function deriveMetadataSource(entries, fileNames) {
  const workerResolveEntry = findLatestEntry(entries, fileNames, 'commit-worker-robot-data');
  const runtimeResolveEntry = findLatestEntry(entries, fileNames, 'resolve-runtime-robot-data');
  const readyEntry = findLatestEntry(entries, fileNames, 'ready');
  const prepareEntry = findLatestEntry(entries, fileNames, 'prepare-stage-open-data');

  const metadataSource =
    runtimeResolveEntry?.detail?.metadataSource ??
    workerResolveEntry?.detail?.metadataSource ??
    readyEntry?.detail?.metadataSource ??
    null;
  const stagePreparationMode =
    prepareEntry?.detail?.stagePreparationMode ??
    runtimeResolveEntry?.detail?.stagePreparationMode ??
    workerResolveEntry?.detail?.stagePreparationMode ??
    readyEntry?.detail?.stagePreparationMode ??
    null;

  return {
    metadataSource,
    metadataSourcePass:
      typeof metadataSource === 'string' &&
      (metadataSource.startsWith('usd-stage') || metadataSource.startsWith('worker')),
    runtimeResolveEntry,
    stagePreparationMode,
    stageReady: readyEntry?.status === 'resolved',
    workerResolveEntry,
  };
}

function sanitizeAssetDebugState(assetDebugState) {
  if (!assetDebugState) {
    return null;
  }

  const signature = assetDebugState.viewerScopedSignature;
  return {
    ...assetDebugState,
    viewerScopedSignature:
      typeof signature === 'string' && signature.length > 512
        ? `${signature.slice(0, 512)}…<truncated>`
        : (signature ?? null),
  };
}

function sanitizeSelectedUsdSceneSummary(sceneSummary) {
  if (!sceneSummary) {
    return null;
  }

  const sanitizeBindingSummary = (bindingSummary) => ({
    descriptorCount: Number(bindingSummary?.descriptorCount ?? 0),
    withDescriptorMaterialId: Number(bindingSummary?.withDescriptorMaterialId ?? 0),
    withGeometryMaterialId: Number(bindingSummary?.withGeometryMaterialId ?? 0),
    withGeomSubsetSections: Number(bindingSummary?.withGeomSubsetSections ?? 0),
    withoutAnyMaterialBinding: Number(bindingSummary?.withoutAnyMaterialBinding ?? 0),
  });
  const sanitizeBounds = (bounds) => ({
    min: Array.isArray(bounds?.min) ? bounds.min.slice(0, 3) : null,
    max: Array.isArray(bounds?.max) ? bounds.max.slice(0, 3) : null,
    size: Array.isArray(bounds?.size) ? bounds.size.slice(0, 3) : null,
    center: Array.isArray(bounds?.center) ? bounds.center.slice(0, 3) : null,
  });
  const sanitizeTransform = (transform) =>
    transform
      ? {
          position: Array.isArray(transform.position) ? transform.position.slice(0, 3) : null,
          quaternion: Array.isArray(transform.quaternion) ? transform.quaternion.slice(0, 4) : null,
          scale: Array.isArray(transform.scale) ? transform.scale.slice(0, 3) : null,
        }
      : null;
  const sanitizeLinkPoseSummary = (linkPoses) => {
    const storeLinks = Array.isArray(linkPoses?.storeLinks)
      ? linkPoses.storeLinks.map((entry) => ({
          linkId: entry?.linkId ?? null,
          linkName: entry?.linkName ?? null,
          ...sanitizeTransform(entry),
        }))
      : [];
    return {
      source: linkPoses?.source ?? null,
      storeLinkCount: Number(linkPoses?.storeLinkCount ?? storeLinks.length),
      storeLinks,
    };
  };
  const sanitizeVector3Array = (value) => (Array.isArray(value) ? value.slice(0, 3).map(Number) : null);
  const sanitizeQuaternionArray = (value) =>
    Array.isArray(value) ? value.slice(0, 4).map(Number) : null;
  const sanitizeRobotMetadataSummary = (robotMetadata) =>
    robotMetadata
      ? {
          source: robotMetadata.source ?? null,
          jointCount: Number(robotMetadata.jointCount ?? 0),
          dynamicsCount: Number(robotMetadata.dynamicsCount ?? 0),
          joints: Array.isArray(robotMetadata.joints)
            ? robotMetadata.joints.map((joint) => ({
                jointPath: joint?.jointPath ?? null,
                jointName: joint?.jointName ?? null,
                jointType: joint?.jointType ?? null,
                childLinkPath: joint?.childLinkPath ?? null,
                parentLinkPath: joint?.parentLinkPath ?? null,
                axisToken: joint?.axisToken ?? null,
                localPos0: sanitizeVector3Array(joint?.localPos0),
                localRot0Wxyz: sanitizeQuaternionArray(joint?.localRot0Wxyz),
                localPos1: sanitizeVector3Array(joint?.localPos1),
                localRot1Wxyz: sanitizeQuaternionArray(joint?.localRot1Wxyz),
                originXyz: sanitizeVector3Array(joint?.originXyz),
                originQuatWxyz: sanitizeQuaternionArray(joint?.originQuatWxyz),
              }))
            : [],
        }
      : null;
  const sanitizeNormalDiagnostics = (entry) => {
    const source = entry?.normalDiagnostics ?? entry?.normalDiagnostic ?? entry;
    const normalRepairCount = source?.normalRepairCount;
    const postRepairLowDotCount = source?.postRepairLowDotCount;
    if (normalRepairCount == null && postRepairLowDotCount == null) {
      return null;
    }
    return {
      normalRepairCount: normalRepairCount == null ? null : Number(normalRepairCount),
      postRepairLowDotCount: postRepairLowDotCount == null ? null : Number(postRepairLowDotCount),
    };
  };
  const sanitizeMeshDiagnosticEntry = (entry) => ({
    meshId: entry?.meshId ?? null,
    resolvedPrimPath: entry?.resolvedPrimPath ?? null,
    linkPath: entry?.linkPath ?? null,
    sectionName: entry?.sectionName ?? null,
    normalDiagnostics: sanitizeNormalDiagnostics(entry),
  });
  const sanitizeDiagnosticEntries = (entries) =>
    Array.isArray(entries)
      ? entries
          .slice(0, 128)
          .map(sanitizeMeshDiagnosticEntry)
          .filter((entry) => entry.normalDiagnostics)
      : [];

  return {
    available: sceneSummary.available === true,
    fileName: sceneSummary.fileName ?? null,
    stageSourcePath: sceneSummary.stageSourcePath ?? null,
    defaultPrimPath: sceneSummary.defaultPrimPath ?? null,
    rootLinkId: sceneSummary.rootLinkId ?? null,
    meshDescriptorCount: Number(sceneSummary.meshDescriptorCount ?? 0),
    materialCount: Number(sceneSummary.materialCount ?? 0),
    bufferSummary: sceneSummary.bufferSummary
      ? {
          positionCount: Number(sceneSummary.bufferSummary.positionCount ?? 0),
          indexCount: Number(sceneSummary.bufferSummary.indexCount ?? 0),
          normalCount: Number(sceneSummary.bufferSummary.normalCount ?? 0),
          uvCount: Number(sceneSummary.bufferSummary.uvCount ?? 0),
          transformCount: Number(sceneSummary.bufferSummary.transformCount ?? 0),
          meshRangeCount: Number(sceneSummary.bufferSummary.meshRangeCount ?? 0),
        }
      : null,
    robotMetadata: sanitizeRobotMetadataSummary(sceneSummary.robotMetadata),
    linkPoses: sanitizeLinkPoseSummary(sceneSummary.linkPoses),
    bindingSummary: sanitizeBindingSummary(sceneSummary.bindingSummary),
    collisionSummary: sceneSummary.collisionSummary
      ? {
          totalDescriptorCount: Number(sceneSummary.collisionSummary.totalDescriptorCount ?? 0),
          linkCount: Number(sceneSummary.collisionSummary.linkCount ?? 0),
          links: Array.isArray(sceneSummary.collisionSummary.links)
            ? sceneSummary.collisionSummary.links.slice(0, 256).map((entry) => ({
                linkPath: entry?.linkPath ?? null,
                linkName: entry?.linkName ?? null,
                descriptorCount: Number(entry?.descriptorCount ?? 0),
                primitiveTypes:
                  entry?.primitiveTypes && typeof entry.primitiveTypes === 'object'
                    ? Object.fromEntries(
                        Object.entries(entry.primitiveTypes)
                          .slice(0, 32)
                          .map(([key, value]) => [key, Number(value ?? 0)]),
                      )
                    : {},
              }))
            : [],
        }
      : null,
    baseLink: sceneSummary.baseLink
      ? {
          found: sceneSummary.baseLink.found === true,
          linkPath: sceneSummary.baseLink.linkPath ?? null,
          visualDescriptorCount: Number(sceneSummary.baseLink.visualDescriptorCount ?? 0),
          collisionDescriptorCount: Number(sceneSummary.baseLink.collisionDescriptorCount ?? 0),
          primPaths: Array.isArray(sceneSummary.baseLink.primPaths)
            ? [...sceneSummary.baseLink.primPaths].slice(0, 16)
            : [],
          materialIds: Array.isArray(sceneSummary.baseLink.materialIds)
            ? [...sceneSummary.baseLink.materialIds].slice(0, 16)
            : [],
          geometryMaterialIds: Array.isArray(sceneSummary.baseLink.geometryMaterialIds)
            ? [...sceneSummary.baseLink.geometryMaterialIds].slice(0, 16)
            : [],
          geomSubsetMaterialIds: Array.isArray(sceneSummary.baseLink.geomSubsetMaterialIds)
            ? [...sceneSummary.baseLink.geomSubsetMaterialIds].slice(0, 16)
            : [],
          geomSubsetSectionCount: Number(sceneSummary.baseLink.geomSubsetSectionCount ?? 0),
          bindingSummary: sanitizeBindingSummary(sceneSummary.baseLink.bindingSummary),
          bounds: sanitizeBounds(sceneSummary.baseLink.bounds),
          transform: sanitizeTransform(sceneSummary.baseLink.transform),
          runtimeLinkTransform: sanitizeTransform(sceneSummary.baseLink.runtimeLinkTransform),
          runtimeVisualMeshTransforms: Array.isArray(
            sceneSummary.baseLink.runtimeVisualMeshTransforms,
          )
            ? sceneSummary.baseLink.runtimeVisualMeshTransforms.slice(0, 8).map((entry) => ({
                name: entry?.name ?? null,
                position: Array.isArray(entry?.position) ? entry.position.slice(0, 3) : null,
                quaternion: Array.isArray(entry?.quaternion) ? entry.quaternion.slice(0, 4) : null,
                scale: Array.isArray(entry?.scale) ? entry.scale.slice(0, 3) : null,
              }))
            : [],
          descriptors: Array.isArray(sceneSummary.baseLink.descriptors)
            ? sceneSummary.baseLink.descriptors.slice(0, 8).map((entry) => ({
                meshId: entry?.meshId ?? null,
                resolvedPrimPath: entry?.resolvedPrimPath ?? null,
                sectionName: entry?.sectionName ?? null,
                materialId: entry?.materialId ?? null,
                geometryMaterialId: entry?.geometryMaterialId ?? null,
                geometryVertexCount:
                  entry?.geometryVertexCount == null ? null : Number(entry.geometryVertexCount),
                geometryIndexCount:
                  entry?.geometryIndexCount == null ? null : Number(entry.geometryIndexCount),
                positionRangeCount:
                  entry?.positionRangeCount == null ? null : Number(entry.positionRangeCount),
                indexRangeCount:
                  entry?.indexRangeCount == null ? null : Number(entry.indexRangeCount),
                normalRangeCount:
                  entry?.normalRangeCount == null ? null : Number(entry.normalRangeCount),
                uvRangeCount: entry?.uvRangeCount == null ? null : Number(entry.uvRangeCount),
                transformRangeCount:
                  entry?.transformRangeCount == null ? null : Number(entry.transformRangeCount),
                geomSubsetSectionCount: Number(entry?.geomSubsetSectionCount ?? 0),
                geomSubsetMaterialIds: Array.isArray(entry?.geomSubsetMaterialIds)
                  ? [...entry.geomSubsetMaterialIds].slice(0, 16)
                  : [],
                normalDiagnostics: sanitizeNormalDiagnostics(entry),
              }))
            : [],
        }
      : null,
    meshes: sanitizeDiagnosticEntries(sceneSummary.meshes),
    meshDescriptors: sanitizeDiagnosticEntries(sceneSummary.meshDescriptors),
    descriptors: sanitizeDiagnosticEntries(sceneSummary.descriptors),
  };
}

function sanitizeSelectedUsdVisualMaterialSummary(summary) {
  if (!summary) {
    return null;
  }

  return {
    meshes: Array.isArray(summary.meshes)
      ? summary.meshes.slice(0, 128).map((mesh) => ({
          meshId: mesh?.meshId ?? null,
          linkPath: mesh?.linkPath ?? null,
          overrideColor: mesh?.overrideColor ?? null,
          hasOverrideMaterial: mesh?.hasOverrideMaterial === true,
          materials: Array.isArray(mesh?.materials)
            ? mesh.materials.slice(0, 32).map((material) => ({
                materialId: material?.materialId ?? null,
                name: material?.name ?? null,
                type: material?.type ?? null,
                color: material?.color ?? null,
                colorTuple: Array.isArray(material?.colorTuple)
                  ? material.colorTuple.slice(0, 3).map((entry) => Number(entry))
                  : null,
                colorSource: material?.colorSource ?? null,
                authoredColor: material?.authoredColor ?? null,
                authoredColorTuple: Array.isArray(material?.authoredColorTuple)
                  ? material.authoredColorTuple.slice(0, 3).map((entry) => Number(entry))
                  : null,
                emissive: material?.emissive ?? null,
                textured: material?.textured === true,
                textureCount: Number(material?.textureCount ?? 0),
                texturePaths: Array.isArray(material?.texturePaths)
                  ? material.texturePaths.slice(0, 16)
                  : [],
              }))
            : [],
        }))
      : [],
  };
}

function sanitizeSelectedUsdNormalDiagnostics(summary) {
  if (!summary) {
    return null;
  }

  const sanitizeNormalDiagnostics = (entry) => {
    const source = entry?.normalDiagnostics ?? entry?.normalDiagnostic ?? entry;
    const normalRepairCount = source?.normalRepairCount;
    const normalFallbackCount = source?.normalFallbackCount;
    const postRepairLowDotCount = source?.postRepairLowDotCount;
    if (normalRepairCount == null && normalFallbackCount == null && postRepairLowDotCount == null) {
      return null;
    }
    return {
      normalSource: source?.normalSource ?? null,
      normalRepairCount: normalRepairCount == null ? null : Number(normalRepairCount),
      normalFallbackCount: normalFallbackCount == null ? null : Number(normalFallbackCount),
      postRepairLowDotCount: postRepairLowDotCount == null ? null : Number(postRepairLowDotCount),
    };
  };

  const meshes = Array.isArray(summary.meshes)
    ? summary.meshes
        .slice(0, 256)
        .map((mesh) => ({
          meshId: mesh?.meshId ?? null,
          resolvedPrimPath: mesh?.resolvedPrimPath ?? null,
          linkPath: mesh?.linkPath ?? null,
          sectionName: mesh?.sectionName ?? null,
          normalDiagnostics: sanitizeNormalDiagnostics(mesh),
        }))
        .filter((mesh) => mesh.normalDiagnostics)
    : [];

  return {
    available: summary.available === true,
    fileName: summary.fileName ?? null,
    meshDescriptorCount: Number(summary.meshDescriptorCount ?? 0),
    diagnosticsCount: Number(summary.diagnosticsCount ?? meshes.length),
    meshes,
  };
}

function sanitizeRuntimeSceneTransforms(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const sanitizeTransformEntry = (entry) => ({
    name: entry?.name ?? null,
    link: entry?.link ?? null,
    type: entry?.type ?? null,
    position: Array.isArray(entry?.position) ? entry.position.slice(0, 3).map(Number) : null,
    quaternion: Array.isArray(entry?.quaternion)
      ? entry.quaternion.slice(0, 4).map(Number)
      : null,
    scale: Array.isArray(entry?.scale) ? entry.scale.slice(0, 3).map(Number) : null,
    axis: Array.isArray(entry?.axis) ? entry.axis.slice(0, 3).map(Number) : null,
  });

  return {
    links: Array.isArray(summary.links) ? summary.links.map(sanitizeTransformEntry) : [],
    joints: Array.isArray(summary.joints) ? summary.joints.map(sanitizeTransformEntry) : [],
    visualMeshes: Array.isArray(summary.visualMeshes)
      ? summary.visualMeshes.map(sanitizeTransformEntry)
      : [],
  };
}

function compareCanvasLumaSamples(beforeSample, afterSample) {
  if (
    !beforeSample ||
    !afterSample ||
    !Array.isArray(beforeSample.luma) ||
    !Array.isArray(afterSample.luma) ||
    beforeSample.luma.length === 0 ||
    beforeSample.luma.length !== afterSample.luma.length
  ) {
    return null;
  }

  let totalAbsDiff = 0;
  let maxAbsDiff = 0;
  let changedPixelCount = 0;

  for (let index = 0; index < beforeSample.luma.length; index += 1) {
    const absDiff = Math.abs(Number(beforeSample.luma[index]) - Number(afterSample.luma[index]));
    totalAbsDiff += absDiff;
    maxAbsDiff = Math.max(maxAbsDiff, absDiff);
    if (absDiff >= 8) {
      changedPixelCount += 1;
    }
  }

  const meanAbsDiff = totalAbsDiff / beforeSample.luma.length;
  const changedPixelFraction = changedPixelCount / beforeSample.luma.length;

  return {
    canvasLabel: afterSample.canvasLabel ?? beforeSample.canvasLabel ?? null,
    canvasRect: afterSample.canvasRect ?? beforeSample.canvasRect ?? null,
    sampleSize: beforeSample.sampleSize ?? afterSample.sampleSize ?? null,
    meanAbsDiff: Number(meanAbsDiff.toFixed(3)),
    maxAbsDiff,
    changedPixelFraction: Number(changedPixelFraction.toFixed(4)),
    changed: meanAbsDiff >= 2.4 || changedPixelFraction >= 0.03,
  };
}

export function getPreferredRuntimeSnapshot(snapshot) {
  return snapshot?.primaryRuntime ?? snapshot?.runtime ?? null;
}

export function buildResult(
  modelKey,
  targetFileName,
  evaluation,
  orbitInteraction,
  postReadySample,
  consoleErrors,
  consoleWarnings,
  pageErrors,
) {
  const response = evaluation?.response ?? null;
  const snapshot = evaluation?.snapshot ?? response?.snapshot ?? null;
  const runtime = getPreferredRuntimeSnapshot(snapshot);
  const selectedFileName =
    evaluation?.snapshot?.selectedFile?.name ??
    response?.snapshot?.selectedFile?.name ??
    response?.selectedFile ??
    null;
  const history = Array.isArray(evaluation?.usdStageLoadDebugHistory)
    ? evaluation.usdStageLoadDebugHistory
    : [];
  const stageInfo = deriveMetadataSource(history, [selectedFileName, targetFileName]);

  return {
    modelKey,
    sampleId: selectedFileName
      ? path.basename(selectedFileName, path.extname(selectedFileName))
      : modelKey,
    targetFileName,
    selectedFileName,
    loaded: response?.loaded === true || evaluation?.documentLoadState?.status === 'ready',
    runtimePresent: Boolean(runtime),
    workerResolveEntry: stageInfo.workerResolveEntry,
    runtimeResolveEntry: stageInfo.runtimeResolveEntry,
    stageReady: stageInfo.stageReady,
    stagePreparationMode: stageInfo.stagePreparationMode,
    metadataSource: stageInfo.metadataSource,
    metadataSourcePass: stageInfo.metadataSourcePass,
    usdStageLoadDebugHistory: history,
    usdLoadProfile: evaluation?.usdLoadProfile ?? null,
    documentLoadState: evaluation?.documentLoadState ?? null,
    postReadyHistoryDelta: postReadySample?.historyDelta ?? null,
    postReadyNewSteps: postReadySample?.newSteps ?? [],
    postReadyDocumentLoadState: postReadySample?.documentLoadState ?? null,
    assetDebugState: sanitizeAssetDebugState(evaluation?.assetDebugState ?? null),
    selectedUsdSceneSummary: sanitizeSelectedUsdSceneSummary(
      evaluation?.selectedUsdSceneSummary ?? null,
    ),
    selectedUsdVisualMaterialSummary: sanitizeSelectedUsdVisualMaterialSummary(
      evaluation?.selectedUsdVisualMaterialSummary ?? null,
    ),
    selectedUsdNormalDiagnostics: sanitizeSelectedUsdNormalDiagnostics(
      evaluation?.selectedUsdNormalDiagnostics ?? null,
    ),
    runtimeSceneTransforms: sanitizeRuntimeSceneTransforms(
      evaluation?.runtimeSceneTransforms ?? null,
    ),
    orbitInteraction: orbitInteraction ?? null,
    snapshot,
    consoleErrors,
    consoleWarnings,
    pageErrors,
  };
}

async function beginModelLoad(page, fileName) {
  await page.waitForFunction(
    () => typeof window.__URDF_STUDIO_DEBUG__?.loadRobotByName === 'function',
    { timeout: DEFAULT_OPERATION_TIMEOUT_MS },
  );
  await evaluateWithRetry(
    page,
    (nextFileName) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      if (!api?.loadRobotByName) {
        throw new Error('window.__URDF_STUDIO_DEBUG__.loadRobotByName is unavailable.');
      }

      const requestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
      window.__codexBrowserRegressionLoad = {
        requestId,
        targetFileName: nextFileName,
        result: null,
        error: null,
      };

      void api
        .loadRobotByName(nextFileName)
        .then((response) => {
          if (window.__codexBrowserRegressionLoad?.requestId !== requestId) {
            return;
          }
          window.__codexBrowserRegressionLoad = {
            ...window.__codexBrowserRegressionLoad,
            result: {
              loaded: response?.loaded === true,
              selectedFile:
                response?.selectedFile ?? response?.snapshot?.selectedFile?.name ?? null,
            },
          };
        })
        .catch((error) => {
          if (window.__codexBrowserRegressionLoad?.requestId !== requestId) {
            return;
          }
          window.__codexBrowserRegressionLoad = {
            ...window.__codexBrowserRegressionLoad,
            error: error instanceof Error ? error.message : String(error),
          };
        });
    },
    fileName,
  );
}

async function collectLoadEvaluation(page) {
  return await evaluateWithRetry(page, () => {
    const api = window.__URDF_STUDIO_DEBUG__;
    if (!api) {
      throw new Error('window.__URDF_STUDIO_DEBUG__ is unavailable.');
    }

    const snapshot = api.getRegressionSnapshot?.() ?? null;
    const isAuthoredCollisionGeometry = (geometry) => {
      const type = String(geometry?.type ?? '').trim().toLowerCase();
      return Boolean(type && type !== 'none');
    };
    const summarizeStoreCollisionCount = (link) => {
      let count = isAuthoredCollisionGeometry(link?.collision) ? 1 : 0;
      if (Array.isArray(link?.collisionBodies)) {
        count += link.collisionBodies.filter((entry) =>
          isAuthoredCollisionGeometry(entry?.geometry ?? entry),
        ).length;
      }
      return count;
    };
    const summarizeStoreLinkPhysics = (link) => ({
      id: link?.id ?? null,
      name: link?.name ?? link?.id ?? null,
      mass: Number(link?.mass ?? 0),
      collisionCount: summarizeStoreCollisionCount(link),
      centerOfMass: link?.centerOfMass
        ? {
            xyz: {
              x: Number(link.centerOfMass.xyz?.x ?? 0),
              y: Number(link.centerOfMass.xyz?.y ?? 0),
              z: Number(link.centerOfMass.xyz?.z ?? 0),
            },
            rpy: {
              r: Number(link.centerOfMass.rpy?.r ?? 0),
              p: Number(link.centerOfMass.rpy?.p ?? 0),
              y: Number(link.centerOfMass.rpy?.y ?? 0),
            },
          }
        : null,
      inertia: link?.inertia
        ? {
            ixx: Number(link.inertia.ixx ?? 0),
            ixy: Number(link.inertia.ixy ?? 0),
            ixz: Number(link.inertia.ixz ?? 0),
            iyy: Number(link.inertia.iyy ?? 0),
            iyz: Number(link.inertia.iyz ?? 0),
            izz: Number(link.inertia.izz ?? 0),
          }
        : null,
    });
    const summarizeVector3 = (value) =>
      value
        ? {
            x: Number(value.x ?? 0),
            y: Number(value.y ?? 0),
            z: Number(value.z ?? 0),
          }
        : null;
    const summarizeOrigin = (origin) =>
      origin
        ? {
            xyz: summarizeVector3(origin.xyz),
            rpy: origin.rpy
              ? {
                  r: Number(origin.rpy.r ?? 0),
                  p: Number(origin.rpy.p ?? 0),
                  y: Number(origin.rpy.y ?? 0),
                }
              : null,
          }
        : null;
    const summarizeStoreJoint = (joint) => ({
      id: joint?.id ?? null,
      name: joint?.name ?? joint?.id ?? null,
      type: joint?.type ?? null,
      parentLinkId: joint?.parentLinkId ?? null,
      childLinkId: joint?.childLinkId ?? null,
      origin: summarizeOrigin(joint?.origin),
      axis: summarizeVector3(joint?.axis),
      usdPhysics: joint?.usdPhysics
        ? {
            axisToken: joint.usdPhysics.axisToken ?? null,
            localPos0: summarizeVector3(joint.usdPhysics.localPos0),
            localRot0Wxyz: Array.isArray(joint.usdPhysics.localRot0Wxyz)
              ? joint.usdPhysics.localRot0Wxyz.map(Number)
              : null,
            localPos1: summarizeVector3(joint.usdPhysics.localPos1),
            localRot1Wxyz: Array.isArray(joint.usdPhysics.localRot1Wxyz)
              ? joint.usdPhysics.localRot1Wxyz.map(Number)
              : null,
          }
        : null,
    });
    const summarizeRuntimeMaterial = (material) => ({
      type: material?.type ?? null,
      name: material?.name ?? null,
      color: material?.color ?? null,
      hasTexture: material?.hasTexture === true,
      transparent: material?.transparent === true,
      opacity:
        typeof material?.opacity === 'number' && Number.isFinite(material.opacity)
          ? Number(material.opacity)
          : null,
    });
    const summarizeRuntimeVisualMesh = (mesh) => ({
      link: mesh?.link ?? null,
      name: mesh?.name ?? null,
      visible: mesh?.visible !== false,
      effectiveVisible: mesh?.effectiveVisible !== false,
      isPlaceholder: mesh?.isPlaceholder === true,
      missingMeshPath: mesh?.missingMeshPath ?? null,
      materials: Array.isArray(mesh?.materials)
        ? mesh.materials.slice(0, 32).map(summarizeRuntimeMaterial)
        : [],
    });
    const storeJointList = Array.isArray(snapshot?.store?.joints)
      ? snapshot.store.joints
      : snapshot?.store?.joints && typeof snapshot.store.joints === 'object'
        ? Object.values(snapshot.store.joints)
        : [];
    const summarizeRuntimeSnapshot = (runtime) =>
      runtime
        ? {
            name: runtime.name ?? null,
            linkCount:
              runtime.linkCount ?? (Array.isArray(runtime.links) ? runtime.links.length : null),
            jointCount:
              runtime.jointCount ?? (Array.isArray(runtime.joints) ? runtime.joints.length : null),
            visualMeshes: Array.isArray(runtime.visualMeshes)
              ? runtime.visualMeshes.slice(0, 256).map(summarizeRuntimeVisualMesh)
              : [],
          }
        : null;
    const summarizedSnapshot = snapshot
      ? {
          timestamp: snapshot.timestamp ?? null,
          runtimeRevision: snapshot.runtimeRevision ?? null,
          primaryRuntimeRevision: snapshot.primaryRuntimeRevision ?? null,
          availableFiles: Array.isArray(snapshot.availableFiles)
            ? snapshot.availableFiles.map((file) => ({
                name: file.name ?? null,
                format: file.format ?? null,
              }))
            : [],
          selectedFile: snapshot.selectedFile ?? null,
          store: snapshot.store
            ? {
                name: snapshot.store.name ?? null,
                rootLinkId: snapshot.store.rootLinkId ?? null,
                linkCount: snapshot.store.linkCount ?? null,
                jointCount: snapshot.store.jointCount ?? null,
                totalMass: snapshot.store.totalMass ?? null,
                links: Array.isArray(snapshot.store.links)
                  ? snapshot.store.links.map(summarizeStoreLinkPhysics)
                  : [],
                joints: storeJointList.map(summarizeStoreJoint),
              }
            : null,
          viewer: snapshot.viewer
            ? {
                toolMode: snapshot.viewer.toolMode ?? null,
                activeJoint: snapshot.viewer.activeJoint ?? null,
                highlightMode: snapshot.viewer.highlightMode ?? null,
              }
            : null,
          runtime: summarizeRuntimeSnapshot(snapshot.runtime),
          primaryRuntime: summarizeRuntimeSnapshot(snapshot.primaryRuntime),
        }
      : null;

    const assetDebugState = api.getAssetDebugState?.() ?? null;
    const selectedUsdSceneSummary = api.getSelectedUsdSceneSummary?.() ?? null;
    const selectedUsdVisualMaterialSummary = api.getSelectedUsdVisualMaterialSummary?.() ?? null;
    const selectedUsdNormalDiagnostics = api.getSelectedUsdNormalDiagnostics?.() ?? null;
    const runtimeSceneTransforms = api.getRuntimeSceneTransforms?.() ?? null;
    const sanitizeUsdLoadProfile = (profile) => {
      if (!profile || typeof profile !== 'object') {
        return null;
      }
      const sanitizeProfileObject = (value) => {
        if (!value || typeof value !== 'object') {
          return null;
        }
        return Object.fromEntries(
          Object.entries(value).filter(([, entryValue]) => {
            if (entryValue == null) {
              return true;
            }
            if (
              typeof entryValue === 'number' ||
              typeof entryValue === 'string' ||
              typeof entryValue === 'boolean'
            ) {
              return true;
            }
            return Array.isArray(entryValue) && entryValue.length <= 8;
          }),
        );
      };
      return {
        status: profile.status ?? null,
        normalizedPath: profile.normalizedPath ?? null,
        totalMs: typeof profile.totalMs === 'number' ? profile.totalMs : null,
        marks: Array.isArray(profile.marks)
          ? profile.marks.slice(-80).map((mark) => ({
              label: mark?.label ?? null,
              ms: typeof mark?.ms === 'number' ? mark.ms : null,
            }))
          : [],
        callbackProfile: Array.isArray(profile.callbackProfile)
          ? profile.callbackProfile.slice(0, 40).map((sample) => ({
              name: sample?.name ?? null,
              count: typeof sample?.count === 'number' ? sample.count : null,
              totalMs: typeof sample?.totalMs === 'number' ? sample.totalMs : null,
              maxMs: typeof sample?.maxMs === 'number' ? sample.maxMs : null,
            }))
          : [],
        driverInitProfile: sanitizeProfileObject(profile.driverInitProfile),
        robotSceneSnapshotProfile: sanitizeProfileObject(profile.robotSceneSnapshotProfile),
        runtimeBridgeWarmupSummary: sanitizeProfileObject(profile.runtimeBridgeWarmupSummary),
        hydraPhaseProfile:
          profile.hydraPhaseProfile && typeof profile.hydraPhaseProfile === 'object'
            ? {
                drawSeq: profile.hydraPhaseProfile.drawSeq ?? null,
                renderSeq: profile.hydraPhaseProfile.renderSeq ?? null,
                history: Array.isArray(profile.hydraPhaseProfile.history)
                  ? profile.hydraPhaseProfile.history
                      .slice(-12)
                      .map((entry) => sanitizeProfileObject(entry))
                  : [],
              }
            : null,
        meshStats: sanitizeProfileObject(profile.meshStats),
      };
    };
    const debugSignature =
      typeof assetDebugState?.viewerScopedSignature === 'string'
        ? assetDebugState.viewerScopedSignature.slice(0, 512)
        : (assetDebugState?.viewerScopedSignature ?? null);
    const sanitizeUsdLoadDebugDetail = (detail) => {
      if (!detail || typeof detail !== 'object') {
        return null;
      }

      const allowedKeys = [
        'selectedFileName',
        'stagePreparationMode',
        'metadataSource',
        'linkCount',
        'jointCount',
        'commitMode',
        'rendererMode',
        'stageSourcePath',
        'drawFailed',
        'robotSceneSnapshotOnly',
        'runtimeWarmupNativeSnapshotSource',
        'runtimeBridgeWarmupSummary',
        'driverInitProfile',
        'robotSceneSnapshotProfile',
        'availableFileCount',
        'stageOpenSource',
        'stageOpenCacheHit',
        'stageOpenContextCacheHit',
        'preparedStageOpenCacheHit',
        'preloadFileCount',
        'criticalDependencyCount',
        'successfulPreloadFileCount',
        'failedPreloadFileCount',
        'totalByteCount',
        'blobByteCount',
        'bytesByteCount',
        'normalizedTextFileCount',
        'normalizedTextByteCount',
        'blobBackedTextProbeCount',
        'transferableByteCount',
      ];
      return Object.fromEntries(
        allowedKeys.filter((key) => detail[key] !== undefined).map((key) => [key, detail[key]]),
      );
    };
    const summarizedUsdStageLoadDebugHistory = Array.isArray(window.__usdStageLoadDebugHistory)
      ? window.__usdStageLoadDebugHistory.slice(-64).map((entry) => ({
          step: entry?.step ?? null,
          status: entry?.status ?? null,
          sourceFileName: entry?.sourceFileName ?? null,
          timestamp: entry?.timestamp ?? null,
          durationMs: typeof entry?.durationMs === 'number' ? entry.durationMs : null,
          detail: sanitizeUsdLoadDebugDetail(entry?.detail),
        }))
      : [];

    return {
      response: window.__codexBrowserRegressionLoad?.result ?? null,
      loadError: window.__codexBrowserRegressionLoad?.error ?? null,
      snapshot: summarizedSnapshot,
      documentLoadState: api.getDocumentLoadState?.() ?? null,
      assetDebugState: assetDebugState
        ? {
            appAssetKeys: assetDebugState.appAssetKeys ?? [],
            preparedUsdCacheKeysByFile: assetDebugState.preparedUsdCacheKeysByFile ?? {},
            viewerScopedAssetKeys: assetDebugState.viewerScopedAssetKeys ?? [],
            viewerScopedAvailableFileNames: assetDebugState.viewerScopedAvailableFileNames ?? [],
            viewerScopedSourceFileName: assetDebugState.viewerScopedSourceFileName ?? null,
            viewerScopedSourceFilePath: assetDebugState.viewerScopedSourceFilePath ?? null,
            viewerScopedSignature: debugSignature,
          }
        : null,
      selectedUsdSceneSummary,
      selectedUsdVisualMaterialSummary,
      selectedUsdNormalDiagnostics,
      runtimeSceneTransforms,
      usdLoadProfile: sanitizeUsdLoadProfile(window.__usdLoadProfile),
      usdStageLoadDebugHistory: summarizedUsdStageLoadDebugHistory,
    };
  });
}

async function collectPostReadySilentWindowSample(page, evaluation, loadFileName) {
  const initialDocumentLoadState = evaluation?.documentLoadState ?? null;
  const isMatchingReadyDocument =
    normalizeFileName(initialDocumentLoadState?.fileName) === normalizeFileName(loadFileName) &&
    initialDocumentLoadState?.status === 'ready';

  if (!isMatchingReadyDocument) {
    return {
      documentLoadState: null,
      evaluation,
      historyDelta: null,
      newSteps: [],
    };
  }

  await delay(POST_READY_SILENT_WINDOW_MS);

  const postReadyEvaluation = await collectLoadEvaluation(page);
  const selectedFileName =
    postReadyEvaluation?.snapshot?.selectedFile?.name ??
    evaluation?.snapshot?.selectedFile?.name ??
    loadFileName;
  const historyDelta = summarizePostReadyHistoryDelta(
    evaluation?.usdStageLoadDebugHistory ?? [],
    postReadyEvaluation?.usdStageLoadDebugHistory ?? [],
    [loadFileName, selectedFileName],
  );

  return {
    documentLoadState: postReadyEvaluation?.documentLoadState ?? null,
    evaluation: postReadyEvaluation,
    historyDelta: historyDelta.historyDelta,
    newSteps: historyDelta.newSteps,
  };
}

async function captureViewerCanvasLuma(page) {
  return await evaluateWithRetry(page, () => {
    const isVisibleCanvas = (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        return false;
      }

      const rect = canvas.getBoundingClientRect();
      const style = window.getComputedStyle(canvas);
      return (
        rect.width >= 64 &&
        rect.height >= 64 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0.01
      );
    };

    const selectCanvas = () => {
      const offscreenCanvas = document.querySelector('[data-testid="usd-offscreen-canvas"]');
      if (isVisibleCanvas(offscreenCanvas)) {
        return {
          canvas: offscreenCanvas,
          canvasLabel: 'usd-offscreen-canvas',
        };
      }

      const candidates = Array.from(document.querySelectorAll('canvas'))
        .filter(isVisibleCanvas)
        .map((canvas, index) => {
          const rect = canvas.getBoundingClientRect();
          return {
            canvas,
            area: rect.width * rect.height,
            canvasLabel: canvas.getAttribute('data-testid') || `canvas:${index}`,
          };
        })
        .sort((left, right) => right.area - left.area);

      return candidates[0] ?? null;
    };

    const selected = selectCanvas();
    if (!selected?.canvas) {
      return null;
    }

    const rect = selected.canvas.getBoundingClientRect();
    const sampleSize = 96;
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = sampleSize;
    sampleCanvas.height = sampleSize;
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.drawImage(selected.canvas, 0, 0, sampleSize, sampleSize);
    const imageData = context.getImageData(0, 0, sampleSize, sampleSize);
    const luma = [];
    for (let index = 0; index < imageData.data.length; index += 4) {
      const r = imageData.data[index];
      const g = imageData.data[index + 1];
      const b = imageData.data[index + 2];
      luma.push(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
    }

    return {
      canvasLabel: selected.canvasLabel,
      canvasRect: {
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
      },
      sampleSize,
      luma,
    };
  });
}

function isRetryableCanvasCaptureError(error) {
  return /Execution context was destroyed|Promise was collected|Navigating frame was detached|window\.__URDF_STUDIO_DEBUG__ is unavailable/i.test(
    String(error || ''),
  );
}

async function measureOrbitInteraction(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const beforeSample = await captureViewerCanvasLuma(page);
      const canvasRect = beforeSample?.canvasRect ?? null;
      if (
        !canvasRect ||
        !Number.isFinite(canvasRect.x) ||
        !Number.isFinite(canvasRect.y) ||
        !Number.isFinite(canvasRect.width) ||
        !Number.isFinite(canvasRect.height)
      ) {
        await delay(200);
        continue;
      }

      const start = {
        x: Math.round(canvasRect.x + canvasRect.width * 0.54),
        y: Math.round(canvasRect.y + canvasRect.height * 0.48),
      };
      const end = {
        x: Math.round(canvasRect.x + Math.min(canvasRect.width * 0.74, canvasRect.width - 24)),
        y: Math.round(canvasRect.y + Math.min(canvasRect.height * 0.6, canvasRect.height - 24)),
      };

      await page.mouse.move(start.x, start.y);
      await delay(80);
      await page.mouse.down({ button: 'left' });
      await page.mouse.move(end.x, end.y, { steps: 18 });
      await page.mouse.up({ button: 'left' });
      await delay(220);

      const afterSample = await captureViewerCanvasLuma(page);
      const diff = compareCanvasLumaSamples(beforeSample, afterSample);
      if (!diff) {
        await delay(200);
        continue;
      }

      return {
        ...diff,
        dragStart: start,
        dragEnd: end,
      };
    } catch (error) {
      if (isRetryableCanvasCaptureError(error) && attempt === 3) {
        return null;
      }
      if (!isRetryableCanvasCaptureError(error)) {
        throw error;
      }
      await delay(250);
    }
  }

  return null;
}

async function loadModelResult(
  page,
  modelKey,
  timeoutMs,
  preserveUsdRoot,
  consoleErrors,
  consoleWarnings,
  pageErrors,
) {
  await assertSourceImportsAvailable(page);
  const seedDescriptor = await buildSeedDescriptor(modelKey, { preserveUsdRoot });
  let seededFixture = await seedFixtureFiles(page, seedDescriptor);
  if (seedDescriptor && Number(seededFixture?.availableFileCount ?? 0) <= 0) {
    throw new Error(`Fixture seeding produced no available files for "${modelKey}".`);
  }
  const consoleStart = consoleErrors.length;
  const consoleWarningStart = consoleWarnings.length;
  const pageErrorStart = pageErrors.length;
  let loadFileName = seededFixture?.loadFileName ?? modelKey;
  await beginModelLoad(page, loadFileName);

  const deadline = Date.now() + timeoutMs;
  let loadStart = Date.now();
  let reseedCount = 0;
  let evaluation = null;
  while (Date.now() < deadline) {
    try {
      evaluation = await collectLoadEvaluation(page);
    } catch (error) {
      if (!isRetryableCanvasCaptureError(error)) {
        throw error;
      }
      await delay(250);
      continue;
    }
    const documentLoadState = evaluation?.documentLoadState ?? null;
    const isMatchingDocument =
      normalizeFileName(documentLoadState?.fileName) === normalizeFileName(loadFileName);
    if (evaluation?.loadError) {
      throw new Error(evaluation.loadError);
    }
    if (
      seedDescriptor &&
      Date.now() - loadStart > 2_000 &&
      documentLoadState?.status === 'idle' &&
      Array.isArray(evaluation?.snapshot?.availableFiles) &&
      evaluation.snapshot.availableFiles.length === 0
    ) {
      if (reseedCount < 1) {
        reseedCount += 1;
        seededFixture = await seedFixtureFiles(page, seedDescriptor);
        if (Number(seededFixture?.availableFileCount ?? 0) > 0) {
          loadFileName = seededFixture?.loadFileName ?? loadFileName;
          await beginModelLoad(page, loadFileName);
          loadStart = Date.now();
          await delay(250);
          continue;
        }
      }
      throw new Error(`Seeded fixture files were cleared before "${loadFileName}" could load.`);
    }
    if (evaluation?.response?.loaded === false) {
      break;
    }
    if (
      isMatchingDocument &&
      (documentLoadState?.status === 'ready' || documentLoadState?.status === 'error')
    ) {
      break;
    }
    await delay(250);
  }

  if (!evaluation) {
    throw new Error(`Timed out loading model "${loadFileName}".`);
  }

  const postReadySample = await collectPostReadySilentWindowSample(page, evaluation, loadFileName);
  evaluation = postReadySample.evaluation ?? evaluation;

  const orbitInteraction = await measureOrbitInteraction(page);

  return buildResult(
    modelKey,
    loadFileName,
    evaluation,
    orbitInteraction,
    postReadySample,
    consoleErrors.slice(consoleStart),
    consoleWarnings.slice(consoleWarningStart),
    pageErrors.slice(pageErrorStart),
  );
}

function hasBrowserConsoleNoise(result) {
  return (
    (Array.isArray(result?.consoleErrors) && result.consoleErrors.length > 0) ||
    (Array.isArray(result?.consoleWarnings) && result.consoleWarnings.length > 0) ||
    (Array.isArray(result?.pageErrors) && result.pageErrors.length > 0)
  );
}

function hasPreparedRobotStateCache(result) {
  const preparedCacheKeys =
    result?.assetDebugState?.preparedUsdCacheKeysByFile?.[result?.selectedFileName] ??
    result?.assetDebugState?.preparedUsdCacheKeysByFile?.[result?.targetFileName] ??
    null;
  if (!Array.isArray(preparedCacheKeys)) {
    return false;
  }
  if (preparedCacheKeys.length > 0) {
    return true;
  }

  const meshDescriptorCount = Number(result?.selectedUsdSceneSummary?.meshDescriptorCount ?? 0);
  const storeLinkCount = Number(result?.snapshot?.store?.linkCount ?? 0);
  return meshDescriptorCount === 0 && storeLinkCount > 0;
}

function isRobotStateHarnessPass(result) {
  return Boolean(
    result?.loaded &&
    result?.workerResolveEntry?.status === 'resolved' &&
    result?.documentLoadState?.status === 'ready' &&
    hasPreparedRobotStateCache(result) &&
    result?.metadataSourcePass &&
    !hasBrowserConsoleNoise(result),
  );
}

function isBaseHarnessPass(result) {
  return Boolean(
    isRobotStateHarnessPass(result) ||
    (result?.loaded &&
      result?.stageReady &&
      result?.stagePreparationMode === 'worker' &&
      result?.metadataSourcePass &&
      !hasBrowserConsoleNoise(result)),
  );
}

function isRetryableRuntimeError(error) {
  return /Execution context was destroyed|frame got detached|Navigating frame was detached|Promise was collected|window\.__URDF_STUDIO_DEBUG__ is unavailable/i.test(
    String(error || ''),
  );
}

async function loadModelWithRetry(options, modelKey) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pageSession = await openRegressionPage(options);
    try {
      return await loadModelResult(
        pageSession.page,
        modelKey,
        options.timeoutMs,
        options.preserveUsdRoot,
        pageSession.consoleErrors,
        pageSession.consoleWarnings,
        pageSession.pageErrors,
      );
    } catch (error) {
      lastError = error;
      if (
        !isRetryableRuntimeError(error instanceof Error ? error.message : String(error)) ||
        attempt === 1
      ) {
        throw error;
      }
      await delay(750);
    } finally {
      await Promise.race([pageSession.browser.close().catch(() => {}), delay(5_000)]);
    }
  }

  throw lastError ?? new Error(`Failed to load model "${modelKey}".`);
}

export async function main(configOverrides = {}) {
  const config = {
    defaultOutputPath: DEFAULT_OUTPUT_PATH,
    scriptName: 'run_unitree_browser_regression.mjs',
    ...configOverrides,
  };
  const options = parseArgs(process.argv.slice(2), config);
  const site = await ensureSite(options);

  try {
    const results = [];
    for (const modelKey of options.models) {
      results.push(await loadModelWithRetry(options, modelKey));
    }

    const summary = {
      modelCount: results.length,
      passedCount: results.filter((result) => isBaseHarnessPass(result)).length,
      failedCount: results.filter((result) => !isBaseHarnessPass(result)).length,
      models: options.models,
    };

    const report = {
      generatedAtUtc: new Date().toISOString(),
      workspace: process.cwd(),
      siteUrl: options.siteUrl,
      preserveUsdRoot: options.preserveUsdRoot,
      summary,
      results,
    };

    await writeJsonAtomic(options.outputPath, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await Promise.race([site.stop(), delay(5_000)]);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
