/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Up/down colors are driven by CSS variables so the US dashboard
        // can swap them at the container level (`.market-us` → green-up/
        // red-down Western convention), without touching every component.
        'tw-up':   'rgb(var(--tw-up)   / <alpha-value>)',
        'tw-down': 'rgb(var(--tw-down) / <alpha-value>)',
        'tw-at': '#FFB020',
        'dash-bg': '#0D1117',
        'card-bg': '#161B22',
        'card-hover': '#1C2128',
        'border-c': '#30363D',
        'text-p': '#E6EDF3',
        'text-s': '#8B949E',
        'text-t': '#484F58',
        'accent': '#58A6FF',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [],
}
