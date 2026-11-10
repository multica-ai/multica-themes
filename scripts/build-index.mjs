#!/usr/bin/env node
/**
 * Builds index.json, the file the Multica server reads: every theme of
 * themes.json with the one release that passed the checks, the SHA-256 of
 * its theme.zip and screenshots rendered from it. index.json and
 * screenshots/ live in the --index folder, a checkout of the `index` branch.
 *
 * A theme whose latest release fails keeps its last good release in the
 * index, and the failure is reported (and, with --report-issues, opened as
 * an issue). A theme that never passed is left out. Nothing is written when
 * nothing changed, so the scheduled run does not commit every hour.
 *
 * Run: node scripts/build-index.mjs --multica <dir> --index <dir> [--report-issues]
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { builtInThemeIds, checkEntry, fenced, readJson, validateRegistry } from "./lib.mjs";

const argv = process.argv.slice(2);
const option = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};
if (!option("--multica") || !option("--index")) {
  console.error("Usage: node scripts/build-index.mjs --multica <dir> --index <dir> [--report-issues]");
  process.exit(2);
}
const multica = resolve(option("--multica"));
const reportIssues = argv.includes("--report-issues");
const registryRoot = resolve(import.meta.dirname, "..");
const root = resolve(option("--index"));
mkdirSync(root, { recursive: true });
const token = process.env.GITHUB_TOKEN;

const registry = validateRegistry(readFileSync(join(registryRoot, "themes.json"), "utf8"), await builtInThemeIds(multica));
if (registry.errors.length > 0) {
  console.error(`themes.json has problems:\n${registry.errors.join("\n")}`);
  process.exit(1);
}
const previous = readJson(join(root, "index.json"), { themes: [] });
const previousById = new Map((previous.themes ?? []).map((theme) => [theme.id, theme]));
const work = join(registryRoot, ".work");
rmSync(work, { recursive: true, force: true });

const themes = [];
const failures = [];
for (const entry of registry.entries) {
  const last = previousById.get(entry.id);
  const result = await checkEntry(entry, { multica, work, token });
  const unchanged = last && result.package && last.tag === result.tag && last.package?.sha256 === result.package.sha256;
  if (result.ok && result.screenshots) {
    const screenshots = {};
    for (const [mode, file] of Object.entries(result.screenshots)) {
      const path = `screenshots/${entry.id}/${mode}.png`;
      if (!unchanged || !existsSync(join(root, path))) {
        mkdirSync(join(root, "screenshots", entry.id), { recursive: true });
        copyFileSync(file, join(root, path));
      }
      screenshots[mode] = path;
    }
    themes.push({
      id: entry.id,
      name: entry.name,
      author: entry.author,
      repo: entry.repo,
      ...(entry.description ? { description: entry.description } : {}),
      modes: entry.modes,
      version: result.theme.version,
      tag: result.tag,
      package: result.package,
      screenshots,
      updated_at: result.release.publishedAt,
    });
    console.log(`✓ ${entry.id} ${result.tag}${unchanged ? " (unchanged)" : ""}`);
    continue;
  }
  const errors = result.ok ? [`Screenshots could not be rendered: ${result.screenshotError}`] : result.errors;
  failures.push({ entry, tag: result.tag, errors });
  console.log(`✗ ${entry.id} ${result.tag ?? ""}\n  ${errors.join("\n  ")}`);
  if (last) {
    // Keep the last release that passed, with the registry's current listing.
    themes.push({ ...last, name: entry.name, author: entry.author, repo: entry.repo, description: entry.description, modes: last.modes });
    console.log(`  keeping ${last.tag}`);
  }
}
rmSync(work, { recursive: true, force: true });

const listed = new Set(themes.map((theme) => theme.id));
for (const id of previousById.keys()) {
  if (!listed.has(id)) rmSync(join(root, "screenshots", id), { recursive: true, force: true });
}

const comparable = (index) => JSON.stringify(index.themes ?? []);
if (comparable({ themes }) !== comparable(previous)) {
  writeFileSync(join(root, "index.json"), JSON.stringify({ schema: 1, generated_at: new Date().toISOString(), themes }, null, 2) + "\n");
  console.log("index.json updated");
} else {
  console.log("index.json unchanged");
}

const summary = [
  "## Theme index",
  "",
  `${themes.length} theme${themes.length === 1 ? "" : "s"} listed, ${failures.length} failing.`,
  ...failures.flatMap(({ entry, tag, errors }) => ["", `### ✗ ${entry.name} (\`${entry.id}\`) ${tag ?? ""}`, "", fenced(errors)]),
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n", { flag: "a" });

if (reportIssues && token && process.env.GITHUB_REPOSITORY) {
  const api = (path, init = {}) =>
    fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
      ...init,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "multica-themes" },
    });
  const open = await (await api("/issues?state=open&labels=release-check&per_page=100")).json();
  for (const { entry, tag, errors } of failures) {
    const title = `${entry.id} ${tag ?? "(no release)"} does not pass the checks`;
    if (Array.isArray(open) && open.some((issue) => issue.title === title)) continue;
    const body = [
      `The latest release of [${entry.repo}](https://github.com/${entry.repo}/releases) does not pass the theme checks, so the store keeps offering the previous release${previousById.has(entry.id) ? "" : " (none yet)"}.`,
      "",
      fenced(errors),
      "",
      `@${entry.repo.split("/")[0]}, publish a fixed release and the next index run picks it up. Check locally with \`pnpm theme:check <folder>\` in multica-ai/multica.`,
    ].join("\n");
    await api("/issues", { method: "POST", body: JSON.stringify({ title, body, labels: ["release-check"] }) });
  }
}
