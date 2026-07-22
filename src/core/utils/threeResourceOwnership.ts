interface ThreeResourceWithUserData {
  userData: Record<string, unknown>;
}

const SHARED_THREE_RESOURCE_MARKER = '__urdfStudioSharedResource';

/** Mark module-lifetime Three.js resources that outlive any one scene backend. */
export function markSharedThreeResource<T extends ThreeResourceWithUserData>(
  resource: T,
): T {
  resource.userData[SHARED_THREE_RESOURCE_MARKER] = true;
  return resource;
}

export function isSharedThreeResource(
  resource: ThreeResourceWithUserData | null | undefined,
): boolean {
  return resource?.userData?.[SHARED_THREE_RESOURCE_MARKER] === true;
}
