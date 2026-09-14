import * as THREE from 'three';

import {
  createMjcfSiteVisualization,
  createMjcfTendonVisualization,
  type MjcfSiteVisualizationData,
  type MjcfTendonVisualizationData,
} from '@/shared/components/3d/robot/utils/visualizationFactories';

import { updateVisible } from '@/shared/components/3d/robot/utils/visualizationSync/objectPrimitives';
import { shouldHideMjcfWorldRuntimeLink } from '@/shared/components/3d/robot/utils/visualizationSync/interactionPrimitives';
import {
  collectMjcfTendonAnchorsByName,
  updateMjcfTendonMeshGeometry,
} from '@/shared/components/3d/robot/utils/visualizationSync/mjcfTendonGeometry';

interface SyncMjcfSiteVisualizationOptions {
  links: THREE.Object3D[];
  sourceFormat: 'urdf' | 'mjcf';
  showMjcfSites: boolean;
  showMjcfWorldLink: boolean;
}

interface SyncMjcfTendonVisualizationOptions {
  robot: THREE.Object3D;
  sourceFormat: 'urdf' | 'mjcf';
  showMjcfTendons: boolean;
}

export function syncMjcfSiteVisualizationForLinks({
  links,
  sourceFormat,
  showMjcfSites,
  showMjcfWorldLink,
}: SyncMjcfSiteVisualizationOptions): boolean {
  let changed = false;

  links.forEach((link: any) => {
    if (!link.isURDFLink) {
      return;
    }

    const siteData = Array.isArray(link.userData.__mjcfSitesData)
      ? (link.userData.__mjcfSitesData as MjcfSiteVisualizationData[])
      : [];

    let sitesGroup = link.userData.__mjcfSites as THREE.Group | undefined;
    if (sitesGroup && sitesGroup.parent !== link) {
      sitesGroup = undefined;
      link.userData.__mjcfSites = undefined;
    }

    if (!sitesGroup && siteData.length > 0) {
      sitesGroup = new THREE.Group();
      sitesGroup.name = '__mjcf_sites__';
      sitesGroup.userData = {
        isGizmo: true,
        isSelectableHelper: false,
        isMjcfSitesGroup: true,
      };
      siteData.forEach((site) => {
        sitesGroup?.add(createMjcfSiteVisualization(site));
      });
      link.add(sitesGroup);
      link.userData.__mjcfSites = sitesGroup;
      changed = true;
    }

    if (!sitesGroup) {
      return;
    }

    const nextVisible =
      sourceFormat === 'mjcf' &&
      showMjcfSites &&
      siteData.length > 0 &&
      !shouldHideMjcfWorldRuntimeLink(sourceFormat, showMjcfWorldLink, link.name);
    changed = updateVisible(sitesGroup, nextVisible) || changed;
  });

  return changed;
}

export function syncMjcfTendonVisualizationForRobot({
  robot,
  sourceFormat,
  showMjcfTendons,
}: SyncMjcfTendonVisualizationOptions): boolean {
  const tendonData = Array.isArray(robot.userData.__mjcfTendonsData)
    ? (robot.userData.__mjcfTendonsData as MjcfTendonVisualizationData[])
    : [];
  let tendonsGroup = robot.userData.__mjcfTendons as THREE.Group | undefined;
  let changed = false;

  if (tendonsGroup && tendonsGroup.parent !== robot) {
    tendonsGroup = undefined;
    robot.userData.__mjcfTendons = undefined;
  }

  if (!tendonsGroup && tendonData.some((tendon) => tendon.attachmentRefs.length >= 2)) {
    tendonsGroup = new THREE.Group();
    tendonsGroup.name = '__mjcf_tendons__';
    tendonsGroup.raycast = () => undefined;
    tendonsGroup.userData = {
      isMjcfTendonsGroup: true,
    };
    robot.add(tendonsGroup);
    robot.userData.__mjcfTendons = tendonsGroup;
    changed = true;
  }

  if (!tendonsGroup) {
    return changed;
  }

  tendonData.forEach((tendon) => {
    if (tendon.attachmentRefs.length < 2) {
      return;
    }

    let tendonObject = tendonsGroup!.getObjectByName(`__mjcf_tendon__:${tendon.name}`) as
      | THREE.Group
      | undefined;
    if (!tendonObject) {
      tendonObject = createMjcfTendonVisualization(tendon);
      tendonsGroup!.add(tendonObject);
      changed = true;
    }
  });

  const nextVisible =
    sourceFormat === 'mjcf' &&
    showMjcfTendons &&
    tendonData.some((tendon) => tendon.attachmentRefs.length >= 2);
  changed = updateVisible(tendonsGroup, nextVisible) || changed;

  if (!nextVisible) {
    return changed;
  }

  const siteAnchorsByName = collectMjcfTendonAnchorsByName(robot);
  tendonData.forEach((tendon) => {
    if (tendon.attachmentRefs.length < 2) {
      return;
    }

    const tendonObject = tendonsGroup!.getObjectByName(`__mjcf_tendon__:${tendon.name}`) as
      | THREE.Group
      | undefined;
    if (!tendonObject) {
      return;
    }

    changed =
      updateMjcfTendonMeshGeometry(tendonObject, robot, tendon, siteAnchorsByName) || changed;
  });

  return changed;
}
