import assert from "node:assert/strict";
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
