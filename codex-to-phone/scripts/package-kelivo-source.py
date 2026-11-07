"""Package matching Kelivo preview sources, licenses and build instructions."""
import argparse
import gzip
import hashlib
import io
import json
import pathlib
import re
import subprocess
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apk', type=pathlib.Path, required=True)
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()
OUT = args.output.resolve()
OUT.mkdir(parents=True, exist_ok=True)
RELEASE = OUT / 'release'
RELEASE.mkdir(exist_ok=True)
APK = args.apk.resolve()
metadata = json.loads(pathlib.Path(str(APK) + '.json').read_text())
assert metadata['applicationId'] == 'com.mobilecodex.kelivo.preview'
assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-native-preview', metadata['versionName'])
APK_SHA = metadata['sha256']
assert hashlib.sha256(APK.read_bytes()).hexdigest() == APK_SHA
assert APK.stat().st_size == metadata['bytes']
version = metadata['versionName'].replace('-native-preview', '-preview')
prefix = 'mobile-codex-kelivo-' + version + '-source'
paths = subprocess.check_output([
    'rg', '--files', '--hidden', '-g', '!.git',
    'apps/kelivo', 'apps/mobile', 'apps/relay', 'generated-protocol',
    'integrations/kelivo', 'scripts', 'plugins',
], cwd=ROOT, text=True).splitlines()
paths += ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'eslint.config.mjs', '.gitignore']
for name in ['.npmrc']:
    if (ROOT / name).is_file():
        paths.append(name)
paths = sorted(set(paths))
upstream = json.loads((ROOT / 'integrations/kelivo/source-files.json').read_text())
assert all('apps/kelivo/' + name in paths for name in upstream['files'])
blocked_names = {'.env', 'local.properties', 'key.properties', 'google-services.json'}
blocked_parts = {'node_modules', '.git', '.gradle', '.dart_tool', '.tools', '.pub-cache', 'output'}
blocked_suffixes = {'.pem', '.key', '.jks', '.keystore', '.p12', '.apk', '.log', '.sqlite', '.db'}
patterns = {
    'private-key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'github-token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b'),
    'model-key': re.compile(rb'\bsk-(?:proj-)?[A-Za-z0-9_-]{28,}\b'),
    'aws-key': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
}
entries = {}
inventory = []
findings = []
reviewed_fixtures = []
for name in paths:
    p = pathlib.PurePosixPath(name)
    assert not p.is_absolute() and '..' not in p.parts
    assert not any(part in blocked_parts for part in p.parts), name
    assert p.name not in blocked_names and not (p.name.startswith('.env.') and p.name != '.env.example'), name
    assert p.suffix not in blocked_suffixes, name
    src = ROOT / name
    assert src.is_file() and not src.is_symlink(), name
    content = src.read_bytes()
    if b'\x00' not in content:
        for kind, pattern in patterns.items():
            for match in pattern.finditer(content):
                finding = {'file': name, 'kind': kind, 'line': content[:match.start()].count(b'\n') + 1}
                if (name in {
                    'apps/kelivo/test/core/services/logging/log_redactor_test.dart',
                    'apps/kelivo/test/features/settings/logs/request_log_parser_test.dart',
                } and kind == 'model-key'
                    and match.group() == b'sk-' + b'abcdefghijklmnopqrstuvwxyz1234'
                    and hashlib.sha256(content).hexdigest() == upstream['files'][name.removeprefix('apps/kelivo/')]):
                    reviewed_fixtures.append(finding)
                else:
                    findings.append(finding)
    entries[name] = (content, 0o755 if src.stat().st_mode & 0o111 else 0o644)
    inventory.append({'file': name, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
(OUT / 'source-scan.json').write_text(json.dumps({'files': len(paths), 'findings': findings, 'reviewedUpstreamSyntheticFixtures': reviewed_fixtures}, indent=2) + '\n')
assert not findings, 'Inspect source-scan.json before distribution; no secret values are printed.'

readme = f'''# MobiCodex 整合预览：code{metadata['versionCode']} 对应源码

此归档对应 Android 预览 {metadata['versionName']} / versionCode {metadata['versionCode']}。
APK 包名 com.mobilecodex.kelivo.preview，arm64-v8a，Android 7.0/API24 起。
APK SHA256: {APK_SHA}
Kelivo 固定 v1.3.4 / 4a7da9b6f5d77caccb9f8aaf656232a93ab14708。

## 来源与许可

整合程序按随附 LICENSE（GNU AGPL v3）提供；Kelivo 原许可见 apps/kelivo/LICENSE。
原 Codex To Phone 代码的 MIT 许可及版权声明保留于 LICENSE.mobile-codex。
各本地依赖的原 LICENSE/NOTICE 保留，原生 Termux 来源见 dependencies/termux/README.md。
修改范围与各源码文件 SHA256 见 SOURCE-MANIFEST.json；来源基线见 integrations/kelivo。
此包是对应工作区快照，不能用父仓库旧提交替代。

## 构建

需要 Node.js 22+、Corepack/pnpm 10.20.0、固定 Flutter 3.47.6
（commit 5fc346839b5d0eef006ed8404392afb4dfae428d）、Android SDK36、
NDK28.2.13676358、CMake3.22.1、JDK17及JDK21+。编译/测试验证为JDK25。
运行 corepack pnpm install --frozen-lockfile；Flutter 路径由 KELIVO_FLUTTER 指定。
设置 ANDROID_HOME、MOBILE_CODEX_LINT_JAVA_HOME（JDK17）、
MOBILE_CODEX_COMPILE_JAVA_HOME / MOBILE_CODEX_TEST_JAVA_HOME（JDK21+）。
运行 node scripts/verify-kelivo.mjs --preview --repeat-tests。
详细命令见 integrations/kelivo/README.md；更新通道由 update-channel.json 固定为整合预览通道。
依赖由固定锁/工具版本下载；不包含本机SDK、缓存、个人配置、签名私钥或用户数据。
使用自己的 Android Debug 密钥签名；证书与生成的 Web build ID 不同，不承诺APK字节复现。

## 本预览范围

用户选定电脑/手机黑白图标用于 Android 图标、启动画面与内置品牌图，用户可见品牌统一为 MobiCodex。
应用 ID、签名、OAuth、数据库、备份和工具协议保持兼容；原始开源归属保留。
图标及 Flutter 原生资源通过 App 内 APK 覆盖安装更新，不能由现有 Web 热更新替换。
AI、电脑、设置统一入口；两个功能可独立使用，可主动交接单条正文至已有电脑会话。
支持设置内 APK 检查、下载、校验与系统安装确认；整合热更新未接通。
电脑执行说明始终可见，连续工具的详细命令与输出默认动态折叠；字号与工具显示跟随 Kelivo 偏好。
所有电脑 Agent 共用 Codex 的输入、工具摘要、图片、大图、附件和语音；按钮遵守原通道能力。
DeepSeek原生/PTC、Claude和OpenCode投影可见工具；后续SessionAdapter复用同一工作区。
项目内 Markdown 图片支持鉴权加载与大图；本地取图需同步构建并升级电脑网关及原宿主插件。
GitHub 版本包与自托管更新通道分别交付；本次源码提交不会自动更新在线通道或网关。
code4/5 需先手动覆盖安装本版本一次，之后可在 App 内更新。
代码保留与部分测试不代表59组全部验收。原Desktop新建、真机/最低系统及完整真实联动继续待验。
'''
notice = '''MobiCodex integration preview, modified 2026-11-07.
Kelivo: https://github.com/Chevey339/kelivo, v1.3.4, commit 4a7da9b6f5d77caccb9f8aaf656232a93ab14708.
Kelivo copyright and AGPL terms are preserved in apps/kelivo/LICENSE.
Codex To Phone contributors: MIT terms preserved in LICENSE.mobile-codex.
Integration modifications include the independent Android identity, product navigation,
appearance/state persistence, optional user-confirmed handoff, Android compatibility and tests.
See SOURCE-MANIFEST.json for changed upstream paths and all included file hashes.
Dependency licenses and native third-party notices remain in their original paths.
'''
extra = {
    'README.md': readme.encode(),
    'NOTICE': notice.encode(),
    'LICENSE': (ROOT / 'apps/kelivo/LICENSE').read_bytes(),
    'LICENSE.mobile-codex': (ROOT / 'LICENSE').read_bytes(),
}
for name, content in extra.items():
    entries[name] = (content, 0o644)
changes = {'changed': [], 'addedNonIgnored': []}
for item in inventory:
    if not item['file'].startswith('apps/kelivo/'):
        continue
    relative = item['file'].removeprefix('apps/kelivo/')
    if relative not in upstream['files']:
        changes['addedNonIgnored'].append(relative)
    elif item['sha256'] != upstream['files'][relative]:
        changes['changed'].append(relative)
manifest = {
    'versionName': metadata['versionName'], 'versionCode': metadata['versionCode'],
    'applicationId': 'com.mobilecodex.kelivo.preview', 'apkSha256': APK_SHA,
    'upstream': json.loads((ROOT / 'integrations/kelivo/upstream.json').read_text()),
    'modifiedUpstreamPaths': changes['changed'], 'addedUpstreamPaths': changes['addedNonIgnored'],
    'files': inventory,
    'omissions': 'Only ignored build/cache/local configuration; every one of the 5052 imported upstream files is included.',
}
entries['SOURCE-MANIFEST.json'] = ((json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode(), 0o644)
archive = RELEASE / (prefix + '.tar.gz')
with archive.open('wb') as raw:
    with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as tar:
            for name, (content, mode) in sorted(entries.items()):
                entry = tarfile.TarInfo(prefix + '/' + name)
                entry.size, entry.mode, entry.mtime = len(content), mode, 0
                entry.uid = entry.gid = 0
                tar.addfile(entry, io.BytesIO(content))
with tarfile.open(archive, 'r:gz') as tar:
    members = {m.name: m for m in tar.getmembers()}
    assert len(members) == len(entries)
    for name, (content, _) in entries.items():
        assert tar.extractfile(members[prefix + '/' + name]).read() == content, name
report = {'archive': archive.name, 'bytes': archive.stat().st_size,
          'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'sourceFiles': len(paths),
          'archiveEntries': len(entries), 'upstreamFilesIncluded': len(upstream['files']),
          'allArchiveBytesVerified': True, 'unreviewedSecretPatternFindings': len(findings),
          'reviewedUpstreamSyntheticFixtures': len(reviewed_fixtures), 'apkSha256': APK_SHA}
(OUT / 'source-package.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
