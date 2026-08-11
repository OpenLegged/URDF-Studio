import { parseColorDefinition, parseTexture, GAZEBO_COLORS } from './utils';
import { addUrdfRecoveryDiagnostic, type UrdfRecoveryDiagnostics } from './recovery';

interface ParsedMaterialDefinition {
  color?: string;
  colorRgba?: [number, number, number, number];
  texture?: string;
}

export const parseMaterials = (
  robotEl: Element,
  recoveryDiagnostics?: UrdfRecoveryDiagnostics,
) => {
  const globalMaterials: Record<string, ParsedMaterialDefinition> = {};
  const linkGazeboMaterials: Record<string, string> = {};

  // 0. Parse Global Materials
  // Select direct children materials of robot to avoid nested ones inside links (though URDF spec says materials are global or local)
  // But querySelectorAll("robot > material") is not valid standard CSS selector for XML in all browsers/parsers,
  // so we iterate all and check parent.
  Array.from(robotEl.children).forEach((child) => {
    if (child.tagName === 'material') {
      const name = child.getAttribute('name')?.trim();
      try {
        const colorDefinition = parseColorDefinition(child);
        const texture = parseTexture(child);
        if (name && (colorDefinition?.color || texture)) {
          if (globalMaterials[name]) {
            addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
              code: 'urdf_duplicate_material_omitted',
              category: 'material',
              message: `An earlier material named "${name}" was replaced by the later definition.`,
              action: 'omitted',
              tag: 'material',
              name,
              relatedIds: [name],
            });
          }
          globalMaterials[name] = {
            ...(colorDefinition?.color ? { color: colorDefinition.color } : {}),
            ...(colorDefinition?.colorRgba ? { colorRgba: colorDefinition.colorRgba } : {}),
            ...(texture ? { texture } : {}),
          };
        } else if (name) {
          addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
            code: 'urdf_material_definition_omitted',
            category: 'material',
            message: `Material "${name}" had no usable color or texture and was omitted.`,
            action: 'omitted',
            tag: 'material',
            name,
            relatedIds: [name],
          });
        } else {
          addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
            code: 'urdf_unnamed_material_omitted',
            category: 'material',
            message: 'An unnamed global material was omitted.',
            action: 'omitted',
            tag: 'material',
            attribute: 'name',
          });
        }
      } catch {
        addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
          code: 'urdf_material_definition_omitted',
          category: 'material',
          message: `Material "${name || '<unnamed>'}" could not be read and was omitted.`,
          action: 'omitted',
          tag: 'material',
          name,
          relatedIds: name ? [name] : undefined,
        });
      }
    }
  });

  // 0.5 Parse Gazebo Materials
  try {
    robotEl.querySelectorAll('gazebo').forEach((gazeboEl) => {
      const reference = gazeboEl.getAttribute('reference');
      if (reference) {
        try {
          const materialEl = gazeboEl.querySelector('material');
          if (materialEl && materialEl.textContent) {
            const gazeboColorName = materialEl.textContent.trim();
            if (GAZEBO_COLORS[gazeboColorName]) {
              linkGazeboMaterials[reference] = GAZEBO_COLORS[gazeboColorName];
            }
          }
        } catch {
          addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
            code: 'urdf_gazebo_material_omitted',
            category: 'material',
            message: `Gazebo material override for "${reference}" could not be read and was omitted.`,
            action: 'omitted',
            tag: 'gazebo',
            name: reference,
            relatedIds: [reference],
          });
        }
      }
    });
  } catch {
    addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
      code: 'urdf_gazebo_materials_omitted',
      category: 'material',
      message: 'Gazebo material extensions could not be traversed and were omitted.',
      action: 'omitted',
      tag: 'gazebo',
    });
  }

  return { globalMaterials, linkGazeboMaterials };
};
