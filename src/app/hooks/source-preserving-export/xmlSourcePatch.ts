import {
  escapeRegex,
  escapeXmlAttribute,
  getPreferredNewline,
} from '@/core/utils/xmlSourceTextUtils';

export interface XmlElementBounds {
  tagName: string;
  startOffset: number;
  endOffset: number;
  parentTagName: string | null;
}

export interface TextReplacement {
  startOffset: number;
  endOffset: number;
  text: string;
}

interface ApplyRootAttributePatchOptions {
  xml: string;
  sourceRoot: XmlElementBounds;
  generatedRoot: XmlElementBounds;
  generatedXml: string;
  attrNames: string[];
}

export class SourcePreservingExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourcePreservingExportError';
  }
}

const XML_TOKEN_RE =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z_][\w:.-]*)\b[^>]*?>/g;

export function collectXmlElementBounds(xml: string): XmlElementBounds[] {
  const bounds: XmlElementBounds[] = [];
  const stack: Array<{
    tagName: string;
    startOffset: number;
    parentTagName: string | null;
  }> = [];

  XML_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = XML_TOKEN_RE.exec(xml)) !== null) {
    const rawTag = match[0];
    const tagName = match[1];

    if (!tagName) {
      continue;
    }

    if (rawTag.startsWith('</')) {
      const openTag = stack.pop();
      if (!openTag || openTag.tagName !== tagName) {
        continue;
      }

      bounds.push({
        tagName,
        startOffset: openTag.startOffset,
        endOffset: match.index + rawTag.length,
        parentTagName: openTag.parentTagName,
      });
      continue;
    }

    const parentTagName = stack[stack.length - 1]?.tagName ?? null;
    const selfClosing = /\/\s*>$/.test(rawTag);
    if (selfClosing) {
      bounds.push({
        tagName,
        startOffset: match.index,
        endOffset: match.index + rawTag.length,
        parentTagName,
      });
      continue;
    }

    stack.push({
      tagName,
      startOffset: match.index,
      parentTagName,
    });
  }

  return bounds;
}

export function findRootElement(xml: string, tagName: string): XmlElementBounds | null {
  return (
    collectXmlElementBounds(xml).find(
      (element) => element.tagName === tagName && element.parentTagName === null,
    ) ?? null
  );
}

function findOpenTagEnd(xml: string, element: XmlElementBounds): number {
  const endOffset = xml.indexOf('>', element.startOffset);
  return endOffset >= 0 ? endOffset + 1 : element.startOffset;
}

export function getOpenTag(xml: string, element: XmlElementBounds): string {
  return xml.slice(element.startOffset, findOpenTagEnd(xml, element));
}

export function getAttributeValueFromOpenTag(openTag: string, attrName: string): string | null {
  const escapedAttrName = escapeRegex(attrName);
  const match = openTag.match(new RegExp(`\\b${escapedAttrName}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

export function getElementAttribute(
  xml: string,
  element: XmlElementBounds,
  attrName: string,
): string | null {
  return getAttributeValueFromOpenTag(getOpenTag(xml, element), attrName);
}

function replaceOrInsertAttribute(openTag: string, attrName: string, value: string | null): string {
  const escapedAttrName = escapeRegex(attrName);
  const attrRe = new RegExp(`\\b${escapedAttrName}\\s*=\\s*(["'])(.*?)\\1`, 'i');

  if (value == null || value === '') {
    return openTag.replace(new RegExp(`\\s+${escapedAttrName}\\s*=\\s*(["']).*?\\1`, 'i'), '');
  }

  const escapedValue = escapeXmlAttribute(value);
  if (attrRe.test(openTag)) {
    return openTag.replace(attrRe, `${attrName}="${escapedValue}"`);
  }

  return openTag.replace(/\s*\/?>$/, (suffix) => ` ${attrName}="${escapedValue}"${suffix}`);
}

export function applyRootAttributePatch(options: ApplyRootAttributePatchOptions): string {
  const { xml, sourceRoot, generatedRoot, generatedXml, attrNames } = options;
  const sourceOpenTag = getOpenTag(xml, sourceRoot);
  const generatedOpenTag = getOpenTag(generatedXml, generatedRoot);
  const patchedOpenTag = attrNames.reduce(
    (openTag, attrName) =>
      replaceOrInsertAttribute(
        openTag,
        attrName,
        getAttributeValueFromOpenTag(generatedOpenTag, attrName),
      ),
    sourceOpenTag,
  );

  if (patchedOpenTag === sourceOpenTag) {
    return xml;
  }

  return `${xml.slice(0, sourceRoot.startOffset)}${patchedOpenTag}${xml.slice(
    findOpenTagEnd(xml, sourceRoot),
  )}`;
}

export function applyTextReplacements(xml: string, replacements: TextReplacement[]): string {
  return [...replacements]
    .sort((left, right) => right.startOffset - left.startOffset)
    .reduce((content, replacement) => {
      if (replacement.startOffset < 0 || replacement.endOffset < replacement.startOffset) {
        return content;
      }
      return `${content.slice(0, replacement.startOffset)}${replacement.text}${content.slice(
        replacement.endOffset,
      )}`;
    }, xml);
}

export function getClosingTagStart(xml: string, element: XmlElementBounds): number {
  const fragment = xml.slice(element.startOffset, element.endOffset);
  const closeTagRe = new RegExp(`</\\s*${escapeRegex(element.tagName)}\\s*>\\s*$`, 'i');
  const match = fragment.match(closeTagRe);
  if (!match || match.index == null) {
    throw new SourcePreservingExportError(`Cannot locate </${element.tagName}> for source patch.`);
  }
  return element.startOffset + match.index;
}

export function reindentFragment(fragment: string, targetIndent: string): string {
  const lines = fragment.split(/\r?\n/);
  const firstContentLine = lines.find((line) => line.trim().length > 0);
  const sourceIndent = firstContentLine?.match(/^[ \t]*/)?.[0] ?? '';

  return lines
    .map((line) => {
      if (!line.trim()) {
        return line;
      }
      return `${targetIndent}${line.startsWith(sourceIndent) ? line.slice(sourceIndent.length) : line}`;
    })
    .join(getPreferredNewline(fragment));
}

export function collectDirectChildren(xml: string, parentTagName: string): XmlElementBounds[] {
  return collectXmlElementBounds(xml)
    .filter((element) => element.parentTagName === parentTagName)
    .sort((left, right) => left.startOffset - right.startOffset);
}
