import fs from "node:fs";
import path from "node:path";

const deployDir = process.env.SUB2API_DEPLOY_DIR || process.argv[2] || process.cwd();
const bundlePath = path.join(deployDir, "data/public/assets/AccountsView-DBCVZ_SC.js");
const backupPath = path.join(
  deployDir,
  "data/public/assets/AccountsView-DBCVZ_SC.js.bak-2026-04-21-openai-row-refresh"
);

const source = fs.readFileSync(bundlePath, "utf8");
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, source, "utf8");
}

const logicTarget = 'ot=async()=>{h.value=!0;try{M.value=await ue.accounts.getUsage(o.account.id,"active")}catch(A){console.error("Failed to load active usage:",A)}finally{h.value=!1}},Tt=(A,f,N)=>{';
const logicReplacement = 'ot=async()=>{h.value=!0;try{M.value=await ue.accounts.getUsage(o.account.id,"active")}catch(A){console.error("Failed to load active usage:",A)}finally{h.value=!1}},refreshOA=async()=>{h.value=!0;try{const A=await ue.accounts.getUsage(o.account.id);M.value=A,g.set(o.account.id,{data:A,ts:Date.now()})}catch(A){console.error("Failed to refresh OpenAI usage:",A)}finally{h.value=!1}},Tt=(A,f,N)=>{';

const renderTarget = '(n(),r(ie,{key:1},[F.value?(n(),r("div",q4,[(N=M.value)!=null&&N.five_hour?(n(),Se(ta,{key:0,label:"5h",utilization:M.value.five_hour.utilization,"resets-at":M.value.five_hour.resets_at,"window-stats":M.value.five_hour.window_stats,"show-now-when-idle":!0,color:"indigo"},null,8,["utilization","resets-at","window-stats"])):k("",!0),(Te=M.value)!=null&&Te.seven_day?(n(),Se(ta,{key:1,label:"7d",utilization:M.value.seven_day.utilization,"resets-at":M.value.seven_day.resets_at,"window-stats":M.value.seven_day.window_stats,"show-now-when-idle":!0,color:"emerald"},null,8,["utilization","resets-at","window-stats"])):k("",!0)])):_.value?';
const renderReplacement = '(n(),r(ie,{key:1},[F.value?(n(),r("div",q4,[(N=M.value)!=null&&N.five_hour?(n(),Se(ta,{key:0,label:"5h",utilization:M.value.five_hour.utilization,"resets-at":M.value.five_hour.resets_at,"window-stats":M.value.five_hour.window_stats,"show-now-when-idle":!0,color:"indigo"},null,8,["utilization","resets-at","window-stats"])):k("",!0),(Te=M.value)!=null&&Te.seven_day?(n(),Se(ta,{key:1,label:"7d",utilization:M.value.seven_day.utilization,"resets-at":M.value.seven_day.resets_at,"window-stats":M.value.seven_day.window_stats,"show-now-when-idle":!0,color:"emerald"},null,8,["utilization","resets-at","window-stats"])):k("",!0),e("div",{class:"mt-0.5 flex items-center gap-1.5"},[e("button",{type:"button","data-testid":"openai-usage-refresh",class:"inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-colors",disabled:h.value,onClick:refreshOA},[(n(),r("svg",{class:q(["h-2.5 w-2.5",{"animate-spin":h.value}]),fill:"none",stroke:"currentColor",viewBox:"0 0 24 24"},[...f[30]||(f[30]=[e("path",{"stroke-linecap":"round","stroke-linejoin":"round","stroke-width":"2",d:"M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"},null,-1)])],2)),te(" "+a(t(u)("common.refresh")),1)],8,["disabled"])])])):_.value?';

if (!source.includes(logicTarget)) {
  throw new Error("logic target snippet not found in AccountsView bundle");
}

if (!source.includes(renderTarget)) {
  throw new Error("render target snippet not found in AccountsView bundle");
}

const output = source
  .replace(logicTarget, logicReplacement)
  .replace(renderTarget, renderReplacement);

fs.writeFileSync(bundlePath, output, "utf8");
console.log(bundlePath);
