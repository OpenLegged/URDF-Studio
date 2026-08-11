import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import type { RobotFile } from '@/types';
import { parseEditableRobotSource } from './parseEditableRobotSource.ts';

const { window } = new JSDOM();

if (!globalThis.DOMParser) {
  globalThis.DOMParser = window.DOMParser;
}
if (!globalThis.XMLSerializer) {
  globalThis.XMLSerializer = window.XMLSerializer;
}

function createXacroFile(
  name = 'robots/demo/demo.urdf.xacro',
  content = `
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
      <xacro:macro name="demo_link" params="link_name">
        <link name="\${link_name}" />
      </xacro:macro>
      <xacro:demo_link link_name="base_link" />
    </robot>
  `,
): RobotFile {
  return {
    name,
    format: 'xacro',
    content,
  };
}

test('parseEditableRobotSource parses xacro source using xacro semantics', () => {
  const file = createXacroFile();

  const parsed = parseEditableRobotSource({
    file,
    content: file.content,
    availableFiles: [file],
  });

  assert.ok(parsed);
  assert.equal(parsed?.name, 'demo');
  assert.ok(parsed?.links.base_link);
});

test('parseEditableRobotSource resolves xacro includes from all file contents', () => {
  const rootFile = createXacroFile(
    'robots/demo/root.urdf.xacro',
    `
      <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
        <xacro:include filename="robots/demo/includes/link.xacro" />
      </robot>
    `,
  );

  const parsed = parseEditableRobotSource({
    file: rootFile,
    content: rootFile.content,
    availableFiles: [rootFile],
    allFileContents: {
      'robots/demo/includes/link.xacro': `
        <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="included">
          <link name="base_link" />
        </robot>
      `,
    },
  });

  assert.ok(parsed);
  assert.ok(parsed?.links.base_link);
});

test('parseEditableRobotSource omits a broken MJCF include and keeps healthy bodies', () => {
  const file: RobotFile = {
    name: 'robots/demo/scene.xml',
    format: 'mjcf',
    content: `<mujoco model="partial">
  <include file="missing.xml" />
  <worldbody><body name="base_link" /></worldbody>
</mujoco>`,
  };

  const parsed = parseEditableRobotSource({
    file,
    content: file.content,
    availableFiles: [file],
  });

  assert.ok(parsed?.links.base_link);
  assert.equal(parsed?.inspectionContext?.recovery?.recoveredItemCount, 1);
  assert.match(parsed?.inspectionContext?.recovery?.diagnostics[0]?.message ?? '', /missing\.xml/);
});

test('parseEditableRobotSource parses sdf source using sdf semantics', () => {
  const file = {
    name: 'robots/demo/model.sdf',
    format: 'sdf' as unknown as RobotFile['format'],
    content: `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo_sdf">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <box>
            <size>1 2 3</size>
          </box>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
  };

  const parsed = parseEditableRobotSource({
    file,
    content: file.content,
    availableFiles: [file],
  });

  assert.ok(parsed);
  assert.equal(parsed?.name, 'demo_sdf');
  assert.ok(parsed?.links.base_link);
});

test('parseEditableRobotSource resolves gazebo material scripts from all file contents for sdf files', () => {
  const file = {
    name: 'robots/demo/model.sdf',
    format: 'sdf' as unknown as RobotFile['format'],
    content: `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo_sdf">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <box>
            <size>1 2 3</size>
          </box>
        </geometry>
        <material>
          <script>
            <uri>model://demo/materials/scripts</uri>
            <uri>model://demo/materials/textures</uri>
            <name>Demo/Diffuse</name>
          </script>
        </material>
      </visual>
    </link>
  </model>
</sdf>`,
  };

  const parsed = parseEditableRobotSource({
    file,
    content: file.content,
    availableFiles: [file],
    allFileContents: {
      'robots/demo/materials/scripts/demo.material': `material Demo/Diffuse
{
  technique
  {
    pass
    {
      texture_unit
      {
        texture demo.png
      }
    }
  }
}`,
    },
  });

  assert.ok(parsed);
  assert.equal(parsed?.links.base_link.visual.materialSource, 'gazebo');
  assert.equal(parsed?.materials?.base_link?.texture, 'demo/materials/textures/demo.png');
});

test('parseEditableRobotSource returns null when recovery leaves no usable entity', () => {
  const file = {
    name: 'robots/demo/broken.sdf',
    format: 'sdf' as unknown as RobotFile['format'],
    content: `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="broken_sdf">
    <link name="base_link">
      <pose relative_to="missing_frame">0 0 0 0 0 0</pose>
    </link>
  </model>
</sdf>`,
  };

  assert.equal(
    parseEditableRobotSource({
      file,
      content: file.content,
      availableFiles: [file],
    }),
    null,
  );
});
