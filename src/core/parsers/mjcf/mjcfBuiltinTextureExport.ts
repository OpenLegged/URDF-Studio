import type { MjcfBuiltinTexture } from '@/types';
import { escapeXmlAttribute } from './mjcfGeneratorUtils';

export function serializeMjcfBuiltinTexture(
  name: string,
  texture: MjcfBuiltinTexture,
  format: (value: number) => string,
): string {
  const attrs = [
    `name="${escapeXmlAttribute(name)}"`,
    `type="${escapeXmlAttribute(texture.type || '2d')}"`,
    `builtin="${texture.builtin}"`,
  ];
  for (const key of ['rgb1', 'rgb2', 'markrgb'] as const) {
    if (texture[key]) attrs.push(`${key}="${texture[key].map(format).join(' ')}"`);
  }
  if (texture.mark) attrs.push(`mark="${escapeXmlAttribute(texture.mark)}"`);
  for (const key of ['width', 'height'] as const) {
    const value = texture[key];
    if (value !== undefined) attrs.push(`${key}="${format(value)}"`);
  }
  return `    <texture ${attrs.join(' ')} />\n`;
}
