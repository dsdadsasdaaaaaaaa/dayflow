import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Timer text

/// Counts down to the planned end; once in overtime, counts up from the
/// planned end. Both render via Text(timerInterval:) so the system ticks
/// the display without any activity updates.
struct MeetingTimerText: View {
  let state: MeetingActivityAttributes.ContentState

  var body: some View {
    if state.overtime {
      Text(
        timerInterval: state.endDate...Date.distantFuture,
        countsDown: false
      )
    } else {
      Text(
        timerInterval: state.startDate...state.endDate,
        countsDown: true
      )
    }
  }
}

// MARK: - Lock screen banner

struct MeetingLockScreenView: View {
  let context: ActivityViewContext<MeetingActivityAttributes>

  var body: some View {
    HStack(spacing: 12) {
      ZStack {
        Circle()
          .fill(DayFlowStyle.heroGradient)
          .frame(width: 44, height: 44)
        Image(systemName: context.attributes.symbolName)
          .font(.system(size: 18, weight: .semibold))
          .foregroundStyle(.white)
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(context.attributes.clientName)
          .font(.system(.headline, design: .rounded))
          .foregroundStyle(.white)
          .lineLimit(1)
        Text(context.attributes.kindLabel)
          .font(.system(size: 12, weight: .medium, design: .rounded))
          .foregroundStyle(.white.opacity(0.6))
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      VStack(alignment: .trailing, spacing: 2) {
        Text(context.attributes.rateLabel)
          .font(.system(size: 14, weight: .bold, design: .rounded))
          .foregroundStyle(DayFlowStyle.moneyGradient)
        if context.state.overtime {
          Text("Overtime")
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .textCase(.uppercase)
            .tracking(0.8)
            .foregroundStyle(DayFlowStyle.amber)
        }
        MeetingTimerText(state: context.state)
          .font(.system(size: 24, weight: .bold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(context.state.overtime ? DayFlowStyle.amber : Color.white)
          .multilineTextAlignment(.trailing)
      }
    }
    .padding(16)
  }
}

// MARK: - Live Activity widget

struct MeetingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MeetingActivityAttributes.self) { context in
      MeetingLockScreenView(context: context)
        .activityBackgroundTint(DayFlowStyle.navy.opacity(0.85))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(URL(string: "dayflow://meeting-live"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ZStack {
            Circle()
              .fill(DayFlowStyle.heroGradient)
              .frame(width: 36, height: 36)
            Image(systemName: context.attributes.symbolName)
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(.white)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 1) {
            Text(context.attributes.clientName)
              .font(.system(.headline, design: .rounded))
              .foregroundStyle(.white)
              .lineLimit(1)
            Text(context.attributes.kindLabel)
              .font(.system(size: 11, weight: .medium, design: .rounded))
              .foregroundStyle(.white.opacity(0.6))
              .lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.trailing) {
          MeetingTimerText(state: context.state)
            .font(.system(size: 17, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(context.state.overtime ? DayFlowStyle.amber : DayFlowStyle.cyan)
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 72)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack {
            Text(context.attributes.rateLabel)
              .font(.system(size: 13, weight: .bold, design: .rounded))
              .foregroundStyle(DayFlowStyle.moneyGradient)
            Spacer()
            if context.state.overtime {
              Text("Overtime")
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(DayFlowStyle.amber)
            }
          }
        }
      } compactLeading: {
        Image(systemName: context.attributes.symbolName)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(DayFlowStyle.indigo)
      } compactTrailing: {
        MeetingTimerText(state: context.state)
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(context.state.overtime ? DayFlowStyle.amber : DayFlowStyle.cyan)
          .multilineTextAlignment(.center)
          .frame(maxWidth: 50)
      } minimal: {
        Image(systemName: context.attributes.symbolName)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(DayFlowStyle.indigo)
      }
      .widgetURL(URL(string: "dayflow://meeting-live"))
      .keylineTint(DayFlowStyle.indigo)
    }
  }
}
