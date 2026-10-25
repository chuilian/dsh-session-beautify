/**
 * `dsh-session-beautify` — host half.
 *
 * The whole feature lives in the browser half (`./client`, served by DSH's
 * client module system): the session context-menu entry, the appearance
 * dialog, the persisted style table and the painter that writes the styles onto
 * the host's own session rows.
 *
 * This host half exists so the Cordis plugin row has a valid Node entry. It
 * registers no routes, no commands and no services, and it reads no config:
 * the style table is browser-local by design, so two devices keep two
 * independent sets of per-session colours.
 *
 * @module dsh-session-beautify
 */

/** Package id; also the browser module id the client bundle registers under. */
export const name = "dsh-session-beautify";

/**
 * Mount the plugin.
 *
 * @param {object} ctx - the host context.
 */
export function apply(ctx) {
  const log =
    ctx && ctx.logger && typeof ctx.logger.info === "function"
      ? (message) => ctx.logger.info(message)
      : (message) => console.log(message);
  log("[dsh-session-beautify] host half loaded; the UI runs in the browser (client half)");
}
