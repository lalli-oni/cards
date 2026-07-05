import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Consumed by both `@sveltejs/vite-plugin-svelte` (at build/dev time) and
// `svelte-check` (for type-checking `.svelte` files). Without this file
// svelte-check cannot locate the Svelte configuration and errors out on every
// component before type-checking them — so real component type errors go
// unreported.
export default {
  preprocess: vitePreprocess(),
};
