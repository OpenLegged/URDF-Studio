import type { RobotPrimitiveGeometryDetail } from '@/core/parsers/urdf/loader/primitiveGeometry';

export type ViewerRenderQuality = 'performance' | 'balanced' | 'high' | 'ultra';

export interface ViewerRenderQualityProfile {
  readonly primitiveGeometryDetail: RobotPrimitiveGeometryDetail;
  readonly minDpr: number;
  readonly maxDpr: number;
  readonly shadowMapSize: number;
  readonly textureAnisotropy: number;
  readonly materialDithering: boolean;
}

export const DEFAULT_VIEWER_RENDER_QUALITY: ViewerRenderQuality = 'high';

export const VIEWER_RENDER_QUALITY_PROFILES: Readonly<
  Record<ViewerRenderQuality, ViewerRenderQualityProfile>
> = {
  performance: {
    primitiveGeometryDetail: {
      cylinderRadialSegments: 48,
      sphereWidthSegments: 24,
      sphereHeightSegments: 16,
      capsuleCapSegments: 8,
      capsuleRadialSegments: 12,
    },
    minDpr: 1,
    maxDpr: 1.25,
    shadowMapSize: 512,
    textureAnisotropy: 1,
    materialDithering: false,
  },
  balanced: {
    primitiveGeometryDetail: {
      cylinderRadialSegments: 64,
      sphereWidthSegments: 32,
      sphereHeightSegments: 24,
      capsuleCapSegments: 10,
      capsuleRadialSegments: 16,
    },
    minDpr: 1.25,
    maxDpr: 1.5,
    shadowMapSize: 1024,
    textureAnisotropy: 4,
    materialDithering: true,
  },
  high: {
    primitiveGeometryDetail: {
      cylinderRadialSegments: 96,
      sphereWidthSegments: 48,
      sphereHeightSegments: 32,
      capsuleCapSegments: 12,
      capsuleRadialSegments: 24,
    },
    minDpr: 1.75,
    maxDpr: 2,
    shadowMapSize: 1536,
    textureAnisotropy: 8,
    materialDithering: true,
  },
  ultra: {
    primitiveGeometryDetail: {
      cylinderRadialSegments: 128,
      sphereWidthSegments: 64,
      sphereHeightSegments: 48,
      capsuleCapSegments: 16,
      capsuleRadialSegments: 32,
    },
    minDpr: 2,
    maxDpr: 2.5,
    shadowMapSize: 2048,
    textureAnisotropy: 16,
    materialDithering: true,
  },
};

export function normalizeViewerRenderQuality(value: unknown): ViewerRenderQuality {
  return value === 'performance' || value === 'balanced' || value === 'ultra'
    ? value
    : DEFAULT_VIEWER_RENDER_QUALITY;
}
