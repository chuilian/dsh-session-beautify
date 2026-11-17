/**
 * `dsh-session-beautify` — browser half.
 *
 * Loaded by DSH's client module system, which serves this file at
 * `/plugins/dsh-session-beautify/client.js` and executes the `load({id, factory})`
 * call below. The factory body runs lazily on first materialization, so the
 * module registers a factory and nothing here runs at parse time.
 *
 * The bundle is hand-written in DSH's lazy-CJS dialect rather than produced by
 * a bundler, which keeps the plugin dependency-free and reviewable:
 *
 * - `require` resolves only the frozen platform table (React, the store, the
 *   component primitives). Those are exactly the specifiers used below.
 * - The module exports `apply` (the Cordis plugin body) and `inject`.
 *   `inject` is deliberately `[]`: services are acquired reactively inside
 *   `apply` with `ctx.inject`, so this entry can never leave the page boot
 *   waiting on a service it names, and a deployment missing an optional service
 *   degrades instead of failing the whole GUI's boot audit.
 *
 * What it does:
 *
 * The sidebar's session rows and workspace rows are drawn by DSH itself. This
 * plugin does not replace the sidebar and does not re-implement the tree — it
 * only adds a per-row *title* style (colour, glow, font weight, text shadow),
 * once for session rows and once for workspace rows.
 *
 * - A right-click menu entry on every session row opens the appearance dialog.
 * - A right-click menu entry on every workspace row opens the same dialog
 *   through the shared `contextMenus` capability (target kind `workspace`),
 *   which is the only extension point the host offers for those rows.
 * - The dialog lives in `shell.overlay`, never inside the menu row: a session
 *   menu row unmounts with its menu, and a dialog mounted there would die with
 *   it.
 * - The chosen style is stored per row id in a persisted browser store and
 *   written onto the host's own row element as inline style. The host paints
 *   the rows, so the style has to be applied to the host's DOM; the stable
 *   handles the host puts on every row are `data-row-key="session:<id>"` and
 *   `data-row-key="workspace:<workspaceId>"`.
 * - The two row shapes differ: a session row keeps its title in `children[1]`,
 *   a workspace row in `children[2]` (the `projectText` cell) → `children[0]`.
 *   Painting the wrong cell would colour the chevron instead of the label.
 *
 * Surface it contributes:
 *
 * | Slot | Purpose |
 * |---|---|
 * | `sidebar.workspaces.session.menu.item` | 自定义外观 for session rows (order 450) |
 * | `shell.overlay` | the appearance dialog |
 * | `contextMenus` (target `workspace`) | 自定义外观 for workspace rows (order 250) |
 * | `contextMenu.icon` (key `session-beautify.appearance`) | the workspace menu glyph |
 *
 * Deliberately not implemented:
 *
 * - **Icon** — the leading cell of a session row is the official status dot
 *   (pending / running / done); there is no icon slot to fill.
 * - **Font outline** — a text stroke bleeds into the neighbouring meta cells
 *   (the timestamp), which then need a reset rule to stay readable.
 * - **Theme-adaptive colours** — a stored colour is a literal hex value, so a
 *   light/dark switch keeps the same hue rather than swapping to a tuned
 *   counterpart.
 * - **A global default appearance** — every session carries its own entry or
 *   none at all.
 *
 * @module dsh-session-beautify/client
 */

window.__ModuleLoader__.load({
  id: "dsh-session-beautify",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const clientStore = require("@deepseek-ai/dsh-client-store");

    const h = React.createElement;
    const { useState } = React;
    const { MenuItemButton, Modal, Button } = primitives;

    /** Locale namespace this plugin's dictionary is registered under. */
    const NS = "sessionBeautify";

    /** Browser-local key the style table is persisted under. */
    const STORE_KEY = "dsh.sessionBeautify.styling.v1";

    /**
     * Icon key the workspace menu action names and the `contextMenu.icon` seat
     * answers. The shared popup renders a keyed glyph (not a component prop), so
     * one key has to be shared between the contribution and the registration.
     */
    const WORKSPACE_ICON_KEY = "session-beautify.appearance";

    /** Contribution id of the workspace menu entry (unique within its target). */
    const WORKSPACE_MENU_ID = "session-beautify.workspaceAppearance";

    /**
     * The host's per-row handle prefix. Every session row the host renders
     * carries `data-row-key="session:<id>"`; that attribute is the only stable
     * way to address a row from outside the host's own render.
     */
    const ROW_KEY_PREFIX = "session:";

    /**
     * The same handle on a workspace row: `data-row-key="workspace:<workspaceId>"`.
     * Its value is the Workspace id (the tree's group key), not the path, so a
     * renamed workspace keeps its style. The ungrouped bucket's key is the bare
     * prefix (its group key is the empty string) and is never painted.
     */
    const WORKSPACE_ROW_KEY_PREFIX = "workspace:";

    /** The attribute the host puts the row handle on. */
    const ROW_KEY_ATTR = "data-row-key";

    /** Longest glow radius the dialog offers. */
    const GLOW_MAX = 14;

    /** Font weights the dialog offers. */
    const WEIGHTS = [400, 500, 600, 700];

    /** Colour swatches offered by the dialog; the first entry means "no colour". */
    const SWATCHES = [
      "",
      "#5b8def",
      "#3fb950",
      "#d29922",
      "#f85149",
      "#a371f7",
      "#39c5cf",
      "#ec6cb9",
      "#ff9f45",
      "#6e7681"
    ];

    //#region pure: appearance model

    /**
     * A stored per-session style. Every field is optional; a missing field means
     * "not set", never "reset to a default".
     *
     * @typedef {object} StyleEntry
     * @property {string} [color] - hex colour of the title text.
     * @property {number} [glow] - text-shadow blur radius in px (0..14).
     * @property {number} [weight] - font weight (400..700).
     * @property {boolean} [shadow] - drop shadow behind the text.
     */

    /**
     * Turn a stored entry into the inline style object the row title carries.
     *
     * The fields are independent on purpose: a user who only picks a font weight
     * and never touches the colour still gets the weight. (The glow is the one
     * exception — a glow has no colour of its own, it borrows the text colour,
     * so it is only emitted when there is a colour to borrow.)
     *
     * @param {StyleEntry|null|undefined} entry - the stored entry.
     * @returns {object|null} inline style, or null when nothing should be applied.
     */
    function toRowStyle(entry) {
      if (!entry || typeof entry !== "object") return null;
      const out = {};
      const color = typeof entry.color === "string" ? entry.color.trim() : "";
      if (/^#[0-9a-fA-F]{6}$/.test(color)) out.color = color;
      const weight = Number(entry.weight) || 0;
      if (weight >= 100 && weight <= 900) out.fontWeight = weight;
      const shadows = [];
      const glow = Number(entry.glow) || 0;
      if (glow > 0 && out.color) shadows.push("0 0 " + Math.min(GLOW_MAX, glow) + "px " + out.color);
      if (entry.shadow === true) shadows.push("1px 1px 2px rgba(0,0,0,.85)");
      if (shadows.length > 0) out.textShadow = shadows.join(",");
      return Object.keys(out).length > 0 ? out : null;
    }

    /**
     * Normalise an entry before it is stored: drop what is not a valid value and
     * clamp what has a range. An entry that carries nothing worth keeping
     * becomes null, which the store reads as "remove this session's style".
     *
     * @param {StyleEntry|null|undefined} entry - the draft.
     * @returns {StyleEntry|null} the storable entry, or null for "no style".
     */
    function normalizeEntry(entry) {
      if (!entry || typeof entry !== "object") return null;
      const rawColor = typeof entry.color === "string" ? entry.color.trim() : "";
      const color = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor.toLowerCase() : "";
      // A glow borrows the text colour, so a glow without a colour can never be
      // applied. Keeping it would store a style that does nothing — and would
      // come back as a phantom setting the next time the dialog opens.
      const glow =
        color === "" ? 0 : Math.max(0, Math.min(GLOW_MAX, Math.floor(Number(entry.glow) || 0)));
      const rawWeight = Number(entry.weight) || 0;
      const weight = WEIGHTS.includes(rawWeight) ? rawWeight : 0;
      const shadow = entry.shadow === true;
      if (color === "" && glow === 0 && weight === 0 && !shadow) return null;
      return { color, glow, weight, shadow };
    }

    /**
     * Parse a six-digit hex colour into its channels.
     *
     * @param {string|null|undefined} hex - the colour.
     * @returns {[number,number,number]|null} the channels, or null when unparseable.
     */
    function colorToRgb(hex) {
      if (typeof hex !== "string") return null;
      const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
      if (!match) return null;
      const value = parseInt(match[1], 16);
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }

    /**
     * Render three channels back into a six-digit hex colour.
     *
     * @param {number} r - red channel.
     * @param {number} g - green channel.
     * @param {number} b - blue channel.
     * @returns {string} the hex colour.
     */
    function rgbToHex(r, g, b) {
      const channel = (value) =>
        Math.max(0, Math.min(255, Math.round(Number(value) || 0)))
          .toString(16)
          .padStart(2, "0");
      return "#" + channel(r) + channel(g) + channel(b);
    }

    //#endregion

    //#region pure: the host's row DOM

    /**
     * Escape a value for use inside an attribute selector. Session ids are
     * ordinary identifiers in practice, but a stray quote would otherwise throw
     * a SyntaxError out of `querySelector` and take the caller down with it.
     *
     * @param {string} value - the raw value.
     * @returns {string} the escaped value.
     */
    function escapeForSelector(value) {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
      return String(value).replace(/["\\]/g, "\\$&");
    }

    /**
     * The host's row element for a session, or null when the session is not on
     * screen (or the host lays its rows out differently than expected).
     *
     * @param {string} sessionId - the session id.
     * @returns {Element|null} the row element.
     */
    function rowElementOf(sessionId) {
      if (typeof document === "undefined" || !sessionId) return null;
      try {
        return document.querySelector(
          "[" + ROW_KEY_ATTR + '="session:' + escapeForSelector(String(sessionId)) + '"]'
        );
      } catch {
        return null;
      }
    }

    /**
     * Report, once, that the host's row handle could not be found.
     *
     * The handles (`data-row-key="session:<id>"`, `data-row-key="workspace:<id>"`)
     * are what the host puts on every row. If a future host version renames one,
     * the plugin would silently stop painting — so it says so, once, instead of
     * failing quietly.
     */
    let warnedAboutMissingRows = false;

    function warnAboutMissingRows() {
      if (warnedAboutMissingRows) return;
      warnedAboutMissingRows = true;
      console.warn(
        "[dsh-session-beautify] the host's rows were not found (no [" +
          ROW_KEY_ATTR +
          '="session:<id>"] or ["' +
          ROW_KEY_ATTR +
          '="workspace:<id>"] element); the appearance styles will not be applied'
      );
    }

    /**
     * The title element inside a host session row.
     *
     * The host renders a session row as a fixed sequence of spans: the leading
     * status cell, the title, the timestamp, an optional pinned marker and the
     * hover action strip. The title is therefore always the second child. The
     * check is deliberately defensive: if a future host version reshuffles the
     * row, the plugin paints nothing rather than colouring the wrong cell.
     *
     * @param {Element|null|undefined} row - the row element.
     * @returns {Element|null} the title element, or null when it cannot be found.
     */
    function titleElementOf(row) {
      if (!row || !row.children || row.children.length < 2) return null;
      const title = row.children[1];
      if (!title || title.tagName !== "SPAN") return null;
      return title;
    }

    /**
     * The host's row element for a workspace, or null when that workspace is
     * not on screen.
     *
     * @param {string} workspaceId - the workspace id.
     * @returns {Element|null} the row element.
     */
    function workspaceRowElementOf(workspaceId) {
      if (typeof document === "undefined" || !workspaceId) return null;
      try {
        return document.querySelector(
          "[" + ROW_KEY_ATTR + '="workspace:' + escapeForSelector(String(workspaceId)) + '"]'
        );
      } catch {
        return null;
      }
    }

    /**
     * The title element inside a host workspace row.
     *
     * A workspace row is a different shape from a session row: the folder glyph,
     * the expand chevron, then a `projectText` cell that wraps the label, then
     * the hover action strip. The label is therefore the third child's first
     * child. As with {@link titleElementOf}, the check is defensive: a reshuffled
     * row makes the plugin paint nothing rather than colour the chevron.
     *
     * @param {Element|null|undefined} row - the row element.
     * @returns {Element|null} the title element, or null when it cannot be found.
     */
    function workspaceTitleElementOf(row) {
      if (!row || !row.children || row.children.length < 3) return null;
      const projectText = row.children[2];
      if (!projectText || projectText.tagName !== "SPAN") return null;
      const title = projectText.children && projectText.children[0];
      if (!title || title.tagName !== "SPAN") return null;
      return title;
    }

    /**
     * Remove the inline style this plugin wrote on a title element.
     *
     * @param {Element|null|undefined} title - the title element.
     */
    function clearRowStyle(title) {
      if (!title || !title.style || typeof title.style.removeProperty !== "function") return;
      title.style.removeProperty("color");
      title.style.removeProperty("font-weight");
      title.style.removeProperty("text-shadow");
    }

    /**
     * Write an entry's style onto one title element, replacing whatever this
     * plugin wrote there before. Title only (rather than the whole row) keeps
     * the sibling meta cells on their own host colours.
     *
     * @param {Element|null|undefined} title - the title element.
     * @param {StyleEntry|null|undefined} entry - the stored entry; null clears.
     * @returns {boolean} true when a style was applied.
     */
    function writeTitleStyle(title, entry) {
      if (!title || !title.style) return false;
      clearRowStyle(title);
      const style = toRowStyle(entry);
      if (!style) return false;
      if (style.color) title.style.setProperty("color", style.color);
      if (style.fontWeight) title.style.setProperty("font-weight", String(style.fontWeight));
      if (style.textShadow) title.style.setProperty("text-shadow", style.textShadow);
      return true;
    }

    /**
     * Write one session's style onto its host row.
     *
     * @param {Element|null|undefined} row - the row element.
     * @param {StyleEntry|null|undefined} entry - the stored entry; null clears.
     * @returns {boolean} true when a title was found and updated.
     */
    function paintRow(row, entry) {
      return writeTitleStyle(titleElementOf(row), entry);
    }

    /**
     * Write one workspace's style onto its host row.
     *
     * @param {Element|null|undefined} row - the row element.
     * @param {StyleEntry|null|undefined} entry - the stored entry; null clears.
     * @returns {boolean} true when a title was found and updated.
     */
    function paintWorkspaceRow(row, entry) {
      return writeTitleStyle(workspaceTitleElementOf(row), entry);
    }

    //#endregion

    //#region stores

    /**
     * The persisted style tables: session id -> entry, workspace id -> entry.
     *
     * One store holds both because they are the same feature seen on two row
     * shapes: the dialog, the palette and the painter are shared, only the
     * table and the DOM handle differ. `workspaceStyling` is read with a `|| {}`
     * fallback everywhere, so a snapshot persisted before the workspaces
     * feature existed still loads.
     *
     * It lives in its own store, separate from the dialog state, because the
     * host's store writes the *whole* state to localStorage on every change
     * once a `persist` key is present. Persisting transient dialog state would
     * resurrect a half-open dialog after a reload.
     */
    const stylingHandle = clientStore.defineStore({
      init: () => ({ styling: {}, workspaceStyling: {} }),
      persist: STORE_KEY,
      actions: {
        /**
         * Store or remove one session's style.
         *
         * @param {object} draft - the store draft.
         * @param {string} sessionId - the session id.
         * @param {StyleEntry|null} entry - the entry; null removes it.
         */
        setStyle: (draft, sessionId, entry) => {
          if (!draft.styling) draft.styling = {};
          if (entry === null || entry === undefined) delete draft.styling[sessionId];
          else draft.styling[sessionId] = entry;
        },
        /**
         * Store or remove one workspace's style.
         *
         * @param {object} draft - the store draft.
         * @param {string} workspaceId - the workspace id.
         * @param {StyleEntry|null} entry - the entry; null removes it.
         */
        setWorkspaceStyle: (draft, workspaceId, entry) => {
          if (!draft.workspaceStyling) draft.workspaceStyling = {};
          if (entry === null || entry === undefined) delete draft.workspaceStyling[workspaceId];
          else draft.workspaceStyling[workspaceId] = entry;
        }
      }
    });

    /** The shared styling store instance. */
    const stylingInstance = stylingHandle.create();

    /**
     * The transient dialog state. Not persisted: a reload should not reopen the
     * appearance dialog with a stale draft.
     */
    const dialogHandle = clientStore.defineStore({
      init: () => ({ dialog: null }),
      actions: {
        /**
         * Open the dialog for one row.
         *
         * @param {object} draft - the store draft.
         * @param {object} dialog - `{kind: 'session'|'workspace', targetId, displayTitle, initial}`.
         */
        setDialog: (draft, dialog) => {
          draft.dialog = dialog;
        },
        /**
         * Close the dialog.
         *
         * @param {object} draft - the store draft.
         */
        closeDialog: (draft) => {
          draft.dialog = null;
        }
      }
    });

    /** The shared dialog store instance. */
    const dialogInstance = dialogHandle.create();

    /** The registration-facing handle that pins the shared dialog instance. */
    const dialogSeat = { ...dialogHandle, create: () => dialogInstance };

    //#endregion

    //#region styles

    /** Stylesheet for the appearance dialog's controls. */
    const CSS = `
.dsh-beautify-field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.dsh-beautify-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-beautify-swatches { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsh-beautify-swatch { width: 20px; height: 20px; padding: 0; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l2); cursor: pointer; }
.dsh-beautify-swatch:hover { border-color: var(--dsw-alias-border-l3); }
.dsh-beautify-swatch[data-active="true"] { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-beautify-swatch-none { background: repeating-linear-gradient(45deg, transparent, transparent 3px, var(--dsw-alias-border-l2) 3px, var(--dsw-alias-border-l2) 4px); }
.dsh-beautify-picker { width: 24px; height: 24px; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px; background: transparent; cursor: pointer; }
.dsh-beautify-rgb { display: flex; gap: 10px; }
.dsh-beautify-rgb label { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-beautify-rgb input { width: 58px; padding: 4px 6px; border-radius: var(--dsw-radius-sm); border: 1px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; }
.dsh-beautify-slider { display: flex; align-items: center; gap: 10px; }
.dsh-beautify-slider input[type="range"] { flex: 1; }
.dsh-beautify-value { min-width: 36px; text-align: right; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-beautify-seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.dsh-beautify-seg button { padding: 4px 10px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; }
.dsh-beautify-seg button[data-active="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.dsh-beautify-preview { padding: 10px 12px; border-radius: var(--dsw-radius-md); border: 1px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); font-size: 14px; line-height: 20px; }
.dsh-beautify-actions { display: flex; gap: 8px; justify-content: flex-end; }
`;

    /**
     * Install {@link CSS} once per document.
     *
     * The tag is attributed with `data-plugin` so DSH's module system can retire
     * it when the plugin unloads, and keyed with `data-plugin-css` so a
     * re-materialization cannot double-inject it.
     */
    function injectStyles() {
      if (typeof document === "undefined") return;
      const tagId = "dsh-session-beautify/styles.css";
      if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-session-beautify";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    //#endregion

    //#region locale

    /** Chinese copy; the key set is shared with {@link en}. */
    const zh = {
      "menu.appearance": "自定义外观",
      "dialog.title": "自定义外观",
      "dialog.desc": "为这个会话的标题设置颜色、发光、粗细和阴影。设置只保存在本机浏览器里。",
      "dialog.desc.workspace": "为这个工作区的名称设置颜色、发光、粗细和阴影。设置只保存在本机浏览器里。",
      "field.color": "颜色",
      "field.glow": "文字发光",
      "field.weight": "字体粗细",
      "field.shadow": "字体阴影",
      "weight.regular": "常规",
      "weight.medium": "中",
      "weight.semibold": "半粗",
      "weight.bold": "粗",
      "shadow.on": "开",
      "shadow.off": "关",
      "none": "不显示",
      "action.reset": "清除自定义",
      "action.done": "完成",
      "action.close": "关闭",
      "preview.sample": "这是一条会话标题",
      "preview.sample.workspace": "这是一个工作区名称"
    };

    /** English copy; the key set is shared with {@link zh}. */
    const en = {
      "menu.appearance": "Customize appearance",
      "dialog.title": "Customize appearance",
      "dialog.desc": "Set the colour, glow, weight and shadow of this session's title. The setting is stored in this browser only.",
      "dialog.desc.workspace": "Set the colour, glow, weight and shadow of this workspace's name. The setting is stored in this browser only.",
      "field.color": "Colour",
      "field.glow": "Text glow",
      "field.weight": "Font weight",
      "field.shadow": "Text shadow",
      "weight.regular": "Regular",
      "weight.medium": "Medium",
      "weight.semibold": "Semi-bold",
      "weight.bold": "Bold",
      "shadow.on": "On",
      "shadow.off": "Off",
      "none": "None",
      "action.reset": "Clear",
      "action.done": "Done",
      "action.close": "Close",
      "preview.sample": "This is a session title",
      "preview.sample.workspace": "This is a workspace name"
    };

    /** The active translator; rebound whenever the locale seat is (re)bound. */
    let activeT = (key, params) => {
      const entry = zh[key];
      if (typeof entry !== "string") return key;
      return Object.keys(params || {}).reduce((text, name) => text.replace("{" + name + "}", String(params[name])), entry);
    };

    /**
     * Register the dictionaries and bind the translator.
     *
     * @param {object} scope - the injected scope.
     */
    function installDictionaries(scope) {
      scope.effect(() => scope.locale.register(NS, { zh, en }), "session-beautify: dictionaries");
      activeT = scope.locale.bind(NS);
    }

    //#endregion

    //#region painting

    /**
     * Both row-handle selector shapes in one query, so a full repaint, an unload
     * cleanup and the observer each walk the document once.
     */
    const ROW_SELECTOR_ALL =
      "[" + ROW_KEY_ATTR + '^="' + ROW_KEY_PREFIX + '"],[' + ROW_KEY_ATTR + '^="' + WORKSPACE_ROW_KEY_PREFIX + '"]';

    /**
     * Whether any row currently carries a custom style. While this is false the
     * observer does no work at all, which is the common case.
     */
    let paintNeeded = false;

    /**
     * The row kind a `data-row-key` handle names, or null for any other row.
     *
     * Kind comes from the prefix alone; the entry (if any) is looked up by
     * {@link targetOfRowKey}. Splitting the two keeps the unload cleanup
     * working after the tables are already empty.
     *
     * @param {string} key - the `data-row-key` value.
     * @returns {string|null} 'workspace', 'session', or null.
     */
    function rowKindOfKey(key) {
      if (typeof key !== "string") return null;
      if (key.startsWith(WORKSPACE_ROW_KEY_PREFIX)) {
        return key.length > WORKSPACE_ROW_KEY_PREFIX.length ? "workspace" : null;
      }
      if (key.startsWith(ROW_KEY_PREFIX)) {
        return key.length > ROW_KEY_PREFIX.length ? "session" : null;
      }
      return null;
    }

    /**
     * Resolve one `data-row-key` handle to what should be painted on it.
     *
     * Session and workspace handles share the attribute but not the table: the
     * kind decides which stored entry applies. The ungrouped workspace bucket's
     * handle is the bare prefix (its group key is the empty string), so it has no
     * id and no entry — it is never painted.
     *
     * @param {string} key - the `data-row-key` value.
     * @returns {{kind: string, id: string, entry: StyleEntry|null}|null} the target, or null.
     */
    function targetOfRowKey(key) {
      const kind = rowKindOfKey(key);
      if (!kind) return null;
      const styling = stylingInstance.getSnapshot();
      if (kind === "workspace") {
        const id = key.slice(WORKSPACE_ROW_KEY_PREFIX.length);
        return { kind, id, entry: (styling.workspaceStyling || {})[id] || null };
      }
      const id = key.slice(ROW_KEY_PREFIX.length);
      return { kind, id, entry: (styling.styling || {})[id] || null };
    }

    /**
     * Paint one host row according to its own handle.
     *
     * @param {Element} row - the host row.
     * @returns {boolean} true when the row carried a handle and was painted.
     */
    function paintRowByKey(row) {
      if (!row || typeof row.getAttribute !== "function") return false;
      const target = targetOfRowKey(String(row.getAttribute(ROW_KEY_ATTR) || ""));
      if (!target) return false;
      return target.kind === "workspace" ? paintWorkspaceRow(row, target.entry) : paintRow(row, target.entry);
    }

    /**
     * Write one session's stored style onto its row, if the row is on screen.
     *
     * @param {string} sessionId - the session id.
     * @returns {boolean} true when at least one row was found and painted.
     */
    function paintSession(sessionId) {
      // Paint EVERY row carrying this session, not just the first: the same
      // session can appear in more than one list (e.g. a recents group and the
      // workspace tree), and a single-row repaint left the other copy stale until
      // the host happened to re-render that row.
      let rows;
      try {
        rows = document.querySelectorAll(
          "[" + ROW_KEY_ATTR + '="session:' + escapeForSelector(String(sessionId)) + '"]'
        );
      } catch {
        rows = [];
      }
      if (rows.length === 0) {
        // The user just picked a style for a session they right-clicked, so the
        // row is on screen: not finding it means the handle is wrong.
        warnAboutMissingRows();
        return false;
      }
      const styling = stylingInstance.getSnapshot().styling || {};
      for (const row of rows) paintRow(row, styling[sessionId]);
      return true;
    }

    /**
     * Write one workspace's stored style onto its row, if the row is on screen.
     *
     * A workspace row is unique per group, so one row is the whole answer here —
     * unlike a session, which can be listed twice.
     *
     * @param {string} workspaceId - the workspace id.
     * @returns {boolean} true when the row was found and painted.
     */
    function paintWorkspace(workspaceId) {
      let rows;
      try {
        rows = document.querySelectorAll(
          "[" + ROW_KEY_ATTR + '="workspace:' + escapeForSelector(String(workspaceId)) + '"]'
        );
      } catch {
        rows = [];
      }
      if (rows.length === 0) {
        warnAboutMissingRows();
        return false;
      }
      const workspaceStyling = stylingInstance.getSnapshot().workspaceStyling || {};
      for (const row of rows) paintWorkspaceRow(row, workspaceStyling[workspaceId]);
      return true;
    }

    /**
     * Repaint every styled row currently in the document.
     *
     * The host re-renders the sidebar whenever the session list changes, which
     * replaces row elements and drops the inline style this plugin wrote. A full
     * repaint restores them.
     */
    function paintAllRows() {
      if (typeof document === "undefined") return;
      let rows;
      try {
        rows = document.querySelectorAll(ROW_SELECTOR_ALL);
      } catch {
        return;
      }
      for (const row of rows) paintRowByKey(row);
    }

    /**
     * Remove this plugin's inline style from every row. Used when the plugin
     * unloads so the host's rows go back to looking untouched.
     */
    function clearAllRows() {
      if (typeof document === "undefined") return;
      let rows;
      try {
        rows = document.querySelectorAll(ROW_SELECTOR_ALL);
      } catch {
        return;
      }
      for (const row of rows) {
        const kind = rowKindOfKey(String(row.getAttribute(ROW_KEY_ATTR) || ""));
        if (kind === "workspace") clearRowStyle(workspaceTitleElementOf(row));
        else if (kind === "session") clearRowStyle(titleElementOf(row));
      }
    }

    /**
     * Repaint a single row when the DOM around it changed.
     *
     * @param {Node|null|undefined} node - the added node.
     * @returns {boolean} true when the node belonged to a host row.
     */
    function paintNodeIfRow(node) {
      if (!node || node.nodeType !== 1) return false;
      const element = node;
      const row =
        typeof element.matches === "function" && element.matches(ROW_SELECTOR_ALL)
          ? element
          : typeof element.closest === "function"
            ? element.closest(ROW_SELECTOR_ALL)
            : null;
      if (!row) return false;
      paintRowByKey(row);
      return true;
    }

    /**
     * Watch the document for host rows appearing or being replaced.
     *
     * The observer is deliberately narrow: it only reacts to added nodes that
     * belong to a host row, so unrelated churn in the conversation area costs
     * nothing.
     *
     * @returns {Function} a disposer that stops observing.
     */
    function startObserver() {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
      const observer = new MutationObserver((records) => {
        if (!paintNeeded) return;
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (paintNodeIfRow(node)) continue;
            if (!node || node.nodeType !== 1 || typeof node.querySelectorAll !== "function") continue;
            let rows;
            try {
              rows = node.querySelectorAll(ROW_SELECTOR_ALL);
            } catch {
              continue;
            }
            for (const row of rows) paintRowByKey(row);
          }
        }
      });
      const root = document.body || document.documentElement;
      if (!root) return () => {};
      try {
        observer.observe(root, { childList: true, subtree: true });
      } catch {
        return () => {};
      }
      return () => observer.disconnect();
    }

    /**
     * Recompute whether the observer has any work to do.
     *
     * @returns {boolean} true while at least one row carries a style.
     */
    function refreshPaintNeeded() {
      const snapshot = stylingInstance.getSnapshot();
      paintNeeded =
        Object.keys(snapshot.styling || {}).length > 0 ||
        Object.keys(snapshot.workspaceStyling || {}).length > 0;
      return paintNeeded;
    }

    /**
     * Store a session's style and apply it to the row right away.
     *
     * @param {string} sessionId - the session id.
     * @param {StyleEntry|null} entry - the entry; null removes the style.
     */
    function applyStyle(sessionId, entry) {
      stylingInstance.actions.setStyle(sessionId, entry);
      refreshPaintNeeded();
      paintSession(sessionId);
    }

    /**
     * Store a workspace's style and apply it to the row right away.
     *
     * @param {string} workspaceId - the workspace id.
     * @param {StyleEntry|null} entry - the entry; null removes the style.
     */
    function applyWorkspaceStyle(workspaceId, entry) {
      stylingInstance.actions.setWorkspaceStyle(workspaceId, entry);
      refreshPaintNeeded();
      paintWorkspace(workspaceId);
    }

    //#endregion

    //#region components

    /**
     * The session context-menu row that opens the appearance dialog.
     *
     * @param {object} props - slot props: `sessionId`, `displayTitle`, `useMenuOpenState`, `t`.
     * @returns {any} the menu row.
     */
    function AppearanceMenuItem(props) {
      const { sessionId, displayTitle, useMenuOpenState } = props;
      // The slot hands over its own translator; the module-level one is the
      // fallback for a host that leaves the locale seat out of the props.
      const t = typeof props.t === "function" ? props.t : activeT;
      const [, setMenuOpen] = useMenuOpenState();
      return h(MenuItemButton, {
        icon: appearanceIcon(),
        onSelect: () => {
          // Close the menu first: the dialog is mounted in `shell.overlay`, and
          // the menu row itself unmounts with the menu.
          setMenuOpen(false);
          const styling = stylingInstance.getSnapshot().styling || {};
          dialogInstance.actions.setDialog({
            kind: "session",
            targetId: sessionId,
            displayTitle: displayTitle ?? sessionId,
            initial: styling[sessionId] ?? null
          });
        },
        children: t("menu.appearance")
      });
    }

    /**
     * A glyph for the menu row, if the primitives module offers one.
     *
     * The icon families the host ships are not interchangeable (`Regular` and
     * `16` suffixes name different sets), so the candidate list is probed at
     * runtime rather than hard-coded. A missing icon is not an error: the menu
     * row simply has no glyph.
     *
     * @returns {any|null} the icon element, or null.
     */
    function appearanceIcon() {
      const candidates = [
        "IconPersonalizationOutlineRegular",
        "IconBrushOutlineRegular",
        "IconPaletteOutlineRegular",
        "IconColorOutlineRegular"
      ];
      for (const name of candidates) {
        const component = primitives[name];
        if (typeof component === "function") return h(component, { size: 14 });
      }
      return null;
    }

    /**
     * The keyed glyph the shared context menu renders for the workspace entry.
     *
     * The menu's data contribution names an icon key; the popup asks the
     * `contextMenu.icon` slot for that key and mounts this component inside its
     * leading cell. The session entry keeps using `MenuItemButton`'s own icon
     * prop, because that slot is a component seat rather than a data one.
     *
     * @returns {any} the glyph, or null when the primitives ship none.
     */
    function WorkspaceAppearanceIcon() {
      return appearanceIcon();
    }

    /**
     * Open the appearance dialog for one workspace row.
     *
     * @param {string} workspaceId - the workspace id.
     * @param {string} displayTitle - the label to show in the dialog.
     */
    function openWorkspaceAppearance(workspaceId, displayTitle) {
      const workspaceStyling = stylingInstance.getSnapshot().workspaceStyling || {};
      dialogInstance.actions.setDialog({
        kind: "workspace",
        targetId: workspaceId,
        displayTitle: displayTitle || workspaceId,
        initial: workspaceStyling[workspaceId] || null
      });
    }

    /**
     * The appearance dialog: colour, glow, weight, shadow, with a live preview.
     *
     * The draft lives in component state and is seeded once per row; the dialog
     * is keyed by row kind + id by the caller, so switching rows mounts a fresh
     * draft instead of carrying the previous one over.
     *
     * @param {object} props - `{ dialog, t }`.
     * @returns {any} the dialog.
     */
    function AppearanceDialog(props) {
      const { dialog, t } = props;
      // `sessionId` is the pre-workspace descriptor shape kept readable so a
      // half-open dialog from an older bundle does not crash this one.
      const kind = dialog.kind === "workspace" ? "workspace" : "session";
      const targetId = dialog.targetId || dialog.sessionId || "";
      const initial = dialog.initial ?? null;
      const [color, setColor] = useState(initial && initial.color ? initial.color : "");
      const [glow, setGlow] = useState(initial ? Number(initial.glow) || 0 : 0);
      const [weight, setWeight] = useState(initial ? Number(initial.weight) || 0 : 0);
      const [shadow, setShadow] = useState(initial ? initial.shadow === true : false);

      const channels = colorToRgb(color);
      const setChannel = (index, raw) => {
        const base = channels || [0, 0, 0];
        const next = base.slice();
        next[index] = Math.max(0, Math.min(255, parseInt(raw, 10) || 0));
        setColor(rgbToHex(next[0], next[1], next[2]));
      };

      const preview = toRowStyle({ color, glow, weight, shadow });

      /** Store an entry on the row this dialog was opened for. */
      const store = (entry) => {
        if (kind === "workspace") applyWorkspaceStyle(targetId, entry);
        else applyStyle(targetId, entry);
      };

      const commit = (entry) => {
        store(entry);
        dialogInstance.actions.closeDialog();
      };

      const reset = () => {
        store(null);
        dialogInstance.actions.closeDialog();
      };

      const footer = h(
        "div",
        { className: "dsh-beautify-actions" },
        h(Button, { variant: "outline", onClick: reset }, t("action.reset")),
        h(
          Button,
          {
            variant: "primary",
            onClick: () => commit(normalizeEntry({ color, glow, weight, shadow }))
          },
          t("action.done")
        )
      );

      return h(
        Modal,
        {
          open: true,
          onClose: () => dialogInstance.actions.closeDialog(),
          closeLabel: t("action.close"),
          title: t("dialog.title"),
          description: kind === "workspace" ? t("dialog.desc.workspace") : t("dialog.desc"),
          footer
        },
        h(
          "div",
          { className: "dsh-beautify-field" },
          h("span", { className: "dsh-beautify-label" }, t("field.color")),
          h(
            "div",
            { className: "dsh-beautify-swatches" },
            SWATCHES.map((swatch) =>
              h("button", {
                key: swatch || "none",
                type: "button",
                className: swatch === "" ? "dsh-beautify-swatch dsh-beautify-swatch-none" : "dsh-beautify-swatch",
                "data-active": color === swatch ? "true" : "false",
                "aria-label": swatch === "" ? t("none") : swatch,
                title: swatch === "" ? t("none") : swatch,
                style: swatch === "" ? undefined : { background: swatch },
                onClick: () => setColor(swatch)
              })
            ),
            h("input", {
              type: "color",
              className: "dsh-beautify-picker",
              value: color || "#5b8def",
              "aria-label": t("field.color"),
              onChange: (event) => setColor(event.target.value)
            })
          ),
          h(
            "div",
            { className: "dsh-beautify-rgb" },
            ["R", "G", "B"].map((label, index) =>
              h(
                "label",
                { key: label },
                label,
                h("input", {
                  type: "number",
                  min: 0,
                  max: 255,
                  value: channels ? channels[index] : "",
                  placeholder: "—",
                  onChange: (event) => setChannel(index, event.target.value)
                })
              )
            )
          )
        ),
        h(
          "div",
          { className: "dsh-beautify-field" },
          h("span", { className: "dsh-beautify-label" }, t("field.glow")),
          h(
            "div",
            { className: "dsh-beautify-slider" },
            h("input", {
              type: "range",
              min: 0,
              max: GLOW_MAX,
              step: 1,
              value: glow,
              "aria-label": t("field.glow"),
              onChange: (event) => setGlow(Number(event.target.value))
            }),
            h("span", { className: "dsh-beautify-value" }, glow === 0 ? t("none") : glow + "px")
          )
        ),
        h(
          "div",
          { className: "dsh-beautify-field" },
          h("span", { className: "dsh-beautify-label" }, t("field.weight")),
          h(
            "div",
            { className: "dsh-beautify-seg" },
            WEIGHTS.map((value) =>
              h(
                "button",
                {
                  key: String(value),
                  type: "button",
                  "data-active": weight === value ? "true" : "false",
                  onClick: () => setWeight(value)
                },
                value === 400
                  ? t("weight.regular")
                  : value === 500
                    ? t("weight.medium")
                    : value === 600
                      ? t("weight.semibold")
                      : t("weight.bold")
              )
            )
          )
        ),
        h(
          "div",
          { className: "dsh-beautify-field" },
          h("span", { className: "dsh-beautify-label" }, t("field.shadow")),
          h(
            "div",
            { className: "dsh-beautify-seg" },
            h(
              "button",
              { type: "button", "data-active": shadow ? "false" : "true", onClick: () => setShadow(false) },
              t("shadow.off")
            ),
            h(
              "button",
              { type: "button", "data-active": shadow ? "true" : "false", onClick: () => setShadow(true) },
              t("shadow.on")
            )
          )
        ),
        h(
          "div",
          { className: "dsh-beautify-field" },
          h("span", { className: "dsh-beautify-label" }, t("field.color")),
          h(
            "div",
            {
              className: "dsh-beautify-preview",
              style: {
                color: preview && preview.color ? preview.color : undefined,
                fontWeight: preview && preview.fontWeight ? preview.fontWeight : undefined,
                textShadow: preview && preview.textShadow ? preview.textShadow : undefined
              }
            },
            t(kind === "workspace" ? "preview.sample.workspace" : "preview.sample")
          )
        )
      );
    }

    /**
     * The `shell.overlay` seat: the appearance dialog and nothing else.
     *
     * @param {object} props - slot props including the store hooks and locale seat.
     * @returns {any} the dialog, or null.
     */
    function BeautifyOverlays(props) {
      const { useStore } = props;
      const t = typeof props.t === "function" ? props.t : activeT;
      const dialog = useStore((state) => state.dialog);
      if (!dialog) return null;
      // Keyed by kind + id so switching rows mounts a fresh draft.
      const key = (dialog.kind === "workspace" ? "workspace:" : "session:") + (dialog.targetId || dialog.sessionId || "");
      return h(AppearanceDialog, { key, dialog, t });
    }

    //#endregion

    //#region plugin

    /**
     * Register the workspace menu entry through the shared context-menu
     * capability.
     *
     * The contribution goes in BEFORE the glyph seat: if registering the keyed
     * icon ever fails on a host that ships no such slot, the menu entry must
     * still exist. A missing glyph is cosmetic; a missing menu entry is not.
     *
     * @param {object} scope - the scope that holds `slots` and `locale`.
     * @param {object} menuScope - the scope that additionally holds `contextMenus`.
     */
    function registerWorkspaceMenu(scope, menuScope) {
      menuScope.effect(
        () =>
          menuScope.contextMenus.register({
            id: WORKSPACE_MENU_ID,
            target: "workspace",
            // Between 重命名 (100) and 在应用中打开 (200) is 150; between that and
            // 删除 (300) keeps the destructive row last.
            order: 250,
            resolve: (target) => {
              const workspaceId = String((target && target.workspaceId) || "");
              if (!workspaceId) return [];
              const displayTitle = String(target.displayTitle || workspaceId);
              return [
                {
                  id: "appearance",
                  label: activeT("menu.appearance"),
                  icon: { key: WORKSPACE_ICON_KEY },
                  run: () => {
                    openWorkspaceAppearance(workspaceId, displayTitle);
                  }
                }
              ];
            }
          }),
        "session-beautify: workspace menu"
      );

      try {
        scope.slots.inject("contextMenu.icon", function* () {
          yield scope.slots.register(
            { name: "contextMenu.icon", key: WORKSPACE_ICON_KEY, locale: NS },
            WorkspaceAppearanceIcon
          );
        });
      } catch (error) {
        console.warn("[dsh-session-beautify] the workspace menu glyph could not be registered", error);
      }
    }

    /**
     * Register the menu entries, the overlay, and the row painter.
     *
     * @param {object} ctx - the host context handed to the client half.
     */
    function apply(ctx) {
      if (!ctx || typeof ctx.inject !== "function") return;
      injectStyles();

      ctx.inject(["slots", "locale"], (scope) => {
        installDictionaries(scope);

        scope.slots.inject("sidebar.workspaces.session.menu.item", function* () {
          yield scope.slots.register(
            {
              name: "sidebar.workspaces.session.menu.item",
              id: "session-beautify.appearance",
              order: 450,
              locale: NS
            },
            AppearanceMenuItem
          );
        });

        scope.slots.inject("shell.overlay", function* () {
          yield scope.slots.register(
            {
              name: "shell.overlay",
              id: "session-beautify.overlays",
              locale: NS,
              store: dialogSeat
            },
            BeautifyOverlays
          );
        });

        // The workspace menu is a SECOND, independent dependency: `contextMenus`
        // is a nested inject so a deployment missing it only loses the workspace
        // entry, never the session styling above.
        scope.inject(["contextMenus"], (menuScope) => {
          registerWorkspaceMenu(scope, menuScope);
        });

        // The painter lives as long as the scope does: when the plugin is
        // disabled the rows are handed back to the host untouched.
        scope.effect(() => {
          refreshPaintNeeded();
          const stop = startObserver();
          if (paintNeeded) paintAllRows();
          return () => {
            stop();
            clearAllRows();
          };
        }, "session-beautify: row painter");
      });
    }

    /**
     * Exported `[]` on purpose: every service this module needs is acquired with
     * `ctx.inject` inside {@link apply}, so this entry always reaches the active
     * state and can never stall the shell's boot audit on a missing service.
     */
    const inject = [];

    exports.apply = apply;
    exports.inject = inject;
    exports.NS = NS;
    exports.STORE_KEY = STORE_KEY;
    exports.WORKSPACE_ICON_KEY = WORKSPACE_ICON_KEY;
    exports.WORKSPACE_MENU_ID = WORKSPACE_MENU_ID;
    // Test-only surface: the pure helpers and the store handles, so they can be
    // exercised without a DOM.
    exports.__test = {
      toRowStyle,
      normalizeEntry,
      colorToRgb,
      rgbToHex,
      escapeForSelector,
      rowElementOf,
      titleElementOf,
      clearRowStyle,
      writeTitleStyle,
      paintRow,
      workspaceRowElementOf,
      workspaceTitleElementOf,
      paintWorkspaceRow,
      paintRowByKey,
      targetOfRowKey,
      rowKindOfKey,
      paintAllRows,
      clearAllRows,
      applyStyle,
      applyWorkspaceStyle,
      refreshPaintNeeded,
      SWATCHES,
      GLOW_MAX,
      WEIGHTS,
      ROW_SELECTOR_ALL,
      dictionaries: { zh, en },
      stylingHandle,
      stylingInstance,
      dialogHandle,
      dialogInstance,
      setTranslator: (t) => {
        activeT = t;
      }
    };
    return module.exports;
  }
});
