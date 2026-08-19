import type { Config } from "tailwindcss";

// Same tokens as IT Command so the two apps read as one product family.
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        border: "hsl(var(--border))",
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)" },
    },
  },
  plugins: [],
};
export default config;
