import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'context_log_models.dart';

/// Resume point for backward JSONL reads.
class ContextLogTailCursor {
  const ContextLogTailCursor({this.position, this.pending = const <int>[]});

  /// Next unread byte offset from the start of the file.
  /// `null` means "start from the current end of the file".
  final int? position;
  final List<int> pending;

  bool get isExhausted => position != null && position! <= 0 && pending.isEmpty;
}

class ContextLogTailPage {
  const ContextLogTailPage({required this.snapshots, required this.cursor});

  final List<ContextLogSnapshot> snapshots;
  final ContextLogTailCursor cursor;

  bool get hasMore => !cursor.isExhausted;
}

/// Reads context-log JSONL from the tail without loading the whole file.
class ContextLogTailReader {
  static const int defaultPageSize = 50;
  static const int defaultChunkSize = 128 * 1024;

  static Future<ContextLogTailPage> readPage({
    required File file,
    ContextLogTailCursor cursor = const ContextLogTailCursor(),
    int limit = defaultPageSize,
    int chunkSize = defaultChunkSize,
  }) async {
    if (limit <= 0) {
      return ContextLogTailPage(snapshots: const [], cursor: cursor);
    }
    if (!await file.exists()) {
      return const ContextLogTailPage(
        snapshots: [],
        cursor: ContextLogTailCursor(position: 0),
      );
    }

    final raf = await file.open();
    try {
      final length = await raf.length();
      var pos = (cursor.position ?? length).clamp(0, length);
      var buffer = Uint8List.fromList(cursor.pending);
      final snapshots = <ContextLogSnapshot>[];

      while (snapshots.length < limit) {
        final extracted = _takeCompleteLinesFromEnd(
          buffer,
          limit - snapshots.length,
        );
        snapshots.addAll(extracted.lines);
        buffer = extracted.remaining;

        if (snapshots.length >= limit) break;

        if (pos <= 0) {
          final first = _parseLine(buffer);
          if (first != null) snapshots.add(first);
          buffer = Uint8List(0);
          break;
        }

        final readSize = pos < chunkSize ? pos : chunkSize;
        pos -= readSize;
        await raf.setPosition(pos);
        final chunk = await raf.read(readSize);
        if (chunk.isEmpty) {
          pos = 0;
          continue;
        }
        buffer = _concat(chunk, buffer);
      }

      return ContextLogTailPage(
        snapshots: snapshots,
        cursor: ContextLogTailCursor(position: pos, pending: buffer),
      );
    } finally {
      await raf.close();
    }
  }

  static ({List<ContextLogSnapshot> lines, Uint8List remaining})
  _takeCompleteLinesFromEnd(Uint8List buffer, int maxLines) {
    if (maxLines <= 0 || buffer.isEmpty) {
      return (lines: const <ContextLogSnapshot>[], remaining: buffer);
    }

    final lines = <ContextLogSnapshot>[];
    var end = buffer.length;

    while (lines.length < maxLines) {
      var nl = -1;
      // Scan the whole leftover, including newlines carried in `pending`.
      for (var i = end - 1; i >= 0; i--) {
        if (buffer[i] == 10) {
          nl = i;
          break;
        }
      }
      if (nl < 0) break;

      final parsed = _parseLine(buffer.sublist(nl + 1, end));
      if (parsed != null) lines.add(parsed);
      end = nl;
    }

    return (
      lines: lines,
      remaining: end == buffer.length ? buffer : buffer.sublist(0, end),
    );
  }

  static ContextLogSnapshot? _parseLine(List<int> lineBytes) {
    if (lineBytes.isEmpty) return null;
    try {
      final line = utf8.decode(lineBytes, allowMalformed: true).trim();
      if (line.isEmpty) return null;
      final decoded = jsonDecode(line);
      if (decoded is! Map) return null;
      return ContextLogSnapshot.fromJson(Map<String, dynamic>.from(decoded));
    } catch (_) {
      return null;
    }
  }

  static Uint8List _concat(Uint8List head, Uint8List tail) {
    if (head.isEmpty) return tail;
    if (tail.isEmpty) return head;
    final out = Uint8List(head.length + tail.length);
    out.setRange(0, head.length, head);
    out.setRange(head.length, out.length, tail);
    return out;
  }
}
