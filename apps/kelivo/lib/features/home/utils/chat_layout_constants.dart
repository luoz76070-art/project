/// Shared layout constants for the Home chat UI (desktop/tablet).
class ChatLayoutConstants {
  /// Max readable width for the chat message list area.
  static const double maxContentWidth = 860.0;

  /// Max width for the chat input bar area.
  static const double maxInputWidth = 860.0;

  /// How long a deleted message fades out and collapses before its slot is
  /// actually removed from the timeline. The controller waits this long
  /// between flagging the slot and performing the deletion, so the widget
  /// animation and the data mutation stay in lockstep.
  static const Duration slotRemovalAnimationDuration = Duration(
    milliseconds: 240,
  );
}
