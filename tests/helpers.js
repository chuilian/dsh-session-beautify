/**
 * Test harness for the browser half.
 *
 * The bundle is hand-written in DSH's lazy-CJS dialect: a `load({id, factory})`
 * call whose factory resolves platform modules through a `require` it is handed.
 * This harness loads the file exactly the way the browser loads it — a stub
 * `window.__ModuleLoader__` captures the registration, and a stub `require`
 * answers only the specifiers the platform's frozen module table provides.
 *
 * That verifies the two things a client plugin can get wrong fatally —
 * requiring a module the platform does not expose, and declaring a service it
 * cannot have — plus the pure decision logic behind the appearance model.
 */

import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The bundle DSH actually serves. */
export const BUNDLE = path.join(here, "..", "lib", "client.js");

/**
 * The platform module table the shell seeds. The bundle may only require
 * specifiers on this list.
 */
export const PLATFORM_MODULES = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit"
];

/**
 * A minimal React stand-in: element creation plus the hooks the bundle uses.
 *
 * @returns {object} the React stub.
 */
export function stubReact() {
  return {
    Fragment: Symbol("Fragment"),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial })
  };
}

/**
 * A stand-in for the component primitives the bundle uses.
 *
 * @returns {object} the primitives stub.
 */
export function stubPrimitives() {
  return {
    MenuItemButton: (props) => ({ type: "MenuItemButton", props }),
    Modal: (props) => ({ type: "Modal", props }),
    Button: (props) => ({ type: "Button", props })
  };
}

/**
 * A faithful `defineStore` over plain-object state: actions mutate a copy and
 * the snapshot identity changes with every write, like the host's store.
 *
 * @returns {object} the store kit stub.
 */
export function stubClientStore() {
  const clone = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = clone(entry);
    return out;
  };
  return {
    defineStore: (definition) => {
      let state = definition.init();
      const actions = {};
      for (const [name, action] of Object.entries(definition.actions || {})) {
        actions[name] = (...args) => {
          const draft = clone(state);
          action(draft, ...args);
          state = draft;
        };
      }
      return {
        definition,
        create: () => ({
          actions,
          getSnapshot: () => state,
          subscribe: () => () => {},
          clearPersisted: () => {}
        })
      };
    }
  };
}

/**
 * A stand-in for `style`, recording what the bundle writes.
 *
 * @returns {object} the style stub.
 */
export function stubStyle() {
  const props = new Map();
  return {
    setProperty: (key, value) => props.set(key, value),
    removeProperty: (key) => props.delete(key),
    getPropertyValue: (key) => (props.has(key) ? props.get(key) : ""),
    _props: props
  };
}

/**
 * A fake session row: the host's `data-row-key` handle plus a fixed child
 * sequence (status cell, title, timestamp, pinned marker, action strip).
 *
 * @param {string} sessionId - the session id.
 * @param {number} [childCount] - how many children the row has.
 * @returns {object} the fake row.
 */
export function stubRow(sessionId, childCount = 5) {
  const children = [];
  for (let index = 0; index < childCount; index += 1) {
    children.push({ tagName: "SPAN", style: stubStyle() });
  }
  return {
    getAttribute: (name) => (name === "data-row-key" ? "session:" + sessionId : null),
    children,
    style: stubStyle()
  };
}

/**
 * A fake document that serves the two selector shapes the bundle uses.
 *
 * @param {object[]} [rows] - the rows the document contains.
 * @returns {object} the document stub.
 */
export function stubDocument(rows = []) {
  const matches = (row, selector) => {
    if (selector === '[data-row-key^="session:"]') return true;
    const exact = /^\[data-row-key="(.*)"\]$/.exec(selector);
    if (!exact) return false;
    return row.getAttribute("data-row-key") === exact[1];
  };
  return {
    rows,
    querySelector: (selector) => rows.find((row) => matches(row, selector)) ?? null,
    querySelectorAll: (selector) => rows.filter((row) => matches(row, selector)),
    createElement: () => ({ dataset: {}, textContent: "", style: stubStyle() }),
    head: { appendChild: () => {} },
    body: {}
  };
}

/**
 * Load the bundle the way the browser does.
 *
 * @param {object} [options] - `{ document, CSS }` overrides for the sandbox.
 * @returns {Promise<{plugin: object, requested: string[]}>} the loaded plugin.
 */
export async function loadClient(options = {}) {
  const source = await fs.readFile(BUNDLE, "utf8");
  const requested = [];
  let registration = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { registration = value; } } },
    console
  };
  if (options.document) sandbox.document = options.document;
  if (options.CSS) sandbox.CSS = options.CSS;

  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: BUNDLE });
  if (!registration) throw new Error("the bundle did not register a module");

  const platform = {
    react: stubReact(),
    "@deepseek-ai/dsh-client-store": stubClientStore(),
    "@deepseek-ai/dsh-client-ui-primitives": stubPrimitives()
  };
  const plugin = registration.factory((name) => {
    requested.push(name);
    if (!(name in platform)) throw new Error("unexpected platform request: " + name);
    return platform[name];
  });
  return { plugin, requested, registration };
}

/**
 * A fake injected scope: records slot registrations and effects.
 *
 * @returns {object} the scope plus the recorded calls.
 */
export function stubScope() {
  const registrations = [];
  const effects = [];
  const dictionaries = [];
  const registered = new Map();
  const scope = {
    slots: {
      inject: (hole, fn) => {
        const generator = fn();
        let step = generator.next();
        while (!step.done) step = generator.next();
      },
      register: (options, component) => {
        registrations.push({ hole: options.name, options, component });
      }
    },
    locale: {
      register: (ns, dict) => {
        dictionaries.push({ ns, dict });
        registered.set(ns, dict);
      },
      bind: (ns) => (key, params) => {
        const dict = registered.get(ns) ?? {};
        const entry = dict.zh?.[key];
        if (typeof entry !== "string") return key;
        return Object.keys(params || {}).reduce(
          (text, name) => text.replace("{" + name + "}", String(params[name])),
          entry
        );
      }
    },
    effect: (fn, label) => {
      const dispose = fn();
      effects.push({ label, dispose });
    }
  };
  return { scope, registrations, effects, dictionaries };
}
