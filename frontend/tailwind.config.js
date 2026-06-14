/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // Tailwind looks here for your className="..."
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}