import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:Kelivo/core/providers/settings_provider.dart';
import 'package:Kelivo/features/home/pages/home_page.dart';
import 'package:Kelivo/features/settings/pages/settings_page.dart';
import 'package:Kelivo/icons/lucide_adapter.dart';
import 'package:Kelivo/theme/app_semantic_colors.dart';

const productShellChannel = MethodChannel('app.product_shell');

Map<String, String> productPalette(ThemeData theme) {
  final cs = theme.colorScheme;
  final semantic =
      theme.extension<AppSemanticColors>() ??
      (theme.brightness == Brightness.dark
          ? AppSemanticColors.dark(cs)
          : AppSemanticColors.light(cs));
  String hex(Color c) =>
      '#${Color.alphaBlend(c, cs.surface).toARGB32().toRadixString(16).padLeft(8, '0').substring(2)}';
  final dark = theme.brightness == Brightness.dark;
  String surfaceTint(Color color, double alpha) =>
      hex(Color.alphaBlend(color.withValues(alpha: alpha), cs.surface));
  return {
    'background': hex(cs.surface),
    'panel': hex(semantic.surfaceCard),
    'fill': hex(semantic.surfaceFill),
    'text': hex(cs.onSurface),
    'muted': hex(cs.onSurfaceVariant),
    'primary': hex(cs.primary),
    'onPrimary': hex(cs.onPrimary),
    'primaryContainer': hex(cs.primaryContainer),
    'signal': hex(cs.tertiary),
    'error': hex(cs.error),
    // Match the AI page's default message and input surfaces, rather than
    // using the saturated primaryContainer for every remote component.
    'userBubble': surfaceTint(cs.primary, dark ? 0.15 : 0.08),
    'avatar': surfaceTint(cs.primary, 0.1),
    'composer': surfaceTint(
      dark ? cs.onSurface : cs.primary,
      dark ? 0.07 : 0.02,
    ),
    'composerOutline': surfaceTint(
      dark ? cs.onSurface : cs.outline,
      dark ? 0.1 : 0.2,
    ),
    'secondaryText': hex(cs.onSurfaceVariant),
    'messageAuthor': surfaceTint(cs.onSurface, 0.7),
    'navigationIndicator': hex(
      theme.navigationBarTheme.indicatorColor ?? cs.secondaryContainer,
    ),
    'navigationText': hex(cs.onSurface),
    'outline': hex(cs.outline),
  };
}

class KelivoMobileShell extends StatelessWidget {
  const KelivoMobileShell({
    super.key,
    required this.lightTheme,
    required this.darkTheme,
  });

  final ThemeData lightTheme;
  final ThemeData darkTheme;

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<SettingsProvider>();
    return ProductShell(
      appearance: {
        'mode': settings.themeMode.name,
        'dark': Theme.of(context).brightness == Brightness.dark,
        'display': {
          'chatFontScale': settings.chatFontScale,
          'showToolCards': settings.showToolCards,
          'showToolResultSummary': settings.showToolResultSummary,
        },
        'colors': productPalette(Theme.of(context)),
        // Flutter does not paint while the computer Activity is foreground.
        // Native configuration changes select from these exact Flutter palettes.
        'palettes': {
          'light': productPalette(lightTheme),
          'dark': productPalette(darkTheme),
        },
      },
      aiPage: const HomePage(),
      settingsPage: SettingsPage(
        isProductRoot: true,
        onAppUpdates: () async {
          try {
            await productShellChannel.invokeMethod<void>('openAppUpdates');
          } on PlatformException catch (_) {
            if (context.mounted) {
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(const SnackBar(content: Text('应用更新暂时无法打开，请重试。')));
            }
          }
        },
        onComputerSettings: () async {
          try {
            await productShellChannel.invokeMethod<void>('openRemoteSettings');
          } on PlatformException catch (_) {
            if (context.mounted) {
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(const SnackBar(content: Text('电脑设置暂时无法打开，请重试。')));
            }
          }
        },
      ),
    );
  }
}

/// The two Flutter roots remain mounted. The remote owns only its own activity.
class ProductShell extends StatefulWidget {
  const ProductShell({
    super.key,
    required this.aiPage,
    required this.settingsPage,
    required this.appearance,
  });
  final Widget aiPage;
  final Widget settingsPage;
  final Map<String, Object> appearance;

  @override
  State<ProductShell> createState() => _ProductShellState();
}

class _ProductShellState extends State<ProductShell> {
  int _index = 0;
  bool _opening = false;
  bool _hasNavigated = false;

  @override
  void initState() {
    super.initState();
    productShellChannel.setMethodCallHandler((call) async {
      if (call.method == 'showTab' && mounted) {
        _hasNavigated = true;
        Navigator.of(context).popUntil((route) => route.isFirst);
        setState(() => _index = call.arguments == 'settings' ? 2 : 0);
      }
    });
    _restore();
  }

  Future<void> _restore() async {
    try {
      final tab = await productShellChannel.invokeMethod<String>('getTab');
      if (mounted && !_hasNavigated) {
        setState(() => _index = tab == 'settings' ? 2 : 0);
      }
    } on PlatformException catch (_) {
      // The already mounted AI root remains available if the host is unavailable.
    } on MissingPluginException catch (_) {
      // Allows the original non-Android app and isolated widget tests.
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncAppearance();
  }

  @override
  void didUpdateWidget(ProductShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncAppearance();
  }

  Future<void> _syncAppearance() async {
    try {
      await productShellChannel.invokeMethod<void>(
        'setAppearance',
        widget.appearance,
      );
    } on PlatformException catch (_) {
      // Opening the remote retries with the current appearance.
    } on MissingPluginException catch (_) {
      /* Non-Android tests. */
    }
  }

  Future<void> _select(int index) async {
    if (_opening) return;
    _hasNavigated = true;
    FocusManager.instance.primaryFocus?.unfocus();
    if (index != 1) {
      setState(() => _index = index);
      try {
        await productShellChannel.invokeMethod<void>(
          'setTab',
          index == 2 ? 'settings' : 'ai',
        );
      } on PlatformException catch (_) {
        /* The mounted tab is still usable. */
      }
      return;
    }
    setState(() => _opening = true);
    try {
      await productShellChannel.invokeMethod<void>(
        'openRemote',
        widget.appearance,
      );
    } on PlatformException catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('电脑入口暂时无法打开，请重试。')));
      }
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  void dispose() {
    productShellChannel.setMethodCallHandler(null);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: _index == 0,
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop && _index != 0) _select(0);
    },
    child: Scaffold(
      body: IndexedStack(
        index: _index == 2 ? 1 : 0,
        children: [widget.aiPage, widget.settingsPage],
      ),
      bottomNavigationBar: MediaQuery.viewInsetsOf(context).bottom > 0
          ? null
          : NavigationBar(
              selectedIndex: _index,
              onDestinationSelected: _select,
              backgroundColor: Theme.of(context).colorScheme.surface,
              elevation: 0,
              height: 72,
              destinations: const [
                NavigationDestination(
                  icon: Icon(Lucide.MessageCircle),
                  label: 'AI',
                ),
                NavigationDestination(icon: Icon(Lucide.Monitor), label: '电脑'),
                NavigationDestination(icon: Icon(Lucide.Settings), label: '设置'),
              ],
            ),
    ),
  );
}
