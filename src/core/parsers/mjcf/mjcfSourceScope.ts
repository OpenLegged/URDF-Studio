// Source-local compiler, resource path and identifier scopes used when composing MJCF files.

export function normalizePath(path: string): string {
  const slashNormalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  const hasLeadingSlash = slashNormalized.startsWith('/');
  const parts = slashNormalized.split('/').filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  const normalized = resolved.join('/');
  if (!normalized) {
    return hasLeadingSlash ? '/' : '';
  }

  return hasLeadingSlash ? `/${normalized}` : normalized;
}

export function getBasePath(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split('/');
  parts.pop();
  return parts.join('/');
}

export function getCombinedCompilerAttributes(doc: Document): {
  angle: string;
  assetdir: string;
  meshdir: string;
  texturedir: string;
  eulerseq: string;
} {
  let angle = 'degree';
  let assetdir = '';
  let meshdir: string | null = null;
  let texturedir: string | null = null;
  let eulerseq = 'xyz';

  doc.querySelectorAll('compiler').forEach((compilerEl) => {
    const nextAngle = compilerEl.getAttribute('angle');
    if (nextAngle) {
      angle = nextAngle;
    }

    const nextAssetdir = compilerEl.getAttribute('assetdir');
    if (nextAssetdir !== null) {
      assetdir = nextAssetdir;
    }

    const nextMeshdir = compilerEl.getAttribute('meshdir');
    if (nextMeshdir !== null) {
      meshdir = nextMeshdir;
    }

    const nextTexturedir = compilerEl.getAttribute('texturedir');
    if (nextTexturedir !== null) {
      texturedir = nextTexturedir;
    }

    const nextEulerSeq = compilerEl.getAttribute('eulerseq');
    if (nextEulerSeq) {
      eulerseq = nextEulerSeq;
    }
  });

  return {
    angle,
    assetdir,
    meshdir: meshdir ?? assetdir,
    texturedir: texturedir ?? assetdir,
    eulerseq,
  };
}

export function prefixIdentifier(value: string, prefix: string): string {
  const trimmed = value.trim();
  if (!trimmed || !prefix) {
    return trimmed;
  }

  return `${prefix}${trimmed}`;
}

export function applyAssetDirectory(filePath: string, directory: string): string {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes(':')) {
    return trimmed;
  }

  const normalizedDirectory = normalizePath(directory);
  if (!normalizedDirectory) {
    return normalizePath(trimmed);
  }

  return normalizePath(`${normalizedDirectory}/${trimmed}`);
}

export function prefixAttachedModelDocument(doc: Document, prefix: string, sourceFilePath: string): void {
  const compilerAttrs = getCombinedCompilerAttributes(doc);
  // Root paths address the imported file bundle, avoiding both the host compiler's
  // directories and a second relocation when nested attachments are expanded.
  const relocateAsset = (filePath: string, directory: string): string => {
    const trimmed = filePath.trim();
    if (trimmed.startsWith('/') || trimmed.includes(':')) {
      return trimmed;
    }
    const scopedPath = directory ? `${directory}/${trimmed}` : trimmed;
    if (scopedPath.includes(':')) return scopedPath;
    // Resolve .. only after joining the source directory, otherwise a sibling
    // asset directory would incorrectly become a child of the model directory.
    return normalizePath(scopedPath.startsWith('/')
      ? scopedPath
      : `/${getBasePath(sourceFilePath)}/${scopedPath}`);
  };
  const referenceAttributes = [
    'mesh',
    'hfield',
    'material',
    'texture',
    'class',
    'childclass',
    'joint',
    'joint1',
    'joint2',
    'body',
    'body1',
    'body2',
    'site',
    'site1',
    'site2',
    'sidesite',
    'geom',
    'geom1',
    'geom2',
    'tendon',
    'tendon1',
    'tendon2',
    'actuator',
    'objname',
    'name1',
    'name2',
  ] as const;
  const elements = Array.from(doc.querySelectorAll('*'));

  elements.forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    const name = element.getAttribute('name');
    if (name) {
      element.setAttribute('name', prefixIdentifier(name, prefix));
    }

    if (tagName === 'default') {
      const className = element.getAttribute('class');
      if (className) {
        element.setAttribute('class', prefixIdentifier(className, prefix));
      }
    }
  });

  elements.forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    referenceAttributes.forEach((attributeName) => {
      if (tagName === 'default' && attributeName === 'class') {
        return;
      }

      const value = element.getAttribute(attributeName);
      if (!value) {
        return;
      }

      element.setAttribute(attributeName, prefixIdentifier(value, prefix));
    });

    if (tagName === 'mesh' || tagName === 'hfield') {
      const fileAttr = element.getAttribute('file');
      if (fileAttr) {
        element.setAttribute('file', relocateAsset(fileAttr, compilerAttrs.meshdir));
      }
    }

    if (tagName === 'texture') {
      for (const attribute of ['file', 'fileback', 'filedown', 'filefront', 'fileleft', 'fileright', 'fileup']) {
        const fileAttr = element.getAttribute(attribute);
        if (fileAttr) {
          element.setAttribute(attribute, relocateAsset(fileAttr, compilerAttrs.texturedir));
        }
      }
    }
  });
}
