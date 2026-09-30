import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as webgpu from "../dist/src/webgpu/index.js";

const NAGA_PACKAGE = "naga-wasi-cli@0.1.0";
const EXPECTED_WGSL_EXPORTS = Object.freeze([
  "MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL",
  "MONOLITHIC_LINK_WEBGPU_RENDER_WGSL",
  "MONOLITHIC_LINK_WEBGPU_WGSL",
  "OCTAHEDRAL_WEBGPU_RENDER_WGSL",
  "OCTAHEDRAL_WEBGPU_WGSL",
  "RIGID_SECTION_WEBGPU_RENDER_WGSL",
  "RIGID_SECTION_WEBGPU_WGSL",
]);

function assert(condition, message) {
  if (!condition) throw new Error(`wgsl-naga: ${message}`);
}

function runNaga(args, options = {}) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(
    executable,
    ["--yes", NAGA_PACKAGE, ...args],
    {
      encoding: "utf8",
      ...options,
    },
  );
}

const discovered = Object.keys(webgpu)
  .filter((name) => name.endsWith("_WGSL"))
  .sort();

assert(
  JSON.stringify(discovered) === JSON.stringify(EXPECTED_WGSL_EXPORTS),
  `production WGSL export set changed: expected=${EXPECTED_WGSL_EXPORTS.join(",")} actual=${discovered.join(",")}`,
);

const directory = await mkdtemp(join(tmpdir(), "mts-visual-wgsl-naga-"));

try {
  const shaderPaths = [];
  for (const name of EXPECTED_WGSL_EXPORTS) {
    const source = webgpu[name];
    assert(typeof source === "string" && source.trim().length > 0, `${name} is not a non-empty shader string`);
    const path = join(directory, `${name}.wgsl`);
    await writeFile(path, source, "utf8");
    shaderPaths.push(path);
  }

  const validation = runNaga(["--bulk-validate", ...shaderPaths]);
  if (validation.status !== 0) {
    process.stderr.write(validation.stdout ?? "");
    process.stderr.write(validation.stderr ?? "");
    throw new Error(`Naga rejected production WGSL (exit=${validation.status})`);
  }

  // Negative control: prove that the external validator is actually parsing input,
  // rather than succeeding because of a wrapper/no-op failure.
  const invalidPath = join(directory, "invalid-negative-control.wgsl");
  await writeFile(
    invalidPath,
    "@compute @workgroup_size(1) fn broken() { let value = ; }\n",
    "utf8",
  );
  const invalid = runNaga([invalidPath]);
  assert(
    invalid.status !== 0,
    "negative-control invalid WGSL was unexpectedly accepted",
  );

  console.log(
    `WGSL Naga validation: PASS · validator=${NAGA_PACKAGE} · modules=${shaderPaths.length}`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
