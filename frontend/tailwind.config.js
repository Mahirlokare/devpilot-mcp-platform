/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "rgb(var(--c-bg) / <alpha-value>)",
          panel: "rgb(var(--c-panel) / <alpha-value>)",
          raised: "rgb(var(--c-raised) / <alpha-value>)",
          border: "rgb(var(--c-border) / <alpha-value>)",
          subtle: "rgb(var(--c-subtle) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "#14b8a6",
          dim: "#0d9488",
          soft: "rgba(20, 184, 166, 0.14)",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ['"Plus Jakarta Sans"', "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgba(15, 23, 42, 0.06)",
        soft: "0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 8px 24px -4px rgba(15, 23, 42, 0.08), inset 0 1px 0 0 rgba(255, 255, 255, 0.05)",
        glow: "0 0 0 1px rgba(20, 184, 166, 0.28), 0 12px 32px -8px rgba(20, 184, 166, 0.22), inset 0 1px 0 0 rgba(255, 255, 255, 0.12)",
        elevated: "0 4px 20px -2px rgba(0, 0, 0, 0.25), inset 0 1px 0 0 rgba(255, 255, 255, 0.07)",
      },
    },
  },
  plugins: [],
};
