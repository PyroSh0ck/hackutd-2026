# visual-design/ — designer-owned

Everything that controls how the app *looks* lives here. Everything that controls how it
*behaves* (props, state, accessibility, refs) lives in `src/components/**`, which imports
these files through the `@visual/*` alias. Your edits show up live in the app and in
`/playground` during `pnpm dev`.

| File | Controls |
| --- | --- |
| `tokens.css` | Colors, radius, focus color (`--ui-*` custom properties) |
| `ui.module.css` | Core components: button variants, inputs, cards, dialogs, tables, etc. |
| `advanced.module.css` | Advanced components: navigation, upload, chat, charts, carousel, toast, etc. |
| `layouts.module.css` | PageHeader / List / Detail / Dashboard / Split layout spacing |
| `button-art.tsx` | Decorative artwork inside every Button (per `variant`) |

Rules that keep generated features working:

- Keep existing class names (e.g. `.button`, `.field`, `.card`). Components reference them.
  Adding new classes is fine; renaming/removing one requires a matching change in `src/components`.
- Decorative art must stay `aria-hidden` and `pointer-events: none`.
- Put art images in `public/art/` and reference them from CSS (`url('/art/...')`).
- Claude and the feature generator never edit this folder.
