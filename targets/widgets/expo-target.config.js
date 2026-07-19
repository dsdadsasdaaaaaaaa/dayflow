/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'DayFlowWidgets',
  displayName: 'DayFlow',
  deploymentTarget: '17.0',
  entitlements: {
    'com.apple.security.application-groups': ['group.com.levisilverberg.dayflow'],
  },
  colors: {
    $accent: { color: '#6366F1', darkColor: '#818CF8' },
  },
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
};
