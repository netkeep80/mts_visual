import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function assert(condition, message) {
  if (!condition) throw new Error(`document2d-cli: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repoRoot, "bin", "mts-visual.mjs");
const rendererSha = "a".repeat(40);
const sourceSha = "b".repeat(40);
const directory = await mkdtemp(join(tmpdir(), "mts-visual-document2d-"));

try {
  const input = join(directory, "input.json");
  const output = join(directory, "article.svg");
  const manifest = join(directory, "article.manifest.json");
  const payload = {
    schema: "mts-visual-document-input/v1",
    sourceRepository: "netkeep80/anum_docs",
    sourceSha,
    links: [
      { key: "R", startKey: "R", endKey: "R", label: "ROOT" },
      { key: "O", startKey: "O", endKey: "R" },
      { key: "C", startKey: "R", endKey: "C" },
      { key: "L", startKey: "O", endKey: "C" },
      { key: "U", startKey: "C", endKey: "O" },
    ],
  };
  const inputText = JSON.stringify(payload, null, 2) + "\n";
  await writeFile(input, inputText, "utf8");

  const run = () => spawnSync(process.execPath, [
    cli,
    "render-2d",
    "--input", input,
    "--output", output,
    "--manifest", manifest,
    "--profile", "article",
    "--strategy", "auto",
    "--root", "R",
    "--renderer-sha", rendererSha,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  const first = run();
  assert(first.status === 0, `first render failed: ${first.stderr}`);
  const firstSvg = await readFile(output);
  const firstManifestBytes = await readFile(manifest);
  const firstManifest = JSON.parse(firstManifestBytes.toString("utf8"));

  assert(firstSvg.toString("utf8").startsWith("<svg "), "SVG output");
  assert(firstManifest.schema === "mts-visual-document-render/v1", "render manifest schema");
  assert(firstManifest.inputDigest === sha256(Buffer.from(inputText)), "raw input digest");
  assert(firstManifest.outputDigest === sha256(firstSvg), "exact output digest");
  assert(firstManifest.rendererSha === rendererSha, "renderer SHA provenance");
  assert(firstManifest.sourceRepository === "netkeep80/anum_docs", "source repository provenance");
  assert(firstManifest.sourceSha === sourceSha, "source SHA provenance");
  assert(firstManifest.profile === "article", "profile provenance");
  assert(firstManifest.layoutOptions.strategy === "auto", "requested strategy provenance");
  assert(firstManifest.layoutOptions.rootKey === "R", "root presentation hint provenance");
  assert(["canonical", "radial", "layered"].includes(firstManifest.seedStrategy), "chosen seed provenance");

  const second = run();
  assert(second.status === 0, `second render failed: ${second.stderr}`);
  const secondSvg = await readFile(output);
  const secondManifestBytes = await readFile(manifest);
  assert(firstSvg.equals(secondSvg), "same invocation produces byte-identical SVG");
  assert(firstManifestBytes.equals(secondManifestBytes), "same invocation produces byte-identical manifest");

  const reversedInput = join(directory, "reversed.json");
  const reversedOutput = join(directory, "reversed.svg");
  const reversedManifest = join(directory, "reversed.manifest.json");
  await writeFile(reversedInput, JSON.stringify({
    ...payload,
    links: [...payload.links].reverse(),
  }, null, 2) + "\n", "utf8");
  const reversed = spawnSync(process.execPath, [
    cli,
    "render-2d",
    "--input", reversedInput,
    "--output", reversedOutput,
    "--manifest", reversedManifest,
    "--profile", "article",
    "--strategy", "auto",
    "--root", "R",
    "--renderer-sha", rendererSha,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert(reversed.status === 0, `reversed render failed: ${reversed.stderr}`);
  const reversedSvg = await readFile(reversedOutput);
  assert(firstSvg.equals(reversedSvg), "input Link record order does not alter SVG");

  const malformed = join(directory, "malformed.json");
  const malformedOutput = join(directory, "malformed.svg");
  await writeFile(malformed, JSON.stringify({ links: payload.links }), "utf8");
  const failed = spawnSync(process.execPath, [
    cli,
    "render-2d",
    "--input", malformed,
    "--output", malformedOutput,
    "--renderer-sha", rendererSha,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert(failed.status !== 0, "malformed manifest fails closed");
  assert(failed.stderr.includes("invalid-schema"), "malformed failure is diagnostic");

  console.log("document2d CLI/provenance: PASS");
} finally {
  await rm(directory, { recursive: true, force: true });
}
