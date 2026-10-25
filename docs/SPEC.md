# SPEC — `dsh-session-beautify`

Technical contract of the plugin: what it relies on in the host, what it owns itself, and where the boundaries are.

---

## 1. Host facts this plugin depends on

Every fact here was read out of the installed DSH client bundle
(`DeepSeek Harness.app/Contents/Resources/app.asar` →
`@deepseek-ai/dsh-client-ui-workspace/lib/client.js`) or observed on a live host.

### 1.1 The session row handle

The host renders every session row with a stable, id-bearing attribute:

```js
// dsh-client-ui-workspace/lib/client.js:2274-2277
jsx("div", {
  ref: rowRef,
  "data-row-key": `session:${node.id}`,
  className: clsx(Rows_module_css_default.sessionRow, ...),
  role: "treeitem",
  ...
})
```

`data-row-key` is the **only** id-bearing attribute on the row. The class names are
CSS-module hashes (`JoiKIa_sessionRow`, `JoiKIa_title`, …) and change with the
host's build, so they are never used.

### 1.2 The row's child sequence

The row's children are always emitted in this order (`client.js:2304-2353`):

| index | element | note |
|---|---|---|
| 0 | `span.slot` | the leading cell: the official status dot, or the `sidebar.session.row.leading` slot |
| 1 | `span.title` | the session title |
| 2 | `span.time` | the relative timestamp (not on blank rows) |
| 3 | `span.pinIndicator` | only on pinned rows |
| last | `span.rowActions` | the hover action strip (not on blank rows) |

**The title is therefore always `children[1]`.** The plugin checks that the child
is a `SPAN` before writing to it, so a host version that reshuffles the row makes
the plugin paint nothing rather than colour the wrong cell.

### 1.3 The host already renders a timestamp

The host renders the session's `updatedAt` as a compact relative time in the
`span.time` cell (`client.js:2318-2322`), styled `font-size:10px` with the
tertiary label colour, and hidden while the row is hovered (the hover action
strip takes its place).

**Consequence for this plugin:** the host owns the timestamp cell, and the plugin
does not touch it. The plugin only styles `children[1]`, so the timestamp keeps
the host's own colour and the plugin never competes with it.

### 1.4 The seats this plugin occupies

| Seat | Kind | Registration |
|---|---|---|
| `sidebar.workspaces.session.menu.item` | list | `id: "session-beautify.appearance"`, `order: 450`, `locale: NS` |
| `shell.overlay` | list | `id: "session-beautify.overlays"`, `locale: NS`, `store: dialogSeat` |

Both are list slots, so both entries carry a non-empty `id`. The menu seat's
props are `{ sessionId, displayTitle }` plus the inherited `useMenuOpenState` and
`t` — **there is no `updatedAt` in them**, which is why the plugin never needs
it.

### 1.5 How the client bundle is served

The host lists the plugin in the boot manifest and serves the browser half from:

```
/plugins/??<comma-separated package list>/client.js&rev=<content hash>
```

Observed on a live host:

```
/plugins/??dsh-session-beautify/client.js&rev=d793cba6cc97   →  200, 36325 bytes
```

The `??` prefix and the trailing `&rev=` are literal parts of that URL form, not
a query string in the usual sense. The `rev` is a content hash: the host
recomputes it when the file changes, and the browser is expected to pick the new
revision up.

### 1.6 The platform module table

The client bundle may only `require` from this frozen table (enforced by the
host's client module system):

```
react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis,
@deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
@deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit
```

This plugin requires exactly three: `react`, `@deepseek-ai/dsh-client-store`,
`@deepseek-ai/dsh-client-ui-primitives`. `tests/bundle.test.js` asserts it.

---

## 2. What this plugin owns

### 2.1 The style model

A stored entry per session id:

```ts
{ color?: string, glow?: number, weight?: number, shadow?: boolean }
```

Two rules, both asserted in `tests/core.test.js`:

- **The fields are independent.** A user who only picks a weight gets the weight;
  the colour is not a gate. (The upstream plugin this was modelled on had the
  colour as a gate — that bug was not copied.)
- **A glow needs a colour.** A glow has no colour of its own, it borrows the text
  colour, so `normalizeEntry` drops a glow that has no colour to borrow. Keeping
  it would store a style that can never be applied and would come back as a
  phantom setting the next time the dialog opens.

### 2.2 Two stores, on purpose

| Store | Persisted | Holds |
|---|---|---|
| `styling` | `dsh.sessionBeautify.styling.v1` | the style table |
| `dialog` | — | the open dialog and its draft |

The host's store writes the **whole** state to `localStorage` on every change
once a `persist` key is present. Persisting the dialog state would resurrect a
half-open dialog after a reload, so the dialog lives in a store without a
`persist` key. The style table is small and stable, so it is the only thing that
goes to disk.

### 2.3 Painting

`paintRow(row, entry)` writes `color` / `font-weight` / `text-shadow` as inline
properties on the title element, after clearing whatever it wrote there before
(so 「清除自定义」 really clears).

A `MutationObserver` on `document.body` repaints rows when the host re-renders
the sidebar. It is deliberately narrow:

- it returns immediately unless at least one session carries a custom style;
- it only reacts to added nodes that belong to a session row.

When the plugin is torn down the observer is stopped and every row's inline style
is removed, so the host's rows go back to looking untouched.

---

## 3. Deliberate non-goals

| Not done | Reason |
|---|---|
| Replacing the sidebar | the plugin never takes the `sidebar.workspaces` seat; it only decorates what the host draws |
| An icon for a session row | the leading cell is the official status dot |
| Font outline | a text stroke bleeds into the timestamp cell and needs an extra reset rule |
| Theme-adaptive colours | a stored value is a fixed hex |
| A global default appearance | a session either has its own style or has none |
| Cross-device sync | would require a host-side settings service (a schemastery `Config`), which this plugin deliberately does not have |

---

## 4. Failure modes and what happens

| Situation | Behaviour |
|---|---|
| The `slots` service never arrives | the plugin registers nothing and does not throw; the host's sidebar is untouched |
| The `locale` service never arrives | the plugin falls back to its own built-in translator |
| The host renames `data-row-key` | the plugin paints nothing and logs one warning to the console naming the attribute it looked for |
| The host reshuffles the row's children | `titleElementOf` refuses a child that is not a `SPAN`; nothing is painted |
| The browser has no `localStorage` | the host's store already degrades; the styles simply do not survive a reload |
| The plugin is unloaded | the observer stops and the inline styles are removed |

---

## 5. Test layers

| File | Technique | Covers |
|---|---|---|
| `tests/core.test.js` | pure functions, plus a fake DOM | the style model, normalisation, colour maths, `titleElementOf`, `paintRow`, dictionary key parity |
| `tests/bundle.test.js` | the real bundle in a `node:vm` sandbox with a stub loader | the module id, the platform-module whitelist, the seat registrations and their kinds, inertness without services, the two stores' persistence |
| `tests/helpers.js` | — | the loader harness, the React / primitives / store stubs, the fake DOM |

There is no React render test: the dialog is a thin wrapper over the pure model,
and `tests/core.test.js` covers the model directly.
