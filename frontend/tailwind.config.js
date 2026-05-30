/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        atlas: {
          bg: '#0b0d12',
          surface: '#11141b',
          border: '#1f2430',
          text: '#e6e8ef',
          muted: '#8a93a6',
          accent: '#5eead4',
          positive: '#34d399',
          negative: '#f87171',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
