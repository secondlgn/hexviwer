/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#1e1e1e",
        "panel-light": "#252526",
        "panel-lighter": "#2d2d30",
        border: "#3e3e42",
        accent: "#007acc",
        "accent-hover": "#1a8ad8",
        "text-primary": "#cccccc",
        "text-secondary": "#858585",
        "text-hover": "#ffffff",
        "selection-bg": "#264f78",
        "highlight-bg": "#623208",
      },
      fontFamily: {
        mono: ['"Cascadia Code"', '"Consolas"', '"Courier New"', "monospace"],
      },
      fontSize: {
        xxs: ["10px", "14px"],
      },
    },
  },
  plugins: [],
};
