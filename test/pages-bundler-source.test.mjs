import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`pages-bundler-source: ${message}`);
  }
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(repoRoot, "package-lock.json"), "utf8"));
const workflow = await readFile(
  join(repoRoot, ".github", "workflows", "webgpu-witness-pages.yml"),
  "utf8",
);

assert(
  pkg.devDependencies?.esbuild === "0.24.2",
  "package.json must pin esbuild 0.24.2 exactly",
);
assert(
  lock.packages?.[""]?.devDependencies?.esbuild === "0.24.2",
  "package-lock root must pin esbuild 0.24.2 exactly",
);
assert(
  lock.packages?.["node_modules/esbuild"]?.version === "0.24.2",
  "package-lock must contain the exact esbuild package",
);
assert(
  lock.packages?.["node_modules/@esbuild/linux-x64"]?.version === "0.24.2",
  "package-lock must contain the CI platform optional binary package",
);

const localInvocations =
  workflow.match(/\.\/node_modules\/\.bin\/esbuild/g) ?? [];
assert(
  localInvocations.length === 3,
  `expected 3 local esbuild invocations, got ${localInvocations.length}`,
);
assert(
  !workflow.includes("npx --yes esbuild"),
  "Pages workflow must not fetch esbuild on demand",
);
assert(
  workflow.includes("npm ci --ignore-scripts --no-audit --no-fund"),
  "Pages workflow must install from the lockfile before bundling",
);

console.log("Pages lockfile-closed bundler contract: PASS");
