import { useColorScheme } from 'react-native';
import { useSettings } from '../store/settings';

/**
 * DayFlow design language.
 * Signature gradient: indigo → cyan. Soft cards, 16px radii, generous spacing.
 */

export const GRADIENT = ['#6366F1', '#22D3EE'] as const; // indigo-500 → cyan-400
export const GRADIENT_DARK = ['#4F46E5', '#0891B2'] as const;

export interface TaskColor {
  key: string;
  label: string;
  /** Card tint backgrounds. */
  bgLight: string;
  bgDark: string;
  /** Icon circle / accents. */
  solid: string;
  /** Text on tinted background. */
  fgLight: string;
  fgDark: string;
}

export const TASK_COLORS: TaskColor[] = [
  { key: 'indigo', label: 'Indigo', bgLight: '#EEF0FE', bgDark: '#26284A', solid: '#6366F1', fgLight: '#3F43B4', fgDark: '#B9BCFA' },
  { key: 'cyan', label: 'Cyan', bgLight: '#E2F8FC', bgDark: '#123A44', solid: '#06B6D4', fgLight: '#0E7490', fgDark: '#8AE6F5' },
  { key: 'coral', label: 'Coral', bgLight: '#FEEDEA', bgDark: '#46251F', solid: '#F97362', fgLight: '#C2402F', fgDark: '#FDB3A8' },
  { key: 'amber', label: 'Amber', bgLight: '#FDF3DC', bgDark: '#42351A', solid: '#F5B93E', fgLight: '#A16207', fgDark: '#FCD98B' },
  { key: 'emerald', label: 'Emerald', bgLight: '#E4F7EC', bgDark: '#173B2A', solid: '#10B981', fgLight: '#047857', fgDark: '#8BE8C4' },
  { key: 'rose', label: 'Rose', bgLight: '#FDEBF1', bgDark: '#45202E', solid: '#F43F7E', fgLight: '#BE185D', fgDark: '#FBA9C7' },
  { key: 'violet', label: 'Violet', bgLight: '#F3EDFD', bgDark: '#322347', solid: '#8B5CF6', fgLight: '#6D28D9', fgDark: '#CDB4FB' },
  { key: 'sky', label: 'Sky', bgLight: '#E5F3FE', bgDark: '#16324A', solid: '#0EA5E9', fgLight: '#0369A1', fgDark: '#93D6FA' },
  { key: 'lime', label: 'Lime', bgLight: '#F0F8DF', bgDark: '#2C3A17', solid: '#84CC16', fgLight: '#4D7C0F', fgDark: '#C8ED8A' },
  { key: 'orange', label: 'Orange', bgLight: '#FEF0E2', bgDark: '#452D14', solid: '#F97316', fgLight: '#C2410C', fgDark: '#FCC28C' },
  { key: 'slate', label: 'Slate', bgLight: '#EEF1F5', bgDark: '#2A3038', solid: '#64748B', fgLight: '#374151', fgDark: '#C2CBD8' },
  { key: 'teal', label: 'Teal', bgLight: '#E0F6F4', bgDark: '#123B37', solid: '#14B8A6', fgLight: '#0F766E', fgDark: '#89E5DB' },
];

export function taskColor(key: string): TaskColor {
  return TASK_COLORS.find((c) => c.key === key) ?? TASK_COLORS[0];
}

export const PRIORITY_META = [
  { label: 'None', color: '#94A3B8', icon: 'remove' },
  { label: 'Low', color: '#0EA5E9', icon: 'chevron-down' },
  { label: 'Medium', color: '#F5B93E', icon: 'reorder-two' },
  { label: 'High', color: '#F43F5E', icon: 'chevron-up' },
] as const;

export interface Theme {
  dark: boolean;
  background: string;
  /** Elevated surfaces: cards, sheets. */
  card: string;
  /** Slightly recessed surfaces: inputs, chips. */
  surface: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  separator: string;
  accent: string;
  accentSoft: string;
  danger: string;
  success: string;
  gradient: readonly [string, string];
  /** Timeline "now" line. */
  nowLine: string;
  tabBar: string;
  overlay: string;

  // ── Liquid Glass tokens ────────────────────────────────────────────────────
  /** BlurView tint for glass surfaces. */
  blurTint: 'light' | 'dark';
  /** Translucent fill layered over blur on glass surfaces. */
  glassFill: string;
  /** Stronger fill for prominent glass (sheets, tab bar). */
  glassFillStrong: string;
  /** 1px hairline border around glass surfaces. */
  glassBorder: string;
  /** Top-edge refraction highlight (gradient start; fades to transparent). */
  glassHighlight: string;
  /** Ambient aurora blob colors (rendered blurred behind content). */
  aurora: readonly [string, string, string];
  /** Glow shadow color for accent elements. */
  glow: string;
  /** Rich 3-stop hero gradient (CTAs, active pills, rings). */
  heroGradient: readonly [string, string, string];
  /** Money/success gradient. */
  moneyGradient: readonly [string, string];
}

// Design v3 — CLEAN. Flat surfaces, hairline borders, one accent, no
// blur/glow/gradient decoration. The glass-era token names are kept so call
// sites compile, but they now resolve to flat values (aurora is transparent,
// "gradients" are single-color, glow is invisible).

export const LIGHT: Theme = {
  dark: false,
  background: '#F5F5F7',
  card: '#FFFFFF',
  surface: '#EEEEF1',
  text: '#111114',
  textSecondary: '#55555E',
  textTertiary: '#8E8E98',
  border: '#E3E3E8',
  separator: '#ECECEF',
  accent: '#4F5BE7',
  accentSoft: '#EDEEFD',
  danger: '#E5484D',
  success: '#0E9A6C',
  gradient: ['#4F5BE7', '#4F5BE7'],
  nowLine: '#E5484D',
  tabBar: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.4)',

  blurTint: 'light',
  glassFill: '#FFFFFF',
  glassFillStrong: '#FFFFFF',
  glassBorder: '#E3E3E8',
  glassHighlight: 'transparent',
  aurora: ['transparent', 'transparent', 'transparent'],
  glow: 'transparent',
  heroGradient: ['#4F5BE7', '#4F5BE7', '#4F5BE7'],
  moneyGradient: ['#0E9A6C', '#0E9A6C'],
};

export const DARK: Theme = {
  dark: true,
  background: '#0C0C0F',
  card: '#17171C',
  surface: '#222228',
  text: '#F2F2F5',
  textSecondary: '#A3A3AD',
  textTertiary: '#6E6E78',
  border: '#2A2A31',
  separator: '#232329',
  accent: '#7B84F0',
  accentSoft: 'rgba(123, 132, 240, 0.16)',
  danger: '#F2555A',
  success: '#2EBD85',
  gradient: ['#7B84F0', '#7B84F0'],
  nowLine: '#F2555A',
  tabBar: '#141418',
  overlay: 'rgba(0, 0, 0, 0.6)',

  blurTint: 'dark',
  glassFill: '#17171C',
  glassFillStrong: '#17171C',
  glassBorder: '#2A2A31',
  glassHighlight: 'transparent',
  aurora: ['transparent', 'transparent', 'transparent'],
  glow: 'transparent',
  heroGradient: ['#7B84F0', '#7B84F0', '#7B84F0'],
  moneyGradient: ['#2EBD85', '#2EBD85'],
};

/** Resolve the active theme from settings + system scheme. */
export function useTheme(): Theme {
  const system = useColorScheme();
  const mode = useSettings((s) => s.settings.themeMode);
  const dark = mode === 'system' ? system === 'dark' : mode === 'dark';
  return dark ? DARK : LIGHT;
}

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 24 } as const;
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
