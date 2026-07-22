#!/usr/bin/env node
import { readFile, readdir, stat as readStat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const DEFAULT_BASELINE_PATH = 'scripts/tools/google_style_baseline.json';
const DEFAULT_SCAN_ROOTS = ['src', 'packages', 'scripts', 'index.html'];
const IGNORED_DIRS = new Set([
  '.git',
  '.playwright-mcp',
  '.tmp',
  '.venv',
  '.worktrees',
  'dist',
  'log',
  'node_modules',
  'output',
  'tmp',
]);
const IGNORED_PREFIXES = [
  'public/',
  'test/usd-viewer/',
  'third_party/',
  'src/features/urdf-viewer/runtime/',
];
const SCANNED_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const JS_TS_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const VOID_ELEMENTS = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
];

// Size / complexity hard ceilings (src/** product code only). Each violation is one
// finding; google_style_baseline.json grandfathers the exact current count. Active
// baselines fail in either direction so improvements must be recorded immediately and
// cannot be consumed as headroom by later changes.
const SIZE_BUDGETS = {
  'file-too-long': 800,
  'function-too-long': 200,
  'function-too-complex': 20,
  'too-many-params': 4,
  'too-deep': 4,
};

const RULES = [
  {
    id: 'file-name-snake-case',
    title: 'JS/TS file names use snake_case',
  },
  {
    id: 'file-too-long',
    title: `src file stays under ${SIZE_BUDGETS['file-too-long']} code lines`,
  },
  {
    id: 'function-too-long',
    title: `function body stays under ${SIZE_BUDGETS['function-too-long']} code lines`,
  },
  {
    id: 'function-too-complex',
    title: `function cyclomatic complexity stays under ${SIZE_BUDGETS['function-too-complex']}`,
  },
  {
    id: 'too-many-params',
    title: `function declares at most ${SIZE_BUDGETS['too-many-params']} parameters`,
  },
  {
    id: 'too-deep',
    title: `block nesting stays under ${SIZE_BUDGETS['too-deep']}`,
  },
  {
    id: 'nullable-undefined-type-alias',
    title: 'Type aliases do not include null or undefined',
  },
  {
    id: 'const-enum',
    title: 'Do not use const enum',
  },
  {
    id: 'debugger-production',
    title: 'Do not ship debugger statements in production code',
  },
  {
    id: 'dynamic-code-execution',
    title: 'Avoid eval/new Function',
  },
  {
    id: 'html-inline-style',
    title: 'Keep presentation out of HTML',
  },
  {
    id: 'html-void-element-slash',
    title: 'Do not close HTML void elements with />',
  },
  {
    id: 'html-id-hyphen',
    title: 'HTML id values include a hyphen, except the React root mount',
  },
  {
    id: 'html-class-name',
    title: 'HTML class values use lowercase hyphenated names',
  },
  {
    id: 'css-class-name',
    title: 'CSS class names use lowercase hyphenated names',
  },
  {
    id: 'css-id-selector',
    title: 'Avoid non-hyphenated CSS id selectors',
  },
  {
    id: 'css-zero-unit',
    title: 'Omit units after zero values',
  },
  {
    id: 'css-important',
    title: 'Avoid !important declarations',
  },
  {
    id: 'css-declaration-order',
    title: 'CSS declarations are alphabetical',
  },
];

const ruleIds = new Set(RULES.map((rule) => rule.id));
const options = parseArgs(process.argv.slice(2));
const baseline = options.baselinePath ? await readBaseline(options.baselinePath) : null;
const findings = [];

for (const relPath of await collectFiles(DEFAULT_SCAN_ROOTS)) {
  const absolutePath = path.join(ROOT, relPath);
  const text = await readFile(absolutePath, 'utf8');
  const extension = getScannedExtension(relPath);

  if (JS_TS_EXTENSIONS.has(extension)) {
    auditJsTsFileName(relPath);
    auditTypeScriptText(relPath, text);
    auditJavaScriptText(relPath, text);
    auditSizeAndComplexity(relPath, text);
  }

  if (extension === '.html') {
    auditHtmlText(relPath, text);
  }

  if (extension === '.css') {
    auditCssText(relPath, text);
  }
}

const report = buildReport(findings, baseline);

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report, baseline);
}

if (report.failedRules.length > 0) {
  process.exitCode = 1;
}

function parseArgs(args) {
  const parsed = {
    baselinePath: null,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--check') {
      parsed.baselinePath = DEFAULT_BASELINE_PATH;
      continue;
    }
    if (arg === '--baseline') {
      const baselinePath = args[index + 1];
      if (!baselinePath) {
        throw new Error('--baseline requires a path');
      }
      parsed.baselinePath = baselinePath;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function readBaseline(relPath) {
  const rawBaseline = await readFile(path.join(ROOT, relPath), 'utf8');
  const parsedBaseline = JSON.parse(rawBaseline);
  return {
    path: relPath,
    rules: Object.fromEntries(
      Object.entries(parsedBaseline.rules || {}).map(([ruleId, value]) => [
        ruleId,
        typeof value === 'number' ? { max: value } : value,
      ]),
    ),
  };
}

async function collectFiles(scanRoots) {
  const files = [];

  for (const scanRoot of scanRoots) {
    const absolutePath = path.join(ROOT, scanRoot);
    const stat = await getStat(absolutePath);
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      await walk(scanRoot, files);
    } else if (shouldScanFile(scanRoot)) {
      files.push(toPosix(scanRoot));
    }
  }

  return files.sort();
}

async function walk(relDir, files) {
  const entries = await readdir(path.join(ROOT, relDir), { withFileTypes: true });
  for (const entry of entries) {
    const relPath = toPosix(path.join(relDir, entry.name));
    if (entry.isDirectory()) {
      if (!shouldIgnorePath(relPath)) {
        await walk(relPath, files);
      }
      continue;
    }
    if (entry.isFile() && shouldScanFile(relPath)) {
      files.push(relPath);
    }
  }
}

async function getStat(absolutePath) {
  try {
    return await readStat(absolutePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function shouldScanFile(relPath) {
  if (shouldIgnorePath(relPath)) {
    return false;
  }
  if (/\.generated\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(relPath)) {
    return false;
  }
  return SCANNED_EXTENSIONS.has(getScannedExtension(relPath));
}

function shouldIgnorePath(relPath) {
  const normalized = toPosix(relPath);
  if (
    IGNORED_PREFIXES.some(
      (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
    )
  ) {
    return true;
  }
  return normalized.split('/').some((segment) => IGNORED_DIRS.has(segment));
}

function getScannedExtension(relPath) {
  if (relPath.endsWith('.d.ts')) {
    return '.ts';
  }
  return path.extname(relPath);
}

function auditJsTsFileName(relPath) {
  const fileName = path.basename(relPath);
  const stem = stripKnownExtension(fileName);
  const segments = stem.split('.');
  if (segments.every(isSnakeCaseSegment)) {
    return;
  }
  addFinding('file-name-snake-case', relPath, 1, `File name "${fileName}" is not snake_case.`);
}

function stripKnownExtension(fileName) {
  if (fileName.endsWith('.d.ts')) {
    return fileName.slice(0, -'.d.ts'.length);
  }
  return fileName.replace(/\.(?:cjs|js|jsx|mjs|ts|tsx)$/, '');
}

function isSnakeCaseSegment(segment) {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(segment);
}

function auditTypeScriptText(relPath, text) {
  if (!/\.(?:ts|tsx)$/.test(relPath)) {
    return;
  }

  const sourceFile = ts.createSourceFile(
    relPath,
    text,
    ts.ScriptTarget.Latest,
    true,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  visitTypeScriptNode(sourceFile, (node) => {
    if (ts.isTypeAliasDeclaration(node) && hasTopLevelNullableUnion(node.type)) {
      addFinding(
        'nullable-undefined-type-alias',
        relPath,
        lineForIndex(text, node.getStart(sourceFile)),
        `Nullable/undefined type alias: ${node.name.text}`,
      );
    }
  });

  findMatches(text, /\bconst\s+enum\s+[A-Za-z_$][\w$]*/g, (match, line) => {
    addFinding('const-enum', relPath, line, `Const enum declaration: ${match[0]}`);
  });
}

function visitTypeScriptNode(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visitTypeScriptNode(child, callback));
}

function hasTopLevelNullableUnion(typeNode) {
  const unwrappedTypeNode = unwrapParenthesizedType(typeNode);
  if (!ts.isUnionTypeNode(unwrappedTypeNode)) {
    return false;
  }
  return unwrappedTypeNode.types.some((part) => {
    const unwrappedPart = unwrapParenthesizedType(part);
    return (
      unwrappedPart.kind === ts.SyntaxKind.NullKeyword ||
      unwrappedPart.kind === ts.SyntaxKind.UndefinedKeyword
    );
  });
}

function unwrapParenthesizedType(typeNode) {
  let current = typeNode;
  while (ts.isParenthesizedTypeNode(current)) {
    current = current.type;
  }
  return current;
}

function isSizeBudgetedFile(relPath) {
  if (!relPath.startsWith('src/')) {
    return false;
  }
  if (!/\.(?:ts|tsx)$/.test(relPath)) {
    return false;
  }
  // Tests legitimately have long describe blocks; generated/runtime/vendored files are
  // already filtered out by shouldScanFile before reaching here.
  return !/\.(?:test|spec)\.(?:ts|tsx)$/.test(relPath);
}

function auditSizeAndComplexity(relPath, text) {
  if (!isSizeBudgetedFile(relPath)) {
    return;
  }

  const sourceFile = ts.createSourceFile(
    relPath,
    text,
    ts.ScriptTarget.Latest,
    true,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const fileCodeLines = countCodeLines(text);
  if (fileCodeLines > SIZE_BUDGETS['file-too-long']) {
    addFinding(
      'file-too-long',
      relPath,
      1,
      `File has ${fileCodeLines} code lines (max ${SIZE_BUDGETS['file-too-long']}).`,
    );
  }

  visitTypeScriptNode(sourceFile, (node) => {
    if (!isFunctionWithBlockBody(node)) {
      return;
    }
    const line = lineForIndex(text, node.getStart(sourceFile));
    const label = describeFunction(node);

    const paramCount = countParameters(node);
    if (paramCount > SIZE_BUDGETS['too-many-params']) {
      addFinding(
        'too-many-params',
        relPath,
        line,
        `${label} declares ${paramCount} parameters (max ${SIZE_BUDGETS['too-many-params']}); use an options object.`,
      );
    }

    const bodyLines = countCodeLines(
      text.slice(node.body.getStart(sourceFile), node.body.getEnd()),
    );
    if (bodyLines > SIZE_BUDGETS['function-too-long']) {
      addFinding(
        'function-too-long',
        relPath,
        line,
        `${label} body has ${bodyLines} code lines (max ${SIZE_BUDGETS['function-too-long']}).`,
      );
    }

    const complexity = computeCyclomaticComplexity(node.body);
    if (complexity > SIZE_BUDGETS['function-too-complex']) {
      addFinding(
        'function-too-complex',
        relPath,
        line,
        `${label} has cyclomatic complexity ${complexity} (max ${SIZE_BUDGETS['function-too-complex']}).`,
      );
    }

    const depth = computeMaxBlockDepth(node.body);
    if (depth > SIZE_BUDGETS['too-deep']) {
      addFinding(
        'too-deep',
        relPath,
        line,
        `${label} nests blocks ${depth} deep (max ${SIZE_BUDGETS['too-deep']}).`,
      );
    }
  });
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isFunctionWithBlockBody(node) {
  return isFunctionLike(node) && node.body && ts.isBlock(node.body);
}

function describeFunction(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
    return `Function ${node.name.getText()}`;
  }
  if (ts.isConstructorDeclaration(node)) {
    return 'Constructor';
  }
  if (
    (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
    node.parent &&
    ts.isVariableDeclaration(node.parent) &&
    node.parent.name
  ) {
    return `Function ${node.parent.name.getText()}`;
  }
  return 'Anonymous function';
}

function countParameters(node) {
  return node.parameters.filter(
    (parameter) => !(ts.isIdentifier(parameter.name) && parameter.name.text === 'this'),
  ).length;
}

function countCodeLines(text) {
  let count = 0;
  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }
    // Skip blank lines and lines that are purely comments (// ..., JSDoc * ..., /* ... */, */).
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }
    count += 1;
  }
  return count;
}

function computeCyclomaticComplexity(body) {
  let complexity = 1;
  const walk = (node) => {
    node.forEachChild((child) => {
      if (isFunctionLike(child)) {
        return; // nested functions get their own complexity
      }
      switch (child.kind) {
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.CaseClause:
        case ts.SyntaxKind.CatchClause:
        case ts.SyntaxKind.ConditionalExpression:
          complexity += 1;
          break;
        case ts.SyntaxKind.BinaryExpression: {
          const operator = child.operatorToken.kind;
          if (
            operator === ts.SyntaxKind.AmpersandAmpersandToken ||
            operator === ts.SyntaxKind.BarBarToken ||
            operator === ts.SyntaxKind.QuestionQuestionToken
          ) {
            complexity += 1;
          }
          break;
        }
        default:
          break;
      }
      walk(child);
    });
  };
  walk(body);
  return complexity;
}

function computeMaxBlockDepth(body) {
  let maxDepth = 0;
  const walk = (node, depth) => {
    node.forEachChild((child) => {
      if (isFunctionLike(child)) {
        return; // depth resets at function boundaries
      }
      // Treat `else if` as the same level instead of an extra nesting step.
      if (ts.isIfStatement(node) && child === node.elseStatement && ts.isIfStatement(child)) {
        walk(child, depth);
        return;
      }
      let nextDepth = depth;
      if (isNestingStatement(child)) {
        nextDepth = depth + 1;
        if (nextDepth > maxDepth) {
          maxDepth = nextDepth;
        }
      }
      walk(child, nextDepth);
    });
  };
  walk(body, 0);
  return maxDepth;
}

function isNestingStatement(node) {
  return (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isSwitchStatement(node) ||
    ts.isTryStatement(node)
  );
}

function auditJavaScriptText(relPath, text) {
  if (isProductionCode(relPath)) {
    findMatches(text, /\bdebugger\s*;/g, (_match, line) => {
      addFinding('debugger-production', relPath, line, 'Production debugger statement.');
    });
  }

  findMatches(text, /\b(?:eval\s*\(|new\s+Function\s*\()/g, (match, line) => {
    addFinding('dynamic-code-execution', relPath, line, `Dynamic code execution: ${match[0]}`);
  });
}

function isProductionCode(relPath) {
  return (
    !/(?:^|\/)scripts\/test\//.test(relPath) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relPath)
  );
}

function auditHtmlText(relPath, text) {
  findMatches(text, /<style\b[^>]*>/gi, (_match, line) => {
    addFinding('html-inline-style', relPath, line, 'Inline <style> element.');
  });
  findMatches(text, /\sstyle=(?:"[^"]*"|'[^']*')/gi, (_match, line) => {
    addFinding('html-inline-style', relPath, line, 'Inline style attribute.');
  });

  const voidElementPattern = new RegExp(`<(?:${VOID_ELEMENTS.join('|')})\\b[^>]*\\/\\s*>`, 'gi');
  findMatches(text, voidElementPattern, (match, line) => {
    addFinding(
      'html-void-element-slash',
      relPath,
      line,
      `Closed void element with slash: ${trimSnippet(match[0])}`,
    );
  });

  findMatches(text, /\sid=(?:"([^"]*)"|'([^']*)')/gi, (match, line) => {
    const idValue = match[1] || match[2] || '';
    if (idValue !== 'root' && !idValue.includes('-')) {
      addFinding('html-id-hyphen', relPath, line, `ID "${idValue}" does not include a hyphen.`);
    }
  });

  findMatches(text, /\sclass=(?:"([^"]*)"|'([^']*)')/gi, (match, line) => {
    const classNames = (match[1] || match[2] || '').split(/\s+/).filter(Boolean);
    for (const className of classNames) {
      if (!isAllowedCssClassName(className)) {
        addFinding(
          'html-class-name',
          relPath,
          line,
          `Class "${className}" is not lowercase hyphenated.`,
        );
      }
    }
  });
}

function auditCssText(relPath, text) {
  const strippedText = stripCssComments(text);
  auditCssSelectors(relPath, strippedText);
  auditCssValues(relPath, strippedText);
  auditCssDeclarationOrder(relPath, strippedText);
}

function auditCssSelectors(relPath, text) {
  for (const block of text.matchAll(/([^{}]+)\{/g)) {
    const selectorText = block[1];
    if (selectorText.trim().startsWith('@')) {
      continue;
    }
    const selectorLine = lineForIndex(text, block.index || 0);

    for (const classMatch of selectorText.matchAll(
      /\.(-?[_a-zA-Z][-_a-zA-Z0-9]*(?:\\\[[^\]]+\\\])?)/g,
    )) {
      const className = classMatch[1];
      if (!isAllowedCssClassName(className)) {
        addFinding(
          'css-class-name',
          relPath,
          selectorLine,
          `Class selector ".${className}" is not lowercase hyphenated.`,
        );
      }
    }

    for (const idMatch of selectorText.matchAll(/#([_a-zA-Z][-_a-zA-Z0-9]*)/g)) {
      const idName = idMatch[1];
      if (!isAllowedCssIdName(idName)) {
        addFinding(
          'css-id-selector',
          relPath,
          selectorLine,
          `ID selector "#${idName}" is not hyphenated.`,
        );
      }
    }
  }
}

function isAllowedCssClassName(className) {
  const unescaped = className.replace(/\\/g, '');
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(unescaped) || /^text-\[\d+px\]$/.test(unescaped);
}

function isAllowedCssIdName(idName) {
  return idName === 'root' || /^[a-z][a-z0-9]*-[a-z0-9-]*$/.test(idName);
}

function auditCssValues(relPath, text) {
  findMatches(text, /(?<![\w-])0(?:px|em|rem|vh|vw|vmin|vmax|%)\b/g, (match, line) => {
    addFinding('css-zero-unit', relPath, line, `Zero value has a unit: ${match[0]}`);
  });

  findMatches(text, /!important\b/g, (_match, line) => {
    addFinding('css-important', relPath, line, 'Avoid !important declarations.');
  });
}

function auditCssDeclarationOrder(relPath, text) {
  for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorText = block[1].trim();
    if (!selectorText || selectorText.includes('@') || isKeyframeSelector(selectorText)) {
      continue;
    }

    const declarations = [];
    const body = block[2];
    const bodyStart = (block.index || 0) + block[0].indexOf(body);
    for (const declaration of body.matchAll(/^\s*(-?[_a-zA-Z][-_a-zA-Z0-9]*)\s*:/gm)) {
      declarations.push({
        line: lineForIndex(text, bodyStart + (declaration.index || 0)),
        property: declaration[1],
      });
    }

    for (let index = 1; index < declarations.length; index += 1) {
      const previous = declarations[index - 1];
      const current = declarations[index];
      if (normalizeCssProperty(previous.property) > normalizeCssProperty(current.property)) {
        addFinding(
          'css-declaration-order',
          relPath,
          current.line,
          `"${current.property}" should sort before "${previous.property}" in "${trimSnippet(selectorText)}".`,
        );
        break;
      }
    }
  }
}

function isKeyframeSelector(selectorText) {
  return /^(?:from|to|\d+(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d+(?:\.\d+)?%))*$/.test(selectorText);
}

function normalizeCssProperty(property) {
  return property.replace(/^-(?:moz|ms|o|webkit)-/, '');
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    '\n'.repeat(comment.split('\n').length - 1),
  );
}

function findMatches(text, pattern, callback) {
  for (const match of text.matchAll(pattern)) {
    callback(match, lineForIndex(text, match.index || 0));
  }
}

function lineForIndex(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) {
      line += 1;
    }
  }
  return line;
}

function trimSnippet(snippet) {
  return snippet.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function addFinding(ruleId, relPath, line, message) {
  if (!ruleIds.has(ruleId)) {
    throw new Error(`Unknown rule id: ${ruleId}`);
  }
  findings.push({ ruleId, path: relPath, line, message });
}

function buildReport(allFindings, currentBaseline) {
  const findingsByRule = Object.fromEntries(RULES.map((rule) => [rule.id, []]));
  for (const finding of allFindings) {
    findingsByRule[finding.ruleId].push(finding);
  }

  const summary = RULES.map((rule) => {
    const count = findingsByRule[rule.id].length;
    const baselineRule = currentBaseline?.rules?.[rule.id] ?? null;
    const allowed = baselineRule?.max ?? null;
    const retired = baselineRule?.retired === true;
    const stale = !retired && allowed !== null && count < allowed;
    return {
      ...rule,
      count,
      allowed,
      retired,
      stale,
      failed: !retired && allowed !== null && count !== allowed,
    };
  });

  return {
    scannedRoots: DEFAULT_SCAN_ROOTS,
    baseline: currentBaseline?.path ?? null,
    summary,
    failedRules: summary.filter((rule) => rule.failed).map((rule) => rule.id),
    findings: allFindings,
  };
}

function printReport(report, currentBaseline) {
  console.log('Google style audit');
  console.log(`Scanned roots: ${report.scannedRoots.join(', ')}`);
  if (currentBaseline) {
    console.log(`Baseline: ${currentBaseline.path}`);
  }
  console.log('');

  for (const rule of report.summary) {
    const status = rule.retired ? 'RETIRED' : rule.stale ? 'STALE' : rule.failed ? 'FAIL' : 'OK';
    const allowance = rule.allowed === null ? '' : ` / allowed ${rule.allowed}`;
    console.log(`[${status}] ${rule.id}: ${rule.count}${allowance} - ${rule.title}`);

    const examples = report.findings.filter((finding) => finding.ruleId === rule.id).slice(0, 5);
    for (const example of examples) {
      console.log(`  ${example.path}:${example.line} ${example.message}`);
    }
  }

  if (report.failedRules.length > 0) {
    console.log('');
    console.log(`Failed rules: ${report.failedRules.join(', ')}`);
  }
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}
