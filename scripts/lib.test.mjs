import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { changedEntries, fenced, tagMatchesVersion, validateRegistry } from "./lib.mjs";

const linen = {
  id: "linen",
  name: "Linen",
  author: "Multica",
  repo: "multica-ai/multica-theme-sample",
  description: "Warm paper tones.",
  modes: ["light", "dark"],
};

/** A themes/ folder holding `files`, file name to contents (objects as JSON). */
function registry(t, files) {
  const dir = mkdtempSync(join(tmpdir(), "themes-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
  return dir;
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
  const dir = registry(t, { "broken.json": "{", "list.json": [linen], "notes.md": "hi" });
  mkdirSync(join(dir, "folder.json"));
  symlinkSync("/etc/hosts", join(dir, "hosts.json"));
  const { entries, errors } = validateRegistry(dir);
  assert.deepEqual(entries, []);
  assert.match(errors[0], /^themes\/broken\.json is not valid JSON/);
  assert.deepEqual(errors.slice(1), [
    "themes/folder.json: themes/ holds only <id>.json files",
    "themes/hosts.json: themes/ holds only <id>.json files",
    "themes/list.json must hold one theme, an object",
    "themes/notes.md: themes/ holds only <id>.json files",
  ]);
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
