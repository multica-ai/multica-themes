#!/usr/bin/env node
/**
 * Checks a pull request to the registry: themes.json must be valid, and every
 * theme it adds or changes must have a latest release whose theme.zip passes
 * the app's validator. Writes the report the comment workflow posts.
 *
 * Run: node scripts/check-pr.mjs --base <themes.json> --head <themes.json> --multica <dir> --out <dir>
 * Exits 1 when the pull request should not be merged.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { builtInThemeIds, changedEntries, checkEntry, fenced, validateRegistry } from "./lib.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
for (const key of ["base", "head", "multica", "out"]) {
  if (!args[key]) {
    console.error("Usage: node scripts/check-pr.mjs --base <themes.json> --head <themes.json> --multica <dir> --out <dir>");
    process.exit(2);
  }
}
const multica = resolve(args.multica);
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

const builtIns = await builtInThemeIds(multica);
const base = validateRegistry(readFileSync(args.base, "utf8"), builtIns).entries;
const head = validateRegistry(readFileSync(args.head, "utf8"), builtIns);
const changed = head.errors.length === 0 ? changedEntries(base, head.entries) : [];

const results = [];
for (const entry of changed) {
  results.push(await checkEntry(entry, { multica, work: `${out}-work`, token: process.env.GITHUB_TOKEN }));
}

const lines = ["<!-- multica-themes-check -->", "## Theme check", ""];
if (head.errors.length > 0) {
  lines.push("✗ **themes.json has problems:**", "", fenced(head.errors), "");
} else if (changed.length === 0) {
  lines.push("No themes are added or changed in `themes.json`.", "");
} else {
  lines.push("| Theme | Release | Result |", "| --- | --- | --- |");
  for (const r of results) {
    const result = r.ok ? "✓ Passes" : `✗ ${r.errors.length} problem${r.errors.length === 1 ? "" : "s"}`;
    lines.push(`| ${r.entry.name} (\`${r.entry.id}\`) by ${r.entry.author} | [\`${r.tag ?? "none"}\`](https://github.com/${r.entry.repo}/releases) | ${result} |`);
  }
  lines.push("");
  for (const r of results) {
    lines.push(`### ${r.ok ? "✓" : "✗"} ${r.entry.name} \`${r.tag ?? ""}\``, "");
    if (r.errors.length > 0) lines.push("**Errors** (the theme cannot be listed until these are fixed):", "", fenced(r.errors), "");
    if (r.warnings.length > 0) lines.push("**Warnings:**", "", fenced(r.warnings), "");
    if (r.contrast) lines.push(`Contrast: ${r.contrast.checked} colour pairs checked, ${r.contrast.failing} below WCAG AA.`, "");
    if (r.package) lines.push(`Package: \`theme.zip\`, ${r.package.size} bytes, SHA-256 \`${r.package.sha256}\`.`, "");
    if (r.screenshots) {
      const shots = Object.entries(r.screenshots);
      lines.push(`| ${shots.map(([mode]) => mode[0].toUpperCase() + mode.slice(1)).join(" | ")} |`, `| ${shots.map(() => "---").join(" | ")} |`);
      lines.push(`| ${shots.map(([mode]) => `![${r.entry.name} in ${mode} mode]({{screenshot:${r.entry.id}/${mode}}})`).join(" | ")} |`, "");
      for (const [mode, file] of shots) {
        mkdirSync(join(out, "screenshots", r.entry.id), { recursive: true });
        copyFileSync(file, join(out, "screenshots", r.entry.id, `${mode}.png`));
      }
    } else if (r.screenshotError) {
      lines.push("Screenshots could not be rendered:", "", fenced([r.screenshotError]), "");
    }
  }
}
lines.push("---", "_A maintainer merges once the checks pass. Checked with [`theme:check`](https://github.com/multica-ai/multica/blob/main/docs/theming.md) from multica-ai/multica `${process.env.MULTICA_REF || "main"}`._");

const ok = head.errors.length === 0 && results.every((r) => r.ok);
writeFileSync(join(out, "report.md"), lines.join("\n") + "\n");
writeFileSync(join(out, "result.json"), JSON.stringify({ ok, themes: results.map((r) => ({ id: r.entry.id, ok: r.ok, tag: r.tag })) }, null, 2));
console.log(lines.join("\n"));
process.exit(ok ? 0 : 1);
