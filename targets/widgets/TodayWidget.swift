import SwiftUI
import WidgetKit

// MARK: - Timeline

struct TodayEntry: TimelineEntry {
  let date: Date
  let data: TodayWidgetData
}

struct TodayProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: Date(), data: .placeholder)
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    let data = context.isPreview ? TodayWidgetData.placeholder : SharedStore.loadToday()
    completion(TodayEntry(date: Date(), data: data))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    let entry = TodayEntry(date: Date(), data: SharedStore.loadToday())
    let next = Date().addingTimeInterval(15 * 60)
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

// MARK: - Shared pieces

/// "All clear" empty state with a subtle checkmark seal.
struct AllClearView: View {
  var body: some View {
    VStack(spacing: 8) {
      ZStack {
        Circle()
          .fill(DayFlowStyle.heroGradient)
          .opacity(0.22)
          .frame(width: 44, height: 44)
        Image(systemName: "checkmark.seal.fill")
          .font(.system(size: 22, weight: .semibold))
          .foregroundStyle(DayFlowStyle.heroGradient)
      }
      Text("All clear")
        .font(.system(size: 14, weight: .semibold, design: .rounded))
        .foregroundStyle(.white.opacity(0.85))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

struct TodayHeaderRow: View {
  let data: TodayWidgetData

  var body: some View {
    HStack(spacing: 8) {
      Text("Today")
        .font(.system(size: 11, weight: .heavy, design: .rounded))
        .textCase(.uppercase)
        .tracking(1.2)
        .foregroundStyle(.white.opacity(0.55))
      Text("\(data.done)/\(data.total)")
        .font(.system(size: 11, weight: .bold, design: .rounded))
        .foregroundStyle(.white.opacity(0.9))
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(Color.white.opacity(0.12)))
      if data.unreadCount > 0 {
        UnreadPill(count: data.unreadCount)
      }
      Spacer(minLength: 4)
      if !data.earnedTodayLabel.isEmpty {
        Text(data.earnedTodayLabel)
          .font(.system(size: 13, weight: .bold, design: .rounded))
          .foregroundStyle(DayFlowStyle.emerald)
      }
    }
  }
}

/// "Next meeting · <client> · <time>" strip. HOME-SCREEN FAMILIES ONLY —
/// the client name must never appear on lock-screen families.
struct NextMeetingRow: View {
  let data: TodayWidgetData

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "person.crop.circle.badge.clock")
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(DayFlowStyle.violet)
      Text("Next meeting")
        .font(.system(size: 10, weight: .heavy, design: .rounded))
        .textCase(.uppercase)
        .tracking(1.0)
        .foregroundStyle(.white.opacity(0.5))
      Text(data.nextMeetingClient)
        .font(.system(size: 11, weight: .bold, design: .rounded))
        .foregroundStyle(.white.opacity(0.9))
        .lineLimit(1)
      if !data.nextMeetingTimeLabel.isEmpty {
        Text(data.nextMeetingTimeLabel)
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .foregroundStyle(DayFlowStyle.cyan)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
  }
}

struct TodayTaskRow: View {
  let task: WidgetTaskItem

  var body: some View {
    HStack(spacing: 8) {
      Circle()
        .fill(Color(hex: task.colorHex))
        .frame(width: 8, height: 8)
      Text(task.title)
        .font(.system(size: 13, weight: .semibold, design: .rounded))
        .foregroundStyle(task.completed ? Color.white.opacity(0.45) : Color.white)
        .strikethrough(task.completed, color: .white.opacity(0.4))
        .lineLimit(1)
      if task.isMeeting {
        Image(systemName: "banknote.fill")
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(DayFlowStyle.emerald.opacity(0.9))
      }
      Spacer(minLength: 6)
      if !task.timeLabel.isEmpty {
        Text(task.timeLabel)
          .font(.system(size: 11, weight: .medium, design: .rounded))
          .foregroundStyle(.white.opacity(0.5))
      }
      if task.completed {
        Image(systemName: "checkmark.circle.fill")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(DayFlowStyle.emerald)
      }
    }
  }
}

struct TodayTaskList: View {
  let tasks: [WidgetTaskItem]
  let limit: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      ForEach(Array(tasks.prefix(limit).enumerated()), id: \.offset) { _, task in
        TodayTaskRow(task: task)
      }
    }
  }
}

// MARK: - Family views

struct TodaySmallView: View {
  let data: TodayWidgetData

  var body: some View {
    if data.isAllClear {
      AllClearView()
    } else {
      VStack(alignment: .leading, spacing: 5) {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          Text("\(data.remaining)")
            .font(.system(size: 34, weight: .heavy, design: .rounded))
            .foregroundStyle(.white)
          Text("left")
            .font(.system(size: 13, weight: .semibold, design: .rounded))
            .foregroundStyle(.white.opacity(0.55))
          Spacer(minLength: 2)
          if data.unreadCount > 0 {
            UnreadPill(count: data.unreadCount)
          }
        }
        Text("\(data.done) of \(data.total) done")
          .font(.system(size: 11, weight: .medium, design: .rounded))
          .foregroundStyle(.white.opacity(0.55))
        GradientProgressCapsule(progress: data.progressFraction)
        Spacer(minLength: 2)
        if let next = data.nextTask {
          VStack(alignment: .leading, spacing: 1) {
            Text(next.title)
              .font(.system(size: 12, weight: .semibold, design: .rounded))
              .foregroundStyle(.white)
              .lineLimit(1)
            if !next.timeLabel.isEmpty {
              Text(next.timeLabel)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.5))
            }
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
  }
}

struct TodayMediumView: View {
  let data: TodayWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      TodayHeaderRow(data: data)
      if !data.nextMeetingClient.isEmpty {
        NextMeetingRow(data: data)
      }
      if data.tasks.isEmpty {
        AllClearView()
      } else {
        TodayTaskList(tasks: data.tasks, limit: data.nextMeetingClient.isEmpty ? 3 : 2)
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct TodayLargeView: View {
  let data: TodayWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      TodayHeaderRow(data: data)
      if !data.nextMeetingClient.isEmpty {
        NextMeetingRow(data: data)
      }
      if data.tasks.isEmpty {
        AllClearView()
      } else {
        TodayTaskList(tasks: data.tasks, limit: data.nextMeetingClient.isEmpty ? 7 : 6)
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// LOCK SCREEN — privacy rule: counts and times only. Never message content,
/// never the next-meeting client name (task titles follow existing precedent).
struct TodayAccessoryRectangularView: View {
  let data: TodayWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 4) {
        Text(data.nextTask != nil ? "Up next" : "Today")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(.secondary)
        Spacer(minLength: 4)
        if data.unreadCount > 0 {
          HStack(spacing: 3) {
            Image(systemName: "message.fill")
              .font(.system(size: 9, weight: .semibold))
            Text("\(data.unreadCount)")
              .font(.system(size: 11, weight: .bold))
          }
        }
      }
      if let next = data.nextTask {
        Text(next.title)
          .font(.system(size: 14, weight: .bold))
          .lineLimit(1)
        if !next.timeLabel.isEmpty {
          Text(next.timeLabel)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.secondary)
        }
      } else {
        HStack(spacing: 5) {
          Image(systemName: "checkmark.seal.fill")
            .font(.system(size: 14, weight: .semibold))
          Text("All clear")
            .font(.system(size: 14, weight: .bold))
        }
        // Time only — no client on the lock screen.
        if !data.nextMeetingTimeLabel.isEmpty {
          Text("Meeting \(data.nextMeetingTimeLabel)")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

/// LOCK SCREEN — counts and times only (see rectangular view note).
struct TodayAccessoryInlineView: View {
  let data: TodayWidgetData

  private var base: String {
    if let next = data.nextTask, !next.timeLabel.isEmpty {
      return "\(data.remaining) left · next \(next.timeLabel)"
    }
    if data.remaining > 0 { return "\(data.remaining) left" }
    return "All clear"
  }

  var body: some View {
    if data.unreadCount > 0 {
      Text("\(base) · \(data.unreadCount) unread")
    } else {
      Text(base)
    }
  }
}

// MARK: - Entry view

struct TodayWidgetEntryView: View {
  var entry: TodayEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    content
      .containerBackground(for: .widget) { background }
      .widgetURL(URL(string: "dayflow://"))
  }

  @ViewBuilder private var content: some View {
    switch family {
    case .systemSmall:
      TodaySmallView(data: entry.data)
    case .systemMedium:
      TodayMediumView(data: entry.data)
    case .systemLarge:
      TodayLargeView(data: entry.data)
    case .accessoryRectangular:
      TodayAccessoryRectangularView(data: entry.data)
    case .accessoryInline:
      TodayAccessoryInlineView(data: entry.data)
    default:
      TodaySmallView(data: entry.data)
    }
  }

  @ViewBuilder private var background: some View {
    switch family {
    case .accessoryRectangular:
      AccessoryWidgetBackground()
    case .accessoryInline:
      Color.clear
    default:
      DayFlowWidgetBackground()
    }
  }
}

// MARK: - Widget

struct TodayWidget: Widget {
  let kind: String = "DayFlowTodayWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: TodayProvider()) { entry in
      TodayWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Today")
    .description("Your remaining tasks and schedule at a glance.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .systemLarge,
      .accessoryRectangular, .accessoryInline,
    ])
  }
}
