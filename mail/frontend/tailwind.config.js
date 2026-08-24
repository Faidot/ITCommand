/** @type {import('tailwindcss').Config} */
export default {
  // Enable class-based dark mode: we toggle the `dark` class on <html>.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // TeraFort brand palette — orange accent on dark/white.
        primary: '#f97316', // brand orange (links, focus, accents)
        'primary-dark': '#ea580c',
        'primary-light': '#ffedd5',
        // Dark surfaces (sidebar / dark buttons) — matches the logo backdrop
        ink: '#15161b',
        'ink-soft': '#23252e',
        // Accent: unread dots, stars, important, active states
        accent: '#f97316',
        'accent-soft': '#ffedd5',
        // Unread count chip (brand orange)
        badge: '#f97316',
        // App background (light) — warm neutral
        canvas: '#f7f5f1',
        // Sidebar / panel surface (light)
        sidebar: '#ffffff',
        // Unread / error red
        unread: '#d93025',
        // Dark theme surfaces
        'dark-canvas': '#15161b',
        'dark-surface': '#1c1d24',
        'dark-elevated': '#262833',
        'dark-border': '#33353f',
      },
      fontFamily: {
        sans: ['Inter', 'Roboto', 'Arial', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        window: '1.75rem',
      },
      boxShadow: {
        compose: '0 8px 10px 1px rgba(0,0,0,0.14), 0 3px 14px 2px rgba(0,0,0,0.12), 0 5px 5px -3px rgba(0,0,0,0.2)',
        window: '0 30px 80px -20px rgba(20, 20, 25, 0.35), 0 10px 30px -10px rgba(20, 20, 25, 0.2)',
      },
    },
  },
  plugins: [],
};
