# Stipt. Local — Styleguide

A self-contained reference for the visual design system used by Stipt. Local. Copy the foundations and component recipes into a fresh project and the result will look and feel identical.

---

## Overview

- **Token-driven.** All visual properties (color, spacing, radius, shadow, transition) flow from CSS custom properties on `:root`. Components reference tokens — not raw values.
- **Dual-theme.** Light is the default; dark is enabled by setting `data-theme="dark"` on `<html>`. The same tokens get redefined under that selector, so every component switches automatically.
- **Typography.** Satoshi (loaded from Fontshare) is the UI typeface. A monospace stack (`SF Mono` → `Fira Code` → `Cascadia Code`) is reserved for digit-heavy displays where character alignment matters.
- **Brand accent.** Cyan `#00a5d9` (slightly brighter `#29BCE8` in dark mode) is the single primary color. There is no secondary accent — variety comes from neutrals plus three semantic states (success / warning / error).
- **Universal transition.** `200ms ease` for almost every state change. A few specific surfaces (timers, progress rings) use longer linear durations.
- **Accessibility.** `:focus-visible` produces a 2px primary outline with 2px offset on every interactive element. Cursor `pointer` on every clickable surface.

---

## Quick-start

To adopt the system in a new project:

1. Drop the `:root` and `[data-theme="dark"]` blocks from [Color tokens](#color-tokens) into the top of your stylesheet.
2. Add the Fontshare `<link>` from [Typography](#typography) to your HTML `<head>`.
3. Add the [theme toggle script](#theme-system) to `<head>` (so it runs before paint and avoids a flash).
4. Apply the [Reset & base](#reset--base) styles.
5. Pick the components you need from [Components](#components) and copy their CSS + HTML snippets.

---

## Foundations

### Color tokens

Drop both blocks at the top of your stylesheet.

```css
:root {
  --color-bg:            #FAF8F3;  /* page background — warm off-white */
  --color-surface:       #FFFFFF;  /* cards, panels, dialogs */
  --color-surface-alt:   #F2EDE4;  /* secondary surface (table headers, hover, code tiles) */
  --color-border:        #E4DDD1;  /* default 1px border */
  --color-border-strong: #C9C0B2;  /* emphasis border */
  --color-text:          #1C1916;  /* primary text */
  --color-text-secondary:#5C5650;  /* labels, muted body */
  --color-text-tertiary: #918980;  /* captions, placeholders, disabled */
  --color-primary:       #00a5d9;  /* brand accent */
  --color-primary-hover: #0090bf;  /* primary button hover */
  --color-primary-light: #E3F6FC;  /* primary tint (focus glow, highlight bg) */
  --color-success:       #16A34A;
  --color-success-bg:    #DCFCE7;
  --color-warning:       #D97706;
  --color-warning-bg:    #FEF3C7;
  --color-error:         #DC2626;
  --color-error-bg:      #FEE2E2;

  --text-xs:   0.75rem;   /* 12px — labels, captions, badges */
  --text-sm:   0.8125rem; /* 13px — small UI, table cells */
  --text-base: 0.9375rem; /* 15px — body, default */
  --text-lg:   1.0625rem; /* 17px — section titles */
  --text-xl:   1.25rem;   /* 20px — page titles */
  --text-2xl:  2rem;      /* 32px — display digits */

  --space-1:  0.25rem;  /* 4px */
  --space-2:  0.5rem;   /* 8px */
  --space-3:  0.75rem;  /* 12px */
  --space-4:  1rem;     /* 16px — default padding */
  --space-5:  1.25rem;  /* 20px */
  --space-6:  1.5rem;   /* 24px — section gap */
  --space-8:  2rem;     /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px — empty state */

  --radius-sm: 6px;   /* icon buttons, small chips */
  --radius:    10px;  /* default — cards, inputs, buttons */
  --radius-lg: 16px;  /* dialogs, large panels */
  --radius-xl: 24px;  /* reserved */

  --shadow-sm: 0 1px 3px rgba(0,0,0,.07), 0 1px 2px rgba(0,0,0,.05);
  --shadow:    0 4px 12px rgba(0,0,0,.08), 0 2px 4px rgba(0,0,0,.05);
  --shadow-lg: 0 12px 32px rgba(0,0,0,.10), 0 4px 8px rgba(0,0,0,.06);

  --transition: 200ms ease;
}

[data-theme="dark"] {
  --color-bg:            #18160F;
  --color-surface:       #221F18;
  --color-surface-alt:   #2C2820;
  --color-border:        #3A352B;
  --color-border-strong: #504840;
  --color-text:          #F2EDE4;
  --color-text-secondary:#9B9188;
  --color-text-tertiary: #6B6358;
  --color-primary:       #29BCE8;  /* brighter for dark contrast */
  --color-primary-hover: #1AAED9;
  --color-primary-light: #082D3D;
  --color-success:       #22C55E;
  --color-success-bg:    #14291E;
  --color-warning:       #F59E0B;
  --color-warning-bg:    #2A1F0A;
  --color-error:         #EF4444;
  --color-error-bg:      #2A1010;

  --shadow-sm: 0 1px 3px rgba(0,0,0,.30);
  --shadow:    0 4px 12px rgba(0,0,0,.40);
  --shadow-lg: 0 12px 32px rgba(0,0,0,.50);
}
```

### Typography

Load Satoshi from Fontshare in `<head>` (do this **before** your stylesheet so the font loads in parallel):

```html
<link rel="preconnect" href="https://api.fontshare.com">
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" rel="stylesheet">
```

Three weights are loaded: **400** (body, labels), **500** (buttons, inputs), **700** (titles, badges, display digits). A few tables use **600** for emphasis — Satoshi falls back to the closest available weight, but if you want true 600 add `600` to the URL.

**Type roles** (apply alongside the size token):

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title | `--text-xl` | 700 | `letter-spacing: -0.02em` |
| Section title | `--text-lg` | 600 | |
| Body / default | `--text-base` | 400 | `line-height: 1.6` on body |
| Small UI / button | `--text-sm` | 500 | |
| Label / caption / badge | `--text-xs` | 600–700 | Often `text-transform: uppercase` with `letter-spacing` |
| Display digits | `--text-2xl` | 700 | Use the monospace stack |

**Monospace stack** — for PIN displays, OTP boxes, countdown text, anything where digits must align:

```css
font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
font-variant-numeric: tabular-nums; /* also works on Satoshi for table figures */
```

### Spacing scale

| Token | Value | Typical use |
|---|---|---|
| `--space-1` | 4px | Icon-to-text gap, micro-spacing |
| `--space-2` | 8px | Stack gap between cards, button gap |
| `--space-3` | 12px | Compact padding, banner gap |
| `--space-4` | 16px | Default padding |
| `--space-5` | 20px | Generous horizontal button padding |
| `--space-6` | 24px | Section gap, page margin |
| `--space-8` | 32px | Large panel padding |
| `--space-10` | 40px | Wide gap inside panels |
| `--space-12` | 48px | Empty-state vertical padding |

### Radius scale

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6px | Icon buttons, small chips |
| `--radius` | 10px | **Default** — cards, inputs, buttons, banners |
| `--radius-lg` | 16px | Dialogs, hero panels |
| `--radius-xl` | 24px | Reserved |

Pills (badges, scrollbar thumbs) use a flat `border-radius: 99px`.

### Shadow scale

| Token | Light | Dark | Use |
|---|---|---|---|
| `--shadow-sm` | subtle | strong-but-soft | Topbar, card hover |
| `--shadow` | medium | deep | Hero panels |
| `--shadow-lg` | heavy | very deep | Dialogs, floating popovers |

The dark theme overrides each shadow with higher opacity so they remain visible against `--color-bg`.

### Transition

```css
--transition: 200ms ease;
```

Apply to: `background`, `color`, `border-color`, `opacity`, `box-shadow`, and SVG `stroke` / `fill`. Don't transition `transform` unless you specifically want animation — most UI doesn't need it.

Special-case durations:

| Duration | Use |
|---|---|
| `0.4s` | Color shifts that signal urgency (timer turning warning → urgent) |
| `0.5s ease` | Countdown ring stroke color swap |
| `1s linear` | Countdown ring `stroke-dashoffset` (smooth tick-down) |
| `1.4s` | Skeleton shimmer cycle |
| `0.65s linear` | Spinner rotation |

---

## Theme system

The site reads `data-theme` from the `<html>` element. To switch themes, set or remove that attribute.

```html
<html lang="en">
  <head>
    <!-- Run BEFORE the stylesheet so there's no flash of wrong theme -->
    <script>
      (function () {
        var saved = localStorage.getItem('theme');
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        var theme = saved || (prefersDark ? 'dark' : 'light');
        if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      })();
    </script>
    <link rel="stylesheet" href="/your-stylesheet.css">
  </head>
</html>
```

**Toggle handler** (wire to the theme-toggle button):

```js
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
}
```

This pattern beats `@media (prefers-color-scheme: dark)` because the user can override the system default and that choice persists. The system preference is still honored on first visit.

---

## Reset & base

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; font-size: 16px; }
body {
  font-family: 'Satoshi', system-ui, sans-serif;
  font-size: var(--text-base);
  background: var(--color-bg);
  color: var(--color-text);
  line-height: 1.6;
  min-height: 100vh;
  transition: background var(--transition), color var(--transition);
}
a { color: var(--color-primary); text-decoration: none; }
button { cursor: pointer; font-family: inherit; }
input, select { font-family: inherit; }
```

Note the `transition` on `<body>`: it makes the theme swap fade gracefully instead of snapping.

---

## Layout primitives

### Page containers

Two widths cover most screens. Use the wide one only when a table or wide grid demands it.

```css
.page-content {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-6);
}
.page-content-wide {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-6);
}
```

### Sticky topbar (no-logo version)

A neutral header with a title slot on the left and an actions slot on the right.

```css
.topbar {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-3) var(--space-6);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  box-shadow: var(--shadow-sm);
}
.topbar-actions { display: flex; align-items: center; gap: var(--space-2); }
```

```html
<header class="topbar">
  <div class="topbar-title">App name</div>
  <div class="topbar-actions">
    <button class="btn-icon" aria-label="Settings">…</button>
    <button class="theme-toggle" aria-label="Toggle theme">…</button>
  </div>
</header>
```

### Page title block

```css
.page-title {
  font-size: var(--text-xl); font-weight: 700;
  color: var(--color-text); letter-spacing: -0.02em;
  margin-bottom: var(--space-1);
}
.page-subtitle {
  font-size: var(--text-sm); color: var(--color-text-secondary);
  margin-bottom: var(--space-6);
}
.section-title {
  font-size: var(--text-lg); font-weight: 600;
  margin-bottom: var(--space-4);
}
```

---

## Components

### Buttons

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-5);
  font-size: var(--text-sm); font-weight: 500;
  border-radius: var(--radius);
  border: 1px solid transparent;
  transition: background var(--transition), color var(--transition),
              border-color var(--transition), opacity var(--transition);
  white-space: nowrap;
}
.btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }

.btn-primary { background: var(--color-primary); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--color-primary-hover); }
.btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

.btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
  border-color: var(--color-border);
}
.btn-ghost:hover { background: var(--color-surface-alt); color: var(--color-text); }

.btn-danger {
  background: var(--color-error-bg); color: var(--color-error);
  border-color: transparent;
}
.btn-danger:hover { background: var(--color-error); color: #fff; }

.btn-icon {
  width: 34px; height: 34px;
  padding: 0; border-radius: var(--radius-sm);
  background: transparent; border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  transition: background var(--transition), color var(--transition);
}
.btn-icon:hover { background: var(--color-surface-alt); color: var(--color-text); }
.btn-icon:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.btn-icon:disabled { opacity: 0.35; cursor: not-allowed; }
```

```html
<button class="btn btn-primary">Save</button>
<button class="btn btn-ghost">Cancel</button>
<button class="btn btn-danger">Delete</button>
<button class="btn-icon" aria-label="Settings"><svg>…</svg></button>
```

### Cards (clickable list tiles)

```css
.card-list { display: flex; flex-direction: column; gap: var(--space-2); }

.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: var(--space-4) var(--space-5);
  cursor: pointer;
  transition: border-color var(--transition), box-shadow var(--transition),
              background var(--transition);
}
.card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-sm); }
.card:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }

.card-title { font-weight: 600; font-size: var(--text-base); margin-bottom: 2px; }
.card-sub   { font-size: var(--text-xs); color: var(--color-text-secondary); }
```

```html
<div class="card-list">
  <div class="card" tabindex="0">
    <div class="card-title">Card title</div>
    <div class="card-sub">Supporting text</div>
  </div>
</div>
```

### Inputs

**Text input with leading icon** (search-style):

```css
.search-wrap { position: relative; margin-bottom: var(--space-4); }
.search-icon {
  position: absolute; left: var(--space-3); top: 50%; transform: translateY(-50%);
  color: var(--color-text-tertiary); pointer-events: none;
}
.search-input {
  width: 100%;
  padding: var(--space-2) var(--space-3) var(--space-2) calc(var(--space-3) + 20px + var(--space-2));
  font-size: var(--text-sm); color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  transition: border-color var(--transition), box-shadow var(--transition);
}
.search-input::placeholder { color: var(--color-text-tertiary); }
.search-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}
```

```html
<div class="search-wrap">
  <svg class="search-icon" width="16" height="16" …></svg>
  <input class="search-input" type="search" placeholder="Search…">
</div>
```

**Generic field group** (label + input):

```css
.field { display: flex; flex-direction: column; gap: var(--space-1); }
.field label { font-size: 0.85rem; font-weight: 600; }
.field input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.95rem;
}
.field input:focus { outline: 2px solid var(--color-primary); border-color: transparent; }

.optional-label { font-weight: 400; color: var(--color-text-tertiary); font-size: var(--text-xs); }

.input-unit-row { display: flex; align-items: center; gap: var(--space-3); }
.input-unit-row input { width: 90px; }
.input-unit { font-size: var(--text-sm); color: var(--color-text-secondary); }
```

**Checkbox** — colorize via `accent-color`:

```css
input[type="checkbox"] {
  accent-color: var(--color-primary);
  width: 16px; height: 16px;
  cursor: pointer;
}
```

### Segmented control

A pill-shaped 2–4 option group. Each option button shares a single rounded border; vertical dividers separate them.

```css
.score-selector {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
  width: fit-content;
}
.score-option {
  padding: var(--space-2) var(--space-5);
  font-size: var(--text-sm); font-weight: 500;
  background: transparent; border: none;
  border-right: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.score-option:last-child { border-right: none; }
.score-option:hover { background: var(--color-surface-alt); color: var(--color-text); }
.score-option.active { background: var(--color-primary); color: #fff; }
```

```html
<div class="score-selector" role="radiogroup">
  <button class="score-option" role="radio">Option A</button>
  <button class="score-option active" role="radio" aria-checked="true">Option B</button>
  <button class="score-option" role="radio">Option C</button>
</div>
```

### Modals / dialogs

Built on the native `<dialog>` element. The backdrop is a 45% black overlay; the dialog itself uses `--shadow-lg` and `--radius-lg`. Three sizes:

```css
/* Confirmation (small) */
.dialog-confirm {
  border: none; border-radius: var(--radius-lg); padding: var(--space-4);
  background: var(--color-surface); box-shadow: var(--shadow-lg);
  max-width: 400px; width: 90%;
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0;
}
.dialog-confirm::backdrop { background: rgba(0,0,0,.45); }
.dialog-confirm p { margin: 0 0 var(--space-4); color: var(--color-text); line-height: 1.5; }
.dialog-confirm .actions { display: flex; gap: var(--space-3); justify-content: flex-end; }

/* Settings / form (medium, scrollable body) */
.dialog-settings {
  border: none; border-radius: var(--radius-lg); padding: 0;
  background: var(--color-surface); box-shadow: var(--shadow-lg);
  max-width: 560px; width: 90%; max-height: 85vh;
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0;
}
.dialog-settings[open] { display: flex; flex-direction: column; }
.dialog-settings::backdrop { background: rgba(0,0,0,.45); }
.dialog-settings-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-5) var(--space-6) var(--space-4);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.dialog-settings-body {
  overflow-y: auto;
  padding: 0 var(--space-6);
  flex: 1;
}

/* Floating (no backdrop, bottom-right) */
.dialog-floating {
  position: fixed; bottom: 1rem; right: 1rem; top: auto; left: auto;
  margin: 0; padding: 0; border: none; background: transparent;
  z-index: 9999;
}
.dialog-floating::backdrop { display: none; }
.dialog-floating .card-inner {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: var(--shadow-lg);
  min-width: 320px;
}
```

```html
<dialog class="dialog-confirm" id="confirm-dialog">
  <p>Are you sure?</p>
  <div class="actions">
    <button class="btn btn-ghost">Cancel</button>
    <button class="btn btn-danger">Confirm</button>
  </div>
</dialog>
```

### Banners

```css
.banner {
  display: flex; align-items: flex-start; gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  font-size: var(--text-sm);
  margin-bottom: var(--space-4);
}
.banner-error   { background: var(--color-error-bg);   color: var(--color-error); }
.banner-warning { background: var(--color-warning-bg); color: var(--color-warning); }
.banner-close {
  margin-left: auto; flex-shrink: 0;
  background: none; border: none;
  font-size: 1.1rem; line-height: 1;
  color: inherit; opacity: 0.7; cursor: pointer;
}
.banner-close:hover { opacity: 1; }
```

```html
<div class="banner banner-error">
  <svg width="16" height="16">…</svg>
  <div>Something went wrong.</div>
  <button class="banner-close" aria-label="Dismiss">×</button>
</div>
```

### Tables

Sticky header, uppercase caps, hover row, sortable columns.

```css
.table-wrap {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.data-table {
  width: 100%; border-collapse: collapse;
  font-size: var(--text-sm);
}
.data-table thead {
  position: sticky; top: 0; z-index: 10;
  background: var(--color-surface-alt);
}
.data-table th {
  padding: var(--space-3) var(--space-4);
  text-align: left;
  font-size: var(--text-xs); font-weight: 600;
  text-transform: uppercase; letter-spacing: .06em;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}
.data-table th.sortable { cursor: pointer; user-select: none; }
.data-table th.sortable:hover { color: var(--color-text); }
.data-table th .sort-icon { margin-left: 4px; opacity: 0.5; }
.data-table th.sorted .sort-icon { opacity: 1; color: var(--color-primary); }

.data-table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--color-surface-alt); }

/* Vertical scroll for long lists */
.table-scroll { max-height: 420px; overflow-y: auto; }
```

### Status badges & chips

Pill shape, two semantic variants per state.

```css
.status-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 10px; border-radius: 99px;
  font-size: var(--text-xs); font-weight: 600; white-space: nowrap;
}
.badge-success { background: var(--color-success-bg); color: var(--color-success); }
.badge-warning { background: var(--color-warning-bg); color: var(--color-warning); }
.badge-error   { background: var(--color-error-bg);   color: var(--color-error); }
```

### Skeleton loaders

```css
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-surface-alt) 25%,
    var(--color-border) 50%,
    var(--color-surface-alt) 75%
  );
  background-size: 800px 100%;
  animation: shimmer 1.4s infinite;
  border-radius: var(--radius);
}
.skeleton-card {
  height: 64px;
  margin-bottom: var(--space-2);
}
```

```html
<div class="skeleton skeleton-card"></div>
<div class="skeleton skeleton-card"></div>
<div class="skeleton skeleton-card"></div>
```

### Empty states

```css
.empty-state {
  text-align: center;
  padding: var(--space-12) var(--space-6);
  color: var(--color-text-tertiary);
}
.empty-state svg { margin-bottom: var(--space-3); opacity: 0.5; }
.empty-state p   { font-size: var(--text-sm); }
```

```html
<div class="empty-state">
  <svg width="40" height="40" stroke-width="1.5">…</svg>
  <p>Nothing here yet.</p>
</div>
```

### Section labels

Tiny uppercase eyebrow text — useful as a sub-header above a card group.

```css
.section-label-row {
  display: flex; align-items: center;
  margin-bottom: var(--space-3);
}
.section-label {
  display: inline-flex; align-items: center; gap: var(--space-1);
  font-size: var(--text-xs); font-weight: 700;
  text-transform: uppercase; letter-spacing: .07em;
  color: var(--color-text-tertiary);
}
```

### Spinner

Small loading indicator (e.g. inside a primary button while submitting).

```css
@keyframes spin { to { transform: rotate(360deg); } }
.spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(255,255,255,.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .65s linear infinite;
}
```

The colors above are tuned for placement on `--color-primary`. Swap `#fff` and the rgba for `currentColor`-based values if you need it on a light surface.

### Theme toggle button

```css
.theme-toggle {
  width: 36px; height: 36px;
  border-radius: var(--radius-sm);
  background: none; border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  display: flex; align-items: center; justify-content: center;
  transition: background var(--transition), color var(--transition);
}
.theme-toggle:hover { background: var(--color-surface-alt); color: var(--color-text); }
.theme-toggle:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
```

```html
<button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle theme">
  <svg class="icon-sun" …></svg>
  <svg class="icon-moon" …></svg>
</button>

<style>
  .icon-moon { display: none; }
  [data-theme="dark"] .icon-sun  { display: none; }
  [data-theme="dark"] .icon-moon { display: block; }
</style>
```

---

## Specialty patterns

These are project-specific in Stipt. Local but generalize cleanly.

### OTP / PIN digit boxes

A row of fixed-size monospace tiles for displaying or entering codes.

```css
.pin-display {
  display: flex; gap: var(--space-3); align-items: center;
}
.pin-digit {
  width: 58px; height: 72px;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--text-2xl); font-weight: 700;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  background: var(--color-surface-alt);
  border: 2px solid var(--color-border);
  border-radius: var(--radius);
  color: var(--color-text);
  letter-spacing: 0;
  transition: background var(--transition), border-color var(--transition);
}
.pin-digit.active { border-color: var(--color-primary); }
```

### Countdown ring

An SVG donut where the stroke shrinks as time runs out, and its color shifts through success → warning → error.

```html
<div class="countdown-wrap">
  <svg class="countdown-svg" width="120" height="120" viewBox="0 0 120 120">
    <circle class="countdown-track" cx="60" cy="60" r="54"/>
    <circle class="countdown-ring"  cx="60" cy="60" r="54"
            stroke-dasharray="339.292" stroke-dashoffset="0"
            stroke="var(--color-success)"/>
  </svg>
  <div class="countdown-text">00:30</div>
</div>
```

```css
.countdown-wrap {
  position: relative; display: flex; align-items: center; justify-content: center;
  width: 120px; height: 120px; flex-shrink: 0;
}
.countdown-svg { transform: rotate(-90deg); }
.countdown-track {
  fill: none;
  stroke: var(--color-border);
  stroke-width: 6;
}
.countdown-ring {
  fill: none;
  stroke-width: 6;
  stroke-linecap: round;
  transition: stroke-dashoffset 1s linear, stroke 0.5s ease;
}
.countdown-text {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--text-base); font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}
```

JS sketch:

```js
const R = 54;
const CIRC = 2 * Math.PI * R;  // dasharray length

function updateRing(secondsLeft, totalSeconds) {
  const ring = document.querySelector('.countdown-ring');
  ring.style.strokeDashoffset = CIRC * (1 - secondsLeft / totalSeconds);
  ring.style.stroke =
    secondsLeft > totalSeconds * 0.5 ? 'var(--color-success)' :
    secondsLeft > totalSeconds * 0.2 ? 'var(--color-warning)' :
                                       'var(--color-error)';
}
```

### Urgency-aware timer text

A plain label that changes color as time dwindles — pair with the countdown ring or use standalone.

```css
.timer-value {
  font-size: var(--text-lg); font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
  transition: color 0.4s;
}
.timer-value.warning { color: var(--color-warning); }
.timer-value.urgent  { color: var(--color-error); }
```

---

## Iconography

- **Inline SVG only.** No icon font, no icon library. Each icon is a small `<svg>` written into the HTML.
- **Inherit color** via `stroke="currentColor"` (or `fill="currentColor"` for solid icons). The icon then automatically picks up button/text color in both themes.
- **Outline style** is the default: `fill="none"`, `stroke-linecap="round"`, `stroke-linejoin="round"`.

**Standard sizes:**

| Context | Size | Stroke width |
|---|---|---|
| In-row / inline | 14px | 2 |
| Search prefix, banner, dialog body | 16px | 2 |
| Topbar / icon button | 18px | 2 |
| Dialog close affordance | 16px | 2.5 |
| Empty state | 40px | 1.5 |

```html
<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round">
  <!-- path data here -->
</svg>
```

Lucide is a clean source of compatible SVG paths if you need icons quickly — its default attributes match this convention.

---

## Accessibility

- **Focus rings:** every interactive element gets `outline: 2px solid var(--color-primary)` with `outline-offset: 2px` on `:focus-visible`. Don't suppress it. Use the `:focus-visible` pseudo-class (not `:focus`) so it only shows for keyboard navigation.
- **Cursor:** `pointer` on cards, list items, sortable headers, score options, custom inputs.
- **Contrast:** dark theme ships brighter primary (`#29BCE8`) and brighter status colors so text on backgrounds stays readable. If you add new tokens, check both themes.
- **Hidden controls:** when toggling visibility (e.g. theme icons), use `display: none` rather than `visibility: hidden` so the hidden element doesn't capture focus.

---

## Misc

### Custom scrollbars (WebKit)

Used inside scroll containers, not the body.

```css
.scroll-area::-webkit-scrollbar       { width: 6px; }
.scroll-area::-webkit-scrollbar-track { background: transparent; }
.scroll-area::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 99px;
}
```

### Smooth anchor scrolling

```css
html { scroll-behavior: smooth; }
```

### Numeric alignment

Apply on any element that displays numbers in a vertical stack (timers, table cells of figures):

```css
font-variant-numeric: tabular-nums;
```

---

## What's not here

- **Logo / brand wordmark.** Any `topbar-brand`, `brand-wordmark-*`, or `brand-subbrand` styling from the source is intentionally omitted.
- **Project-specific business logic styling** (attendance-row layouts, score-mapping copy, end-session confirmation banners). The patterns those rely on (cards, banners, segmented controls, badges) are documented above — recombine them for your own screens.
