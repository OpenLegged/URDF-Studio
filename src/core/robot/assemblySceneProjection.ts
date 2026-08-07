import type {
  AssemblyComponent,
  AssemblyState,
  AssemblyTransform,
  BridgeJoint,
  EntityRef,
  RobotData,
  RobotInspectionContext,
  RobotMjcfInspectionTendonAttachment,
} from '@/types';
import { entityRefKey } from '@/types';

import { mergeProjectedAssembly } from './assemblyProjectedMerger';
import {
  projectAssemblyComponentRobotResources,
  resolveAssemblySceneRenderStrategy,
  type AssemblySceneRenderStrategy,
} from './assemblyResourcePaths';
import { cloneAssemblyTransform } from './assemblyTransformUtils';
import { resolveRobotLinkEditorLock } from './editorLock';

export type { AssemblySceneRenderStrategy } from './assemblyResourcePaths';

export interface AssemblyComponentRootTarget {
  readonly componentId: string;
  readonly rootLinkId: string;
  readonly assemblyTransform: AssemblyTransform;
  readonly componentTransform: AssemblyTransform;
}

export interface AssemblySceneProjection {
  readonly robotData: RobotData;
  readonly renderStrategy: AssemblySceneRenderStrategy;
  readonly globalToEntityRef: ReadonlyMap<string, EntityRef>;
  readonly entityRefKeyToGlobal: ReadonlyMap<string, string>;
  readonly componentRootTargets: ReadonlyMap<string, AssemblyComponentRootTarget>;
}

interface ComponentEntityIdProjection {
  readonly component: AssemblyComponent;
  readonly linkIds: ReadonlyMap<string, string>;
  readonly jointIds: ReadonlyMap<string, string>;
  readonly tendonIds: ReadonlyMap<string, string>;
  readonly linkReferenceIds: ReadonlyMap<string, string>;
  readonly jointReferenceIds: ReadonlyMap<string, string>;
}

interface ComponentIdProjection extends ComponentEntityIdProjection {
  readonly siteIds: ReadonlyMap<string, string>;
  readonly geometryIds: ReadonlyMap<string, string>;
  readonly materialIds: ReadonlyMap<string, string>;
  readonly closedLoopConstraintIds: ReadonlyMap<string, string>;
  readonly actuatorIds: ReadonlyMap<string, string>;
}

interface GlobalIdRegistry {
  readonly globalToEntityRef: Map<string, EntityRef>;
  readonly entityRefKeyToGlobal: Map<string, string>;
  allocate: (ref: EntityRef, preferredId: string) => string;
  allocateAuxiliary: (preferredId: string, kind: string) => string;
}

function createGlobalIdRegistry(): GlobalIdRegistry {
  const globalToEntityRef = new Map<string, EntityRef>();
  const entityRefKeyToGlobal = new Map<string, string>();
  const usedIds = new Set<string>();

  const allocateUnique = (preferredId: string, kind: string): string => {
    const baseId = preferredId || kind;
    let globalId = baseId;
    let suffix = 1;
    while (usedIds.has(globalId)) {
      globalId = `${baseId}__${kind}${suffix === 1 ? '' : `_${suffix}`}`;
      suffix += 1;
    }
    usedIds.add(globalId);
    return globalId;
  };

  return {
    globalToEntityRef,
    entityRefKeyToGlobal,
    allocate(ref, preferredId) {
      const key = entityRefKey(ref);
      const existingId = entityRefKeyToGlobal.get(key);
      if (existingId) {
        return existingId;
      }

      const globalId = allocateUnique(preferredId, ref.type);

      globalToEntityRef.set(globalId, ref);
      entityRefKeyToGlobal.set(key, globalId);
      return globalId;
    },
    allocateAuxiliary(preferredId, kind) {
      return allocateUnique(preferredId, kind);
    },
  };
}

function requireProjectedId(
  ids: ReadonlyMap<string, string>,
  sourceId: string,
  entityType: string,
  componentId: string,
): string {
  const projectedId = ids.get(sourceId);
  if (projectedId) {
    return projectedId;
  }

  throw new Error(
    `Cannot project component "${componentId}" because ${entityType} "${sourceId}" does not exist`,
  );
}

function buildReferenceIds(
  primaryIds: ReadonlyMap<string, string>,
  aliasesBySourceId: ReadonlyMap<string, readonly (string | undefined)[]>,
): Map<string, string> {
  const referenceIds = new Map(primaryIds);
  const ambiguousAliases = new Set<string>();

  aliasesBySourceId.forEach((aliases, sourceId) => {
    const globalId = primaryIds.get(sourceId);
    if (!globalId) {
      return;
    }

    aliases.forEach((alias) => {
      const normalizedAlias = alias?.trim();
      if (
        !normalizedAlias ||
        primaryIds.has(normalizedAlias) ||
        ambiguousAliases.has(normalizedAlias)
      ) {
        return;
      }

      const existingId = referenceIds.get(normalizedAlias);
      if (existingId && existingId !== globalId) {
        referenceIds.delete(normalizedAlias);
        ambiguousAliases.add(normalizedAlias);
        return;
      }
      referenceIds.set(normalizedAlias, globalId);
    });
  });

  return referenceIds;
}

function collectComponentSiteIds(
  component: AssemblyComponent,
  registry: GlobalIdRegistry,
  toPreferredId: (componentId: string, entityId: string) => string,
): Map<string, string> {
  const sites = Object.values(component.robot.links)
    .flatMap((link) => link.mjcfSites ?? [])
    .sort((left, right) => left.name.localeCompare(right.name));
  const siteIds = new Map<string, string>();

  sites.forEach((site) => {
    if (!siteIds.has(site.name)) {
      siteIds.set(
        site.name,
        registry.allocateAuxiliary(toPreferredId(component.id, site.name), 'site'),
      );
    }
  });
  sites.forEach((site) => {
    const projectedId = siteIds.get(site.name)!;
    if (site.sourceName && !siteIds.has(site.sourceName)) {
      siteIds.set(site.sourceName, projectedId);
    }
  });
  return siteIds;
}

function collectComponentGeometryIds(
  component: AssemblyComponent,
  registry: GlobalIdRegistry,
  toPreferredId: (componentId: string, entityId: string) => string,
): Map<string, string> {
  const sourceIds = new Set<string>();
  Object.values(component.robot.links).forEach((link) => {
    [
      link.visual,
      ...(link.visualBodies ?? []),
      link.collision,
      ...(link.collisionBodies ?? []),
    ].forEach((geometry) => {
      const sourceId = geometry.name?.trim();
      if (sourceId) {
        sourceIds.add(sourceId);
      }
    });
  });

  return new Map(
    Array.from(sourceIds)
      .sort()
      .map((sourceId) => [
        sourceId,
        registry.allocateAuxiliary(toPreferredId(component.id, sourceId), 'geometry'),
      ]),
  );
}

function collectAuxiliaryIds({
  sourceIds,
  componentId,
  kind,
  registry,
  toPreferredId,
}: {
  sourceIds: readonly string[];
  componentId: string;
  kind: string;
  registry: GlobalIdRegistry;
  toPreferredId: (componentId: string, entityId: string) => string;
}): Map<string, string> {
  return new Map(
    Array.from(new Set(sourceIds))
      .sort()
      .map((sourceId) => [
        sourceId,
        registry.allocateAuxiliary(toPreferredId(componentId, sourceId), kind),
      ]),
  );
}

function collectIdentityIds(sourceIds: readonly (string | undefined)[]): Map<string, string> {
  return new Map(
    sourceIds.flatMap((sourceId) => {
      const normalizedId = sourceId?.trim();
      return normalizedId ? [[normalizedId, normalizedId] as const] : [];
    }),
  );
}

function createComponentEntityIdProjection(
  component: AssemblyComponent,
  registry: GlobalIdRegistry,
  toPreferredId: (componentId: string, entityId: string) => string,
): ComponentEntityIdProjection {
  const linkIds = new Map<string, string>();
  const jointIds = new Map<string, string>();
  const tendonIds = new Map<string, string>();

  Object.keys(component.robot.links)
    .sort()
    .forEach((entityId) => {
      const ref: EntityRef = { type: 'link', componentId: component.id, entityId };
      linkIds.set(entityId, registry.allocate(ref, toPreferredId(component.id, entityId)));
    });

  Object.keys(component.robot.joints)
    .sort()
    .forEach((entityId) => {
      const ref: EntityRef = { type: 'joint', componentId: component.id, entityId };
      jointIds.set(entityId, registry.allocate(ref, toPreferredId(component.id, entityId)));
    });

  (component.robot.inspectionContext?.mjcf?.tendons ?? []).forEach((tendon) => {
    const entityId = tendon.name;
    const ref: EntityRef = { type: 'tendon', componentId: component.id, entityId };
    tendonIds.set(entityId, registry.allocate(ref, toPreferredId(component.id, entityId)));
  });

  const linkAliases = new Map(
    Object.entries(component.robot.links).map(([sourceId, link]) => [
      sourceId,
      [link.id, link.name],
    ]),
  );
  const jointAliases = new Map(
    Object.entries(component.robot.joints).map(([sourceId, joint]) => [
      sourceId,
      [joint.id, joint.name],
    ]),
  );

  return {
    component,
    linkIds,
    jointIds,
    tendonIds,
    linkReferenceIds: buildReferenceIds(linkIds, linkAliases),
    jointReferenceIds: buildReferenceIds(jointIds, jointAliases),
  };
}

function addComponentAuxiliaryIdProjection(
  ids: ComponentEntityIdProjection,
  registry: GlobalIdRegistry,
  toPreferredId: (componentId: string, entityId: string) => string,
  useProjectionGlobalNames: boolean,
): ComponentIdProjection {
  const { component } = ids;
  const materialSourceIds = new Set(Object.keys(component.robot.materials ?? {}));
  Object.values(component.robot.links).forEach((link) => {
    [
      link.visual,
      ...(link.visualBodies ?? []),
      link.collision,
      ...(link.collisionBodies ?? []),
    ].forEach((geometry) => {
      geometry.authoredMaterials?.forEach((material) => {
        const name = material.name?.trim();
        if (name) {
          materialSourceIds.add(name);
        }
      });
    });
  });
  if (!useProjectionGlobalNames) {
    const sites = Object.values(component.robot.links).flatMap((link) => link.mjcfSites ?? []);
    return {
      ...ids,
      siteIds: collectIdentityIds(
        sites.flatMap((site) => [site.name, site.sourceName]),
      ),
      geometryIds: collectIdentityIds(
        Object.values(component.robot.links).flatMap((link) =>
          [
            link.visual,
            ...(link.visualBodies ?? []),
            link.collision,
            ...(link.collisionBodies ?? []),
          ].map((geometry) => geometry.name),
        ),
      ),
      materialIds: collectIdentityIds(Array.from(materialSourceIds)),
      closedLoopConstraintIds: collectIdentityIds(
        (component.robot.closedLoopConstraints ?? []).map((constraint) => constraint.id),
      ),
      actuatorIds: collectIdentityIds(
        (component.robot.inspectionContext?.mjcf?.tendons ?? []).flatMap(
          (tendon) => tendon.actuatorNames,
        ),
      ),
    };
  }

  const materialIds = new Map<string, string>();
  Array.from(materialSourceIds)
    .sort()
    .forEach((sourceId) => {
      materialIds.set(
        sourceId,
        ids.linkReferenceIds.get(sourceId) ??
          registry.allocateAuxiliary(toPreferredId(component.id, sourceId), 'material'),
      );
    });

  return {
    ...ids,
    siteIds: collectComponentSiteIds(component, registry, toPreferredId),
    geometryIds: collectComponentGeometryIds(component, registry, toPreferredId),
    materialIds,
    closedLoopConstraintIds: collectAuxiliaryIds({
      sourceIds: (component.robot.closedLoopConstraints ?? []).map((constraint) => constraint.id),
      componentId: component.id,
      kind: 'constraint',
      registry,
      toPreferredId,
    }),
    actuatorIds: collectAuxiliaryIds({
      sourceIds: (component.robot.inspectionContext?.mjcf?.tendons ?? []).flatMap(
        (tendon) => tendon.actuatorNames,
      ),
      componentId: component.id,
      kind: 'actuator',
      registry,
      toPreferredId,
    }),
  };
}

function projectTendonAttachment(
  attachment: RobotMjcfInspectionTendonAttachment,
  ids: ComponentIdProjection,
  useProjectionGlobalNames: boolean,
): RobotMjcfInspectionTendonAttachment {
  const projectReference = (value: string | undefined): string | undefined => {
    if (!value) {
      return value;
    }
    if (!useProjectionGlobalNames && attachment.type !== 'joint') {
      return value;
    }
    if (attachment.type === 'site') {
      return requireProjectedId(ids.siteIds, value, 'tendon site attachment', ids.component.id);
    }
    if (attachment.type === 'joint') {
      return requireProjectedId(
        ids.jointReferenceIds,
        value,
        'tendon joint attachment',
        ids.component.id,
      );
    }
    if (attachment.type === 'geom') {
      return requireProjectedId(
        ids.geometryIds,
        value,
        'tendon geometry attachment',
        ids.component.id,
      );
    }
    return value;
  };

  const projectedRef = projectReference(attachment.ref);
  return {
    ...attachment,
    ...(projectedRef !== attachment.ref ? { ref: projectedRef } : {}),
    ...(useProjectionGlobalNames && attachment.sidesite
      ? {
          sidesite: requireProjectedId(
            ids.siteIds,
            attachment.sidesite,
            'tendon side site',
            ids.component.id,
          ),
        }
      : {}),
  };
}

function requireProjectedTendonAttachmentRef(sourceId: string, ids: ComponentIdProjection): string {
  const matches = [
    ids.siteIds.get(sourceId),
    ids.geometryIds.get(sourceId),
    ids.jointReferenceIds.get(sourceId),
  ].filter((value): value is string => Boolean(value));
  const uniqueMatches = Array.from(new Set(matches));
  if (uniqueMatches.length === 1) {
    return uniqueMatches[0]!;
  }

  throw new Error(
    `Cannot project component "${ids.component.id}" because tendon attachment reference "${sourceId}" ${
      uniqueMatches.length === 0 ? 'does not exist' : 'is ambiguous'
    }`,
  );
}

function projectInspectionContext(
  context: RobotInspectionContext | undefined,
  ids: ComponentIdProjection,
  useProjectionGlobalNames: boolean,
): RobotInspectionContext | undefined {
  if (!context) {
    return undefined;
  }

  const projected = structuredClone(context);
  if (!projected.mjcf) {
    return projected;
  }

  projected.mjcf.bodiesWithSites = projected.mjcf.bodiesWithSites.map((body) => ({
    ...body,
    bodyId: requireProjectedId(
      ids.linkReferenceIds,
      body.bodyId,
      'MJCF body link',
      ids.component.id,
    ),
    siteNames: useProjectionGlobalNames
      ? body.siteNames.map((siteName) =>
          requireProjectedId(ids.siteIds, siteName, 'MJCF body site', ids.component.id)
        )
      : body.siteNames,
  }));
  projected.mjcf.tendons = projected.mjcf.tendons.map((tendon) => {
    const attachments = tendon.attachments.map((attachment) =>
      projectTendonAttachment(attachment, ids, useProjectionGlobalNames),
    );
    const attachmentRefs = attachments.flatMap((attachment) => {
      const ref = attachment.ref ?? attachment.sidesite;
      return ref ? [ref] : [];
    });

    return {
      ...tendon,
      name: requireProjectedId(ids.tendonIds, tendon.name, 'tendon', ids.component.id),
      attachmentRefs:
        attachmentRefs.length === tendon.attachmentRefs.length
          ? attachmentRefs
          : tendon.attachmentRefs.map((ref) => requireProjectedTendonAttachmentRef(ref, ids)),
      attachments,
      actuatorNames: useProjectionGlobalNames
        ? tendon.actuatorNames.map((name) =>
            requireProjectedId(ids.actuatorIds, name, 'tendon actuator', ids.component.id)
          )
        : tendon.actuatorNames,
    };
  });
  return projected;
}

function projectGeometryNames(
  geometry: RobotData['links'][string]['visual'],
  ids: ComponentIdProjection,
  useProjectionGlobalNames: boolean,
): RobotData['links'][string]['visual'] {
  const sourceId = geometry.name?.trim();

  return {
    ...geometry,
    ...(sourceId && useProjectionGlobalNames
      ? { name: ids.geometryIds.get(sourceId) ?? sourceId }
      : {}),
    ...(useProjectionGlobalNames && geometry.authoredMaterials
      ? {
          authoredMaterials: geometry.authoredMaterials.map((material) => {
            const materialName = material.name?.trim();
            return materialName
              ? { ...material, name: ids.materialIds.get(materialName) ?? materialName }
              : material;
          }),
        }
      : {}),
  };
}

function projectComponentRobot(
  ids: ComponentIdProjection,
  useProjectionGlobalNames: boolean,
): RobotData {
  const renderStrategy: AssemblySceneRenderStrategy = useProjectionGlobalNames
    ? 'assembled-scene'
    : 'direct-component';
  const source = projectAssemblyComponentRobotResources({
    componentId: ids.component.id,
    sourceFile: ids.component.sourceFile,
    robot: structuredClone(ids.component.robot),
    renderStrategy,
  });
  const links: RobotData['links'] = {};
  const joints: RobotData['joints'] = {};

  Object.entries(source.links).forEach(([sourceId, link]) => {
    const globalId = requireProjectedId(ids.linkIds, sourceId, 'link', ids.component.id);
    links[globalId] = {
      ...link,
      id: globalId,
      name: useProjectionGlobalNames ? globalId : link.name,
      ...(ids.component.editorLocked === true
        || resolveRobotLinkEditorLock(ids.component.robot, sourceId).locked
        ? { editorLocked: true }
        : {}),
      visual: projectGeometryNames(link.visual, ids, useProjectionGlobalNames),
      ...(link.visualBodies
        ? {
            visualBodies: link.visualBodies.map((geometry) =>
              projectGeometryNames(geometry, ids, useProjectionGlobalNames)
            ),
          }
        : {}),
      collision: projectGeometryNames(link.collision, ids, useProjectionGlobalNames),
      ...(link.collisionBodies
        ? {
            collisionBodies: link.collisionBodies.map((geometry) =>
              projectGeometryNames(geometry, ids, useProjectionGlobalNames)
            ),
          }
        : {}),
      ...(link.mjcfSites
        ? {
            mjcfSites: link.mjcfSites.map((site) => ({
              ...site,
              name: useProjectionGlobalNames
                ? requireProjectedId(ids.siteIds, site.name, 'MJCF site', ids.component.id)
                : site.name,
              ...(useProjectionGlobalNames ? { sourceName: undefined } : {}),
            })),
          }
        : {}),
    };
  });

  Object.entries(source.joints).forEach(([sourceId, joint]) => {
    const globalId = requireProjectedId(ids.jointIds, sourceId, 'joint', ids.component.id);
    const mimicJointId = joint.mimic?.joint
      ? requireProjectedId(
          ids.jointReferenceIds,
          joint.mimic.joint,
          'mimic joint',
          ids.component.id,
        )
      : undefined;
    joints[globalId] = {
      ...joint,
      id: globalId,
      name: useProjectionGlobalNames ? globalId : joint.name,
      parentLinkId: requireProjectedId(
        ids.linkReferenceIds,
        joint.parentLinkId,
        'parent link',
        ids.component.id,
      ),
      childLinkId: requireProjectedId(
        ids.linkReferenceIds,
        joint.childLinkId,
        'child link',
        ids.component.id,
      ),
      ...(joint.mimic
        ? {
            mimic: {
              ...joint.mimic,
              ...(mimicJointId ? { joint: mimicJointId } : {}),
            },
          }
        : {}),
    };
  });

  const materials: NonNullable<RobotData['materials']> = {};
  Object.entries(source.materials ?? {}).forEach(([sourceId, material]) => {
    const globalId = useProjectionGlobalNames
      ? requireProjectedId(ids.materialIds, sourceId, 'material key', ids.component.id)
      : sourceId;
    materials[globalId] = material;
  });

  return {
    name: source.name,
    ...(source.version ? { version: source.version } : {}),
    links,
    joints,
    rootLinkId: requireProjectedId(
      ids.linkReferenceIds,
      source.rootLinkId,
      'root link',
      ids.component.id,
    ),
    ...(source.materials ? { materials } : {}),
    ...(source.closedLoopConstraints
      ? {
          closedLoopConstraints: source.closedLoopConstraints.map((constraint) => ({
            ...constraint,
            id: useProjectionGlobalNames
              ? requireProjectedId(
                  ids.closedLoopConstraintIds,
                  constraint.id,
                  'closed-loop constraint',
                  ids.component.id,
                )
              : constraint.id,
            linkAId: requireProjectedId(
              ids.linkReferenceIds,
              constraint.linkAId,
              'closed-loop link',
              ids.component.id,
            ),
            linkBId: requireProjectedId(
              ids.linkReferenceIds,
              constraint.linkBId,
              'closed-loop link',
              ids.component.id,
            ),
            ...(constraint.source
              ? {
                  source: {
                    ...constraint.source,
                    body1Name: requireProjectedId(
                      ids.linkReferenceIds,
                      constraint.source.body1Name,
                      'closed-loop source body',
                      ids.component.id,
                    ),
                    body2Name: requireProjectedId(
                      ids.linkReferenceIds,
                      constraint.source.body2Name,
                      'closed-loop source body',
                      ids.component.id,
                    ),
                  },
                }
              : {}),
          })),
        }
      : {}),
    ...(source.inspectionContext
      ? {
          inspectionContext: projectInspectionContext(
            source.inspectionContext,
            ids,
            useProjectionGlobalNames,
          ),
        }
      : {}),
  };
}

function combineInspectionContexts(
  robots: readonly RobotData[],
): RobotInspectionContext | undefined {
  const contexts = robots.flatMap((robot) =>
    robot.inspectionContext ? [robot.inspectionContext] : [],
  );
  if (contexts.length === 0) {
    return undefined;
  }
  if (contexts.length === 1) {
    return contexts[0];
  }

  const mjcfContexts = contexts.flatMap((context) => (context.mjcf ? [context.mjcf] : []));
  const firstUrdf = contexts.find((context) => context.urdf)?.urdf;
  return {
    sourceFormat: mjcfContexts.length > 0 ? 'mjcf' : contexts[0]!.sourceFormat,
    urdf: firstUrdf,
    mjcf:
      mjcfContexts.length > 0
        ? {
            siteCount: mjcfContexts.reduce((total, context) => total + context.siteCount, 0),
            tendonCount: mjcfContexts.reduce((total, context) => total + context.tendonCount, 0),
            tendonActuatorCount: mjcfContexts.reduce(
              (total, context) => total + context.tendonActuatorCount,
              0,
            ),
            bodiesWithSites: mjcfContexts.flatMap((context) => context.bodiesWithSites),
            tendons: mjcfContexts.flatMap((context) => context.tendons),
          }
        : undefined,
  };
}

function projectBridge(
  bridge: BridgeJoint,
  idsByComponentId: ReadonlyMap<string, ComponentIdProjection>,
  registry: GlobalIdRegistry,
): BridgeJoint {
  const parentIds = idsByComponentId.get(bridge.parentComponentId);
  const childIds = idsByComponentId.get(bridge.childComponentId);
  if (!parentIds || !childIds) {
    throw new Error(`Cannot project bridge "${bridge.id}" because one of its components is hidden`);
  }

  const ref: EntityRef = { type: 'bridge', bridgeId: bridge.id };
  const globalId = registry.allocate(ref, bridge.id);
  const parentLinkId = requireProjectedId(
    parentIds.linkReferenceIds,
    bridge.parentLinkId,
    'bridge parent link',
    bridge.parentComponentId,
  );
  const childLinkId = requireProjectedId(
    childIds.linkReferenceIds,
    bridge.childLinkId,
    'bridge child link',
    bridge.childComponentId,
  );

  return {
    ...structuredClone(bridge),
    id: globalId,
    name: globalId,
    parentLinkId,
    childLinkId,
    joint: {
      ...structuredClone(bridge.joint),
      id: globalId,
      name: globalId,
      parentLinkId,
      childLinkId,
    },
  };
}

function resolveProjectedComponentRuntimeRootLinkId(
  robot: RobotData,
  registry: GlobalIdRegistry,
  componentId: string,
  fallbackRootLinkId: string,
): string {
  const componentLinkIds = Array.from(registry.globalToEntityRef.entries())
    .filter(
      (entry): entry is [string, Extract<EntityRef, { type: 'link' }>] =>
        entry[1].type === 'link' && entry[1].componentId === componentId,
    )
    .map(([globalId]) => globalId);
  const componentLinkIdSet = new Set(componentLinkIds);
  const internalChildLinkIds = new Set<string>();
  const structuralBridgeChildLinkIds = new Set<string>();

  Object.values(robot.joints).forEach((joint) => {
    if (!componentLinkIdSet.has(joint.childLinkId)) {
      return;
    }
    if (componentLinkIdSet.has(joint.parentLinkId)) {
      internalChildLinkIds.add(joint.childLinkId);
      return;
    }
    structuralBridgeChildLinkIds.add(joint.childLinkId);
  });

  if (structuralBridgeChildLinkIds.size === 1) {
    return structuralBridgeChildLinkIds.values().next().value ?? fallbackRootLinkId;
  }

  const runtimeRootLinkIds = componentLinkIds.filter(
    (linkId) => !internalChildLinkIds.has(linkId),
  );
  if (runtimeRootLinkIds.includes(fallbackRootLinkId)) {
    return fallbackRootLinkId;
  }
  return runtimeRootLinkIds.sort()[0] ?? fallbackRootLinkId;
}

/** Builds a read-only renderer projection without mutating canonical workspace state. */
export function createAssemblySceneProjection(assembly: AssemblyState): AssemblySceneProjection {
  const visibleComponents = Object.values(assembly.components)
    .filter((component) => component.visible !== false)
    .sort((left, right) => left.id.localeCompare(right.id));
  const renderStrategy = resolveAssemblySceneRenderStrategy(assembly);
  const toPreferredId =
    renderStrategy === 'direct-component'
      ? (_componentId: string, entityId: string) => entityId
      : (componentId: string, entityId: string) => `${componentId}_${entityId}`;
  const registry = createGlobalIdRegistry();
  const visibleComponentIds = new Set(visibleComponents.map((component) => component.id));
  const visibleBridges = Object.values(assembly.bridges)
    .filter(
      (bridge) =>
        visibleComponentIds.has(bridge.parentComponentId) &&
        visibleComponentIds.has(bridge.childComponentId),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const entityIdsByComponentId = new Map<string, ComponentEntityIdProjection>();
  const idsByComponentId = new Map<string, ComponentIdProjection>();

  visibleComponents.forEach((component) => {
    entityIdsByComponentId.set(
      component.id,
      createComponentEntityIdProjection(component, registry, toPreferredId),
    );
  });
  visibleBridges.forEach((bridge) => {
    registry.allocate({ type: 'bridge', bridgeId: bridge.id }, bridge.id);
  });
  visibleComponents.forEach((component) => {
    idsByComponentId.set(
      component.id,
      addComponentAuxiliaryIdProjection(
        entityIdsByComponentId.get(component.id)!,
        registry,
        toPreferredId,
        renderStrategy === 'assembled-scene',
      ),
    );
  });

  const projectedComponents: Record<string, AssemblyComponent> = {};
  const projectedRobots: RobotData[] = [];
  visibleComponents.forEach((component) => {
    const ids = idsByComponentId.get(component.id)!;
    const robot = projectComponentRobot(ids, renderStrategy === 'assembled-scene');
    projectedRobots.push(robot);
    projectedComponents[component.id] = {
      ...structuredClone(component),
      robot,
      visible: true,
    };
  });

  let robotData: RobotData;
  if (renderStrategy === 'direct-component') {
    robotData = projectedRobots[0]!;
  } else {
    const projectedBridges: Record<string, BridgeJoint> = {};
    visibleBridges.forEach((bridge) => {
      const projectedBridge = projectBridge(bridge, idsByComponentId, registry);
      projectedBridges[projectedBridge.id] = projectedBridge;
    });

    robotData = mergeProjectedAssembly({
      name: assembly.name,
      transform: cloneAssemblyTransform(assembly.transform),
      components: projectedComponents,
      bridges: projectedBridges,
    });
    robotData.inspectionContext = combineInspectionContexts(projectedRobots);
  }

  const componentRootTargets = new Map<string, AssemblyComponentRootTarget>();
  visibleComponents.forEach((component) => {
    const projectedRootLinkId = projectedComponents[component.id]!.robot.rootLinkId;
    componentRootTargets.set(component.id, {
      componentId: component.id,
      rootLinkId: resolveProjectedComponentRuntimeRootLinkId(
        robotData,
        registry,
        component.id,
        projectedRootLinkId,
      ),
      assemblyTransform: cloneAssemblyTransform(assembly.transform),
      componentTransform: cloneAssemblyTransform(component.transform),
    });
  });

  return {
    robotData,
    renderStrategy,
    globalToEntityRef: registry.globalToEntityRef,
    entityRefKeyToGlobal: registry.entityRefKeyToGlobal,
    componentRootTargets,
  };
}
