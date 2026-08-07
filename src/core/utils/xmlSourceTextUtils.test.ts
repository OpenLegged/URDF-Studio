import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeXmlAttribute,
  escapeRegex,
  getPreferredNewline,
  getLineStart,
  getIndentAt,
  replaceOrRemoveXmlAttribute,
} from './xmlSourceTextUtils.ts';

test('escapeXmlAttribute escapes XML-significant characters (no single quote)', () => {
  const cases: Array<[input: string, expected: string]> = [
    ['', ''],
    ['plain', 'plain'],
    ['a & b', 'a &amp; b'],
    ['"quoted"', '&quot;quoted&quot;'],
    ['<tag>', '&lt;tag&gt;'],
    ['a & b < c > "d"', 'a &amp; b &lt; c &gt; &quot;d&quot;'],
    [`don't`, `don't`],
  ];
  for (const [input, expected] of cases) {
    assert.equal(escapeXmlAttribute(input), expected, input);
  }
});

test('escapeRegex escapes regex metacharacters so they match literally', () => {
  const metachars = '.*+?^${}()|[]\\';
  for (const char of metachars) {
    const re = new RegExp(`^${escapeRegex(char)}$`);
    assert.match(char, re, `char ${char} should match literally`);
  }
  assert.equal(escapeRegex('plain'), 'plain');
});

test('getPreferredNewline detects crlf vs lf', () => {
  assert.equal(getPreferredNewline('line\r\nline'), '\r\n');
  assert.equal(getPreferredNewline('line\nline'), '\n');
  assert.equal(getPreferredNewline('no newline'), '\n');
  assert.equal(getPreferredNewline('only\rcr'), '\n');
});

test('getLineStart returns the offset of the current line start (including leading whitespace)', () => {
  //            01234 5 67 89...        14 15 16 17 18...
  const src = 'first\n  second\r\n  third';
  assert.equal(getLineStart(src, 0), 0, 'start of file');
  assert.equal(getLineStart(src, 5), 0, 'on the \\n of line 1 still belongs to line 1');
  assert.equal(getLineStart(src, 6), 6, 'first column of line 2 (leading space)');
  assert.equal(getLineStart(src, 8), 6, 'inside line 2 walks back past leading spaces to 6');
  assert.equal(getLineStart(src, 18), 16, 'start of "third" walks back past crlf + leading spaces to 16');
});

test('getIndentAt returns leading whitespace at the column', () => {
  const src = 'first\n    indented\n\ttabbed';
  assert.equal(getIndentAt(src, 0), '', 'no indent at file start');
  const indentedStart = src.indexOf('indented');
  assert.equal(getIndentAt(src, indentedStart), '    ', 'four spaces');
  const tabbedStart = src.indexOf('tabbed');
  assert.equal(getIndentAt(src, tabbedStart), '\t', 'one tab');
});

test('replaceOrRemoveXmlAttribute removes attribute when value is null', () => {
  assert.equal(
    replaceOrRemoveXmlAttribute('<body name="a" pos="1 2 3"/>', 'pos', null),
    '<body name="a"/>',
    'remove self-closing attr',
  );
  assert.equal(
    replaceOrRemoveXmlAttribute('<body name="a" pos="1 2 3">', 'pos', null),
    '<body name="a">',
    'remove open-tag attr',
  );
  assert.equal(
    replaceOrRemoveXmlAttribute('<body name="a"/>', 'pos', null),
    '<body name="a"/>',
    'null on absent attribute is a no-op',
  );
});

test('replaceOrRemoveXmlAttribute replaces existing attribute value', () => {
  assert.equal(
    replaceOrRemoveXmlAttribute('<body name="a" pos="1 2 3"/>', 'pos', '9 8 7'),
    '<body name="a" pos="9 8 7"/>',
    'replace double-quoted value',
  );
  assert.equal(
    replaceOrRemoveXmlAttribute(`<body name='a' pos='1 2 3'/>`, 'pos', '9 8 7'),
    `<body name='a' pos='9 8 7'/>`,
    'replace single-quoted value',
  );
  assert.equal(
    replaceOrRemoveXmlAttribute('<body name="a" pos="1 & 2"/>', 'pos', '<x>'),
    '<body name="a" pos="&lt;x&gt;"/>',
    'new value is XML-escaped',
  );
});

test('replaceOrRemoveXmlAttribute inserts attribute when absent and value set', () => {
  assert.equal(
    replaceOrRemoveXmlAttribute('<body/>', 'name', 'wheel'),
    '<body name="wheel"/>',
    'insert before self-closing',
  );
  assert.equal(
    replaceOrRemoveXmlAttribute('<body>', 'name', 'wheel'),
    '<body name="wheel">',
    'insert before open-tag end',
  );
});

test('replaceOrRemoveXmlAttribute treats empty string as a set-to-empty, not remove', () => {
  assert.equal(
    replaceOrRemoveXmlAttribute('<body name="a" pos="1 2 3"/>', 'pos', ''),
    '<body name="a" pos=""/>',
    'empty string sets empty value (distinct from replaceOrInsertAttribute contract)',
  );
});
