import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works from any subpath (e.g. GitHub Pages).
  base: "./",
  publicDir: "../../public",
  worker: {
    format: "es",
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
