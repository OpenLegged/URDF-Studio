/**
 * Xacro Parser - Basic xacro processing for browser environment
 *
 * Supports:
 * - <xacro:property> definitions
 * - ${...} variable substitution
 * - <xacro:include> (requires file content map)
 * - <xacro:macro> definitions and calls
 * - <xacro:if> / <xacro:unless> conditionals
 * - <xacro:arg> for command-line style arguments
 *
 * Limitations:
 * - No Python expression evaluation (only simple variable substitution)
 * - $(find package) not supported (requires ROS environment)
 * - Complex expressions need manual simplification
 */

import { RobotState } from '@/types';
import { parseURDF } from '@/core/parsers/urdf';

export interface XacroArgs {
    [key: string]: string;
}

export interface XacroFileMap {
    [path: string]: string;
}

interface XacroContext {
    properties: Map<string, string>;
    macros: Map<string, { params: string[], body: string }>;
    args: XacroArgs;
    fileMap: XacroFileMap;
    basePath: string;
}

/**
 * Check if content is a xacro file
 */
export function isXacro(content: string): boolean {
    return content.includes('xacro:') ||
           content.includes('xmlns:xacro') ||
           /\$\{[^}]+\}/.test(content);
}

/**
 * Preprocess XML content to fix common issues
 */
function preprocessXML(content: string): string {
    // Remove XML declaration if it's not at the start (after comments)
    // Find if there's an XML declaration after content
    const xmlDeclMatch = content.match(/(<\?xml[^?]*\?>)/);
    if (xmlDeclMatch) {
        const declIndex = content.indexOf(xmlDeclMatch[1]);
        // Check if there's non-whitespace content before the declaration
        const beforeDecl = content.substring(0, declIndex).trim();
        if (beforeDecl.length > 0) {
            // Remove the declaration as it's in an invalid position
            content = content.replace(xmlDeclMatch[1], '');
        }
    }

    return content.trim();
}

/**
 * Parse xacro:arg elements to get default values
 */
function parseXacroArgs(content: string): Map<string, string> {
    const args = new Map<string, string>();
    const argRegex = /<xacro:arg\s+name=["']([^"']+)["']\s+default=["']([^"']*)["']\s*\/>/g;

    let match;
    while ((match = argRegex.exec(content)) !== null) {
        args.set(match[1], match[2]);
    }

    return args;
}

/**
 * Parse xacro:property elements
 */
function parseProperties(content: string, ctx: XacroContext): void {
    // Match <xacro:property name="..." value="..."/>
    const propRegex = /<xacro:property\s+name=["']([^"']+)["']\s+value=["']([^"']*)["']\s*\/>/g;

    let match;
    while ((match = propRegex.exec(content)) !== null) {
        const name = match[1];
        let value = match[2];
        // Resolve any ${} in the value
        value = substituteVariables(value, ctx);
        ctx.properties.set(name, value);
    }

    // Also match block-style properties: <xacro:property name="...">value</xacro:property>
    const blockPropRegex = /<xacro:property\s+name=["']([^"']+)["']>([^<]*)<\/xacro:property>/g;
    while ((match = blockPropRegex.exec(content)) !== null) {
        const name = match[1];
        let value = match[2].trim();
        value = substituteVariables(value, ctx);
        ctx.properties.set(name, value);
    }
}

/**
 * Parse xacro:macro definitions
 */
function parseMacros(content: string, ctx: XacroContext): void {
    // Match <xacro:macro name="..." params="...">...</xacro:macro>
    const macroRegex = /<xacro:macro\s+name=["']([^"']+)["']\s+params=["']([^"']*)["']\s*>([\s\S]*?)<\/xacro:macro>/g;

    let match;
    while ((match = macroRegex.exec(content)) !== null) {
        const name = match[1];
        const paramsStr = match[2];
        const body = match[3];

        // Parse params - handle default values like "param:=default"
        const params = paramsStr.split(/\s+/).filter(p => p.length > 0);

        ctx.macros.set(name, { params, body });
    }
}

/**
 * Substitute ${...} variables
 */
function substituteVariables(content: string, ctx: XacroContext): string {
    // Replace $(arg name) with arg value
    content = content.replace(/\$\(arg\s+([^)]+)\)/g, (_, name) => {
        const argName = name.trim();
        if (ctx.args[argName] !== undefined) {
            return ctx.args[argName];
        }
        // Check if there's a default from xacro:arg
        return ctx.properties.get(argName) || `$(arg ${argName})`;
    });

    // Replace ${...} expressions
    content = content.replace(/\$\{([^}]+)\}/g, (match, expr) => {
        const trimmedExpr = expr.trim();

        // Simple variable lookup
        if (ctx.properties.has(trimmedExpr)) {
            return ctx.properties.get(trimmedExpr)!;
        }

        // Check args
        if (ctx.args[trimmedExpr] !== undefined) {
            return ctx.args[trimmedExpr];
        }

        // Try to evaluate simple expressions
        try {
            // Handle simple math expressions
            const numericExpr = trimmedExpr
                .replace(/(\w+)/g, (m) => {
                    if (ctx.properties.has(m)) {
                        return ctx.properties.get(m)!;
                    }
                    if (ctx.args[m] !== undefined) {
                        return ctx.args[m];
                    }
                    return m;
                });

            // Only evaluate if it looks like a safe numeric expression
            if (/^[-+*/\s\d.()]+$/.test(numericExpr)) {
                const result = Function(`"use strict"; return (${numericExpr})`)();
                if (typeof result === 'number' && !isNaN(result)) {
                    return String(result);
                }
            }
        } catch {
            // Keep original if evaluation fails
        }

        // Return original if we can't resolve
        return match;
    });

    return content;
}

/**
 * Find a file in the file map with fuzzy path matching
 */
function findFileInMap(filename: string, ctx: XacroContext): string | null {
    // Extract package name and relative path from $(find package)/path
    const findMatch = filename.match(/\$\(find\s+([^)]+)\)(.*)$/);
    let packageName = '';
    let relativePath = filename;

    if (findMatch) {
        packageName = findMatch[1].trim();
        relativePath = findMatch[2];
    }

    // Remove leading slash
    relativePath = relativePath.replace(/^\//, '');

    const fileMapKeys = Object.keys(ctx.fileMap);

    // Strategy 1: Look for package/relativePath pattern in file map keys
    if (packageName && relativePath) {
        const searchPattern = `${packageName}/${relativePath}`;
        for (const key of fileMapKeys) {
            // Match paths like "sr_common/sr_description/other/xacro/file.xacro"
            // when searching for "sr_description/other/xacro/file.xacro"
            if (key.endsWith(searchPattern) || key === searchPattern) {
                return key;
            }
            // Also check if key contains the pattern
            if (key.includes('/' + searchPattern)) {
                return key;
            }
        }
    }

    // Strategy 2: Try relative to base path
    if (ctx.basePath) {
        // Go up from base path to find package directory
        const baseParts = ctx.basePath.split('/');
        for (let i = baseParts.length; i >= 0; i--) {
            const prefix = baseParts.slice(0, i).join('/');
            const tryPath = prefix ? `${prefix}/${relativePath}` : relativePath;
            if (ctx.fileMap[tryPath]) {
                return tryPath;
            }
            if (packageName) {
                const tryPathWithPkg = prefix ? `${prefix}/${packageName}/${relativePath}` : `${packageName}/${relativePath}`;
                if (ctx.fileMap[tryPathWithPkg]) {
                    return tryPathWithPkg;
                }
            }
        }
    }

    // Strategy 3: Fuzzy search - look for files ending with the relative path
    for (const key of fileMapKeys) {
        if (key.endsWith('/' + relativePath) || key === relativePath) {
            return key;
        }
    }

    // Strategy 4: Search by filename only as last resort
    const justFilename = relativePath.split('/').pop() || '';
    if (justFilename && justFilename.includes('.')) {
        for (const key of fileMapKeys) {
            if (key.endsWith('/' + justFilename) || key === justFilename) {
                return key;
            }
        }
    }

    return null;
}

/**
 * Process xacro:include elements
 */
function processIncludes(content: string, ctx: XacroContext): string {
    // Match <xacro:include filename="..."/>
    const includeRegex = /<xacro:include\s+filename=["']([^"']+)["']\s*\/>/g;

    return content.replace(includeRegex, (match, filename) => {
        const foundPath = findFileInMap(filename, ctx);

        if (foundPath && ctx.fileMap[foundPath]) {
            // Recursively process the included file
            let includedContent = ctx.fileMap[foundPath];
            includedContent = preprocessXML(includedContent);

            // Update base path for nested includes
            const oldBasePath = ctx.basePath;
            const pathParts = foundPath.split('/');
            pathParts.pop(); // Remove filename
            ctx.basePath = pathParts.join('/');

            // Parse properties and macros from included file
            parseProperties(includedContent, ctx);
            parseMacros(includedContent, ctx);

            // Process nested includes
            includedContent = processIncludes(includedContent, ctx);

            // Restore base path
            ctx.basePath = oldBasePath;

            // Remove robot tags from included content to avoid nesting
            includedContent = includedContent
                .replace(/<\?xml[^?]*\?>/g, '')
                .replace(/<robot[^>]*>/g, '')
                .replace(/<\/robot>/g, '');

            return includedContent;
        }

        // If file not found, return empty (or could return a comment)
        console.warn(`[Xacro] Include file not found: ${filename}`);
        return `<!-- Include not found: ${filename} -->`;
    });
}

/**
 * Expand macro calls
 */
function expandMacros(content: string, ctx: XacroContext): string {
    // Match <xacro:macroname ... /> or <xacro:macroname ...>...</xacro:macroname>
    for (const [macroName, macroDef] of ctx.macros) {
        // Self-closing macro calls
        const selfClosingRegex = new RegExp(
            `<xacro:${macroName}([^/>]*)/>`,
            'g'
        );

        content = content.replace(selfClosingRegex, (match, attrsStr) => {
            return expandMacroCall(macroName, attrsStr, '', macroDef, ctx);
        });

        // Block macro calls
        const blockRegex = new RegExp(
            `<xacro:${macroName}([^>]*)>([\\s\\S]*?)</xacro:${macroName}>`,
            'g'
        );

        content = content.replace(blockRegex, (match, attrsStr, innerContent) => {
            return expandMacroCall(macroName, attrsStr, innerContent, macroDef, ctx);
        });
    }

    return content;
}

/**
 * Expand a single macro call
 */
function expandMacroCall(
    name: string,
    attrsStr: string,
    innerContent: string,
    macroDef: { params: string[], body: string },
    ctx: XacroContext
): string {
    // Parse attributes
    const attrs: Map<string, string> = new Map();
    const attrRegex = /(\w+)=["']([^"']*)["']/g;
    let match;
    while ((match = attrRegex.exec(attrsStr)) !== null) {
        attrs.set(match[1], match[2]);
    }

    // Create local context with macro parameters
    const localCtx: XacroContext = {
        ...ctx,
        properties: new Map(ctx.properties)
    };

    // Set parameter values
    for (const param of macroDef.params) {
        // Handle default values (param:=default or param:=^)
        const [paramName, defaultValue] = param.split(':=');
        const cleanName = paramName.replace(/[*]$/, ''); // Remove block param marker

        if (attrs.has(cleanName)) {
            localCtx.properties.set(cleanName, attrs.get(cleanName)!);
        } else if (defaultValue !== undefined && defaultValue !== '^') {
            localCtx.properties.set(cleanName, defaultValue);
        }
    }

    // Substitute variables in macro body
    let expandedBody = macroDef.body;
    expandedBody = substituteVariables(expandedBody, localCtx);

    // Replace ${*} or any block content placeholder with inner content
    expandedBody = expandedBody.replace(/\$\{\*\}/g, innerContent);

    return expandedBody;
}

/**
 * Process xacro:if and xacro:unless conditionals
 */
function processConditionals(content: string, ctx: XacroContext): string {
    // Process xacro:if
    const ifRegex = /<xacro:if\s+value=["']\$\{([^}]+)\}["']>([\s\S]*?)<\/xacro:if>/g;
    content = content.replace(ifRegex, (match, condition, body) => {
        const value = substituteVariables('${' + condition + '}', ctx);
        // Truthy check: non-empty, not "false", not "0", not "none"
        const isTruthy = value &&
                        value !== 'false' &&
                        value !== '0' &&
                        value !== 'none' &&
                        value !== 'False' &&
                        value !== 'None';
        return isTruthy ? body : '';
    });

    // Process xacro:unless
    const unlessRegex = /<xacro:unless\s+value=["']\$\{([^}]+)\}["']>([\s\S]*?)<\/xacro:unless>/g;
    content = content.replace(unlessRegex, (match, condition, body) => {
        const value = substituteVariables('${' + condition + '}', ctx);
        const isTruthy = value &&
                        value !== 'false' &&
                        value !== '0' &&
                        value !== 'none' &&
                        value !== 'False' &&
                        value !== 'None';
        return isTruthy ? '' : body;
    });

    return content;
}

/**
 * Remove xacro-specific elements that shouldn't be in final output
 */
function cleanupXacroElements(content: string): string {
    // Remove xacro:property definitions
    content = content.replace(/<xacro:property[^>]*\/>/g, '');
    content = content.replace(/<xacro:property[^>]*>[\s\S]*?<\/xacro:property>/g, '');

    // Remove xacro:arg definitions
    content = content.replace(/<xacro:arg[^>]*\/>/g, '');

    // Remove xacro:macro definitions (they've been used for expansion)
    content = content.replace(/<xacro:macro[^>]*>[\s\S]*?<\/xacro:macro>/g, '');

    // Remove remaining unprocessed xacro elements
    content = content.replace(/<xacro:[^>]*\/>/g, '');
    content = content.replace(/<xacro:[^>]*>[\s\S]*?<\/xacro:[^>]*>/g, '');

    // Clean up xmlns:xacro attributes
    content = content.replace(/\s*xmlns:xacro="[^"]*"/g, '');

    // Clean up empty lines
    content = content.replace(/\n\s*\n\s*\n/g, '\n\n');

    return content;
}

/**
 * Process xacro content and convert to URDF
 */
export function processXacro(
    content: string,
    args: XacroArgs = {},
    fileMap: XacroFileMap = {},
    basePath: string = ''
): string {
    // Preprocess XML
    content = preprocessXML(content);

    // Initialize context
    const ctx: XacroContext = {
        properties: new Map(),
        macros: new Map(),
        args,
        fileMap,
        basePath
    };

    // Parse default args from xacro:arg elements
    const defaultArgs = parseXacroArgs(content);
    for (const [name, value] of defaultArgs) {
        if (ctx.args[name] === undefined) {
            ctx.args[name] = value;
        }
    }

    // Multiple passes to handle nested includes and macros
    let prevContent = '';
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (content !== prevContent && iterations < maxIterations) {
        prevContent = content;
        iterations++;

        // Parse properties
        parseProperties(content, ctx);

        // Parse macros
        parseMacros(content, ctx);

        // Process includes
        content = processIncludes(content, ctx);

        // Substitute variables
        content = substituteVariables(content, ctx);

        // Expand macros
        content = expandMacros(content, ctx);

        // Process conditionals
        content = processConditionals(content, ctx);
    }

    // Final cleanup
    content = cleanupXacroElements(content);

    // Convert package:// paths to relative paths for browser compatibility
    content = content.replace(/package:\/\/([^\/]+)\/([^"'<>\s]+)/g, (match, pkg, path) => {
        // Try to find the actual file in the file map
        const pathsToTry = [
            `${pkg}/${path}`,
            path,
            path.split('/').pop() || ''
        ];

        for (const tryPath of pathsToTry) {
            if (ctx.fileMap[tryPath]) {
                return tryPath;
            }
        }

        // Search for matching path in file map
        const fileMapKeys = Object.keys(ctx.fileMap);
        for (const key of fileMapKeys) {
            if (key.endsWith(path) || key.endsWith('/' + path)) {
                return key;
            }
        }

        // Return just the relative path (mesh loader will handle it)
        return path;
    });

    // Ensure proper XML structure
    if (!content.includes('<robot')) {
        content = `<robot name="xacro_robot">${content}</robot>`;
    }

    return content;
}

/**
 * Parse xacro content and return RobotState
 */
export function parseXacro(
    content: string,
    args: XacroArgs = {},
    fileMap: XacroFileMap = {},
    basePath: string = ''
): RobotState | null {
    try {
        const urdfContent = processXacro(content, args, fileMap, basePath);
        return parseURDF(urdfContent);
    } catch (error) {
        console.error('[Xacro Parser] Failed to parse xacro:', error);
        return null;
    }
}

/**
 * Extract required xacro:arg names from content
 */
export function getXacroArgs(content: string): { name: string, defaultValue: string }[] {
    const args: { name: string, defaultValue: string }[] = [];
    const argRegex = /<xacro:arg\s+name=["']([^"']+)["']\s+default=["']([^"']*)["']\s*\/>/g;

    let match;
    while ((match = argRegex.exec(content)) !== null) {
        args.push({ name: match[1], defaultValue: match[2] });
    }

    return args;
}
