/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#131313",
        surface: "#131313",
        "surface-dim": "#131313",
        "surface-bright": "#393939",
        "surface-container-lowest": "#0e0e0e",
        "surface-container-low": "#1c1b1b",
        "surface-container": "#201f1f",
        "surface-container-high": "#2a2a2a",
        "surface-container-highest": "#353534",
        "surface-variant": "#353534",
        "surface-tint": "#6ab7ff",
        primary: "#6ab7ff",
        "primary-container": "#1f4f7a",
        "primary-fixed": "#cfe8ff",
        "primary-fixed-dim": "#8fc7ff",
        "on-primary": "#0a2335",
        "on-primary-container": "#cfe8ff",
        "on-primary-fixed": "#0a2335",
        "on-primary-fixed-variant": "#1f4f7a",
        secondary: "#8fc7ff",
        "secondary-container": "#214a6c",
        "secondary-fixed": "#cfe8ff",
        "secondary-fixed-dim": "#8fc7ff",
        "on-secondary": "#0e2a3f",
        "on-secondary-container": "#cfe8ff",
        "on-secondary-fixed": "#0e2a3f",
        "on-secondary-fixed-variant": "#214a6c",
        tertiary: "#6ab7ff",
        "tertiary-container": "#214a6c",
        "tertiary-fixed": "#cfe8ff",
        "tertiary-fixed-dim": "#8fc7ff",
        "on-tertiary": "#0e2a3f",
        "on-tertiary-container": "#cfe8ff",
        "on-tertiary-fixed": "#0e2a3f",
        "on-tertiary-fixed-variant": "#214a6c",
        error: "#ffb4ab",
        "error-container": "#93000a",
        "on-error": "#690005",
        "on-error-container": "#ffdad6",
        outline: "#9a8c9b",
        "outline-variant": "#4e4350",
        "on-surface": "#e5e2e1",
        "on-surface-variant": "#d1c2d2",
        "on-background": "#e5e2e1",
        "inverse-surface": "#e5e2e1",
        "inverse-on-surface": "#313030",
        "inverse-primary": "#1f4f7a",
        graphite: {
          900: "#0b0c10",
          850: "#11131a",
          800: "#141720",
          750: "#1d2029",
          700: "#252934",
          600: "#343848",
          500: "#4c5164"
        }
      },
      boxShadow: {
        glow: "0 20px 50px rgba(0, 0, 0, 0.45)",
        accent: "0 0 35px rgba(255, 97, 199, 0.3)"
      },
      backgroundImage: {
        accent:
          "linear-gradient(135deg, #ff61c7 0%, #b55bff 35%, #4c7bff 70%, #39d6ff 100%)"
      },
      fontFamily: {
        headline: ["Noto Serif", "serif"],
        body: ["Manrope", "sans-serif"],
        label: ["Manrope", "sans-serif"]
      }
    }
  },
  plugins: []
};
