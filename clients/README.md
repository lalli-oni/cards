# Clients

Game clients that integrate with `cards-engine`. Each client is a workspace under `clients/`.

## web (cards-web)

Default web client for two-player hotseat playtesting.

- **Stack**: Svelte 5 (runes), Vite 6, Tailwind CSS v4, TypeScript
- **Persistence**: `idb-keyval` (IndexedDB) for saving/loading game sessions
- **Engine integration**: Imports `cards-engine` as workspace dependency. Card definitions loaded via Vite JSON import from `library/build/all.json`.
- **Browser stubs**: `node:fs` and `node:path` are aliased to browser stubs in `vite.config.ts` because the engine barrel-exports filesystem functions the web client never calls.

### Dev

```sh
bun library/build.ts        # prerequisite: generate card JSON
cd clients/web
bun run dev                  # vite dev server
bun run build                # production build
```

### Architecture decisions

| Decision | Rationale |
|---|---|
| Svelte 5 runes, no SvelteKit | SPA with no routing needs. Engine state maps directly to `$state`. |
| Tailwind CSS v4 | Rapid styling even for playtest UI; avoids verbose scoped CSS for layout/spacing/typography. |
| No component library | Playtest UI — functional over polished. Fewer deps, full control. |
| No drag-and-drop | Action list clicks are clearer for playtesting. Add in a polish pass. |
| No state management lib | Engine + `$state` rune is the entire state model. |
| `idb-keyval` for persistence | Tiny (~600B), async IndexedDB wrapper. Avoids localStorage size limits and main-thread blocking for large session action logs. |
| Unicode/text labels for icons | Swap in `lucide-svelte` later if needed. |
