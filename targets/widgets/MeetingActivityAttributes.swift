import ActivityKit
import Foundation

/// Live Activity schema for a running client meeting.
///
/// IMPORTANT: An identical copy of this struct is compiled into the app via
/// modules/dayflow-live-activity/ios/MeetingActivityAttributes.swift.
/// ActivityKit matches activities across processes by the attributes type
/// name and Codable shape — keep both files byte-for-byte identical.
struct MeetingActivityAttributes: ActivityAttributes {
  /// Client display name (or task title when no client is set).
  let clientName: String
  /// Meeting kind label, e.g. "In-call" / "Out-call" / "Public spot".
  let kindLabel: String
  /// Formatted amount for the session, e.g. "$150".
  let rateLabel: String
  /// SF Symbol name for the meeting kind.
  let symbolName: String

  struct ContentState: Codable, Hashable {
    /// Countdown target. Render with Text(timerInterval:) so the system
    /// ticks the timer without needing activity updates.
    var endDate: Date
    /// When the session started (for the elapsed side of the interval).
    var startDate: Date
    /// True once the planned end has passed and the user is in overtime.
    var overtime: Bool
  }
}
