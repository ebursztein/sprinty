import typography from "@tailwindcss/typography";

export default {
  darkMode: "class",
  content: ["./src/dashboard/ui/**/*.{html,ts,svelte}"],
  theme: {
    extend: {
      colors: {
        sprinty: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
          950: "#082f49",
        },
      },
      typography: () => ({
        zinc: {
          css: {
            "--tw-prose-body": "#3f3f46",
            "--tw-prose-headings": "#18181b",
            "--tw-prose-links": "#0284c7",
            "--tw-prose-code": "#0369a1",
            "--tw-prose-invert-body": "#d4d4d8",
            "--tw-prose-invert-headings": "#fafafa",
            "--tw-prose-invert-links": "#7dd3fc",
            "--tw-prose-invert-code": "#bae6fd",
          },
        },
      }),
    },
  },
  plugins: [typography],
};
