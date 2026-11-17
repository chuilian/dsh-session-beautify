/**
 * Core logic tests.
 *
 * The appearance model is pure: a stored entry becomes an inline style object,
 * and the entry is normalised before it is stored. These rules are what the
 * painter on the host's DOM depends on, so they are asserted directly rather
 * than through a render.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { loadClient, stubDocument, stubRow, stubWorkspaceRow } from "./helpers.js";

/** Load the bundle once; the pure surface never changes between tests. */
const { plugin } = await loadClient();
const {
  toRowStyle,
  normalizeEntry,
  colorToRgb,
  rgbToHex,
  escapeForSelector,
  titleElementOf,
  paintRow,
  workspaceTitleElementOf,
  paintWorkspaceRow,
  targetOfRowKey
} = plugin.__test;

test("toRowStyle returns null when there is nothing to apply", () => {
  assert.equal(toRowStyle(null), null);
  assert.equal(toRowStyle(undefined), null);
  assert.equal(toRowStyle({}), null);
  assert.equal(toRowStyle({ color: "", glow: 0, weight: 0, shadow: false }), null);
});

test("toRowStyle keeps the fields independent of each other", () => {
  // A user who only picks a weight and never touches the colour still gets the
  // weight: colour is not a gate.
  const weightOnly = toRowStyle({ weight: 600 });
  assert.equal(weightOnly.fontWeight, 600);
  assert.equal(weightOnly.color, undefined);
  assert.equal(weightOnly.textShadow, undefined);

  const colorOnly = toRowStyle({ color: "#5b8def" });
  assert.equal(colorOnly.color, "#5b8def");
  assert.equal(colorOnly.fontWeight, undefined);

  const shadowOnly = toRowStyle({ shadow: true });
  assert.equal(shadowOnly.textShadow, "1px 1px 2px rgba(0,0,0,.85)");
  assert.equal(shadowOnly.color, undefined);
});

test("toRowStyle emits a glow only when there is a colour to borrow", () => {
  // A glow has no colour of its own, so without a text colour there is nothing
  // to emit and the whole style stays empty.
  assert.equal(toRowStyle({ glow: 6 }), null);
  assert.equal(toRowStyle({ glow: 6, color: "#5b8def" }).textShadow, "0 0 6px #5b8def");
});

test("toRowStyle combines a glow and a shadow in one text-shadow", () => {
  const style = toRowStyle({ glow: 4, color: "#5b8def", shadow: true });
  assert.equal(style.textShadow, "0 0 4px #5b8def,1px 1px 2px rgba(0,0,0,.85)");
});

test("toRowStyle rejects a colour that is not a six-digit hex", () => {
  assert.equal(toRowStyle({ color: "red" }), null);
  assert.equal(toRowStyle({ color: "#5b8" }), null);
  assert.equal(toRowStyle({ color: "#5b8def" }).color, "#5b8def");
});

test("toRowStyle clamps the glow to the offered range", () => {
  assert.equal(toRowStyle({ glow: 99, color: "#5b8def" }).textShadow, "0 0 14px #5b8def");
});

test("normalizeEntry drops an entry that carries nothing worth keeping", () => {
  assert.equal(normalizeEntry(null), null);
  assert.equal(normalizeEntry({}), null);
  assert.equal(normalizeEntry({ color: "", glow: 0, weight: 0, shadow: false }), null);
});

test("normalizeEntry clamps the glow into 0..14", () => {
  assert.equal(normalizeEntry({ glow: 99, color: "#5b8def" }).glow, 14);
  assert.equal(normalizeEntry({ glow: 3.7, color: "#5b8def" }).glow, 3);
  // A glow borrows the text colour: without one there is nothing to keep.
  assert.equal(normalizeEntry({ glow: -4 }), null);
  assert.equal(normalizeEntry({ glow: 99 }), null);
});

test("normalizeEntry keeps only the offered font weights", () => {
  assert.equal(normalizeEntry({ weight: 600 }).weight, 600);
  assert.equal(normalizeEntry({ weight: 550 }), null);
});

test("normalizeEntry lowercases the colour and drops an invalid one", () => {
  assert.equal(normalizeEntry({ color: "#5B8DEF" }).color, "#5b8def");
  assert.equal(normalizeEntry({ color: "not-a-colour" }), null);
});

test("normalizeEntry turns the shadow flag into a strict boolean", () => {
  assert.equal(normalizeEntry({ shadow: true }).shadow, true);
  assert.equal(normalizeEntry({ shadow: "yes" }), null);
});

test("the colour helpers round-trip", () => {
  const channels = colorToRgb("#5b8def");
  assert.equal(channels[0], 91);
  assert.equal(channels[1], 141);
  assert.equal(channels[2], 239);
  assert.equal(rgbToHex(91, 141, 239), "#5b8def");

  const bare = colorToRgb("5b8def");
  assert.equal(bare[0], 91);
  assert.equal(colorToRgb("nope"), null);
});

test("rgbToHex clamps out-of-range channels", () => {
  assert.equal(rgbToHex(-10, 300, 12.6), "#00ff0d");
});

test("escapeForSelector neutralises a quote", () => {
  assert.equal(escapeForSelector('a"b'), 'a\\"b');
  assert.equal(escapeForSelector("a\\b"), "a\\\\b");
});

test("titleElementOf picks the second child and refuses anything else", () => {
  const row = stubRow("s1");
  assert.equal(titleElementOf(row), row.children[1]);
  assert.equal(titleElementOf(stubRow("s1", 1)), null);
  assert.equal(titleElementOf(null), null);

  const broken = stubRow("s1");
  broken.children[1] = { tagName: "DIV", style: {} };
  assert.equal(titleElementOf(broken), null);
});

test("paintRow writes the style onto the title only", async () => {
  const row = stubRow("s1");
  const painted = paintRow(row, { color: "#5b8def", glow: 4, weight: 600, shadow: true });

  assert.equal(painted, true);
  const title = row.children[1];
  assert.equal(title.style.getPropertyValue("color"), "#5b8def");
  assert.equal(title.style.getPropertyValue("font-weight"), "600");
  assert.equal(title.style.getPropertyValue("text-shadow"), "0 0 4px #5b8def,1px 1px 2px rgba(0,0,0,.85)");
  // The status cell and the timestamp keep their own styles.
  assert.equal(row.children[0].style.getPropertyValue("color"), "");
  assert.equal(row.children[2].style.getPropertyValue("color"), "");
});

test("paintRow clears what it wrote before when the entry is empty", async () => {
  const row = stubRow("s1");
  paintRow(row, { color: "#5b8def", weight: 700 });
  const painted = paintRow(row, null);

  assert.equal(painted, false);
  const title = row.children[1];
  assert.equal(title.style.getPropertyValue("color"), "");
  assert.equal(title.style.getPropertyValue("font-weight"), "");
  assert.equal(title.style.getPropertyValue("text-shadow"), "");
});

test("paintRow reports failure for a row it cannot address", () => {
  assert.equal(paintRow(null, { color: "#5b8def" }), false);
  assert.equal(paintRow(stubRow("s1", 1), { color: "#5b8def" }), false);
});

test("rowElementOf finds the host row by its data-row-key handle", async () => {
  const row = stubRow("s_abc123");
  const { plugin: withDoc } = await loadClient({ document: stubDocument([row]) });
  const found = withDoc.__test.rowElementOf("s_abc123");
  assert.equal(found, row);
  assert.equal(withDoc.__test.rowElementOf("missing"), null);
});

test("the Chinese and English dictionaries carry the same key set", () => {
  const { zh, en } = plugin.__test.dictionaries;
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  assert.ok(Object.keys(zh).length > 10);
});

test("workspaceTitleElementOf picks the label inside projectText", () => {
  const row = stubWorkspaceRow("w_1");
  // Third child (projectText) → its first child (the label).
  assert.equal(workspaceTitleElementOf(row), row.children[2].children[0]);
  // A session row must not be addressable through the workspace shape.
  assert.equal(workspaceTitleElementOf(stubRow("s1")), null);
  assert.equal(workspaceTitleElementOf(null), null);
  assert.equal(workspaceTitleElementOf(stubWorkspaceRow("w_1", 2)), null);

  const broken = stubWorkspaceRow("w_1");
  broken.children[2].children[0] = { tagName: "DIV", style: {} };
  assert.equal(workspaceTitleElementOf(broken), null);
});

test("paintWorkspaceRow writes the label style and leaves the glyph cells alone", () => {
  const row = stubWorkspaceRow("w_1");
  const painted = paintWorkspaceRow(row, { color: "#a371f7", glow: 0, weight: 700, shadow: false });

  assert.equal(painted, true);
  const label = row.children[2].children[0];
  assert.equal(label.style.getPropertyValue("color"), "#a371f7");
  assert.equal(label.style.getPropertyValue("font-weight"), "700");
  // The folder glyph and the chevron keep their own colours.
  assert.equal(row.children[0].style.getPropertyValue("color"), "");
  assert.equal(row.children[1].style.getPropertyValue("color"), "");
});

test("paintWorkspaceRow clears what it wrote before when the entry is empty", () => {
  const row = stubWorkspaceRow("w_1");
  paintWorkspaceRow(row, { color: "#a371f7", weight: 700 });
  assert.equal(paintWorkspaceRow(row, null), false);
  const label = row.children[2].children[0];
  assert.equal(label.style.getPropertyValue("color"), "");
  assert.equal(label.style.getPropertyValue("font-weight"), "");
});

test("paintWorkspaceRow reports failure for a row it cannot address", () => {
  assert.equal(paintWorkspaceRow(null, { color: "#a371f7" }), false);
  assert.equal(paintWorkspaceRow(stubWorkspaceRow("w_1", 2), { color: "#a371f7" }), false);
});

test("targetOfRowKey tells the two row kinds apart and skips the ungrouped bucket", () => {
  const styling = plugin.__test.stylingInstance;
  styling.actions.setStyle("s_1", { color: "#5b8def" });
  styling.actions.setWorkspaceStyle("w_1", { color: "#3fb950" });

  const session = targetOfRowKey("session:s_1");
  assert.equal(session.kind, "session");
  assert.equal(session.id, "s_1");
  assert.equal(session.entry.color, "#5b8def");

  const workspace = targetOfRowKey("workspace:w_1");
  assert.equal(workspace.kind, "workspace");
  assert.equal(workspace.id, "w_1");
  assert.equal(workspace.entry.color, "#3fb950");

  // The ungrouped bucket's handle is the bare prefix: no id, nothing to paint.
  assert.equal(targetOfRowKey("workspace:"), null);
  assert.equal(targetOfRowKey("session:"), null);
  assert.equal(targetOfRowKey("overflow:abc"), null);

  styling.actions.setStyle("s_1", null);
  styling.actions.setWorkspaceStyle("w_1", null);
});

test("a full repaint covers both row shapes", async () => {
  const session = stubRow("s_1");
  const workspace = stubWorkspaceRow("w_1");
  const { plugin: withDoc } = await loadClient({ document: stubDocument([session, workspace]) });

  withDoc.__test.stylingInstance.actions.setStyle("s_1", { color: "#5b8def" });
  withDoc.__test.stylingInstance.actions.setWorkspaceStyle("w_1", { color: "#3fb950" });
  withDoc.__test.paintAllRows();

  assert.equal(session.children[1].style.getPropertyValue("color"), "#5b8def");
  assert.equal(workspace.children[2].children[0].style.getPropertyValue("color"), "#3fb950");

  // Unloading hands both shapes back untouched.
  withDoc.__test.clearAllRows();
  assert.equal(session.children[1].style.getPropertyValue("color"), "");
  assert.equal(workspace.children[2].children[0].style.getPropertyValue("color"), "");
});

test("applyWorkspaceStyle stores the entry and paints the row at once", async () => {
  const workspace = stubWorkspaceRow("w_9");
  const { plugin: withDoc } = await loadClient({ document: stubDocument([workspace]) });

  withDoc.__test.applyWorkspaceStyle("w_9", { color: "#f85149", glow: 0, weight: 600, shadow: false });
  assert.equal(withDoc.__test.stylingInstance.getSnapshot().workspaceStyling.w_9.color, "#f85149");
  assert.equal(workspace.children[2].children[0].style.getPropertyValue("color"), "#f85149");
  // The observer must wake up for workspace-only styles too.
  assert.equal(withDoc.__test.refreshPaintNeeded(), true);

  withDoc.__test.applyWorkspaceStyle("w_9", null);
  assert.equal(withDoc.__test.refreshPaintNeeded(), false);
  assert.equal(workspace.children[2].children[0].style.getPropertyValue("color"), "");
});

test("workspaceRowElementOf finds the host workspace row by its handle", async () => {
  const workspace = stubWorkspaceRow("w_abc123");
  const { plugin: withDoc } = await loadClient({ document: stubDocument([workspace]) });
  assert.equal(withDoc.__test.workspaceRowElementOf("w_abc123"), workspace);
  assert.equal(withDoc.__test.workspaceRowElementOf("missing"), null);
});
