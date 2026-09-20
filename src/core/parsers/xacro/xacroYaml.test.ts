import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { processXacroWithDiagnostics } from './xacroParser';
import { evaluateDataExpression } from './expressionEvaluation';
import { loadXacroYaml } from './yamlLoader';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

const root = `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="palette">
  <xacro:include filename="parts/appearance.xacro"/>
  <link name="base"><visual><geometry><box size="1 1 1"/></geometry>
    <material name="accent"><color rgba="\${accent_rgba}"/></material>
  </visual></link>
</robot>`;
const appearance = `<robot xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:arg name="appearance_config" default="../../config/colors.yaml"/>
  <xacro:property name="appearance" value="\${xacro.load_yaml('$(arg appearance_config)')}" lazy_eval="false"/>
  <xacro:property name="scheme" value="\${appearance.get('scheme', 'custom')}"/>
  <xacro:property name="rgb" value="\${appearance['custom'] if scheme == 'custom' else [c / 255.0 for c in appearance['presets'][scheme]]}"/>
  <xacro:property name="accent_rgba" value="\${' '.join([str(c) for c in rgb]) + ' 1'}"/>
</robot>`;
const presets: Record<string, number[]> = {
  black: [24, 26, 29], light_green: [196, 214, 164], light_blue: [189, 214, 230], light_orange: [239, 209, 159],
};
function files(scheme: string) {
  return {
    'pkg/urdf/parts/appearance.xacro': appearance,
    'pkg/config/colors.yaml': `scheme: ${scheme}\ncustom: [0.42, 0.63, 0.74]\npresets:\n${Object.entries(presets).map(([name, rgb]) => `  ${name}: [${rgb.join(', ')}]`).join('\n')}`,
  };
}
for (const scheme of [...Object.keys(presets), 'custom']) {
  test(`included YAML palette: ${scheme}`, () => {
    const result = processXacroWithDiagnostics(root, {}, files(scheme), 'pkg/urdf');
    const expected = scheme === 'custom' ? [0.42, 0.63, 0.74] : presets[scheme].map(c => c / 255);
    const doc = new DOMParser().parseFromString(result.content, 'text/xml');
    assert.equal(doc.querySelector('color')?.getAttribute('rgba'), [...expected, 1].join(' '));
    assert.deepEqual(result.recoveryDiagnostics, []);
  });
}

test('explicit YAML argument overrides included default without mutating caller arguments', () => {
  const args = { appearance_config: '../../config/custom.yml' };
  const map = { ...files('light_blue'), 'pkg/config/custom.yml': 'custom: [0.2, 0.3, 0.4]' };
  const result = processXacroWithDiagnostics(root, args, map, 'pkg/urdf');
  assert.match(result.content, /rgba="0.2 0.3 0.4 1"/);
  assert.deepEqual(args, { appearance_config: '../../config/custom.yml' });
});

test('missing, malformed or unsupported YAML does not silently become black', () => {
  const map = files('light_blue');
  delete map['pkg/config/colors.yaml'];
  assert.throws(() => processXacroWithDiagnostics(root, {}, map, 'pkg/urdf'), /YAML.*was not imported/);
  for (const badYaml of ['rgb: [1, 2', 'rgb: !unsupported [1, 2, 3]', 'rgb: 1\nrgb: 2']) {
    assert.throws(() => loadXacroYaml('colors.yaml', 'config', { 'config/colors.yaml': badYaml }), /Invalid YAML/);
  }
  assert.throws(() => processXacroWithDiagnostics(root, {}, files('unknown'), 'pkg/urdf'), /Cannot resolve material color/);
});

test('YAML paths honor package scope and do not fall back to a different basename', () => {
  const map = { 'workspace/a/config/colors.yaml': 'value: 1', 'workspace/b/config/colors.yaml': 'value: 2' };
  assert.deepEqual(loadXacroYaml('$(find b)/config/colors.yaml', '', map), { value: 2 });
  assert.throws(() => loadXacroYaml('../config/colors.yaml', 'missing/urdf', map), /was not imported/);
});

const context = { resolve: (name: string) => name === 'data' ? { rgb: [0.1, 0.2, 0.3] } : undefined,
  arg: () => 'blue', loadYaml: () => ({}) };
test('expression interpreter keeps quoted strings and lazy branches intact', () => {
  assert.equal(evaluateDataExpression("'data' + ' blue'", context), 'data blue');
  assert.equal(evaluateDataExpression("data.rgb[1] if True else missing['key']", context), 0.2);
  assert.equal(evaluateDataExpression('-(-1.25) + 2 * 3', context), 7.25);
  assert.equal(evaluateDataExpression("xacro.arg('scheme') == 'blue' and not False", context), true);
  assert.equal(evaluateDataExpression('False and missing', context), false);
});

test('expression interpreter cannot call host functions or access prototypes', () => {
  for (const expr of ["data.__proto__", "data['constructor']", "data.get('__proto__')", "globalThis.process.exit()", "'x'.constructor('return globalThis')()", "__import__('os')", "[1]; alert(1)"]) {
    assert.throws(() => evaluateDataExpression(expr, context), undefined, expr);
  }
});

test('unsupported XML block properties cannot recurse indefinitely during substitution', () => {
  const result = processXacroWithDiagnostics(`<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="block">
    <xacro:property name="shape"><box size="1 1 1"/></xacro:property>
    <link name="base"/>
  </robot>`);
  assert.match(result.content, /<link name="base"/);
});
