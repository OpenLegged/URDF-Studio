#!/usr/bin/env node
// Architecture redline gate (zero-dependency). Enforces the documented dependency
// direction app -> features -> store -> shared -> core -> types and detects import
// cycles, by classifying each import specifier by layer. Reuses the @/* -> src/*
// alias from tsconfig.base.json. Product code only (test/spec/generated excluded).
//
// Run:  node scripts/tools/dependency_boundaries.mjs            (report)
//       node scripts/tools/dependency_boundaries.mjs --check    (exit 1 on any violation)
//       node scripts/tools/dependency_boundaries.mjs --json
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = 'src';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set(['node_modules', 'runtime']); // urdf-viewer/runtime is vendored

// Documented existing exceptions (docs/architecture.md §3-4) — exact importer,
// specifier, and resolved target only. Do not widen these to feature/layer-level
// exceptions; use the baseline ratchets below for grandfathered surfaces.
const ALLOWLIST = [
  {
    importer: 'src/features/editor/index.ts',
    specifier: '../urdf-viewer',
    resolved: 'src/features/urdf-viewer/index.ts',
  },
  {
    importer: 'src/features/editor/ik_selection.ts',
    specifier: '../urdf-viewer/utils/selectedIkDragLink',
    resolved: 'src/features/urdf-viewer/utils/selectedIkDragLink.ts',
  },
  {
    importer: 'src/features/editor/panels.ts',
    specifier: '../urdf-viewer/components/ViewerPanels',
    resolved: 'src/features/urdf-viewer/components/ViewerPanels.tsx',
  },
  {
    importer: 'src/features/editor/panels.ts',
    specifier: '../urdf-viewer/hooks/useResponsivePanelLayout',
    resolved: 'src/features/urdf-viewer/hooks/useResponsivePanelLayout.ts',
  },
  {
    importer: 'src/features/editor/panels.ts',
    specifier: '../urdf-viewer/hooks/useViewerController',
    resolved: 'src/features/urdf-viewer/hooks/useViewerController.ts',
  },
  {
    importer: 'src/features/editor/usd_bindings.ts',
    specifier: '../urdf-viewer/utils/usdBindingsAssetPaths',
    resolved: 'src/features/urdf-viewer/utils/usdBindingsAssetPaths.ts',
  },
  {
    importer: 'src/features/editor/usd_documents.ts',
    specifier: '../urdf-viewer/utils/usdPreloadSources',
    resolved: 'src/features/urdf-viewer/utils/usdPreloadSources.ts',
  },
  {
    importer: 'src/features/editor/usd_export.ts',
    specifier: '../urdf-viewer/utils/usdExportBundle',
    resolved: 'src/features/urdf-viewer/utils/usdExportBundle.ts',
  },
  {
    importer: 'src/features/editor/usd_hydration.ts',
    specifier: '../urdf-viewer/utils/usdOffscreenViewerProtocol',
    resolved: 'src/features/urdf-viewer/utils/usdOffscreenViewerProtocol.ts',
  },
  {
    importer: 'src/features/editor/usd_hydration.ts',
    specifier: '../urdf-viewer/utils/usdPreparedExportCacheWorkerBridge',
    resolved: 'src/features/urdf-viewer/utils/usdPreparedExportCacheWorkerBridge.ts',
  },
  {
    importer: 'src/features/editor/usd_hydration.ts',
    specifier: '../urdf-viewer/utils/usdPreparedExportCacheWorkerTransfer',
    resolved: 'src/features/urdf-viewer/utils/usdPreparedExportCacheWorkerTransfer.ts',
  },
  {
    importer: 'src/features/editor/usd_hydration.ts',
    specifier: '../urdf-viewer/utils/viewerRobotData',
    resolved: 'src/features/urdf-viewer/utils/viewerRobotData.ts',
  },
  {
    importer: 'src/features/editor/usd_offscreen_runtime.ts',
    specifier: '../urdf-viewer/utils/usdOffscreenViewerWorkerClient',
    resolved: 'src/features/urdf-viewer/utils/usdOffscreenViewerWorkerClient.ts',
  },
  {
    importer: 'src/features/editor/usd_prewarm.ts',
    specifier: '../urdf-viewer/utils/preparedUsdStageOpenCache',
    resolved: 'src/features/urdf-viewer/utils/preparedUsdStageOpenCache.ts',
  },
  {
    importer: 'src/features/editor/usd_prewarm.ts',
    specifier: '../urdf-viewer/utils/usdBlobBackedUsda',
    resolved: 'src/features/urdf-viewer/utils/usdBlobBackedUsda.ts',
  },
  {
    importer: 'src/features/editor/usd_runtime.ts',
    specifier: '../urdf-viewer/utils/usdWasmRuntime',
    resolved: 'src/features/urdf-viewer/utils/usdWasmRuntime.ts',
  },
  {
    importer: 'src/lib/components/RobotCanvas.tsx',
    specifier: '../../features/urdf-viewer/components/JointInteraction',
    resolved: 'src/features/urdf-viewer/components/JointInteraction.tsx',
  },
  {
    importer: 'src/lib/components/RobotCanvas.tsx',
    specifier: '../../features/urdf-viewer/components/RobotModel',
    resolved: 'src/features/urdf-viewer/components/RobotModel.tsx',
  },
];

const PUBLIC_APP_FEATURE_FACADES = new Set([
  'src/features/assembly/bridge_create_modal.ts',
  'src/features/editor/ik_selection.ts',
  'src/features/editor/panels.ts',
  'src/features/editor/usd_bindings.ts',
  'src/features/editor/usd_documents.ts',
  'src/features/editor/usd_export.ts',
  'src/features/editor/usd_hydration.ts',
  'src/features/editor/usd_offscreen_runtime.ts',
  'src/features/editor/usd_prewarm.ts',
  'src/features/editor/usd_runtime.ts',
  'src/features/file-io/import_path_collisions.ts',
  'src/features/property-editor/collision_optimization.ts',
  'src/features/property-editor/collision_optimization_dialog.ts',
]);

const BASELINE_PATH = 'scripts/tools/dependency_boundaries_baseline.json';

const options = parseArgs(process.argv.slice(2));
const baseline = await readBaseline();
const knownCycles = new Set(baseline.knownCycles || []);
const knownFeatureDeepImportKeys = new Set(baseline.knownFeatureDeepImports || []);
const files = await collectSourceFiles(SRC);
const fileSet = new Set(files);

const boundaryViolations = [];
const observedFeatureDeepImports = new Map(); // importer -> specifier key -> entry
const graph = new Map(); // importerRel -> Set<targetRel>

for (const relPath of files) {
  const text = await readFile(path.join(ROOT, relPath), 'utf8');
  const importerLayer = classifyLayer(relPath);
  const edges = new Set();

  for (const dependency of extractDependencies(text)) {
    const spec = dependency.specifier;
    const resolvedRel = resolveInternal(relPath, spec);
    const targetLayer = resolvedRel ? classifyLayer(resolvedRel) : classifyExternal(spec);
    if (!targetLayer) {
      continue;
    }
    const deepImport = getAppFeatureDeepImport(relPath, importerLayer, resolvedRel, spec);
    if (deepImport) {
      observedFeatureDeepImports.set(deepImport.key, deepImport);
    }

    const violation =
      dependency.syntax === 'require' && path.extname(relPath) !== '.cjs'
        ? {
            importer: relPath,
            importerLayer,
            target: spec,
            targetLayer,
            reason:
              'require() is not allowed in ESM product source; use an import or an explicit .cjs/tool boundary',
          }
        : checkBoundary(relPath, importerLayer, targetLayer, spec, resolvedRel);
    if (violation) {
      boundaryViolations.push(violation);
    }
    if (resolvedRel && resolvedRel !== relPath) {
      edges.add(resolvedRel);
    }
  }
  graph.set(relPath, edges);
}

const allCycles = findCycles(graph).map((cycle) => ({ cycle, signature: cycleSignature(cycle) }));
const newCycles = allCycles.filter((entry) => !knownCycles.has(entry.signature));
const knownCycleCount = allCycles.length - newCycles.length;
const featureDeepImportEntries = [...observedFeatureDeepImports.values()].sort((a, b) =>
  a.key.localeCompare(b.key),
);
const knownFeatureDeepImports = featureDeepImportEntries.filter((entry) =>
  knownFeatureDeepImportKeys.has(entry.key),
);
const newFeatureDeepImports = featureDeepImportEntries.filter(
  (entry) => !knownFeatureDeepImportKeys.has(entry.key),
);
const staleFeatureDeepImports = [...knownFeatureDeepImportKeys]
  .filter((key) => !observedFeatureDeepImports.has(key))
  .sort();
const report = {
  boundaryViolations,
  featureDeepImports: {
    known: knownFeatureDeepImports,
    new: newFeatureDeepImports,
    stale: staleFeatureDeepImports,
  },
  newCycles: newCycles.map((entry) => entry.cycle),
  knownCycleCount,
  scannedFiles: files.length,
};

if (options.json) {
  console.log(
    JSON.stringify(
      { ...report, allCycleSignatures: allCycles.map((entry) => entry.signature) },
      null,
      2,
    ),
  );
} else {
  printReport(report);
}

if (
  options.check &&
  (boundaryViolations.length > 0 ||
    newFeatureDeepImports.length > 0 ||
    staleFeatureDeepImports.length > 0 ||
    newCycles.length > 0)
) {
  process.exitCode = 1;
}

// ---------------------------------------------------------------- helpers

function parseArgs(args) {
  const parsed = { check: false, json: false };
  for (const arg of args) {
    if (arg === '--check') {
      parsed.check = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function readBaseline() {
  try {
    const raw = await readFile(path.join(ROOT, BASELINE_PATH), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      knownCycles: Array.isArray(parsed.knownCycles) ? parsed.knownCycles : [],
      knownFeatureDeepImports: Array.isArray(parsed.knownFeatureDeepImports)
        ? parsed.knownFeatureDeepImports
        : [],
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { knownCycles: [], knownFeatureDeepImports: [] };
    }
    throw error;
  }
}

function cycleSignature(cycle) {
  return [...new Set(cycle)].sort().join('|');
}

async function collectSourceFiles(dir) {
  const out = [];
  await walk(dir, out);
  return out.sort();
}

async function walk(relDir, out) {
  const entries = await readdir(path.join(ROOT, relDir), { withFileTypes: true });
  for (const entry of entries) {
    const relPath = toPosix(path.join(relDir, entry.name));
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(relPath, out);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(relPath))) {
      continue;
    }
    if (/\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(relPath)) {
      continue; // tests legitimately reach across layers
    }
    if (/\.generated\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(relPath)) {
      continue;
    }
    out.push(relPath);
  }
}

function extractDependencies(text) {
  const dependencies = [];
  // import ... from 'x'  |  export ... from 'x'
  for (const match of text.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
    dependencies.push({ specifier: match[1], syntax: 'esm' });
  }
  // bare side-effect import 'x'
  for (const match of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) {
    dependencies.push({ specifier: match[1], syntax: 'esm' });
  }
  // dynamic import('x')
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    dependencies.push({ specifier: match[1], syntax: 'esm' });
  }
  // Static CommonJS require calls still create dependency edges, but are rejected in
  // ESM product files so they cannot bypass the architecture gate.
  for (const match of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    dependencies.push({ specifier: match[1], syntax: 'require' });
  }
  return dependencies;
}

function resolveInternal(importerRel, spec) {
  let baseNoExt;
  if (spec.startsWith('@/')) {
    baseNoExt = toPosix(path.join(SRC, spec.slice(2)));
  } else if (spec.startsWith('.')) {
    baseNoExt = toPosix(path.join(path.dirname(importerRel), spec));
  } else {
    return null; // external package
  }
  if (!baseNoExt.startsWith(`${SRC}/`) && baseNoExt !== SRC) {
    return null;
  }
  const candidates = [
    baseNoExt,
    `${baseNoExt}.ts`,
    `${baseNoExt}.tsx`,
    `${baseNoExt}.js`,
    `${baseNoExt}.jsx`,
    `${baseNoExt}.mjs`,
    `${baseNoExt}/index.ts`,
    `${baseNoExt}/index.tsx`,
    `${baseNoExt}/index.js`,
  ];
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) {
      return candidate;
    }
  }
  return null; // resolves to .css/.json/.worker asset or a test file we skipped
}

function classifyLayer(relPath) {
  if (!relPath.startsWith(`${SRC}/`)) {
    return null;
  }
  const rest = relPath.slice(SRC.length + 1);
  if (rest.startsWith('app/')) return 'app';
  if (rest.startsWith('store/')) return 'store';
  if (rest.startsWith('shared/')) return 'shared';
  if (rest.startsWith('core/')) return 'core';
  if (rest.startsWith('types/')) return 'types';
  if (rest.startsWith('lib/')) return 'lib';
  if (rest.startsWith('features/')) {
    const name = rest.split('/')[1];
    return `feature:${name}`;
  }
  return 'app'; // src/main.tsx and other top-level entry files behave as app shell
}

function classifyExternal(spec) {
  if (/^react(-dom)?($|\/)/.test(spec) || spec.startsWith('@react-three/')) {
    return 'react-ui';
  }
  return 'external';
}

function checkBoundary(importerRel, importerLayer, targetLayer, spec, resolvedRel) {
  if (!importerLayer || targetLayer === 'external') {
    return null;
  }
  if (importerLayer === 'types') {
    if (targetLayer === 'types') {
      return null;
    }
    return {
      importer: importerRel,
      importerLayer,
      target: spec,
      targetLayer,
      reason: `types is a leaf layer and must not import ${targetLayer}`,
    };
  }
  if (targetLayer === 'types') {
    return null;
  }
  if (isAllowlisted(importerRel, spec, resolvedRel)) {
    return null;
  }

  const importerFeature = importerLayer.startsWith('feature:') ? importerLayer.slice(8) : null;
  const targetFeature = targetLayer.startsWith('feature:') ? targetLayer.slice(8) : null;
  let reason = null;

  if (importerLayer === 'core') {
    if (targetLayer === 'react-ui') {
      reason = 'core must stay pure: no React / @react-three';
    } else if (['app', 'store', 'shared', 'lib'].includes(targetLayer) || targetFeature) {
      reason = `core must not import ${targetLayer} (core sits below shared/store/features)`;
    }
  } else if (importerFeature) {
    if (targetLayer === 'app') {
      reason = 'feature must not import app (app orchestrates features, not the reverse)';
    } else if (targetFeature && targetFeature !== importerFeature) {
      reason = `cross-feature import: features talk via store, not feature:${targetFeature}`;
    }
  } else if (importerLayer === 'shared') {
    if (targetLayer === 'app' || targetLayer === 'store' || targetFeature) {
      reason = `shared must not import ${targetLayer}`;
    }
  } else if (importerLayer === 'store') {
    if (targetLayer === 'app' || targetFeature) {
      reason = `store must not import ${targetLayer}`;
    }
  } else if (importerLayer === 'lib') {
    if (targetLayer === 'app' || targetLayer === 'store' || targetFeature) {
      reason = `lib must not import ${targetLayer}`;
    }
  }

  if (!reason) {
    return null;
  }
  return { importer: importerRel, importerLayer, target: spec, targetLayer, reason };
}

function isAllowlisted(importerRel, spec, resolvedRel) {
  return ALLOWLIST.some(
    (entry) =>
      importerRel === entry.importer && spec === entry.specifier && resolvedRel === entry.resolved,
  );
}

function getAppFeatureDeepImport(importerRel, importerLayer, resolvedRel, spec) {
  if (importerLayer !== 'app' || !resolvedRel) {
    return null;
  }
  const match = /^src\/features\/([^/]+)\/(.+)$/.exec(resolvedRel);
  if (!match) {
    return null;
  }
  if (isPublicAppFeatureEntrypoint(resolvedRel, match[2])) {
    return null;
  }
  const feature = match[1];
  const key = featureDeepImportKey(importerRel, spec);
  return { key, importer: importerRel, specifier: spec, feature, resolved: resolvedRel };
}

function isPublicAppFeatureEntrypoint(resolvedRel, featurePath) {
  return (
    /^index\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(featurePath) ||
    PUBLIC_APP_FEATURE_FACADES.has(resolvedRel)
  );
}

function featureDeepImportKey(importerRel, spec) {
  return `${importerRel} -> ${spec}`;
}

function findCycles(adjacency) {
  const state = new Map(); // 0=unvisited,1=on-stack,2=done
  const stack = [];
  const found = [];
  const seenSignatures = new Set();

  const dfs = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of adjacency.get(node) || []) {
      if (!adjacency.has(next)) {
        continue;
      }
      const status = state.get(next) || 0;
      if (status === 0) {
        dfs(next);
      } else if (status === 1) {
        const idx = stack.indexOf(next);
        if (idx !== -1) {
          const cycle = stack.slice(idx).concat(next);
          const signature = [...cycle].sort().join('|');
          if (!seenSignatures.has(signature)) {
            seenSignatures.add(signature);
            found.push(cycle);
          }
        }
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of adjacency.keys()) {
    if ((state.get(node) || 0) === 0) {
      dfs(node);
    }
  }
  return found;
}

function printReport(report) {
  console.log('Dependency boundaries');
  console.log(`Scanned files: ${report.scannedFiles}`);
  console.log('');

  console.log(
    `[${report.boundaryViolations.length === 0 ? 'OK' : 'FAIL'}] layer boundaries: ${report.boundaryViolations.length} violation(s)`,
  );
  for (const v of report.boundaryViolations.slice(0, 30)) {
    console.log(`  ${v.importer} -> ${v.target}`);
    console.log(`    ${v.reason}`);
  }

  const featureDeepImports = report.featureDeepImports;
  const featureDeepImportFailed =
    featureDeepImports.new.length > 0 || featureDeepImports.stale.length > 0;
  console.log(
    `[${featureDeepImportFailed ? 'FAIL' : 'OK'}] app feature deep imports: ${featureDeepImports.new.length} new, ${featureDeepImports.known.length} grandfathered, ${featureDeepImports.stale.length} stale`,
  );
  if (featureDeepImports.new.length > 0) {
    console.log('  New app feature deep imports:');
    for (const entry of featureDeepImports.new.slice(0, 30)) {
      console.log(`    ${entry.key}`);
      console.log(`      resolves to ${entry.resolved}`);
    }
  }
  if (featureDeepImports.known.length > 0) {
    console.log('  Known app feature deep imports:');
    for (const entry of featureDeepImports.known.slice(0, 30)) {
      console.log(`    ${entry.key}`);
    }
    if (featureDeepImports.known.length > 30) {
      console.log(`    ... ${featureDeepImports.known.length - 30} more`);
    }
  }
  if (featureDeepImports.stale.length > 0) {
    console.log('  Stale app feature deep import baseline entries:');
    for (const key of featureDeepImports.stale.slice(0, 30)) {
      console.log(`    ${key}`);
    }
  }

  console.log(
    `[${report.newCycles.length === 0 ? 'OK' : 'FAIL'}] import cycles: ${report.newCycles.length} new, ${report.knownCycleCount} grandfathered`,
  );
  for (const cycle of report.newCycles.slice(0, 15)) {
    console.log(`  ${cycle.join(' -> ')}`);
  }

  if (
    report.boundaryViolations.length > 0 ||
    featureDeepImportFailed ||
    report.newCycles.length > 0
  ) {
    console.log('');
    console.log('Architecture redline broken. See docs/architecture.md §1-4.');
  }
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}
