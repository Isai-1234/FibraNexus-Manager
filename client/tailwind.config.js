export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'rgb(var(--bg-primary) / <alpha-value>)',
          card: 'rgb(var(--bg-secondary) / <alpha-value>)',
          raised: 'rgb(var(--bg-tertiary) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--text-primary) / <alpha-value>)',
          soft: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
        },
        line: 'rgb(var(--border) / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
