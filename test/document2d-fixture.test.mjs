import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function assert(condition, message) {
  if (!condition) throw new Error(`document2d-fixture: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repoRoot, "bin", "mts-visual.mjs");
const fixture = join(repoRoot, "fixtures", "document2d", "article-root.input.json");
const rendererSha = "c".repeat(40);
const EXPECTED_SVG_SHA256 = "c8a7c700a9a0232f2d563827aa25e3a2a273d6278d2a0e38a65466e1b7f93ebb";
const EXPECTED_SEED = "layered";
const directory = await mkdtemp(join(tmpdir(), "mts-visual-article-fixture-"));

try {
  const render = async (name) => {
    const output = join(directory, `${name}.svg`);
    const manifest = join(directory, `${name}.manifest.json`);
    const run = spawnSync(process.execPath, [
      cli,
      "render-2d",
      "--input", fixture,
      "--output", output,
      "--manifest", manifest,
      "--profile", "article",
      "--strategy", "auto",
      "--root", "R",
      "--format", "svg",
      "--renderer-sha", rendererSha,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert(run.status === 0, `${name} render failed: ${run.stderr}`);
    const svg = await readFile(output);
    const renderManifest = JSON.parse(await readFile(manifest, "utf8"));
    return { svg, renderManifest };
  };

  const first = await render("first");
  const second = await render("second");
  assert(first.svg.equals(second.svg), "canonical fixture SVG is byte-stable");
  assert(
    first.renderManifest.outputDigest === second.renderManifest.outputDigest,
    "canonical fixture digest is stable",
  );
  const digest = sha256(first.svg);
  assert(first.renderManifest.outputDigest === digest, "manifest digest matches exact SVG bytes");
  assert(digest === EXPECTED_SVG_SHA256, `canonical SVG digest drifted: ${digest}`);
  assert(first.renderManifest.seedStrategy === EXPECTED_SEED, `canonical seed drifted: ${first.renderManifest.seedStrategy}`);
  assert(first.renderManifest.seedStrategy === "layered"
      || first.renderManifest.seedStrategy === "radial"
      || first.renderManifest.seedStrategy === "canonical",
    "auto strategy records an accepted deterministic seed");
  assert(first.renderManifest.quality.crossings >= 0, "crossing metric finite/non-negative");
  assert(first.renderManifest.quality.centerOverlaps >= 0, "center overlap metric finite/non-negative");
  assert(first.renderManifest.quality.labelOverlaps >= 0, "label overlap metric finite/non-negative");

  console.log(`PINNED_DOCUMENT2D_SVG_SHA256=${digest}`);
  console.log(`PINNED_DOCUMENT2D_SEED=${first.renderManifest.seedStrategy}`);
  console.log("document2d canonical article fixture: PASS");
} finally {
  await rm(directory, { recursive: true, force: true });
}
