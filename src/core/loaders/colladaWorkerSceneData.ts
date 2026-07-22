import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

import { ensureWorkerXmlDomApis } from '@/core/utils/ensureWorkerXmlDomApis';

import { normalizeColladaUpAxis } from './colladaUpAxis';
import { loadManagedTexture } from './textureLoaderHandlers';
import {
  durationMs,
  markMainThreadBuildPerformance,
  type MeshLoadPerformanceEntry,
  readHighResolutionEpochMs,
} from './meshLoadPerformance';

export interface SerializedJsonColladaSceneData {
  kind?: 'object-json';
  loadPerformance?: MeshLoadPerformanceEntry;
  resourcePath: string;
  sceneJson: Record<string, unknown>;
  unitScale?: number | null;
}

export interface SerializedColladaAttributeData {
  array: ArrayBuffer;
  byteLength?: number;
  byteOffset?: number;
  itemSize: number;
}

export interface SerializedColladaGeometryGroup {
  count: number;
  materialIndex: number;
  start: number;
}

export interface SerializedFastColladaMaterialData {
  color: number;
  doubleSided?: boolean;
  emissive?: number;
  emissiveMap?: string;
  lightMap?: string;
  map?: string;
  model?: string;
  name: string;
  normalMap?: string;
  opacity: number;
  specular?: number;
  specularMap?: string;
  shininess?: number;
  transparent?: boolean;
}

export interface SerializedFastColladaNodeData {
  geometry: {
    groups: SerializedColladaGeometryGroup[];
    color?: SerializedColladaAttributeData;
    normal?: SerializedColladaAttributeData;
    position: SerializedColladaAttributeData;
    uv?: SerializedColladaAttributeData;
    uv1?: SerializedColladaAttributeData;
  };
  materials: SerializedFastColladaMaterialData[];
  matrix: number[];
  name: string;
  primitiveKind?: 'lines' | 'linestrips' | 'mesh';
}

export interface SerializedFastColladaSceneData {
  kind: 'fast-mesh-v1';
  resourcePath: string;
  children: SerializedFastColladaNodeData[];
  loadPerformance?: MeshLoadPerformanceEntry;
  unitScale?: number | null;
}

export type SerializedColladaSceneData =
  | SerializedJsonColladaSceneData
  | SerializedFastColladaSceneData;

interface SerializedSceneImageRecord {
  url?: string | string[];
  uuid?: string;
}

const EXTERNAL_IMAGE_URL_PATTERN = /^(\/\/)|([a-z]+:(\/\/)?)/i;
const COLLADA_UNIT_METER_PATTERN = /<unit\b[^>]*\bmeter=["']([^"']+)["'][^>]*>/i;

export function canSerializeColladaInWorker(_content: string): boolean {
  return true;
}

function parseColladaUnitScale(content: string): number | null {
  const match = content.match(COLLADA_UNIT_METER_PATTERN);
  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed === 1) {
    return null;
  }

  return parsed;
}

function captureTextureSourceUrls<T>(run: () => T): {
  capturedImageUrls: Map<string, string>;
  result: T;
} {
  const capturedImageUrls = new Map<string, string>();
  const originalTextureLoad = THREE.TextureLoader.prototype.load;

  THREE.TextureLoader.prototype.load = function patchedTextureLoad(
    url,
    onLoad,
    onProgress,
    onError,
  ) {
    const texture = originalTextureLoad.call(this, url, onLoad, onProgress, onError);
    capturedImageUrls.set(texture.source.uuid, url);
    return texture;
  };

  try {
    return {
      result: run(),
      capturedImageUrls,
    };
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad;
  }
}

function applyCapturedColladaImageUrls(
  sceneJson: Record<string, unknown>,
  capturedImageUrls: Map<string, string>,
): void {
  const images = sceneJson.images;
  if (!Array.isArray(images)) {
    return;
  }

  images.forEach((entry) => {
    const image = entry as SerializedSceneImageRecord;
    if (!image.uuid) {
      return;
    }

    const capturedUrl = capturedImageUrls.get(image.uuid);
    if (!capturedUrl) {
      return;
    }

    image.url = capturedUrl;
  });
}

/**
 * Three.js ColladaLoader has several places where it accesses `.textContent` on
 * the result of `getElementsByTagName(...)[0]` without null-checking the index.
 * Known crash sites in ColladaLoader.js:
 *   - line 1089: `getElementsByTagName(xml, 'init_from')[0].textContent`
 *   - line 3033: `child.getElementsByTagName('param')[0]` then `.textContent`
 *   - line 2788:  `child.getElementsByTagName('max')[0]` / `'min'`
 *
 * Use DOMParser to walk the tree and inject placeholder children where needed
 * so the ColladaLoader doesn't crash.
 */
function sanitizeColladaXmlForThreeJs(content: string): string {
  ensureWorkerXmlDomApis();

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'application/xml');

  // Check for parse errors
  const parserError = doc.getElementsByTagName('parsererror');
  if (parserError.length > 0) {
    console.error('[ColladaSanitize] XML parse error detected, skipping sanitization');
    return content;
  }

  let patched = false;

  const patchMissingChild = (
    parent: Element,
    childLocalName: string,
    placeholderValue: string,
  ): void => {
    const children = parent.childNodes;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.nodeType === 1 && child.nodeName === childLocalName) {
        return; // Child exists, no patch needed
      }
    }
    // Child not found — inject placeholder
    const placeholder = doc.createElement(childLocalName);
    placeholder.textContent = placeholderValue;
    parent.appendChild(placeholder);
    patched = true;
  };

  // Fix <image> elements missing <init_from>
  const images = doc.getElementsByTagName('image');
  for (let i = 0; i < images.length; i += 1) {
    patchMissingChild(images[i], 'init_from', '');
  }

  // Fix <limits> elements missing <max> or <min>
  const limits = doc.getElementsByTagName('limits');
  for (let i = 0; i < limits.length; i += 1) {
    patchMissingChild(limits[i], 'max', '0');
    patchMissingChild(limits[i], 'min', '0');
  }

  // Fix <axis> elements missing <param>
  const axes = doc.getElementsByTagName('axis');
  for (let i = 0; i < axes.length; i += 1) {
    patchMissingChild(axes[i], 'param', '');
  }

  if (!patched) {
    return content;
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
}

/**
 * Three.js ColladaLoader computes opacity as `color[3] * transparency.float`
 * with the default `A_ONE` opaque mode. When a COLLADA file has
 * `<transparency>0.0</transparency>` (meaning fully opaque), this yields
 * opacity 0 — making the mesh invisible. Gazebo and Blender exports often
 * omit the `opaque` attribute, defaulting to `A_ONE`.
 *
 * Correct the opacity when ColladaLoader produces a transparent material
 * with opacity 0 and no authored alpha map: this is a degenerate case where
 * the intended result is an opaque surface.
 */
function fixDegenerateColladaOpacity(scene: THREE.Object3D): void {
  scene.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    const materials: THREE.Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];

    materials.forEach((material) => {
      if (
        material.transparent &&
        material.opacity === 0 &&
        !(material as THREE.MeshPhongMaterial).alphaMap
      ) {
        material.transparent = false;
        material.opacity = 1;
      }
    });
  });
}

function stripColladaImagesWithoutInitFrom(content: string): string {
  const parser = new DOMParser();
  const xml = parser.parseFromString(content, 'application/xml');
  const imageNodes = Array.from(xml.getElementsByTagName('image'));
  const invalidImageIds = new Set<string>();
  let mutated = false;

  imageNodes.forEach((imageNode) => {
    const imageId = imageNode.getAttribute('id')?.trim();
    const hasConcreteInitFrom = Array.from(imageNode.getElementsByTagName('init_from')).some(
      (initFromNode) => Boolean(initFromNode.textContent?.trim()),
    );

    if (hasConcreteInitFrom) {
      return;
    }

    if (imageId) {
      invalidImageIds.add(imageId);
    }

    imageNode.parentNode?.removeChild(imageNode);
    mutated = true;
  });

  if (invalidImageIds.size > 0) {
    Array.from(xml.getElementsByTagName('effect')).forEach((effectNode) => {
      const profileNode = effectNode.getElementsByTagName('profile_COMMON')[0];
      if (!profileNode) {
        return;
      }

      const surfaceNodesBySid = new Map<string, Element>();
      const surfaceImageIdsBySid = new Map<string, string>();
      const samplerNodesBySid = new Map<string, Element>();
      const samplerSourceBySid = new Map<string, string>();

      Array.from(profileNode.getElementsByTagName('newparam')).forEach((newparamNode) => {
        const sid = newparamNode.getAttribute('sid')?.trim();
        if (!sid) {
          return;
        }

        const surfaceNode = newparamNode.getElementsByTagName('surface')[0];
        if (surfaceNode) {
          surfaceNodesBySid.set(sid, newparamNode);
          const initFrom = getTrimmedNodeText(surfaceNode, 'init_from');
          if (initFrom) {
            surfaceImageIdsBySid.set(sid, initFrom);
          }
        }

        const samplerNode = newparamNode.getElementsByTagName('sampler2D')[0];
        if (samplerNode) {
          samplerNodesBySid.set(sid, newparamNode);
          const source = getTrimmedNodeText(samplerNode, 'source');
          if (source) {
            samplerSourceBySid.set(sid, source);
          }
        }
      });

      const invalidSurfaceSids = new Set<string>();
      surfaceNodesBySid.forEach((_node, sid) => {
        const imageId = surfaceImageIdsBySid.get(sid);
        if (!imageId || invalidImageIds.has(imageId)) {
          invalidSurfaceSids.add(sid);
        }
      });

      const invalidSamplerSids = new Set<string>();
      samplerNodesBySid.forEach((_node, sid) => {
        const source = samplerSourceBySid.get(sid);
        if (!source || invalidSurfaceSids.has(source)) {
          invalidSamplerSids.add(sid);
        }
      });

      invalidSurfaceSids.forEach((sid) => {
        surfaceNodesBySid.get(sid)?.parentNode?.removeChild(surfaceNodesBySid.get(sid)!);
        mutated = true;
      });

      invalidSamplerSids.forEach((sid) => {
        samplerNodesBySid.get(sid)?.parentNode?.removeChild(samplerNodesBySid.get(sid)!);
        mutated = true;
      });

      Array.from(profileNode.getElementsByTagName('texture')).forEach((textureNode) => {
        const textureId = textureNode.getAttribute('texture')?.trim();
        if (
          textureId &&
          (invalidImageIds.has(textureId) ||
            invalidSurfaceSids.has(textureId) ||
            invalidSamplerSids.has(textureId))
        ) {
          textureNode.parentNode?.removeChild(textureNode);
          mutated = true;
        }
      });
    });
  }

  if (!mutated) {
    return content;
  }

  return new XMLSerializer().serializeToString(xml);
}

function getTrimmedNodeText(node: Element, tagName: string): string | null {
  return (
    Array.from(node.getElementsByTagName(tagName))
      .map((entry) => entry.textContent?.trim() ?? '')
      .find((value) => value.length > 0) ?? null
  );
}

function normalizeColladaTextureSamplerBindings(content: string): string {
  const parser = new DOMParser();
  const xml = parser.parseFromString(content, 'application/xml');
  const effectNodes = Array.from(xml.getElementsByTagName('effect'));
  let mutated = false;

  effectNodes.forEach((effectNode) => {
    const profileNode = effectNode.getElementsByTagName('profile_COMMON')[0];
    if (!profileNode) {
      return;
    }

    const surfaceInitFromBySid = new Map<string, string>();
    const samplerSourceBySid = new Map<string, string>();

    Array.from(profileNode.getElementsByTagName('newparam')).forEach((newparamNode) => {
      const sid = newparamNode.getAttribute('sid')?.trim();
      if (!sid) {
        return;
      }

      const surfaceNode = newparamNode.getElementsByTagName('surface')[0];
      if (surfaceNode) {
        const initFrom = getTrimmedNodeText(surfaceNode, 'init_from');
        if (initFrom) {
          surfaceInitFromBySid.set(sid, initFrom);
        }
      }

      const samplerNode = newparamNode.getElementsByTagName('sampler2D')[0];
      if (samplerNode) {
        const source = getTrimmedNodeText(samplerNode, 'source');
        if (source) {
          samplerSourceBySid.set(sid, source);
        }
      }
    });

    if (samplerSourceBySid.size === 0 || surfaceInitFromBySid.size === 0) {
      return;
    }

    const samplerIdsByImageId = new Map<string, string[]>();
    samplerSourceBySid.forEach((surfaceSid, samplerSid) => {
      const imageId = surfaceInitFromBySid.get(surfaceSid);
      if (!imageId) {
        return;
      }

      const samplerIds = samplerIdsByImageId.get(imageId) ?? [];
      samplerIds.push(samplerSid);
      samplerIdsByImageId.set(imageId, samplerIds);
    });

    Array.from(profileNode.getElementsByTagName('texture')).forEach((textureNode) => {
      const textureId = textureNode.getAttribute('texture')?.trim();
      if (!textureId || samplerSourceBySid.has(textureId)) {
        return;
      }

      const samplerIds = samplerIdsByImageId.get(textureId) ?? [];
      if (samplerIds.length === 0) {
        return;
      }

      const conventionalSamplerId = `${textureId}-sampler`;
      const nextTextureId =
        samplerIds.find((samplerId) => samplerId === conventionalSamplerId) ??
        (samplerIds.length === 1 ? samplerIds[0] : null);

      if (!nextTextureId || nextTextureId === textureId) {
        return;
      }

      textureNode.setAttribute('texture', nextTextureId);
      mutated = true;
    });
  });

  if (!mutated) {
    return content;
  }

  return new XMLSerializer().serializeToString(xml);
}

export function parseColladaSceneData(
  content: string,
  assetUrl: string,
): SerializedColladaSceneData {
  ensureWorkerXmlDomApis();
  const { content: upAxisNormalizedContent } = normalizeColladaUpAxis(content);
  const normalizedContent = normalizeColladaTextureSamplerBindings(
    stripColladaImagesWithoutInitFrom(upAxisNormalizedContent),
  );
  const sanitizedContent = sanitizeColladaXmlForThreeJs(normalizedContent);
  const loader = new ColladaLoader();
  const baseUrl = THREE.LoaderUtils.extractUrlBase(assetUrl);
  const { capturedImageUrls, result: scene } = captureTextureSourceUrls(
    () => {
      const collada = loader.parse(sanitizedContent, baseUrl);
      if (!collada) {
        throw new Error(`ColladaLoader returned no scene for ${assetUrl}`);
      }
      return collada.scene;
    },
  );
  fixDegenerateColladaOpacity(scene);
  const sceneJson = scene.toJSON() as unknown as Record<string, unknown>;
  applyCapturedColladaImageUrls(sceneJson, capturedImageUrls);

  return {
    kind: 'object-json',
    resourcePath: baseUrl,
    sceneJson,
    unitScale: parseColladaUnitScale(normalizedContent),
  };
}

function createFloat32Attribute(data: SerializedColladaAttributeData): THREE.Float32BufferAttribute {
  const byteOffset = data.byteOffset ?? 0;
  const byteLength = data.byteLength ?? data.array.byteLength - byteOffset;
  return new THREE.Float32BufferAttribute(
    new Float32Array(data.array, byteOffset, byteLength / Float32Array.BYTES_PER_ELEMENT),
    data.itemSize,
  );
}

function createFastColladaTexture(
  texturePath: string | undefined,
  resourcePath: string,
  manager: THREE.LoadingManager | undefined,
  colorSpace?: THREE.ColorSpace,
): THREE.Texture | null {
  if (!texturePath) {
    return null;
  }

  ensureWorkerXmlDomApis();
  // Choose the decoder from the original texture path's extension (.tga/.hdr need
  // dedicated loaders); the resolved request URL may be an extension-less blob URL. This
  // worker path bypasses manager.getHandler, so registered handlers do not apply here.
  const texture = loadManagedTexture(
    texturePath,
    resolveSerializedColladaImageUrl(texturePath, resourcePath, manager),
    manager,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (colorSpace) {
    texture.colorSpace = colorSpace;
  }
  return texture;
}

function createFastColladaMaterial(
  entry: SerializedFastColladaMaterialData,
  data: SerializedFastColladaSceneData,
  options: { manager?: THREE.LoadingManager },
  hasVertexColors: boolean,
  primitiveKind: SerializedFastColladaNodeData['primitiveKind'],
): THREE.Material {
  const common = {
    color: entry.color,
    opacity: entry.opacity,
    side: entry.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    transparent: entry.transparent === true || entry.opacity < 1,
    vertexColors: hasVertexColors,
  };
  if (primitiveKind === 'lines' || primitiveKind === 'linestrips') {
    const lineMaterial = new THREE.LineBasicMaterial(common);
    lineMaterial.name = entry.name;
    return lineMaterial;
  }

  const model = entry.model ?? 'phong';
  let material: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;
  if (model === 'constant') {
    material = new THREE.MeshBasicMaterial(common);
  } else if (model === 'lambert') {
    material = new THREE.MeshLambertMaterial(common);
  } else {
    material = new THREE.MeshPhongMaterial({
      ...common,
      emissive: entry.emissive ?? 0x000000,
      shininess: entry.shininess ?? 30,
      specular: entry.specular ?? 0x111111,
    });
  }

  material.name = entry.name;
  material.map = createFastColladaTexture(
    entry.map,
    data.resourcePath,
    options.manager,
    THREE.SRGBColorSpace,
  );

  if ('normalMap' in material) {
    material.normalMap = createFastColladaTexture(
      entry.normalMap,
      data.resourcePath,
      options.manager,
    );
    if (material.normalMap) {
      material.normalScale = new THREE.Vector2(1, 1);
    }
  }
  if ('specularMap' in material) {
    material.specularMap = createFastColladaTexture(
      entry.specularMap,
      data.resourcePath,
      options.manager,
    );
  }
  if ('emissiveMap' in material) {
    material.emissiveMap = createFastColladaTexture(
      entry.emissiveMap,
      data.resourcePath,
      options.manager,
      THREE.SRGBColorSpace,
    );
  }
  if ('lightMap' in material) {
    material.lightMap = createFastColladaTexture(
      entry.lightMap,
      data.resourcePath,
      options.manager,
      THREE.SRGBColorSpace,
    );
  }

  return material;
}

function createFastColladaScene(
  data: SerializedFastColladaSceneData,
  options: { manager?: THREE.LoadingManager } = {},
): THREE.Object3D {
  const scene = new THREE.Group();

  data.children.forEach((child) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', createFloat32Attribute(child.geometry.position));
    if (child.geometry.normal) {
      geometry.setAttribute('normal', createFloat32Attribute(child.geometry.normal));
    }
    if (child.geometry.uv) {
      geometry.setAttribute('uv', createFloat32Attribute(child.geometry.uv));
    }
    if (child.geometry.uv1) {
      geometry.setAttribute('uv1', createFloat32Attribute(child.geometry.uv1));
    }
    if (child.geometry.color) {
      geometry.setAttribute('color', createFloat32Attribute(child.geometry.color));
    }
    child.geometry.groups.forEach((group) => {
      geometry.addGroup(group.start, group.count, group.materialIndex);
    });

    const materials = child.materials.map((entry) =>
      createFastColladaMaterial(
        entry,
        data,
        options,
        Boolean(child.geometry.color),
        child.primitiveKind ?? 'mesh',
      ),
    );

    const object =
      child.primitiveKind === 'lines'
        ? new THREE.LineSegments(geometry, materials.length > 1 ? materials : materials[0])
        : child.primitiveKind === 'linestrips'
          ? new THREE.Line(geometry, materials.length > 1 ? materials : materials[0])
          : new THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0]);
    object.name = child.name;
    if (child.matrix.length === 16) {
      object.matrix.set(
        child.matrix[0] ?? 1,
        child.matrix[1] ?? 0,
        child.matrix[2] ?? 0,
        child.matrix[3] ?? 0,
        child.matrix[4] ?? 0,
        child.matrix[5] ?? 1,
        child.matrix[6] ?? 0,
        child.matrix[7] ?? 0,
        child.matrix[8] ?? 0,
        child.matrix[9] ?? 0,
        child.matrix[10] ?? 1,
        child.matrix[11] ?? 0,
        child.matrix[12] ?? 0,
        child.matrix[13] ?? 0,
        child.matrix[14] ?? 0,
        child.matrix[15] ?? 1,
      );
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      object.updateMatrix();
    }
    scene.add(object);
  });

  if (data.unitScale && data.unitScale > 0 && data.unitScale !== 1) {
    scene.scale.multiplyScalar(data.unitScale);
  }

  scene.userData = {
    ...(scene.userData ?? {}),
    colladaUnitScale: data.unitScale ?? null,
    colladaFastMesh: true,
  };

  return scene;
}

export function createSceneFromSerializedColladaData(
  data: SerializedColladaSceneData,
  options: { manager?: THREE.LoadingManager } = {},
): THREE.Object3D {
  const startedAt = readHighResolutionEpochMs();
  let scene: THREE.Object3D;
  if (data.kind === 'fast-mesh-v1') {
    scene = createFastColladaScene(data, options);
  } else {
    ensureWorkerXmlDomApis();
    const objectLoader = new THREE.ObjectLoader(options.manager);
    objectLoader.setResourcePath(data.resourcePath);
    const sceneJson = resolveSerializedColladaImageUrls(data, options.manager);
    scene = objectLoader.parse(sceneJson);

    if (data.unitScale && data.unitScale > 0 && data.unitScale !== 1) {
      scene.scale.multiplyScalar(data.unitScale);
    }

    scene.userData = {
      ...(scene.userData ?? {}),
      colladaUnitScale: data.unitScale ?? null,
    };
  }

  markMainThreadBuildPerformance(data.loadPerformance, durationMs(startedAt));
  if (data.loadPerformance) {
    scene.userData = {
      ...(scene.userData ?? {}),
      meshLoadPerformance: data.loadPerformance,
    };
  }

  return scene;
}

function resolveSerializedColladaImageUrl(
  url: string,
  resourcePath: string,
  manager?: THREE.LoadingManager,
): string {
  const resourceUrl = EXTERNAL_IMAGE_URL_PATTERN.test(url) ? url : `${resourcePath}${url}`;

  if (typeof manager?.resolveURL === 'function') {
    return manager.resolveURL(resourceUrl);
  }

  return resourceUrl;
}

function resolveSerializedColladaImageUrls(
  data: SerializedJsonColladaSceneData,
  manager?: THREE.LoadingManager,
): Record<string, unknown> {
  const images = Array.isArray(data.sceneJson.images)
    ? (data.sceneJson.images as SerializedSceneImageRecord[])
    : null;

  if (!images || images.length === 0) {
    return data.sceneJson;
  }

  const resolvedImages = images.map((image) => {
    if (typeof image.url === 'string') {
      return {
        ...image,
        url: resolveSerializedColladaImageUrl(image.url, data.resourcePath, manager),
      };
    }

    if (Array.isArray(image.url)) {
      return {
        ...image,
        url: image.url.map((entry) =>
          typeof entry === 'string'
            ? resolveSerializedColladaImageUrl(entry, data.resourcePath, manager)
            : entry,
        ),
      };
    }

    return image;
  });

  return {
    ...data.sceneJson,
    images: resolvedImages,
  };
}

export function collectSerializedColladaTransferables(
  data: SerializedColladaSceneData,
): ArrayBuffer[] {
  if (data.kind !== 'fast-mesh-v1') {
    return [];
  }

  const transferables = new Set<ArrayBuffer>();
  data.children.forEach((child) => {
    transferables.add(child.geometry.position.array);
    if (child.geometry.normal) {
      transferables.add(child.geometry.normal.array);
    }
    if (child.geometry.uv) {
      transferables.add(child.geometry.uv.array);
    }
    if (child.geometry.uv1) {
      transferables.add(child.geometry.uv1.array);
    }
    if (child.geometry.color) {
      transferables.add(child.geometry.color.array);
    }
  });
  return Array.from(transferables);
}
