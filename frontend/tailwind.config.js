import tailwindAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          card: "var(--bg-card)",
          hover: "var(--bg-card-hover)"
        },
        border: {
          subtle: "var(--border-subtle)",
          default: "var(--border-default)",
          accent: "var(--border-accent)"
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          muted: "var(--text-muted)"
        },
        accent: "var(--accent)"
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "monospace"],
        sans: ["'Inter'", "sans-serif"]
      },
      boxShadow: {
        panel: "0 16px 40px rgba(0, 0, 0, 0.35)"
      }
    },
  },
  plugins: [tailwindAnimate],
};

