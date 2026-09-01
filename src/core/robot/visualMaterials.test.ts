import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveVisualMaterialOverride } from './visualMaterials';

test('resolveVisualMaterialOverride preserves link-level USD shader data', () => {
  const usdMaterial = {
    materialId: '/Looks/Stove070_door_Clear',
    isOmniGlass: true,
    opacity: 0.8,
    transmission: 1,
    ior: 1.491,
  };

  const resolved = resolveVisualMaterialOverride(
    {
      materials: {
        door: {
          color: '#888888',
          usdMaterial,
        },
      },
    },
    { id: 'door', name: 'door' },
    { color: '#808080' },
  );

  assert.equal(resolved.source, 'legacy-link');
  assert.equal(resolved.color, '#888888');
  assert.deepEqual(resolved.usdMaterial, usdMaterial);
  assert.notEqual(resolved.usdMaterial, usdMaterial);
});
