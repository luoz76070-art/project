import fs from "node:fs";
import path from "node:path";

const deployDir = process.env.SUB2API_DEPLOY_DIR || process.argv[2] || process.cwd();
const bundlePath = path.join(deployDir, "data/public/assets/AccountsView-DBCVZ_SC.js");
const backupPath = path.join(
  deployDir,
  "data/public/assets/AccountsView-DBCVZ_SC.js.bak-2026-04-21-remaining-fix"
);

const source = fs.readFileSync(bundlePath, "utf8");
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, source, "utf8");
}

const widthTarget = 'U=C(()=>`${Math.min(g.utilization,100)}%`)';
const widthReplacement = 'U=C(()=>g.showNowWhenIdle?`${Math.max(0,Math.min(100-g.utilization,100))}%`:`${Math.min(g.utilization,100)}%`)';
const textTarget = 'D=C(()=>{const P=Math.round(g.utilization);return P>999?">999%":`${P}%`})';
const textReplacement = 'D=C(()=>{if(g.showNowWhenIdle){const P=Math.max(0,100-g.utilization);return`余${Math.round(P)}%`}const P=Math.round(g.utilization);return P>999?">999%":`${P}%`})';

if (!source.includes(widthTarget) && !source.includes(widthReplacement)) {
  throw new Error("width snippet not found in AccountsView bundle");
}
if (!source.includes(textTarget) && !source.includes(textReplacement)) {
  throw new Error("text snippet not found in AccountsView bundle");
}

const output = source
  .replace(widthTarget, widthReplacement)
  .replace(textTarget, textReplacement);
fs.writeFileSync(bundlePath, output, "utf8");
console.log(bundlePath);
