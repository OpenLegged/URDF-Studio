/**
 * SEO pre-render (post-build step).
 *
 * URDF Studio is a client-rendered WebGL/WASM editor, so true SSR is not viable.
 * Instead this runs after `vite build` and turns the built `dist/index.html` into
 * crawlable, per-language static pages without a headless browser:
 *   - rewrites the per-language head region (title/description/canonical/og/twitter/JSON-LD)
 *   - emits a Chinese variant at `dist/zh/index.html` (`<html lang="zh-CN">`, canonical /zh/)
 *   - regenerates `dist/sitemap.xml` with both URLs + hreflang alternates
 *
 * Language-specific regions in `index.html` are delimited by `<!-- SEO:HEAD:* -->` and
 * `<!-- SEO:CONTENT:* -->` markers. Missing markers throw rather than silently emitting a
 * half-rendered page. The SEO content is hidden from users and replaced by React on mount.
 * Asset URLs stay absolute (Vite base `/`), so `/zh/` needs no rewrite.
 *
 * Usage: node scripts/generate/seo_prerender.mjs   (wired into `npm run build`)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://urdf.enkeebot.com';
const LOGO = `${SITE}/logos/logo.png`;
const GITHUB = 'https://github.com/enkeebot/URDF-Studio';

export const ENKEEBOT_RELATED_PRODUCTS = [
  {
    name: 'BotWorld',
    url: 'https://botworld.enkeebot.com/',
    image: `${SITE}/logos/botworld-logo.webp`,
    description: {
      en: 'Discover and download robot models.',
      zh: '发现并下载机器人模型。',
    },
  },
  {
    name: 'Motion Studio',
    url: 'https://motion.enkeebot.com/',
    image: `${SITE}/logos/motion-studio-logo.webp`,
    description: {
      en: 'Retarget and edit robot motion.',
      zh: '重定向并编辑机器人动作。',
    },
  },
  {
    name: 'BotLab',
    url: 'https://botlab.enkeebot.com/',
    image: `${SITE}/logos/botlab-logo.webp`,
    description: {
      en: 'Simulate and validate robots in the browser.',
      zh: '在浏览器中仿真并验证机器人。',
    },
  },
];

const seoContent = {
  en: {
    ogLocale: 'en_US',
    title: 'URDF Studio - Professional Robot Design & Visualization Tool',
    description:
      'Free in-browser editor and viewer for robot models: URDF, MJCF, USD, SDF and Xacro. ' +
      'Edit kinematics, optimize collisions, assemble modules and convert formats.',
    url: `${SITE}/`,
    inLanguage: ['en', 'zh'],
    featureList: [
      'URDF / MJCF / SDF / USD / Xacro import and export',
      'Collision geometry optimization',
      'Multi-robot modular assembly with bridge joints',
      'Hardware and motor configuration',
      'AI generation and review',
      'PDF and CSV reports',
    ],
    hero: {
      tagline: 'Professional online editor & visualizer for robot models',
      sub:
        'Import, edit, visualize and convert URDF, MJCF, USD, SDF and Xacro robots — ' +
        'collision optimization, modular assembly and AI review, all in your browser.',
      formatsLabel: 'Supported formats',
      relatedProductsLabel: 'Related EnkeeBot products',
      noscript: 'URDF Studio needs JavaScript enabled to run the interactive editor.',
    },
  },
  zh: {
    ogLocale: 'zh_CN',
    title: 'URDF Studio - 专业机器人设计与可视化工具',
    description:
      '免费的浏览器端机器人模型编辑与可视化工作站，支持 URDF、MJCF、USD、SDF、Xacro 的导入、编辑与转换，' +
      '提供运动学编辑、碰撞优化、模块组装与 AI 审阅。',
    url: `${SITE}/zh/`,
    inLanguage: ['zh', 'en'],
    featureList: [
      'URDF / MJCF / SDF / USD / Xacro 导入与导出',
      '碰撞几何优化',
      '多机器人模块化组装与桥接关节',
      '硬件与电机配置',
      'AI 生成与审阅',
      'PDF 与 CSV 报告',
    ],
    hero: {
      tagline: '专业的在线机器人模型编辑与可视化工具',
      sub:
        '在浏览器中导入、编辑、可视化与转换 URDF、MJCF、USD、SDF、Xacro 机器人模型，' +
        '支持碰撞优化、模块组装与 AI 审阅。',
      formatsLabel: '支持的格式',
      relatedProductsLabel: 'EnkeeBot 相关产品',
      noscript: '运行 URDF Studio 交互式编辑器需要启用 JavaScript。',
    },
  },
};

function escHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(value) {
  return escHtml(value).replace(/"/g, '&quot;');
}

export function renderHead(lang) {
  const c = seoContent[lang];
  const earlyTitleSync = [
    `    <script>`,
    `(function () {`,
    `  var titles = {`,
    `    en: ${JSON.stringify(seoContent.en.title)},`,
    `    zh: ${JSON.stringify(seoContent.zh.title)}`,
    `  };`,
    `  var lang = 'en';`,
    `  try {`,
    `    if (/^\\/zh(?:\\/|$)/.test(window.location.pathname)) {`,
    `      lang = 'zh';`,
    `    } else {`,
    `      var saved = window.localStorage && window.localStorage.getItem('language');`,
    `      if (saved === 'en' || saved === 'zh') {`,
    `        lang = saved;`,
    `      } else {`,
    `        var browserLang = window.navigator.language || window.navigator.userLanguage || '';`,
    `        lang = browserLang.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';`,
    `      }`,
    `    }`,
    `    document.title = titles[lang] || titles.en;`,
    `  } catch (_error) {`,
    `    document.title = titles.en;`,
    `  }`,
    `})();`,
    `    </script>`,
  ].join('\n');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'URDF Studio',
    url: c.url,
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Web browser',
    description: c.description,
    image: LOGO,
    inLanguage: c.inLanguage,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: c.featureList,
    author: { '@type': 'Organization', name: 'enkeebot', url: GITHUB },
    mentions: ENKEEBOT_RELATED_PRODUCTS.map((product) => ({
      '@type': 'SoftwareApplication',
      name: product.name,
      url: product.url,
      image: product.image,
      description: product.description[lang],
    })),
  };

  return [
    `    <title>${escHtml(c.title)}</title>`,
    earlyTitleSync,
    `    <meta name="description" content="${escAttr(c.description)}">`,
    `    <link rel="canonical" href="${c.url}">`,
    `    <meta property="og:url" content="${c.url}">`,
    `    <meta property="og:title" content="${escAttr(c.title)}">`,
    `    <meta property="og:description" content="${escAttr(c.description)}">`,
    `    <meta property="og:locale" content="${c.ogLocale}">`,
    `    <meta name="twitter:title" content="${escAttr(c.title)}">`,
    `    <meta name="twitter:description" content="${escAttr(c.description)}">`,
    `    <script type="application/ld+json">`,
    JSON.stringify(jsonLd),
    `    </script>`,
  ].join('\n');
}

export function renderContent(lang) {
  const c = seoContent[lang];
  const relatedProductLinks = ENKEEBOT_RELATED_PRODUCTS.map(
    (product) =>
      `          <a href="${escAttr(product.url)}" rel="related" tabindex="-1">${escHtml(product.name)} — ${escHtml(product.description[lang])}</a>`,
  );

  return [
    `      <div class="boot-seo" aria-hidden="true">`,
    `        <img class="boot-logo" src="/logos/logo.png" alt="URDF Studio logo" width="72" height="72">`,
    `        <h1 class="boot-title">URDF Studio</h1>`,
    `        <p class="boot-tagline">${escHtml(c.hero.tagline)}</p>`,
    `        <p class="boot-sub">${escHtml(c.hero.sub)}</p>`,
    `        <ul class="boot-formats" aria-label="${escAttr(c.hero.formatsLabel)}">`,
    `          <li>URDF</li>`,
    `          <li>MJCF</li>`,
    `          <li>USD / USDA</li>`,
    `          <li>SDF</li>`,
    `          <li>Xacro</li>`,
    `        </ul>`,
    `        <nav aria-label="${escAttr(c.hero.relatedProductsLabel)}">`,
    ...relatedProductLinks,
    `        </nav>`,
    `      </div>`,
    `      <noscript class="boot-noscript">`,
    `        ${escHtml(c.hero.noscript)}`,
    `      </noscript>`,
  ].join('\n');
}

function replaceRegion(html, name, inner) {
  const region = new RegExp(
    `(<!--\\s*${name}:START[\\s\\S]*?-->)[\\s\\S]*?(<!--\\s*${name}:END\\s*-->)`,
  );
  if (!region.test(html)) {
    throw new Error(
      `[seo_prerender] marker ${name} not found in built HTML — did the index.html layout change?`,
    );
  }
  return html.replace(region, `$1\n${inner}\n    $2`);
}

function renderSitemap(lastmod) {
  const alternates = [
    `    <xhtml:link rel="alternate" hreflang="en" href="${SITE}/"/>`,
    `    <xhtml:link rel="alternate" hreflang="zh-CN" href="${SITE}/zh/"/>`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>`,
  ].join('\n');

  const entries = [
    { loc: `${SITE}/`, priority: '1.0' },
    { loc: `${SITE}/zh/`, priority: '0.9' },
  ]
    .map((entry) =>
      [
        '  <url>',
        `    <loc>${entry.loc}</loc>`,
        alternates,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        `    <priority>${entry.priority}</priority>`,
        '  </url>',
      ].join('\n'),
    )
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    `${entries}\n` +
    '</urlset>\n'
  );
}

function resolveLastmod(repoRoot) {
  try {
    const committed = execSync('git log -1 --format=%cs', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(committed)) {
      return committed;
    }
  } catch {
    // Fall back to the current date when git history is unavailable.
  }
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '../..');
  const distDir = path.join(repoRoot, 'dist');
  const indexPath = path.join(distDir, 'index.html');

  if (!existsSync(indexPath)) {
    throw new Error(`[seo_prerender] ${indexPath} not found — run "vite build" first.`);
  }

  let enHtml = readFileSync(indexPath, 'utf8');
  enHtml = replaceRegion(enHtml, 'SEO:HEAD', renderHead('en'));
  enHtml = replaceRegion(enHtml, 'SEO:CONTENT', renderContent('en'));
  writeFileSync(indexPath, enHtml);

  let zhHtml = enHtml.replace(
    '<html lang="en" translate="no">',
    '<html lang="zh-CN" translate="no">',
  );
  if (!zhHtml.includes('lang="zh-CN"')) {
    throw new Error(
      '[seo_prerender] failed to set zh-CN lang attribute — did the <html> tag change?',
    );
  }
  zhHtml = replaceRegion(zhHtml, 'SEO:HEAD', renderHead('zh'));
  zhHtml = replaceRegion(zhHtml, 'SEO:CONTENT', renderContent('zh'));
  mkdirSync(path.join(distDir, 'zh'), { recursive: true });
  writeFileSync(path.join(distDir, 'zh', 'index.html'), zhHtml);

  const lastmod = resolveLastmod(repoRoot);
  writeFileSync(path.join(distDir, 'sitemap.xml'), renderSitemap(lastmod));

  console.log(
    `[seo_prerender] wrote dist/index.html (en), dist/zh/index.html (zh), dist/sitemap.xml (lastmod ${lastmod})`,
  );
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) {
  main();
}
