import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_VIEWER_RENDER_QUALITY,
  normalizeViewerRenderQuality,
  VIEWER_RENDER_QUALITY_PROFILES,
} from './viewerRenderQuality';

test('viewer render quality profiles increase geometry and raster detail monotonically', () => {
  const profiles = [
    VIEWER_RENDER_QUALITY_PROFILES.performance,
    VIEWER_RENDER_QUALITY_PROFILES.balanced,
    VIEWER_RENDER_QUALITY_PROFILES.high,
    VIEWER_RENDER_QUALITY_PROFILES.ultra,
  ];

  for (let index = 1; index < profiles.length; index += 1) {
    const previous = profiles[index - 1]!;
    const current = profiles[index]!;
    assert.ok(
      current.primitiveGeometryDetail.cylinderRadialSegments >
        previous.primitiveGeometryDetail.cylinderRadialSegments,
    );
    assert.ok(
      current.primitiveGeometryDetail.sphereWidthSegments >
        previous.primitiveGeometryDetail.sphereWidthSegments,
    );
    assert.ok(
      current.primitiveGeometryDetail.sphereHeightSegments >
        previous.primitiveGeometryDetail.sphereHeightSegments,
    );
    assert.ok(
      current.primitiveGeometryDetail.capsuleCapSegments >
        previous.primitiveGeometryDetail.capsuleCapSegments,
    );
    assert.ok(
      current.primitiveGeometryDetail.capsuleRadialSegments >
        previous.primitiveGeometryDetail.capsuleRadialSegments,
    );
    assert.ok(current.minDpr > previous.minDpr);
    assert.ok(current.maxDpr > previous.maxDpr);
    assert.ok(current.shadowMapSize > previous.shadowMapSize);
    assert.ok(current.textureAnisotropy > previous.textureAnisotropy);
  }
  assert.equal(VIEWER_RENDER_QUALITY_PROFILES.performance.materialDithering, false);
  assert.equal(VIEWER_RENDER_QUALITY_PROFILES.high.materialDithering, true);
});

test('viewer render quality normalization keeps persisted values inside supported tiers', () => {
  assert.equal(normalizeViewerRenderQuality('ultra'), 'ultra');
  assert.equal(normalizeViewerRenderQuality('unsupported'), DEFAULT_VIEWER_RENDER_QUALITY);
  assert.equal(normalizeViewerRenderQuality(undefined), DEFAULT_VIEWER_RENDER_QUALITY);
});
