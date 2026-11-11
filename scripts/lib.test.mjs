import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { changedEntries, fenced, retireScreenshots, screenshotPath, tagMatchesVersion, validateRegistry } from "./lib.mjs";

const linen = {
  id: "linen",
  name: "Linen",
  author: "Multica",
  repo: "multica-ai/multica-theme-sample",
  description: "Warm paper tones.",
  modes: ["light", "dark"],
};

/** A registry whose themes/ folder holds `files`, file name to contents (objects as JSON). */
function registry(t, files) {
  const root = mkdtempSync(join(tmpdir(), "registry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "themes");
  mkdirSync(dir);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
  return root;
}

test("accepts a well-formed registry", (t) => {
  const ink = { ...linen, id: "ink", repo: "someone/ink" };
  const { entries, errors } = validateRegistry(registry(t, { "linen.json": linen, "ink.json": ink }), ["default"]);
  assert.deepEqual(errors, []);
  assert.deepEqual(entries, [ink, linen]);
});

test("reports every problem of an entry, with its file", (t) => {
  const { entries, errors } = validateRegistry(
    registry(t, {
      "linen.json": linen,
      "bad.json": { id: "Bad Id", name: "", author: "x".repeat(61), repo: "nope", modes: ["sepia"], extra: true },
      "default.json": { ...linen, id: "default", repo: "a/b" },
      "other.json": { ...linen, id: "other", repo: "Multica-AI/multica-theme-sample" },
    }),
    ["default"],
  );
  assert.deepEqual(entries, [linen]);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /^themes\/bad\.json: /);
  assert.match(errors[0], /unknown field "extra"/);
  assert.match(errors[0], /id must be/);
  assert.match(errors[0], /name must be/);
  assert.match(errors[0], /author must be/);
  assert.match(errors[0], /repo must be/);
  assert.match(errors[0], /modes must/);
  assert.match(errors[1], /^themes\/default\.json: .*built-in theme/);
  assert.match(errors[2], /^themes\/other\.json: repo .* listed twice/);
});

test("requires the file name to be the id", (t) => {
  const { entries, errors } = validateRegistry(
    registry(t, { "linen.json": linen, "linen-copy.json": { ...linen, repo: "someone/copy" }, "Ink.json": { ...linen, id: "ink", repo: "a/b" } }),
  );
  assert.deepEqual(entries, [linen]);
  assert.deepEqual(errors, [
    'themes/Ink.json: id "ink" does not match the file name; name the file ink.json',
    'themes/linen-copy.json: id "linen" does not match the file name; name the file linen.json',
  ]);
});

test("rejects files that are not one theme", (t) => {
  const root = registry(t, { "broken.json": "{", "list.json": [linen], "notes.md": "hi" });
  mkdirSync(join(root, "themes", "folder.json"));
  symlinkSync("/etc/hosts", join(root, "themes", "hosts.json"));
  const { entries, errors } = validateRegistry(root);
  assert.deepEqual(entries, []);
  assert.match(errors[0], /^themes\/broken\.json is not valid JSON/);
  assert.deepEqual(errors.slice(1), [
    "themes/folder.json: themes/ holds only <id>.json files",
    "themes/hosts.json: themes/ holds only <id>.json files",
    "themes/list.json must hold one theme, an object",
    "themes/notes.md: themes/ holds only <id>.json files",
  ]);
});

test("still reads a registry that is one themes.json", (t) => {
  const root = mkdtempSync(join(tmpdir(), "registry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ink = { ...linen, id: "ink", repo: "someone/ink" };
  writeFileSync(join(root, "themes.json"), JSON.stringify([linen, ink]));
  assert.deepEqual(validateRegistry(root), { entries: [linen, ink], errors: [] });
  assert.deepEqual(validateRegistry(join(root, "themes.json")), { entries: [linen, ink], errors: [] });
  writeFileSync(join(root, "themes.json"), JSON.stringify([linen, { ...linen, repo: "a/b" }, { ...linen, id: "x", repo: "Multica-AI/multica-theme-sample" }]));
  const { errors } = validateRegistry(root);
  assert.match(errors[0], /^Entry 2 \("linen"\): id "linen" is listed twice/);
  assert.match(errors[1], /^Entry 3 \("x"\): repo .* listed twice/);
  writeFileSync(join(root, "themes.json"), "{");
  assert.match(validateRegistry(root).errors[0], /not valid JSON/);
  writeFileSync(join(root, "themes.json"), "{}");
  assert.match(validateRegistry(root).errors[0], /must be a list/);
});

test("finds added and changed entries", (t) => {
  const ink = { ...linen, id: "ink", repo: "someone/ink" };
  const base = validateRegistry(registry(t, { "linen.json": linen, "ink.json": ink })).entries;
  const head = (files) => validateRegistry(registry(t, { "linen.json": linen, "ink.json": ink, ...files })).entries;
  const moss = { ...linen, id: "moss", repo: "someone/moss" };
  assert.deepEqual(changedEntries(base, head({ "moss.json": moss })), [moss]);
  assert.deepEqual(changedEntries(base, head({ "linen.json": { ...linen, name: "Linen 2" } })), [{ ...linen, name: "Linen 2" }]);
  assert.deepEqual(changedEntries(base, head({ "linen.json": JSON.stringify(linen) })), []);
  assert.deepEqual(changedEntries(base, head({})), []);
});

test("matches release tags to manifest versions", () => {
  assert.ok(tagMatchesVersion("v1.2.0", "1.2.0"));
  assert.ok(tagMatchesVersion("1.2.0", "1.2.0"));
  assert.ok(!tagMatchesVersion("v1.2.1", "1.2.0"));
  assert.ok(!tagMatchesVersion("v1.2.0", undefined));
});

test("keeps theme text inside its code block", () => {
  assert.equal(fenced(["a ``` b"]).split("```").length, 3);
});

test("names a screenshot by its content", () => {
  const path = screenshotPath("linen", "dark", Buffer.from("one"));
  assert.match(path, /^screenshots\/linen\/dark-[0-9a-f]{12}\.png$/);
  assert.equal(screenshotPath("linen", "dark", Buffer.from("one")), path);
  assert.notEqual(screenshotPath("linen", "dark", Buffer.from("two")), path);
});

test("keeps a screenshot the index stopped showing for a day, then deletes it", () => {
  const shown = new Set(["screenshots/linen/light-new.png"]);
  const files = ["screenshots/linen/light-new.png", "screenshots/linen/light.png"];
  const at = (iso) => new Date(iso);

  const first = retireScreenshots({ files, shown, retired: {}, now: at("2026-11-11T05:00:00Z") });
  assert.deepEqual(first, { retired: { "screenshots/linen/light.png": "2026-11-11T05:00:00.000Z" }, remove: [] });

  const soon = retireScreenshots({ files, shown, retired: first.retired, now: at("2026-11-11T05:11:00Z") });
  assert.deepEqual(soon, first);

  const later = retireScreenshots({ files, shown, retired: first.retired, now: at("2026-11-12T05:00:00Z") });
  assert.deepEqual(later, { retired: {}, remove: ["screenshots/linen/light.png"] });
});

test("forgets the retirement of a screenshot the index shows again", () => {
  const files = ["screenshots/linen/light.png"];
  const retired = { "screenshots/linen/light.png": "2026-11-11T05:00:00.000Z" };
  const now = new Date("2026-11-13T00:00:00Z");
  assert.deepEqual(retireScreenshots({ files, shown: new Set(files), retired, now }), { retired: {}, remove: [] });
});
