import { existsSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const libraryBuildDir: string = new URL("../../library/build", import.meta.url).pathname;
if (!existsSync(`${libraryBuildDir}/all.json`)) {
  throw new Error(
    `Card library not built (missing ${libraryBuildDir}/all.json).\n` +
      `Run \`bun library/build.ts\` from the repo root, then retry.`,
  );
}

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      "@library": libraryBuildDir,
      "node:fs": new URL("./src/stubs/node-fs.ts", import.meta.url).pathname,
      "node:path": new URL("./src/stubs/node-path.ts", import.meta.url).pathname,
    },
  },
});
