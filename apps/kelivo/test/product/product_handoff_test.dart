import 'package:Kelivo/core/models/chat_message.dart';
import 'package:Kelivo/core/providers/settings_provider.dart';
import 'package:Kelivo/features/chat/widgets/message_more_sheet.dart';
import 'package:Kelivo/features/product/product_handoff.dart';
import 'package:Kelivo/features/product/product_shell.dart';
import 'package:Kelivo/l10n/app_localizations.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import '../support/business_test_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final calls = <MethodCall>[];
  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(productShellChannel, (call) async {
          calls.add(call);
          return null;
        });
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(productShellChannel, null);
  });
  void testProduct(
    String name,
    Future<void> Function(WidgetTester) body, {
    TargetPlatform platform = TargetPlatform.android,
  }) => testWidgets(name, body, variant: TargetPlatformVariant({platform}));
  Widget app(Widget child) => ChangeNotifierProvider(
    create: (_) => SettingsProvider(createBusinessTestPreferences()),
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: child),
    ),
  );
  Widget menu(ChatMessage message) => Builder(
    builder: (context) => TextButton(
      onPressed: () async {
        final result = await showMessageMoreSheet(
          context,
          message,
          canDeleteAllVersions: false,
          canCreateBranch: false,
        );
        if (result == MessageMoreAction.handoff && context.mounted) {
          await prepareProductHandoff(context, message.content);
        }
      },
      child: const Text('打开更多'),
    ),
  );
  testProduct(
    'selected message prepares one task card without sending history',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        app(
          menu(
            ChatMessage(
              role: 'assistant',
              content: '只交给电脑这一条',
              conversationId: 'fixture',
            ),
          ),
        ),
      );
      await tester.tap(find.text('打开更多'));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
      await tester.tap(find.text('交给电脑'));
      await tester.pumpAndSettle();
      expect(calls, hasLength(1));
      expect(calls.single.method, 'prepareHandoff');
      expect(calls.single.arguments, {'text': '只交给电脑这一条'});
    },
  );
  testProduct('empty or streaming messages cannot prepare a handoff', (
    tester,
  ) async {
    for (final message in [
      ChatMessage(role: 'assistant', content: ' ', conversationId: 'fixture'),
      ChatMessage(
        role: 'assistant',
        content: '未完成',
        conversationId: 'fixture',
        isStreaming: true,
      ),
    ]) {
      await tester.pumpWidget(app(menu(message)));
      await tester.tap(find.text('打开更多'));
      await tester.pumpAndSettle();
      expect(find.text('交给电脑'), findsNothing);
      Navigator.of(tester.element(find.text('打开更多'))).pop();
      await tester.pumpAndSettle();
    }
    expect(calls, isEmpty);
  });
  testProduct('iOS message menu does not expose the Android bridge', (
    tester,
  ) async {
    await tester.pumpWidget(
      app(
        menu(
          ChatMessage(
            role: 'assistant',
            content: '合成正文',
            conversationId: 'fixture',
          ),
        ),
      ),
    );
    await tester.tap(find.text('打开更多'));
    await tester.pumpAndSettle();
    expect(find.text('交给电脑'), findsNothing);
    expect(calls, isEmpty);
  }, platform: TargetPlatform.iOS);
  testProduct('native save failure is shown without a second attempt', (
    tester,
  ) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(productShellChannel, (call) async {
          calls.add(call);
          throw PlatformException(code: 'fixture', message: '交接状态未能保存');
        });
    await tester.pumpWidget(
      app(
        Builder(
          builder: (context) => TextButton(
            onPressed: () => prepareProductHandoff(context, '合成正文'),
            child: const Text('准备'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('准备'));
    await tester.pumpAndSettle();
    expect(find.text('交接状态未能保存'), findsOneWidget);
    expect(calls, hasLength(1));
  });
}
