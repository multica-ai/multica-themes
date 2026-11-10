# Adding a theme

Themes are CSS and a manifest, in beta: the variables, `data-mc` anchors and manifest fields may change. See [docs/theming.md](https://github.com/multica-ai/multica/blob/main/docs/theming.md) for what a theme can do.

## 1. Make the theme

The quickest start is to fork [multica-ai/multica-theme-sample](https://github.com/multica-ai/multica-theme-sample), or to use **Duplicate theme** in Settings → Appearance in Multica. A theme is a folder with:

- `manifest.json` with `apiVersion`, `id`, `name`, `author` and `version`, plus optional `description` and `options`;
- `theme.css`;
- optional fonts and images that `theme.css` references by relative path.

The theme cannot load anything from the network: no remote `url()`, `@import` or `image-set()`. The whole package must be at most 1 MB.

Check it with a checkout of multica-ai/multica:

```sh
pnpm theme:check path/to/your-theme
pnpm theme:preview path/to/your-theme --out preview   # light.png and dark.png, as the store renders them
```

## 2. Publish a release

In your theme's own GitHub repository, publish a release whose tag is the manifest's `version`, with or without a leading `v` (`1.0.0` or `v1.0.0`), and attach the zipped theme as an asset named **`theme.zip`**. `manifest.json` sits at the top of the zip, or inside one folder.

The sample's [release workflow](https://github.com/multica-ai/multica-theme-sample/blob/main/.github/workflows/release.yml) does this whenever you push a version tag.

## 3. Open a pull request here

Add an entry to the end of [`themes.json`](themes.json):

```json
{
  "id": "your-theme",
  "name": "Your Theme",
  "author": "Your Name",
  "repo": "your-github-name/your-theme-repo",
  "description": "One sentence about the theme.",
  "modes": ["light", "dark"]
}
```

- `id` is the manifest's `id`: 1–40 characters of `a-z`, `0-9` and `-`, not taken by another theme or a built-in one.
- `modes` lists the modes the theme is designed for. The store shows a screenshot of each.
- Keep `name` and `author` to 60 characters and `description` to 300.

Don't edit `index.json` or `screenshots/`; a workflow writes them.

The **Theme check** runs on the pull request and comments with what it found and how the theme looks. It must pass before a maintainer merges.

## Updates

Publish a new release. The store picks it up within about an hour, once it passes the checks, and people who installed the theme see **Update**. You don't need another pull request unless the name, description, repository or modes change.

If a release fails the checks, the store keeps the previous one and an issue is opened here with the problems.

## Removal

Maintainers remove a theme that breaks the app, misleads people, or whose repository disappears. People who installed it keep their copy until they remove it.
