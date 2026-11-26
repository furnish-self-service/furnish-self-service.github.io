# furnish-self-service.github.io

The furnish website: the homepage and the docs of each furnish version, at <https://furnish-self-service.github.io/>.

- `src/index.html`: the homepage. `src/docs.html`: the docs page template.
- `assets/`: styles (furnish's own design tokens), the Bricolage Grotesque font, the logo [Lucide](https://lucide.dev) icons (ISC) and system logos from [Simple Icons](https://simpleicons.org) (CC0; the Windows logo is drawn). `<icon name="…" />` in the HTML inlines `assets/icons/<name>.svg`.
- The docs and screenshots live in the furnish repository (`docs/site/`), so they change with the code. `versions.json` lists the versions to build, newest first; use a release tag or pin the commit containing an editorial update to its guides. Pages may declare a sidebar group and a previous page slug in their front matter. The previous slug preserves section bookmarks when splitting a guide.

```sh
npm ci
FURNISH_main=../furnish npm run build    # a local furnish checkout for the ref "main"
python3 -m http.server -d dist
```

The screenshots are made with `docs/screenshots/run.sh` in the furnish repository.
