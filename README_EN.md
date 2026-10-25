# dsh-session-beautify

**Session beautifier** — custom appearance for the session rows in the DeepSeek Harness (DSH) sidebar.

Per session, set the title's **colour / text glow / font weight / text shadow**. Styles are stored in the local browser and survive a reload.

---

## What it does

- Right-click any session row → the menu gains a **「自定义外观」** (*Customize appearance*) entry
- A dialog offers colour (preset swatches / a native picker / three RGB channels), a glow slider, a font-weight choice, a shadow toggle, and a live preview
- 「完成」 applies immediately; 「清除自定义」 restores the original look
- Styles are stored **per session** and never bleed into one another
- The style table is persisted in `localStorage` under `dsh.sessionBeautify.styling.v1`

## How it works

DSH draws the sidebar's session rows itself. This plugin does not replace the sidebar and does not re-implement the tree. It does three things:

1. Registers a menu row on the host's session menu seat (`sidebar.workspaces.session.menu.item`)
2. Mounts the dialog on the `shell.overlay` seat — never inside the menu row, because a session menu row unmounts with its menu
3. Writes the style onto the **host's own row element** as an inline style

Step 3 relies on the stable handle the host puts on every row:

```
div.sessionRow[data-row-key="session:<id>"]
  ├─ [0] status dot
  ├─ [1] title      ← the style goes here
  ├─ [2] timestamp
  ├─ [3] pinned marker
  └─ [4] action strip
```

Only the title is styled, so the timestamp and the status dot keep their own colours.

The host re-renders the sidebar whenever the session list changes, which replaces the row elements and drops the inline style. A `MutationObserver` repaints them — but only when a session row actually enters the DOM, and only when at least one session carries a custom style.

## Install

> ⚠️ **Do not use `dsh plugin add`, and do not run `pnpm install` afterwards.**
> The plugin manager command fails with `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED`;
> and `pnpm install` recomputes `node_modules` from the lockfile, which reverts the
> `link:` symlinks to the registry versions.

### Manual registration (three places — miss any one and the next `pnpm install` drops it)

**1. `~/.dsh/profiles/<profile>/package.json`** — both fields:

```json
{
  "dependencies": {
    "dsh-session-beautify": "link:/absolute/path/to/dsh-session-beautify"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "...the existing bundles stay as they are...",
        "dsh-session-beautify"
      ]
    }
  }
}
```

**2. `~/.dsh/profiles/<profile>/pnpm-lock.yaml`**, in the `importers` section:

```yaml
      dsh-session-beautify:
        specifier: link:/absolute/path/to/dsh-session-beautify
        version: link:../../plugins/dsh-session-beautify
```

**3. `~/.dsh/profiles/<profile>/node_modules/dsh-session-beautify`** — a **relative** symlink
into the plugin directory:

```bash
cd ~/.dsh/profiles/desktop/node_modules
ln -s ../../../plugins/dsh-session-beautify dsh-session-beautify
```

Then restart DSH. **Do not run `pnpm install`.**

### Verify after installing

1. Reload the page.
2. The right-click menu of any session row should now offer **「自定义外观」**.
3. Pick a colour and press 「完成」 — that session's title changes colour, and it stays
   that way after a reload.

If the page says "Failed to load plugins", one of the three places above was missed.

## Use

1. Right-click a session in the sidebar
2. Pick 「自定义外观」
3. Adjust colour / glow / weight / shadow — the preview below updates live
4. Press 「完成」

## Deliberately not implemented

| Not done | Why |
|---|---|
| Icon | the leading cell of a session row is the official status dot (waiting / running / done) — there is no icon slot |
| Font outline | a text stroke bleeds into the neighbouring timestamp and needs an extra CSS rule to stay readable |
| Theme-adaptive colours | the stored value is a fixed hex, so a light/dark switch keeps the same hue |
| A global default appearance | a session either has its own style or has none |
| Cross-device sync | the style table is deliberately browser-local; two devices keep two independent sets |

## Development

```bash
npm test        # 31 cases: the appearance model (pure) + the bundle contract (vm sandbox)
```

- `tests/core.test.js` — pure logic: the style model, normalisation rules, colour maths, writing a style onto the DOM
- `tests/bundle.test.js` — bundle contract: only whitelisted platform modules are required, the seats have the right shape, a missing service does not break the plugin

## Licence

[MIT](./LICENSE)
