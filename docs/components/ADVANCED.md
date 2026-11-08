# Advanced components

All twelve planned additions are in `src/components/advanced/`. No new dependency is required beyond the original kit's Radix and Lucide packages. Import from a component file or `@/components/advanced`.

## Install the expansion

If you installed the first kit, copy `src/components/advanced/` and `examples/advanced-gallery.tsx`. Keep your existing project configuration. The original kit components are also included in this archive for a fresh install.

To preview, create `src/app/playground/advanced/page.tsx`:

```tsx
import { AdvancedGallery } from "../../../../examples/advanced-gallery";
export default function Page() {
  return <AdvancedGallery />;
}
```

The gallery's uploads and streaming chat are explicitly local simulations. They do not persist files or call an AI service. Remove development gallery routes before deployment if they should not be public.

## Inventory and state ownership

| Component                  | Included behavior                                                                                  | Supplied by feature                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| AppNavigation              | Desktop links, responsive mobile drawer, current-page indication, account menu                     | Links, active item ID, account action callbacks                                    |
| FileUpload                 | File selection/drop, type/size/count checks, image previews, progress, cancel, retry, removal      | Async upload callback honoring AbortSignal; actual storage/auth/backend validation |
| Combobox                   | Local filtering, keyboard selection, disabled options, hidden form value                           | Options, selected value, change callback                                           |
| ToastProvider/useToast     | Notifications, dismissal, timed expiry, Radix hover/focus pause behavior                           | Success/error/info messages                                                        |
| Stepper                    | Back/continue, per-step async validation, busy guard, error handling, final callback               | Step contents, validation, field state, completion handler                         |
| Drawer                     | Modal side panel, focus trap, Escape, trigger focus return                                         | Open state, title, description, content                                            |
| Accordion                  | Multiple expandable sections, keyboard navigation                                                  | Items, optional initially open IDs                                                 |
| DataTable                  | Local text filtering, numeric/text sorting, pagination, page selection, row actions, loading/error | Rows, columns, row keys, selection state, actions                                  |
| Chart                      | Line, bar, donut SVG charts, empty/error/loading states, exact data table                          | Data values, labels, title, kind                                                   |
| ImageCarousel              | Previous/next, indicators, keyboard on region, touch swipe, image loading/error/retry              | Images, alt text, optional index callback                                          |
| DatePicker/DateRangePicker | Native date controls, min/max, calendar string values, inverted-range warning                      | Controlled date values, submission validation                                      |
| ChatPanel                  | Conversation rendering, draft, send/error handling, streaming/stop UI, safe citation links         | Messages, streaming updates, send/stop/retry callbacks                             |

All exact types are in API.md and exported beside their components. Styles are in `advanced.module.css`, except shared Button, DropdownMenu, Checkbox, Progress and TextField styles that stay in `ui.module.css`.

## Upload adapter

```tsx
<FileUpload
  label="Documents"
  accept=".pdf,.txt"
  maxFiles={5}
  maxBytes={10 * 1024 * 1024}
  onUpload={async (file, { signal }) => {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/uploads", {
      method: "POST",
      body,
      signal,
    });
    if (!response.ok) throw new Error("Upload failed. Try again.");
  }}
/>
```

That endpoint is an example contract, not an included route. Fetch does not supply upload progress here, so progress remains indeterminate until completion. An XMLHttpRequest or storage SDK adapter may call `onProgress(percentage)`. Honor the supplied signal and release adapter listeners when finished. Canceling does not guarantee the server rolls back an upload already received. Remove only removes the local queue entry; it does not delete a stored file. Capture returned storage IDs in your feature if needed. Client accept/size checks are convenience validation; enforce actual type, size, ownership, and authorization on the server too. No automatic bulk uploader/concurrency policy is included.

## Notifications

Wrap a client subtree with ToastProvider once. Call useToast within that subtree:

```tsx
const notify = useToast();
notify({ title: "Project saved", tone: "success" });
```

It retains at most five visible notifications. Errors needing user action should also remain inline rather than existing only in an expiring toast.

## Guided forms

Stepper validates the current step before advancing. Return an error string to stay on the step; return undefined to proceed. Throwing is also caught and displayed. Final onComplete can be async; failures keep the last step open. The feature should show its completion screen or navigate after success. The stepper keeps hidden steps mounted to preserve fields; do not wrap the whole stepper in a native validated form with required hidden fields. Use controlled feature state or your form library and its validation callback. This is a sequential wizard, not freely clickable step navigation. Keep step IDs/order stable while a user is completing it.

## Search and tables

Combobox is single-select and filters already-loaded options. It is not an async search client, multi-select, or virtualized list. Empty string represents no selection. Its keyboard interaction includes arrows, Enter, Escape, and normal Tab traversal. Use a Controller to connect it to React Hook Form.

DataTable operates on the entire rows array you supply. Provide searchValue or sortValue for searchable columns. Sorting compares numbers numerically and strings with localeCompare. Selection stores stable row keys supplied by the feature; filtering/paging preserves selected IDs, including ones not on the visible page. Parent code should prune IDs if rows are permanently removed. Do not use this local pagination wrapper for server-paged datasets without changing its data contract. It is intended for modest hackathon datasets, not huge virtualized grids.

## Charts and carousel

Chart supports one numeric series, with categorical labels in input order. No zooming, multiple axes, stacking, or interactive legends are included. Donut values must be nonnegative and have a positive total; nonfinite values are excluded. Prefer a small number of labels to avoid overlap. Edit the internal palette and CSS to change appearance. Exact values remain in an expandable table. Native SVG titles provide basic hover labels, not a rich tooltip system.

Carousel uses contain framing and no autoplay, infinite looping, zoom/lightbox, or arbitrary JSX slides. Image IDs must be unique. initialIndex is read on mount; use a key to intentionally reset it with a completely new collection. Arrow keys operate when the carousel region itself is focused, leaving button keyboard behavior native. Inspect touch swipes and image loading in a real browser before the demo.

## Dates

Values use YYYY-MM-DD strings, or empty string. Native browser/OS calendar popups cannot be fully restyled. Range values remain under parent control; inverted values produce an inline warning rather than silently changing the other endpoint. Validate dates and range order again during submission. These controls do not include time, timezone conversion, blocked-date lists, or a custom calendar grid.

## Chat integration

The parent appends user/assistant messages and updates the assistant text as stream chunks arrive. ChatPanel does not perform a network request or parse a provider protocol. onSend may return a promise and should reject on failure; the composer preserves the draft on failure. If it resolves immediately while a stream continues, the parent must keep streaming=true until completion. onStop should abort the actual network request and clear streaming. onRetry must implement retry behavior in the feature. Citation URLs allow only absolute HTTP/HTTPS links. Message text is rendered as plain text, never raw HTML or markdown. Scrolling stays under user control; automatic scrolling, attachments, markdown, and message virtualization are not included.

## Before the hackathon

Run your app's typecheck, lint, and tests after merging. Open both galleries at desktop and mobile widths. Exercise mobile navigation, dialog focus, combobox keyboard interaction, upload failure/cancel, image failure/swipes, date controls, and chat stop. The standalone tests use jsdom; they do not substitute for those real-browser checks or your actual backend tests.
