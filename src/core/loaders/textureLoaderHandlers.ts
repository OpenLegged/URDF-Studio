import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';

// Image formats the browser cannot decode natively (so a plain ImageLoader/TextureLoader
// would fail and leave the material un-textured / white). They need a dedicated decoder.
const TGA_EXTENSION_PATTERN = /\.tga(?:[?#].*)?$/i;
const HDR_EXTENSION_PATTERN = /\.hdr(?:[?#].*)?$/i;

// Register decoders so that any loader routed through this manager which consults
// `manager.getHandler(url)` — MTLLoader.MaterialCreator.loadTexture, GLTFLoader, etc. —
// can transparently load `.tga` / `.hdr` textures instead of failing on them.
//
// NOTE: some code paths (e.g. the Collada worker scene) call `new TextureLoader(manager)`
// directly and therefore bypass `getHandler`; those must use `loadManagedTexture` below.
export function registerManagedTextureHandlers(
  manager: THREE.LoadingManager,
): THREE.LoadingManager {
  manager.addHandler(TGA_EXTENSION_PATTERN, new TGALoader(manager));
  manager.addHandler(HDR_EXTENSION_PATTERN, new HDRLoader(manager));
  return manager;
}

// Load a texture, choosing the decoder from the source path's extension. Use this for code
// paths that bypass `manager.getHandler` and would otherwise hard-code `TextureLoader`.
// `extensionHintPath` carries the original asset path (with extension), while `requestUrl`
// is the possibly-resolved blob URL to actually fetch (blob URLs have no extension, so the
// decoder must be chosen from the hint path, not the request URL).
export function loadManagedTexture(
  extensionHintPath: string,
  requestUrl: string,
  manager?: THREE.LoadingManager,
): THREE.Texture {
  if (TGA_EXTENSION_PATTERN.test(extensionHintPath)) {
    return new TGALoader(manager).load(requestUrl);
  }
  if (HDR_EXTENSION_PATTERN.test(extensionHintPath)) {
    return new HDRLoader(manager).load(requestUrl);
  }
  return new THREE.TextureLoader(manager).load(requestUrl);
}
