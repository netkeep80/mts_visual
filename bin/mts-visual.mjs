#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createDocument2DRenderManifest,
  layoutDocument2D,
  parseDocument2DInputManifest,
  serializeDocument2DSvg,
} from "../dist/src/index.js";

function usage() {
  return [
    "Usage:",
    "  mts-visual render-2d --input <path> --output <path.svg>",
    "    [--manifest <path.json>]",
    "    [--profile formal|article|debug]",
    "    [--strategy auto|canonical|radial|layered]",
    "    [--root <VisualKey>]",
    "    [--renderer-sha <git-sha>]",
  ].join("\n");
}

const ALLOWED_OPTIONS = new Set([
  "input",
  "output",
  "manifest",
  "profile",
  "strategy",
  "root",
  "renderer-sha",
  "format",
]);

function parseArgs(argv) {
  if (argv[0] !== "render-2d") throw new Error(usage());
  const result = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}\n${usage()}`);
    const name = token.slice(2);
    if (!ALLOWED_OPTIONS.has(name)) {
      throw new Error(`unknown option: --${name}\n${usage()}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for --${name}\n${usage()}`);
    }
    if (Object.hasOwn(result, name)) throw new Error(`duplicate option: --${name}`);
    result[name] = value;
    index += 1;
  }
  return result;
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`required option missing: --${name}\n${usage()}`);
  }
  return value;
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`invalid ${label}: ${value}; expected one of ${allowed.join(", ")}`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function resolveRendererSha(explicit) {
  const candidates = [
    explicit,
    process.env.MTS_VISUAL_SHA,
    process.env.GITHUB_SHA,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[0-9a-f]{40,64}$/i.test(candidate)) {
      return candidate.toLowerCase();
    }
  }
  try {
    const git = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^[0-9a-f]{40,64}$/i.test(git)) return git.toLowerCase();
  } catch {
    // Fail closed below: provenance without renderer revision is not accepted.
  }
  throw new Error(
    "renderer SHA unavailable; pass --renderer-sha or set MTS_VISUAL_SHA/GITHUB_SHA",
  );
}

async function packageVersion() {
  const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const pkg = JSON.parse(raw);
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("package.json has no renderer version");
  }
  return pkg.version;
}

async function runRender2D(argv) {
  const options = parseArgs(argv);
  const inputPath = required(options, "input");
  const outputPath = required(options, "output");
  const manifestPath = options.manifest ?? `${outputPath}.manifest.json`;
  const format = oneOf(options.format ?? "svg", ["svg"], "format");
  const profile = oneOf(options.profile ?? "article", ["formal", "article", "debug"], "profile");
  const strategy = oneOf(
    options.strategy ?? "auto",
    ["auto", "canonical", "radial", "layered"],
    "strategy",
  );
  const rootKey = options.root;
  const rendererSha = resolveRendererSha(options["renderer-sha"]);

  const inputBytes = await readFile(inputPath);
  let parsed;
  try {
    parsed = JSON.parse(inputBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }
  const input = parseDocument2DInputManifest(parsed);

  const layout = layoutDocument2D(input.network, {
    profile,
    strategy,
    ...(rootKey === undefined ? {} : { rootKey }),
  });
  const svg = serializeDocument2DSvg(input.network, layout);
  const svgBytes = Buffer.from(svg, "utf8");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, svgBytes);

  const manifest = createDocument2DRenderManifest({
    inputPath,
    inputDigest: sha256(inputBytes),
    ...(input.sourceRepository === undefined ? {} : { sourceRepository: input.sourceRepository }),
    ...(input.sourceSha === undefined ? {} : { sourceSha: input.sourceSha }),
    rendererVersion: await packageVersion(),
    rendererSha,
    profile,
    layoutOptions: {
      strategy,
      rootKey: rootKey ?? null,
    },
    seedStrategy: layout.metrics.seedStrategy,
    quality: layout.metrics.qualityAfter,
    outputPath,
    outputDigest: sha256(svgBytes),
  });
  if (format !== manifest.format) {
    throw new Error(`internal format mismatch: requested ${format}, manifest ${manifest.format}`);
  }

  await mkdir(dirname(manifestPath), { recursive: true });
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(manifestPath, manifestText, "utf8");

  process.stdout.write(JSON.stringify({
    output: outputPath,
    manifest: manifestPath,
    outputDigest: manifest.outputDigest,
    seedStrategy: manifest.seedStrategy,
    quality: manifest.quality,
  }) + "\n");
}

try {
  await runRender2D(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`mts-visual: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
