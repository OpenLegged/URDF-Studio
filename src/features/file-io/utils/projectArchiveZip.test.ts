import test from 'node:test';
import assert from 'node:assert/strict';

import JSZip from 'jszip';

import { buildProjectArchiveBlob } from './projectArchiveZip.ts';

test('buildProjectArchiveBlob normalizes blob entries in Node environments', async () => {
  const archiveBlob = await buildProjectArchiveBlob(
    new Map<string, string | Blob>([
      ['README.md', '# archive'],
      ['meshes/base.obj', new Blob(['o base\nv 0 0 0\n'], { type: 'text/plain;charset=utf-8' })],
    ]),
  );

  const zip = await JSZip.loadAsync(await archiveBlob.arrayBuffer());

  assert.equal(await zip.file('README.md')?.async('string'), '# archive');
  assert.equal(await zip.file('meshes/base.obj')?.async('string'), 'o base\nv 0 0 0\n');
});

test('buildProjectArchiveBlob is deterministic and rejects unsafe paths', async () => {
  const entries = new Map<string, string>([
    ['scene/state.json', '{"ok":true}'],
    ['manifest.json', '{"schemaVersion":"test"}'],
  ]);
  const first = new Uint8Array(await (await buildProjectArchiveBlob(entries)).arrayBuffer());
  const second = new Uint8Array(await (await buildProjectArchiveBlob(
    new Map([...entries].reverse()),
  )).arrayBuffer());

  assert.deepEqual(first, second);
  await assert.rejects(
    buildProjectArchiveBlob(new Map([['../escape.json', '{}']])),
    /path/i,
  );
});
