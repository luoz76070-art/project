import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build, loadEnv } from "vite";
import { validateUpdateSources } from "./check-update-sources.mjs";

export async function buildHotBundle(root, rawVersion) {
  const version = rawVersion.replace(/[^A-Za-z0-9._-]/g, "-");
  const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "mobile-codex-hot-build-"));
  try {
    const mobileRoot = await fs.realpath(path.join(root, "apps/mobile"));
    validateUpdateSources(loadEnv("production", mobileRoot, "VITE_"));
    // An installed hot update has only index.html. Normal APK/Web builds keep lazy chunks.
    const result = await build({
      root: mobileRoot, mode: "production",
      build: {
        outDir: distDir, emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    });
    const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output).filter(item => item.type === "chunk");
    if (chunks.length !== 1 || chunks.some(chunk => chunk.imports.length || chunk.dynamicImports.length)) {
      throw new Error("Hot updates require one self-contained JavaScript chunk.");
    }
    let html = await fs.readFile(path.join(distDir, "index.html"), "utf8");
    html = html.replace(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>\s*/giu, "");
    const cssLinks = [...html.matchAll(/<link\b([^>]*?)\bhref=["']([^"']+\.css)["']([^>]*)>\s*/giu)];
    for (const match of cssLinks) {
      const css = (await readAsset(match[2])).replace(/<\/style/giu, "<\\/style");
      html = html.replace(match[0], () => `<style data-mobile-codex-hot-source="${escapeAttribute(match[2])}">${css}</style>\n`);
    }
    const scripts = [...html.matchAll(/<script\b([^>]*?)\bsrc=["']([^"']+\.js)["']([^>]*)><\/script>\s*/giu)];
    if (scripts.length !== 1) throw new Error("Hot updates require one JavaScript entry in index.html.");
    for (const match of scripts) {
      const type = /\btype=["']module["']/iu.test(`${match[1]} ${match[3]}`) ? ' type="module"' : "";
      const script = (await readAsset(match[2])).replace(/<\/script/giu, "<\\/script");
      html = html.replace(match[0], () => `<script${type} data-mobile-codex-hot-source="${escapeAttribute(match[2])}">${script}</script>\n`);
    }
    html = html.replace(/<head>/iu, `<head>\n    <meta name="mobile-codex-hot-bundle" content="${escapeAttribute(version)}">`);
    const output = path.join(root, "dist-hot", `mobile-codex-${version}.html`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, html);
    return { output, sha256: crypto.createHash("sha256").update(html).digest("hex"), size: Buffer.byteLength(html) };

    async function readAsset(assetUrl) {
      const asset = path.resolve(distDir, assetUrl.replace(/^[./]+/u, ""));
      if (!asset.startsWith(`${distDir}${path.sep}`)) throw new Error(`Cannot inline mobile asset: ${assetUrl}`);
      return fs.readFile(asset, "utf8");
    }
  } finally { await fs.rm(distDir, { recursive: true, force: true }); }
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
