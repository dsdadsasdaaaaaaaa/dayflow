import SwiftUI
import WidgetKit

// MARK: - Timeline

struct EarningsEntry: TimelineEntry {
  let date: Date
  let data: EarningsWidgetData
}

struct EarningsProvider: TimelineProvider {
  func placeholder(in context: Context) -> EarningsEntry {
    EarningsEntry(date: Date(), data: .placeholder)
  }

  func getSnapshot(in context: Context, completion: @escaping (EarningsEntry) -> Void) {
    let data = context.isPreview ? EarningsWidgetData.placeholder : SharedStore.loadEarnings()
    completion(EarningsEntry(date: Date(), data: data))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<EarningsEntry>) -> Void) {
    let entry = EarningsEntry(date: Date(), data: SharedStore.loadEarnings())
    let next = Date().addingTimeInterval(30 * 60)
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

// MARK: - Pieces

struct OutstandingChip: View {
  let label: String

  var body: some View {
    Text("\(label) due")
      .font(.system(size: 10, weight: .bold, design: .rounded))
      .foregroundStyle(DayFlowStyle.amber)
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(Capsule().fill(DayFlowStyle.amber.opacity(0.16)))
  }
}

// MARK: - Family views

struct EarningsSmallView: View {
  let data: EarningsWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(data.earnedLabel)
        .font(.system(size: 30, weight: .heavy, design: .rounded))
        .foregroundStyle(DayFlowStyle.moneyGradient)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      Text("this week")
        .font(.system(size: 11, weight: .medium, design: .rounded))
        .foregroundStyle(.white.opacity(0.55))
      Spacer(minLength: 4)
      if data.hasGoal {
        GradientProgressCapsule(
          progress: data.progress,
          gradient: DayFlowStyle.moneyGradient
        )
      }
      if !data.outstandingLabel.isEmpty {
        OutstandingChip(label: data.outstandingLabel)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

struct EarningsMediumView: View {
  let data: EarningsWidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 2) {
          Text("This week")
            .font(.system(size: 11, weight: .heavy, design: .rounded))
            .textCase(.uppercase)
            .tracking(1.2)
            .foregroundStyle(.white.opacity(0.55))
          Text(data.earnedLabel)
            .font(.system(size: 28, weight: .heavy, design: .rounded))
            .foregroundStyle(DayFlowStyle.moneyGradient)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        }
        Spacer(minLength: 8)
        VStack(alignment: .trailing, spacing: 2) {
          Text("\(data.meetingsDone)")
            .font(.system(size: 20, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
          Text(data.meetingsDone == 1 ? "meeting" : "meetings")
            .font(.system(size: 10, weight: .medium, design: .rounded))
            .foregroundStyle(.white.opacity(0.55))
        }
      }
      if data.hasGoal {
        VStack(alignment: .leading, spacing: 4) {
          GradientProgressCapsule(
            progress: data.progress,
            gradient: DayFlowStyle.moneyGradient
          )
          HStack {
            Text("Goal \(data.goalLabel)")
              .font(.system(size: 10, weight: .medium, design: .rounded))
              .foregroundStyle(.white.opacity(0.55))
            Spacer()
            Text("\(Int((min(max(data.progress, 0), 1)) * 100))%")
              .font(.system(size: 10, weight: .bold, design: .rounded))
              .foregroundStyle(.white.opacity(0.7))
          }
        }
      }
      if !data.outstandingLabel.isEmpty {
        HStack(spacing: 5) {
          Image(systemName: "hourglass")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(DayFlowStyle.amber)
          Text("\(data.outstandingLabel) outstanding")
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .foregroundStyle(DayFlowStyle.amber)
          Spacer(minLength: 0)
        }
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Entry view

struct EarningsWidgetEntryView: View {
  var entry: EarningsEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    content
      .containerBackground(for: .widget) { DayFlowWidgetBackground() }
      .widgetURL(URL(string: "dayflow://stats"))
  }

  @ViewBuilder private var content: some View {
    switch family {
    case .systemMedium:
      EarningsMediumView(data: entry.data)
    default:
      EarningsSmallView(data: entry.data)
    }
  }
}

// MARK: - Widget

struct EarningsWidget: Widget {
  let kind: String = "DayFlowEarningsWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: EarningsProvider()) { entry in
      EarningsWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Earnings")
    .description("Weekly earnings, goal progress, and outstanding payments.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
