import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const SUPPORTED_TYPES = new Set(['mesh', 'box', 'sphere', 'cylinder', 'capsule']);
const MAX_SELECTED_LINKS = 12;

async function collectModelFiles(directory) {
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    throw new Error(`Cannot read model directory: ${directory}`, { cause: error });
  }
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${directory}`);
  if (!info.isDirectory()) throw new Error(`Model directory is not a directory: ${directory}`);
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${filename}`);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile()) files.push(filename);
    }
  }
  await visit(directory);
  return files;
}

function children(element, tagName) {
  return Array.from(element.children).filter(child => child.tagName === tagName);
}

function readLinks(robot) {
  const seen = new Set();
  return children(robot, 'link').map(element => {
    const link = element.getAttribute('name')?.trim();
    if (!link || seen.has(link)) throw new Error(`Missing or duplicate URDF link name: ${link ?? ''}`);
    seen.add(link);
    const geometries = ['visual', 'collision'].flatMap(subType =>
      children(element, subType).map((body, objectIndex) => {
        const geometry = children(body, 'geometry')[0];
        const shapes = geometry ? Array.from(geometry.children) : [];
        if (shapes.length !== 1) {
          throw new Error(`Expected one geometry shape: ${link} ${subType}[${objectIndex}]`);
        }
        return {
          link, subType, objectIndex, type: shapes[0].tagName,
          name: body.getAttribute('name')?.trim() ?? '',
        };
      }));
    return { link, geometries, eligible: geometries.filter(item =>
      SUPPORTED_TYPES.has(item.type) && (item.subType === 'collision' || item.objectIndex === 0)) };
  });
}

function typeKey(item) {
  return `${item.subType}:${item.type}`;
}

function selectLinks(links) {
  const candidates = links.filter(link => link.eligible.length > 0);
  const selected = new Set();
  const pendingTypes = new Set(candidates.flatMap(link => link.eligible.map(typeKey)));
  function add(link) {
    if (link && selected.size < MAX_SELECTED_LINKS) selected.add(link);
    if (link && selected.has(link)) link.eligible.forEach(item => pendingTypes.delete(typeKey(item)));
  }
  // A visual/collision type pair needs at most ten links across the supported shapes.
  while (pendingTypes.size > 0 && selected.size < MAX_SELECTED_LINKS) {
    let best;
    let bestScore = 0;
    for (const link of candidates) {
      if (selected.has(link)) continue;
      const score = new Set(link.eligible.map(typeKey).filter(key => pendingTypes.has(key))).size;
      if (score > bestScore) { best = link; bestScore = score; }
    }
    if (!best) break;
    add(best);
  }
  const collisionCount = link => link.eligible.filter(item => item.subType === 'collision').length;
  // Reserve the tail before filling the budget with multi-body links.
  add(candidates.at(-1));
  const multiCollision = candidates.filter(link => collisionCount(link) > 1)
    .sort((left, right) => collisionCount(right) - collisionCount(left));
  for (const link of multiCollision) add(link);
  function fillEvenly(pool) {
    const remaining = pool.filter(link => !selected.has(link));
    const count = Math.min(MAX_SELECTED_LINKS - selected.size, remaining.length);
    for (let index = 0; index < count; index += 1) {
      const position = count === 1 ? Math.floor((remaining.length - 1) / 2) :
        Math.round(index * (remaining.length - 1) / (count - 1));
      add(remaining[position]);
    }
  }
  fillEvenly(candidates.filter(link =>
    link.eligible.some(item => item.subType === 'visual') && collisionCount(link) > 0));
  fillEvenly(candidates);
  return candidates.filter(link => selected.has(link));
}

function summarizeTypes(cases) {
  return Object.fromEntries(['visual', 'collision'].map(subType => [
    subType, [...new Set(cases.filter(item => item.subType === subType && SUPPORTED_TYPES.has(item.type))
      .map(item => item.type))].sort(),
  ]));
}

function planCases(links) {
  const selected = selectLinks(links);
  const selectedNames = new Set(selected.map(link => link.link));
  const cases = selected.flatMap(link => link.eligible);
  if (!cases.some(item => item.subType === 'visual') || !cases.some(item => item.subType === 'collision')) {
    throw new Error('Model must have both a testable first visual and a testable collision geometry');
  }
  const all = links.flatMap(link => link.geometries);
  const availableTypes = summarizeTypes(all);
  const testedTypes = summarizeTypes(cases);
  const omittedCases = all.flatMap(item => {
    let reason;
    if (!SUPPORTED_TYPES.has(item.type)) reason = 'unsupported-type';
    else if (item.subType === 'visual' && item.objectIndex > 0) reason = 'additional-visual';
    else if (!selectedNames.has(item.link)) reason = 'link-limit';
    return reason ? [{ ...item, reason }] : [];
  });
  return {
    cases,
    coverage: {
      availableGeometryCount: all.length,
      testedGeometryCount: cases.length,
      selectedLinks: selected.map(link => link.link),
      availableTypes,
      testedTypes,
      uncoveredTypes: Object.fromEntries(['visual', 'collision'].map(subType => [
        subType, availableTypes[subType].filter(type => !testedTypes[subType].includes(type)),
      ])),
      omittedCases,
    },
  };
}

/** Inspect external URDF inputs without copying or modifying their model resources. */
export async function inspectGeometryModel(inputDirectory) {
  if (typeof inputDirectory !== 'string' || !inputDirectory.trim()) {
    throw new Error('A model directory is required');
  }
  const directory = path.resolve(inputDirectory);
  const files = await collectModelFiles(directory);
  const entries = files.filter(filename => path.extname(filename).toLowerCase() === '.urdf');
  if (entries.length !== 1) {
    throw new Error(entries.length === 0 ? `No URDF entry found in ${directory}` :
      `Multiple URDF entries found in ${directory}: ${entries.map(filename => path.relative(directory, filename)).join(', ')}`);
  }
  const source = await readFile(entries[0]);
  const text = source.toString('utf8');
  const dom = new JSDOM();
  try {
    const document = new dom.window.DOMParser().parseFromString(text, 'application/xml');
    const error = document.querySelector('parsererror');
    if (error) throw new Error(`Invalid URDF XML: ${error.textContent}`);
    const robot = document.documentElement;
    if (robot.tagName !== 'robot') throw new Error(`Expected a <robot> URDF root, got <${robot.tagName}>`);
    const links = readLinks(robot);
    return {
      directory,
      entry: path.relative(directory, entries[0]).split(path.sep).join('/'),
      name: robot.getAttribute('name')?.trim() || path.basename(entries[0], path.extname(entries[0])),
      sourceBytes: source.length,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      maxIndent: Math.max(0, ...text.split(/\r?\n/).map(line => line.match(/^[ \t]*/)[0].length)),
      linkCount: links.length,
      jointCount: children(robot, 'joint').length,
      files,
      ...planCases(links),
    };
  } finally {
    dom.window.close();
  }
}
