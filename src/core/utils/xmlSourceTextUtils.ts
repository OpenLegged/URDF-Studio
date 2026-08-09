/**
 * 纯 XML 源文本原语：属性转义、正则转义、缩进/换行探测、属性增删改。
 *
 * 这些函数原先在 sourcePreservingExportUtils / mjcfEditableSourcePatchHelpers /
 * jointEditableSourcePatch / skeletonGenerator / canonicalWorkspaceViewerDocument
 * 各自重复定义，收口到 core/utils 作为单一所有者。
 *
 * 放在 core/ 而非 shared/ 是依赖方向决定的：core/parsers/mjcf 的两个消费者
 * 不能 import shared（方向 shared -> core），core/utils 是所有消费者可达的最底层。
 *
 * 注意：escapeXmlAttribute 只转义 `& " < >`，不转义单引号 `'`。
 * mjcfGeneratorUtils.ts 另有一份会额外转义 `'` 的变体，属不同合约，未合并。
 */

/** 转义 XML 属性值里的 `& " < >`（不含单引号）。 */
export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 转义正则元字符，用于把任意字符串安全嵌入 RegExp。 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 探测源文本使用的换行符：含 \r\n 用 \r\n，否则 \n。 */
export function getPreferredNewline(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/** 返回 index 所在行的行首偏移（含 index 本身所在行）。 */
export function getLineStart(source: string, index: number): number {
  let cursor = index;
  while (cursor > 0) {
    const previous = source[cursor - 1];
    if (previous === '\n' || previous === '\r') {
      break;
    }
    cursor -= 1;
  }
  return cursor;
}

/** 返回 index 处的行前导空白（空格/制表符）。 */
export function getIndentAt(source: string, index: number): string {
  const lineStart = getLineStart(source, index);
  const match = source.slice(lineStart, index).match(/^[ \t]*/);
  return match?.[0] ?? '';
}

/**
 * 在 rawTag（单个开/自闭合标签原文）上增删改属性：
 * - nextValue 为 null → 移除属性；
 * - 属性已存在 → 替换其值；
 * - 否则在标签尾插入 `attributeName="nextValue"`。
 *
 * 注意：空字符串 `''` 在此合约里视为"设为空值"而非"移除"。
 * sourcePreservingExportUtils 的 replaceOrInsertAttribute 把 `''` 当作移除，
 * 语义不同，未合并，仍保留为该文件本地函数。
 */
export function replaceOrRemoveXmlAttribute(
  rawTag: string,
  attributeName: string,
  nextValue: string | null,
): string {
  const attrRe = new RegExp(`\\s+${escapeRegex(attributeName)}\\s*=\\s*(["']).*?\\1`, 'i');
  if (nextValue == null) {
    return rawTag.replace(attrRe, '');
  }

  if (attrRe.test(rawTag)) {
    return rawTag.replace(
      new RegExp(`(\\s+${escapeRegex(attributeName)}\\s*=\\s*)(["']).*?\\2`, 'i'),
      (_match, prefix: string, quote: string) =>
        `${prefix}${quote}${escapeXmlAttribute(nextValue)}${quote}`,
    );
  }

  return rawTag.replace(/(\s*\/?>)$/, ` ${attributeName}="${escapeXmlAttribute(nextValue)}"$1`);
}
