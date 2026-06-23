// Build the sandboxed-iframe `srcdoc` for a custom collection view (see
// plans/feat-collections-custom-views.md). Pure (takes the server origin
// explicitly instead of reading `window`), so it's unit-testable and keeps
// the script-tag string out of the .vue SFC source.
//
// Injected at the START of <head> so the bootstrap runs before any of the
// view's own scripts:
//   1. a CSP <meta> with connect-src = the server origin (the view may fetch
//      its data endpoint but no third party), and
//   2. `window.__MC_VIEW = { slug, token, dataUrl, origin, onChange, openItem }`
//      — the scoped capability token + the absolute data URL the view reads,
//      plus an `onChange(cb)` live-refresh subscription and an
//      `openItem(id, mode)` helper that asks the host to open a record in its
//      shared modal (see below).

import { buildCustomViewCsp } from "./previewCsp";

/** Debounce (ms) for the in-iframe live-refresh helper — collapses a burst of
 *  parent change-pings (e.g. a bulk write) into a single `onChange` callback. */
const ONCHANGE_DEBOUNCE_MS = 150;

/** The in-iframe bootstrap appended after `window.__MC_VIEW = {…}`. It installs
 *  the view↔host bridge:
 *
 *  - `onChange(cb)`: the view author's one-line opt-in to live refresh. The host
 *    parent (`CollectionCustomView.vue`) relays a `{ type: "mc-collection-changed",
 *    slug }` message into the iframe whenever the collection's data changes; this
 *    validates the message came from the parent, is for THIS collection,
 *    debounces, and invokes every registered callback. The message carries no
 *    secret and only triggers a re-fetch through the token the view already holds.
 *  - `openItem(id, mode)`: posts a `{ type: "mc-open-item", slug, id, mode }`
 *    ping up to the parent, which opens the record in the host's shared modal.
 *    The payload carries no secret (slug + id are already known to the view) and
 *    is sent to the known parent origin (`v.origin`). Opening the host's own
 *    modal is a user action through trusted UI, so it needs no `write`
 *    capability even for `mode: "edit"` — the save still goes through the host.
 *
 *  Self-contained string (no `</script>` sequence, no `<`, no `${`). */
function viewBridgeBootstrap(): string {
  // One line on purpose — it's inlined into the iframe's bootstrap <script>.
  // Uses single quotes throughout (no `</script>`, no `<`, no `${`) so it stays
  // intact inside the template literal and inside the script element.
  // `cbs.slice()` snapshots the listeners before dispatch so a callback that
  // unsubscribes itself can't shift the array and skip the next one.
  return `(function(){var v=window.__MC_VIEW,cbs=[],t;function fire(){t=undefined;cbs.slice().forEach(function(cb){try{cb()}catch(e){}});}window.addEventListener('message',function(e){if(e.source!==window.parent)return;var d=e.data;if(!d||d.type!=='mc-collection-changed'||d.slug!==v.slug)return;if(t)clearTimeout(t);t=setTimeout(fire,${ONCHANGE_DEBOUNCE_MS});});v.onChange=function(cb){if(typeof cb!=='function')return function(){};cbs.push(cb);return function(){var i=cbs.indexOf(cb);if(i>=0)cbs.splice(i,1);};};v.openItem=function(id,mode){window.parent.postMessage({type:'mc-open-item',slug:v.slug,id:String(id),mode:mode==='edit'?'edit':'view'},v.origin);};})();`;
}

export interface CustomViewBootstrap {
  slug: string;
  /** Scoped capability token (Authorization: Bearer <token>). */
  token: string;
  /** Data endpoint URL; absolutised against `origin` when root-relative
   *  (the iframe is `about:srcdoc`, so a relative `/api/...` would not
   *  resolve against the server origin). */
  dataUrl: string;
  /** Explicit server origin — used for both the CSP and the absolute
   *  dataUrl (the sandboxed iframe's own origin is opaque). */
  origin: string;
}

function absoluteDataUrl(dataUrl: string, origin: string): string {
  return dataUrl.startsWith("/") ? `${origin}${dataUrl}` : dataUrl;
}

export function buildCustomViewSrcdoc(html: string, boot: CustomViewBootstrap): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${buildCustomViewCsp(boot.origin)}">`;
  // `<`-escape the JSON so a hostile token/slug value can't break out of the
  // <script> element.
  const json = JSON.stringify({
    slug: boot.slug,
    token: boot.token,
    dataUrl: absoluteDataUrl(boot.dataUrl, boot.origin),
    origin: boot.origin, // target origin for openItem's postMessage to the parent
  }).replace(/</g, "\\u003c");
  const injection = `${cspMeta}<script>window.__MC_VIEW=${json};${viewBridgeBootstrap()}</script>`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)/i, `$1${injection}`);
  }
  return `<!DOCTYPE html><html><head>${injection}</head><body>${html}</body></html>`;
}
