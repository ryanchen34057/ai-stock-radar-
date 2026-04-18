/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'tw-up': '#FF3B3B',
        'tw-down': '#00C851',
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
