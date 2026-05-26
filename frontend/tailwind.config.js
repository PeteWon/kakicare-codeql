/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Calm teal — primary brand colour for KakiCare.
        primary: {
          50: '#f0fbfa',
          100: '#d6f3f0',
          200: '#aee7e2',
          300: '#7ed4cd',
          400: '#4bbab2',
          500: '#2f9d96', // base primary
          600: '#247d79',
          700: '#206562',
          800: '#1d5150',
          900: '#1b4443',
          950: '#0a2727',
        },
        // Warm cream / off-white surfaces.
        cream: {
          DEFAULT: '#faf6ee',
          50: '#fdfbf6',
          100: '#faf6ee',
          200: '#f3ebda',
          300: '#e9dcc1',
        },
      },
      fontFamily: {
        // Serif for headings, clean sans for body.
        serif: ['Lora', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
};
