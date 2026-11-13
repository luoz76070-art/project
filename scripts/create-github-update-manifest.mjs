import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export async function createAndroidManifest(options) {
  const artifact = await inspectArtifact(options.artifact);
  const versionCode = positiveInteger(options.versionCode, "versionCode");
  const versionName = safeToken(options.versionName, "versionName");
  const repository = safeRepository(options.repository);
  const releaseTag = safeToken(options.releaseTag, "release-tag");
  return {
    platform: "android",
    versionName,
    versionCode,
    apkUrl: `https://github.com/${repository}/releases/download/${releaseTag}/${encodeURIComponent(artifact.name)}`,
    size: artifact.size,
    sha256: artifact.sha256,
    mandatory: false,
    notes: options.notes ?? "Automated MobiCodex Android release.",
    publishedAt: options.publishedAt ?? new Date().toISOString(),
  };
}

export async function createHotManifest(options) {
  const artifact = await inspectArtifact(options.artifact);
  const version = safeToken(options.version, "version");
  const minNativeVersionCode = positiveInteger(options.minNativeVersionCode, "minNativeVersionCode");
  const maxNativeVersionCode = positiveInteger(options.maxNativeVersionCode, "maxNativeVersionCode");
  if (maxNativeVersionCode < minNativeVersionCode) throw new Error("maxNativeVersionCode must be >= minNativeVersionCode");
  const repository = safeRepository(options.repository);
  const releaseTag = safeToken(options.releaseTag, "release-tag");
  return {
    platform: "android",
    channel: "hot",
    version,
    htmlUrl: `https://github.com/${repository}/releases/download/${releaseTag}/${encodeURIComponent(artifact.name)}`,
    sha256: artifact.sha256,
    size: artifact.size,
    minNativeVersionCode,
    maxNativeVersionCode,
    notes: options.notes ?? "Automated MobiCodex hot update.",
    publishedAt: options.publishedAt ?? new Date().toISOString(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  const [kind, ...rawArgs] = process.argv.slice(2);
  const args = parseArgs(rawArgs);
  if (kind !== "android" && kind !== "hot") throw new Error("Usage: create-github-update-manifest.mjs <android|hot> [options]");
  const notes = args.notesFile ? (await fs.readFile(args.notesFile, "utf8")).trim() : undefined;
  const common = { ...args, notes };
  const manifest = kind === "android" ? await createAndroidManifest(common) : await createHotManifest(common);
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${args.output}\n`);
}

async function inspectArtifact(file) {
  if (!file) throw new Error("artifact is required");
  const data = await fs.readFile(file);
  return { name: path.basename(file), size: data.byteLength, sha256: crypto.createHash("sha256").update(data).digest("hex") };
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    result[key] = next;
    index += 1;
  }
  if (!result.output) throw new Error("output is required");
  return result;
}

function safeToken(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) || value.includes("..")) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function safeRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error("Invalid repository");
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`Invalid ${label}`);
  return number;
}
