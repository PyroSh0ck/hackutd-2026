# Hackathon component scaffold

This is an additive component kit, not a replacement for your Next.js project. It includes the complete discussed UI set, form wrappers, patterns, layouts, a working gallery, and interaction tests. It does not change auth, Prisma, logging, routes, or your existing AppShell. These are functional neutral scaffolds, not finished custom artwork.

## Advanced expansion

All twelve additional patterns are now included in `src/components/advanced/`. Start with [docs/ADVANCED.md](docs/ADVANCED.md) for their integration, behavior, and limits, and `examples/advanced-gallery.tsx` for working demos.

## Install in your project

1. Commit your existing work first so the addition is easy to review.
2. From your project root run:

   ```sh
   pnpm add radix-ui@1.8.1 lucide-react@1.67.0
   ```

3. Merge this archive's `src/components/` into your existing `src/components/`. Review any same-named files before replacing them. The archive does not contain `app-shell.tsx`. Do NOT copy this kit's package.json, package-lock.json, tsconfig.json, or Vitest configuration into your project. Those belong to the standalone verification harness.
4. Copy `examples/component-gallery.tsx` into an `examples/` folder at your project root. Its relative imports already point at `src/components/`.
5. If desired, create `src/app/playground/ui/page.tsx` containing:

   ```tsx
   import { ComponentGallery } from "../../../../examples/component-gallery";

   export default function Page() {
     return <ComponentGallery />;
   }
   ```

   Visit `/playground/ui`. This is a development gallery, not a product screen. Remove the route before shipping if you do not want it publicly available. You can also render ComponentGallery in an existing development page instead.

6. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` in your project. Then visually check the gallery at mobile and desktop widths. Existing screens do not adopt these components automatically: replace their inline controls incrementally.

CSS modules are imported by the components. No global stylesheet change or Tailwind plugin is required. `public/art/buttons/` is a suggested location for future artwork, not a required dependency.

## Included

| Group                   | Components                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| Core                    | Button, Input, Textarea, Label, Spinner                            |
| Surfaces and feedback   | Card, Badge, Alert, Skeleton, Separator                            |
| Selection               | Checkbox, Switch, Select, RadioGroup                               |
| Overlays and navigation | Dialog, AlertDialog, Tabs, DropdownMenu, Tooltip                   |
| Data display            | Avatar, Progress, Table, Pagination                                |
| Forms                   | TextField, TextareaField, FormActions                              |
| Patterns                | EmptyState, ErrorState, SearchToolbar, StatCard                    |
| Layouts                 | PageHeader, ListLayout, DetailLayout, DashboardLayout, SplitLayout |

Each public component exports a `ComponentNameProps` type in its own file. `docs/API.md` lists the exact types. Imports can use the group barrel or the component directly:

```tsx
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/forms/text-field";
```

## Who owns handlers and state?

Components handle DOM wiring, label relationships, loading presentation, and the shared interaction rules. Native controls handle standard input behavior; Radix handles modal focus, menu navigation, tabs, tooltip interaction, and avatar fallback.

Feature components own values and async operations. Selection controls, tabs, and dialogs are controlled: pass the current value and its setter. Button does not guess whether a Promise is in flight; supply `loading` explicitly. Business callbacks should catch their own async failures and display the error.

```tsx
const [enabled, setEnabled] = useState(false);
<Switch label="Notifications" checked={enabled} onCheckedChange={setEnabled} />;

const [open, setOpen] = useState(false);
<Dialog
  triggerText="Edit"
  title="Edit project"
  description="Update project details."
  open={open}
  onOpenChange={setOpen}
>
  <ProjectForm />
</Dialog>;
```

For AlertDialog, `onConfirm` runs your handler but deliberately does not close immediately. Set `loading` while the request runs, pass an `error` when it fails, and call `setOpen(false)` only after success. This prevents a failed deletion from silently closing the confirmation. Cancel and Escape cannot close it while loading.

## React Hook Form integration

Input, Textarea, TextField, and TextareaField support native `name`, `onChange`, `onBlur`, and `ref`, so `register()` can be spread onto them. They do not own a second copy of field state.

```tsx
<TextField
  label="Name"
  {...register("name")}
  error={errors.name?.message}
/>
<TextareaField
  label="Description"
  {...register("description")}
  error={errors.description?.message}
/>
<FormActions loading={formState.isSubmitting} submitText="Create project" />
```

Place those inside your existing `<form onSubmit={handleSubmit(onSubmit)}>`.
For Select, Checkbox, Switch, and RadioGroup, use your form library's Controller or explicitly connect value and change callbacks. Checkbox's `"indeterminate"` state is visual/mixed state; clicking emits a boolean. Do not combine `value` and `defaultValue` on the same input or switch between controlled and uncontrolled values.

## Design changes tomorrow

- `src/components/ui/ui.module.css`: shared component styles, button variants, artwork positioning, focus, disabled, and reduced-motion behavior.
- `src/components/layouts/kit-layouts.module.css`: responsive layout rules.
- `src/components/ui/icon.tsx`: approved functional icon names.
- `button.tsx` contains a decorative `buttonArt` span. Replace it with your own artwork components if variants require different markup. Preserve the actual button's props/ref and keep decorative overlays noninteractive.
- CSS tokens have fallbacks: `--ui-primary`, `--ui-on-primary`, `--ui-surface`, `--ui-text`, `--ui-muted`, `--ui-border`, `--ui-danger`, `--ui-focus`, `--ui-radius`. Set overrides at `:root` so portaled overlays receive them too.
- The scaffold uses light defaults; it does not automatically follow your app's dark-mode background. Design a complete matching palette before enabling dark mode.
- No consumer-facing className/style/size props. Dynamic business values such as progress are allowed. Layout and design choices remain in shared code.
- Protruding artwork may be clipped by an ancestor with overflow hidden/auto; reserve space in your layout. Different art aspect ratios may require a markup change.
- Loading keeps the existing button text by default. A different `loadingText` or spinner can change its width. If exact width stability matters for your artwork, define that in shared CSS.

## Intentional scope choices

- Select uses native HTML selection for reliable basic keyboard/mobile behavior. Native option popups are controlled by the OS and cannot be fully hand-drawn. Replace its internals with a custom selection primitive later if your design requires that; its public API can remain unchanged.
- Tooltip is a dedicated text help trigger, not a wrapper around arbitrary children. This avoids losing primitive handlers when a strict Button does not forward unknown props. If later supporting arbitrary triggers, implement a private primitive-compatible adapter rather than expanding the generator API.
- Dialog/AlertDialog own their trigger; DropdownMenu owns its trigger and menu items. Their native triggers currently share button CSS, but not Button's decorative span. When adding artwork, update these trigger visuals too or extract a private shared button presentation layer. Do not blindly use a strict Button with Radix `asChild`: it must forward injected event and accessibility props.
- Table is an accessible display table, not a data grid. Search, sorting, server pagination, selection, and fetching remain feature logic. Pagination uses one-based pages and previous/next controls; zero results display as page 1 of 1.
- Card/layout children and Table cell callbacks are composition slots, not a sandbox. TypeScript reduces accidental misuse; it cannot prevent Claude from editing source or passing arbitrary JSX. Your future generator should validate approved slots and props separately.
- No generic action registry, generators, JSON schema, API integration, or business handlers are included. These components are the reusable foundation for that next phase.

## Validation

The standalone harness uses React 19.3.0, TypeScript 5.9.3, Radix 1.8.1, Lucide 1.67.0 and Vitest 5.1.0. Install with `npm ci`, then `npm run typecheck` and `npm test` from this kit directory. These harness files do not replace your project's pnpm setup.

Tests cover loading and external form submission, field descriptions/errors, controlled selection callbacks, dialog Escape/focus return, confirmation close ownership, keyboard tabs and menus, pagination boundaries, table empty state, avatar fallback, and rendering the full gallery. jsdom tests do not prove visual layout or real-browser rendering. Your full app build/database tests require your local dependencies and environment and were not run here.
