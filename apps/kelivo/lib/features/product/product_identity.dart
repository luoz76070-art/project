import 'package:flutter/foundation.dart';

abstract final class ProductIdentity {
  static const applicationId = 'com.mobilecodex.kelivo.preview';
  static const androidOAuthScheme = 'mobilecodex.kelivo.preview';
  static bool get isAndroidHost =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
}
