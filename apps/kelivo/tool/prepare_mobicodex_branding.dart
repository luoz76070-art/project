import 'dart:io';

// Keep the existing entry point; A1 vectors are now the source of truth.
// The native macOS renderer needs Python 3 and Swift, but no Flutter packages.
void main(List<String> arguments) {
  final script = File.fromUri(
    Platform.script.resolve('prepare_mobicodex_branding.py'),
  );
  final result = Process.runSync('python3', [script.path, ...arguments]);
  stdout.write(result.stdout);
  stderr.write(result.stderr);
  exitCode = result.exitCode;
}
