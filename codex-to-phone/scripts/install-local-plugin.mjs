#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLUGIN_NAME = "codex-to-phone";
const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HOME = os.homedir();
const LOCAL_PLUGIN_DIR = path.join(HOME, "plugins", PLUGIN_NAME);
const MARKETPLACE_DIR = path.join(HOME, ".agents", "plugins");
const MARKETPLACE_FILE = path.join(MARKETPLACE_DIR, "marketplace.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureSymlink() {
  fs.mkdirSync(path.dirname(LOCAL_PLUGIN_DIR), { recursive: true });
  try {
    const stat = fs.lstatSync(LOCAL_PLUGIN_DIR);
    if (stat.isSymbolicLink() && path.resolve(fs.readlinkSync(LOCAL_PLUGIN_DIR)) === ROOT_DIR) {
      return;
    }
    throw new Error(`${LOCAL_PLUGIN_DIR} already exists and is not the expected symlink`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  fs.symlinkSync(ROOT_DIR, LOCAL_PLUGIN_DIR, "dir");
}

function ensureMarketplace() {
  fs.mkdirSync(MARKETPLACE_DIR, { recursive: true });
  const marketplace = readJson(MARKETPLACE_FILE, {
    name: "local",
    interface: { displayName: "Local Plugins" },
    plugins: [],
  });
  marketplace.name ||= "local";
  marketplace.interface ||= { displayName: "Local Plugins" };
  marketplace.interface.displayName ||= "Local Plugins";
  marketplace.plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];

  const entry = {
    name: PLUGIN_NAME,
    source: {
      source: "local",
      path: `./plugins/${PLUGIN_NAME}`,
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Productivity",
  };

  const index = marketplace.plugins.findIndex((plugin) => plugin?.name === PLUGIN_NAME);
  if (index >= 0) {
    marketplace.plugins[index] = entry;
  } else {
    marketplace.plugins.push(entry);
  }
  fs.writeFileSync(MARKETPLACE_FILE, `${JSON.stringify(marketplace, null, 2)}\n`);
}

function main() {
  if (!fs.existsSync(path.join(ROOT_DIR, ".codex-plugin", "plugin.json"))) {
    throw new Error("Missing .codex-plugin/plugin.json. Run this script from a complete codex-to-phone checkout.");
  }
  ensureSymlink();
  ensureMarketplace();
  console.log(`Installed local Codex plugin: ${LOCAL_PLUGIN_DIR}`);
  console.log(`Updated marketplace: ${MARKETPLACE_FILE}`);
  console.log("Restart Codex Desktop, then say: 启动 Codex To Phone");
}

main();
