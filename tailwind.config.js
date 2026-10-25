/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Clean white surfaces, periwinkle blue from the character reference,
        // deep navy from her dress. No yellow/beige cast in the paper.
        white: '#FFFFFF',
        sky: {
          50: '#F6F7FC',
          100: '#ECEFF8',
          200: '#D8DCF0',
          300: '#BAC2E6',
          400: '#9CA3D4',
          500: '#7C8FD0',
          600: '#5967A0',
          700: '#3B4474',
          800: '#323962',
          900: '#293054',
          950: '#1D2340',
        },
        slate: {
          50: '#F8F9FC',
          100: '#F1F2F7',
          200: '#E4E6EF',
          300: '#CDD2DF',
          400: '#9BA3B7',
          500: '#727A8F',
          600: '#575F74',
          700: '#41495C',
          800: '#2D3443',
          900: '#1D2430',
          950: '#121821',
        },
        aqua: {
          300: '#A5E1F5',
          400: '#7CC8EA',
          500: '#4FB3D9',
          600: '#2E93BC',
        },
      },
      animation: {
        'bounce': 'bounce 1s infinite',
      },
      keyframes: {
        bounce: {
          '0%, 100%': {
            transform: 'translateY(-25%)',
            animationTimingFunction: 'cubic-bezier(0.8, 0, 1, 1)',
          },
          '50%': {
            transform: 'translateY(0)',
            animationTimingFunction: 'cubic-bezier(0, 0, 0.2, 1)',
          },
        },
      },
    },
  },
  plugins: [],
}
