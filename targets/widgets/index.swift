import SwiftUI
import WidgetKit

@main
struct DayFlowWidgetBundle: WidgetBundle {
  var body: some Widget {
    TodayWidget()
    EarningsWidget()
    MeetingLiveActivity()
  }
}
