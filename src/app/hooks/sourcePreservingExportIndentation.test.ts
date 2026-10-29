import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseMJCF, parseSDF, parseURDF, parseXacro } from '@/core/parsers';
import type { RobotState } from '@/types';
import { applyMJCFSectionPatches } from '@/app/utils/mjcfEditableSourceReconcilerSections';
import { resolveSourcePreservingExportContent } from './sourcePreservingExportUtils';

type SourceFormat = 'urdf' | 'xacro' | 'mjcf' | 'sdf';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

function createSource(format: SourceFormat, position: number): string {
  if (format === 'mjcf') {
    return `<mujoco model="repeated_edit">
  <!-- preserve this source comment -->
  <option timestep="0.002" />
  <worldbody>
    <body name="base_link">
      <geom name="body" type="cylinder" size="0.03 0.075" pos="${position} 0 0" />
    </body>
  </worldbody>
</mujoco>`;
  }
  if (format === 'sdf') {
    return `<sdf version="1.7">
  <!-- preserve this source comment -->
  <model name="repeated_edit">
    <link name="base_link">
      <visual name="body">
        <pose>${position} 0 0 0 0 0</pose>
        <geometry><cylinder><radius>0.03</radius><length>0.15</length></cylinder></geometry>
      </visual>
      <collision name="body_collision">
        <pose>${position} 0 0 0 0 0</pose>
        <geometry><cylinder><radius>0.03</radius><length>0.15</length></cylinder></geometry>
      </collision>
    </link>
  </model>
</sdf>`;
  }
  const namespace = format === 'xacro' ? ' xmlns:xacro="http://www.ros.org/wiki/xacro"' : '';
  return `<robot name="repeated_edit"${namespace}>
  <!-- preserve this source comment -->
  <link name="base_link">
    <visual>
      <origin xyz="${position} 0 0" rpy="0 ${position} 0" />
      <geometry><cylinder radius="0.03" length="0.15" /></geometry>
    </visual>
    <collision>
      <origin xyz="${position} 0 0" rpy="0 ${position} 0" />
      <geometry><cylinder radius="0.03" length="0.15" /></geometry>
    </collision>
  </link>
</robot>`;
}

function parseSource(format: SourceFormat, content: string): RobotState {
  const parsed = format === 'mjcf'
    ? parseMJCF(content)
    : format === 'sdf'
      ? parseSDF(content)
      : format === 'xacro'
        ? parseXacro(content)
        : parseURDF(content);
  assert.ok(parsed, `expected ${format} source to parse`);
  return parsed;
}

function outerElementIndent(format: SourceFormat, source: string): string {
  const tag = format === 'mjcf' ? 'worldbody' : format === 'sdf' ? 'model' : 'link';
  const match = source.match(new RegExp(`^([ \\t]*)<${tag}\\b`, 'm'));
  assert.ok(match, `expected an indented ${tag} element`);
  return match[1]!;
}

function assertRepeatedEdits(format: SourceFormat, initialSource: string, expectedIndent: string): void {
  let source = initialSource;
  let firstEditLength: number | undefined;
  for (let edit = 0; edit < 40; edit += 1) {
    const position = edit % 2 === 0 ? 0.2 : 0.1;
    const generatedContent = createSource(format, position);
    const expectedRobot = parseSource(format, generatedContent);
    const result = resolveSourcePreservingExportContent({
      format,
      currentRobot: expectedRobot,
      sourceFile: { name: `repeated.${format}`, format, content: source },
      generatedContent,
    });
    assert.equal(result.strategy, 'source-preserved');
    // Stop at the first regression: the original bug doubled whitespace per edit.
    assert.equal(outerElementIndent(format, result.content), expectedIndent, `edit ${edit + 1}`);
    assert.ok(result.content.length < initialSource.length + 512, 'source size stays bounded');
    firstEditLength ??= result.content.length;
    assert.equal(result.content.length, firstEditLength, 'equal-width values keep a stable source size');
    assert.match(result.content, /<!-- preserve this source comment -->/);
    if (initialSource.includes('\r\n')) {
      assert.doesNotMatch(result.content, /(?<!\r)\n/, 'replacement keeps source CRLF newlines');
    }
    const actualRobot = parseSource(format, result.content);
    for (const category of ['visual', 'collision'] as const) {
      assert.equal(expectedRobot.links.base_link?.[category].origin?.xyz.x, position);
      assert.deepEqual(
        actualRobot.links.base_link?.[category].origin,
        expectedRobot.links.base_link?.[category].origin,
        `${format} ${category} transform survives edit ${edit + 1}`,
      );
    }
    source = result.content;
  }
}

for (const format of ['urdf', 'xacro', 'mjcf', 'sdf'] as const) {
  test(`repeated ${format} geometry edits preserve indentation and bounded source size`, () => {
    assertRepeatedEdits(format, createSource(format, 0.1), '  ');
  });
}

test('repeated URDF edits preserve tab indentation and CRLF newlines', () => {
  const source = createSource('urdf', 0.1)
    .replace(/^  /gm, '\t')
    .replace(/\n/g, '\r\n');
  assertRepeatedEdits('urdf', source, '\t');
});

test('repeated inline URDF edits preserve text before and after the replaced link', () => {
  let source = `\t${createSource('urdf', 0.1).replace(/\n[ \t]*/g, '')}`;
  const prefix = source.slice(0, source.indexOf('<link '));
  const suffix = source.slice(source.indexOf('</link>') + '</link>'.length);
  let firstEditLength: number | undefined;
  for (let edit = 0; edit < 40; edit += 1) {
    const position = edit % 2 === 0 ? 0.2 : 0.1;
    const generatedContent = createSource('urdf', position);
    const result = resolveSourcePreservingExportContent({
      format: 'urdf',
      currentRobot: parseSource('urdf', generatedContent),
      sourceFile: { name: 'inline.urdf', format: 'urdf', content: source },
      generatedContent,
    });
    assert.equal(result.strategy, 'source-preserved');
    assert.ok(result.content.startsWith(`${prefix}<link `), 'inline prefix is preserved exactly');
    assert.ok(result.content.endsWith(`</link>${suffix}`), 'inline suffix is preserved exactly');
    firstEditLength ??= result.content.length;
    assert.equal(result.content.length, firstEditLength, 'inline edits do not accumulate whitespace');
    assert.equal(parseSource('urdf', result.content).links.base_link.visual.origin?.xyz.x, position);
    source = result.content;
  }
});

test('repeated Xacro control updates preserve indentation when robot geometry is unchanged', () => {
  const controlSource = (namespace: string) => createSource('xacro', 0.1).replace(
    '</robot>',
    `  <gazebo>
    <plugin name="gazebo_ros_control" filename="libgazebo_ros_control.so">
      <robotNamespace>/${namespace}</robotNamespace>
    </plugin>
  </gazebo>
</robot>`,
  );
  let source = controlSource('first');
  const sourceLength = source.length;
  for (let edit = 0; edit < 40; edit += 1) {
    const namespace = edit % 2 === 0 ? 'other' : 'first';
    const generatedContent = controlSource(namespace);
    const result = resolveSourcePreservingExportContent({
      format: 'xacro',
      currentRobot: parseSource('xacro', generatedContent),
      sourceFile: { name: 'controls.xacro', format: 'xacro', content: source },
      generatedContent,
    });
    assert.equal(result.strategy, 'source-preserved');
    assert.equal(result.content.match(/^([ \t]*)<gazebo>/m)?.[1], '  ');
    assert.equal(result.content.length, sourceLength);
    assert.ok(result.content.includes(`<robotNamespace>/${namespace}</robotNamespace>`));
    assert.deepEqual(parseSource('xacro', result.content).links, parseSource('xacro', source).links);
    source = result.content;
  }
});

test('repeated MJCF section reconciliation preserves tab indentation and CRLF', () => {
  let generatedBefore = createSource('mjcf', 0.1);
  let source = generatedBefore.replace(/^  /gm, '\t').replace(/\n/g, '\r\n');
  const sourceLength = source.length;
  for (let edit = 0; edit < 40; edit += 1) {
    const position = edit % 2 === 0 ? 0.2 : 0.1;
    const generatedAfter = createSource('mjcf', position);
    source = applyMJCFSectionPatches({
      sourceContent: source,
      generatedBefore,
      generatedAfter,
      beforeRobot: parseSource('mjcf', generatedBefore),
      afterRobot: parseSource('mjcf', generatedAfter),
    });
    assert.equal(outerElementIndent('mjcf', source), '\t');
    assert.equal(source.length, sourceLength);
    assert.doesNotMatch(source, /(?<!\r)\n/);
    assert.match(source, /<!-- preserve this source comment -->/);
    assert.equal(parseSource('mjcf', source).links.base_link.visual.origin?.xyz.x, position);
    generatedBefore = generatedAfter;
  }
});
