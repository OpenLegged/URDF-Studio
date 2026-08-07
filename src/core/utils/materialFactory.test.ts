import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createMatteMaterial, MATERIAL_CONFIG } from './materialFactory.ts';

function assertColorClose(actual: THREE.Color, expected: THREE.Color, epsilon = 1e-6): void {
  assert.ok(
    Math.abs(actual.r - expected.r) <= epsilon,
    `expected r=${actual.r} to be close to ${expected.r}`,
  );
  assert.ok(
    Math.abs(actual.g - expected.g) <= epsilon,
    `expected g=${actual.g} to be close to ${expected.g}`,
  );
  assert.ok(
    Math.abs(actual.b - expected.b) <= epsilon,
    `expected b=${actual.b} to be close to ${expected.b}`,
  );
}

test('createMatteMaterial applies the shared matte defaults', () => {
  const material = createMatteMaterial({
    color: 0x336699,
    opacity: 0.42,
    transparent: true,
    side: THREE.FrontSide,
  });

  assert.equal(material.roughness, MATERIAL_CONFIG.roughness);
  assert.equal(material.metalness, MATERIAL_CONFIG.metalness);
  assert.equal(material.envMapIntensity, MATERIAL_CONFIG.envMapIntensity);
  assert.equal(material.opacity, 0.42);
  assert.equal(material.transparent, true);
  assert.equal(material.side, THREE.FrontSide);
  assertColorClose(material.color, new THREE.Color(0x336699));
});

test('createMatteMaterial softens non-authored pure white by default', () => {
  const material = createMatteMaterial({ color: 0xffffff });

  assertColorClose(material.color, new THREE.Color(0.93, 0.93, 0.93));
  assert.ok(material.envMapIntensity < MATERIAL_CONFIG.envMapIntensity);
});

test('createMatteMaterial preserves authored pure white without dimming its PBR base color', () => {
  const material = createMatteMaterial({
    color: 0xffffff,
    preserveExactColor: true,
  });

  assertColorClose(material.color, new THREE.Color(0xffffff));
  assert.equal(material.toneMapped, false);
  assert.equal(material.envMapIntensity, 0.46);
});

test('createMatteMaterial preserves texture-backed neutral white bases', () => {
  const texture = new THREE.Texture();
  const material = createMatteMaterial({
    color: 0xffffff,
    map: texture,
    preserveExactColor: true,
  });

  assertColorClose(material.color, new THREE.Color(0xffffff));
  assert.equal(material.map, texture);
  assert.equal(material.toneMapped, false);
});

test('createMatteMaterial uses a softer high-roughness preset for rubber-like material names', () => {
  const material = createMatteMaterial({
    color: '#1f1f1f',
    name: 'dark-rubber',
  });

  assert.equal(material.userData.materialPreset, 'rubber');
  assert.equal(material.roughness, 0.82);
  assert.equal(material.metalness, 0.01);
  assert.equal(material.envMapIntensity, 0.16);
});

test('createMatteMaterial uses a more reflective preset for metal-like material names', () => {
  const material = createMatteMaterial({
    color: '#8a8f96',
    name: 'aluminum_bracket',
  });

  assert.equal(material.userData.materialPreset, 'metal');
  assert.equal(material.roughness, 0.38);
  assert.equal(material.metalness, 0.48);
  assert.equal(material.envMapIntensity, 0.64);
});

test('createMatteMaterial uses a coated shell preset for body panels', () => {
  const material = createMatteMaterial({
    color: '#f2f4f7',
    name: 'outer_shell',
  });

  assert.equal(material.userData.materialPreset, 'coated');
  assert.equal(material.roughness, 0.64);
  assert.equal(material.metalness, 0.05);
  assert.equal(
    material.envMapIntensity,
    0.46 * MATERIAL_CONFIG.whiteEnvMapIntensityMultiplier,
  );
});

test('createMatteMaterial infers a coated preset from unnamed near-white shell colors', () => {
  const material = createMatteMaterial({
    color: '#f2f4f7',
  });

  assert.equal(material.userData.materialPreset, 'coated');
  assert.equal(material.roughness, 0.64);
  assert.equal(material.metalness, 0.05);
});

test('createMatteMaterial infers a rubber preset from unnamed dark neutral colors', () => {
  const material = createMatteMaterial({
    color: '#1f2328',
  });

  assert.equal(material.userData.materialPreset, 'rubber');
  assert.equal(material.roughness, 0.82);
  assert.equal(material.metalness, 0.01);
});

test('createMatteMaterial keeps saturated accent colors on the default preset when no name hint exists', () => {
  const material = createMatteMaterial({
    color: '#ff6c0a',
  });

  assert.equal(material.userData.materialPreset, 'default');
  assert.equal(material.roughness, MATERIAL_CONFIG.roughness);
  assert.equal(material.metalness, MATERIAL_CONFIG.metalness);
});

test('createMatteMaterial derives opacity from 8-digit hex colors without changing the authored rgb channels', () => {
  const material = createMatteMaterial({
    color: '#12345680',
    preserveExactColor: true,
  });

  assertColorClose(material.color, new THREE.Color('#123456'));
  assert.ok(Math.abs(material.opacity - 128 / 255) <= 1e-6);
  assert.equal(material.transparent, true);
  assert.equal(material.toneMapped, false);
});

test('createMatteMaterial applies explicit PBR overrides over inferred presets', () => {
  const material = createMatteMaterial({
    color: '#8a8f96',
    name: 'aluminum_bracket',
    roughness: 0.9,
    metalness: 0.2,
    emissive: '#224466',
    emissiveIntensity: 1.4,
  });

  assert.equal(material.userData.materialPreset, 'metal');
  assert.equal(material.roughness, 0.9);
  assert.equal(material.metalness, 0.2);
  assert.ok(Math.abs(material.emissiveIntensity - 1.4) <= 1e-6);
  assertColorClose(material.emissive, new THREE.Color('#224466'));
});
