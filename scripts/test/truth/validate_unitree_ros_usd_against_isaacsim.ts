import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { detectImportFormat } from '../../../src/app/utils/importPreparation.ts';
import { parseURDF } from '../../../src/core/parsers/urdf/parser/index.ts';
import { disposeColladaParseWorkerPoolClient } from '../../../src/core/loaders/colladaParseWorkerBridge.ts';
import { parseColladaSceneData } from '../../../src/core/loaders/colladaWorkerSceneData.ts';
import { parseObjModelDataFromBytes } from '../../../src/core/loaders/objWasmParser.ts';
import { parseStlGeometryData } from '../../../src/core/loaders/stlGeometryData.ts';
import { resolveRobotFileData } from '../../../src/core/parsers/importRobotFile.ts';
import { resolveVisualMaterialOverride } from '../../../src/core/robot/visualMaterials.ts';
import { parseThreeColorWithOpacity } from '../../../src/core/utils/color.ts';
import {
  toUsdAuthoredColor,
  toUsdAuthoredColorFromSrgbTuple,
} from '../../../src/features/file-io/utils/usdColorSpace.ts';
import { exportRobotToUsd } from '../../../src/features/file-io/utils/usdExport.ts';
import type { RobotData, RobotFile } from '../../../src/types';

const DEFAULT_FIXTURE_ROOT = path.resolve('test/unitree_ros/robots');
const DEFAULT_ARTIFACT_ROOT = path.resolve('tmp/regression/unitree-ros-isaacsim');
const DEFAULT_OUTPUT_PATH = path.resolve('tmp/regression/unitree-ros-isaacsim-summary.json');
const DEFAULT_ISAACLAB_ROOT = path.resolve(
  '/home/xiangyk/Project/IsaacLab_Family/IsaacLab22/IsaacLab',
);
const DEFAULT_ISAAC_PYTHON = path.resolve('/home/xiangyk/anaconda3/envs/isaaclab22/bin/python');
const ASSET_EXTENSIONS = new Set([
  '.bmp',
  '.dae',
  '.gif',
  '.glb',
  '.gltf',
  '.jpeg',
  '.jpg',
  '.mtl',
  '.obj',
  '.png',
  '.stl',
  '.svg',
  '.webp',
]);
const COLOR_TOLERANCE = 0.002;
const PHYSICS_TOLERANCE = 1e-5;

type WorkerMessageHandler = (event: { data?: unknown; error?: unknown; message?: string }) => void;

type Options = {
  artifactsDir: string;
  compressMeshes: boolean;
  fixtureRoot: string;
  isaacLabRoot: string;
  isaacPython: string;
  limit: number | null;
  meshQuality: number;
  modelFilters: string[];
  outputPath: string;
};

type SourceFormat = 'mjcf' | 'urdf';

type ModelFixture = {
  entryAbsPath: string;
  entryPath: string;
  id: string;
  packageName: string;
  sourceFormat: SourceFormat;
  stem: string;
  urdfPath: string;
  supportRootAbs: string;
  supportRootRel: string;
};

type SourceContext = {
  allFileContents: Record<string, string>;
  availableFiles: RobotFile[];
};

type SkippedSourceEntry = {
  entryPath: string;
  message: string | null;
  status: 'parse_failed' | 'source_only_fragment' | 'unsupported_format' | 'needs_hydration';
};

type ResolvedFixtureSource = {
  explicitInertialBodies: string[];
  expectedCollisionBodyCounts: Record<string, number>;
  extraMeshFiles: Map<string, Blob>;
  robotData: RobotData;
  sourceMaterialSignatures: MaterialSignature[];
};

type JsonRecord = Record<string, unknown>;
type CurrentExportFormat = 'usd' | 'usda';
type ValidationStatus = 'pass' | 'partial' | 'fail';
type MaterialSignature = {
  color: [number, number, number] | null;
  textured: boolean;
};

type PhysicsBodySummary = {
  mass: number | null;
  centerOfMass: [number, number, number] | null;
  diagonalInertia: [number, number, number] | null;
  principalAxes: [number, number, number, number] | null;
  collisionCount: number;
  collisionTypes: Record<string, number>;
  meshCollisionApproximations: string[];
};

type StrongCompareResult = {
  compareOutputPath: string;
  currentTruthOutputPath: string;
  exitCode: number;
  pass: boolean;
  report: JsonRecord;
  truthOutputPath: string;
};

class FakeAssetParseWorker {
  private readonly listeners = new Map<string, Set<WorkerMessageHandler>>();

  addEventListener(type: string, handler: WorkerMessageHandler): void {
    const handlers = this.listeners.get(type) ?? new Set<WorkerMessageHandler>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, handler: WorkerMessageHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(message: unknown): void {
    const request = message as { type?: string; assetUrl?: string; requestId?: number };
    if (!request?.assetUrl || !Number.isFinite(request.requestId)) {
      return;
    }

    void (async () => {
      try {
        const response = await fetch(request.assetUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch Collada asset: ${response.status} ${response.statusText}`,
          );
        }

        if (request.type === 'parse-collada') {
          const colladaText = await response.text();
          const result = withSuppressedColladaLogs(() =>
            parseColladaSceneData(colladaText, request.assetUrl!),
          );
          this.emitMessage({
            type: 'parse-collada-result',
            requestId: request.requestId,
            result,
          });
          return;
        }

        if (request.type === 'parse-stl') {
          const result = parseStlGeometryData(await response.arrayBuffer());
          this.emitMessage({
            type: 'parse-stl-result',
            requestId: request.requestId,
            result,
          });
          return;
        }

        if (request.type === 'parse-obj') {
          const result = await parseObjModelDataFromBytes(await response.arrayBuffer());
          this.emitMessage({
            type: 'parse-obj-result',
            requestId: request.requestId,
            result,
          });
        }
      } catch (error) {
        const workerError = error instanceof Error ? error : new Error(String(error));
        this.emitMessage({
          type:
            request.type === 'parse-stl'
              ? 'parse-stl-error'
              : request.type === 'parse-obj'
                ? 'parse-obj-error'
                : 'parse-collada-error',
          requestId: request.requestId,
          error: workerError.message,
        });
      }
    })();
  }

  terminate(): void {}

  private emitMessage(data: unknown): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data });
    });
  }
}

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;
}

Object.defineProperty(globalThis, 'Worker', {
  configurable: true,
  writable: true,
  value: FakeAssetParseWorker,
});

function withSuppressedColladaLogs<T>(run: () => T): T {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const isColladaNoise = (value: unknown) => String(value || '').includes('THREE.ColladaLoader');

  console.log = (...args: unknown[]) => {
    if (!isColladaNoise(args[0])) {
      originalLog(...args);
    }
  };
  console.info = (...args: unknown[]) => {
    if (!isColladaNoise(args[0])) {
      originalInfo(...args);
    }
  };
  console.warn = (...args: unknown[]) => {
    if (!isColladaNoise(args[0])) {
      originalWarn(...args);
    }
  };

  try {
    return run();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
  }
}

function withSuppressedImportNoise<T>(run: () => T): T {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;

  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};

  try {
    return run();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    console.log = originalLog;
  }
}

function printUsage(): void {
  process.stdout.write(`Usage:
  npx tsx scripts/test/truth/validate_unitree_ros_usd_against_isaacsim.ts [options]

Options:
  --fixture-root <path>   Unitree ROS fixture root. Default: ${DEFAULT_FIXTURE_ROOT}
  --artifacts-dir <path>  Artifact output root. Default: ${DEFAULT_ARTIFACT_ROOT}
  --output <path>         Summary JSON path. Default: ${DEFAULT_OUTPUT_PATH}
  --model <filter>        Restrict to fixtures matching any token. Repeatable.
  --limit <count>         Limit the number of models.
  --compress-meshes       Enable mesh simplification before comparing against Isaac Sim truth.
  --mesh-quality <count>  Compression quality (10-100). Default: 100
  --isaac-python <path>   Isaac Sim Python executable. Default: ${DEFAULT_ISAAC_PYTHON}
  --isaaclab-root <path>  IsaacLab root used for convert_urdf.py. Default: ${DEFAULT_ISAACLAB_ROOT}
  --help                  Show this help.
`);
}

function fail(message: string): never {
  throw new Error(message);
}

function parseInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    artifactsDir: DEFAULT_ARTIFACT_ROOT,
    compressMeshes: false,
    fixtureRoot: DEFAULT_FIXTURE_ROOT,
    isaacLabRoot: DEFAULT_ISAACLAB_ROOT,
    isaacPython: DEFAULT_ISAAC_PYTHON,
    limit: null,
    meshQuality: 100,
    modelFilters: [],
    outputPath: DEFAULT_OUTPUT_PATH,
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
      case '--fixture-root':
        options.fixtureRoot = path.resolve(nextValue());
        break;
      case '--artifacts-dir':
        options.artifactsDir = path.resolve(nextValue());
        break;
      case '--output':
        options.outputPath = path.resolve(nextValue());
        break;
      case '--model':
        options.modelFilters.push(nextValue().toLowerCase());
        break;
      case '--limit':
        options.limit = parseInteger(nextValue(), '--limit');
        break;
      case '--compress-meshes':
        options.compressMeshes = true;
        break;
      case '--mesh-quality':
        options.meshQuality = parseInteger(nextValue(), '--mesh-quality');
        break;
      case '--isaac-python':
        options.isaacPython = path.resolve(nextValue());
        break;
      case '--isaaclab-root':
        options.isaacLabRoot = path.resolve(nextValue());
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsPromises.rename(tempPath, filePath);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function readJsonRecordWithRetry(
  filePath: string,
  context: {
    scriptPath: string;
    logPath: string;
  },
): Promise<JsonRecord> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const fileContents = await fsPromises.readFile(filePath, 'utf8');
      return JSON.parse(fileContents) as JsonRecord;
    } catch (error) {
      lastError = error;
      if (!(error instanceof SyntaxError) || attempt === 5) {
        break;
      }
      await delay(250 * attempt);
    }
  }

  throw new Error(
    `Isaac JSON tool produced unreadable JSON: script=${context.scriptPath} output=${filePath} log=${context.logPath} cause=${String(lastError)}`,
  );
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '_');
}

const TEXT_CONTENT_EXTENSIONS = new Set([
  '.config',
  '.dae',
  '.json',
  '.material',
  '.mdl',
  '.mtl',
  '.obj',
  '.txt',
  '.urdf',
  '.usda',
  '.xml',
]);
const MESH_FILE_EXTENSIONS = new Set(['.dae', '.obj', '.stl']);
const SOURCE_FILE_EXTENSIONS = new Set(['.urdf', '.xml']);
const SOURCE_FORMATS = new Set(['mjcf', 'urdf']);

function normalizePathSlashes(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const entries = await fsPromises.readdir(rootDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(absolutePath)));
      continue;
    }
    if (entry.isFile()) {
      results.push(absolutePath);
    }
  }

  return results;
}

async function collectSupportRoots(rootDir: string): Promise<string[]> {
  const entries = await fsPromises.readdir(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(rootDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function createFixtureId(supportRootRel: string, entryPath: string): string {
  const packageName = path.basename(supportRootRel);
  const stem = path.basename(entryPath, path.extname(entryPath));
  return stem === packageName ? supportRootRel : `${supportRootRel}/${stem}`;
}

function matchesModelFilter(options: Options, haystack: string): boolean {
  return (
    options.modelFilters.length === 0 ||
    options.modelFilters.some((filter) => haystack.toLowerCase().includes(filter))
  );
}

async function createSourceContext(
  fixtureRoot: string,
  supportRootAbs: string,
): Promise<SourceContext> {
  const availableFiles = new Map<string, RobotFile>();
  const allFileContents: Record<string, string> = {};
  const absolutePaths = await collectFiles(supportRootAbs);

  for (const absolutePath of absolutePaths.sort((left, right) => left.localeCompare(right))) {
    const datasetRelativePath = normalizePathSlashes(path.relative(fixtureRoot, absolutePath));
    const extension = path.extname(absolutePath).toLowerCase();

    if (TEXT_CONTENT_EXTENSIONS.has(extension)) {
      const content = await fsPromises.readFile(absolutePath, 'utf8');
      allFileContents[datasetRelativePath] = content;

      if (SOURCE_FILE_EXTENSIONS.has(extension)) {
        const format = detectImportFormat(content, datasetRelativePath);
        if (format) {
          availableFiles.set(datasetRelativePath, {
            name: datasetRelativePath,
            content,
            format,
          });
        }
      }
    }

    if (MESH_FILE_EXTENSIONS.has(extension) && !availableFiles.has(datasetRelativePath)) {
      availableFiles.set(datasetRelativePath, {
        name: datasetRelativePath,
        content: '',
        format: 'mesh',
      });
    }
  }

  return {
    allFileContents,
    availableFiles: Array.from(availableFiles.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

export async function discoverFixtures(options: Options): Promise<{
  fixtures: ModelFixture[];
  skipped: SkippedSourceEntry[];
}> {
  const supportRoots = await collectSupportRoots(options.fixtureRoot);
  const fixtures: ModelFixture[] = [];
  const skipped: SkippedSourceEntry[] = [];

  for (const supportRootAbs of supportRoots) {
    const context = await createSourceContext(options.fixtureRoot, supportRootAbs);
    const supportRootRel = normalizePathSlashes(path.relative(options.fixtureRoot, supportRootAbs));
    const packageName = path.basename(supportRootAbs);
    const sourceCandidates = (await collectFiles(supportRootAbs))
      .map((absolutePath) => normalizePathSlashes(path.relative(options.fixtureRoot, absolutePath)))
      .filter((entryPath) => SOURCE_FILE_EXTENSIONS.has(path.extname(entryPath).toLowerCase()))
      .sort((left, right) => left.localeCompare(right));

    for (const entryPath of sourceCandidates) {
      const file = context.availableFiles.find((candidate) => candidate.name === entryPath);
      const stem = path.basename(entryPath, path.extname(entryPath));
      const id = createFixtureId(supportRootRel, entryPath);
      const haystack = `${id} ${packageName} ${stem} ${entryPath}`;
      if (!matchesModelFilter(options, haystack)) {
        continue;
      }

      if (!file || !SOURCE_FORMATS.has(file.format)) {
        skipped.push({
          entryPath,
          message: null,
          status: 'unsupported_format',
        });
        continue;
      }

      const importResult = withSuppressedImportNoise(() =>
        resolveRobotFileData(file, {
          availableFiles: context.availableFiles,
          allFileContents: context.allFileContents,
        }),
      );

      if (importResult.status !== 'ready') {
        skipped.push({
          entryPath: file.name,
          message: importResult.status === 'error' ? importResult.message ?? null : null,
          status: importResult.status === 'error' ? importResult.reason : importResult.status,
        });
        continue;
      }

      fixtures.push({
        entryAbsPath: path.join(options.fixtureRoot, entryPath),
        entryPath,
        id,
        packageName,
        sourceFormat: file.format as SourceFormat,
        stem,
        supportRootAbs,
        supportRootRel,
        urdfPath: file.format === 'urdf' ? path.join(options.fixtureRoot, entryPath) : '',
      });
    }
  }

  fixtures.sort((left, right) => left.id.localeCompare(right.id));
  skipped.sort((left, right) => left.entryPath.localeCompare(right.entryPath));

  if (fixtures.length === 0) {
    fail('No Unitree ROS URDF/MJCF fixtures matched the selected filters.');
  }

  return {
    fixtures: options.limit === null ? fixtures : fixtures.slice(0, options.limit),
    skipped,
  };
}

function guessMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.dae':
      return 'model/vnd.collada+xml';
    case '.gltf':
      return 'model/gltf+json';
    case '.glb':
      return 'model/gltf-binary';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.stl':
      return 'model/stl';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

async function collectAssetFiles(rootDir: string, baseDir = rootDir): Promise<string[]> {
  const entries = await fsPromises.readdir(rootDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectAssetFiles(absolutePath, baseDir)));
      continue;
    }

    if (!entry.isFile() || !ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    results.push(path.relative(baseDir, absolutePath).split(path.sep).join('/'));
  }

  return results;
}

async function buildExtraMeshFiles(fixtureRoot: string, fixture: ModelFixture): Promise<Map<string, Blob>> {
  const assetRoot = fixture.supportRootAbs;
  const packageName = path.basename(assetRoot);
  const assetFiles = await collectAssetFiles(assetRoot);
  const extraMeshFiles = new Map<string, Blob>();

  for (const relativePath of assetFiles) {
    const absolutePath = path.join(assetRoot, relativePath);
    const datasetRelativePath = normalizePathSlashes(path.relative(fixtureRoot, absolutePath));
    const entryRelativePath = path.posix.relative(
      path.posix.dirname(fixture.entryPath),
      datasetRelativePath,
    );
    const blob = new Blob([await fsPromises.readFile(absolutePath)], {
      type: guessMimeType(absolutePath),
    });
    const aliases = [
      relativePath,
      datasetRelativePath,
      entryRelativePath,
      `${packageName}/${relativePath}`,
      `package://${packageName}/${relativePath}`,
    ];

    aliases.forEach((alias) => {
      if (alias && alias !== '.' && !extraMeshFiles.has(alias)) {
        extraMeshFiles.set(alias, blob);
      }
    });
  }

  return extraMeshFiles;
}

async function writeArchiveFiles(rootDir: string, archiveFiles: Map<string, Blob>): Promise<void> {
  for (const [archivePath, blob] of archiveFiles.entries()) {
    const absolutePath = path.join(rootDir, archivePath);
    await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fsPromises.writeFile(absolutePath, Buffer.from(await blob.arrayBuffer()));
  }
}

async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    logPath: string;
  },
): Promise<void> {
  await fsPromises.mkdir(path.dirname(options.logPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logStream = fs.createWriteStream(options.logPath, { encoding: 'utf8' });

    child.stdout.on('data', (chunk) => logStream.write(chunk));
    child.stderr.on('data', (chunk) => logStream.write(chunk));
    child.on('error', (error) => {
      logStream.end();
      reject(error);
    });
    child.on('close', (code) => {
      logStream.end();
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed (${code}): ${command} ${args.join(' ')}`));
    });
  });
}

async function runProcessCollectExitCode(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    logPath: string;
  },
): Promise<number> {
  await fsPromises.mkdir(path.dirname(options.logPath), { recursive: true });

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logStream = fs.createWriteStream(options.logPath, { encoding: 'utf8' });

    child.stdout.on('data', (chunk) => logStream.write(chunk));
    child.stderr.on('data', (chunk) => logStream.write(chunk));
    child.on('error', (error) => {
      logStream.end();
      reject(error);
    });
    child.on('close', (code) => {
      logStream.end();
      resolve(code ?? 1);
    });
  });
}

function buildIsaacEnv(options: Options): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: options.isaacLabRoot,
  };
}

async function runIsaacJsonTool(
  options: Options,
  scriptPath: string,
  stagePaths: string[],
  outputPath: string,
  logPath: string,
): Promise<JsonRecord> {
  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  await runProcess(
    options.isaacPython,
    [scriptPath, ...stagePaths, '--output', outputPath, '--headless'],
    {
      cwd: path.resolve('.'),
      env: buildIsaacEnv(options),
      logPath,
    },
  );

  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `Isaac JSON tool did not produce an output file: script=${scriptPath} output=${outputPath} log=${logPath}`,
    );
  }

  return readJsonRecordWithRetry(outputPath, {
    scriptPath,
    logPath,
  });
}

async function runJsonReportTool(params: {
  args: string[];
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logPath: string;
  outputPath: string;
  allowFailure?: boolean;
}): Promise<{ exitCode: number; report: JsonRecord }> {
  const exitCode = params.allowFailure
    ? await runProcessCollectExitCode(params.command, params.args, {
        cwd: params.cwd,
        env: params.env,
        logPath: params.logPath,
      })
    : (await runProcess(params.command, params.args, {
        cwd: params.cwd,
        env: params.env,
        logPath: params.logPath,
      }),
      0);

  if (!fs.existsSync(params.outputPath)) {
    throw new Error(
      `JSON report tool did not produce an output file: script=${params.args[0] || params.command} output=${params.outputPath} log=${params.logPath}`,
    );
  }

  const report = await readJsonRecordWithRetry(params.outputPath, {
    scriptPath: params.args[0] || params.command,
    logPath: params.logPath,
  });

  return { exitCode, report };
}

async function extractIsaacUsdTruth(
  options: Options,
  scriptPath: string,
  usdPath: string,
  outputPath: string,
  logPath: string,
): Promise<JsonRecord> {
  const { report } = await runJsonReportTool({
    command: options.isaacPython,
    args: [scriptPath, '--usd', usdPath, '--output', outputPath],
    cwd: path.resolve('.'),
    env: buildIsaacEnv(options),
    logPath,
    outputPath,
  });
  return report;
}

async function compareIsaacUsdTruth(params: {
  compareScriptPath: string;
  currentTruthOutputPath: string;
  enforceMeshPayloadHash?: boolean;
  options: Options;
  outputPath: string;
  truthOutputPath: string;
  logPath: string;
}): Promise<StrongCompareResult> {
  const args = [
    params.compareScriptPath,
    '--original',
    params.truthOutputPath,
    '--roundtrip',
    params.currentTruthOutputPath,
    '--output',
    params.outputPath,
  ];
  if (params.enforceMeshPayloadHash) {
    args.push('--enforce-mesh-payload-hash');
  }

  const { exitCode, report } = await runJsonReportTool({
    command: params.options.isaacPython,
    args,
    cwd: path.resolve('.'),
    logPath: params.logPath,
    outputPath: params.outputPath,
    allowFailure: true,
  });

  return {
    compareOutputPath: params.outputPath,
    currentTruthOutputPath: params.currentTruthOutputPath,
    exitCode,
    pass: exitCode === 0 && report.summary && (report.summary as JsonRecord).passed === true,
    report,
    truthOutputPath: params.truthOutputPath,
  };
}

function extractSuccessfulArticulationAttempt(summary: JsonRecord | null): JsonRecord | null {
  const attempts = Array.isArray(summary?.attempts) ? summary.attempts : [];
  for (const attempt of attempts) {
    if ((attempt as JsonRecord).initialized === true) {
      return attempt as JsonRecord;
    }
  }
  return null;
}

function summarizeStrongCompareFailure(report: JsonRecord): string {
  const sectionFailedCount = (sectionName: string): number => {
    const section = report[sectionName];
    if (!section || typeof section !== 'object') {
      return 0;
    }
    const summary = (section as JsonRecord).summary;
    return summary && typeof summary === 'object' ? Number((summary as JsonRecord).failed_count || 0) : 0;
  };
  const sectionMissingCount = (sectionName: string): number => {
    const section = report[sectionName];
    if (!section || typeof section !== 'object') {
      return 0;
    }
    const summary = (section as JsonRecord).summary;
    return summary && typeof summary === 'object' ? Number((summary as JsonRecord).missing_count || 0) : 0;
  };
  const sectionExtraCount = (sectionName: string): number => {
    const section = report[sectionName];
    if (!section || typeof section !== 'object') {
      return 0;
    }
    const summary = (section as JsonRecord).summary;
    return summary && typeof summary === 'object' ? Number((summary as JsonRecord).extra_count || 0) : 0;
  };
  const sectionPayloadMismatchCount = (sectionName: string): number => {
    const section = report[sectionName];
    if (!section || typeof section !== 'object') {
      return 0;
    }
    const summary = (section as JsonRecord).summary;
    return summary && typeof summary === 'object'
      ? Number((summary as JsonRecord).payload_mismatch_count || 0)
      : 0;
  };

  return (
    'strong transform compare mismatch against Isaac Sim truth: ' +
    [
      `meshes=${sectionFailedCount('meshes')}failed/${sectionMissingCount('meshes')}missing/${sectionExtraCount('meshes')}extra/${sectionPayloadMismatchCount('meshes')}payload`,
      `colliders=${sectionFailedCount('colliders')}failed/${sectionMissingCount('colliders')}missing/${sectionExtraCount('colliders')}extra`,
      `joints=${sectionFailedCount('joints')}failed/${sectionMissingCount('joints')}missing/${sectionExtraCount('joints')}extra`,
      `inertial=${sectionFailedCount('inertial')}failed/${sectionMissingCount('inertial')}missing/${sectionExtraCount('inertial')}extra`,
    ].join(', ')
  );
}

function normalizeColorTuple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) {
    return null;
  }

  const channels = value.slice(0, 3).map((entry) => Number(entry));
  if (channels.some((entry) => !Number.isFinite(entry))) {
    return null;
  }

  return [
    Number(channels[0].toFixed(6)),
    Number(channels[1].toFixed(6)),
    Number(channels[2].toFixed(6)),
  ];
}

function colorDistance(left: readonly number[], right: readonly number[]): number {
  return Math.max(
    Math.abs(left[0] - right[0]),
    Math.abs(left[1] - right[1]),
    Math.abs(left[2] - right[2]),
  );
}

function compareColorSets(
  currentColors: readonly [number, number, number][],
  truthColors: readonly [number, number, number][],
): {
  unmatchedCurrent: [number, number, number][];
  unmatchedTruth: [number, number, number][];
} {
  const remainingTruth = [...truthColors];
  const unmatchedCurrent: [number, number, number][] = [];

  currentColors.forEach((currentColor) => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    remainingTruth.forEach((truthColor, index) => {
      const distance = colorDistance(currentColor, truthColor);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    if (bestIndex === -1 || bestDistance > COLOR_TOLERANCE) {
      unmatchedCurrent.push(currentColor);
      return;
    }

    remainingTruth.splice(bestIndex, 1);
  });

  return {
    unmatchedCurrent,
    unmatchedTruth: remainingTruth,
  };
}

function normalizeMaterialSignature(value: unknown): MaterialSignature | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as JsonRecord;
  const color =
    record.color == null
      ? null
      : normalizeColorTuple(record.color) ||
        normalizeColorTuple(Array.isArray(record.color) ? record.color : null);
  const textured =
    typeof record.textured === 'boolean'
      ? record.textured
      : typeof record.source === 'string' && record.source.toLowerCase().includes('texture');

  return {
    color,
    textured,
  };
}

function normalizeMaterialSignatures(summary: JsonRecord): MaterialSignature[] {
  const signatures = Array.isArray(summary.visibleAppearanceSignatures)
    ? summary.visibleAppearanceSignatures
    : Array.isArray(summary.visibleMaterialSignatures)
      ? summary.visibleMaterialSignatures
      : null;

  if (signatures) {
    return signatures
      .map((entry) => normalizeMaterialSignature(entry))
      .filter((entry): entry is MaterialSignature => Boolean(entry));
  }

  const colors = Array.isArray(summary.visibleMaterialColors) ? summary.visibleMaterialColors : [];
  return colors
    .map((entry) => normalizeColorTuple(entry))
    .filter((entry): entry is [number, number, number] => Boolean(entry))
    .map((color) => ({
      color,
      textured: false,
    }));
}

function convertSrgbMaterialSignatureToUsd(
  signature: MaterialSignature,
): MaterialSignature {
  return {
    ...signature,
    color: signature.color
      ? (toUsdAuthoredColorFromSrgbTuple(signature.color).map((entry) =>
          Number(entry.toFixed(6)),
        ) as [number, number, number])
      : null,
  };
}

function materialSignatureDistance(left: MaterialSignature, right: MaterialSignature): number {
  if (left.textured !== right.textured) {
    return Number.POSITIVE_INFINITY;
  }

  if (!left.color && !right.color) {
    return 0;
  }

  if (!left.color || !right.color) {
    return Number.POSITIVE_INFINITY;
  }

  return colorDistance(left.color, right.color);
}

function compareMaterialSignatureSets(
  currentSignatures: readonly MaterialSignature[],
  truthSignatures: readonly MaterialSignature[],
): {
  unmatchedCurrent: MaterialSignature[];
  unmatchedTruth: MaterialSignature[];
} {
  const remainingTruth = [...truthSignatures];
  const unmatchedCurrent: MaterialSignature[] = [];

  currentSignatures.forEach((currentSignature) => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    remainingTruth.forEach((truthSignature, index) => {
      const distance = materialSignatureDistance(currentSignature, truthSignature);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    if (bestIndex === -1 || bestDistance > COLOR_TOLERANCE) {
      unmatchedCurrent.push(currentSignature);
      return;
    }

    remainingTruth.splice(bestIndex, 1);
  });

  return {
    unmatchedCurrent,
    unmatchedTruth: remainingTruth,
  };
}

function materialSignatureComparisonPassed(comparison: {
  unmatchedCurrent: readonly MaterialSignature[];
  unmatchedTruth: readonly MaterialSignature[];
}): boolean {
  return comparison.unmatchedCurrent.length === 0 && comparison.unmatchedTruth.length === 0;
}

function normalizeSourceMaterialColor(material: {
  color?: unknown;
  colorRgba?: unknown;
}): [number, number, number] | null {
  if (
    Array.isArray(material.colorRgba) &&
    material.colorRgba.length >= 3 &&
    material.colorRgba.slice(0, 3).every((entry) => Number.isFinite(entry))
  ) {
    return toUsdAuthoredColorFromSrgbTuple([
      Number(material.colorRgba[0]),
      Number(material.colorRgba[1]),
      Number(material.colorRgba[2]),
    ]).map((entry) => Number(entry.toFixed(6))) as [number, number, number];
  }

  const parsedColor = parseThreeColorWithOpacity(
    typeof material.color === 'string' ? material.color : null,
  );
  if (!parsedColor) {
    return null;
  }

  return toUsdAuthoredColor(parsedColor.color).map((entry) =>
    Number(entry.toFixed(6)),
  ) as [number, number, number];
}

function createSourceMaterialSignature(material: {
  color?: unknown;
  colorRgba?: unknown;
  texture?: unknown;
}): MaterialSignature | null {
  const color = normalizeSourceMaterialColor(material);
  const textured = typeof material.texture === "string" && material.texture.trim().length > 0;
  if (!color && !textured) {
    return null;
  }

  return {
    color,
    textured,
  };
}

function materialSignatureSortKey(signature: MaterialSignature): string {
  const colorKey = signature.color ? signature.color.join(',') : '';
  return `${signature.textured ? 1 : 0}:${colorKey}`;
}

function extractSourceVisibleMaterialSignatures(
  robot: Pick<RobotData, 'links' | 'materials'>,
): MaterialSignature[] {
  const signatures: MaterialSignature[] = [];
  const seen = new Set<string>();

  const pushSignature = (signature: MaterialSignature | null): void => {
    if (!signature) {
      return;
    }

    const key = JSON.stringify(signature);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    signatures.push(signature);
  };

  Object.values(robot.links)
    .sort((left, right) =>
      String(left.name || left.id || '').localeCompare(String(right.name || right.id || '')),
    )
    .forEach((link) => {
      const visuals = [link.visual, ...(Array.isArray(link.visualBodies) ? link.visualBodies : [])];
      visuals.forEach((visual, index) => {
        if (
          !visual ||
          visual.visible === false ||
          visual.materialSource === 'gazebo' ||
          !hasGeometryType(visual.type)
        ) {
          return;
        }

        const resolved = resolveVisualMaterialOverride(robot, link, visual, {
          isPrimaryVisual: index === 0,
        });
        const materialEntries =
          Array.isArray(resolved.authoredMaterials) && resolved.authoredMaterials.length > 0
            ? resolved.authoredMaterials
            : [
                {
                  color: resolved.color,
                  colorRgba: resolved.colorRgba,
                  texture: resolved.texture,
                },
              ];

        materialEntries.forEach((material) => {
          pushSignature(createSourceMaterialSignature(material));
        });
      });
    });

  return signatures.sort((left, right) =>
    materialSignatureSortKey(left).localeCompare(materialSignatureSortKey(right)),
  );
}

function usesOnlyDefaultVisibleMaterials(summary: JsonRecord): boolean {
  const names = Array.isArray(summary.visibleMaterialNames)
    ? summary.visibleMaterialNames
        .map((entry) => String(entry || '').trim())
        .filter((entry) => entry.length > 0)
    : [];
  return names.length > 0 && names.every((name) => /^defaultmaterial(?:_\d+)?$/i.test(name));
}

function normalizeScalar(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeTuple3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) {
    return null;
  }

  const normalized = value.slice(0, 3).map((entry) => Number(entry));
  if (normalized.some((entry) => !Number.isFinite(entry))) {
    return null;
  }

  return [normalized[0]!, normalized[1]!, normalized[2]!];
}

function normalizeTuple4(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }

  const normalized = value.slice(0, 4).map((entry) => Number(entry));
  if (normalized.some((entry) => !Number.isFinite(entry))) {
    return null;
  }

  return [normalized[0]!, normalized[1]!, normalized[2]!, normalized[3]!];
}

function normalizeCountRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .map(([key, entry]) => [key, Number(entry)] as const)
      .filter(([, entry]) => Number.isFinite(entry) && entry > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function normalizePhysicsBodies(summary: JsonRecord): Record<string, PhysicsBodySummary> {
  const rigidBodies =
    summary.rigidBodies && typeof summary.rigidBodies === 'object'
      ? (summary.rigidBodies as JsonRecord)
      : {};

  return Object.fromEntries(
    Object.entries(rigidBodies)
      .map(([bodyPath, value]) => {
        const record = value as JsonRecord;
        return [
          bodyPath,
          {
            mass: normalizeScalar(record.mass),
            centerOfMass: normalizeTuple3(record.centerOfMass),
            diagonalInertia: normalizeTuple3(record.diagonalInertia),
            principalAxes: normalizeTuple4(record.principalAxes),
            collisionCount: Number(record.collisionCount || 0),
            collisionTypes: normalizeCountRecord(record.collisionTypes),
            meshCollisionApproximations: normalizeStringArray(record.meshCollisionApproximations),
          } satisfies PhysicsBodySummary,
        ] as const;
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function numbersNear(left: number | null, right: number | null, tolerance = PHYSICS_TOLERANCE): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return Math.abs(left - right) <= Math.max(tolerance, Math.abs(right) * tolerance);
}

function tupleNear(
  left: readonly number[] | null,
  right: readonly number[] | null,
  tolerance = PHYSICS_TOLERANCE,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) =>
    Math.abs(entry - (right[index] ?? 0)) <= Math.max(tolerance, Math.abs(right[index] ?? 0) * tolerance),
  );
}

function sortTuple3(value: [number, number, number] | null): [number, number, number] | null {
  if (!value) {
    return null;
  }

  return [...value].sort((left, right) => left - right) as [number, number, number];
}

function deriveValidationStatus(
  hardFailures: readonly string[],
  softFailures: readonly string[],
): ValidationStatus {
  if (hardFailures.length > 0) {
    return 'fail';
  }

  return softFailures.length > 0 ? 'partial' : 'pass';
}

function hasGeometryType(type: unknown): boolean {
  const normalized = String(type || '').trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'none';
}

function extractExpectedCollisionBodyCounts(robot: {
  links: Record<
    string,
    {
      id: string;
      name: string;
      collision?: { type?: string | null };
      collisionBodies?: Array<{ type?: string | null }>;
    }
  >;
}): Record<string, number> {
  return Object.fromEntries(
    Object.values(robot.links)
      .map((link) => {
        const expectedCollisionCount = [
          link.collision,
          ...(Array.isArray(link.collisionBodies) ? link.collisionBodies : []),
        ].filter((body) => hasGeometryType(body?.type)).length;

        return [`/${link.name || link.id}`, expectedCollisionCount] as const;
      })
      .filter(([, expectedCollisionCount]) => expectedCollisionCount > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function extractExplicitInertialBodies(robot: {
  links: Record<string, { id: string; name: string; inertial?: unknown }>;
}): string[] {
  return Object.values(robot.links)
    .filter((link) => link.inertial != null)
    .map((link) => `/${link.name || link.id}`)
    .sort((left, right) => left.localeCompare(right));
}

async function resolveFixtureSource(
  options: Options,
  fixture: ModelFixture,
): Promise<ResolvedFixtureSource> {
  if (fixture.sourceFormat === 'urdf') {
    const urdfText = await fsPromises.readFile(fixture.urdfPath, 'utf8');
    const robot = parseURDF(urdfText);
    if (!robot) {
      fail(`Failed to parse URDF fixture: ${fixture.urdfPath}`);
    }

    return {
      explicitInertialBodies: extractExplicitInertialBodies(robot),
      expectedCollisionBodyCounts: extractExpectedCollisionBodyCounts(robot),
      extraMeshFiles: await buildExtraMeshFiles(options.fixtureRoot, fixture),
      robotData: robot,
      sourceMaterialSignatures: extractSourceVisibleMaterialSignatures(robot),
    };
  }

  const context = await createSourceContext(options.fixtureRoot, fixture.supportRootAbs);
  const file = context.availableFiles.find(
    (candidate) => candidate.name === fixture.entryPath && candidate.format === fixture.sourceFormat,
  );
  if (!file) {
    fail(`Failed to reconstruct fixture file context: ${fixture.entryPath}`);
  }

  const importResult = withSuppressedImportNoise(() =>
    resolveRobotFileData(file, {
      availableFiles: context.availableFiles,
      allFileContents: context.allFileContents,
    }),
  );
  if (importResult.status !== 'ready') {
    fail(
      `Failed to resolve ${fixture.sourceFormat.toUpperCase()} fixture "${fixture.entryPath}": ${importResult.status === 'error' ? importResult.message || importResult.reason : importResult.status}`,
    );
  }

  return {
    explicitInertialBodies: extractExplicitInertialBodies(importResult.robotData),
    expectedCollisionBodyCounts: extractExpectedCollisionBodyCounts(importResult.robotData),
    extraMeshFiles: await buildExtraMeshFiles(options.fixtureRoot, fixture),
    robotData: importResult.robotData,
    sourceMaterialSignatures: extractSourceVisibleMaterialSignatures(importResult.robotData),
  };
}

async function exportCurrentUsd(
  options: Options,
  fixture: ModelFixture,
  source: ResolvedFixtureSource,
  outputDir: string,
  fileFormat: CurrentExportFormat,
): Promise<{
  currentRootLayerPath: string;
  currentStagePath: string;
  format: CurrentExportFormat;
  robotName: string;
}> {
  const payload = await withSuppressedColladaLogs(() =>
    exportRobotToUsd({
      robot: source.robotData,
      exportName: source.robotData.name || fixture.stem,
      assets: {},
      extraMeshFiles: source.extraMeshFiles,
      fileFormat,
      layoutProfile: 'isaacsim',
      meshCompression: {
        enabled: options.compressMeshes,
        quality: options.meshQuality,
      },
    }),
  );

  await writeArchiveFiles(outputDir, payload.archiveFiles);
  return {
    currentRootLayerPath: payload.rootLayerPath,
    currentStagePath: path.resolve(outputDir, payload.rootLayerPath),
    format: fileFormat,
    robotName: source.robotData.name || fixture.stem,
  };
}

async function generateIsaacTruth(
  options: Options,
  fixture: ModelFixture,
  truthDir: string,
  logPath: string,
): Promise<string> {
  const truthUsdPath = path.join(truthDir, `${fixture.stem}.usda`);
  await fsPromises.mkdir(truthDir, { recursive: true });
  const converterScript =
    fixture.sourceFormat === 'urdf'
      ? path.join(options.isaacLabRoot, 'scripts/tools/convert_urdf.py')
      : path.resolve('scripts/tools/isaacsim/convert_mjcf_truth.py');
  await runProcess(
    options.isaacPython,
    [converterScript, fixture.entryAbsPath, truthUsdPath, '--headless'],
    {
      cwd: fixture.sourceFormat === 'urdf' ? options.isaacLabRoot : path.resolve('.'),
      env: buildIsaacEnv(options),
      logPath,
    },
  );
  return truthUsdPath;
}

function evaluateCurrentExportAgainstTruth(params: {
  currentExport: {
    currentStagePath: string;
    format: CurrentExportFormat;
  };
  expectedCollisionBodyCounts: Record<string, number>;
  explicitInertialBodies: string[];
  stageSummary: JsonRecord;
  articulationSummary: JsonRecord;
  materialSummary: JsonRecord;
  physicsSummary: JsonRecord;
  sourceMaterialSignatures: MaterialSignature[];
  truthStagePath: string;
}): JsonRecord {
  const currentStage = (params.stageSummary[params.currentExport.currentStagePath] || {}) as JsonRecord;
  const truthStage = (params.stageSummary[params.truthStagePath] || {}) as JsonRecord;
  const currentArticulation = (params.articulationSummary[params.currentExport.currentStagePath] ||
    {}) as JsonRecord;
  const truthArticulation = (params.articulationSummary[params.truthStagePath] || {}) as JsonRecord;
  const currentMaterials = (params.materialSummary[params.currentExport.currentStagePath] ||
    {}) as JsonRecord;
  const truthMaterials = (params.materialSummary[params.truthStagePath] || {}) as JsonRecord;
  const currentPhysics = (params.physicsSummary[params.currentExport.currentStagePath] ||
    {}) as JsonRecord;
  const truthPhysics = (params.physicsSummary[params.truthStagePath] || {}) as JsonRecord;

  const hardFailures: string[] = [];
  const softFailures: string[] = [];
  if (currentStage.open_ok !== true) {
    hardFailures.push(`current ${params.currentExport.format} failed to open in Isaac Sim`);
  }
  if (truthStage.open_ok !== true) {
    hardFailures.push('truth USD failed to open in Isaac Sim');
  }
  if (Number(currentStage.invalid_joint_target_count || 0) !== 0) {
    hardFailures.push(`current ${params.currentExport.format} still has invalid joint targets`);
  }
  if ((currentStage.joint_count || 0) !== (truthStage.joint_count || 0)) {
    softFailures.push(
      `joint count mismatch: current=${currentStage.joint_count} truth=${truthStage.joint_count}`,
    );
  }
  if ((currentStage.rigid_body_count || 0) !== (truthStage.rigid_body_count || 0)) {
    softFailures.push(
      `rigid body count mismatch: current=${currentStage.rigid_body_count} truth=${truthStage.rigid_body_count}`,
    );
  }
  if (Number(currentPhysics.collisionWithoutBodyCount || 0) !== 0) {
    hardFailures.push(`current ${params.currentExport.format} has collision prims without rigid-body owners`);
  }
  const currentAttempt = extractSuccessfulArticulationAttempt(currentArticulation);
  const truthAttempt = extractSuccessfulArticulationAttempt(truthArticulation);
  if (!currentAttempt) {
    softFailures.push(`current ${params.currentExport.format} did not initialize as an Isaac articulation`);
  }
  if (!truthAttempt) {
    softFailures.push('truth USD did not initialize as an Isaac articulation');
  }
  if (currentAttempt && truthAttempt) {
    if ((currentAttempt.candidate || null) !== (truthAttempt.candidate || null)) {
      softFailures.push(
        `articulation root mismatch: current=${currentAttempt.candidate} truth=${truthAttempt.candidate}`,
      );
    }
    if ((currentAttempt.num_dof || 0) !== (truthAttempt.num_dof || 0)) {
      softFailures.push(
        `DOF count mismatch: current=${currentAttempt.num_dof} truth=${truthAttempt.num_dof}`,
      );
    }
    if ((currentAttempt.body_count || 0) !== (truthAttempt.body_count || 0)) {
      softFailures.push(
        `articulation body count mismatch: current=${currentAttempt.body_count} truth=${truthAttempt.body_count}`,
      );
    }
  }

  const currentMaterialCount = Number(currentMaterials.materialCount || 0);
  const truthMaterialCount = Number(truthMaterials.materialCount || 0);
  const currentVisibleMaterialCount = Number(
    currentMaterials.visibleAppearanceCount ||
      currentMaterials.visibleMaterialCount ||
      currentMaterials.visibleBindingCount ||
      0,
  );
  const truthVisibleMaterialCount = Number(
    truthMaterials.visibleAppearanceCount ||
      truthMaterials.visibleMaterialCount ||
      truthMaterials.visibleBindingCount ||
      0,
  );

  const currentMaterialColors = (Array.isArray(currentMaterials.visibleMaterialColors)
    ? currentMaterials.visibleMaterialColors
    : []
  )
    .map((entry) => normalizeColorTuple(entry))
    .filter((entry): entry is [number, number, number] => Boolean(entry));
  const truthMaterialColors = (Array.isArray(truthMaterials.visibleMaterialColors)
    ? truthMaterials.visibleMaterialColors
    : []
  )
    .map((entry) => normalizeColorTuple(entry))
    .filter((entry): entry is [number, number, number] => Boolean(entry))
    .map(
      (entry) =>
        toUsdAuthoredColorFromSrgbTuple(entry).map((channel) =>
          Number(channel.toFixed(6)),
        ) as [number, number, number],
    );
  const colorComparison = compareColorSets(currentMaterialColors, truthMaterialColors);

  const currentMaterialSignatures = normalizeMaterialSignatures(currentMaterials);
  const truthMaterialSignatures = normalizeMaterialSignatures(truthMaterials).map(
    convertSrgbMaterialSignatureToUsd,
  );
  const sourceMaterialSignatures = params.sourceMaterialSignatures;
  const currentTexturedMaterialSignatureCount = currentMaterialSignatures.filter(
    (signature) => signature.textured,
  ).length;
  const truthTexturedMaterialSignatureCount = truthMaterialSignatures.filter(
    (signature) => signature.textured,
  ).length;
  const sourceTexturedMaterialSignatureCount = sourceMaterialSignatures.filter(
    (signature) => signature.textured,
  ).length;
  const currentVisibleTexturedMaterialCount = Number(
    currentMaterials.visibleTexturedMaterialCount || 0,
  );
  const truthVisibleTexturedMaterialCount = Number(truthMaterials.visibleTexturedMaterialCount || 0);
  const signatureComparison = compareMaterialSignatureSets(
    currentMaterialSignatures,
    truthMaterialSignatures,
  );
  const sourceSignatureComparison = compareMaterialSignatureSets(
    currentMaterialSignatures,
    sourceMaterialSignatures,
  );
  const truthSourceSignatureComparison = compareMaterialSignatureSets(
    truthMaterialSignatures,
    sourceMaterialSignatures,
  );
  const currentMatchesSource =
    sourceMaterialSignatures.length === 0 || materialSignatureComparisonPassed(sourceSignatureComparison);
  const truthMatchesSource =
    sourceMaterialSignatures.length === 0 ||
    materialSignatureComparisonPassed(truthSourceSignatureComparison);
  const truthUsesDefaultVisibleMaterials = usesOnlyDefaultVisibleMaterials(truthMaterials);

  if (sourceMaterialSignatures.length > 0 && !currentMatchesSource) {
    softFailures.push('visible material appearance mismatch against imported source');
  }

  const truthMaterialMismatch = !materialSignatureComparisonPassed(signatureComparison);
  const ignoreTruthMaterialMismatch =
    truthMaterialMismatch &&
    sourceMaterialSignatures.length > 0 &&
    currentMatchesSource &&
    !truthMatchesSource &&
    truthUsesDefaultVisibleMaterials;
  if (truthMaterialMismatch && !ignoreTruthMaterialMismatch) {
    softFailures.push('visible material appearance mismatch against Isaac Sim truth');
  }

  const currentBodies = normalizePhysicsBodies(currentPhysics);
  const truthBodies = normalizePhysicsBodies(truthPhysics);
  const currentBodyPaths = Object.keys(currentBodies).sort();
  const truthBodyPaths = Object.keys(truthBodies).sort();
  const expectedCollisionBodies = Object.keys(params.expectedCollisionBodyCounts).sort();
  const currentCollisionBodies = currentBodyPaths
    .filter((bodyPath) => (currentBodies[bodyPath]?.collisionCount || 0) > 0)
    .sort((left, right) => left.localeCompare(right));

  if (JSON.stringify(currentBodyPaths) !== JSON.stringify(truthBodyPaths)) {
    softFailures.push('rigid-body property set mismatch against Isaac Sim truth');
  }
  if (expectedCollisionBodies.length > 0 && currentCollisionBodies.length === 0) {
    softFailures.push(`current ${params.currentExport.format} has no authored collision bodies`);
  }
  const missingCollisionBodies = expectedCollisionBodies.filter(
    (bodyPath) => !currentCollisionBodies.includes(bodyPath),
  );
  if (missingCollisionBodies.length > 0) {
    softFailures.push(
      `current ${params.currentExport.format} is missing collisions for ${missingCollisionBodies.slice(0, 12).join(', ')}`,
    );
  }
  const unexpectedCollisionBodies = currentCollisionBodies.filter(
    (bodyPath) => params.expectedCollisionBodyCounts[bodyPath] == null,
  );
  if (unexpectedCollisionBodies.length > 0) {
    softFailures.push(
      `current ${params.currentExport.format} has unexpected collisions on ${unexpectedCollisionBodies.slice(0, 12).join(', ')}`,
    );
  }
  const collisionCountMismatches = expectedCollisionBodies
    .map((bodyPath) => {
      const expectedCollisionCount = params.expectedCollisionBodyCounts[bodyPath] || 0;
      const currentCollisionCount = currentBodies[bodyPath]?.collisionCount || 0;
      if (currentCollisionCount === expectedCollisionCount) {
        return null;
      }

      return `${bodyPath}: current=${currentCollisionCount} expected=${expectedCollisionCount}`;
    })
    .filter((entry): entry is string => Boolean(entry));
  if (collisionCountMismatches.length > 0) {
    softFailures.push(
      `current ${params.currentExport.format} collision-count mismatch: ${collisionCountMismatches.slice(0, 12).join('; ')}`,
    );
  }

  const physicsMismatches: string[] = [];
  params.explicitInertialBodies.forEach((bodyPath) => {
    const currentBody = currentBodies[bodyPath];
    const truthBody = truthBodies[bodyPath];
    if (!currentBody || !truthBody) {
      physicsMismatches.push(`${bodyPath}: missingRigidBodyProperties`);
      return;
    }

    const issues: string[] = [];
    if (!numbersNear(currentBody.mass, truthBody.mass)) {
      issues.push('mass');
    }
    if (!tupleNear(currentBody.centerOfMass, truthBody.centerOfMass)) {
      issues.push('centerOfMass');
    }
    if (!tupleNear(sortTuple3(currentBody.diagonalInertia), sortTuple3(truthBody.diagonalInertia))) {
      issues.push('principalInertia');
    }

    if (issues.length > 0) {
      physicsMismatches.push(`${bodyPath}: ${issues.join(',')}`);
    }
  });

  if (physicsMismatches.length > 0) {
    softFailures.push(
      `physics property mismatch against Isaac Sim truth: ${physicsMismatches.slice(0, 8).join('; ')}`,
    );
  }

  const status = deriveValidationStatus(hardFailures, softFailures);
  const failures = [...hardFailures, ...softFailures];

  return {
    format: params.currentExport.format,
    currentStagePath: params.currentExport.currentStagePath,
    pass: status === 'pass',
    partial: status === 'partial',
    status,
    failures,
    hardFailures,
    softFailures,
    articulationRoot: {
      current: currentAttempt?.candidate || null,
      truth: truthAttempt?.candidate || null,
    },
    dofCount: {
      current: currentAttempt?.num_dof || null,
      truth: truthAttempt?.num_dof || null,
    },
    bodyCount: {
      current: currentAttempt?.body_count || null,
      truth: truthAttempt?.body_count || null,
    },
    collisionCount: {
      current: Number(currentPhysics.collisionCount || 0),
      isaacTruthReported: Number(truthPhysics.collisionCount || 0),
      expected: Object.values(params.expectedCollisionBodyCounts).reduce(
        (sum, value) => sum + value,
        0,
      ),
      expectedBodies: expectedCollisionBodies.length,
      currentBodies: currentCollisionBodies.length,
    },
    rigidBodyPropertyCount: {
      current: currentBodyPaths.length,
      truth: truthBodyPaths.length,
    },
    materialCount: {
      current: currentMaterialCount,
      truth: truthMaterialCount,
    },
    visibleMaterialCount: {
      current: currentVisibleMaterialCount,
      truth: truthVisibleMaterialCount,
    },
    materialColors: {
      current: currentMaterialColors,
      truth: truthMaterialColors,
      unmatchedCurrent: colorComparison.unmatchedCurrent,
      unmatchedTruth: colorComparison.unmatchedTruth,
      tolerance: COLOR_TOLERANCE,
    },
    materialSignatures: {
      current: currentMaterialSignatures,
      source: sourceMaterialSignatures,
      truth: truthMaterialSignatures,
      unmatchedCurrent: signatureComparison.unmatchedCurrent,
      unmatchedTruth: signatureComparison.unmatchedTruth,
      tolerance: COLOR_TOLERANCE,
    },
    sourceMaterialMatch: {
      currentMatchesSource,
      truthMatchesSource,
      truthUsesDefaultVisibleMaterials,
      unmatchedCurrent: sourceSignatureComparison.unmatchedCurrent,
      unmatchedSourceFromCurrent: sourceSignatureComparison.unmatchedTruth,
      unmatchedTruthFromSource: truthSourceSignatureComparison.unmatchedCurrent,
      unmatchedSourceFromTruth: truthSourceSignatureComparison.unmatchedTruth,
    },
    materialTextureSummary: {
      currentVisibleTexturedMaterialCount,
      truthVisibleTexturedMaterialCount,
      currentTexturedMaterialSignatureCount,
      truthTexturedMaterialSignatureCount,
      sourceTexturedMaterialSignatureCount,
    },
    physicsMismatches,
    unexpectedCollisionBodies,
    collisionCountMismatches,
    missingCollisionBodies,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { fixtures, skipped } = await discoverFixtures(options);
  const stageScript = path.resolve('scripts/tools/isaacsim/inspect_isaacsim_usd_stage.py');
  const articulationScript = path.resolve('scripts/tools/isaacsim/inspect_isaacsim_articulation.py');
  const materialScript = path.resolve('scripts/tools/isaacsim/inspect_isaacsim_materials.py');
  const physicsScript = path.resolve('scripts/tools/isaacsim/inspect_isaacsim_physics_properties.py');
  const extractTruthScript = path.resolve('test/usd-viewer/scripts/extract_isaacsim_truth.py');
  const compareTruthScript = path.resolve('test/usd-viewer/scripts/compare_roundtrip_truth.py');

  const results: JsonRecord[] = [];

  try {
    for (const fixture of fixtures) {
      const modelSlug = sanitizePathSegment(fixture.id);
      const modelRoot = path.join(options.artifactsDir, modelSlug);
      const currentDir = path.join(modelRoot, 'current');
      const truthDir = path.join(modelRoot, 'truth');
      const reportDir = path.join(modelRoot, 'reports');
      const logDir = path.join(modelRoot, 'logs');
      const strongReportDir = path.join(reportDir, 'strong');
      const strongLogDir = path.join(logDir, 'strong');

      await fsPromises.mkdir(modelRoot, { recursive: true });
      await fsPromises.mkdir(reportDir, { recursive: true });

      process.stdout.write(`[isaacsim-truth] model=${fixture.id}\n`);
      const source = await resolveFixtureSource(options, fixture);

      const currentExports = [
        await exportCurrentUsd(options, fixture, source, path.join(currentDir, 'usda'), 'usda'),
        await exportCurrentUsd(options, fixture, source, path.join(currentDir, 'usd'), 'usd'),
      ];
      const truthStagePath = await generateIsaacTruth(
        options,
        fixture,
        truthDir,
        path.join(logDir, `convert_${fixture.sourceFormat}.log`),
      );

      const stageSummary = await runIsaacJsonTool(
        options,
        stageScript,
        [...currentExports.map((entry) => entry.currentStagePath), truthStagePath],
        path.join(reportDir, 'stage.json'),
        path.join(logDir, 'stage.log'),
      );
      const articulationSummary = await runIsaacJsonTool(
        options,
        articulationScript,
        [...currentExports.map((entry) => entry.currentStagePath), truthStagePath],
        path.join(reportDir, 'articulation.json'),
        path.join(logDir, 'articulation.log'),
      );
      const materialSummary = await runIsaacJsonTool(
        options,
        materialScript,
        [...currentExports.map((entry) => entry.currentStagePath), truthStagePath],
        path.join(reportDir, 'materials.json'),
        path.join(logDir, 'materials.log'),
      );
      const physicsSummary = await runIsaacJsonTool(
        options,
        physicsScript,
        [...currentExports.map((entry) => entry.currentStagePath), truthStagePath],
        path.join(reportDir, 'physics.json'),
        path.join(logDir, 'physics.log'),
      );
      const truthExtractionPath = path.join(strongReportDir, 'truth.json');
      await extractIsaacUsdTruth(
        options,
        extractTruthScript,
        truthStagePath,
        truthExtractionPath,
        path.join(strongLogDir, 'truth.log'),
      );
      const strongComparisons = Object.fromEntries(
        await Promise.all(
          currentExports.map(async (currentExport) => {
            const formatDir = path.join(strongReportDir, currentExport.format);
            const formatLogDir = path.join(strongLogDir, currentExport.format);
            const currentTruthOutputPath = path.join(formatDir, 'current.json');
            const compareOutputPath = path.join(formatDir, 'compare.json');

            await extractIsaacUsdTruth(
              options,
              extractTruthScript,
              currentExport.currentStagePath,
              currentTruthOutputPath,
              path.join(formatLogDir, 'extract.log'),
            );
            const comparison = await compareIsaacUsdTruth({
              compareScriptPath: compareTruthScript,
              currentTruthOutputPath,
              options,
              outputPath: compareOutputPath,
              truthOutputPath: truthExtractionPath,
              logPath: path.join(formatLogDir, 'compare.log'),
            });

            return [currentExport.format, comparison] as const;
          }),
        ),
      );
      const usdaStrongComparison = strongComparisons.usda as StrongCompareResult | undefined;
      const usdStrongComparison = strongComparisons.usd as StrongCompareResult | undefined;
      const usdUsdaParity =
        usdaStrongComparison && usdStrongComparison
          ? await compareIsaacUsdTruth({
              compareScriptPath: compareTruthScript,
              currentTruthOutputPath: usdStrongComparison.currentTruthOutputPath,
              enforceMeshPayloadHash: true,
              options,
              outputPath: path.join(strongReportDir, 'usd-usda-parity', 'compare.json'),
              truthOutputPath: usdaStrongComparison.currentTruthOutputPath,
              logPath: path.join(strongLogDir, 'usd-usda-parity', 'compare.log'),
            })
          : null;

      const formatResults = currentExports.map((currentExport) => {
        const baseResult = evaluateCurrentExportAgainstTruth({
          currentExport,
          expectedCollisionBodyCounts: source.expectedCollisionBodyCounts,
          explicitInertialBodies: source.explicitInertialBodies,
          stageSummary,
          articulationSummary,
          materialSummary,
          physicsSummary,
          sourceMaterialSignatures: source.sourceMaterialSignatures,
          truthStagePath,
        });
        const strongComparison = strongComparisons[currentExport.format];
        const failures = Array.isArray(baseResult.failures)
          ? baseResult.failures.map((entry) => String(entry))
          : [];

        if (strongComparison && !strongComparison.pass) {
          failures.push(summarizeStrongCompareFailure(strongComparison.report));
        }
        const baseStatus = String(baseResult.status || (baseResult.pass === true ? 'pass' : 'fail'));
        const status: ValidationStatus =
          strongComparison?.pass === false && baseStatus === 'pass'
            ? 'partial'
            : baseStatus === 'partial'
              ? 'partial'
              : baseStatus === 'fail'
                ? 'fail'
                : 'pass';

        return {
          ...baseResult,
          pass: status === 'pass',
          partial: status === 'partial',
          status,
          failures,
          meshPayloadSummary:
            strongComparison?.report.meshes &&
            typeof strongComparison.report.meshes === 'object' &&
            (strongComparison.report.meshes as JsonRecord).summary &&
            typeof (strongComparison.report.meshes as JsonRecord).summary === 'object'
              ? {
                  payloadComparedCount: Number(
                    (((strongComparison.report.meshes as JsonRecord).summary as JsonRecord)
                      .payload_compared_count as number | undefined) || 0,
                  ),
                  payloadMismatchCount: Number(
                    (((strongComparison.report.meshes as JsonRecord).summary as JsonRecord)
                      .payload_mismatch_count as number | undefined) || 0,
                  ),
                }
              : null,
          strongCompare: strongComparison
            ? {
                pass: strongComparison.pass,
                exitCode: strongComparison.exitCode,
                reportPath: strongComparison.compareOutputPath,
                truthPath: strongComparison.truthOutputPath,
                currentPath: strongComparison.currentTruthOutputPath,
                summary:
                  strongComparison.report.summary && typeof strongComparison.report.summary === 'object'
                    ? strongComparison.report.summary
                    : null,
              }
            : null,
        };
      });
      const formatResultsByName = Object.fromEntries(
        formatResults.map((entry) => [String(entry.format), entry]),
      );
      const parityFailure =
        usdUsdaParity && !usdUsdaParity.pass
          ? `usd/usda parity: ${summarizeStrongCompareFailure(usdUsdaParity.report)}`
          : null;
      const resultFailures = formatResults.flatMap((entry) =>
        (Array.isArray(entry.failures) ? entry.failures : []).map(
          (failure) => `${String(entry.format)}: ${String(failure)}`,
        ),
      );
      if (parityFailure) {
        resultFailures.push(parityFailure);
      }
      const resultStatus: ValidationStatus =
        formatResults.some((entry) => entry.status === 'fail')
          ? 'fail'
          : formatResults.some((entry) => entry.status === 'partial') || Boolean(parityFailure)
            ? 'partial'
            : 'pass';
      const result: JsonRecord = {
        id: fixture.id,
        sourceFormat: fixture.sourceFormat,
        sourcePath: fixture.entryPath,
        urdfPath: fixture.sourceFormat === 'urdf' ? fixture.urdfPath : null,
        truthStagePath,
        currentStagePath: currentExports[0]?.currentStagePath || null,
        currentStagePaths: {
          usda: currentExports.find((entry) => entry.format === 'usda')?.currentStagePath || null,
          usd: currentExports.find((entry) => entry.format === 'usd')?.currentStagePath || null,
        },
        pass: resultStatus === 'pass',
        partial: resultStatus === 'partial',
        status: resultStatus,
        failures: resultFailures,
        formats: formatResultsByName,
        usdUsdaParity: usdUsdaParity
          ? {
              pass: usdUsdaParity.pass,
              exitCode: usdUsdaParity.exitCode,
              reportPath: usdUsdaParity.compareOutputPath,
              usdaTruthPath: usdUsdaParity.truthOutputPath,
              usdTruthPath: usdUsdaParity.currentTruthOutputPath,
              summary:
                usdUsdaParity.report.summary && typeof usdUsdaParity.report.summary === 'object'
                  ? usdUsdaParity.report.summary
                  : null,
            }
          : null,
        stageSummaryPath: path.join(reportDir, 'stage.json'),
        articulationSummaryPath: path.join(reportDir, 'articulation.json'),
        materialSummaryPath: path.join(reportDir, 'materials.json'),
      };

      results.push(result);
      formatResults.forEach((entry) => {
        const visibleMaterialCount = entry.visibleMaterialCount as JsonRecord;
        process.stdout.write(
          `[isaacsim-truth]   ${String(entry.format)} pass=${String(entry.pass)} visibleMaterials=${String(visibleMaterialCount.current || 0)}/${String(visibleMaterialCount.truth || 0)}\n`,
        );
      });
      process.stdout.write(`[isaacsim-truth]   overall=${String(result.status)}\n`);
    }
  } finally {
    disposeColladaParseWorkerPoolClient();
  }

  const summary = {
    generatedAtUtc: new Date().toISOString(),
    workspace: process.cwd(),
    fixtureRoot: options.fixtureRoot,
    artifactRoot: options.artifactsDir,
    isaacLabRoot: options.isaacLabRoot,
    isaacPython: options.isaacPython,
    modelCount: results.length,
    passCount: results.filter((entry) => entry.status === 'pass').length,
    partialCount: results.filter((entry) => entry.status === 'partial').length,
    failCount: results.filter((entry) => entry.status === 'fail').length,
    skippedCount: skipped.length,
    skipped,
    models: results,
  };

  await writeJsonAtomic(options.outputPath, summary);
  process.stdout.write(`[isaacsim-truth] output=${options.outputPath}\n`);

  if (summary.failCount > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
