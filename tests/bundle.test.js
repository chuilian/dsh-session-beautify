/**
 * Bundle contract tests.
 *
 * The bundle is the file DSH actually serves, so it is loaded here exactly the
 * way the browser loads it: a stub `window.__ModuleLoader__` captures the
 * registration, and a stub `require` answers only the specifiers the platform's
 * frozen module table provides.
 *
 * That verifies the things a client plugin can get wrong fatally — requiring a
 * module the platform does not expose, declaring a service it cannot have, and
 * occupying a slot with the wrong shape.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PLATFORM_MODULES, loadClient, stubScope } from "./helpers.js";

test("the module registers under its own id", async () => {
  const { registration } = await loadClient();
  assert.equal(registration.id, "dsh-session-beautify");
  assert.equal(typeof registration.factory, "function");
});

test("the plugin exposes apply and declares no static injections", async () => {
  const { plugin } = await loadClient();
  assert.equal(typeof plugin.apply, "function");
  // An empty inject list keeps the entry from stalling the page boot audit on a
  // service it names: everything is acquired inside apply.
  assert.equal(plugin.inject.length, 0);
});

test("the bundle requires only the frozen platform table", async () => {
  const { requested } = await loadClient();
  assert.ok(requested.length > 0);
  for (const name of requested) {
    assert.ok(PLATFORM_MODULES.includes(name), "unexpected platform request: " + name);
  }
});

test("apply occupies exactly the two seats it documents", async () => {
  const { plugin } = await loadClient();
  const { scope, registrations, effects, dictionaries } = stubScope();

  plugin.apply({ inject: (names, fn) => fn(scope) });

  assert.deepEqual(
    registrations.map((entry) => entry.hole).sort(),
    ["shell.overlay", "sidebar.workspaces.session.menu.item"]
  );

  // Both seats are list slots, so both entries need a non-empty id.
  for (const entry of registrations) {
    assert.equal(typeof entry.options.id, "string");
    assert.ok(entry.options.id.length > 0, entry.options.id + " needs an id");
    assert.equal(entry.options.key, undefined, "a list slot must not carry a key");
    assert.equal(typeof entry.component, "function");
  }

  // The dictionaries are registered under the plugin's own namespace.
  assert.equal(dictionaries.length, 1);
  assert.equal(dictionaries[0].ns, plugin.NS);

  // The row painter is an effect, so it is torn down with the scope.
  assert.ok(effects.some((entry) => String(entry.label).includes("painter")));
});

test("the menu entry sits before the delete actions", async () => {
  const { plugin } = await loadClient();
  const { scope, registrations } = stubScope();
  plugin.apply({ inject: (names, fn) => fn(scope) });

  const menu = registrations.find((entry) => entry.hole === "sidebar.workspaces.session.menu.item");
  assert.equal(menu.options.id, "session-beautify.appearance");
  assert.equal(menu.options.locale, plugin.NS);
  assert.equal(menu.options.order, 450);
});

test("the overlay carries a store seat so it can read the dialog state", async () => {
  const { plugin } = await loadClient();
  const { scope, registrations } = stubScope();
  plugin.apply({ inject: (names, fn) => fn(scope) });

  const overlay = registrations.find((entry) => entry.hole === "shell.overlay");
  assert.equal(overlay.options.id, "session-beautify.overlays");
  assert.equal(typeof overlay.options.store, "object");
  assert.equal(typeof overlay.options.store.create, "function");
});

test("apply stays inert when the slots service never arrives", async () => {
  const { plugin } = await loadClient();
  // A deployment missing the service: the injection never fires, so the plugin
  // must not have registered anything and must not have thrown.
  plugin.apply({ inject: () => {} });
});

test("apply stays inert without a context at all", async () => {
  const { plugin } = await loadClient();
  assert.doesNotThrow(() => plugin.apply(null));
  assert.doesNotThrow(() => plugin.apply(undefined));
  assert.doesNotThrow(() => plugin.apply({}));
});

test("the style table is persisted and the dialog state is not", async () => {
  const { plugin } = await loadClient();
  assert.equal(plugin.__test.stylingHandle.definition.persist, "dsh.sessionBeautify.styling.v1");
  // A persisted dialog would come back after a reload as a half-open dialog.
  assert.equal(plugin.__test.dialogHandle.definition.persist, undefined);
});

test("the style store keeps one entry per session and removes it on null", async () => {
  const { plugin } = await loadClient();
  const store = plugin.__test.stylingInstance;
  const id = "s_test";

  store.actions.setStyle(id, { color: "#5b8def", glow: 4, weight: 600, shadow: false });
  assert.equal(store.getSnapshot().styling[id].color, "#5b8def");

  store.actions.setStyle(id, null);
  assert.equal(store.getSnapshot().styling[id], undefined);
});

test("the dialog store opens and closes", async () => {
  const { plugin } = await loadClient();
  const store = plugin.__test.dialogInstance;

  assert.equal(store.getSnapshot().dialog, null);
  store.actions.setDialog({ sessionId: "s1", initial: null });
  assert.equal(store.getSnapshot().dialog.sessionId, "s1");
  store.actions.closeDialog();
  assert.equal(store.getSnapshot().dialog, null);
});
