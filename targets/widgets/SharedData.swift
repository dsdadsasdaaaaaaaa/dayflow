import SwiftUI
import WidgetKit

// MARK: - Color helper

extension Color {
  /// Creates a Color from a hex string like "#F97362" or "F97362" (6 or 8 digits).
  /// Falls back to gray for malformed input — never crashes.
  init(hex: String) {
    var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("#") { value.removeFirst() }
    var rgb: UInt64 = 0
    guard Scanner(string: value).scanHexInt64(&rgb) else {
      self = Color.gray
      return
    }
    switch value.count {
    case 8:
      self.init(
        .sRGB,
        red: Double((rgb >> 24) & 0xFF) / 255.0,
        green: Double((rgb >> 16) & 0xFF) / 255.0,
        blue: Double((rgb >> 8) & 0xFF) / 255.0,
        opacity: Double(rgb & 0xFF) / 255.0
      )
    case 6:
      self.init(
        .sRGB,
        red: Double((rgb >> 16) & 0xFF) / 255.0,
        green: Double((rgb >> 8) & 0xFF) / 255.0,
        blue: Double(rgb & 0xFF) / 255.0,
        opacity: 1.0
      )
    default:
      self = Color.gray
    }
  }
}

// MARK: - Brand palette

enum DayFlowStyle {
  static let navy = Color(hex: "#0B0F1A")
  static let indigo = Color(hex: "#6366F1")
  static let violet = Color(hex: "#8B5CF6")
  static let cyan = Color(hex: "#22D3EE")
  static let emerald = Color(hex: "#10B981")
  static let teal = Color(hex: "#2DD4BF")
  static let amber = Color(hex: "#F59E0B")

  static var heroGradient: LinearGradient {
    LinearGradient(
      colors: [indigo, violet, cyan],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  static var moneyGradient: LinearGradient {
    LinearGradient(
      colors: [emerald, teal],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }
}

/// Dark navy container background with a faint diagonal hero-gradient wash.
struct DayFlowWidgetBackground: View {
  var body: some View {
    ZStack {
      DayFlowStyle.navy
      LinearGradient(
        colors: [
          DayFlowStyle.indigo.opacity(0.18),
          DayFlowStyle.violet.opacity(0.08),
          DayFlowStyle.cyan.opacity(0.14),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    }
  }
}

/// Slim capsule progress bar filled with a gradient.
struct GradientProgressCapsule: View {
  var progress: Double
  var gradient: LinearGradient = DayFlowStyle.heroGradient
  var height: CGFloat = 6

  private var clamped: CGFloat {
    CGFloat(min(max(progress, 0.0), 1.0))
  }

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule()
          .fill(Color.white.opacity(0.12))
        if clamped > 0 {
          Capsule()
            .fill(gradient)
            .frame(width: max(height, geo.size.width * clamped))
        }
      }
    }
    .frame(height: height)
  }
}

/// Flat unread-messages count pill (icon + number). Counts only — no content.
struct UnreadPill: View {
  let count: Int

  var body: some View {
    HStack(spacing: 3) {
      Image(systemName: "message.fill")
        .font(.system(size: 9, weight: .semibold))
      Text("\(count)")
        .font(.system(size: 11, weight: .bold, design: .rounded))
    }
    .foregroundStyle(DayFlowStyle.cyan)
    .padding(.horizontal, 7)
    .padding(.vertical, 3)
    .background(Capsule().fill(DayFlowStyle.cyan.opacity(0.16)))
  }
}

// MARK: - widget.today schema

struct WidgetTaskItem: Decodable {
  let id: String
  let title: String
  let timeLabel: String
  let colorHex: String
  let completed: Bool
  let isMeeting: Bool

  init(
    id: String,
    title: String,
    timeLabel: String,
    colorHex: String,
    completed: Bool,
    isMeeting: Bool
  ) {
    self.id = id
    self.title = title
    self.timeLabel = timeLabel
    self.colorHex = colorHex
    self.completed = completed
    self.isMeeting = isMeeting
  }

  private enum CodingKeys: String, CodingKey {
    case id, title, timeLabel, colorHex, completed, isMeeting
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = (try? container.decodeIfPresent(String.self, forKey: .id)) ?? ""
    title = (try? container.decodeIfPresent(String.self, forKey: .title)) ?? "Task"
    timeLabel = (try? container.decodeIfPresent(String.self, forKey: .timeLabel)) ?? ""
    colorHex = (try? container.decodeIfPresent(String.self, forKey: .colorHex)) ?? "#6366F1"
    completed = (try? container.decodeIfPresent(Bool.self, forKey: .completed)) ?? false
    isMeeting = (try? container.decodeIfPresent(Bool.self, forKey: .isMeeting)) ?? false
  }
}

struct TodayWidgetData: Decodable {
  let dateKey: String
  let done: Int
  let total: Int
  let earnedTodayLabel: String
  let tasks: [WidgetTaskItem]
  /// Unread SMS + Telegram + unheard voicemails. Counts only — safe everywhere.
  let unreadCount: Int
  /// PRIVACY: home-screen families only — never render on lock-screen families.
  let nextMeetingClient: String
  let nextMeetingTimeLabel: String

  init(
    dateKey: String,
    done: Int,
    total: Int,
    earnedTodayLabel: String,
    tasks: [WidgetTaskItem],
    unreadCount: Int,
    nextMeetingClient: String,
    nextMeetingTimeLabel: String
  ) {
    self.dateKey = dateKey
    self.done = done
    self.total = total
    self.earnedTodayLabel = earnedTodayLabel
    self.tasks = tasks
    self.unreadCount = unreadCount
    self.nextMeetingClient = nextMeetingClient
    self.nextMeetingTimeLabel = nextMeetingTimeLabel
  }

  private enum CodingKeys: String, CodingKey {
    case dateKey, done, total, earnedTodayLabel, tasks
    case unreadCount, nextMeetingClient, nextMeetingTimeLabel
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    dateKey = (try? container.decodeIfPresent(String.self, forKey: .dateKey)) ?? ""
    done = (try? container.decodeIfPresent(Int.self, forKey: .done)) ?? 0
    total = (try? container.decodeIfPresent(Int.self, forKey: .total)) ?? 0
    earnedTodayLabel = (try? container.decodeIfPresent(String.self, forKey: .earnedTodayLabel)) ?? ""
    tasks = (try? container.decodeIfPresent([WidgetTaskItem].self, forKey: .tasks)) ?? []
    unreadCount = (try? container.decodeIfPresent(Int.self, forKey: .unreadCount)) ?? 0
    nextMeetingClient = (try? container.decodeIfPresent(String.self, forKey: .nextMeetingClient)) ?? ""
    nextMeetingTimeLabel =
      (try? container.decodeIfPresent(String.self, forKey: .nextMeetingTimeLabel)) ?? ""
  }

  var remaining: Int { max(total - done, 0) }

  var progressFraction: Double {
    total > 0 ? Double(done) / Double(total) : 0
  }

  var nextTask: WidgetTaskItem? {
    tasks.first(where: { !$0.completed })
  }

  /// True when there is nothing left to do today.
  var isAllClear: Bool {
    remaining == 0 && nextTask == nil
  }

  static let placeholder = TodayWidgetData(
    dateKey: "",
    done: 2,
    total: 5,
    earnedTodayLabel: "$300",
    tasks: [
      WidgetTaskItem(
        id: "p1", title: "Morning review", timeLabel: "9:00 AM",
        colorHex: "#6366F1", completed: true, isMeeting: false),
      WidgetTaskItem(
        id: "p2", title: "Session with Alex", timeLabel: "2:00 PM",
        colorHex: "#F97362", completed: false, isMeeting: true),
      WidgetTaskItem(
        id: "p3", title: "Gym", timeLabel: "6:30 PM",
        colorHex: "#22D3EE", completed: false, isMeeting: false),
    ],
    unreadCount: 2,
    nextMeetingClient: "Alex",
    nextMeetingTimeLabel: "2:00 PM"
  )
}

// MARK: - widget.earnings schema

struct EarningsWidgetData: Decodable {
  let earnedLabel: String
  let goalLabel: String
  let progress: Double
  let outstandingLabel: String
  let meetingsDone: Int
  let hasGoal: Bool
  /// Empty string when no meeting money earned today.
  let earnedTodayLabel: String
  /// Unread SMS + Telegram + unheard voicemails (same as the messages tab badge).
  let unreadCount: Int

  init(
    earnedLabel: String,
    goalLabel: String,
    progress: Double,
    outstandingLabel: String,
    meetingsDone: Int,
    hasGoal: Bool,
    earnedTodayLabel: String,
    unreadCount: Int
  ) {
    self.earnedLabel = earnedLabel
    self.goalLabel = goalLabel
    self.progress = progress
    self.outstandingLabel = outstandingLabel
    self.meetingsDone = meetingsDone
    self.hasGoal = hasGoal
    self.earnedTodayLabel = earnedTodayLabel
    self.unreadCount = unreadCount
  }

  private enum CodingKeys: String, CodingKey {
    case earnedLabel, goalLabel, progress, outstandingLabel, meetingsDone, hasGoal
    case earnedTodayLabel, unreadCount
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    earnedLabel = (try? container.decodeIfPresent(String.self, forKey: .earnedLabel)) ?? "$0"
    goalLabel = (try? container.decodeIfPresent(String.self, forKey: .goalLabel)) ?? ""
    progress = (try? container.decodeIfPresent(Double.self, forKey: .progress)) ?? 0
    outstandingLabel = (try? container.decodeIfPresent(String.self, forKey: .outstandingLabel)) ?? ""
    meetingsDone = (try? container.decodeIfPresent(Int.self, forKey: .meetingsDone)) ?? 0
    hasGoal = (try? container.decodeIfPresent(Bool.self, forKey: .hasGoal)) ?? false
    earnedTodayLabel =
      (try? container.decodeIfPresent(String.self, forKey: .earnedTodayLabel)) ?? ""
    unreadCount = (try? container.decodeIfPresent(Int.self, forKey: .unreadCount)) ?? 0
  }

  static let placeholder = EarningsWidgetData(
    earnedLabel: "$450",
    goalLabel: "$1,500",
    progress: 0.3,
    outstandingLabel: "$150",
    meetingsDone: 3,
    hasGoal: true,
    earnedTodayLabel: "$150",
    unreadCount: 2
  )
}

// MARK: - Loader

enum SharedStore {
  static let appGroup = "group.com.levisilverberg.dayflow"

  static func loadToday() -> TodayWidgetData {
    decode(key: "widget.today") ?? .placeholder
  }

  static func loadEarnings() -> EarningsWidgetData {
    decode(key: "widget.earnings") ?? .placeholder
  }

  private static func decode<T: Decodable>(key: String) -> T? {
    guard
      let defaults = UserDefaults(suiteName: appGroup),
      let raw = defaults.string(forKey: key),
      let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }
}
