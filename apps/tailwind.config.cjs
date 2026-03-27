/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
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
      }
    }
  },
  plugins: []
};
