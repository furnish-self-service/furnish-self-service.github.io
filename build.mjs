// Builds the website into dist/: the homepage (src/index.html) and the docs of each furnish
// version (docs/site/*.md in that version's checkout, see versions.json).
//
//   node build.mjs                 # checkouts in ./furnish/<ref> (CI clones them there)
//   FURNISH_main=../furnish node build.mjs   # a local checkout for a ref
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
const latest = versions[0];
const checkout = (v) => process.env[`FURNISH_${v.ref}`] ?? `furnish/${v.ref}`;
const out = 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync('assets', `${out}/assets`, { recursive: true });
cpSync('assets/favicon.ico', `${out}/favicon.ico`);
writeFileSync(`${out}/.nojekyll`, '');

function preview(title, path) {
  const origin = 'https://furnish-self-service.github.io';
  const safeTitle = title.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  return `<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
  <link rel="icon" href="/assets/logo.svg" type="image/svg+xml" sizes="any" />
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" sizes="180x180" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="furnish" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:url" content="${origin}/${path}" />
  <meta property="og:image" content="${origin}/assets/logo-512.png" />
  <meta property="og:image:width" content="512" />
  <meta property="og:image:height" content="512" />
  <meta property="og:image:alt" content="furnish armchair logo" />
  <meta name="twitter:card" content="summary" />`;
}

/** `<icon name="x" />` → the inline Lucide SVG (decorative). */
function icons(html) {
  return html.replace(/<icon name="([a-z0-9-]+)" \/>/g, (_, name) =>
    readFileSync(`assets/icons/${name}.svg`, 'utf8')
      .replace(/<!--.*?-->\s*/s, '')
      .replace('<svg', '<svg aria-hidden="true"')
      .replace(/class="[^"]*"/, 'class="icon"')
      .replace(/\s*width="24"\s*height="24"/, '')
      .replace(/\n\s*/g, ' ')
      .trim(),
  );
}

/** Screenshots: each links to its full-size image, which assets/viewer.js opens in a dialog. On
 *  phones, where `images/<x>-mobile.webp` exists (a crop of what matters), the page shows that crop
 *  instead of the whole window, whose text would be too small to read. */
function screenshots(html, dir) {
  return html.replace(/<img src="images\/([a-z0-9-]+)\.webp"([^>]*)>/g, (img, name, rest) => {
    const full = `images/${name}.webp`;
    if (rest.includes('data-picture') || !existsSync(`${dir}/${name}-mobile.webp`)) return `<a class="zoom" href="${full}">${img}</a>`;
    return `<a class="zoom" href="${full}"><picture><source srcset="images/${name}-mobile.webp" media="(max-width: 40rem)" />${img}</picture></a>`;
  });
}

// Resolve existing assets at build time so downloads also work without client-side JavaScript.
const repository = 'furnish-self-service/furnish';
async function releases(path) {
  const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases${path}`, { headers, signal: AbortSignal.timeout(15000) });
    if (response.status === 404 && path === '/latest') return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Could not list release assets (${path}): ${error.message}`);
    return null;
  }
}
const stable = await releases('/latest');
function archiveLinks(os, suffix, arch) {
  const version = stable?.tag_name?.slice(1);
  const filename = `furnish_${version}_${suffix}`;
  let download = `<a href="https://github.com/${repository}/releases/latest">Browse release assets</a> for files ending in <code>${suffix}</code>.`;
  if (version && /^\d+\.\d+\.\d+$/.test(version) && stable.assets.some(asset => asset.name === filename)) {
    const base = `https://github.com/${repository}/releases/download/${stable.tag_name}`;
    const checksum = stable.assets.some(asset => asset.name === 'SHA256SUMS') ? ` · <a href="${base}/SHA256SUMS">SHA-256 checksums</a>` : '';
    download = `<a href="${base}/${filename}">${os} ${arch} · ${filename.endsWith('.zip') ? 'ZIP' : 'tar.gz'}</a> · ${version}${checksum}`;
  }
  return `<details><summary>Binary archives for packagers · ${arch}</summary><p>CLI and desktop executables for creating your own package. Supply the runtime dependencies and manage updates in your package.</p><p>${download}</p></details>`;
}

// The homepage, with the latest version's screenshots.
const images = `${checkout(latest)}/docs/site/images`;
writeFileSync(`${out}/index.html`, screenshots(icons(readFileSync('src/index.html', 'utf8').replaceAll('{{stable-version}}', latest.name).replace('{{preview}}', preview('furnish · Self-service app catalog', ''))
  .replace('{{archives-windows}}', archiveLinks('Windows', 'windows-x86_64_binaries.zip', 'x64'))
  .replace('{{archives-macos}}', archiveLinks('macOS', 'macos-arm64_binaries.tar.gz', 'Apple silicon'))
  .replace('{{archives-linux}}', archiveLinks('Linux', 'linux-x86_64_binaries.tar.gz', 'x86-64'))), images));
cpSync(`${checkout(latest)}/docs/site/images`, `${out}/images`, { recursive: true });
// The open-source components in furnish's installers and their licenses (the footers link it).
const notices = `${checkout(latest)}/THIRD-PARTY-LICENSES.html`;
if (existsSync(notices)) cpSync(notices, `${out}/licenses.html`);

/** `@include <path>` on its own line: the file from the furnish repository at that version, as a
 *  code block with a link to it, so the docs show exactly the files CI tests (endpoint configs).
 *  `@include-md <path>`: a Markdown file's text, without its first heading, one level deeper. */
function includes(body, root, ref) {
  const language = (path) =>
    ({ yml: 'yaml', yaml: 'yaml', conf: 'nginx', template: 'nginx', cfg: 'haproxy', json: 'json', sh: 'sh', toml: 'toml' })[
      path.split('.').pop()
    ] ?? (path.endsWith('Caddyfile') ? 'caddyfile' : '');
  return body.replace(/^@include(-md)? (\S+)$/gm, (_, md, path) => {
    const text = readFileSync(`${root}/${path}`, 'utf8').trimEnd();
    if (md) return text.replace(/^# .*\n+/, '').replace(/^(#+) /gm, '$1# ');
    const fence = text.includes('```') ? '~~~~' : '```';
    const link = `https://github.com/furnish-self-service/furnish/blob/${ref}/${path}`;
    const block = `${fence}${language(path)}\n${text}\n${fence}`;
    // Long files fold away, so the page stays readable; short ones show.
    if (text.split('\n').length <= 25) return `[\`${path}\`](${link}):\n\n${block}`;
    return `<details class="file"><summary><code>${path}</code></summary>\n\n[On GitHub](${link})\n\n${block}\n\n</details>`;
  });
}

// The docs: one tree per version; /docs/ goes to the latest.
const template = readFileSync('src/docs.html', 'utf8');
const trees = versions.map(version => {
  const dir = `${checkout(version)}/docs/site`;
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      let text = readFileSync(`${dir}/${file}`, 'utf8');
      // The immutable v0.1.0 tag was written before its downloads went live.
      if (version.ref === 'v0.1.0' && file === 'index.md') {
        const original = 'follow the stable channel once v0.1.0 is published';
        if (!text.includes(original)) throw new Error(`Missing v0.1.0 release timing in ${file}`);
        text = text.replace(original, 'follow the stable channel');
      }
      const [, front, body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
      if (!front) throw new Error(`${dir}/${file}: needs front matter with title and order`);
      const meta = Object.fromEntries(front.split('\n').map((l) => l.split(/:\s*(.*)/s).slice(0, 2)));
      return { group: meta.group, previous: meta.previous, slug: file.replace(/\.md$/, ''), title: meta.title, order: Number(meta.order), body: includes(body, checkout(version), version.ref) };
    })
    .sort((a, b) => a.order - b.order);
  return { version, dir, pages };
});

function sectionId(inner) {
  return inner.replace(/<[^>]+>/g, '').toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

for (const { version, dir, pages } of trees) {
  const target = `${out}/docs/${version.name}`;
  mkdirSync(target, { recursive: true });
  if (existsSync(`${dir}/images`)) cpSync(`${dir}/images`, `${target}/images`, { recursive: true });
  for (const page of pages) {
    const link = p => `<a href="${p.slug}.html"${p === page ? ' aria-current="page"' : ''}>${p.title}</a>`;
    const groups = [...new Set(pages.map(p => p.group))];
    const nav = groups.map(group => {
      const links = pages.filter(p => p.group === group).map(link).join('\n');
      return group ? `<details name="guide-group"${page.group === group ? ' open' : ''}><summary>${group}</summary>${links}</details>` : links;
    }).join('\n');
    const options = trees.map(tree => {
      const dest = [page.slug, page.previous, 'index'].find(slug => tree.pages.some(p => p.slug === slug));
      return `<option value="../${tree.version.name}/${dest}.html"${tree.version === version ? ' selected' : ''}>${tree.version.label}</option>`;
    }).join('');
    // Links between pages are written as page.md; the site serves page.html.
    const content = marked
      .parse(page.body)
      .replace(/href="([a-z0-9-]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"')
      // Anchors for links like admins.md#reports: the heading's text, lowercase, words joined by "-".
      .replace(/<h([23])>(.*?)<\/h\1>/g, (_, level, inner) => {
        const id = sectionId(inner);
        return `<h${level} id="${id}">${inner}</h${level}>`;
      });
    // "On this page": the page's h2 and h3 headings, with the anchors set above, after the title.
    const headings = [...content.matchAll(/<h([23]) id="([^"]+)">(.*?)<\/h\1>/g)];
    const toc = headings.length < 2 ? '' : `<nav class="toc" aria-label="On this page"><div><p>On this page</p><ul>${headings
      .map(([, level, id, inner]) => `<li class="h${level}"><a href="#${id}">${inner.replace(/<(?!\/?code)[^>]+>/g, '')}</a></li>`)
      .join('')}</ul></div></nav>`;
    // Bookmarks into the former single-page guides follow their section to its new page.
    const moved = {};
    for (const child of pages.filter(p => p.previous === page.slug)) {
      const headings = marked.parse(child.body).matchAll(/<h[23]>(.*?)<\/h[23]>/g);
      for (const [, heading] of headings) {
        const id = sectionId(heading);
        moved[id] = child.slug + '.html#' + id;
      }
    }
    if (page.slug === 'index' && pages.some(p => p.slug === 'furnish-updates')) {
      moved['switching-from-alpha-to-stable'] = 'furnish-updates.html#switching-from-alpha-to-stable';
    }
    if (page.slug === 'endpoint' && pages.some(p => p.slug === 'endpoint-access')) {
      const configs = `https://github.com/${repository}/tree/${version.ref}/packaging/endpoint`;
      for (const [proxy, anchors] of Object.entries({
        caddy: ['add-a-collection'], nginx: ['notes'], traefik: ['how-the-checks-map-to-traefik', 'limits-of-this-variant'],
        envoy: ['how-it-differs-from-caddy'], haproxy: ['the-idp-39-s-signing-key'],
        reports: ['start', 'the-dashboard', 'retention', 'another-log-system'],
      })) {
        if (proxy !== 'reports') moved[proxy] = configs + '/' + proxy;
        for (const anchor of anchors) {
          const fragment = anchor === 'the-idp-39-s-signing-key' ? 'the-idps-signing-key' : anchor;
          moved[anchor] = configs + '/' + proxy + '#' + fragment;
        }
      }
    }
    const bookmarks = Object.keys(moved).length
      ? `<script>const moved = ${JSON.stringify(moved)}; const id = location.hash.slice(1); if (Object.hasOwn(moved, id) && !document.getElementById(id)) location.replace(moved[id]);</script>`
      : '';
    const html = template
      .replaceAll('{{title}}', page.title)
      .replace('{{preview}}', () => preview(`${page.title} · furnish docs`, `docs/${version.name}/${page.slug}.html`))
      .replace('{{nav}}', nav)
      .replace('{{versions}}', options)
      .replace('{{bookmarks}}', bookmarks)
      .replace('{{content}}', () => content.replace(/<\/h1>/, (h) => h + toc))
      .replace('{{source}}', `https://github.com/furnish-self-service/furnish/blob/${version.ref}/docs/site/${page.slug}.md`);
    writeFileSync(`${target}/${page.slug}.html`, screenshots(icons(html), `${dir}/images`));
  }
}
const first = `docs/${latest.name}/index.html`;
writeFileSync(`${out}/docs/index.html`, `<!doctype html><meta charset="utf-8">${preview('furnish docs', first)}<meta http-equiv="refresh" content="0; url=${latest.name}/index.html"><link rel="canonical" href="/${first}"><a href="${latest.name}/index.html">Docs</a>`);
for (const [, page, anchor] of readFileSync(`${out}/index.html`, 'utf8').matchAll(/href="(docs\/[^"#]+\.html)#([^"]+)"/g)) {
  if (!readFileSync(`${out}/${page}`, 'utf8').includes(`id="${anchor}"`)) {
    throw new Error(`Homepage links to missing heading ${page}#${anchor}`);
  }
}
console.log(`built ${out}/: homepage, docs for ${versions.map((v) => v.name).join(', ')}`);
