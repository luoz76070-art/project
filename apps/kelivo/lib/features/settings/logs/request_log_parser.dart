import 'dart:convert';

import '../../../core/services/logging/log_payload_elider.dart';

class RequestLogEntry {
  RequestLogEntry({
    required this.id,
    required this.sequence,
    this.startedAt,
    this.lastEventAt,
    this.method,
    this.rawUrl,
    this.requestHeaders,
    this.requestBody,
    this.statusCode,
    this.responseHeaders,
    this.responseBody,
    this.requestBodyTruncated = 0,
    this.responseBodyTruncated = 0,
    List<LogPayloadRef>? attachments,
    List<String>? errors,
    List<String>? warnings,
  }) : attachments = attachments ?? <LogPayloadRef>[],
       errors = errors ?? <String>[],
       warnings = warnings ?? <String>[];

  final int id;
  // Monotonic sequence to disambiguate duplicate ids across app restarts.
  final int sequence;

  DateTime? startedAt;
  DateTime? lastEventAt;

  String? method;
  String? rawUrl;

  Map<String, dynamic>? requestHeaders;
  String? requestBody;

  int? statusCode;
  Map<String, dynamic>? responseHeaders;
  String? responseBody;

  /// Characters dropped from each body by the parser's size cap.
  int requestBodyTruncated;
  int responseBodyTruncated;

  /// Inline base64 images/files that were replaced by placeholders.
  final List<LogPayloadRef> attachments;

  final List<String> errors;
  final List<String> warnings;

  // Parsed lazily rather than stored: keeps the entry cheap to send across
  // an isolate boundary, and most entries never need the parsed form.
  Uri? _uri;
  bool _uriParsed = false;

  Uri? get uri {
    if (_uriParsed) return _uri;
    _uriParsed = true;
    final url = rawUrl;
    _uri = (url == null || url.isEmpty) ? null : Uri.tryParse(url);
    return _uri;
  }

  bool get hasError =>
      errors.isNotEmpty || (statusCode != null && statusCode! >= 400);
  bool get hasWarning =>
      warnings.isNotEmpty ||
      (statusCode != null && statusCode! >= 300 && statusCode! < 400);

  Duration? get duration {
    final s = startedAt;
    final e = lastEventAt;
    if (s == null || e == null) return null;
    return e.difference(s);
  }
}

class RequestLogParser {
  static final RegExp _tsRe = RegExp(
    r'^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s+(.*)$',
  );

  static final RegExp _reqStartRe = RegExp(
    r'^\[REQ (\d+)\]\s+([A-Z]+)\s+(.*)$',
    dotAll: true,
  );
  static final RegExp _reqHeadersRe = RegExp(
    r'^\[REQ (\d+)\]\s+headers=(.*)$',
    dotAll: true,
  );
  static final RegExp _reqBodyRe = RegExp(
    r'^\[REQ (\d+)\]\s+body=(.*)$',
    dotAll: true,
  );

  static final RegExp _resStatusRe = RegExp(
    r'^\[RES (\d+)\]\s+status=(\d+)\s*$',
    dotAll: true,
  );
  static final RegExp _resHeadersRe = RegExp(
    r'^\[RES (\d+)\]\s+headers=(.*)$',
    dotAll: true,
  );
  static final RegExp _resBodyRe = RegExp(
    r'^\[RES (\d+)\]\s+body=(.*)$',
    dotAll: true,
  );
  static final RegExp _resChunkRe = RegExp(
    r'^\[RES (\d+)\]\s+chunk=(.*)$',
    dotAll: true,
  );
  static final RegExp _resDoneRe = RegExp(
    r'^\[RES (\d+)\]\s+done\s*$',
    dotAll: true,
  );
  static final RegExp _resErrRe = RegExp(
    r'^\[RES (\d+)\]\s+error=(.*)$',
    dotAll: true,
  );
  static final RegExp _resDioErrRe = RegExp(
    r'^\[RES (\d+)\]\s+dio_error=(.*)$',
    dotAll: true,
  );

  /// Keeps a single body from blowing up the viewer. Matches
  /// `LogRedactor._maxJsonBodyChars`.
  static const int defaultMaxBodyChars = 256 * 1024;

  /// [elide] replaces inline base64 payloads with placeholders — needed for
  /// files written before write-side elision existed. [maxBodyChars] caps
  /// whatever survives; the full text stays on disk and is reachable by
  /// exporting the file.
  static List<RequestLogEntry> parse(
    String content, {
    bool elide = true,
    int maxBodyChars = defaultMaxBodyChars,
  }) {
    final records = _toRecords(content);

    final List<RequestLogEntry> entries = <RequestLogEntry>[];
    final Map<int, int> currentIndexById = <int, int>{};
    final Map<int, StringBuffer> chunkBuffers = <int, StringBuffer>{};
    int seq = 0;

    /// Elides, caps, and records what the elision found. Attachments are
    /// reported either way — [elide] only decides whether the body text
    /// itself is rewritten.
    ({String text, int truncated}) prepareBody(
      String body,
      RequestLogEntry entry,
    ) {
      final result = LogPayloadElider.process(body, rewrite: elide);
      entry.attachments.addAll(result.refs);
      var text = result.text;
      if (maxBodyChars > 0 && text.length > maxBodyChars) {
        return (
          text: text.substring(0, maxBodyChars),
          truncated: text.length - maxBodyChars,
        );
      }
      return (text: text, truncated: 0);
    }

    RequestLogEntry ensureEntry(int id) {
      final idx = currentIndexById[id];
      if (idx != null) return entries[idx];
      final e = RequestLogEntry(id: id, sequence: ++seq);
      entries.add(e);
      currentIndexById[id] = entries.length - 1;
      return e;
    }

    void touch(RequestLogEntry e, DateTime ts) {
      e.lastEventAt = ts;
      e.startedAt ??= ts;
    }

    for (final record in records) {
      final ts = record.ts;
      final msg = record.message;

      final mStart = _reqStartRe.firstMatch(msg);
      if (mStart != null) {
        final id = int.tryParse(mStart.group(1) ?? '');
        if (id == null) continue;

        final e = RequestLogEntry(id: id, sequence: ++seq);
        e.startedAt = ts;
        e.lastEventAt = ts;
        e.method = (mStart.group(2) ?? '').trim();
        e.rawUrl = (mStart.group(3) ?? '').trim();
        entries.add(e);
        currentIndexById[id] = entries.length - 1;
        continue;
      }

      final mReqHeaders = _reqHeadersRe.firstMatch(msg);
      if (mReqHeaders != null) {
        final id = int.tryParse(mReqHeaders.group(1) ?? '');
        if (id == null) continue;
        final e = ensureEntry(id);
        touch(e, ts);
        final jsonText = (mReqHeaders.group(2) ?? '').trim();
        e.requestHeaders = _decodeJsonMap(jsonText);
        if (e.requestHeaders == null && jsonText.isNotEmpty) {
          e.warnings.add('Failed to parse request headers JSON');
        }
        continue;
      }

      final mReqBody = _reqBodyRe.firstMatch(msg);
      if (mReqBody != null) {
        final id = int.tryParse(mReqBody.group(1) ?? '');
        if (id == null) continue;
        final e = ensureEntry(id);
        touch(e, ts);
        final prepared = prepareBody(
          unescape((mReqBody.group(2) ?? '').trim()),
          e,
        );
        e.requestBody = prepared.text;
        e.requestBodyTruncated = prepared.truncated;
        continue;
      }

      final mStatus = _resStatusRe.firstMatch(msg);
      if (mStatus != null) {
        final id = int.tryParse(mStatus.group(1) ?? '');
        final code = int.tryParse(mStatus.group(2) ?? '');
        if (id == null) continue;
        final e = ensureEntry(id);
        touch(e, ts);
        e.statusCode = code;
        continue;
      }

      final mResHeaders = _resHeadersRe.firstMatch(msg);
      if (mResHeaders != null) {
        final id = int.tryParse(mResHeaders.group(1) ?? '');
        if (id == null) continue;
        final e = ensureEntry(id);
        touch(e, ts);
        final jsonText = (mResHeaders.group(2) ?? '').trim();
        e.responseHeaders = _decodeJsonMap(jsonText);
        if (e.responseHeaders == null && jsonText.isNotEmpty) {
          e.warnings.add('Failed to parse response headers JSON');
        }
        continue;
      }

      final mBody = _resBodyRe.firstMatch(msg);
      if (mBody != null) {
        final id = int.tryParse(mBody.group(1) ?? '');
        if (id == null) continue;
        final e = ensureEntry(id);
        touch(e, ts);
        final prepared = prepareBody(
          unescape((mBody.group(2) ?? '').trim()),
          e,
        );
        final body = prepared.text;
        e.responseBody = body;
        e.responseBodyTruncated = prepared.truncated;
        if (body.isNotEmpty &&
            (e.statusCode == null || e.statusCode! >= 400) &&
            (e.errors.isEmpty || e.errors.last != body)) {
          e.errors.add(body);
        }
        continue;
      }

      final mChunk = _resChunkRe.firstMatch(msg);
      if (mChunk != null) {
        final id = int.tryParse(mChunk.group(1) ?? '');
        if (id == null) continue;
        final e = ensureEntry(id);
        touch(e, ts);
        // Buffered rather than `prev + chunk`: string concatenation per chunk
        // is O(n^2) over a long streamed response.
        final buf = chunkBuffers.putIfAbsent(
          e.sequence,
          () => StringBuffer(e.responseBody ?? ''),
        );
        buf.write(unescape(mChunk.group(2) ?? ''));
        continue;
      }

      final mDone = _resDoneRe.firstMatch(msg);
      if (mDone != null) {
        final id = int.tryParse(mDone.group(1) ?? '');
        if (id == null) continue;
        final e = ensureEntry(id);
        touch(e, ts);
        continue;
      }

      final mErr = _resErrRe.firstMatch(msg);
      if (mErr != null) {
        final id = int.tryParse(mErr.group(1) ?? '');
        if (id == null) continue;
        final e = ensureEntry(id);
        touch(e, ts);
        final err = unescape((mErr.group(2) ?? '').trim());
        if (err.isNotEmpty) e.errors.add(err);
        continue;
      }

      final mDioErr = _resDioErrRe.firstMatch(msg);
      if (mDioErr != null) {
        final id = int.tryParse(mDioErr.group(1) ?? '');
        if (id == null) continue;
        final e = ensureEntry(id);
        touch(e, ts);
        final err = unescape((mDioErr.group(2) ?? '').trim());
        if (err.isNotEmpty) e.errors.add(err);
        continue;
      }
    }

    // Elide the reassembled stream once, so payloads split across chunk
    // boundaries are caught too.
    if (chunkBuffers.isNotEmpty) {
      for (final e in entries) {
        final buf = chunkBuffers[e.sequence];
        if (buf == null) continue;
        final prepared = prepareBody(buf.toString(), e);
        e.responseBody = prepared.text;
        e.responseBodyTruncated = prepared.truncated;
      }
    }

    // Newest first (when possible)
    entries.sort((a, b) {
      final at = a.startedAt ?? a.lastEventAt;
      final bt = b.startedAt ?? b.lastEventAt;
      if (at == null && bt == null) return b.sequence.compareTo(a.sequence);
      if (at == null) return 1;
      if (bt == null) return -1;
      final c = bt.compareTo(at);
      if (c != 0) return c;
      return b.sequence.compareTo(a.sequence);
    });

    return entries;
  }

  static List<_LogRecord> _toRecords(String content) {
    final List<_LogRecord> out = <_LogRecord>[];
    final lines = content.split('\n');
    for (final rawLine in lines) {
      final line = rawLine.trimRight();
      if (line.isEmpty && out.isEmpty) continue;

      final m = _tsRe.firstMatch(line);
      if (m != null) {
        final ts = _parseTs(m);
        final msg = m.group(8) ?? '';
        out.add(_LogRecord(ts: ts, message: msg));
        continue;
      }

      if (out.isEmpty) continue;
      out.last.message += '\n$line';
    }
    return out;
  }

  static DateTime _parseTs(RegExpMatch m) {
    int g(int i) => int.tryParse(m.group(i) ?? '') ?? 0;
    return DateTime(g(1), g(2), g(3), g(4), g(5), g(6), g(7));
  }

  static Map<String, dynamic>? _decodeJsonMap(String text) {
    try {
      final v = jsonDecode(text);
      if (v is Map<String, dynamic>) return v;
      if (v is Map) {
        return v.map((k, val) => MapEntry(k.toString(), val));
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  static final RegExp _escapeRe = RegExp(r'\\[nrt\\]');

  /// Reverses `RequestLogger.escape()` (handles `\\`, `\\r`, `\\n`, `\\t`).
  ///
  /// Single native pass. A char-by-char loop allocates a new one-character
  /// String per index, which is seconds of work on a multi-MB body.
  /// Unknown escapes (`\x`) fall outside the pattern and pass through as-is,
  /// matching the previous behaviour.
  static String unescape(String input) {
    if (input.isEmpty) return input;
    return input.replaceAllMapped(_escapeRe, (m) {
      switch (m[0]![1]) {
        case 'n':
          return '\n';
        case 'r':
          return '\r';
        case 't':
          return '\t';
        default:
          return '\\';
      }
    });
  }
}

class _LogRecord {
  _LogRecord({required this.ts, required this.message});
  final DateTime ts;
  String message;
}
