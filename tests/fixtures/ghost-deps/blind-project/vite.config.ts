import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@legacy": "/some/path",
    },
  },
});
