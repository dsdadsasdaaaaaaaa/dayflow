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

  init(
    dateKey: String,
    done: Int,
    total: Int,
    earnedTodayLabel: String,
    tasks: [WidgetTaskItem]
  ) {
    self.dateKey = dateKey
    self.done = done
    self.total = total
    self.earnedTodayLabel = earnedTodayLabel
    self.tasks = tasks
  }

  private enum CodingKeys: String, CodingKey {
    case dateKey, done, total, earnedTodayLabel, tasks
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    dateKey = (try? container.decodeIfPresent(String.self, forKey: .dateKey)) ?? ""
    done = (try? container.decodeIfPresent(Int.self, forKey: .done)) ?? 0
    total = (try? container.decodeIfPresent(Int.self, forKey: .total)) ?? 0
    earnedTodayLabel = (try? container.decodeIfPresent(String.self, forKey: .earnedTodayLabel)) ?? ""
    tasks = (try? container.decodeIfPresent([WidgetTaskItem].self, forKey: .tasks)) ?? []
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
    ]
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

  init(
    earnedLabel: String,
    goalLabel: String,
    progress: Double,
    outstandingLabel: String,
    meetingsDone: Int,
    hasGoal: Bool
  ) {
    self.earnedLabel = earnedLabel
    self.goalLabel = goalLabel
    self.progress = progress
    self.outstandingLabel = outstandingLabel
    self.meetingsDone = meetingsDone
    self.hasGoal = hasGoal
  }

  private enum CodingKeys: String, CodingKey {
    case earnedLabel, goalLabel, progress, outstandingLabel, meetingsDone, hasGoal
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    earnedLabel = (try? container.decodeIfPresent(String.self, forKey: .earnedLabel)) ?? "$0"
    goalLabel = (try? container.decodeIfPresent(String.self, forKey: .goalLabel)) ?? ""
    progress = (try? container.decodeIfPresent(Double.self, forKey: .progress)) ?? 0
    outstandingLabel = (try? container.decodeIfPresent(String.self, forKey: .outstandingLabel)) ?? ""
    meetingsDone = (try? container.decodeIfPresent(Int.self, forKey: .meetingsDone)) ?? 0
    hasGoal = (try? container.decodeIfPresent(Bool.self, forKey: .hasGoal)) ?? false
  }

  static let placeholder = EarningsWidgetData(
    earnedLabel: "$450",
    goalLabel: "$1,500",
    progress: 0.3,
    outstandingLabel: "$150",
    meetingsDone: 3,
    hasGoal: true
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
