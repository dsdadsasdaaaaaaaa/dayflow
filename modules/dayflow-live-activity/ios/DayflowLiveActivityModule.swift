import ActivityKit
import ExpoModulesCore

/// Holds the single tracked Live Activity. Wrapped in an availability-annotated
/// class so the stored `Activity<...>` type compiles against the iOS 16.2 API
/// boundary while the module itself targets an older minimum.
@available(iOS 16.2, *)
private final class MeetingActivityHolder {
  fileprivate static var current: Activity<MeetingActivityAttributes>?
}

public final class DayflowLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayflowLiveActivity")

    Function("isSupported") { () -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    AsyncFunction("startActivity") {
      (clientName: String, kindLabel: String, rateLabel: String,
       symbolName: String, startedAtMs: Double, endAtMs: Double) async -> Void in
      guard #available(iOS 16.2, *),
            ActivityAuthorizationInfo().areActivitiesEnabled else { return }

      // Only one meeting session runs at a time — end any prior activity.
      if let existing = MeetingActivityHolder.current {
        await existing.end(existing.content, dismissalPolicy: .immediate)
        MeetingActivityHolder.current = nil
      }

      let attributes = MeetingActivityAttributes(
        clientName: clientName,
        kindLabel: kindLabel,
        rateLabel: rateLabel,
        symbolName: symbolName
      )
      let state = MeetingActivityAttributes.ContentState(
        endDate: Date(timeIntervalSince1970: endAtMs / 1000),
        startDate: Date(timeIntervalSince1970: startedAtMs / 1000),
        overtime: false
      )
      do {
        MeetingActivityHolder.current = try Activity<MeetingActivityAttributes>.request(
          attributes: attributes,
          content: ActivityContent(state: state, staleDate: nil),
          pushType: nil
        )
      } catch {
        // Live Activities can fail to start (disabled, rate-limited, etc.).
        // The in-app timer is the source of truth, so silently ignore.
      }
    }

    AsyncFunction("updateActivity") { (endAtMs: Double, overtime: Bool) async -> Void in
      guard #available(iOS 16.2, *),
            let activity = MeetingActivityHolder.current else { return }
      let state = MeetingActivityAttributes.ContentState(
        endDate: Date(timeIntervalSince1970: endAtMs / 1000),
        startDate: activity.content.state.startDate,
        overtime: overtime
      )
      await activity.update(ActivityContent(state: state, staleDate: nil))
    }

    AsyncFunction("endActivity") { () async -> Void in
      guard #available(iOS 16.2, *),
            let activity = MeetingActivityHolder.current else { return }
      MeetingActivityHolder.current = nil
      await activity.end(activity.content, dismissalPolicy: .immediate)
    }
  }
}
