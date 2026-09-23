import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadUsdTextureSlot } from './usdTextureLoader';

test('USD texture slots share image loads while retaining independent sampling state', async () => {
  const originalLoadAsync = THREE.TextureLoader.prototype.loadAsync;
  let loads = 0;
  THREE.TextureLoader.prototype.loadAsync = async () => {
    loads += 1;
    return new THREE.Texture();
  };
  try {
    const cache = new Map<string, Promise<THREE.Texture>>();
    const url = 'blob:chair-fabric';
    const load = (sourceUrl: string) => new THREE.TextureLoader().loadAsync(sourceUrl);
    const firstTransform = [39.37008, 0, 0, 0, 39.37008, 0, 0, 0, 1];
    const secondTransform = [66.666664, 0, 0, 0, 66.666664, 0, 0, 0, 1];
    const first = await loadUsdTextureSlot(url, 'mapPath', {
      uvTransform: firstTransform, wrapS: 'repeat', wrapT: 'repeat',
    }, cache, load);
    const second = await loadUsdTextureSlot(url, 'mapPath', {
      uvTransform: secondTransform, wrapS: 'repeat', wrapT: 'repeat',
    }, cache, load);
    const normal = await loadUsdTextureSlot(url, 'normalMapPath', null, cache, load);

    assert.equal(loads, 2);
    assert.notEqual(first, second);
    assert.equal(first.source, second.source);
    assert.notEqual(first.source, normal.source);
    assert.equal(first.flipY, true);
    assert.equal(normal.flipY, true);
    assert.equal(first.colorSpace, THREE.SRGBColorSpace);
    assert.equal(normal.colorSpace, THREE.NoColorSpace);
    assert.equal(first.wrapS, THREE.RepeatWrapping);
    assert.equal(first.wrapT, THREE.RepeatWrapping);
    assert.deepEqual(first.matrix.toArray(), firstTransform);
    assert.deepEqual(second.matrix.toArray(), secondTransform);
  } finally {
    THREE.TextureLoader.prototype.loadAsync = originalLoadAsync;
  }
});
