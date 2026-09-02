import test from 'node:test';
import assert from 'node:assert/strict';

import { renderToStaticMarkup } from 'react-dom/server';

import { translations } from '@/shared/i18n';
import { SourceCodeEditorDocumentNavigation } from './SourceCodeEditorChrome';
import type { ActiveSourceCodeDocument } from './sourceCodeEditorModel';

const createDocument = (
  id: string,
  documentFlavor: ActiveSourceCodeDocument['documentFlavor'] = 'urdf',
): ActiveSourceCodeDocument => ({
  id,
  code: '<robot />',
  onCodeChange: () => true,
  fileName: `${id}.urdf`,
  tabLabel: `${id}.urdf`,
  filePath: `robots/${id}.urdf`,
  documentFlavor,
  readOnly: false,
});

const renderNavigation = (
  documents: ActiveSourceCodeDocument[],
  activeDocument: ActiveSourceCodeDocument = documents[0],
): string =>
  renderToStaticMarkup(
    <SourceCodeEditorDocumentNavigation
      activeDocument={activeDocument}
      activeDocumentPath={activeDocument.filePath ?? activeDocument.fileName}
      documents={documents}
      onDocumentDownload={() => {}}
      onDocumentSwitch={() => {}}
      t={translations.en}
    />,
  );

test('inline URDF tabs expose independent document download buttons', () => {
  const documents = [
    createDocument('base'),
    createDocument('arm'),
    createDocument('equivalent', 'equivalent-mjcf'),
  ];

  const markup = renderNavigation(documents);

  assert.match(markup, /data-testid="source-code-document-download-base"/);
  assert.match(markup, /data-testid="source-code-document-download-arm"/);
  assert.doesNotMatch(markup, /data-testid="source-code-document-download-equivalent"/);
  assert.equal((markup.match(/data-testid="source-code-document-download-/g) ?? []).length, 2);
});

test('collapsed document navigation exposes a download button only for the active document', () => {
  const documents = [
    createDocument('base'),
    createDocument('arm'),
    createDocument('gripper'),
    createDocument('sensor'),
    createDocument('tool'),
  ];

  const markup = renderNavigation(documents, documents[2]);

  assert.match(markup, /data-testid="source-code-document-download-gripper"/);
  assert.equal((markup.match(/data-testid="source-code-document-download-/g) ?? []).length, 1);
});
