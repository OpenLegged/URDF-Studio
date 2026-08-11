import { escapeRegex } from '@/core/utils/xmlSourceTextUtils';

export interface XmlElementOccurrence {
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
  rawOpenTag: string;
}

const XML_NAME_ATTR_RE = /\bname\s*=\s*(["'])(.*?)\1/i;

function buildXmlTagNamesRegExp(tagNames: string[]): RegExp {
  return new RegExp(
    `<\\s*(\\/?)(${tagNames.map(escapeRegex).join('|')})\\b[^>]*>`,
    'gi',
  );
}

export function findNamedXmlElementByTagNames(
  sourceContent: string,
  tagNames: string[],
  name: string,
): XmlElementOccurrence | null {
  const tagRe = buildXmlTagNamesRegExp(tagNames);
  const stack: Array<{
    start: number;
    openEnd: number;
    rawOpenTag: string;
    tagName: string;
    matchesName: boolean;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(sourceContent)) !== null) {
    const rawTag = match[0];
    const isClosingTag = match[1] === '/';
    const matchedTagName = match[2] ?? '';

    if (isClosingTag) {
      let openTagIndex = -1;
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index]?.tagName === matchedTagName) {
          openTagIndex = index;
          break;
        }
      }
      const openTag = openTagIndex >= 0 ? stack.splice(openTagIndex, 1)[0] : null;
      if (!openTag) {
        continue;
      }
      if (openTag.matchesName) {
        return {
          start: openTag.start,
          openEnd: openTag.openEnd,
          closeStart: match.index,
          end: match.index + rawTag.length,
          selfClosing: false,
          rawOpenTag: openTag.rawOpenTag,
        };
      }
      continue;
    }

    const isSelfClosing = /\/\s*>$/.test(rawTag);
    const matchedName = XML_NAME_ATTR_RE.exec(rawTag)?.[2]?.trim() ?? '';
    if (isSelfClosing && matchedName === name) {
      return {
        start: match.index,
        openEnd: match.index + rawTag.length,
        closeStart: match.index + rawTag.length,
        end: match.index + rawTag.length,
        selfClosing: true,
        rawOpenTag: rawTag,
      };
    }

    if (!isSelfClosing) {
      stack.push({
        start: match.index,
        openEnd: match.index + rawTag.length,
        rawOpenTag: rawTag,
        tagName: matchedTagName,
        matchesName: matchedName === name,
      });
    }
  }

  return null;
}

export function findNamedXmlElement(
  sourceContent: string,
  tagName: string,
  name: string,
): XmlElementOccurrence | null {
  return findNamedXmlElementByTagNames(sourceContent, [tagName], name);
}
