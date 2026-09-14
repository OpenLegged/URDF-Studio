export type RendererUrdfXmlFallbackSourceFormat =
  | 'auto'
  | 'urdf'
  | 'mjcf'
  | 'sdf'
  | 'usd'
  | 'usda'
  | 'xacro'
  | 'mesh';

interface ResolveUrdfXmlFallbackPolicyArgs {
  resolvedSourceFormat: RendererUrdfXmlFallbackSourceFormat;
  hasStructuredRobotState: boolean;
  allowUrdfXmlFallback: boolean;
}

export function shouldWaitForStructuredUrdfRobotState({
  resolvedSourceFormat,
  hasStructuredRobotState,
  allowUrdfXmlFallback,
}: ResolveUrdfXmlFallbackPolicyArgs): boolean {
  return resolvedSourceFormat === 'urdf' && !hasStructuredRobotState && !allowUrdfXmlFallback;
}
