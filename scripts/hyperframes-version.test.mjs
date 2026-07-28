import assert from "node:assert/strict";
import test from "node:test";
import { resolveHyperframesVersion } from "./lib.mjs";

test("keeps a valid project HyperFrames version", async () => {
  assert.equal(
    await resolveHyperframesVersion({ hyperframesVersion: "0.7.77" }),
    "0.7.77",
  );
});

test("repairs a missing or invalid project version from the template", async () => {
  assert.equal(await resolveHyperframesVersion({}), "0.7.78");
  assert.equal(
    await resolveHyperframesVersion({ hyperframesVersion: "undefined" }),
    "0.7.78",
  );
});
