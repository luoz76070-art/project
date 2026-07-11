#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(rootDir, "apps", "mobile", "android", "app", "src", "main", "res", "xml", "config.xml");

if (!fs.existsSync(configPath)) process.exit(0);

const normalized = fs
  .readFileSync(configPath, "utf8")
  .split(/\r?\n/u)
  .map((line) => line.trimEnd())
  .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
  .join("\n")
  .trimEnd();

fs.writeFileSync(configPath, `${normalized}\n`);
