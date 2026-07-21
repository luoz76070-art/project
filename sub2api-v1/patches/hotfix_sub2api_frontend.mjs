import fs from "node:fs";
import path from "node:path";

const deployDir = process.env.SUB2API_DEPLOY_DIR || process.argv[2] || process.cwd();
const assetsDir = path.join(deployDir, "data/public/assets");
const timestamp = "2026-04-21-auth-usage-hotfix";
const mainSourcePath = path.join(assetsDir, "index-BPiHdAPN.js.orig");
const mainOutputPath = path.join(assetsDir, "index-BPiHdAPN.js");
const accountsPath = path.join(assetsDir, "AccountsView-DBCVZ_SC.js");
const backupPath = path.join(assetsDir, "AccountsView-DBCVZ_SC.js.bak-" + timestamp);

const banner = `/* ${timestamp} */\n`;

const mainSource = fs.readFileSync(mainSourcePath, "utf8");
const accountsChunkQuery = "AccountsView-DBCVZ_SC.js?v=20260421authusage";
const mainPatched = mainSource.replaceAll(
  "AccountsView-DBCVZ_SC.js",
  accountsChunkQuery
);
if (mainPatched === mainSource) {
  throw new Error("expected AccountsView chunk reference not found in main bundle");
}
fs.writeFileSync(mainOutputPath, banner + mainPatched, "utf8");

const currentAccountsSource = fs.readFileSync(accountsPath, "utf8");
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, currentAccountsSource, "utf8");
}
const accountsSource = fs.readFileSync(backupPath, "utf8");

const target = "const P={};b&&(P.proxy_id=b),y&&(P.redirect_uri=y);";
const replacement =
  "const P={},W=(typeof b==\"number\"||typeof b==\"string\"&&/^\\\\d+$/.test(b))?Number(b):null,G=(typeof y==\"number\"||typeof y==\"string\"&&/^\\\\d+$/.test(y))?Number(y):null,J=typeof b==\"string\"&&/^http:\\\\/\\\\/(localhost|127\\\\.0\\\\.0\\\\.1)(:\\\\d+)?(\\\\/|$)/i.test(b)?b:typeof y==\"string\"&&/^http:\\\\/\\\\/(localhost|127\\\\.0\\\\.0\\\\.1)(:\\\\d+)?(\\\\/|$)/i.test(y)?y:\"\";W&&(P.proxy_id=W),!W&&G&&(P.proxy_id=G),J&&(P.redirect_uri=J);";

if (!accountsSource.includes(target)) {
  throw new Error("expected OpenAI OAuth snippet not found in AccountsView bundle");
}

const accountsPatched = banner + accountsSource.replace(target, replacement);
fs.writeFileSync(accountsPath, accountsPatched, "utf8");

console.log(JSON.stringify({
  mainOutputPath,
  accountsPath,
  backupPath,
  timestamp
}, null, 2));
