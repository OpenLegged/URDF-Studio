import { isMJCF } from './mjcf/mjcfParser';
import { looksLikeMJCFSourceDocument } from './mjcf/mjcfXml';
import { isSDF } from './sdf/sdfParser';
import { isUSDA } from './usd';
import { isXacro } from './xacro';

export type RobotDefinitionFormat = 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf';

const USD_EXTENSIONS = ['.usd', '.usda', '.usdc', '.usdz'];
const ROBOT_DEFINITION_EXTENSIONS = ['.urdf', '.sdf', '.xml', '.mjcf', ...USD_EXTENSIONS, '.xacro'];

function detectXmlRobotDefinitionFormat(content: string): RobotDefinitionFormat | null {
  if (isMJCF(content) || looksLikeMJCFSourceDocument(content)) return 'mjcf';
  if (isSDF(content)) return 'sdf';
  if (isXacro(content)) return 'xacro';
  if (content.includes('<robot')) return 'urdf';
  return null;
}

function detectContentRobotDefinitionFormat(content: string): RobotDefinitionFormat | null {
  if (isUSDA(content)) return 'usd';
  return detectXmlRobotDefinitionFormat(content);
}

export function detectRobotDefinitionFormat(
  content: string,
  filename: string,
): RobotDefinitionFormat | null {
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith('.xacro') || lowerName.endsWith('.urdf.xacro')) return 'xacro';
  if (lowerName.endsWith('.urdf')) return 'urdf';
  if (lowerName.endsWith('.mjcf')) return 'mjcf';
  if (lowerName.endsWith('.sdf')) return 'sdf';
  if (USD_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return 'usd';
  }

  if (lowerName.endsWith('.xml')) {
    return detectXmlRobotDefinitionFormat(content);
  }

  return detectContentRobotDefinitionFormat(content);
}

export function isRobotDefinitionPath(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  return ROBOT_DEFINITION_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}
