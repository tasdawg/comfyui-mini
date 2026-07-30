# ComfyUI Mini - Style Reference

## Setup

- **Tailwind**: `<script src="https://cdn.tailwindcss.com"></script>` (CDN, no build step)
- **Viewport meta**: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no` (no pinch-to-zoom on mobile)
- **Font fallback stack**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`

## Color Palette

| Token | Hex | Usage |
|---|---|---|
| Background | `#000000` | `<body>` base |
| Card | `#121212` | `.compact-card`, toggle bar, scrollbar thumb bg |
| Surface | `#09090b` | Headers, inputs, terminal panel, loading overlay |
| Border / Divider | `#27272a` (zinc-800) | Card borders, header border-b, separators |
| Hover border | `#3f3f46` (zinc-700) | `.compact-card:hover`, scrollbar thumb |
| Input bg | `#09090b` | `.input-dark` background |
| Input text | `#e4e4e7` (zinc-200) | `.input-dark` default |
| Focus ring | `#3b82f6` (blue-500) | `.input-dark:focus` border |
| Text primary | `#d4d4d8` (zinc-300) | `<body>`, headings |
| Text secondary | `#a1a1aa` (zinc-400) | Labels, muted text, terminal log |
| Text tertiary | `#52525b` (zinc-500) | Uppercase labels, status dots inactive |
| White overlay | `rgba(255,255,255,.05)` / `bg-white/5` | Card header backgrounds |

### Accent Colors

| Purpose | Hex | Class |
|---|---|---|
| Primary action (Roll) | `#2563eb` → hover `#3b82f6` | `.bg-blue-600`, `.hover\:bg-blue-500`, `.active\:scale-95` |
| Destructive / Stop | `#dc2626` → hover `#ef4444` | `.bg-red-600`, `.hover\:bg-red-500` |
| Success / Save / WS online | `#16a34a` → hover `#22c55e` | `.bg-green-600/700`, `.hover\:bg-green-600` |
| Warning / Terminal warn | amber/yellow | `.text-yellow-400` (terminal only) |

## Typography

- **Body size**: `text-xs` (~12px) on `<body>`; most UI text is `text-[10px]` or `text-[9px]`.
- **Headings / labels**: `font-semibold` to `font-bold`, `uppercase tracking-tight` (or `tracking-wider` for nav links, `tracking-widest` for status badges).
- **Terminal log font**: `'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace`; size `9.5px`, line-height `1.6`.
- **Input text font**: `font-sans` (body stack), size `text-[10px]` or `text-[9px]`.

## Layout Structure

### Page Shell
```html
<body class="w-full flex flex-col overflow-hidden text-xs">
  <header class="h-10 shrink-0 ... bg-[#09090b] z-50">   <!-- fixed nav -->
  <main   class="flex-1 overflow-y-auto p-2 pb-[8rem] relative w-full space-y-2">
    <!-- terminal overlay at bottom via #terminal-container (z-51) -->
```

### Headers (all pages share this pattern)
- `h-10 shrink-0 flex items-center justify-between px-3 border-b border-[#27272a] bg-[#09090b] z-50`
- Left: `<div class="flex items-center gap-2">` → status dot + title
- Right: `<div class="flex items-center gap-3 shrink-0">` → nav links, buttons

### Status Dot (WS connection indicator)
- `w-2 h-2 rounded-full bg-red-500 shadow-sm shrink-0 transition-all duration-300`
- JS toggles to `bg-green-500` on WS open, back to red on close.

## Components

### `.compact-card` (main content card)
```css
background-color: #121212;
border: 1px solid #27272a;
border-radius: 8px;
display: flex;
flex-direction: column;
position: relative;
min-height: 100px;
transition: all 0.2s;          /* home.html */
```
Hover variants:
- default (`index.html`, `automation.html`): `.compact-card:hover { border-color: #3f3f46 }`
- home grid: `hover:border-blue-500/50 bg-[#18181b]`

**Inside a card:**
- Header area: `px-3 py-1.5 bg-white/5 border-b border-[#27272a] flex justify-between items-center shrink-0`
- Body area: `p-3 space-y-3 flex-1 overflow-y-auto custom-scrollbar` or `p-3 flex flex-col flex-1 overflow-y-auto custom-scrollbar gap-2` (when textarea present)

### `.input-dark` (form inputs)
```css
background-color: #09090b;
border: 1px solid #27272a;
color: #e4e4e7;
transition: all 0.2s;
```
- `focus`: `border-[#3b82f6] outline-none`
- Textarea variant (`.textarea.input-dark` or `.flex.flex-col.flex-1.min-h-\[60px\]`): `flex: 1; resize: none; height: 100%`
- Select dropdowns get a custom SVG chevron injected via JS inline style (`background-image` + `no-repeat` at right 8px center).
- Dynamic state colors on inputs during image upload:
  - Disabled/uploading: `.opacity-50.cursor-not-allowed`
  - Success (DONE): `.border-orange-500.text-orange-200`
  - Error: `.border-red-500.ring-1.ring-red-500/50`

### Edit-mode card variants
- `border-dashed border-zinc-600` → dashed outline, lighter zinc color
- Hidden node (edit mode): `.opacity-40.grayscale.border-red-900/30`

### Group header bar
- Orange-tinted: `px-3 py-1.5 bg-orange-900/20 border-b border-orange-500/30 flex justify-between items-center shrink-0`
- Group title text: `.text-[10px].font-bold.text-orange-200/70.uppercase.tracking-widest`

### Buttons (standard)
Pattern used across all pages:
```html
<button class="bg-{color}-600 hover:bg-{color}-500 active:scale-95 text-white font-bold py-1 px-3 rounded shadow transition-all flex items-center gap-1 text-[10px] tracking-wider uppercase">
  <span>ROLL / SAVE UI / STOP</span>
</button>
```
- `active:scale-95` gives a press-down feel on touch devices.
- `shadow` is the default Tailwind shadow (`shadow-md`).

### `.edit-btn` (small action buttons in edit mode)
```css
p-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors;
```
Used for move ▲▼ and Hide/Show toggles.

### Separator / divider line between sections
`<div class="h-px bg-zinc-800 my-4 mx-2"></div>` — used to visually separate groups from standalone nodes.

## Image Thumbnails (standalone)

- Container: `absolute top-3 left-3 z-20 image-thumb-container` (overrides right-side placement in edit mode to avoid overlap with move/hide controls)
- Size: `width:48px;height:48px;object-fit:cover;border-radius:6px;border:1.5px solid #3f3f46;cursor:pointer;background:#09090b;display:block`
- On click → opens fullscreen modal via `openModal()`.
- On 404 error → hidden (`display:none`) and a red "Not Found" overlay appears over the input element.

## Image Thumbnails (inside Groups)

- Container: `absolute top-2 left-2 z-10` with `[data-group-thumb-for="nodeId:key"]` attribute
- Size: `width:36px;height:36px` (smaller than standalone)
- Same border/cursor/background as standalone.
- Same 404 handling pattern with red overlay indicator on the input element.

## Node Resizer Handle (edit mode)
- Position: bottom of card, full width
- Style: `h-6 w-full bg-zinc-800/50 border-t border-zinc-700/50 cursor-ns-resize flex items-center justify-center hover:bg-zinc-700 transition-colors shrink-0 touch-none`
- Visual indicator inside: `<div class="w-8 h-1 bg-zinc-500/50 rounded-full"></div>`

## Terminal Console (collapsible)

### Container (`#terminal-container`)
```css
position: fixed; bottom: 0; left: 0; right: 0; z-index: 51;
padding-bottom: env(safe-area-inset-bottom, 0px); /* iOS notch */
@media (max-height: 500px) { display: none !important; } /* hide on very short viewports */
```

### Toggle bar (`#terminal-toggle`)
- Position: `absolute top:-18px left:50% transform:-translateX(-50%)` → floats above the panel
- Size: 40×18px, half-circle (rounded-top only), pulled up so user can drag it open
```css
border-radius: 10px 10px 0 0; background:#121212; border:1px solid #27272a; border-bottom:none;
color:#52525b; cursor:pointer; user-select:none; -webkit-tap-highlight-color:transparent;
touch-action:manipulation; transition:background 150ms,color 150ms; z-index:52;
```
- Hover: `#18181b` background, `#a1a1aa` text.

### Panel (`#terminal-panel`)
- Background: `#09090b`, top border `#27272a`, flex column, max-height 280px, overflow hidden
- Transition on `max-height`: `200ms ease` (smooth open/close)

### Header bar (`#terminal-header`)
```css
height:30px; padding:0 10px; display:flex; align-items:center; justify-content:space-between;
border-bottom:1px solid #27272a; user-select:none; -webkit-tap-highlight-color:transparent; touch-action:manipulation;
```

### Title + status dot
- `.term-title`: `font-size:10px font-weight:600 color:#52525b letter-spacing:.08em uppercase` with a flex row gap of 6px
- Status dot (`.term-dot`): 6×6px circle, transitions bg-color + box-shadow on state change. Green = online, red = offline.

### Log area (`#terminal-log`)
```css
padding:4px 8px; overflow-y:auto; flex:1; min-height:0; max-height:230px;
font-family:'SF Mono',Consolas,'Liberation Mono',Menlo,monospace; font-size:9.5px; line-height:1.6;
color:#a1a1aa; -webkit-overflow-scrolling:touch; overscroll-behavior:contain;
```

### Log lines (`.term-line`)
- `white-space:pre-wrap word-break:break-all padding:0 2px border-radius:2px`
- Hover: `rgba(39,39,42,.5)` background
- Color classes applied dynamically via `TERM_COLORS = { info:'text-blue-400', success:'text-emerald-400', warn:'text-yellow-400', error:'text-red-400', progress:'text-zinc-500' }`

### Clear button (`.term-clear-btn`)
```css
text-[9px] text-zinc-600 hover:text-zinc-400 uppercase font-bold tracking-wider transition-colors px-1.5 py-0.5 rounded bg-zinc-800/50;
```

## Modal (fullscreen image viewer)

```css
position:fixed inset-0 z-[100] bg-black/95 backdrop-blur hidden flex items-center justify-center p-2 opacity-0 transition-opacity duration-300;
```
- Close button: `absolute top-4 right-4 z-[101] bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors`
- Image: `max-w-full max-h-full object-contain`

## Scrollbars (WebKit)

```css
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
```

## Utility Patterns Used in JS

### Text status indicators (upload progress / DONE / ERR)
- Default: `.text-[9px].font-bold.text-zinc-500.ml-2.hidden`
- Success: `.text-[9px].font-bold.text-orange-500.ml-2` (then cleared after 2s timeout)
- Error: `.text-[9px].font-bold.text-red-500.ml-2`

### Style selector chips (selected Fooocus styles)
```css
bg-blue-900/40 border border-blue-800 text-blue-100 px-1.5 py-0.5 rounded text-[9px] flex items-center gap-1 cursor-pointer hover:bg-red-900/40 hover:border-red-800 transition-colors;
```

### Style modal (openStyleModal)
- Overlay: `.fixed.inset-0.z-\[100\].bg-black/95.flex.flex-col.p-4.animate-in.fade-in.duration-200`
- Header inside modal: `.flex.justify-between.items-center.mb-4.border-b.border-zinc-800.pb-2`
- Search input: `w-full.input-dark.rounded.p-2.mb-4.text-sm.outline-none`
- Grid of styles: `.flex-1.overflow-y-auto.grid.grid-cols-2.gap-2.content-start.pb-10`
- Selected style card: `.bg-blue-900/20.border.border-blue-600`
- Unselected style card: `.bg-zinc-900.border.border-zinc-800.hover\:bg-zinc-800`

### Automation step cards (automation.html)
- Header background: `bg-[#18181b] px-3 py-2 border-b border-[#27272a] flex justify-between items-center`
- Step number badge: `.step-number.bg-zinc-800.text-zinc-400.text-[9px].px-1.5.rounded`
- Running state indicator: `<span class="animate-pulse text-blue-400 text-[9px]">● RUNNING</span>`
- Done status: `<span class="text-green-400 text-[9px]">✔ DONE</span>`

### Automation "result image" container (`.renderResultImage`)
```css
relative w-full h-48 bg-zinc-900 rounded mb-4 group overflow-hidden border border-zinc-800;
```
- Download button: `absolute top-2 right-2 bg-black/60 hover:bg-blue-600 text-white p-1.5 rounded backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100`
- Generating status: `absolute top-2 right-2 bg-black/40 text-blue-200 px-2 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider backdrop-blur-sm animate-pulse`

### Automation connected-input/output labels (orange arrows)
```css
text-orange-500.font-bold.mr-1   /* "→" label */
text-orange-500.font-bold.ml-1   /* "←" label */
```

## Touch / Mobile Specifics

- `touch-action: manipulation` on interactive elements (header, toggle bar) to suppress double-tap-zoom.
- `-webkit-tap-highlight-color: transparent` removes the tap highlight rectangle.
- `user-select: none` on non-editable header/title bars.
- `env(safe-area-inset-bottom)` applied to terminal container bottom padding for iPhone notch handling.
- Terminal auto-hides via `@media (max-height: 500px) { display: none !important }`.

## JS Style Helpers (app.js exports used by automation.js too)

| Function | Purpose |
|---|---|
| `createInputDOM(node, key, val, def)` | Returns `{ dom }` with class `w-full.input-dark.rounded.p-1.5.text-[10px].font-sans.outline-none.appearance-none.cursor-pointer`; applies custom SVG chevron background-image for selects |
| `createStyleSelector(node, key, val, stylesList)` | Builds the chip/tag UI for Fooocus style selection (returns a wrapped DOM node) |
| `handleImageUpload(nodeId, inputKey, statusElement, inputElement, onSuccessCallback)` | Upload flow: sets `.opacity-50.cursor-not-allowed` while uploading → `.border-orange-500.text-orange-200` on success → `.text-red-500` on error. Updates both standalone and group thumbnails on completion. |
| `openModal(src)` / `setupModalListeners()` | Fullscreen image modal (shared across pages) |
