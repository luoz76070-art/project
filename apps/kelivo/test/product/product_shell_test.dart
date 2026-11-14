import 'dart:async';
import 'package:Kelivo/features/product/product_shell.dart';
import 'package:Kelivo/features/product/product_identity.dart';
import 'package:Kelivo/core/providers/update_provider.dart';
import 'package:Kelivo/utils/kelivo_file_uri.dart';
import 'package:Kelivo/theme/app_semantic_colors.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('host palettes preserve resolved Flutter schemes and semantic surfaces', () {
    for (final brightness in Brightness.values) {
      final scheme = ColorScheme.fromSeed(
        seedColor: const Color(0xff891234),
        brightness: brightness,
      );
      final semantic = AppSemanticColors.light(scheme).copyWith(
        surfaceCard: const Color(0xff123456),
        surfaceFill: const Color(0xffabcdef),
      );
      final palette = productPalette(
        ThemeData(colorScheme: scheme, extensions: [semantic]),
      );
      expect(palette['panel'], '#123456');
      expect(palette['fill'], '#abcdef');
      expect(
        palette['background'],
        '#${scheme.surface.toARGB32().toRadixString(16).substring(2)}',
      );
      expect(
        palette['primary'],
        '#${scheme.primary.toARGB32().toRadixString(16).substring(2)}',
      );
      String tinted(Color color, double alpha) =>
          '#${Color.alphaBlend(color.withValues(alpha: alpha), scheme.surface).toARGB32().toRadixString(16).substring(2)}';
      final dark = brightness == Brightness.dark;
      expect(palette['userBubble'], tinted(scheme.primary, dark ? 0.15 : 0.08));
      expect(palette['avatar'], tinted(scheme.primary, 0.1));
      expect(
        palette['composer'],
        tinted(dark ? scheme.onSurface : scheme.primary, dark ? 0.07 : 0.02),
      );
      expect(
        palette['composerOutline'],
        tinted(dark ? scheme.onSurface : scheme.outline, dark ? 0.1 : 0.2),
      );
      expect(palette['secondaryText'], tinted(scheme.onSurfaceVariant, 1));
      expect(palette['signal'], tinted(scheme.tertiary, 1));
      expect(palette['error'], tinted(scheme.error, 1));
      expect(
        palette['navigationIndicator'],
        '#${scheme.secondaryContainer.toARGB32().toRadixString(16).substring(2)}',
      );
      expect(palette['userBubble'], isNot(palette['primaryContainer']));
      expect(
        palette['outline'],
        '#${Color.alphaBlend(scheme.outline, scheme.surface).toARGB32().toRadixString(16).substring(2)}',
      );
    }
  });
  TestWidgetsFlutterBinding.ensureInitialized();
  final calls = <MethodCall>[];
  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(productShellChannel, (call) async {
          calls.add(call);
          return call.method == 'getTab' ? 'ai' : null;
        });
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(productShellChannel, null);
  });
  Widget shell() => const MaterialApp(
    home: ProductShell(
      appearance: {'mode': 'dark'},
      aiPage: Scaffold(body: TextField(key: Key('ai-draft'))),
      settingsPage: Scaffold(body: Text('global-settings')),
    ),
  );
  testWidgets(
    'AI and settings keep separate mounted roots; remote opens without a submission',
    (tester) async {
      await tester.pumpWidget(shell());
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('ai-draft')), '独立AI草稿');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.tap(find.text('设置'));
      await tester.pumpAndSettle();
      expect(find.text('global-settings'), findsOneWidget);
      await tester.tap(find.text('电脑'));
      await tester.pumpAndSettle();
      expect(calls.where((c) => c.method == 'openRemote'), hasLength(1));
      expect(calls.last.arguments, {'mode': 'dark'});
      await tester.tap(find.text('AI'));
      await tester.pumpAndSettle();
      expect(find.text('独立AI草稿'), findsOneWidget);
      expect(
        calls.every(
          (c) => [
            'getTab',
            'setTab',
            'setAppearance',
            'openRemote',
          ].contains(c.method),
        ),
        isTrue,
      );
    },
  );
  testWidgets('rapid remote taps start only one activity', (tester) async {
    final opening = Completer<void>();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(productShellChannel, (call) async {
          calls.add(call);
          if (call.method == 'openRemote') await opening.future;
          return call.method == 'getTab' ? 'ai' : null;
        });
    await tester.pumpWidget(shell());
    await tester.pumpAndSettle();
    await tester.tap(find.text('电脑'));
    await tester.pump();
    await tester.tap(find.text('电脑'));
    await tester.pump();
    expect(calls.where((c) => c.method == 'openRemote'), hasLength(1));
    opening.complete();
    await tester.pumpAndSettle();
  });
  testWidgets('a late startup restore cannot undo an explicit tab selection', (
    tester,
  ) async {
    final initial = Completer<String>();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(productShellChannel, (call) async {
          if (call.method == 'getTab') return initial.future;
          return null;
        });
    await tester.pumpWidget(shell());
    await tester.pumpAndSettle();
    await tester.tap(find.text('设置'));
    await tester.pumpAndSettle();
    initial.complete('ai');
    await tester.pumpAndSettle();
    expect(find.text('global-settings'), findsOneWidget);
  });
  test('Android preview never queries the upstream updater', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    expect(ProductIdentity.isAndroidHost, isTrue);
    final updates = UpdateProvider();
    await updates.checkForUpdates();
    expect(updates.available, isNull);
    expect(updates.checking, isFalse);
    expect(updates.error, contains('应用更新'));
    updates.dispose();
  });
  test(
    'preview backup paths round trip while neighboring packages stay excluded',
    () {
      const root = '/data/user/0/com.mobilecodex.kelivo.preview/app_flutter';
      final uri = KelivoFileUri.tryEncodeLegacyAbsolutePath(
        '$root/upload/合成附件.png',
        allowGenericFallback: false,
      );
      expect(uri, isNotNull);
      expect(
        KelivoFileUri.resolveToAbsolute(uri!, root: root),
        '$root/upload/合成附件.png',
      );
      expect(
        KelivoFileUri.tryEncodeLegacyAbsolutePath(
          '/data/user/0/com.mobilecodex.kelivo.preview.other/files/upload/a.png',
          allowGenericFallback: false,
        ),
        isNull,
      );
    },
  );
}
