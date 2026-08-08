import { parseColorDefinition, parseTexture, GAZEBO_COLORS } from './utils';

interface ParsedMaterialDefinition {
  color?: string;
  colorRgba?: [number, number, number, number];
  texture?: string;
}

export const parseMaterials = (robotEl: Element) => {
  const globalMaterials: Record<string, ParsedMaterialDefinition> = {};
  const linkGazeboMaterials: Record<string, string> = {};

  // 0. Parse Global Materials
  // Select direct children materials of robot to avoid nested ones inside links (though URDF spec says materials are global or local)
  // But querySelectorAll("robot > material") is not valid standard CSS selector for XML in all browsers/parsers,
  // so we iterate all and check parent.
  Array.from(robotEl.children).forEach((child) => {
    if (child.tagName === 'material') {
      const name = child.getAttribute('name');
      const colorDefinition = parseColorDefinition(child);
      const texture = parseTexture(child);
      if (name && (colorDefinition?.color || texture)) {
        globalMaterials[name] = {
          ...(colorDefinition?.color ? { color: colorDefinition.color } : {}),
          ...(colorDefinition?.colorRgba ? { colorRgba: colorDefinition.colorRgba } : {}),
          ...(texture ? { texture } : {}),
        };
      }
    }
  });

  // 0.5 Parse Gazebo Materials
  robotEl.querySelectorAll('gazebo').forEach((gazeboEl) => {
    const reference = gazeboEl.getAttribute('reference');
    if (reference) {
      const materialEl = gazeboEl.querySelector('material');
      if (materialEl && materialEl.textContent) {
        const gazeboColorName = materialEl.textContent.trim();
        if (GAZEBO_COLORS[gazeboColorName]) {
          linkGazeboMaterials[reference] = GAZEBO_COLORS[gazeboColorName];
        }
      }
    }
  });

  return { globalMaterials, linkGazeboMaterials };
};
