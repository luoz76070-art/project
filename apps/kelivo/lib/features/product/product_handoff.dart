import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'product_shell.dart' show productShellChannel;

/// Prepares only the explicitly selected message. Confirmation belongs to the computer card.
Future<void> prepareProductHandoff(BuildContext context, String text) async {
  try {
    await productShellChannel.invokeMethod<void>('prepareHandoff', {
      'text': text,
    });
  } on PlatformException catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message ?? '交接暂时无法准备，请重试。')));
    }
  }
}
