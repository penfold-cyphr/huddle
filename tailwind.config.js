/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // Make sure it scans your JSX files
  ],
  theme: {
    extend: {
      // Add the Open Sans font family
      fontFamily: {
        sans: ['"Open Sans"', 'sans-serif'], // Set Open Sans as the default sans-serif font
      },
      // You can add custom colors, fonts, etc. here if needed later
      colors: {
        // Example custom colors if needed for specific accents
        'huddle-blue': '#2563EB', // Example blue
        'huddle-gray': {
          '100': '#F3F4F6', // Light gray background
          '500': '#6B7280', // Medium gray text
          '800': '#1F2937', // Darker gray
        }
      },
      boxShadow: {
         'up': '0 -4px 6px -1px rgb(0 0 0 / 0.1), 0 -2px 4px -2px rgb(0 0 0 / 0.1)',
      }
    },
  },
  plugins: [],
}
