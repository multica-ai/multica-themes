import assert from "node:assert/strict";
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

test("accepts a well-formed registry", () => {
  const { entries, errors } = validateRegistry(JSON.stringify([linen]), ["default"]);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
});

test("reports every problem of an entry", () => {
  const { entries, errors } = validateRegistry(
    [
      linen,
      { ...linen, repo: "someone/other" },
      { id: "Bad Id", name: "", author: "x".repeat(61), repo: "nope", modes: ["sepia"], extra: true },
      { ...linen, id: "default", repo: "a/b" },
      { ...linen, id: "copy", repo: "Multica-AI/multica-theme-sample" },
    ],
    ["default"],
  );
  assert.equal(entries.length, 1);
  assert.match(errors[0], /listed twice/);
  assert.match(errors[1], /unknown field "extra"/);
  assert.match(errors[1], /id must be/);
  assert.match(errors[1], /name must be/);
  assert.match(errors[1], /author must be/);
  assert.match(errors[1], /repo must be/);
  assert.match(errors[1], /modes must/);
  assert.match(errors[2], /built-in theme/);
  assert.match(errors[3], /repo .* listed twice/);
});

test("rejects a registry that is not a list", () => {
  assert.match(validateRegistry("{").errors[0], /not valid JSON/);
  assert.match(validateRegistry("{}").errors[0], /must be a list/);
});

test("finds added and changed entries", () => {
  const ink = { ...linen, id: "ink", repo: "someone/ink" };
  assert.deepEqual(changedEntries([linen], [linen, ink]), [ink]);
  assert.deepEqual(changedEntries([linen, ink], [{ ...linen, name: "Linen 2" }]), [{ ...linen, name: "Linen 2" }]);
  assert.deepEqual(changedEntries([linen], [linen]), []);
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
