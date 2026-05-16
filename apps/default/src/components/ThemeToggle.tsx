import React from 'react';
import { Sun, Moon, Leaf } from 'lucide-react';
import type { ThemeMode, UserRole } from '@/lib/theme';
import { setStoredTheme } from '@/lib/theme';

interface Props {
  role: UserRole;
  theme: ThemeMode;
  onThemeChange: (t: ThemeMode) => void;
}

export const ThemeToggle: React.FC<Props> = ({ role, theme, onThemeChange }) => {
  const cycle = () => {
    const order: ThemeMode[] = role === 'retailer'
      ? ['wabi', 'light', 'dark']
      : ['dark', 'light', 'wabi'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setStoredTheme(role, next);
    onThemeChange(next);
  };

  const icon = theme === 'dark'
    ? <Moon size={16} />
    : theme === 'light'
    ? <Sun size={16} />
    : <Leaf size={16} />;

  const label = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Wabi';

  return (
    <button
      onClick={cycle}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
        bg-secondary text-secondary-foreground hover:opacity-80 border border-border"
      title="Toggle theme"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
};
