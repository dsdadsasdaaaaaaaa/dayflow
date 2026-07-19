Pod::Spec.new do |s|
  s.name           = 'DayflowLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Live Activity bridge for DayFlow meeting sessions'
  s.description    = 'Starts, updates, and ends the meeting-session Live Activity via ActivityKit.'
  s.author         = 'DayFlow'
  s.homepage       = 'https://github.com/levisilverberg/dayflow'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
