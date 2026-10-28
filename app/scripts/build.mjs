import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const APP_ROOT = fileURLToPath(new URL("../", import.meta.url));
const INPUT_PATHS = [
  "src", "public", "packages", "scripts", "../chain/sdk/src",
  "vite.config.ts", "package.json", "tsconfig.json",
];
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);

/** Capture the inputs shared by Vite's separate client and SSR build phases. */
export async function captureBuildInputs(root = APP_ROOT) {
  const snapshot = new Map();
  async function visit(relativePath) {
    let entries;
    try {
      entries = await readdir(path.resolve(root, relativePath), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      if (error.code !== "ENOTDIR") throw error;
      const content = await readFile(path.resolve(root, relativePath));
      snapshot.set(relativePath, createHash("sha256").update(content).digest("hex"));
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      // TanStack writes this generated index during a build. Its source routes
      // are captured; writing the generated output is not an input mutation.
      if (entry.name === "routeTree.gen.ts") continue;
      if (!entry.isSymbolicLink()) await visit(path.join(relativePath, entry.name));
    }
  }
  for (const relativePath of INPUT_PATHS) await visit(relativePath);
  return snapshot;
}

export function changedBuildInputs(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((name) => before.get(name) !== after.get(name)).sort();
}

async function build() {
  const before = await captureBuildInputs();
  const children = new Set();
  const stop = (signal) => { for (const child of children) child.kill(signal); };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  function run(binary, args) {
    return new Promise((resolve) => {
      const child = spawn(path.join(APP_ROOT, "node_modules/.bin", binary), args, {
        cwd: APP_ROOT, stdio: "inherit", env: process.env,
      });
      children.add(child);
      child.once("error", (error) => {
        console.error(`${binary}: ${error.message}`);
        children.delete(child);
        resolve(1);
      });
      child.once("close", (code) => {
        children.delete(child);
        resolve(code ?? 1);
      });
    });
  }
  // Await both children even when one fails. A leftover Vite process can
  // otherwise overwrite the next build's output after the shell has exited.
  const results = await Promise.all([run("tsc", ["--noEmit"]), run("vite", ["build"])]);
  const changed = changedBuildInputs(before, await captureBuildInputs());
  if (changed.length) {
    console.error("\nBuild rejected: inputs changed between the client and SSR phases:");
    for (const name of changed.slice(0, 12)) console.error(`  ${name}`);
    if (changed.length > 12) console.error(`  ...and ${changed.length - 12} more`);
    console.error("Finish source/asset edits, then run the build again before restarting preview.");
  }
  process.exitCode = changed.length || results.some((code) => code !== 0) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
}
