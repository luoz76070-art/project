import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const cliArgs = process.argv.slice(2).filter((argument) => argument !== "--");
const version = (cliArgs[0] ?? "local").replace(/[^A-Za-z0-9._-]/g, "-");
const distDir = path.join(root, "apps", "mobile", "dist");
const source = path.join(distDir, "index.html");
const outputDir = path.join(root, "dist-hot");
const output = path.join(outputDir, `mobile-codex-${version}.html`);

if (!fs.existsSync(source)) {
  throw new Error("apps/mobile/dist/index.html is missing. Run the mobile build first.");
}

let html = fs.readFileSync(source, "utf8");
html = html.replace(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>\s*/giu, "");
html = html.replace(/<link\b([^>]*?)\bhref=["']([^"']+\.css)["']([^>]*)>\s*/giu, (_match, _before, href) => {
  const css = readAsset(href).replace(/<\/style/giu, "<\\/style");
  return `<style data-mobile-codex-hot-source="${escapeAttribute(href)}">${css}</style>\n`;
});
html = html.replace(
  /<script\b([^>]*?)\bsrc=["']([^"']+\.js)["']([^>]*)><\/script>\s*/giu,
  (_match, before, src, after) => {
    const attributes = `${before} ${after}`;
    const type = /\btype=["']module["']/iu.test(attributes) ? ' type="module"' : "";
    const script = readAsset(src).replace(/<\/script/giu, "<\\/script");
    return `<script${type} data-mobile-codex-hot-source="${escapeAttribute(src)}">${script}</script>\n`;
  },
);

const marker = `<meta name="mobile-codex-hot-bundle" content="${escapeAttribute(version)}">`;
html = html.replace(/<head>/iu, `<head>\n    ${marker}`);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(output, html);

const sha256 = crypto.createHash("sha256").update(html).digest("hex");
console.log(`HOT_BUNDLE=${output}`);
console.log(`SHA256=${sha256}`);
console.log(`SIZE=${Buffer.byteLength(html)}`);

function readAsset(assetUrl) {
  const relative = assetUrl.replace(/^[./]+/u, "");
  const asset = path.resolve(distDir, relative);
  if (!asset.startsWith(`${distDir}${path.sep}`) || !fs.existsSync(asset)) {
    throw new Error(`Cannot inline mobile asset: ${assetUrl}`);
  }
  return fs.readFileSync(asset, "utf8");
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
