export type UsdLinkPathMaps = {
  linkPaths: Map<string, string>;
  childIdsByParent: Map<string, string[]>;
};

export type UsdPackageLayerContents = {
  rootLayerContent: string;
  baseLayerContent: string;
  physicsLayerContent: string;
  sensorLayerContent: string;
  robotLayerContent?: string;
};

export type UsdArchivePackage = {
  archiveFileName: string;
  rootLayerPath: string;
  archiveFiles: Map<string, Blob>;
};

export type UsdPackageLayoutProfile = 'legacy' | 'isaacsim' | 'genesis';
export type ResolvedUsdPackageLayoutProfile = 'legacy' | 'isaacsim';
export type UsdLayerFileFormat = 'usd' | 'usda';

export interface UsdPackageLayoutOptions {
  layoutProfile?: UsdPackageLayoutProfile;
  fileFormat?: UsdLayerFileFormat;
}