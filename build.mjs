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
writeFileSync(`${out}/.nojekyll`, '');

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

/** Screenshots on phones: where `images/<x>-mobile.webp` exists (a crop of what matters), phones
 *  get it instead of the whole window, whose text would be too small to read. */
function mobileImages(html, dir) {
  return html.replace(/<img src="images\/([a-z-]+)\.webp"([^>]*)>/g, (img, name, rest) => {
    if (rest.includes('data-picture') || !existsSync(`${dir}/${name}-mobile.webp`)) return img;
    return `<picture><source srcset="images/${name}-mobile.webp" media="(max-width: 40rem)" />${img}</picture>`;
  });
}

// The homepage, with the latest version's screenshots.
const images = `${checkout(latest)}/docs/site/images`;
writeFileSync(`${out}/index.html`, mobileImages(icons(readFileSync('src/index.html', 'utf8')), images));
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
for (const version of versions) {
  const dir = `${checkout(version)}/docs/site`;
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const text = readFileSync(`${dir}/${file}`, 'utf8');
      const [, front, body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
      if (!front) throw new Error(`${dir}/${file}: needs front matter with title and order`);
      const meta = Object.fromEntries(front.split('\n').map((l) => l.split(/:\s*(.*)/s).slice(0, 2)));
      return { slug: file.replace(/\.md$/, ''), title: meta.title, order: Number(meta.order), body: includes(body, checkout(version), version.ref) };
    })
    .sort((a, b) => a.order - b.order);
  const target = `${out}/docs/${version.name}`;
  mkdirSync(target, { recursive: true });
  if (existsSync(`${dir}/images`)) cpSync(`${dir}/images`, `${target}/images`, { recursive: true });
  for (const page of pages) {
    const nav = pages
      .map((p) => `<a href="${p.slug}.html"${p === page ? ' aria-current="page"' : ''}>${p.title}</a>`)
      .join('\n');
    const options = versions
      .map((v) => `<option value="../${v.name}/${page.slug}.html"${v === version ? ' selected' : ''}>${v.label}</option>`)
      .join('');
    // Links between pages are written as page.md; the site serves page.html.
    const content = marked
      .parse(page.body)
      .replace(/href="([a-z0-9-]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"')
      // Anchors for links like admins.md#reports: the heading's text, lowercase, words joined by "-".
      .replace(/<h([23])>(.*?)<\/h\1>/g, (_, level, inner) => {
        const id = inner.replace(/<[^>]+>/g, '').toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `<h${level} id="${id}">${inner}</h${level}>`;
      });
    const html = template
      .replaceAll('{{title}}', page.title)
      .replace('{{nav}}', nav)
      .replace('{{versions}}', options)
      .replace('{{content}}', content)
      .replace('{{source}}', `https://github.com/furnish-self-service/furnish/blob/${version.ref}/docs/site/${page.slug}.md`);
    writeFileSync(`${target}/${page.slug}.html`, mobileImages(icons(html), `${dir}/images`));
  }
}
const first = `docs/${latest.name}/index.html`;
writeFileSync(`${out}/docs/index.html`, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${latest.name}/index.html"><link rel="canonical" href="/${first}"><a href="${latest.name}/index.html">Docs</a>`);
console.log(`built ${out}/: homepage, docs for ${versions.map((v) => v.name).join(', ')}`);
