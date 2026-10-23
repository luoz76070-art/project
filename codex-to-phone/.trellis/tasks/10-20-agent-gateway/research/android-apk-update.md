# Android APK 更新接口核对（2026-10-22）

本地Capacitor固定7.6.9；PluginCall.getInt只接受Integer，getLong只接受Long，普通JSON size/versionCode须用getInt。插件load/handleOnPause/handleOnResume与notifyListeners沿用本机已安装源码，不新增第三方运行依赖。

Android SDK35本地官方data/api-versions.xml确认URLConnection.getContentLengthLong since=24；本项目minSdk23，新下载器使用Content-Length字符串+Long.parseLong及最终实际流计数。包版本getLongVersionCode和GET_SIGNING_CERTIFICATES只在API28+调用，旧版本读取versionCode/GET_SIGNATURES；安装权限只在API26+检查。

官方接口依据：
- https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls()
- https://developer.android.com/reference/android/provider/Settings#ACTION_MANAGE_UNKNOWN_APP_SOURCES
- https://developer.android.com/reference/androidx/core/content/FileProvider
- https://developer.android.com/reference/android/content/pm/SigningInfo#getApkContentsSigners()

本轮Web检索未返回可用正文，接口细节以已安装Android SDK/Capacitor源码和编译校验为实际证据；上述链接供维护时查阅。授权返回/系统安装行为仍须真机验证，不能以浏览器合成代替。
