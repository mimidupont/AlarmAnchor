// A ?join=<ID> deep link is meant to be consumed exactly once: it is how a
// scanned QR hands a session code to the app.
//
// Left in the address bar it stops being a one-shot. Every reload — and
// every time that tab is restored, or the bookmark is opened — the app
// auto-joins the same code as a remote monitor. Once that session is gone
// (they last a day, and a boat phone re-mints on a backend restart) the
// result is a red "Session not found" on every single load, dropping back
// to the picker, with no way out except editing the URL by hand. The
// session the user actually wants is fine; the link is the stale part.
//
// Returns the cleaned path+query+hash, or null when there is nothing to
// change, so the caller can skip a needless history entry.
export function urlWithoutJoinParam(href) {
  try {
    const url = new URL(href);
    if (!url.searchParams.has('join')) return null;
    url.searchParams.delete('join');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (err) {
    // Not a parseable URL (or no URL support) — leave the bar alone.
    return null;
  }
}
