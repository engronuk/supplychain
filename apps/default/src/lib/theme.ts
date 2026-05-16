export type UserRole = 'manufacturer' | 'distributor' | 'retailer';

export type ThemeMode = 'dark' | 'light' | 'wabi';

const THEME_KEY = 'sc_theme_pref';

export const ROLE_DEFAULT_THEME: Record<UserRole, ThemeMode> = {
  manufacturer: 'light',
  distributor: 'light',
  retailer: 'light',
};

export function getStoredTheme(role: UserRole): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY + '_' + role);
  if (stored === 'light' || stored === 'wabi') return stored;
  // Ignore stored 'dark' — default everything to light
  return ROLE_DEFAULT_THEME[role];
}

export function setStoredTheme(role: UserRole, theme: ThemeMode) {
  localStorage.setItem(THEME_KEY + '_' + role, theme);
}
