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
  return html.replace(/<icon name="([a-z-]+)" \/>/g, (_, name) =>
    readFileSync(`assets/icons/${name}.svg`, 'utf8')
      .replace(/<!--.*?-->\s*/s, '')
      .replace('<svg', '<svg aria-hidden="true"')
      .replace(/class="[^"]*"/, 'class="icon"')
      .replace(/\s*width="24"\s*height="24"/, '')
      .replace(/\n\s*/g, ' ')
      .trim(),
  );
}

// The homepage, with the latest version's screenshots.
writeFileSync(`${out}/index.html`, icons(readFileSync('src/index.html', 'utf8')));
cpSync(`${checkout(latest)}/docs/site/images`, `${out}/images`, { recursive: true });

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
      return { slug: file.replace(/\.md$/, ''), title: meta.title, order: Number(meta.order), body };
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
    const content = marked.parse(page.body).replace(/href="([a-z0-9-]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"');
    const html = template
      .replaceAll('{{title}}', page.title)
      .replace('{{nav}}', nav)
      .replace('{{versions}}', options)
      .replace('{{content}}', content)
      .replace('{{source}}', `https://github.com/furnish-self-service/furnish/blob/${version.ref}/docs/site/${page.slug}.md`);
    writeFileSync(`${target}/${page.slug}.html`, icons(html));
  }
}
const first = `docs/${latest.name}/index.html`;
writeFileSync(`${out}/docs/index.html`, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${latest.name}/index.html"><link rel="canonical" href="/${first}"><a href="${latest.name}/index.html">Docs</a>`);
console.log(`built ${out}/: homepage, docs for ${versions.map((v) => v.name).join(', ')}`);
