/**
 * Smart icon suggestion — DayFlow's free, local take on Structured's
 * ML-powered icon picker. A curated keyword → Ionicon map is scanned in
 * order; the first matching rule wins, so specific words sit above
 * generic ones. Keywords match at word starts ("run" matches "running"
 * but not "brunch").
 */

interface Rule {
  icon: string;
  words: string[];
}

const RULES: Rule[] = [
  // ---- Fitness & health -------------------------------------------------
  { icon: 'barbell-outline', words: ['gym', 'workout', 'lift', 'weights', 'training', 'strength', 'crossfit', 'exercise'] },
  { icon: 'fitness-outline', words: ['run', 'jog', 'sprint', 'cardio', 'marathon', 'treadmill'] },
  { icon: 'walk-outline', words: ['walk', 'stroll', 'hike', 'hiking', 'steps'] },
  { icon: 'bicycle-outline', words: ['bike', 'cycling', 'cycle', 'biking'] },
  { icon: 'body-outline', words: ['yoga', 'stretch', 'pilates', 'posture'] },
  { icon: 'flower-outline', words: ['meditat', 'mindful', 'breathe', 'breathing'] },
  { icon: 'water-outline', words: ['swim', 'hydrate', 'water'] },
  { icon: 'football-outline', words: ['soccer', 'football'] },
  { icon: 'basketball-outline', words: ['basketball', 'hoops'] },
  { icon: 'tennisball-outline', words: ['tennis', 'padel', 'squash'] },
  { icon: 'medkit-outline', words: ['doctor', 'dentist', 'clinic', 'hospital', 'checkup', 'therapy', 'therapist', 'vaccine', 'pills', 'medicine', 'medication', 'vitamin'] },
  { icon: 'moon-outline', words: ['sleep', 'bedtime', 'wind down'] },
  { icon: 'bed-outline', words: ['nap', 'rest', 'lie down'] },

  // ---- Food & drink -----------------------------------------------------
  { icon: 'cafe-outline', words: ['coffee', 'cafe', 'latte', 'espresso', 'tea', 'breakfast', 'brunch'] },
  { icon: 'pizza-outline', words: ['pizza'] },
  { icon: 'fast-food-outline', words: ['burger', 'snack', 'takeout', 'fries'] },
  { icon: 'wine-outline', words: ['wine', 'date night', 'cocktail'] },
  { icon: 'beer-outline', words: ['beer', 'pub', 'brewery', 'happy hour'] },
  { icon: 'ice-cream-outline', words: ['ice cream', 'dessert', 'gelato'] },
  { icon: 'restaurant-outline', words: ['lunch', 'dinner', 'eat', 'cook', 'meal', 'bake', 'baking', 'food', 'restaurant', 'dishes'] },
  { icon: 'cart-outline', words: ['grocer', 'shopping', 'shop', 'buy', 'store'] },
  { icon: 'basket-outline', words: ['errand', 'market', 'pick up', 'pickup'] },

  // ---- Home & chores ----------------------------------------------------
  { icon: 'sparkles-outline', words: ['clean', 'tidy', 'vacuum', 'mop', 'declutter', 'dust'] },
  { icon: 'trash-outline', words: ['trash', 'garbage', 'recycling', 'bins'] },
  { icon: 'shirt-outline', words: ['laundry', 'clothes', 'iron', 'fold', 'wardrobe'] },
  { icon: 'hammer-outline', words: ['fix', 'repair'] },
  { icon: 'construct-outline', words: ['build', 'assemble', 'install', 'diy'] },
  { icon: 'home-outline', words: ['home', 'house', 'rent', 'mortgage', 'apartment', 'landlord'] },
  { icon: 'paw-outline', words: ['dog', 'cat', 'pet', 'vet', 'puppy', 'kitten'] },
  { icon: 'key-outline', words: ['keys', 'lock', 'locksmith'] },
  { icon: 'leaf-outline', words: ['plant', 'garden', 'compost', 'weed'] },

  // ---- Work & communication ----------------------------------------------
  { icon: 'people-outline', words: ['meeting', 'meet', 'standup', 'stand-up', 'interview', 'sync', 'catch up', 'catchup', '1on1', 'one on one'] },
  { icon: 'videocam-outline', words: ['zoom', 'facetime', 'video call', 'webinar', 'teams call'] },
  { icon: 'call-outline', words: ['call', 'phone', 'dial'] },
  { icon: 'mail-outline', words: ['email', 'mail', 'newsletter', 'inbox zero'] },
  { icon: 'chatbubbles-outline', words: ['chat', 'message', 'text', 'slack', 'discord', 'reply'] },
  { icon: 'desktop-outline', words: ['presentation', 'present', 'demo', 'keynote'] },
  { icon: 'briefcase-outline', words: ['work', 'office', 'client', 'job', 'shift'] },
  { icon: 'code-slash-outline', words: ['code', 'coding', 'debug', 'deploy', 'program', 'dev ', 'refactor', 'pull request', 'commit'] },
  { icon: 'terminal-outline', words: ['terminal', 'script', 'server'] },
  { icon: 'laptop-outline', words: ['laptop', 'computer'] },

  // ---- Study & writing ----------------------------------------------------
  { icon: 'school-outline', words: ['study', 'homework', 'exam', 'test prep', 'class', 'lecture', 'school', 'learn', 'course', 'revise', 'revision'] },
  { icon: 'book-outline', words: ['read', 'book', 'chapter', 'novel'] },
  { icon: 'library-outline', words: ['library'] },
  { icon: 'pencil-outline', words: ['write', 'writing', 'journal', 'blog', 'essay', 'draft', 'edit'] },
  { icon: 'document-text-outline', words: ['notes', 'report', 'document', 'resume', 'cv ', 'form', 'paperwork'] },
  { icon: 'calculator-outline', words: ['math', 'taxes', 'tax ', 'calculate', 'accounting'] },
  { icon: 'newspaper-outline', words: ['news', 'headlines'] },
  { icon: 'mic-outline', words: ['podcast', 'record', 'mic', 'voiceover'] },
  { icon: 'language-outline', words: ['spanish', 'french', 'german', 'japanese', 'language', 'duolingo', 'vocab'] },

  // ---- Leisure ------------------------------------------------------------
  { icon: 'musical-notes-outline', words: ['music', 'piano', 'guitar', 'sing', 'song', 'band', 'violin', 'drums'] },
  { icon: 'headset-outline', words: ['listen', 'headphones', 'audiobook'] },
  { icon: 'film-outline', words: ['movie', 'film', 'cinema'] },
  { icon: 'tv-outline', words: ['tv', 'netflix', 'watch', 'series', 'episode'] },
  { icon: 'camera-outline', words: ['photo', 'camera', 'shoot', 'photograph'] },
  { icon: 'color-palette-outline', words: ['paint', 'art', 'design'] },
  { icon: 'brush-outline', words: ['draw', 'sketch', 'illustrat'] },
  { icon: 'game-controller-outline', words: ['game', 'gaming', 'play', 'xbox', 'playstation', 'nintendo'] },
  { icon: 'gift-outline', words: ['gift', 'present for', 'birthday', 'wrap'] },
  { icon: 'balloon-outline', words: ['party', 'celebrat', 'anniversary'] },
  { icon: 'heart-outline', words: ['date with', 'love', 'valentine'] },

  // ---- Travel & transport --------------------------------------------------
  { icon: 'airplane-outline', words: ['flight', 'fly', 'airport', 'plane', 'travel', 'trip', 'vacation', 'holiday'] },
  { icon: 'car-outline', words: ['drive', 'car', 'commute', 'gas', 'fuel', 'oil change', 'parking'] },
  { icon: 'bus-outline', words: ['bus'] },
  { icon: 'train-outline', words: ['train', 'subway', 'metro'] },
  { icon: 'boat-outline', words: ['boat', 'sail', 'ferry'] },
  { icon: 'map-outline', words: ['map', 'directions', 'route'] },
  { icon: 'compass-outline', words: ['explore', 'adventure'] },
  { icon: 'sunny-outline', words: ['beach', 'sunbath', 'sunny', 'picnic'] },
  { icon: 'umbrella-outline', words: ['rain'] },

  // ---- Money ---------------------------------------------------------------
  { icon: 'card-outline', words: ['pay', 'bill', 'invoice', 'subscription', 'renew'] },
  { icon: 'cash-outline', words: ['cash', 'atm', 'money', 'deposit'] },
  { icon: 'wallet-outline', words: ['budget', 'savings', 'finance', 'expense'] },
  { icon: 'trending-up-outline', words: ['invest', 'stocks', 'portfolio'] },
  { icon: 'stats-chart-outline', words: ['analytics', 'stats', 'metrics', 'dashboard'] },

  // ---- Misc ------------------------------------------------------------------
  { icon: 'cut-outline', words: ['haircut', 'barber', 'salon', 'nails', 'trim'] },
  { icon: 'battery-charging-outline', words: ['charge', 'recharge'] },
  { icon: 'alarm-outline', words: ['wake', 'alarm', 'early'] },
  { icon: 'time-outline', words: ['deadline', 'due', 'timer'] },
  { icon: 'calendar-outline', words: ['schedule', 'plan', 'calendar', 'book appointment', 'appointment'] },
  { icon: 'list-outline', words: ['checklist', 'todo', 'to-do', 'list', 'organize'] },
  { icon: 'bulb-outline', words: ['idea', 'brainstorm', 'think'] },
  { icon: 'rocket-outline', words: ['launch', 'ship', 'release'] },
  { icon: 'star-outline', words: ['favorite', 'review'] },
  { icon: 'flag-outline', words: ['goal', 'milestone', 'finish'] },
  { icon: 'notifications-outline', words: ['remind', 'follow up', 'followup'] },
];

const MATCHERS: Array<{ icon: string; re: RegExp }> = RULES.flatMap((rule) =>
  rule.words.map((w) => ({
    icon: rule.icon,
    // Word-start boundary: keyword must begin the string or follow a
    // non-alphanumeric character, so "run" matches "morning run" and
    // "running" but never "brunch".
    re: new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  }))
);

/** Suggest an Ionicon for a task title, or null when nothing matches. */
export function suggestIcon(title: string): string | null {
  const t = title.toLowerCase().trim();
  if (!t) return null;
  for (const m of MATCHERS) {
    if (m.re.test(t)) return m.icon;
  }
  return null;
}
