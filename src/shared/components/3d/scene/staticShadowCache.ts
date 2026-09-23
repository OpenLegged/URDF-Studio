import * as THREE from 'three';

type ShadowRenderer = Pick<THREE.WebGLRenderer, 'shadowMap' | 'localClippingEnabled' | 'clippingPlanes'>;
type Dependency = object | number | boolean | string;
type DependencyList = Array<Dependency | null | undefined>;
const defaultDirectionalShadow = new THREE.DirectionalLight().shadow;
const directionalShadowPrototype = Reflect.getPrototypeOf(defaultDirectionalShadow);

function appendMatrix(values: DependencyList, matrix: THREE.Matrix4): void {
  for (const value of matrix.elements) values.push(value);
}

function appendAttribute(
  values: DependencyList,
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null,
): boolean {
  values.push(attribute);
  if (!attribute) return true;
  if (attribute instanceof THREE.InterleavedBufferAttribute) {
    values.push(attribute.data, attribute.data.version, attribute.offset);
  } else if (attribute instanceof THREE.BufferAttribute) {
    values.push(attribute.version);
  } else {
    // Externally managed GL buffers can change without an attribute version.
    return false;
  }
  values.push(attribute.array, attribute.itemSize, attribute.count, attribute.normalized);
  return true;
}

function appendMaterial(values: DependencyList, material: THREE.Material): boolean {
  // Shader uniforms, animated alpha/displacement textures and local clipping
  // need their normal shadow pass. Only cache the ordinary rigid depth path.
  if (
    material instanceof THREE.ShaderMaterial ||
    ('displacementMap' in material && material.displacementMap) ||
    material.alphaToCoverage ||
    (material.alphaTest > 0 && (
      ('map' in material && material.map) || ('alphaMap' in material && material.alphaMap)
    )) ||
    (material.clipShadows && material.clippingPlanes?.length)
  ) return false;

  values.push(
    material.visible, material.side, material.shadowSide,
    material.alphaTest, material.opacity, material.transparent,
    material.depthTest, material.depthWrite, material.colorWrite,
    'wireframe' in material ? Boolean(material.wireframe) : undefined,
    'wireframeLinewidth' in material && typeof material.wireframeLinewidth === 'number'
      ? material.wireframeLinewidth : undefined,
  );
  return true;
}

function appendLight(values: DependencyList, light: THREE.Light): boolean {
  if (!(light instanceof THREE.DirectionalLight)) return false;
  const shadow = light.shadow;
  if (
    Reflect.getPrototypeOf(shadow) !== directionalShadowPrototype ||
    shadow.updateMatrices !== defaultDirectionalShadow.updateMatrices ||
    shadow.getFrustum !== defaultDirectionalShadow.getFrustum ||
    shadow.getViewport !== defaultDirectionalShadow.getViewport ||
    shadow.getViewportCount !== defaultDirectionalShadow.getViewportCount ||
    shadow.getFrameExtents !== defaultDirectionalShadow.getFrameExtents ||
    !(shadow.camera instanceof THREE.OrthographicCamera)
  ) return false;
  values.push(
    light, light.visible, light.layers.mask, light.castShadow,
    shadow, shadow.autoUpdate, shadow.map, shadow.mapSize.x, shadow.mapSize.y,
    shadow.map?.width, shadow.map?.height, shadow.map?.texture,
    shadow.bias, shadow.normalBias, shadow.radius, shadow.blurSamples,
    shadow.camera.near, shadow.camera.far, shadow.camera.left, shadow.camera.right,
    shadow.camera.top, shadow.camera.bottom, shadow.camera.zoom,
    shadow.camera.up.x, shadow.camera.up.y, shadow.camera.up.z,
  );
  appendMatrix(values, light.matrixWorld);
  appendMatrix(values, light.target.matrixWorld);
  appendMatrix(values, shadow.camera.projectionMatrix);
  return true;
}

function appendGeometry(values: DependencyList, geometry: THREE.BufferGeometry): boolean {
  for (const attributes of Object.values(geometry.morphAttributes)) {
    if (attributes?.length) return false;
  }
  values.push(geometry, geometry.drawRange.start, geometry.drawRange.count);
  const sphere = geometry.boundingSphere;
  values.push(sphere?.center.x, sphere?.center.y, sphere?.center.z, sphere?.radius);
  if (!appendAttribute(values, geometry.index)) return false;
  for (const name in geometry.attributes) {
    values.push(name);
    if (!appendAttribute(values, geometry.attributes[name])) return false;
  }
  values.push(null, geometry.groups.length);
  for (const group of geometry.groups) values.push(group.start, group.count, group.materialIndex);
  return true;
}

function appendMesh(values: DependencyList, object: THREE.Object3D): boolean {
  if (
    !(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh ||
    object instanceof THREE.InstancedMesh || object instanceof THREE.BatchedMesh ||
    object.customDepthMaterial || object.customDistanceMaterial ||
    object.onBeforeShadow !== THREE.Object3D.prototype.onBeforeShadow ||
    object.onAfterShadow !== THREE.Object3D.prototype.onAfterShadow ||
    'boundingSphere' in object
  ) return false;
  values.push(object, object.frustumCulled);
  appendMatrix(values, object.matrixWorld);
  if (!appendGeometry(values, object.geometry)) return false;
  const materials = object.material;
  if (Array.isArray(materials)) {
    values.push(materials.length);
    for (const material of materials) if (!appendMaterial(values, material)) return false;
  } else {
    values.push(1);
    if (!appendMaterial(values, materials)) return false;
  }
  return true;
}

interface ShadowPass {
  renderer: ShadowRenderer;
  lights: THREE.Light[];
  scene: THREE.Scene;
  camera: THREE.Camera;
}

/** Collects only inputs to Three's ordinary rigid directional-light depth pass. */
function collectDependencies(values: DependencyList, { renderer, lights, scene, camera }: ShadowPass): boolean {
  values.length = 0;
  if (
    renderer.shadowMap.type === THREE.VSMShadowMap ||
    renderer.localClippingEnabled || renderer.clippingPlanes.length
  ) return false;
  values.push(scene, renderer.shadowMap.type, camera.layers.mask, lights.length);
  for (const light of lights) if (!appendLight(values, light)) return false;
  const visit = (object: THREE.Object3D): boolean => {
    if (!object.visible) return true;
    const drawable = object instanceof THREE.Mesh || object instanceof THREE.Line ||
      object instanceof THREE.Points;
    if (drawable && object.castShadow && object.layers.test(camera.layers)) {
      if (!appendMesh(values, object)) return false;
    }
    for (const child of object.children) if (!visit(child)) return false;
    return true;
  };
  return visit(scene);
}

interface ShadowCacheInstallation {
  owners: number;
  dispose: () => void;
}

const installations = new WeakMap<ShadowRenderer, ShadowCacheInstallation>();

/**
 * Shares unchanged rigid shadow maps across beauty renders. Runs after Three
 * updates world matrices, so imperative joint changes and async mesh arrivals
 * need no extra notification. Complex/deformed shadow paths retain autoUpdate.
 */
export function cacheStaticShadowMaps(renderer: ShadowRenderer): () => void {
  let installation = installations.get(renderer);
  if (!installation) {
    const shadowMap = renderer.shadowMap;
    const originalRender = shadowMap.render;
    const saved: DependencyList = [];
    const candidate: DependencyList = [];
    let valid = false;
    let active = true;
    const render: typeof shadowMap.render = (lights, scene, camera) => {
      // In particular, never inspect or cache the temporary scene visibility
      // used by an outline/GTAO pass while shadow updates are paused.
      if (!active || !shadowMap.enabled || lights.length === 0 ||
        (!shadowMap.autoUpdate && !shadowMap.needsUpdate)) {
        if (!shadowMap.enabled) {
          valid = false;
          saved.length = 0;
          candidate.length = 0;
        }
        originalRender.call(shadowMap, lights, scene, camera);
        return;
      }
      const pass = { renderer, lights, scene, camera };
      const cacheable = collectDependencies(candidate, pass);
      const forced = shadowMap.needsUpdate || lights.some((light) => light.shadow?.needsUpdate);
      if (cacheable && valid && !forced && candidate.length === saved.length &&
        candidate.every((value, index) => value === saved[index])) return;

      valid = false;
      saved.length = 0;
      if (!cacheable) candidate.length = 0;
      originalRender.call(shadowMap, lights, scene, camera);
      // Three may allocate a shadow target or compute geometry bounds during
      // the pass; retain the final inputs, never a partially rendered snapshot.
      if (cacheable) {
        valid = collectDependencies(saved, pass);
        if (!valid) saved.length = 0;
      }
    };
    shadowMap.render = render;
    installation = {
      owners: 0,
      dispose: () => {
        active = false;
        saved.length = 0;
        candidate.length = 0;
        if (shadowMap.render === render) shadowMap.render = originalRender;
      },
    };
    installations.set(renderer, installation);
  }
  installation.owners++;
  const ownedInstallation = installation;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ownedInstallation.owners--;
    if (ownedInstallation.owners === 0) {
      ownedInstallation.dispose();
      installations.delete(renderer);
    }
  };
}
