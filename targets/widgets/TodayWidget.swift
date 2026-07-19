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
      Spacer(minLength: 4)
      if !data.earnedTodayLabel.isEmpty {
        Text(data.earnedTodayLabel)
          .font(.system(size: 13, weight: .bold, design: .rounded))
          .foregroundStyle(DayFlowStyle.emerald)
      }
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
      if data.tasks.isEmpty {
        AllClearView()
      } else {
        TodayTaskList(tasks: data.tasks, limit: 3)
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
      if data.tasks.isEmpty {
        AllClearView()
      } else {
        TodayTaskList(tasks: data.tasks, limit: 7)
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct TodayAccessoryRectangularView: View {
  let data: TodayWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      if let next = data.nextTask {
        Text("Up next")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(.secondary)
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
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

struct TodayAccessoryInlineView: View {
  let data: TodayWidgetData

  var body: some View {
    if let next = data.nextTask, !next.timeLabel.isEmpty {
      Text("\(data.remaining) left · next \(next.timeLabel)")
    } else if data.remaining > 0 {
      Text("\(data.remaining) left")
    } else {
      Text("All clear")
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
