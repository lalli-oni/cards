import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Consumed by both `@sveltejs/vite-plugin-svelte` (at build/dev time) and
// `svelte-check` (for type-checking `.svelte` files). Without this file
// svelte-check cannot locate the Svelte configuration and errors on every
// component, silently bypassing component type-checking.
export default {
  preprocess: vitePreprocess(),
};
