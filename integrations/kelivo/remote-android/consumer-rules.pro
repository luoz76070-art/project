-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
# Capacitor reads plugin metadata reflectively (PluginHandle.pluginAnnotation,
# @Permission aliases, @PluginMethod). R8 full mode in the Kelivo release build
# removed that field and compiled every permission check to `throw null`, so
# "开始录音" crashed the app in 0.1.9. Keep the bridge runtime unoptimised;
# scripts/kelivo-apk-guard.mjs checks the built APK for it.
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,AnnotationDefault
-keep class com.getcapacitor.** { *; }
