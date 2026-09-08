import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

import { JSDOM } from 'jsdom';

import { detectImportFormat } from '../../../src/app/utils/import-preparation/formatDetection.ts';
import { resolveRobotFileData } from '../../../src/core/parsers/importRobotFile.ts';
import { generateSDF } from '../../../src/core/parsers/sdf/sdfGenerator.ts';
import { generateURDF, ensureXacroNamespace } from '../../../src/core/parsers/urdf/urdfGenerator.ts';
import { getCollisionGeometryEntries, getVisualGeometryEntries } from '../../../src/core/robot/index.ts';
import { prepareMjcfExport } from '../../../src/features/file-io/utils/mjcfExport.ts';
import { exportRobotToUsd } from '../../../src/features/file-io/utils/usdExport.ts';
import {
  GeometryType,
  JointType,
  type RobotData,
  type RobotFile,
  type RobotState,
  type UrdfVisual,
} from '../../../src/types/index.ts';

const DEFAULT_FIXTURE_ROOT = path.resolve('test/mujoco_menagerie-main');
const DEFAULT_OUTPUT_PATH = path.resolve('tmp/regression/mujoco-all-export-audit.json');
const DEFAULT_ARTIFACTS_DIR = path.resolve('tmp/regression/mujoco-all-export-audit');
const DEFAULT_ISAAC_PYTHON = path.resolve('/home/xiangyk/anaconda3/envs/isaaclab22/bin/python');
const DEFAULT_ISAACLAB_ROOT = path.resolve(
  '/home/xiangyk/Project/IsaacLab_Family/IsaacLab22/IsaacLab',
);
const DEFAULT_MUJOCO_PYTHON = DEFAULT_ISAAC_PYTHON;
const DEFAULT_MESH_QUALITY = 100;

type ExportFormat = 'sdf' | 'urdf' | 'mjcf' | 'xacro' | 'usd' | 'usda';
type ResultStatus = 'pass' | 'partial' | 'fail' | 'skipped';

interface Options {
  artifactsDir: string;
  fixtureRoot: string;
  formats: ExportFormat[];
  isaacLabRoot: string;
  isaacPython: string;
  limit: number | null;
  matches: string[];
  mujocoPython: string;
  outputPath: string;
  skipGazebo: boolean;
  skipIsaac: boolean;
  skipMujoco: boolean;
  skipUrdfCli: boolean;
  skipXacroCli: boolean;
  writeArtifacts: boolean;
}

interface SourceContext {
  allFileContents: Record<string, string>;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  extraFiles: Map<string, Blob>;
  supportRootAbs: string;
  supportRootRel: string;
}

interface Fixture {
  entryAbsPath: string;
  entryPath: string;
  id: string;
  packageName: string;
  supportRootAbs: string;
  supportRootRel: string;
}

interface RobotCounts {
  collisions: number;
  joints: number;
  links: number;
  meshVisuals: number;
  visuals: number;
}

interface RobotSemanticFacts {
  geometry: string[];
  joints: string[];
  materials: string[];
  summary: {
    collisionGeometries: number;
    geometry: number;
    joints: number;
    materialSlots: number;
    meshCollisionGeometries: number;
    meshVisualGeometries: number;
    visualGeometries: number;
  };
}

interface SemanticParitySummary {
  compared: boolean;
  mismatchCount: number;
  roundTrip: RobotSemanticFacts['summary'];
  sampleMismatches: string[];
  source: RobotSemanticFacts['summary'];
}

interface CommandCheck {
  command: string;
  exitCode: number | null;
  ok: boolean;
  stderr: string;
  stdout: string;
}

interface MujocoTruth {
  error: string | null;
  nbody: number | null;
  ngeom: number | null;
  njnt: number | null;
  nmesh: number | null;
  nq: number | null;
  nu: number | null;
  nv: number | null;
  ok: boolean;
}

interface FormatResult {
  checks: Record<string, unknown>;
  failures: string[];
  path: string | null;
  sizeBytes: number | null;
  status: ResultStatus;
}

interface FixtureResult {
  counts: RobotCounts | null;
  entryPath: string;
  formats: Partial<Record<ExportFormat, FormatResult>>;
  id: string;
  importMessage: string | null;
  importStatus: string;
  sourceMujocoTruth: MujocoTruth | null;
  status: ResultStatus;
  supportRoot: string;
}

interface FinalReport {
  artifactsDir: string;
  finishedAt: string;
  fixtureRoot: string;
  formats: ExportFormat[];
  generatedAt: string;
  results: FixtureResult[];
  summary: {
    fail: number;
    imported: number;
    partial: number;
    pass: number;
    skipped: number;
    total: number;
  };
}

const TEXT_EXTENSIONS = new Set([
  '.config',
  '.json',
  '.material',
  '.mdl',
  '.mjcf',
  '.mtl',
  '.sdf',
  '.txt',
  '.urdf',
  '.usda',
  '.xacro',
  '.xml',
]);
const SOURCE_EXTENSIONS = new Set(['.mjcf', '.sdf', '.urdf', '.xacro', '.xml']);
const ASSET_EXTENSIONS = new Set([
  '.bmp',
  '.dae',
  '.gif',
  '.glb',
  '.gltf',
  '.jpeg',
  '.jpg',
  '.msh',
  '.mtl',
  '.obj',
  '.png',
  '.stl',
  '.svg',
  '.webp',
]);
const IMAGE_EXTENSIONS = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const MESH_EXTENSIONS = new Set(['.dae', '.glb', '.gltf', '.msh', '.obj', '.stl']);
const ALL_FORMATS: ExportFormat[] = ['sdf', 'urdf', 'mjcf', 'xacro', 'usd', 'usda'];

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
  if (typeof globalThis.ProgressEvent === 'undefined') {
    globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;
  }
  delete (globalThis as typeof globalThis & { Worker?: typeof Worker }).Worker;
}

function fail(message: string): never {
  throw new Error(message);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`Invalid ${flag}: ${value}`);
  }
  return parsed;
}

function parseFormats(value: string): ExportFormat[] {
  const parsed = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const formats: ExportFormat[] = [];
  for (const entry of parsed) {
    if (!ALL_FORMATS.includes(entry as ExportFormat)) {
      fail(`Unsupported format "${entry}". Expected one of: ${ALL_FORMATS.join(',')}`);
    }
    if (!formats.includes(entry as ExportFormat)) {
      formats.push(entry as ExportFormat);
    }
  }
  return formats.length > 0 ? formats : [...ALL_FORMATS];
}

function printUsage(): void {
  process.stdout.write(`Usage:
  npx tsx scripts/test/truth/validate_mujoco_all_exports.ts [options]

Options:
  --fixture-root <path>     MuJoCo menagerie root. Default: ${DEFAULT_FIXTURE_ROOT}
  --output <path>           JSON report path. Default: ${DEFAULT_OUTPUT_PATH}
  --artifacts-dir <path>    Export artifact directory. Default: ${DEFAULT_ARTIFACTS_DIR}
  --format <list>           Comma list: ${ALL_FORMATS.join(',')}. Default: all
  --match <token>           Repeatable filter against id/path.
  --limit <n>               Limit selected MJCF XML files after filtering.
  --no-artifacts            Do not write exported files; still validates generated strings.
  --skip-gazebo             Skip ign sdf checks for generated SDF.
  --skip-urdf-cli           Skip check_urdf checks.
  --skip-xacro-cli          Skip xacro CLI checks.
  --skip-mujoco             Skip mujoco Python checks.
  --skip-isaac              Skip IsaacSim USD/USDA stage-open checks.
  --mujoco-python <path>    Python executable with mujoco. Default: ${DEFAULT_MUJOCO_PYTHON}
  --isaac-python <path>     IsaacSim Python executable. Default: ${DEFAULT_ISAAC_PYTHON}
  --isaaclab-root <path>    IsaacLab root added to PYTHONPATH. Default: ${DEFAULT_ISAACLAB_ROOT}
  --help                    Show this help.
`);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    artifactsDir: DEFAULT_ARTIFACTS_DIR,
    fixtureRoot: DEFAULT_FIXTURE_ROOT,
    formats: [...ALL_FORMATS],
    isaacLabRoot: DEFAULT_ISAACLAB_ROOT,
    isaacPython: DEFAULT_ISAAC_PYTHON,
    limit: null,
    matches: [],
    mujocoPython: DEFAULT_MUJOCO_PYTHON,
    outputPath: DEFAULT_OUTPUT_PATH,
    skipGazebo: false,
    skipIsaac: false,
    skipMujoco: false,
    skipUrdfCli: false,
    skipXacroCli: false,
    writeArtifacts: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (!value) {
        fail(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case '--fixture-root':
        options.fixtureRoot = path.resolve(nextValue());
        break;
      case '--output':
        options.outputPath = path.resolve(nextValue());
        break;
      case '--artifacts-dir':
        options.artifactsDir = path.resolve(nextValue());
        break;
      case '--format':
      case '--formats':
        options.formats = parseFormats(nextValue());
        break;
      case '--match':
      case '--model':
        options.matches.push(nextValue().trim().toLowerCase());
        break;
      case '--limit':
        options.limit = parsePositiveInteger(nextValue(), '--limit');
        break;
      case '--no-artifacts':
        options.writeArtifacts = false;
        break;
      case '--skip-gazebo':
        options.skipGazebo = true;
        break;
      case '--skip-isaac':
        options.skipIsaac = true;
        break;
      case '--skip-mujoco':
        options.skipMujoco = true;
        break;
      case '--skip-urdf-cli':
        options.skipUrdfCli = true;
        break;
      case '--skip-xacro-cli':
        options.skipXacroCli = true;
        break;
      case '--mujoco-python':
        options.mujocoPython = path.resolve(nextValue());
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

function normalizePathSlashes(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'robot';
}

function createFixtureId(supportRootRel: string, entryPath: string): string {
  const stem = path.basename(entryPath, path.extname(entryPath));
  const packageName = path.basename(supportRootRel);
  return stem === packageName ? supportRootRel : `${supportRootRel}/${stem}`;
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const entries = await fsPromises.readdir(rootDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.')) {
      continue;
    }
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

async function collectSupportRoots(fixtureRoot: string): Promise<string[]> {
  const entries = await fsPromises.readdir(fixtureRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'assets' && !entry.name.startsWith('.'))
    .map((entry) => path.join(fixtureRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function guessMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.dae':
      return 'model/vnd.collada+xml';
    case '.gif':
      return 'image/gif';
    case '.glb':
      return 'model/gltf-binary';
    case '.gltf':
      return 'model/gltf+json';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.mtl':
    case '.obj':
      return 'text/plain';
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

function createDataUrl(filePath: string, buffer: Buffer): string {
  return `data:${guessMimeType(filePath)};base64,${buffer.toString('base64')}`;
}

function addExtraFileAliases(
  extraFiles: Map<string, Blob>,
  blob: Blob,
  aliases: readonly string[],
): void {
  aliases
    .map((alias) => normalizePathSlashes(alias).replace(/^\/+/, ''))
    .filter((alias) => alias && alias !== '.')
    .forEach((alias) => {
      if (!extraFiles.has(alias)) {
        extraFiles.set(alias, blob);
      }
    });
}

async function createSourceContext(
  fixtureRoot: string,
  supportRootAbs: string,
): Promise<SourceContext> {
  const supportRootRel = normalizePathSlashes(path.relative(fixtureRoot, supportRootAbs));
  const packageName = path.basename(supportRootAbs);
  const sharedAssetsRoot = path.join(fixtureRoot, 'assets');
  const roots = [supportRootAbs, sharedAssetsRoot].filter((root, index, all) => (
    all.indexOf(root) === index && fs.existsSync(root)
  ));

  const allFileContents: Record<string, string> = {};
  const assets: Record<string, string> = {};
  const availableFileMap = new Map<string, RobotFile>();
  const extraFiles = new Map<string, Blob>();

  for (const root of roots) {
    for (const absolutePath of await collectFiles(root)) {
      const datasetRelativePath = normalizePathSlashes(path.relative(fixtureRoot, absolutePath));
      const localRelativePath = normalizePathSlashes(path.relative(supportRootAbs, absolutePath));
      const extension = path.extname(absolutePath).toLowerCase();

      if (TEXT_EXTENSIONS.has(extension)) {
        const content = await fsPromises.readFile(absolutePath, 'utf8');
        allFileContents[datasetRelativePath] = content;
        if (SOURCE_EXTENSIONS.has(extension)) {
          const format = detectImportFormat(content, datasetRelativePath);
          if (format) {
            availableFileMap.set(datasetRelativePath, {
              name: datasetRelativePath,
              content,
              format,
            });
          }
        }
      }

      if (!ASSET_EXTENSIONS.has(extension)) {
        continue;
      }

      const buffer = await fsPromises.readFile(absolutePath);
      const blob = new Blob([buffer], { type: guessMimeType(absolutePath) });
      const aliases = [
        datasetRelativePath,
        localRelativePath,
        path.basename(absolutePath),
        `${packageName}/${localRelativePath}`,
        `package://${packageName}/${localRelativePath}`,
      ];
      addExtraFileAliases(extraFiles, blob, aliases);
      if (MESH_EXTENSIONS.has(extension) && !availableFileMap.has(datasetRelativePath)) {
        availableFileMap.set(datasetRelativePath, {
          name: datasetRelativePath,
          content: '',
          format: 'mesh',
        });
      }
      if (IMAGE_EXTENSIONS.has(extension)) {
        const dataUrl = createDataUrl(absolutePath, buffer);
        aliases.forEach((alias) => {
          const normalized = normalizePathSlashes(alias).replace(/^\/+/, '');
          if (normalized && normalized !== '.') {
            assets[normalized] = dataUrl;
          }
        });
      }
    }
  }

  return {
    allFileContents,
    assets,
    availableFiles: Array.from(availableFileMap.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    extraFiles,
    supportRootAbs,
    supportRootRel,
  };
}

async function discoverFixtures(options: Options): Promise<Fixture[]> {
  const results: Fixture[] = [];
  for (const supportRootAbs of await collectSupportRoots(options.fixtureRoot)) {
    const context = await createSourceContext(options.fixtureRoot, supportRootAbs);
    for (const file of context.availableFiles) {
      if (file.format !== 'mjcf') {
        continue;
      }
      const fixture: Fixture = {
        entryAbsPath: path.join(options.fixtureRoot, file.name),
        entryPath: file.name,
        id: createFixtureId(context.supportRootRel, file.name),
        packageName: path.basename(supportRootAbs),
        supportRootAbs,
        supportRootRel: context.supportRootRel,
      };
      const haystack = `${fixture.id} ${fixture.entryPath} ${fixture.packageName}`.toLowerCase();
      if (options.matches.length > 0 && !options.matches.some((match) => haystack.includes(match))) {
        continue;
      }
      results.push(fixture);
    }
  }

  results.sort((left, right) => left.entryPath.localeCompare(right.entryPath));
  return options.limit === null ? results : results.slice(0, options.limit);
}

function toRobotState(robot: RobotData): RobotState {
  return {
    ...robot,
    selection: { type: null, id: null },
  };
}

function countRobot(robot: RobotData): RobotCounts {
  const links = Object.values(robot.links);
  return {
    links: links.length,
    joints: Object.keys(robot.joints).length,
    visuals: links.reduce((sum, link) => sum + getVisualGeometryEntries(link).length, 0),
    meshVisuals: links.reduce(
      (sum, link) =>
        sum +
        getVisualGeometryEntries(link).filter((entry) => entry.geometry.type === GeometryType.MESH)
          .length,
      0,
    ),
    collisions: links.reduce(
      (sum, link) => sum + (link.collision ? 1 : 0) + (link.collisionBodies?.length ?? 0),
      0,
    ),
  };
}

function formatScalar(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  if (Math.abs(value) < 1e-12) {
    return '0';
  }
  const formatted = value.toFixed(5).replace(/\.?0+$/, '');
  return formatted === '-0' ? '0' : formatted;
}

function formatVector(value: { x: number; y: number; z: number } | null | undefined): string {
  if (!value) {
    return '';
  }
  return [value.x, value.y, value.z].map(formatScalar).join(',');
}

function formatAngle(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  let normalized = ((value + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }
  if (Math.abs(Math.abs(normalized) - Math.PI) <= 1e-6) {
    normalized = Math.PI;
  }
  return formatScalar(normalized);
}

function formatRpy(value: { r: number; p: number; y: number } | null | undefined): string {
  if (!value) {
    return '';
  }
  return [value.r, value.p, value.y].map(formatAngle).join(',');
}

function formatRgba(value: [number, number, number, number] | null | undefined): string {
  if (!value) {
    return '';
  }
  return value.map(formatScalar).join(',');
}

function normalizeFactText(value: string | null | undefined): string {
  return normalizePathSlashes(value ?? '').trim().replace(/^package:\/\//, '');
}

function normalizeMeshFactPath(value: string | null | undefined): string {
  const normalized = normalizeFactText(value).replace(/^\/+/, '').replace(/^(\.\/)+/, '');
  const withoutScheme = normalized.replace(/^model:\/\//, '').replace(/^file:\/\//, '');
  return path.basename(withoutScheme);
}

function geometryBaseSignature(role: 'collision' | 'visual', linkId: string, index: number, geometry: UrdfVisual): string {
  return [
    role,
    `link=${linkId}`,
    `index=${index}`,
    `type=${geometry.type}`,
    `mesh=${normalizeMeshFactPath(geometry.meshPath)}`,
    `asset=${normalizeFactText(geometry.assetRef)}`,
    `submesh=${normalizeFactText(geometry.submeshName)}`,
    `dims=${formatVector(geometry.dimensions)}`,
    `xyz=${formatVector(geometry.origin?.xyz)}`,
    `rpy=${formatRpy(geometry.origin?.rpy)}`,
    `visible=${geometry.visible === false ? 'false' : 'true'}`,
  ].join('|');
}

function materialSignature(role: 'collision' | 'visual', linkId: string, index: number, geometry: UrdfVisual): string {
  const primaryMaterial = geometry.authoredMaterials?.[0];
  const effectiveColor = normalizeFactText(primaryMaterial?.color || geometry.color);
  const effectiveTexture = normalizeMeshFactPath(primaryMaterial?.texture);
  return [
    role,
    `link=${linkId}`,
    `index=${index}`,
    `color=${effectiveColor || formatRgba(primaryMaterial?.colorRgba)}`,
    `texture=${effectiveTexture}`,
    `opacity=${formatScalar(primaryMaterial?.opacity)}`,
    `roughness=${formatScalar(primaryMaterial?.roughness)}`,
    `metalness=${formatScalar(primaryMaterial?.metalness)}`,
  ].join('|');
}

function collectRobotSemanticFacts(robot: RobotData): RobotSemanticFacts {
  const joints = Object.values(robot.joints)
    .map((joint) => {
      const hasAxis = (
        joint.type === JointType.REVOLUTE ||
        joint.type === JointType.CONTINUOUS ||
        joint.type === JointType.PRISMATIC ||
        joint.type === JointType.PLANAR
      );
      const hasLimit = (
        joint.type === JointType.REVOLUTE ||
        joint.type === JointType.PRISMATIC ||
        joint.type === JointType.CONTINUOUS
      );
      return [
        `name=${normalizeFactText(joint.name || joint.id)}`,
        `id=${normalizeFactText(joint.id)}`,
        `type=${joint.type}`,
        `parent=${normalizeFactText(joint.parentLinkId)}`,
        `child=${normalizeFactText(joint.childLinkId)}`,
        `axis=${hasAxis ? formatVector(joint.axis) : ''}`,
        `origin=${formatVector(joint.origin?.xyz)}:${formatRpy(joint.origin?.rpy)}`,
        `limit=${hasLimit && joint.limit ? [
          formatScalar(joint.limit.lower),
          formatScalar(joint.limit.upper),
          formatScalar(joint.limit.effort),
          formatScalar(joint.limit.velocity),
        ].join(',') : ''}`,
        `dynamics=${hasAxis ? [
          formatScalar(joint.dynamics?.damping),
          formatScalar(joint.dynamics?.friction),
          formatScalar(joint.dynamics?.stiffness),
        ].join(',') : ''}`,
        `mimic=${joint.mimic ? [
          normalizeFactText(joint.mimic.joint),
          formatScalar(joint.mimic.multiplier),
          formatScalar(joint.mimic.offset),
        ].join(',') : ''}`,
      ].join('|');
    })
    .sort();

  const geometry: string[] = [];
  const materials: string[] = [];
  let visualGeometries = 0;
  let collisionGeometries = 0;
  let meshVisualGeometries = 0;
  let meshCollisionGeometries = 0;

  for (const [linkId, link] of Object.entries(robot.links).sort(([left], [right]) => left.localeCompare(right))) {
    for (const entry of getVisualGeometryEntries(link)) {
      visualGeometries += 1;
      if (entry.geometry.type === GeometryType.MESH) {
        meshVisualGeometries += 1;
      }
      geometry.push(geometryBaseSignature('visual', linkId, entry.objectIndex, entry.geometry));
      materials.push(materialSignature('visual', linkId, entry.objectIndex, entry.geometry));
    }
    for (const entry of getCollisionGeometryEntries(link)) {
      collisionGeometries += 1;
      if (entry.geometry.type === GeometryType.MESH) {
        meshCollisionGeometries += 1;
      }
      geometry.push(geometryBaseSignature('collision', linkId, entry.objectIndex, entry.geometry));
    }
  }

  geometry.sort();
  materials.sort();
  return {
    geometry,
    joints,
    materials,
    summary: {
      collisionGeometries,
      geometry: geometry.length,
      joints: joints.length,
      materialSlots: materials.length,
      meshCollisionGeometries,
      meshVisualGeometries,
      visualGeometries,
    },
  };
}

function incrementCount(map: Map<string, number>, value: string): void {
  map.set(value, (map.get(value) ?? 0) + 1);
}

function countSignatures(values: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  values.forEach((value) => incrementCount(result, value));
  return result;
}

function compareSignatureCategory(
  label: string,
  source: readonly string[],
  roundTrip: readonly string[],
  limit: number,
): string[] {
  const sourceCounts = countSignatures(source);
  const roundTripCounts = countSignatures(roundTrip);
  const keys = new Set([...sourceCounts.keys(), ...roundTripCounts.keys()]);
  const messages: string[] = [];
  for (const key of [...keys].sort()) {
    if (messages.length >= limit) {
      break;
    }
    const sourceCount = sourceCounts.get(key) ?? 0;
    const roundTripCount = roundTripCounts.get(key) ?? 0;
    if (sourceCount === roundTripCount) {
      continue;
    }
    if (sourceCount > roundTripCount) {
      messages.push(`${label} missing x${sourceCount - roundTripCount}: ${key}`);
    } else {
      messages.push(`${label} extra x${roundTripCount - sourceCount}: ${key}`);
    }
  }
  return messages;
}

function compareRobotSemanticFacts(
  result: FormatResult,
  source: RobotSemanticFacts,
  roundTrip: RobotSemanticFacts,
  format: ExportFormat,
): void {
  const sampleMismatches = [
    ...compareSignatureCategory('joint', source.joints, roundTrip.joints, 8),
    ...compareSignatureCategory('geometry', source.geometry, roundTrip.geometry, 16),
    ...compareSignatureCategory('material', source.materials, roundTrip.materials, 16),
  ].slice(0, 24);
  const mismatchCount = (
    compareSignatureCategory('joint', source.joints, roundTrip.joints, Number.MAX_SAFE_INTEGER).length +
    compareSignatureCategory('geometry', source.geometry, roundTrip.geometry, Number.MAX_SAFE_INTEGER).length +
    compareSignatureCategory('material', source.materials, roundTrip.materials, Number.MAX_SAFE_INTEGER).length
  );
  const parity: SemanticParitySummary = {
    compared: true,
    mismatchCount,
    roundTrip: roundTrip.summary,
    sampleMismatches,
    source: source.summary,
  };
  result.checks.semanticParity = parity;
  if (mismatchCount > 0) {
    markFailure(
      result,
      `${format.toUpperCase()} semantic parity mismatch: ${mismatchCount} signature differences; ${sampleMismatches
        .slice(0, 3)
        .join(' | ')}`,
    );
  }
}

function createFormatResult(pathValue: string | null): FormatResult {
  return {
    checks: {},
    failures: [],
    path: pathValue,
    sizeBytes: null,
    status: 'pass',
  };
}

function markFailure(result: FormatResult, message: string, hard = false): void {
  result.failures.push(message);
  result.status = hard ? 'fail' : result.status === 'fail' ? 'fail' : 'partial';
}

function compareCounts(
  result: FormatResult,
  source: RobotCounts,
  roundTrip: RobotCounts,
  fields: Array<keyof RobotCounts> = ['links', 'joints'],
): void {
  const mismatches = fields.filter((field) => source[field] !== roundTrip[field]);
  if (mismatches.length === 0) {
    return;
  }
  markFailure(
    result,
    `round-trip count mismatch: ${mismatches
      .map((field) => `${field} source=${source[field]} roundtrip=${roundTrip[field]}`)
      .join('; ')}`,
  );
}

async function writeTextArtifact(
  options: Options,
  filePath: string,
  content: string,
): Promise<void> {
  if (!options.writeArtifacts) {
    return;
  }
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, content, 'utf8');
}

async function writeBlobArtifact(filePath: string, blob: Blob): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

async function writeArchiveFiles(rootDir: string, archiveFiles: Map<string, Blob>): Promise<void> {
  await Promise.all(
    Array.from(archiveFiles.entries()).map(([archivePath, blob]) =>
      writeBlobArtifact(path.join(rootDir, archivePath), blob),
    ),
  );
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandCheck> {
  const chunksOut: Buffer[] = [];
  const chunksErr: Buffer[] = [];
  return await new Promise<CommandCheck>((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill('SIGKILL');
      settled = true;
      resolve({
        command: [command, ...args].join(' '),
        exitCode: null,
        ok: false,
        stderr: 'timed out',
        stdout: Buffer.concat(chunksOut).toString('utf8'),
      });
    }, options.timeoutMs ?? 120_000);

    child.stdout.on('data', (chunk) => chunksOut.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => chunksErr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      clearTimeout(timer);
      settled = true;
      resolve({
        command: [command, ...args].join(' '),
        exitCode: null,
        ok: false,
        stderr: error.message,
        stdout: Buffer.concat(chunksOut).toString('utf8'),
      });
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      clearTimeout(timer);
      settled = true;
      resolve({
        command: [command, ...args].join(' '),
        exitCode: code,
        ok: code === 0,
        stderr: Buffer.concat(chunksErr).toString('utf8'),
        stdout: Buffer.concat(chunksOut).toString('utf8'),
      });
    });
  });
}

async function commandExists(command: string): Promise<boolean> {
  const result = await runCommand('which', [command], { timeoutMs: 10_000 });
  return result.ok;
}

async function runMujocoTruth(
  python: string,
  mjcfPath: string,
  cwd: string,
): Promise<MujocoTruth> {
  const script = [
    'import json, sys',
    'import mujoco',
    'path = sys.argv[1]',
    'try:',
    '    model = mujoco.MjModel.from_xml_path(path)',
    '    print(json.dumps({',
    '        "ok": True,',
    '        "nbody": int(model.nbody),',
    '        "ngeom": int(model.ngeom),',
    '        "njnt": int(model.njnt),',
    '        "nmesh": int(model.nmesh),',
    '        "nq": int(model.nq),',
    '        "nv": int(model.nv),',
    '        "nu": int(model.nu),',
    '        "error": None,',
    '    }))',
    'except Exception as exc:',
    '    print(json.dumps({"ok": False, "error": str(exc), "nbody": None, "ngeom": None, "njnt": None, "nmesh": None, "nq": None, "nv": None, "nu": None}))',
    '    sys.exit(1)',
  ].join('\n');
  const result = await runCommand(python, ['-c', script, mjcfPath], {
    cwd,
    timeoutMs: 120_000,
  });
  try {
    return JSON.parse(result.stdout.trim()) as MujocoTruth;
  } catch {
    return {
      error: result.stderr || result.stdout || 'failed to parse mujoco JSON output',
      nbody: null,
      ngeom: null,
      njnt: null,
      nmesh: null,
      nq: null,
      nu: null,
      nv: null,
      ok: false,
    };
  }
}

function parseSdfCounts(content: string): { collisions: number; joints: number; links: number; visuals: number } {
  const doc = new DOMParser().parseFromString(content, 'application/xml');
  return {
    links: doc.querySelectorAll('model > link').length,
    joints: doc.querySelectorAll('model > joint').length,
    visuals: doc.querySelectorAll('link > visual').length,
    collisions: doc.querySelectorAll('link > collision').length,
  };
}

function resolveModelDir(fixture: Fixture, format: ExportFormat, options: Options): string {
  return path.join(options.artifactsDir, fixture.supportRootRel, sanitizePathSegment(path.basename(fixture.entryPath)), format);
}

async function exportSdf(
  fixture: Fixture,
  robot: RobotState,
  sourceCounts: RobotCounts,
  sourceSemanticFacts: RobotSemanticFacts,
  options: Options,
): Promise<FormatResult> {
  const outDir = resolveModelDir(fixture, 'sdf', options);
  const outPath = path.join(outDir, 'model.sdf');
  const result = createFormatResult(outPath);
  try {
    const content = generateSDF(robot, { packageName: fixture.packageName });
    result.sizeBytes = Buffer.byteLength(content);
    await writeTextArtifact(options, outPath, content);

    const reimport = resolveRobotFileData({
      name: `${fixture.packageName}/model.sdf`,
      content,
      format: 'sdf',
    });
    result.checks.reimportStatus = reimport.status;
    if (reimport.status === 'ready') {
      const roundTripCounts = countRobot(reimport.robotData);
      result.checks.roundTripCounts = roundTripCounts;
      compareCounts(result, sourceCounts, roundTripCounts);
      compareRobotSemanticFacts(
        result,
        sourceSemanticFacts,
        collectRobotSemanticFacts(reimport.robotData),
        'sdf',
      );
    } else {
      markFailure(result, `SDF re-import failed: ${reimport.status}`, true);
    }

    if (!options.skipGazebo) {
      if (!(await commandExists('ign'))) {
        result.checks.gazebo = { skipped: true, reason: 'ign command not found' };
        markFailure(result, 'Gazebo/sdformat check skipped: ign command not found');
      } else if (options.writeArtifacts) {
        const check = await runCommand('ign', ['sdf', '-k', outPath], { cwd: outDir });
        result.checks.gazeboCheck = check;
        if (!check.ok) {
          markFailure(result, `ign sdf -k failed: ${check.stderr || check.stdout}`, true);
        }
        const printed = await runCommand('ign', ['sdf', '-p', outPath], { cwd: outDir });
        result.checks.gazeboPrintOk = printed.ok;
        if (printed.ok) {
          result.checks.gazeboPrintedCounts = parseSdfCounts(printed.stdout);
          await writeTextArtifact(options, path.join(outDir, 'printed.sdf'), printed.stdout);
        } else {
          markFailure(result, `ign sdf -p failed: ${printed.stderr || printed.stdout}`, true);
        }
      }
    }
  } catch (error) {
    markFailure(result, error instanceof Error ? error.message : String(error), true);
  }
  return result;
}

async function exportUrdfLike(
  fixture: Fixture,
  robot: RobotState,
  sourceCounts: RobotCounts,
  sourceSemanticFacts: RobotSemanticFacts,
  options: Options,
  format: 'urdf' | 'xacro',
): Promise<FormatResult> {
  const outDir = resolveModelDir(fixture, format, options);
  const outPath = path.join(outDir, format === 'urdf' ? 'model.urdf' : 'model.urdf.xacro');
  const result = createFormatResult(outPath);
  try {
    const raw = generateURDF(robot, {
      includeHardware: 'auto',
      preserveMeshPaths: true,
    });
    const content = format === 'xacro' ? ensureXacroNamespace(raw) : raw;
    result.sizeBytes = Buffer.byteLength(content);
    await writeTextArtifact(options, outPath, content);

    const reimport = resolveRobotFileData({
      name: path.basename(outPath),
      content,
      format,
    });
    result.checks.reimportStatus = reimport.status;
    if (reimport.status === 'ready') {
      const roundTripCounts = countRobot(reimport.robotData);
      result.checks.roundTripCounts = roundTripCounts;
      compareCounts(result, sourceCounts, roundTripCounts);
      compareRobotSemanticFacts(
        result,
        sourceSemanticFacts,
        collectRobotSemanticFacts(reimport.robotData),
        format,
      );
    } else {
      markFailure(result, `${format.toUpperCase()} re-import failed: ${reimport.status}`, true);
    }

    if (format === 'urdf' && !options.skipUrdfCli) {
      if (!(await commandExists('check_urdf'))) {
        result.checks.checkUrdf = { skipped: true, reason: 'check_urdf command not found' };
        markFailure(result, 'check_urdf skipped: command not found');
      } else if (options.writeArtifacts) {
        const check = await runCommand('check_urdf', [outPath], { cwd: outDir });
        result.checks.checkUrdf = check;
        if (!check.ok) {
          markFailure(result, `check_urdf failed: ${check.stderr || check.stdout}`, true);
        }
      }
    }

    if (format === 'xacro' && !options.skipXacroCli) {
      if (!(await commandExists('xacro'))) {
        result.checks.xacro = { skipped: true, reason: 'xacro command not found' };
        markFailure(result, 'xacro CLI skipped: command not found');
      } else if (options.writeArtifacts) {
        const expandedPath = path.join(outDir, 'expanded.urdf');
        const expanded = await runCommand('xacro', [outPath], { cwd: outDir });
        result.checks.xacro = expanded;
        if (!expanded.ok) {
          markFailure(result, `xacro expansion failed: ${expanded.stderr || expanded.stdout}`, true);
        } else {
          await writeTextArtifact(options, expandedPath, expanded.stdout);
          if (!options.skipUrdfCli && (await commandExists('check_urdf'))) {
            const check = await runCommand('check_urdf', [expandedPath], { cwd: outDir });
            result.checks.expandedCheckUrdf = check;
            if (!check.ok) {
              markFailure(result, `expanded xacro check_urdf failed: ${check.stderr || check.stdout}`, true);
            }
          }
        }
      }
    }
  } catch (error) {
    markFailure(result, error instanceof Error ? error.message : String(error), true);
  }
  return result;
}

function pickMujocoMeshFileReferences(mjcf: string): string[] {
  const references = new Set<string>();
  const regex = /<mesh\b[^>]*\bfile\s*=\s*["']([^"']+)["'][^>]*>/g;
  let match = regex.exec(mjcf);
  while (match) {
    const file = (match[1] || '').trim();
    if (file) {
      references.add(file);
    }
    match = regex.exec(mjcf);
  }
  return [...references];
}

function pickMujocoTextureFileReferences(mjcf: string): string[] {
  const references = new Set<string>();
  const textureRegex = /<texture\b[^>]*>/g;
  let textureMatch = textureRegex.exec(mjcf);
  while (textureMatch) {
    const tag = textureMatch[0] || '';
    const attrRegex = /\b(?:file|fileright|fileleft|fileup|filedown|filefront|fileback)\s*=\s*["']([^"']+)["']/g;
    let attrMatch = attrRegex.exec(tag);
    while (attrMatch) {
      const file = (attrMatch[1] || '').trim();
      if (file) {
        references.add(file);
      }
      attrMatch = attrRegex.exec(tag);
    }
    textureMatch = textureRegex.exec(mjcf);
  }
  return [...references];
}

function normalizeAssetLookupPath(filePath: string): string {
  return normalizePathSlashes(filePath).replace(/^\/+/, '').replace(/^(\.\/)+/, '');
}

function findBlobByPath(meshPath: string, files: Map<string, Blob>): Blob | null {
  const normalized = normalizeAssetLookupPath(meshPath).toLowerCase();
  const basename = path.basename(normalized);
  for (const [key, blob] of files.entries()) {
    const candidate = normalizeAssetLookupPath(key).toLowerCase();
    if (
      candidate === normalized ||
      candidate === basename ||
      candidate.endsWith(`/${normalized}`) ||
      candidate.endsWith(`/${basename}`)
    ) {
      return blob;
    }
  }
  return null;
}

async function stageMujocoAssets(
  outDir: string,
  mjcf: string,
  files: Map<string, Blob>,
): Promise<{ missingMeshes: string[]; missingTextures: string[] }> {
  const missingMeshes: string[] = [];
  const missingTextures: string[] = [];
  const meshDir = path.join(outDir, 'meshes');
  const textureDir = path.join(outDir, 'textures');
  await fsPromises.mkdir(meshDir, { recursive: true });
  await fsPromises.mkdir(textureDir, { recursive: true });

  for (const file of pickMujocoMeshFileReferences(mjcf)) {
    const blob = findBlobByPath(file, files);
    if (!blob) {
      missingMeshes.push(file);
      continue;
    }
    await writeBlobArtifact(path.join(meshDir, normalizeAssetLookupPath(file)), blob);
  }

  for (const file of pickMujocoTextureFileReferences(mjcf)) {
    const blob = findBlobByPath(file, files);
    if (!blob) {
      missingTextures.push(file);
      continue;
    }
    await writeBlobArtifact(path.join(textureDir, normalizeAssetLookupPath(file)), blob);
  }
  return { missingMeshes, missingTextures };
}

async function exportMjcf(
  fixture: Fixture,
  context: SourceContext,
  robot: RobotState,
  sourceCounts: RobotCounts,
  sourceSemanticFacts: RobotSemanticFacts,
  sourceTruth: MujocoTruth | null,
  options: Options,
): Promise<FormatResult> {
  const outDir = resolveModelDir(fixture, 'mjcf', options);
  const outPath = path.join(outDir, 'model.xml');
  const result = createFormatResult(outPath);
  try {
    const prepared = await prepareMjcfExport({
      robot,
      assets: context.assets,
      extraMeshFiles: context.extraFiles,
      mujoco: { meshdir: 'meshes/', includeSceneHelpers: false },
    });
    const content = prepared.xml;
    result.sizeBytes = Buffer.byteLength(content);
    await writeTextArtifact(options, outPath, content);
    const stagedFiles = new Map([...context.extraFiles, ...prepared.meshes.archiveFiles]);
    if (options.writeArtifacts) {
      const staged = await stageMujocoAssets(outDir, content, stagedFiles);
      result.checks.stagedMissingMeshes = staged.missingMeshes;
      result.checks.stagedMissingTextures = staged.missingTextures;
      if (staged.missingMeshes.length > 0) {
        markFailure(result, `missing generated MJCF mesh assets: ${staged.missingMeshes.join(', ')}`, true);
      }
      if (staged.missingTextures.length > 0) {
        markFailure(
          result,
          `missing generated MJCF texture assets: ${staged.missingTextures.join(', ')}`,
          true,
        );
      }
    }

    const reimport = resolveRobotFileData({
      name: path.basename(outPath),
      content,
      format: 'mjcf',
    });
    result.checks.reimportStatus = reimport.status;
    if (reimport.status === 'ready') {
      const roundTripCounts = countRobot(reimport.robotData);
      result.checks.roundTripCounts = roundTripCounts;
      compareCounts(result, sourceCounts, roundTripCounts);
      compareRobotSemanticFacts(
        result,
        sourceSemanticFacts,
        collectRobotSemanticFacts(reimport.robotData),
        'mjcf',
      );
    } else {
      markFailure(result, `MJCF re-import failed: ${reimport.status}`, true);
    }

    if (!options.skipMujoco && options.writeArtifacts) {
      const generatedTruth = await runMujocoTruth(options.mujocoPython, outPath, outDir);
      result.checks.mujocoTruth = generatedTruth;
      if (!generatedTruth.ok) {
        markFailure(result, `generated MJCF failed MuJoCo parse: ${generatedTruth.error}`, true);
      } else if (sourceTruth?.ok) {
        const mismatches = ['nbody', 'ngeom', 'njnt', 'nu'] as const;
        const mismatchText = mismatches
          .filter((key) => sourceTruth[key] !== generatedTruth[key])
          .map((key) => `${key} source=${sourceTruth[key]} generated=${generatedTruth[key]}`);
        if (mismatchText.length > 0) {
          markFailure(result, `MuJoCo truth count mismatch: ${mismatchText.join('; ')}`);
        }
      }
    }
  } catch (error) {
    markFailure(result, error instanceof Error ? error.message : String(error), true);
  }
  return result;
}

async function runIsaacStageOpen(
  options: Options,
  stagePaths: string[],
  outputPath: string,
): Promise<Record<string, unknown>> {
  const script = path.resolve('scripts/tools/isaacsim/inspect_isaacsim_usd_stage.py');
  const command = await runCommand(options.isaacPython, [script, ...stagePaths, '--output', outputPath, '--headless'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      PYTHONPATH: options.isaacLabRoot,
    },
    timeoutMs: 240_000,
  });
  if (!command.ok) {
    throw new Error(command.stderr || command.stdout || `Isaac stage inspection failed: ${command.exitCode}`);
  }
  const text = await fsPromises.readFile(outputPath, 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

async function exportUsdLike(
  fixture: Fixture,
  context: SourceContext,
  robot: RobotState,
  sourceSemanticFacts: RobotSemanticFacts,
  options: Options,
  format: 'usd' | 'usda',
): Promise<FormatResult> {
  const outDir = resolveModelDir(fixture, format, options);
  const result = createFormatResult(null);
  try {
    result.checks.sourceSemanticSummary = sourceSemanticFacts.summary;
    const payload = await exportRobotToUsd({
      robot,
      exportName: sanitizePathSegment(`${fixture.supportRootRel}_${path.basename(fixture.entryPath, '.xml')}`),
      assets: context.assets,
      extraMeshFiles: context.extraFiles,
      fileFormat: format,
      layoutProfile: 'isaacsim',
      meshCompression: {
        enabled: false,
        quality: DEFAULT_MESH_QUALITY,
      },
    });
    result.path = path.join(outDir, payload.rootLayerPath);
    result.checks.rootLayerPath = payload.rootLayerPath;
    result.checks.archiveFileCount = payload.archiveFiles.size;
    if (options.writeArtifacts) {
      await writeArchiveFiles(outDir, payload.archiveFiles);
      const rootBlob = payload.archiveFiles.get(payload.rootLayerPath);
      result.sizeBytes = rootBlob ? (await rootBlob.arrayBuffer()).byteLength : null;
      const baseLayerEntry = Array.from(payload.archiveFiles.keys()).find((entry) =>
        /\/configuration\/[^/]+_base\.(?:usd|usda)$/i.test(entry),
      );
      if (baseLayerEntry) {
        const baseLayer = await payload.archiveFiles.get(baseLayerEntry)!.text();
        result.checks.meshLibraryIsClass = /class Scope "__MeshLibrary"/.test(baseLayer);
        result.checks.defMeshCount = (baseLayer.match(/\bdef Mesh "/g) ?? []).length;
        result.checks.classMeshCount = (baseLayer.match(/\bclass Mesh "/g) ?? []).length;
      }
    }
    if (payload.archiveFiles.size === 0) {
      markFailure(result, `${format.toUpperCase()} archive is empty`, true);
    }
  } catch (error) {
    markFailure(result, error instanceof Error ? error.message : String(error), true);
  }
  return result;
}

function summarizeModelStatus(formats: Partial<Record<ExportFormat, FormatResult>>): ResultStatus {
  const results = Object.values(formats);
  if (results.some((entry) => entry.status === 'fail')) {
    return 'fail';
  }
  if (results.some((entry) => entry.status === 'partial' || entry.status === 'skipped')) {
    return 'partial';
  }
  return 'pass';
}

function summarizeResults(results: FixtureResult[]): FinalReport['summary'] {
  return results.reduce(
    (acc, result) => {
      acc.total += 1;
      if (result.importStatus === 'ready') {
        acc.imported += 1;
      }
      if (result.status === 'pass') acc.pass += 1;
      else if (result.status === 'partial') acc.partial += 1;
      else if (result.status === 'fail') acc.fail += 1;
      else acc.skipped += 1;
      return acc;
    },
    { fail: 0, imported: 0, partial: 0, pass: 0, skipped: 0, total: 0 },
  );
}

async function writeAuditReport(
  options: Options,
  results: FixtureResult[],
  generatedAt: string,
): Promise<void> {
  const report: FinalReport = {
    artifactsDir: options.artifactsDir,
    finishedAt: new Date().toISOString(),
    fixtureRoot: options.fixtureRoot,
    formats: options.formats,
    generatedAt,
    results,
    summary: summarizeResults(results),
  };
  await fsPromises.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fsPromises.writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function inspectUsdFormatsWithIsaac(
  fixture: Fixture,
  options: Options,
  formats: Partial<Record<ExportFormat, FormatResult>>,
  sourceCounts: RobotCounts,
  sourceSemanticFacts: RobotSemanticFacts,
): Promise<void> {
  if (options.skipIsaac) {
    return;
  }
  const stagePaths = (['usd', 'usda'] as const)
    .map((format) => formats[format]?.path)
    .filter((stagePath): stagePath is string => Boolean(stagePath && fs.existsSync(stagePath)));
  if (stagePaths.length === 0) {
    return;
  }
  const outputPath = path.join(
    options.artifactsDir,
    fixture.supportRootRel,
    sanitizePathSegment(path.basename(fixture.entryPath)),
    'isaac_stage_summary.json',
  );
  try {
    const summary = await runIsaacStageOpen(options, stagePaths, outputPath);
    for (const stagePath of stagePaths) {
      const format = stagePath.endsWith('.usda') ? 'usda' : 'usd';
      const formatResult = formats[format];
      if (!formatResult) {
        continue;
      }
      const entry = summary[stagePath] as Record<string, unknown> | undefined;
      formatResult.checks.isaacStage = entry ?? null;
      if (!entry || entry.open_ok !== true) {
        markFailure(formatResult, `${format.toUpperCase()} failed IsaacSim stage open`, true);
        continue;
      }
      if (Number(entry.invalid_joint_target_count ?? 0) > 0) {
        markFailure(formatResult, `${format.toUpperCase()} has invalid IsaacSim joint targets`, true);
      }
      const typeCounts = entry.type_counts as Record<string, unknown> | undefined;
      if (typeCounts && Number(typeCounts.Mesh ?? 0) > 0 && formatResult.checks.meshLibraryIsClass !== true) {
        markFailure(formatResult, `${format.toUpperCase()} mesh library is not authored as class`);
      }
      const meshCount = Number(entry.mesh_count ?? typeCounts?.Mesh ?? 0);
      const visualMeshCount = Number(entry.visual_mesh_count ?? meshCount);
      const jointCount = Number(entry.joint_count ?? 0);
      const rigidBodyCount = Number(entry.rigid_body_count ?? 0);
      const sourceMeshCount = sourceSemanticFacts.summary.meshVisualGeometries;
      formatResult.checks.isaacSemanticParity = {
        jointCount,
        meshCount,
        rigidBodyCount,
        sourceJoints: sourceCounts.joints,
        sourceLinks: sourceCounts.links,
        sourceMeshVisuals: sourceMeshCount,
        visualMeshCount,
      };
      if (sourceMeshCount > 0 && visualMeshCount === 0) {
        markFailure(formatResult, `${format.toUpperCase()} has no IsaacSim mesh prims for ${sourceMeshCount} source mesh visuals`, true);
      } else if (sourceMeshCount > 0 && visualMeshCount !== sourceMeshCount) {
        markFailure(
          formatResult,
          `${format.toUpperCase()} IsaacSim visual mesh count differs: source=${sourceMeshCount} stage=${visualMeshCount}`,
        );
      }
      if (sourceCounts.joints > 0 && jointCount === 0) {
        markFailure(formatResult, `${format.toUpperCase()} has no IsaacSim joint prims for ${sourceCounts.joints} source joints`, true);
      } else if (sourceCounts.joints > 0 && jointCount !== sourceCounts.joints) {
        markFailure(
          formatResult,
          `${format.toUpperCase()} IsaacSim joint count differs: source=${sourceCounts.joints} stage=${jointCount}`,
        );
      }
      if (sourceCounts.links > 1 && rigidBodyCount === 0) {
        markFailure(formatResult, `${format.toUpperCase()} has no IsaacSim rigid bodies for ${sourceCounts.links} source links`, true);
      }
      const upAxis = String(entry.up_axis ?? '');
      if (upAxis && upAxis !== 'Z') {
        markFailure(formatResult, `${format.toUpperCase()} IsaacSim upAxis differs: ${upAxis}`);
      }
      const metersPerUnit = Number(entry.meters_per_unit ?? Number.NaN);
      if (Number.isFinite(metersPerUnit) && Math.abs(metersPerUnit - 1) > 1e-9) {
        markFailure(formatResult, `${format.toUpperCase()} IsaacSim metersPerUnit differs: ${metersPerUnit}`);
      }
      const zeroExtentCount = Number(entry.mesh_zero_extent_count ?? 0);
      if (zeroExtentCount > 0) {
        markFailure(formatResult, `${format.toUpperCase()} has ${zeroExtentCount} zero-extent mesh prims`, true);
      }
      const worldZeroExtentCount = Number(entry.mesh_world_zero_extent_count ?? 0);
      if (worldZeroExtentCount > 0) {
        markFailure(formatResult, `${format.toUpperCase()} has ${worldZeroExtentCount} zero world-extent mesh prims`, true);
      }
      const meshWithoutMaterialCount = Number(
        entry.visual_mesh_without_material_count ?? entry.mesh_without_material_count ?? 0,
      );
      if (sourceSemanticFacts.summary.materialSlots > 0 && meshWithoutMaterialCount > 0) {
        markFailure(
          formatResult,
          `${format.toUpperCase()} has ${meshWithoutMaterialCount} visual mesh prims without bound material`,
        );
      }
    }
  } catch (error) {
    for (const format of ['usd', 'usda'] as const) {
      if (formats[format]?.path) {
        markFailure(
          formats[format]!,
          `IsaacSim stage inspection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

async function auditFixture(
  fixture: Fixture,
  context: SourceContext,
  options: Options,
  index: number,
  total: number,
): Promise<FixtureResult> {
  process.stdout.write(`[mujoco-all-export] ${index + 1}/${total} ${fixture.entryPath}\n`);
  const file = context.availableFiles.find((candidate) => candidate.name === fixture.entryPath);
  if (!file) {
    return {
      counts: null,
      entryPath: fixture.entryPath,
      formats: {},
      id: fixture.id,
      importMessage: 'source file missing from context',
      importStatus: 'missing',
      sourceMujocoTruth: null,
      status: 'fail',
      supportRoot: fixture.supportRootRel,
    };
  }

  let importResult;
  try {
    importResult = resolveRobotFileData(file, {
      allFileContents: context.allFileContents,
      assets: context.assets,
      availableFiles: context.availableFiles,
    });
  } catch (error) {
    return {
      counts: null,
      entryPath: fixture.entryPath,
      formats: {},
      id: fixture.id,
      importMessage: error instanceof Error ? error.message : String(error),
      importStatus: 'threw',
      sourceMujocoTruth: null,
      status: 'fail',
      supportRoot: fixture.supportRootRel,
    };
  }

  if (importResult.status !== 'ready') {
    const message = importResult.status === 'error' ? importResult.message : importResult.status;
    return {
      counts: null,
      entryPath: fixture.entryPath,
      formats: {},
      id: fixture.id,
      importMessage: message ?? null,
      importStatus: importResult.status,
      sourceMujocoTruth: null,
      status: 'skipped',
      supportRoot: fixture.supportRootRel,
    };
  }

  const robot = toRobotState(importResult.robotData);
  const sourceCounts = countRobot(importResult.robotData);
  const sourceSemanticFacts = collectRobotSemanticFacts(importResult.robotData);
  const sourceMujocoTruth = options.skipMujoco
    ? null
    : await runMujocoTruth(options.mujocoPython, fixture.entryAbsPath, path.dirname(fixture.entryAbsPath));

  const formats: Partial<Record<ExportFormat, FormatResult>> = {};
  if (options.formats.includes('sdf')) {
    formats.sdf = await exportSdf(fixture, robot, sourceCounts, sourceSemanticFacts, options);
  }
  if (options.formats.includes('urdf')) {
    formats.urdf = await exportUrdfLike(fixture, robot, sourceCounts, sourceSemanticFacts, options, 'urdf');
  }
  if (options.formats.includes('mjcf')) {
    formats.mjcf = await exportMjcf(
      fixture,
      context,
      robot,
      sourceCounts,
      sourceSemanticFacts,
      sourceMujocoTruth,
      options,
    );
  }
  if (options.formats.includes('xacro')) {
    formats.xacro = await exportUrdfLike(fixture, robot, sourceCounts, sourceSemanticFacts, options, 'xacro');
  }
  if (options.formats.includes('usd')) {
    formats.usd = await exportUsdLike(fixture, context, robot, sourceSemanticFacts, options, 'usd');
  }
  if (options.formats.includes('usda')) {
    formats.usda = await exportUsdLike(fixture, context, robot, sourceSemanticFacts, options, 'usda');
  }
  await inspectUsdFormatsWithIsaac(fixture, options, formats, sourceCounts, sourceSemanticFacts);

  return {
    counts: sourceCounts,
    entryPath: fixture.entryPath,
    formats,
    id: fixture.id,
    importMessage: null,
    importStatus: 'ready',
    sourceMujocoTruth,
    status: summarizeModelStatus(formats),
    supportRoot: fixture.supportRootRel,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  installDomGlobals();
  await fsPromises.mkdir(options.artifactsDir, { recursive: true });

  const selected = await discoverFixtures(options);
  if (selected.length === 0) {
    fail('No MuJoCo MJCF XML files matched the provided filters.');
  }

  const results: FixtureResult[] = [];
  const generatedAt = new Date().toISOString();
  for (let index = 0; index < selected.length; index += 1) {
    const fixture = selected[index];
    const context = await createSourceContext(options.fixtureRoot, fixture.supportRootAbs);
    results.push(await auditFixture(fixture, context, options, index, selected.length));
    await writeAuditReport(options, results, generatedAt);
  }

  await writeAuditReport(options, results, generatedAt);
  const summary = summarizeResults(results);
  process.stdout.write(`[mujoco-all-export] summary=${options.outputPath}\n`);
  process.stdout.write(
    `[mujoco-all-export] total=${summary.total} imported=${summary.imported} pass=${summary.pass} partial=${summary.partial} fail=${summary.fail} skipped=${summary.skipped}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`[mujoco-all-export] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
