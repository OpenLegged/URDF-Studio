// Batch thumbnail exporter for URDF Studio.
//
// Scans a directory of robot assets (one sub-directory per asset), loads each
// into the running app via the regression debug API
// (window.__URDF_STUDIO_DEBUG__, enabled by ?regressionDebug=1), drives the
// existing SnapshotManager preview pipeline per asset, and writes one image
// per asset to the output directory.
//
// Why the debug API instead of a custom bridge: URDF Studio already exposes a
// purpose-built automation surface (resetFixtureFiles / seedFixtureFile /
// loadRobotByName / getDocumentLoadState). Mesh references (package://...,
// model://...) are resolved against blob URLs registered in assetsStore, so we
// seed every file in the asset directory — not just the primary definition —
// the same way the in-app ZIP importer does.
//
// Requirements:
//   - Puppeteer chrome installed: `npx puppeteer browsers install chrome`
//   - Vite dev mode (?regressionDebug=1 only attaches in DEV). The script
//     boots its own dev server on port 5180 (avoids 5173).
//
// Options:
//   -i, --input <dir>      REQUIRED. Asset root (one sub-directory per asset).
//   -o, --output <dir>     Image output directory. Default: thumbnails.
//   --headed               Run headed (default headless; use to debug).
//   --port <n>             Dev-server port. Default: 5180.
//   --theme <t>            UI theme: light | dark | system. Default: system.
//   --zoom <n>             Camera dolly zoom after auto-framing; 2 = twice as
//                          close, 0.8 = farther out. Default: off (auto-framed).
//   --long-edge <px>       Output long-edge resolution. Default: 1024.
//   --format <fmt>         png | jpeg | webp. Default: png.
//   --quality <n>          JPEG/WebP quality 60-100. Default: 92.
//   --detail <lvl>         viewport | high | ultra (supersampling). Default: high.
//   --environment <env>    viewport | studio | city | contrast. Default: viewport.
//   --background <bg>      studio | viewport | sky | dark | transparent. Default: studio.
//   --shadow <style>       soft | balanced | crisp. Default: balanced.
//   --ground <style>       shadow | contact | reflective. Default: shadow.
//   --aspect-ratio <ar>    viewport | 16:9 | 4:3 | 1:1 | 3:4 | 9:16. Default: 1:1.
//   --no-grid              (default) Hide the reference grid in captures.
//   --grid                 Keep the reference grid in captures.
//   --timeout <s>          Per-asset load timeout in seconds. Default: 240.
//
// Reference invocation (square transparent PNGs, studio lighting):
//   node scripts/tools/batch-export-thumbnails.mjs -i ~/Desktop/asset -o ~/Desktop/thumbnail --theme light --aspect-ratio 16:9 --long-edge 1920
import { createServer } from "vite";
import puppeteer from "puppeteer";
import { readdirSync, readFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, basename, extname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const DEFAULT_PORT = 5180; // avoid 5173 (a dev session may already use it)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- File classification -------------------------------------------------

const USD_EXTS = [".usd", ".usda", ".usp"];
// Binary/blob assets registered into assetsStore as fetchable URLs.
const BLOB_EXTS = [
  ".stl", ".dae", ".obj", ".gltf", ".glb", ".bin",
  ".png", ".jpg", ".jpeg", ".webp",
];
// Text assets registered into allFileContents (xacro include / mjcf source).
const TEXT_AUX_EXTS = [".urdf", ".xacro", ".sdf", ".xml", ".yaml", ".yml", ".json", ".txt", ".mtl"];

function extOf(file) {
  return extname(file).toLowerCase();
}

function formatForExt(ext) {
  if (ext === ".urdf") return "urdf";
  if (ext === ".xacro") return "xacro";
  if (ext === ".mjcf" || ext === ".xml") return "mjcf";
  if (ext === ".sdf") return "sdf";
  if (USD_EXTS.includes(ext)) return "usd";
  return "asset";
}

function mimeForExt(ext) {
  switch (ext) {
    case ".stl": return "model/stl";
    case ".dae": return "model/vnd.collada+xml";
    case ".obj": return "model/obj";
    case ".gltf": return "model/gltf+json";
    case ".glb": return "model/gltf-binary";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

// Pick the primary definition file from a directory's relative file list.
// Priority: URDF/XACRO > MJCF/XML > SDF > USD > first file.
function pickPrimaryFile(files) {
  for (const ext of [".urdf", ".xacro"]) {
    const match = files.find((f) => extOf(f) === ext);
    if (match) return match;
  }
  for (const ext of [".mjcf", ".xml"]) {
    const match = files.find((f) => extOf(f) === ext);
    if (match) return match;
  }
  // SDF: prefer the shortest basename (model.sdf over model-1_4.sdf), matching
  // the in-app selector's path-preference heuristic. A bare files.find would
  // pick model-1_4.sdf ('-' sorts before '.') and load a partial model.
  const sdfFiles = files.filter((f) => extOf(f) === ".sdf");
  if (sdfFiles.length > 0) {
    sdfFiles.sort((a, b) => {
      const ba = basename(a);
      const bb = basename(b);
      if (ba.length !== bb.length) return ba.length - bb.length;
      return a.localeCompare(b);
    });
    return sdfFiles[0];
  }
  const usd = files.find((f) => USD_EXTS.includes(extOf(f)));
  if (usd) return usd;
  return files[0] ?? null;
}

function scanDirRecursive(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // skip hidden (.DS_Store etc.)
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...scanDirRecursive(full, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function scanAssetDirs(rootDir) {
  const result = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dirPath = join(rootDir, entry.name);
    const files = scanDirRecursive(dirPath);
    const primary = pickPrimaryFile(files);
    if (!primary) {
      console.warn(`[batch] no model file in "${entry.name}", skipping`);
      continue;
    }
    result.push({ dirName: entry.name, dirPath, primaryFile: primary, files });
  }
  return result.sort((a, b) => a.dirName.localeCompare(b.dirName));
}

// --- Args ----------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    input: null,
    output: "thumbnails",
    headed: false,
    port: DEFAULT_PORT,
    theme: "system",
    zoom: null,
    longEdge: 1024,
    format: "png",
    quality: 92,
    detail: "high",
    environment: "viewport",
    background: "studio",
    shadow: "balanced",
    ground: "shadow",
    aspectRatio: "1:1",
    grid: false,
    timeout: 240,
  };
  const FORMATS = ["png", "jpeg", "webp"];
  const THEMES = ["light", "dark", "system"];
  const DETAILS = ["viewport", "high", "ultra"];
  const ENVS = ["viewport", "studio", "city", "contrast"];
  const BGS = ["studio", "viewport", "sky", "dark", "transparent"];
  const SHADOWS = ["soft", "balanced", "crisp"];
  const GROUNDS = ["shadow", "contact", "reflective"];
  const ASPECTS = ["viewport", "16:9", "4:3", "1:1", "3:4", "9:16"];

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" || a === "-i") args.input = argv[++i];
    else if (a === "--output" || a === "-o") args.output = argv[++i];
    else if (a === "--headed") args.headed = true;
    else if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--theme") args.theme = argv[++i];
    else if (a === "--zoom") args.zoom = Number(argv[++i]);
    else if (a === "--long-edge") args.longEdge = Number(argv[++i]);
    else if (a === "--format") args.format = argv[++i];
    else if (a === "--quality") args.quality = Number(argv[++i]);
    else if (a === "--detail") args.detail = argv[++i];
    else if (a === "--environment") args.environment = argv[++i];
    else if (a === "--background") args.background = argv[++i];
    else if (a === "--shadow") args.shadow = argv[++i];
    else if (a === "--ground") args.ground = argv[++i];
    else if (a === "--aspect-ratio") args.aspectRatio = argv[++i];
    else if (a === "--no-grid") args.grid = false;
    else if (a === "--grid") args.grid = true;
    else if (a === "--timeout") args.timeout = Number(argv[++i]);
    else {
      console.error(`[batch] unknown argument: ${a}`);
      process.exit(2);
    }
  }

  const need = (val, label, allowed) => {
    if (!allowed.includes(val)) {
      console.error(`[batch] invalid --${label} ${val} (use: ${allowed.join("|")})`);
      process.exit(2);
    }
  };
  need(args.theme, "theme", THEMES);
  need(args.format, "format", FORMATS);
  need(args.detail, "detail", DETAILS);
  need(args.environment, "environment", ENVS);
  need(args.background, "background", BGS);
  need(args.shadow, "shadow", SHADOWS);
  need(args.ground, "ground", GROUNDS);
  need(args.aspectRatio, "aspect-ratio", ASPECTS);
  if (!(Number.isFinite(args.longEdge) && args.longEdge >= 512)) {
    console.error(`[batch] invalid --long-edge ${args.longEdge} (must be >= 512)`);
    process.exit(2);
  }
  if (!(Number.isFinite(args.quality) && args.quality >= 60 && args.quality <= 100)) {
    console.error(`[batch] invalid --quality ${args.quality} (must be 60-100)`);
    process.exit(2);
  }
  if (args.zoom !== null && !(Number.isFinite(args.zoom) && args.zoom > 0)) {
    console.error(`[batch] invalid --zoom ${args.zoom} (must be a positive number; 2 = twice as close)`);
    process.exit(2);
  }
  if (!args.input) {
    console.error(
      "Usage: node scripts/batch-export-thumbnails.mjs --input <asset-root> [--output <dir>]\n" +
        "  [--headed] [--port 5180] [--theme light|dark|system] [--zoom 2]\n" +
        "  [--long-edge 1024] [--format png|jpeg|webp] [--quality 92]\n" +
        "  [--detail viewport|high|ultra] [--environment viewport|studio|city|contrast]\n" +
        "  [--background studio|viewport|sky|dark|transparent]\n" +
        "  [--shadow soft|balanced|crisp] [--ground shadow|contact|reflective]\n" +
        "  [--aspect-ratio viewport|16:9|4:3|1:1|3:4|9:16] [--grid] [--timeout 240]",
    );
    process.exit(2);
  }
  return args;
}

// --- Playwright helpers --------------------------------------------------

async function warmUp(url, timeoutMs) {
  // Vite's first request triggers dependency pre-bundling, which blocks the
  // server for tens of seconds. Poll until it serves a 200.
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `status ${res.status}`;
    } catch (e) {
      last = e.message;
    }
    await sleep(1000);
  }
  throw new Error(`warm-up failed: ${last}`);
}

async function waitFor(fn, predicate, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timed out (last=${JSON.stringify(last)})`);
}

// puppeteer v24 garbage-collects promises held inside page.evaluate and fails
// with "Promise was collected" (also "Execution context was destroyed" across
// re-navigation). The in-repo regression script retries both. Mirror that.
const RETRYABLE_EVALUATE_ERRORS =
  /Promise was collected|Execution context was destroyed|Navigating frame was detached|Target closed/i;

async function evaluateWithRetry(page, fn, ...args) {
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await page.evaluate(fn, ...args);
    } catch (error) {
      const message = String(error?.message || error);
      if (!RETRYABLE_EVALUATE_ERRORS.test(message) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(300 * attempt);
    }
  }
}

// Wait until the runtime is present and the robot meshes have mounted AND all
// placeholder meshes have resolved, so we don't capture a blank or placeholder
// frame — the symptom for large DAE assets (iscas_museum, iss, raceway,
// airport) whose worker parse takes tens of seconds.
//
// Progress-driven (not a fixed grace): as long as meshes are still mounting
// (count/identity changing) or placeholders are still resolving (unresolved
// decreasing), keep waiting. Only when there is NO progress for STALL_SAMPLES
// (~30s) — or the overall per-asset deadline lapses — do we capture as-is
// (proceededAnyway), so stuck / never-resolving meshes (missing deps, LFS
// pointers) don't block the whole batch. count===0 while still loading keeps
// waiting (the DAE may mount its meshes in one burst after a long parse);
// count===0 with terminal 'ready' status is a primitive robot (accept).
async function waitForSceneStable(page, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  const STABLE_SAMPLES = 3;
  const INTERVAL = 500;
  const STALL_SAMPLES = 60;
  let prevSig = null;
  let prevUnresolved = -1;
  let mountStable = 0;
  let stall = 0;
  let last = { status: null, runtimePresent: false, count: 0, unresolved: 0 };
  while (Date.now() < deadline) {
    last = await evaluateWithRetry(page, () => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const s = api.getDocumentLoadState() ?? {};
      let count = 0;
      let unresolved = 0;
      const scene = window.scene;
      if (scene) {
        scene.traverse((o) => {
          if (!o.isMesh) return;
          const helperName = (o.name || o.parent?.name || "").toLowerCase();
          // Skip scene helpers (ground plane / grid / shadow catcher / gizmos) —
          // they are not robot meshes and would pollute the mount-stability
          // count. Mirrors frameScene's helper-name filter. Track ALL other
          // meshes (not just ::visual::-named ones) so assets whose meshes use
          // different naming (e.g. iscas_museum's Collada scene tree) are still
          // awaited for mount + placeholder resolution.
          if (
            helperName.includes("ground") ||
            helperName.includes("grid") ||
            helperName.includes("shadow") ||
            helperName.includes("axes") ||
            helperName.includes("gizmo") ||
            helperName.includes("plane")
          ) {
            return;
          }
          count += 1;
          // A real placeholder (waiting for an STL/DAE mesh to swap in) is
          // marked userData.isPlaceholder. Primitive geometry is NOT a
          // placeholder — it is the final geometry — so don't flag it.
          if (o.userData?.isPlaceholder) unresolved += 1;
        });
      }
      // Keep this evaluate light: huge scenes (sonoma_raceway) have thousands
      // of meshes, and building/sorting/joining a uuid array on every poll made
      // the evaluate heavy enough for puppeteer v24 to GC its promise ("Promise
      // was collected"). Count alone is enough for mount-stability detection.
      return {
        status: s.status ?? null,
        error: s.error ?? null,
        runtimePresent: Boolean(api.getRegressionSnapshot?.().runtime),
        count,
        unresolved,
        sig: String(count),
      };
    });
    if (last.status === "error") {
      return { ok: false, reason: `load error: ${last.error ?? "unknown"}` };
    }
    const runtimeReady = last.status === "ready" || last.runtimePresent;
    if (!runtimeReady) {
      prevSig = null;
      prevUnresolved = -1;
      mountStable = 0;
      stall = 0;
      await sleep(INTERVAL);
      continue;
    }

    // Primitive robot done: terminal status, no robot meshes.
    if (last.count === 0 && last.status === "ready") {
      return { ok: true, visualCount: 0 };
    }

    // Progress = meshes still mounting (sig changed) OR placeholders still
    // resolving (unresolved decreased). Large DAE assets (iscas_museum, iss,
    // raceway, airport) parse for tens of seconds; keep waiting while progress
    // is being made so we don't capture a blank / placeholder frame.
    const mountProgress = last.sig !== prevSig;
    const resolveProgress = prevUnresolved >= 0 && last.unresolved < prevUnresolved;
    if (mountProgress || resolveProgress) {
      stall = 0;
    } else {
      stall += 1;
    }
    if (last.count > 0 && last.sig === prevSig) {
      mountStable += 1;
    } else {
      mountStable = 0;
    }

    // Accept once meshes have mounted AND all placeholders resolved.
    if (last.count > 0 && last.unresolved === 0 && mountStable >= STABLE_SAMPLES) {
      return { ok: true, visualCount: last.count };
    }

    // Stalled (no progress for a while) with meshes already present: capture
    // as-is rather than blocking to the deadline — covers meshes that never
    // resolve (missing deps, LFS pointers). count===0 keeps waiting, because
    // the DAE may still be parsing and mount its meshes in one burst.
    if (stall >= STALL_SAMPLES && last.count > 0) {
      return {
        ok: true,
        proceededAnyway: true,
        visualCount: last.count,
        reason: `scene stalled for ${(STALL_SAMPLES * INTERVAL) / 1000}s (${last.unresolved} unresolved); capturing as-is`,
      };
    }

    prevSig = last.sig;
    prevUnresolved = last.unresolved;
    await sleep(INTERVAL);
  }
  if (last.runtimePresent) {
    return {
      ok: true,
      proceededAnyway: true,
      visualCount: last.count,
      reason: `scene not stable by deadline (status=${last.status}, count=${last.count}, unresolved=${last.unresolved}); capturing as-is`,
    };
  }
  return {
    ok: false,
    reason: `load timeout (last status=${last.status}, visualCount=${last.count})`,
  };
}

// --- Per-asset pipeline --------------------------------------------------

async function seedAssetFiles(page, asset) {
  for (const relFile of asset.files) {
    const full = join(asset.dirPath, relFile);
    const ext = extOf(relFile);
    // exposedName mirrors the in-package relative path so package:// and
    // model:// mesh references resolve against the blob URLs we register.
    const exposedName = `${asset.dirName}/${relFile}`.replace(/\\/g, "/");
    const isBlob = BLOB_EXTS.includes(ext);

    if (isBlob) {
      const buf = readFileSync(full);
      const b64 = buf.toString("base64");
      const mimeType = mimeForExt(ext);
      await evaluateWithRetry(
        page,
        async ({ exposedName, b64, mimeType }) => {
          const res = await fetch(`data:${mimeType};base64,${b64}`);
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          window.__URDF_STUDIO_DEBUG__.seedFixtureFile({
            name: exposedName,
            format: "mesh",
            blobUrl,
          });
        },
        { exposedName, b64, mimeType },
      );
    } else {
      const text = readFileSync(full, "utf8");
      const format = formatForExt(ext);
      const addFileContent = TEXT_AUX_EXTS.includes(ext);
      await evaluateWithRetry(
        page,
        ({ exposedName, text, format, addFileContent }) => {
          window.__URDF_STUDIO_DEBUG__.seedFixtureFile({
            name: exposedName,
            content: text,
            format,
            addFileContent,
          });
        },
        { exposedName, text, format, addFileContent },
      );
    }
  }
}

async function processAsset(page, asset, captureOpts, loadTimeoutMs, navUrl, theme) {
  // Re-navigate per asset. resetFixtureFiles clears assetsStore but NOT the
  // robot-import worker's context cache, so a second load in the same page
  // session can stall in 'loading' forever. A fresh page load resets React,
  // the worker pool, and every store, so each asset loads as a clean first
  // load. Costs ~10s/asset of navigation but is the only reliably correct path.
  await page.goto(navUrl, { waitUntil: "load", timeout: 120000 });
  await waitFor(
    () => evaluateWithRetry(page, () => Boolean(window.__URDF_STUDIO_DEBUG__?.loadRobotByName)),
    Boolean,
    60000,
  );
  await waitFor(
    () =>
      evaluateWithRetry(
        page,
        () => typeof window.__URDF_STUDIO_DEBUG__?.captureSnapshot === "function",
      ),
    Boolean,
    60000,
  );
  await evaluateWithRetry(page, () =>
    window.__URDF_STUDIO_DEBUG__.setBeforeUnloadPromptEnabled(false),
  );
  if (theme && theme !== "system") {
    await evaluateWithRetry(
      page,
      (t) => {
        const uiStore = window.__URDF_STUDIO_DEBUG__?.__uiStore__;
        uiStore?.getState?.().setTheme?.(t);
      },
      theme,
    );
  }

  const primaryName = `${asset.dirName}/${asset.primaryFile}`.replace(/\\/g, "/");

  // Reset any default fixtures the app boots with, then seed this asset's
  // files (primary definition + every mesh/texture).
  await evaluateWithRetry(page, () => window.__URDF_STUDIO_DEBUG__.resetFixtureFiles());
  await seedAssetFiles(page, asset);

  // Fire loadRobotByName WITHOUT awaiting its long internal waitForStableSnapshot
  // promise — awaiting a long-lived promise triggers puppeteer v24's
  // "Promise was collected". Retain the promise on a stable global and poll
  // documentLoadState ourselves (mirrors run_unitree_browser_regression.mjs).
  await evaluateWithRetry(
    page,
    (fileName) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      window.__batchLoadState = { fileName, loaded: null };
      window.__batchLoadPromise = api
        .loadRobotByName(fileName)
        .then((r) => {
          if (window.__batchLoadState?.fileName === fileName) {
            window.__batchLoadState.loaded = r?.loaded === true;
          }
        })
        .catch(() => {
          if (window.__batchLoadState?.fileName === fileName) {
            window.__batchLoadState.loaded = false;
          }
        });
    },
    primaryName,
  );

  // Wait for the runtime + a STABLE visual-mesh set so we don't capture a
  // partially-mounted model. Uses the full per-asset load timeout (not a short
  // fixed 20s deadline) so large/external-mesh assets under swiftshader get
  // enough time; warns and captures as-is if still unsettled at the deadline.
  const stable = await waitForSceneStable(page, loadTimeoutMs);
  if (!stable.ok) {
    return { ok: false, reason: stable.reason };
  }
  if (stable.proceededAnyway) {
    console.log(`[batch]   WARN ${asset.dirName}: ${stable.reason}`);
  }

  // Brief settle for camera/environment after the scene stabilizes.
  await sleep(800);

  // Force-frame onto the robot's bounding box. cameraFollowPrimary does not
  // converge for every asset (notably Gazebo SDF models), so without this the
  // robot can render off-frame and the thumbnail comes out blank.
  // frameScene also returns a synchronous workspace-camera snapshot (captured
  // in the same tick, before any animation frame). We pass that snapshot to
  // captureSnapshot as `cameraSnapshot` so the framing is written directly to
  // the off-screen capture camera — otherwise cameraFollowPrimary's per-frame
  // update reverts frameScene during the capture warmup frames and the robot
  // sinks to the bottom of the frame (the irobot_hand symptom under studio bg).
  const framed = await evaluateWithRetry(page, () =>
    window.__URDF_STUDIO_DEBUG__?.frameScene?.(),
  );

  // Optional dolly zoom on top of the framed camera. Applied after frameScene
  // so it tightens the converged framing rather than fighting it. Mirrored onto
  // the camera snapshot below so the off-screen capture reflects it.
  if (captureOpts.__zoom) {
    await evaluateWithRetry(
      page,
      (zoom) => {
        window.__URDF_STUDIO_DEBUG__?.setCameraZoom?.(zoom);
      },
      captureOpts.__zoom,
    );
  }

  // Fold the zoom into the camera snapshot, replicating setCameraZoom's
  // position.lerp(target, 1 - 1/factor). The snapshot drives the capture
  // camera, so the zoom must live on it (not just the live workspace camera).
  const cameraSnapshot = applyZoomToCameraSnapshot(
    framed?.cameraSnapshot ?? null,
    captureOpts.__zoom,
  );

  // Capture via SnapshotManager's preview pipeline (off-screen render target,
  // supersampling, background fill). Passing cameraSnapshot locks frameScene's
  // framing onto the capture camera, immune to the per-frame auto-frame.
  const shot = await evaluateWithRetry(
    page,
    (opts) => window.__URDF_STUDIO_DEBUG__.captureSnapshot(opts),
    { ...stripInternalOpts(captureOpts), cameraSnapshot },
  );
  if (!shot?.ok || !shot.base64) {
    return { ok: false, reason: "captureSnapshot returned no data" };
  }
  return { ok: true, shot };
}

// Replicate AppLayout setCameraZoom's `position.lerp(target, 1 - 1/factor)` on
// a serialized camera snapshot, so an off-screen capture driven by the
// snapshot honours --zoom without depending on the (auto-frame-revertible)
// live workspace camera.
function applyZoomToCameraSnapshot(snapshot, zoom) {
  if (!snapshot || !Number.isFinite(zoom) || zoom <= 0) {
    return snapshot ?? null;
  }
  const { position: p, target: t } = snapshot;
  const lerpT = 1 - 1 / zoom;
  return {
    ...snapshot,
    position: {
      x: p.x + (t.x - p.x) * lerpT,
      y: p.y + (t.y - p.y) * lerpT,
      z: p.z + (t.z - p.z) * lerpT,
    },
  };
}

function stripInternalOpts(opts) {
  const { __zoom, ...rest } = opts;
  return rest;
}

// --- Main ----------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const inputDir = resolve(args.input);
  const outDir = resolve(args.output);
  console.log("[batch] input:", inputDir);
  console.log("[batch] output:", outDir);

  // Scan asset sub-directories, excluding the output directory if it happens
  // to live inside the input root (avoids treating generated thumbnails as an
  // asset on a re-run).
  const assets = scanAssetDirs(inputDir).filter((a) => resolve(a.dirPath) !== outDir);
  if (assets.length === 0) {
    console.error(`[batch] no asset sub-directories with model files found under ${inputDir}`);
    process.exit(1);
  }
  console.log(`[batch] found ${assets.length} asset(s):`);
  assets.forEach((a, i) => console.log(`[batch]   [${i + 1}] ${a.dirName} → ${a.primaryFile}`));
  await mkdir(outDir, { recursive: true });

  console.log("[batch] starting vite dev server...");
  const server = await createServer({
    mode: "dev",
    root: ROOT,
    configFile: resolve(ROOT, "vite.config.ts"),
    server: { port: args.port, host: "127.0.0.1", strictPort: true },
    logLevel: "error",
  });
  await server.listen();
  const url = `http://127.0.0.1:${args.port}`;
  console.log(`[batch] vite ready at ${url}`);
  await warmUp(url, 120000);

  // Headless chromium's canvas.toBlob('image/webp') under swiftshader
  // produces a blank image (the encoder reads no pixels), so transparently
  // fall back to jpeg — same small footprint — and warn. png/jpeg are fine.
  let effectiveFormat = args.format;
  if (args.format === "webp") {
    console.log(
      "[batch] NOTE: webp encoding is broken under headless chromium + swiftshader (blank output). Falling back to jpeg. Use --format png for lossless.",
    );
    effectiveFormat = "jpeg";
  }

  const captureOpts = {
    longEdgePx: args.longEdge,
    imageFormat: effectiveFormat,
    imageQuality: args.quality,
    detailLevel: args.detail,
    environmentPreset: args.environment,
    backgroundStyle: args.background,
    shadowStyle: args.shadow,
    groundStyle: args.ground,
    hideGrid: !args.grid,
    aspectRatioPreset: args.aspectRatio,
    // The snapshot preview path caps output at 800px long-edge for the dialog
    // preview; opt out so --long-edge actually controls export resolution.
    bypassPreviewResolutionCap: true,
    __zoom: args.zoom,
  };
  console.log(
    `[batch] capture opts: long-edge=${args.longEdge} format=${args.format} quality=${args.quality} detail=${args.detail} environment=${args.environment} background=${args.background} shadow=${args.shadow} ground=${args.ground} aspect=${args.aspectRatio} grid=${args.grid} zoom=${args.zoom || "off"}`,
  );

  let browser;
  let succeeded = 0;
  const failures = [];
  const t0 = Date.now();
  try {
    console.log(`[batch] launching chromium (headless=${!args.headed})...`);
    browser = await puppeteer.launch({
      headless: !args.headed,
      // loadRobotByName awaits a stable snapshot that can run for tens of
      // seconds on large models; the default 30s CDP protocolTimeout aborts
      // it. Match the in-repo regression script's 10-minute ceiling.
      protocolTimeout: 600_000,
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
      ],
    });
    console.log("[batch] exporting thumbnails (serial; fresh page per asset)...");
    for (const asset of assets) {
      const a0 = Date.now();
      // Fresh page per asset (closed in finally below): a single reused page
      // accumulates WASM workers / rendered geometry across navigations, and
      // after a handful of assets the browser is memory-pressured enough that
      // the next page.goto never reaches its load event (Navigation timeout
      // 120000 ms). A fresh page releases that state between assets.
      let page;
      try {
        page = await browser.newPage();
        // deviceScaleFactor drives window.devicePixelRatio, which the renderer
        // samples for its drawing buffer. Match the on-screen ~2x DPR so the
        // off-screen capture (which reads the live scene) stays crisp.
        await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
        page.on("pageerror", (e) => console.log("[pageerror]", e.message));
        page.on("console", (m) => {
          if (m.type() === "error") console.log("[browser:error]", m.text());
        });
        const result = await processAsset(
          page,
          asset,
          captureOpts,
          args.timeout * 1000,
          `${url}/?regressionDebug=1`,
          args.theme,
        );
        if (!result.ok) {
          console.log(`[batch]   FAILED ${asset.dirName}: ${result.reason} (${((Date.now() - a0) / 1000).toFixed(1)}s)`);
          failures.push({ name: asset.dirName, reason: result.reason });
          continue;
        }
        const { shot } = result;
        const ext = shot.format === "jpeg" ? "jpg" : shot.format;
        const outPath = join(outDir, `${asset.dirName}.${ext}`);
        await writeFile(outPath, Buffer.from(shot.base64, "base64"));
        succeeded++;
        console.log(
          `[batch]   wrote ${outPath} (${shot.width}x${shot.height}, ${((Date.now() - a0) / 1000).toFixed(1)}s)`,
        );
      } catch (e) {
        console.log(`[batch]   ERROR ${asset.dirName}: ${e?.message || e} (${((Date.now() - a0) / 1000).toFixed(1)}s)`);
        failures.push({ name: asset.dirName, reason: String(e?.message || e) });
      } finally {
        if (page) {
          try {
            await page.close();
          } catch {
            // best-effort cleanup
          }
        }
      }
    }

    console.log(`[batch] export pass complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`[batch] succeeded: ${succeeded}/${assets.length}`);
    if (failures.length) {
      console.log(`[batch] failures (${failures.length}):`);
      for (const f of failures) console.log(`[batch]   - ${f.name}: ${f.reason}`);
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
    console.log("[batch] done.");
  }

  if (failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[batch] FAILED:", e?.stack || e);
  process.exit(1);
});
