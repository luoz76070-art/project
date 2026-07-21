import fs from "node:fs";
import path from "node:path";

const deployDir = process.env.SUB2API_DEPLOY_DIR || process.argv[2] || process.cwd();
const outputPath = path.join(deployDir, "data/public/index.html");
const stamp = "20260421authusage";

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/logo.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sub2API - AI API Gateway</title>
    <script type="module" crossorigin src="/assets/index-BPiHdAPN.js?v=${stamp}"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-vue-C0uwWLbj.js">
    <link rel="modulepreload" crossorigin href="/assets/vendor-misc-b0o8M8Xr.js">
    <link rel="modulepreload" crossorigin href="/assets/vendor-i18n-BLAxktnc.js">
    <link rel="stylesheet" crossorigin href="/assets/vendor-misc-DB0Q8XAf.css">
    <link rel="stylesheet" crossorigin href="/assets/index-BFBH2ZP7.css">
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`;

fs.writeFileSync(outputPath, html, "utf8");
console.log(outputPath);
