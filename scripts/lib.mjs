/**
 * Shared by the registry's checks and index build. Everything about a theme
 * itself (the manifest, the CSS sanitizer, contrast) is checked by the
 * multica repository's own `theme:check` and rendered by its
 * `theme:preview`, so the store accepts exactly what the app would.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_PACKAGE_BYTES = 1024 * 1024;
export const MODES = ["light", "dark"];

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const FIELDS = new Set(["id", "name", "author", "repo", "description", "modes"]);

/** The ids of the app's built-in themes, which a store theme cannot take. */
export async function builtInThemeIds(multica) {
  const { appearance } = await import(pathToFileURL(resolve(multica, "scripts/theme-files.mjs")).href);
  const { BUILT_IN_THEMES } = await appearance("built-in-themes.ts");
  return BUILT_IN_THEMES.map((theme) => theme.id);
}

/** Problems with one theme's fields. `repos` holds the repositories listed so far. */
function entryProblems(entry, builtIns, repos) {
  const problems = [];
  for (const key of Object.keys(entry)) if (!FIELDS.has(key)) problems.push(`unknown field "${key}"`);
  if (typeof entry.id !== "string" || !ID.test(entry.id)) problems.push("id must be 1-40 characters of a-z, 0-9 and -");
  else if (builtIns.includes(entry.id)) problems.push(`id "${entry.id}" is a built-in theme`);
  const text = (key, max, required = true) => {
    const value = entry[key];
    if (value === undefined && !required) return;
    if (typeof value !== "string" || value.trim() === "" || value.length > max) {
      problems.push(`${key} must be text of at most ${max} characters`);
    }
  };
  text("name", 60);
  text("author", 60);
  text("description", 300, false);
  if (typeof entry.repo !== "string" || !REPO.test(entry.repo)) problems.push('repo must be "owner/name" on GitHub');
  else if (repos.has(entry.repo.toLowerCase())) problems.push(`repo ${entry.repo} is listed twice`);
  if (
    !Array.isArray(entry.modes) ||
    entry.modes.length === 0 ||
    entry.modes.some((mode) => !MODES.includes(mode)) ||
    new Set(entry.modes).size !== entry.modes.length
  ) {
    problems.push('modes must list "light", "dark" or both');
  }
  return problems;
}

/**
 * Checks the themes of a registry checkout: one `themes/<id>.json` file per
 * theme, each an object with the id, name, author, the theme's GitHub
 * repository, an optional description and the modes it supports. Returns
 * the entries, sorted by file name, and every problem found, each naming
 * its file.
 */
export function validateRegistry(root, builtIns = []) {
  // Until the move to themes/ lands, the Check workflow passes themes.json
  // itself, and the base branch of that move still lists its themes there.
  if (statSync(root).isFile()) return validateList(readFileSync(root, "utf8"), builtIns);
  if (!existsSync(join(root, "themes"))) return validateList(readFileSync(join(root, "themes.json"), "utf8"), builtIns);
  const dir = join(root, "themes");
  const errors = [];
  const entries = [];
  const repos = new Set();
  const files = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const file of files) {
    const at = `themes/${file.name}`;
    // Symlinks too: the pull request check must not read files outside the folder.
    if (!file.isFile() || !file.name.endsWith(".json")) {
      errors.push(`${at}: themes/ holds only <id>.json files`);
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(readFileSync(join(dir, file.name), "utf8"));
    } catch (error) {
      errors.push(`${at} is not valid JSON: ${error.message}`);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${at} must hold one theme, an object`);
      continue;
    }
    const problems = entryProblems(entry, builtIns, repos);
    if (typeof entry.id === "string" && ID.test(entry.id) && file.name !== `${entry.id}.json`) {
      problems.unshift(`id "${entry.id}" does not match the file name; name the file ${entry.id}.json`);
    }
    if (problems.length > 0) {
      errors.push(`${at}: ${problems.join("; ")}`);
      continue;
    }
    repos.add(entry.repo.toLowerCase());
    entries.push(entry);
  }
  return { entries, errors };
}

/** The registry's former layout: one themes.json list. */
function validateList(raw, builtIns) {
  let list;
  try {
    list = JSON.parse(raw);
  } catch (error) {
    return { entries: [], errors: [`themes.json is not valid JSON: ${error.message}`] };
  }
  if (!Array.isArray(list)) return { entries: [], errors: ["themes.json must be a list of themes"] };
  const errors = [];
  const entries = [];
  const ids = new Set();
  const repos = new Set();
  list.forEach((entry, index) => {
    const at = `Entry ${index + 1}${entry && typeof entry.id === "string" ? ` ("${entry.id}")` : ""}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const problems = entryProblems(entry, builtIns, repos);
    if (ids.has(entry.id)) problems.push(`id "${entry.id}" is listed twice`);
    if (problems.length > 0) {
      errors.push(`${at}: ${problems.join("; ")}`);
      return;
    }
    ids.add(entry.id);
    repos.add(entry.repo.toLowerCase());
    entries.push(entry);
  });
  return { entries, errors };
}

/** Entries of `head` that are new or changed since `base`, by id. */
export function changedEntries(base, head) {
  const before = new Map(base.map((entry) => [entry.id, JSON.stringify(entry)]));
  return head.filter((entry) => before.get(entry.id) !== JSON.stringify(entry));
}

/** Whether a release tag names the manifest version: `1.2.0` or `v1.2.0`. */
export const tagMatchesVersion = (tag, version) =>
  typeof version === "string" && (tag === version || tag === `v${version}`);

async function github(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "multica-themes",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

/** The latest published release of a repository and its theme.zip. */
export async function latestRelease(repo, token) {
  const release = await github(`/repos/${repo}/releases/latest`, token);
  if (!release) return { error: `${repo} has no published release` };
  const asset = release.assets?.find((a) => a.name === "theme.zip");
  if (!asset) return { error: `Release ${release.tag_name} of ${repo} has no theme.zip asset`, tag: release.tag_name };
  if (asset.size > MAX_PACKAGE_BYTES) {
    return { error: `theme.zip of ${release.tag_name} is ${asset.size} bytes; the limit is ${MAX_PACKAGE_BYTES}`, tag: release.tag_name };
  }
  return { tag: release.tag_name, url: asset.browser_download_url, publishedAt: release.published_at };
}

/** Downloads a release asset, at most MAX_PACKAGE_BYTES. */
export async function download(url) {
  const res = await fetch(url, { headers: { "User-Agent": "multica-themes" }, redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.length > MAX_PACKAGE_BYTES) throw new Error(`${url} is larger than ${MAX_PACKAGE_BYTES} bytes`);
  return data;
}

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/**
 * Where the index keeps a screenshot: named by its content, so a new render
 * (a new release, or the app's fixture page changing) gets a new URL and
 * nothing that cached the old one keeps serving it.
 */
export const screenshotPath = (id, mode, png) => `screenshots/${id}/${mode}-${sha256(png).slice(0, 12)}.png`;

/**
 * How long a screenshot stays after the index stops showing it. A Multica
 * server caches the index for ten minutes, and keeps serving its copy while
 * the registry can't be reached, so it can still ask for the old file.
 */
export const RETIRED_SCREENSHOT_DAYS = 1;

/**
 * Sorts the screenshot files the index no longer shows into those to delete
 * and those to keep. `retired` records when each was first seen unshown.
 */
export function retireScreenshots({ files, shown, retired, now }) {
  const keep = {};
  const remove = [];
  for (const file of files) {
    if (shown.has(file)) continue;
    const since = Number.isNaN(Date.parse(retired[file])) ? now.toISOString() : retired[file];
    if (now.getTime() - Date.parse(since) >= RETIRED_SCREENSHOT_DAYS * 24 * 60 * 60 * 1000) remove.push(file);
    else keep[file] = since;
  }
  return { retired: keep, remove };
}

/**
 * Runs the app's validator on a theme.zip and checks that it is the theme
 * and release the registry entry names.
 */
export function checkPackage(entry, tag, zipPath, multica) {
  const run = spawnSync(process.execPath, [join(multica, "scripts/theme-check.mjs"), zipPath, "--json"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  let report;
  try {
    [report] = JSON.parse(run.stdout);
  } catch {
    return { ok: false, errors: [`theme:check did not run: ${(run.stderr || run.stdout).trim().slice(0, 2000)}`], warnings: [] };
  }
  const errors = report.issues.filter((i) => i.level === "error").map((i) => i.message);
  const warnings = report.issues.filter((i) => i.level !== "error").map((i) => i.message);
  if (report.theme) {
    if (report.theme.id !== entry.id) errors.push(`manifest.json id is "${report.theme.id}", but the registry lists "${entry.id}"`);
    if (!tagMatchesVersion(tag, report.theme.version)) {
      errors.push(`manifest.json version is ${report.theme.version ?? "missing"}, but the release tag is ${tag}`);
    }
  }
  const failing = report.contrast.filter((c) => c.ratio < c.required).length;
  return { ok: errors.length === 0, errors, warnings, theme: report.theme, contrast: { checked: report.contrast.length, failing } };
}

/** Renders the theme's screenshots into `outDir` with the app's fixture page. */
export function renderScreenshots(zipPath, outDir, modes, multica) {
  mkdirSync(outDir, { recursive: true });
  const run = spawnSync(
    process.execPath,
    [join(multica, "scripts/theme-preview.mjs"), zipPath, "--out", outDir, "--modes", modes.join(",")],
    { encoding: "utf8", cwd: multica },
  );
  if (run.status !== 0) return { ok: false, error: (run.stderr || run.stdout).trim().slice(0, 2000) };
  return { ok: true, files: Object.fromEntries(modes.map((mode) => [mode, join(outDir, `${mode}.png`)])) };
}

/** Downloads, checks and renders the latest release of one registry entry. */
export async function checkEntry(entry, { multica, work, token }) {
  const release = await latestRelease(entry.repo, token);
  if (release.error) return { entry, ok: false, tag: release.tag, errors: [release.error], warnings: [] };
  let data;
  try {
    data = await download(release.url);
  } catch (error) {
    return { entry, ok: false, tag: release.tag, errors: [error.message], warnings: [] };
  }
  const dir = join(work, entry.id);
  mkdirSync(dir, { recursive: true });
  const zipPath = join(dir, "theme.zip");
  writeFileSync(zipPath, data);
  const check = checkPackage(entry, release.tag, zipPath, multica);
  const shots = check.theme ? renderScreenshots(zipPath, join(dir, "screenshots"), entry.modes, multica) : { ok: false };
  return {
    entry,
    ...check,
    tag: release.tag,
    release,
    package: { url: release.url, sha256: sha256(data), size: data.length },
    screenshots: shots.ok ? shots.files : null,
    screenshotError: shots.ok ? null : shots.error ?? null,
  };
}

export const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};

/** Text from a theme, safe inside a Markdown code block. */
export const fenced = (lines) => "```text\n" + lines.join("\n").replace(/```/g, "ˋˋˋ") + "\n```";
