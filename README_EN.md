# dsh-session-beautify

**Session and workspace beautifier** — custom appearance for the session rows and workspace rows in the DeepSeek Harness (DSH) sidebar.

Per session and per workspace, set the **colour / text glow / font weight / text shadow** of the title or the workspace name. Styles are stored in the local browser and survive a reload.

---

## What it does

- Right-click any session row → the menu gains a **「自定义外观」** (*Customize appearance*) entry
- Right-click any workspace row (a project folder in the sidebar) → the same menu entry and the same dialog
- A dialog offers colour (preset swatches / a native picker / three RGB channels), a glow slider, a font-weight choice, a shadow toggle, and a live preview
- 「完成」 applies immediately; 「清除自定义」 restores the original look
- Styles are stored **per session and per workspace** and never bleed into one another (keyed by id, so renaming a workspace keeps its colour)
- The style table is persisted in `localStorage` under `dsh.sessionBeautify.styling.v1`

## How it works

DSH draws the sidebar's rows itself. This plugin does not replace the sidebar and does not re-implement the tree. It does four things:

1. Registers a menu row on the host's session menu seat (`sidebar.workspaces.session.menu.item`)
2. Registers a workspace menu contribution through the shared `contextMenus` capability (target kind `workspace`)
3. Mounts the dialog on the `shell.overlay` seat — never inside the menu row, because a session menu row unmounts with its menu
4. Writes the style onto the **host's own row element** as an inline style

Step 4 relies on the stable handles the host puts on every row. The two row shapes differ, and so does the position of the label:

```
div.sessionRow[data-row-key="session:<id>"]        div.projectRow[data-row-key="workspace:<workspaceId>"]
  ├─ [0] status dot                                  ├─ [0] folder glyph
  ├─ [1] title      ← session style goes here        ├─ [1] expand chevron
  ├─ [2] timestamp                                   ├─ [2] name cell > [0] name  ← workspace style goes here
  ├─ [3] pinned marker                               └─ [3] action strip
  └─ [4] action strip
```

Only the label is styled, so the timestamp, the status dot and the folder glyph keep their own colours.

The host re-renders the sidebar whenever the session list changes, which replaces the row elements and drops the inline style. A `MutationObserver` repaints them — but only when a session row or workspace row actually enters the DOM, and only when at least one row carries a custom style.

The workspace menu entry sits at `order: 250`: after 重命名 (100) and 在应用中打开 (200), before 删除 (300). `contextMenus` is a **nested injection**, so a host without that service loses only the workspace entry — session styling keeps working.

## Install

### From GitHub (recommended)

```bash
dsh plugin --profile <profile> add github:chuilian/dsh-session-beautify
```

You can also enter the same source in the Web GUI's plugin manager. Reload the page
after installing.

### From a source directory (development)

```bash
git clone https://github.com/chuilian/dsh-session-beautify.git
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-session-beautify
```

With `link:`, the registration lives in three places — miss any one and the next
`pnpm install` drops it:

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
cd ~/.dsh/profiles/<profile>/node_modules
ln -s ../../../plugins/dsh-session-beautify dsh-session-beautify
```

Check all three, then restart DSH.

> ⚠️ **Do not run `pnpm install` in the same profile afterwards.**
> It recomputes `node_modules` from the lockfile, which reverts the `link:` symlinks
> to the registry versions. If your plugin manager reports
> `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED` (the `minimumReleaseAge` policy
> without a `no handleResolutionPolicyViolations` callback), register the three places
> above by hand instead.

### Verify after installing

1. Reload the page.
2. The right-click menu of any session row should now offer **「自定义外观」**.
3. Pick a colour and press 「完成」 — that session's title changes colour, and it stays
   that way after a reload.
4. Right-click a **workspace row** — the same 「自定义外观」 entry is
   there, and the workspace name changes colour.

If the page says "Failed to load plugins", one of the three places above was missed.


## Use

1. Right-click a session or a workspace row in the sidebar
2. Pick 「自定义外观」
3. Adjust colour / glow / weight / shadow — the preview below updates live
4. Press 「完成」 (「清除自定义」 restores the host look)

## Deliberately not implemented

| Not done | Why |
|---|---|
| Icon | the leading cell of a session row is the official status dot (waiting / running / done) — there is no icon slot |
| Font outline | a text stroke bleeds into the neighbouring timestamp and needs an extra CSS rule to stay readable |
| Theme-adaptive colours | the stored value is a fixed hex, so a light/dark switch keeps the same hue |
| A global default appearance | a session either has its own style or has none |
| Cross-device sync | the style table is deliberately browser-local; two devices keep two independent sets |
| A tinted workspace row | only the name is styled, so the row's hover and selection backgrounds stay the host's own |

## Development

```bash
npm test        # 44 cases: the appearance model (pure) + the bundle contract (vm sandbox)
```

- `tests/core.test.js` — pure logic: the style model, normalisation rules, colour maths, writing a style onto the DOM
- `tests/bundle.test.js` — bundle contract: only whitelisted platform modules are required, the seats have the right shape, a missing service does not break the plugin

## Licence

[MIT](./LICENSE)
