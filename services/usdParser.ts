/**
 * USD (Universal Scene Description) Parser
 * Parses USDA (ASCII) format and converts to RobotState
 * Note: This is a simplified parser for basic robot structures
 * Full USD support would require a proper USD library
 */

import { RobotState, UrdfLink, UrdfJoint, DEFAULT_LINK, DEFAULT_JOINT, GeometryType, JointType } from '../types';

interface USDPrim {
    name: string;
    type: string;
    path: string;
    properties: Record<string, any>;
    children: USDPrim[];
}

// Parse a value from USDA format
function parseUSDValue(valueStr: string): any {
    valueStr = valueStr.trim();
    
    // Array/tuple: (x, y, z) or [x, y, z]
    const tupleMatch = valueStr.match(/^[\(\[](.+?)[\)\]]$/);
    if (tupleMatch) {
        return tupleMatch[1].split(',').map(v => parseUSDValue(v.trim()));
    }
    
    // Quoted string
    const stringMatch = valueStr.match(/^["'](.*)["']$/);
    if (stringMatch) {
        return stringMatch[1];
    }
    
    // Number
    const num = parseFloat(valueStr);
    if (!isNaN(num)) {
        return num;
    }
    
    // Boolean
    if (valueStr === 'true') return true;
    if (valueStr === 'false') return false;
    
    return valueStr;
}

// Tokenize USDA content
function tokenizeUSDA(content: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let depth = 0;
    
    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        
        if (inString) {
            current += char;
            if (char === stringChar && content[i - 1] !== '\\') {
                inString = false;
            }
        } else if (char === '"' || char === "'") {
            inString = true;
            stringChar = char;
            current += char;
        } else if (char === '(' || char === '[') {
            depth++;
            current += char;
        } else if (char === ')' || char === ']') {
            depth--;
            current += char;
        } else if (depth === 0 && /\s/.test(char)) {
            if (current.trim()) {
                tokens.push(current.trim());
            }
            current = '';
        } else if (depth === 0 && (char === '{' || char === '}' || char === '=')) {
            if (current.trim()) {
                tokens.push(current.trim());
            }
            tokens.push(char);
            current = '';
        } else {
            current += char;
        }
    }
    
    if (current.trim()) {
        tokens.push(current.trim());
    }
    
    return tokens;
}

// Parse USDA tokens into a tree structure
function parseUSDAPrims(tokens: string[], startIndex: number, parentPath: string): { prims: USDPrim[], endIndex: number } {
    const prims: USDPrim[] = [];
    let i = startIndex;
    
    while (i < tokens.length) {
        const token = tokens[i];
        
        if (token === '}') {
            return { prims, endIndex: i };
        }
        
        // Look for "def Type "Name"" pattern
        if (token === 'def' || token === 'over' || token === 'class') {
            const primType = tokens[i + 1] || 'Xform';
            let primName = tokens[i + 2] || 'prim';
            
            // Remove quotes from name
            primName = primName.replace(/^["']|["']$/g, '');
            
            const prim: USDPrim = {
                name: primName,
                type: primType,
                path: parentPath ? `${parentPath}/${primName}` : `/${primName}`,
                properties: {},
                children: []
            };
            
            // Find opening brace
            let j = i + 3;
            while (j < tokens.length && tokens[j] !== '{') j++;
            
            if (tokens[j] === '{') {
                j++;
                
                // Parse properties and children
                while (j < tokens.length && tokens[j] !== '}') {
                    // Check for nested def
                    if (tokens[j] === 'def' || tokens[j] === 'over') {
                        const { prims: childPrims, endIndex } = parseUSDAPrims(tokens, j, prim.path);
                        prim.children.push(...childPrims);
                        j = endIndex + 1;
                    }
                    // Property assignment
                    else if (j + 2 < tokens.length && tokens[j + 1] === '=') {
                        const propName = tokens[j];
                        const propValue = parseUSDValue(tokens[j + 2]);
                        prim.properties[propName] = propValue;
                        j += 3;
                    }
                    else {
                        j++;
                    }
                }
                
                i = j + 1;
            } else {
                i = j + 1;
            }
            
            prims.push(prim);
        } else {
            i++;
        }
    }
    
    return { prims, endIndex: tokens.length };
}

// Convert USD prims to RobotState
function usdToRobotState(rootPrims: USDPrim[], modelName: string): RobotState {
    const links: Record<string, UrdfLink> = {};
    const joints: Record<string, UrdfJoint> = {};
    let rootLinkId = '';
    let linkCounter = 0;
    let jointCounter = 0;
    
    function processPrim(prim: USDPrim, parentLinkId: string | null): string | null {
        // Skip non-geometric types
        const geometricTypes = ['Xform', 'Mesh', 'Cube', 'Sphere', 'Cylinder', 'Capsule', 'Scope', 'PhysicsRevoluteJoint', 'PhysicsPrismaticJoint', 'PhysicsFixedJoint'];
        
        if (!geometricTypes.some(t => prim.type.includes(t))) {
            // Still process children
            prim.children.forEach(child => processPrim(child, parentLinkId));
            return null;
        }
        
        // Check if this is a joint
        if (prim.type.includes('Joint')) {
            // This is a physics joint, skip for now as USD joints work differently
            return null;
        }
        
        // Create a link for this prim
        const linkId = prim.name || `link_${linkCounter++}`;
        
        // Determine geometry type
        let geoType = GeometryType.BOX;
        let visual = { ...DEFAULT_LINK.visual };
        
        if (prim.type.includes('Cube') || prim.type === 'Cube') {
            geoType = GeometryType.BOX;
            const size = prim.properties['size'] || 1;
            visual.dimensions = { x: size, y: size, z: size };
        } else if (prim.type.includes('Sphere') || prim.type === 'Sphere') {
            geoType = GeometryType.SPHERE;
            const radius = prim.properties['radius'] || 0.5;
            visual.dimensions = { x: radius, y: 0, z: 0 };
        } else if (prim.type.includes('Cylinder') || prim.type === 'Cylinder') {
            geoType = GeometryType.CYLINDER;
            const radius = prim.properties['radius'] || 0.5;
            const height = prim.properties['height'] || 1;
            visual.dimensions = { x: radius, y: height, z: 0 };
        } else if (prim.type.includes('Mesh') || prim.type === 'Mesh') {
            geoType = GeometryType.MESH;
            // Check for references
            const refs = prim.properties['references'] || prim.properties['payload'];
            if (refs) {
                visual.meshPath = typeof refs === 'string' ? refs : refs[0];
            }
        }
        
        visual.type = geoType;
        
        // Parse transform
        let xyz = { x: 0, y: 0, z: 0 };
        let rpy = { r: 0, p: 0, y: 0 };
        
        // Check for xformOp:translate
        const translate = prim.properties['xformOp:translate'];
        if (Array.isArray(translate) && translate.length >= 3) {
            xyz = { x: translate[0], y: translate[1], z: translate[2] };
        }
        
        // Check for xformOp:rotateXYZ (in degrees)
        const rotateXYZ = prim.properties['xformOp:rotateXYZ'];
        if (Array.isArray(rotateXYZ) && rotateXYZ.length >= 3) {
            rpy = { 
                r: rotateXYZ[0] * Math.PI / 180, 
                p: rotateXYZ[1] * Math.PI / 180, 
                y: rotateXYZ[2] * Math.PI / 180 
            };
        }
        
        // Create link
        const link: UrdfLink = {
            ...DEFAULT_LINK,
            id: linkId,
            name: prim.name,
            visual
        };
        links[linkId] = link;
        
        // Create joint if there's a parent
        if (parentLinkId) {
            const jointId = `joint_${jointCounter++}`;
            const joint: UrdfJoint = {
                ...DEFAULT_JOINT,
                id: jointId,
                name: jointId,
                type: JointType.FIXED, // Default to fixed, could be improved with physics analysis
                parentLinkId: parentLinkId,
                childLinkId: linkId,
                origin: { xyz, rpy },
                axis: { x: 0, y: 0, z: 1 }
            };
            joints[jointId] = joint;
        } else if (!rootLinkId) {
            rootLinkId = linkId;
        }
        
        // Process children
        prim.children.forEach(child => {
            processPrim(child, linkId);
        });
        
        return linkId;
    }
    
    // Process all root prims
    rootPrims.forEach(prim => {
        processPrim(prim, null);
    });
    
    // Ensure we have a root link
    if (!rootLinkId) {
        rootLinkId = 'base_link';
        links[rootLinkId] = {
            ...DEFAULT_LINK,
            id: rootLinkId,
            name: 'base_link'
        };
    }
    
    return {
        name: modelName,
        links,
        joints,
        rootLinkId,
        selection: { type: 'link', id: rootLinkId }
    };
}

/**
 * Parse USDA (ASCII USD) content and convert to RobotState
 */
export function parseUSDA(content: string): RobotState | null {
    try {
        // Remove comments
        const cleanedContent = content
            .split('\n')
            .map(line => {
                const commentIndex = line.indexOf('#');
                return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
            })
            .join('\n');
        
        // Tokenize
        const tokens = tokenizeUSDA(cleanedContent);
        
        // Find model name from header
        let modelName = 'usd_model';
        const docHeader = tokens.findIndex(t => t.includes('defaultPrim'));
        if (docHeader >= 0 && tokens[docHeader + 2]) {
            modelName = tokens[docHeader + 2].replace(/^["']|["']$/g, '');
        }
        
        // Parse prims
        const { prims } = parseUSDAPrims(tokens, 0, '');
        
        if (prims.length === 0) {
            console.warn('[USD Parser] No prims found in USD file');
            return null;
        }
        
        return usdToRobotState(prims, modelName);
        
    } catch (error) {
        console.error('[USD Parser] Failed to parse USDA:', error);
        return null;
    }
}

/**
 * Check if content is likely a USDA file
 */
export function isUSDA(content: string): boolean {
    // USDA files typically start with #usda or contain "def " declarations
    const trimmed = content.trim();
    return trimmed.startsWith('#usda') || 
           /^def\s+\w+/.test(trimmed) ||
           content.includes('defaultPrim');
}

/**
 * Note: Binary USD (.usdc, .usd) files cannot be parsed directly in browser
 * without a proper USD library. This parser only supports USDA (ASCII) format.
 */
export function isUSDCBinary(content: ArrayBuffer): boolean {
    const view = new DataView(content);
    // Check for "PXR-USDC" magic bytes
    const magic = String.fromCharCode(
        view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3),
        view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7)
    );
    return magic === 'PXR-USDC';
}
