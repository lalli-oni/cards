import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      "@library": new URL("../../library/build", import.meta.url).pathname,
      "node:fs": new URL("./src/stubs/node-fs.ts", import.meta.url).pathname,
      "node:path": new URL("./src/stubs/node-path.ts", import.meta.url).pathname,
    },
  },
});
