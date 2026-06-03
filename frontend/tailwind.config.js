/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        // Brand palette — uses DEFAULT keys so they MERGE with Tailwind's
        // built-in color scales (e.g. `text-amber` → brand DEFAULT, but
        // `text-amber-500`, `bg-indigo-50`, etc. still resolve to Tailwind's
        // default scale and don't get purged).
        paper: '#FAFAF7',
        ink: '#0A0A0A',
        graphite: '#525252',
        amber: { DEFAULT: '#D97706' },
        moss: { DEFAULT: '#0F766E' },
        indigo: { DEFAULT: '#1E1B4B' },
        // Shadcn semantic tokens
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        }
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        },
        'ticker-up': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '15%': { transform: 'translateY(0)', opacity: '1' },
          '85%': { transform: 'translateY(0)', opacity: '1' },
          '100%': { transform: 'translateY(-100%)', opacity: '0' },
        },
        'pulse-dot': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.85' },
          '50%': { transform: 'scale(1.6)', opacity: '0' },
        },
        'fade-rise': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'shipment-flow': {
          '0%': { transform: 'translateX(-8px)', opacity: '0' },
          '20%': { opacity: '1' },
          '80%': { opacity: '1' },
          '100%': { transform: 'translateX(calc(100% + 8px))', opacity: '0' },
        },
        'shimmer-slow': {
          '0%, 100%': { transform: 'translate(0,0) rotate(0deg)', opacity: '0.6' },
          '50%': { transform: 'translate(8px,-12px) rotate(2deg)', opacity: '0.85' },
        },
        'float-y': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'orbit-spin': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'rise-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-dot': 'pulse-dot 2s ease-out infinite',
        'fade-rise': 'fade-rise 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'marquee': 'marquee 38s linear infinite',
        'shipment-flow': 'shipment-flow 3.4s ease-in-out infinite',
        'shimmer-slow': 'shimmer-slow 7s ease-in-out infinite',
        'float-y': 'float-y 6s ease-in-out infinite',
        'orbit-spin': 'orbit-spin 22s linear infinite',
        'rise-in': 'rise-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
};
