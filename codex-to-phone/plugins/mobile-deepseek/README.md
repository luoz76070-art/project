# Mobile Codex for DeepSeek Harness

DeepSeek **官方** `dsh` 原进程 Cordis bundle，插件0.2.2精确支持 `0.2.1-rc.2` 与 `0.2.1-rc.3`。rc.3已用本机桌面实际打包的运行时完成隔离复核，rc.2另用官方发布运行时复核；不因版本号相同就假定内部接口一致。官方安装器/profile使用engines版本门，不通过SDK或新CLI替代原线程。

插件0.2.0可选择`scope: "all"`：原profile跨工作区普通线程和未加载历史，保留真实缓存标题、分页列表和按需历史。默认列表为近30天（官方最后用户对话/创建时间），仍运行或当前查看的线程保留；“查看更早会话”展开全部。摘要缓存15秒、原消息/创建/状态事件失效，手机列表前台每30秒及回前台刷新；无手机请求不扫描正文。不会删除更早的桌面记录。

查看和翻页不会启动任务。只有手机显式发送时，才经原官方`sessionController.prompt`在同一Host恢复同一sessionId；accepted仍须等待原user/message的rpcId确认。原在线任务继续用live handle排队、追加/中断，未知结果锁定不重发。中断确认表示原任务结束，不保证结束原因一定是取消。旧配置默认`directory`，继续仅精确目录内在线根会话。

支持原生提问、完整计划及工具单次允许/拒绝；两端先答生效。拿不到完整工具参数时只提供拒绝。文本按官方page读取，每页40条/256KiB，单条32768字符；手机历史窗口240条，可继续前移并返回最新。附件、工具过程和推理不作为聊天正文同步，历史提问不复活为待答卡片。连接前正在输出的部分文本可能需等权威消息补齐。directory模式保留原4096事件的大log降级规则。

## 准备

先运行仓库的 `corepack pnpm build:plugin`，独立目录为 `dist-plugin/mobile-deepseek/`。本机需要已安装兼容的官方 Harness；本项目不会自动安装或升级它。

创建私有配置文件，例如 `/absolute/private/deepseek-mobile.json`（父目录0700，文件0600）：

```json
{
  "port": 9876,
  "token": "REPLACE_WITH_AN_INDEPENDENT_RANDOM_BASE64URL_SECRET",
  "directory": "/absolute/project",
  "scope": "all"
}
```

密钥需32–512位 base64url 字符；单独生成，不复用手机、管理或 Claude 密钥。仅监听127.0.0.1；不要把9876端口暴露公网。一个桥接对应一个原dsh进程；同一端口被占用时加载失败。多进程分别使用端口和配置，不自动聚合。

在**原有 profile** 中显式安装（以下命令中的路径和profile由使用者替换）：

```sh
dsh plugin --profile EXISTING_PROFILE add /absolute/dist-plugin/mobile-deepseek
```

在启动该原profile的终端设置私有配置路径：

```sh
export MOBILE_CODEX_DEEPSEEK_CONFIG=/absolute/private/deepseek-mobile.json
```

CLI profile可用官方 `dsh --profile EXISTING_PROFILE --dump-config` 在不启动模型的情况下检查bundle层。不要为手机连接创建另一个profile或恢复另一个模型会话；已运行的进程须实际加载此插件才可接入。

### macOS 官方桌面版

桌面版的原profile为`desktop`。其CLI不一定在PATH中，可使用应用自带的入口安装：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add --offline --ignore-scripts /absolute/fixed/mobile-deepseek
```

此包没有运行依赖，离线链接即可；保留profile现有的`autoInstallPeers: false`，共享宿主的`dsh-llm`，不另装一套宿主依赖。pnpm可能提示linked peer依赖，最终以宿主实际加载和鉴权bridge响应为准。

GUI进程通常不会继承终端export。先备份`~/.dsh/profiles/desktop/cordis.patch.yml`，在原有列表后增加以下覆盖，并使用前文私有JSON配置的绝对路径：

```yaml
- id: mobile-codex
  name: dsh-mobile-codex
  config:
    configFile: /absolute/private/deepseek-mobile.json
```

官方桌面版允许自带CLI管理`desktop`的插件，但禁止通过普通`dsh --profile desktop`或`--dump-config`启动/检查这个保留profile。桌面HMR会监视profile manifest和patch；新插件可动态加载到原进程。检查桌面“插件”页启用状态及鉴权`/info`、`/sessions`的实际响应，不把安装命令成功当作已经加载。若宿主报告需要重启，等待原任务安全结束后正常重启，不为接入强停任务。2026-10-21本机动态加载及公网只读复核见[实际接入记录](../../docs/audits/2026-10-21/deepseek-desktop-connect.md)。

网关的私有 `gateway.json` 加入：

```json
{
  "deepseek": {
    "url": "http://127.0.0.1:9876/",
    "token": "SAME_AS_THE_PRIVATE_BRIDGE_TOKEN",
    "directory": "/absolute/project",
    "scope": "all"
  }
}
```

这是新增字段示例，保留原配置其余字段。显式重启网关后，手机“切换 Agent”中选择 DeepSeek Harness，再选原线程。APK22提供近30天/更早切换与连续历史窗口；APK21可继续使用默认近期列表和已有控制，但其历史显示上限仍190条。命令行Relay也支持 `MOBILE_CODEX_DEEPSEEK_URL/TOKEN/DIRECTORY`。

## 验证与回退

`corepack pnpm test:deepseek` 使用合成Cordis上下文和随机端口，不运行真实模型。`node scripts/check-deepseek-history.mjs /absolute/isolated-runtime`另以当前安装包官方list/page/prompt算法、真实SessionStore/Query与合成持久化/resolver检查冷历史；不读取用户profile，不调用模型，也不能代替用户真实继续验收。

另可显式运行 `node scripts/check-deepseek-runtime.mjs /absolute/isolated-runtime`；目录需已包含同版的官方`@deepseek-ai/dsh`、`@deepseek-ai/dsh-agent-loop-testkit`及其依赖（精确rc.2或rc.3），Cordis固定4.0.5。检查器不安装依赖，使用临时profile验证bundle解析/版本门/CLI配置、Loader与内存Session/事件总线、依赖卸载/恢复和端口释放；再以官方生产AgentLoop及本地确定性adapter验证排队、追加、流与权威文本去重、中断保留Inbox和旧任务令牌拒绝。2026-10-21此13项及隔离回归22/22通过，3次本地响应、外部模型请求0次。最后清理自己的Context/profile；不读取用户配置或原会话。

插件0.1.1修复官方流的revision逐帧递增校验，拒绝旧revision、错attempt和错index，避免正文被全部过滤。APK21和网关无需更换；宿主需要显式加载此修复插件。安装、加载和原会话控制须分别验收，隔离检查不代表Android真实控制已经通过。

卸载使用 `dsh plugin --profile EXISTING_PROFILE remove dsh-mobile-codex`，并删除网关deepseek字段；只停止该插件的监听与订阅，不终止原Agent或清空其inbox。进程重启后不承诺跨重启exactly-once；不对结果未知的输入重新发送。

## rc.3升级边界

插件从宿主共享的`@deepseek-ai/dsh-llm/package.json`读取实际版本，经精确白名单校验后用于`/info.harnessVersion`。缺失/未知版本拒绝启动，不能硬编码rc.2让新版宿主伪装通过。对应网关也必须接受rc.3；只改插件或只改网关均不完整。APK36沿用，无需为本次桥接兼容重新安装。

本次两版官方隔离检查各通过13项运行时、8项问答审批和4项历史；只登记本地确定性adapter，不读取用户profile或调用外部模型。部署和原手机结果另记[rc.3验收记录](../../docs/audits/2026-10-30/deepseek-rc3-compat.md)。
