/**
 * Geometry and math-related types
 */

export type Vector3 = { x: number; y: number; z: number };
export type Euler = { r: number; p: number; y: number };
export type QuaternionXYZW = { x: number; y: number; z: number; w: number };
export type UrdfOrigin = { xyz: Vector3; rpy: Euler; quatXyzw?: QuaternionXYZW };

export enum GeometryType {
  BOX = 'box',
  PLANE = 'plane',
  CYLINDER = 'cylinder',
  SPHERE = 'sphere',
  ELLIPSOID = 'ellipsoid',
  CAPSULE = 'capsule',
  HFIELD = 'hfield',
  POLYLINE = 'polyline',
  SDF = 'sdf',
  MESH = 'mesh',
  NONE = 'none',
}

export interface GazeboMaterialPass {
  texture?: string;
  sceneBlend?: 'alpha_blend' | 'add' | 'modulate';
  depthWrite?: boolean;
  lighting?: boolean;
}

export type MjcfBuiltinTextureKind = 'checker' | 'flat' | 'gradient';

export type MjcfBuiltinCubeFace = 'right' | 'left' | 'up' | 'down' | 'front' | 'back';

/** Serializable MuJoCo-generated texture metadata retained by canonical RobotData. */
export interface MjcfBuiltinTexture {
  builtin: MjcfBuiltinTextureKind;
  type?: string;
  rgb1?: [number, number, number];
  rgb2?: [number, number, number];
  mark?: string;
  markrgb?: [number, number, number];
  width?: number;
  height?: number;
  cubeFace?: MjcfBuiltinCubeFace;
}

export interface UrdfVisualMaterial {
  name?: string;
  color?: string;
  colorRgba?: [number, number, number, number];
  texture?: string;
  textureRotation?: number;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  alphaTest?: number;
  passes?: GazeboMaterialPass[];
  textureRepeat?: [number, number];
  mjcfBuiltinTexture?: MjcfBuiltinTexture;
}

export interface UrdfVisualMeshMaterialGroup {
  meshKey: string;
  start: number;
  count: number;
  materialIndex: number;
}

export interface UrdfUsdMeshDescriptorRef {
  meshId?: string | null;
  sectionName?: string | null;
  resolvedPrimPath?: string | null;
  primType?: string | null;
  materialId?: string | null;
}

export interface MjcfHfieldAssetSize {
  radiusX: number;
  radiusY: number;
  elevationZ: number;
  baseZ: number;
}

export interface MjcfHfieldAsset {
  name?: string;
  file?: string;
  contentType?: string;
  nrow?: number;
  ncol?: number;
  size?: MjcfHfieldAssetSize;
  elevation?: number[];
}

export interface SdfHeightmapTexture {
  diffuse?: string;
  normal?: string;
  size?: number;
}

export interface SdfHeightmapBlend {
  minHeight: number;
  fadeDist: number;
}

export interface SdfHeightmap {
  uri: string;
  size: Vector3;
  pos: Vector3;
  textures: SdfHeightmapTexture[];
  blends: SdfHeightmapBlend[];
}

export interface MjcfMeshAsset {
  name?: string;
  file?: string;
  vertices?: number[];
  scale?: [number, number, number];
  refpos?: [number, number, number];
  refquat?: [number, number, number, number];
}

export interface UrdfVisual {
  name?: string;
  type: GeometryType;
  dimensions: Vector3; // Used variably based on type (x=radius, y=length for cylinder)
  color: string;
  materialSource?: 'inline' | 'named' | 'gazebo';
  authoredMaterials?: UrdfVisualMaterial[];
  meshMaterialGroups?: UrdfVisualMeshMaterialGroup[];
  doubleSided?: boolean; // Force visual mesh materials to render both sides.
  meshPath?: string; // For later detailed design
  usdMeshDescriptors?: UrdfUsdMeshDescriptorRef[];
  submeshName?: string; // SDF submesh name to select a specific named group from a shared mesh file
  submeshCenter?: boolean; // SDF submesh center flag — when true, re-center the extracted submesh to its own origin
  assetRef?: string; // MJCF-only asset reference (e.g. hfield name or sdf mesh asset)
  mjcfMesh?: MjcfMeshAsset;
  mjcfHfield?: MjcfHfieldAsset;
  sdfHeightmap?: SdfHeightmap;
  polylinePoints?: { x: number; y: number }[];
  polylineHeight?: number;
  origin: UrdfOrigin; // Offset relative to link frame
  verbose?: string;
  visible?: boolean;
}
