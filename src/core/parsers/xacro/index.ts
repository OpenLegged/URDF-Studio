/**
 * Xacro Parser Module
 * Provides parsing and processing of ROS Xacro format
 */

export {
    isXacro,
    processXacro,
    processXacroWithDiagnostics,
    parseXacro,
    getXacroArgs
} from './xacroParser';

export type { ProcessedXacroResult, XacroArgs, XacroFileMap } from './xacroParser';
