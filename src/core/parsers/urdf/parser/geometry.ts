import { GeometryType } from '@/types/geometry';
import { DEFAULT_LINK } from '@/types/constants';
import { parseVec3 } from './utils';

const parseAuthoredScalar = (element: Element, attribute: string, fallback: number): number => {
    const rawValue = element.getAttribute(attribute);
    return rawValue === null || rawValue.trim() === '' ? fallback : Number.parseFloat(rawValue);
};

const parseAuthoredDimensions = (rawValue: string | null): { x: number; y: number; z: number } => {
    if (!rawValue?.trim()) {
        return parseVec3(null);
    }
    const values = rawValue.trim().split(/\s+/).map((value) => Number.parseFloat(value));
    return {
        x: values[0] ?? 0,
        y: values[1] ?? 0,
        z: values[2] ?? 0,
    };
};

export const parseGeometry = (geoEl: Element | null, defaultGeo: any = DEFAULT_LINK.visual) => {
    if (!geoEl) return defaultGeo;

    const box = geoEl.querySelector("box");
    const cylinder = geoEl.querySelector("cylinder");
    const sphere = geoEl.querySelector("sphere");
    const mesh = geoEl.querySelector("mesh");
    const capsule = geoEl.querySelector("capsule");

    if (box) {
        return {
            type: GeometryType.BOX,
            dimensions: parseAuthoredDimensions(box.getAttribute("size")),
        };
    } else if (cylinder) {
        return {
            type: GeometryType.CYLINDER,
            dimensions: {
                x: parseAuthoredScalar(cylinder, "radius", 0.1),
                y: parseAuthoredScalar(cylinder, "length", 0.5),
                z: 0
            }
        };
    } else if (sphere) {
        return {
            type: GeometryType.SPHERE,
            dimensions: {
                x: parseAuthoredScalar(sphere, "radius", 0.1),
                y: 0, z: 0
            }
        };
    } else if (capsule) {
        return {
            type: GeometryType.CAPSULE,
            dimensions: {
                x: parseAuthoredScalar(capsule, "radius", 0.1),
                y: parseAuthoredScalar(capsule, "length", 0.5),
                z: 0
            }
        };
    } else if (mesh) {
        const filename = mesh.getAttribute("filename") || "";
        // Keep the full path so the mesh loader can resolve it using its advanced lookup logic
        const cleanName = filename;

        // Parse scale attribute (supports "0.001 0.001 0.001" format with multiple spaces)
        const scaleAttr = mesh.getAttribute("scale");
        let scale = { x: 1, y: 1, z: 1 };
        if (scaleAttr) {
            const scaleParts = scaleAttr.trim().split(/\s+/).map(Number);
            if (scaleParts.length >= 3) {
                scale = { x: scaleParts[0], y: scaleParts[1], z: scaleParts[2] };
            } else if (scaleParts.length === 1) {
                // Uniform scale
                scale = { x: scaleParts[0], y: scaleParts[0], z: scaleParts[0] };
            } else {
                scale = { x: Number.NaN, y: Number.NaN, z: Number.NaN };
            }
        }

        return {
            type: GeometryType.MESH,
            dimensions: scale,
            meshPath: cleanName
        };
    }
    return null;
};
