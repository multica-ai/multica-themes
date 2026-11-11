# Multica themes

The community theme store for [Multica](https://github.com/multica-ai/multica), in beta. Themes listed here appear in **Settings → Appearance → Manage** on Web and Desktop.

- [`themes/`](themes) lists the themes, one `<id>.json` file each. Authors add theirs with a pull request; see [CONTRIBUTING.md](CONTRIBUTING.md).
- [`index.json` on the `index` branch](https://github.com/multica-ai/multica-themes/blob/index/index.json) is what the Multica server reads. A workflow writes it, never a person: for every listed theme it records the latest release that passed the checks, the SHA-256 of that release's `theme.zip`, and screenshots rendered from it (in `screenshots/` on the same branch). The app only installs that exact file.
- `main` only changes through reviewed pull requests; the `index` branch only through the Index workflow.

## How a theme gets to the app

1. An author publishes a GitHub release with a `theme.zip` in their own repository.
2. A pull request that adds or changes a file in `themes/` runs the **Check** workflow: the release goes through the app's own validator (`pnpm theme:check` in multica-ai/multica) and is rendered in light and dark mode. The results are posted on the pull request. A maintainer merges once they pass.
3. The **Index** workflow runs on every merge and once an hour. It picks up new releases, checks them the same way and updates `index.json`. A release that fails keeps the previous one in the store and opens an issue.
4. The Multica server reads `index.json` and serves the themes, their screenshots and their `theme.zip` to the app, cached. The app installs a theme through the same parser and CSS sanitizer as a theme someone imports.

## Running your own registry

A self-hosted Multica server reads this registry by default. Set `MULTICA_THEME_REGISTRY_URL` to the raw URL of another `index.json` in the same format to use your own, or `MULTICA_THEME_STORE=off` to turn the store off. Fork this repository to get the same checks.

## Maintainers

- The checks come from multica-ai/multica `main`. The `MULTICA_REF` repository variable pins another ref.
- `node --test scripts/lib.test.mjs` runs the registry's own tests.
- Run the index build locally with a checkout of multica-ai/multica that has its dependencies installed: `GITHUB_TOKEN=… node scripts/build-index.mjs --multica ../multica --index ../index` (a checkout of the `index` branch).
