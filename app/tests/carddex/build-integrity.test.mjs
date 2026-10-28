import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureBuildInputs, changedBuildInputs } from "../../scripts/build.mjs";

const temporary = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

test("build integrity detects changes, additions and removals across shared inputs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "carddex-build-"));
  temporary.push(root);
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "public"));
  await writeFile(path.join(root, "src/shell.tsx"), "old shell");
  await writeFile(path.join(root, "public/logo.svg"), "old logo");
  const before = await captureBuildInputs(root);
  await writeFile(path.join(root, "src/shell.tsx"), "new shell");
  await writeFile(path.join(root, "public/new-logo.svg"), "new logo");
  await rm(path.join(root, "public/logo.svg"));
  expect(changedBuildInputs(before, await captureBuildInputs(root))).toEqual([
    "public/logo.svg", "public/new-logo.svg", "src/shell.tsx",
  ]);
});

test("generated route writes and dependency caches do not invalidate stable source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "carddex-build-"));
  temporary.push(root);
  await mkdir(path.join(root, "src/node_modules"), { recursive: true });
  await writeFile(path.join(root, "src/page.tsx"), "same source");
  const before = await captureBuildInputs(root);
  await writeFile(path.join(root, "src/page.tsx"), "same source");
  await writeFile(path.join(root, "src/routeTree.gen.ts"), "generated routes");
  await writeFile(path.join(root, "src/node_modules/cache.js"), "dependency cache");
  expect(changedBuildInputs(before, await captureBuildInputs(root))).toEqual([]);
});
