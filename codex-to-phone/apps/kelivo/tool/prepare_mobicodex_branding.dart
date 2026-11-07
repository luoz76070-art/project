import 'dart:io';

import 'package:image/image.dart' as img;

// Run from apps/kelivo after replacing assets/app_icon.png with the chosen art.
// Launcher and splash generators consume these assets without altering iOS.
void main(List<String> arguments) {
  if (arguments.length == 1 && arguments.single == '--finalize-android') {
    // The remote Android library also has orientation-specific splash resources.
    // Use the host-only name so those variants cannot replace this launch art.
    for (final qualifier in [
      'drawable',
      'drawable-v21',
      'drawable-night',
      'drawable-night-v21',
    ]) {
      final file = File(
        'android/app/src/main/res/$qualifier/launch_background.xml',
      );
      file.writeAsStringSync(
        file.readAsStringSync().replaceAll(
          '@drawable/splash',
          '@drawable/android12splash',
        ),
      );
    }
    return;
  }
  if (arguments.isNotEmpty) {
    throw ArgumentError('Use --finalize-android or no arguments.');
  }
  final source = img.decodePng(File('assets/app_icon.png').readAsBytesSync())!;
  if (source.width != source.height) {
    throw StateError('The MobiCodex source icon must be square.');
  }
  final foreground = img.Image(
    width: source.width,
    height: source.height,
    numChannels: 4,
  );
  final dark = img.Image.from(foreground);
  for (final pixel in source) {
    // The selected monochrome art uses ink #141414 on warm white #f8f7f1.
    final alpha = ((248 - pixel.r) * 255 / (248 - 20)).round().clamp(0, 255);
    foreground.setPixelRgba(pixel.x, pixel.y, 20, 20, 20, alpha);
    dark.setPixelRgba(pixel.x, pixel.y, 248, 247, 241, alpha);
  }
  void png(String path, img.Image image, int size) {
    File(path).writeAsBytesSync(
      img.encodePng(
        img.copyResize(
          image,
          width: size,
          interpolation: img.Interpolation.cubic,
        ),
      ),
    );
  }

  png('assets/app_icon_foreground.png', foreground, 1024);
  png('assets/start.png', foreground, 512);
  png('assets/start_dark.png', dark, 512);
  png('assets/icons/kelivo.png', source, 512);
  png('assets/icon_mac.png', foreground, 512);
  File('assets/app_icon.ico').writeAsBytesSync(
    img.IcoEncoder().encodeImages([
      for (final size in [16, 32, 48, 64, 128, 256])
        img.copyResize(
          source,
          width: size,
          interpolation: img.Interpolation.cubic,
        ),
    ]),
  );
}
