# ADR-021: Remote generated images are fetched by the service worker

## Status

Accepted (2026-07-27); redirect/privacy boundary amended 2026-10-28.

## Context

Image export ([ADR-008](008-image-sync-strategy.md), issue #186) captures Gemini's
generated images in the **content script**, on the stated premise that only the
page context can read a `blob:` URL. That premise held when the feature shipped.

It no longer describes the page. Gemini now serves generated images from the
image CDN:

```html
<single-image class="generated-image large luminous-layout">
  <button class="image-button">
    <img class="image animate loaded" alt="（AI 生成）"
         src="https://lh3.googleusercontent.com/gg/ACRwjau…=s1024-rj">
```

The selectors in `SELECTORS.generatedImage` still match this markup — the
regression is not selector drift. The `fetch()` in `image-capture.ts` is what
fails, and the page console names our own call stack:

```
Access to fetch at 'https://lh3.googleusercontent.com/rd-gg/…'
(redirected from 'https://lh3.googleusercontent.com/gg/…')
from origin 'https://gemini.google.com' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.

GET https://lh3.googleusercontent.com/rd-gg/… net::ERR_FAILED 403 (Forbidden)
  I                    @ index.ts:3
  collectPendingImages @ index.ts:4
  attachImages         @ index.ts:4
  extract              @ index.ts:3
```

Host permissions do not help a content script. Chrome's network-request
documentation is explicit:

> Content scripts initiate requests on behalf of the web origin that the content
> script has been injected into and therefore content scripts are also subject
> to the same origin policy. […] Cross-origin requests are always treated as
> such in content scripts, even if the extension has host permissions.

> A script executing in an extension service worker or foreground tab can talk
> to remote servers outside of its origin, as long as the extension requests
> host permissions.

The failure was invisible because `fetchImageAsBase64` returns `null` on any
error. Zero images captured means `note.images` is empty, which sends
`prepareNoteImages` down its early-return branch: placeholders are stripped, so
the note gains no `![[…]]` embed, and `failedImages` stays empty, so no warning
is raised either. Users saw a note that looked entirely successful with the
images simply absent — the symptom reported in issue #376.

## Decision

Split the capture path by URL scheme:

- `blob:` — still read in the content script. Only the page can resolve it.
- everything else — delegated to the background service worker via
  `{ action: 'fetchImage', url }`, matching Chrome's documented remedy
  ("communicate with the service worker via message passing to access
  cross-origin resources").

`https://*.googleusercontent.com/*` remains in `host_permissions` because the
CDN rotates across `lh3`/`lh4`/`lh5`/…. A later upstream observation records
`lh3.googleusercontent.com -> lh3.google.com`. Add only exact
`https://lh3.google.com/*` and CSP connect origin `https://lh3.google.com`, never
`*.google.com`. The latest local selector/auto-scroll canary found one generated
image but twice failed capture; File and Obsidian notes remained byte-identical
without a false image link. This is not evidence that the added permission has
fixed the installed extension.

The worker preserves one browser-managed fetch with `credentials: 'include'`,
`referrerPolicy: 'no-referrer'`, `redirect: 'follow'`, and `cache: 'no-store'`.
There is no retry or anonymous/authenticated fallback. Prior live/retained
evidence records anonymous 403 responses and session-dependent exported links;
this justifies preserving browser-managed authentication rather than replacing
it with an anonymous request. Fetch may send browser-managed cookies to the
permitted CDN/redirect hosts. Liska never reads, serializes, logs, messages, or
persists cookie/request-header values, and never exposes them to the model or
content script. URL presence is reference evidence, not byte availability: a
stale or failed link never becomes a fetched claim. This contract does not prove
that the exact added redirect permission fixes the current canary.

**The URL is validated against an allow-list, twice.** `isAllowedImageSourceUrl()`
requires `https:`, no username/password, the default HTTPS port (explicit 443 is
equivalent), and hostname `googleusercontent.com` or one of its subdomains with
an exact suffix boundary. `lh3.google.com` is rejected as a caller-supplied
source. The source check is enforced at the message boundary in
`validateMessageContent()` and again inside `handleFetchImage()`.

This double check is the point of the design, not ceremony. The whole reason the
fetch moved is that the worker can reach hosts the page cannot — including
`http://127.0.0.1`, where the user's vault and API key live. An unvalidated
`fetchImage` URL would turn the worker into an SSRF proxy for any script able to
post it a message. The handler-side check stands on its own so the guarantee does
not depend on the router staying wired to the validator.

Before checking status, MIME, or body bytes, `isAllowedImageResponseUrl()`
requires a nonempty valid final `response.url` with the same transport
constraints and either the original CDN family or exact `lh3.google.com`.
Rejection best-effort cancels the available body without reading it. Network
and final-URL failures use fixed local strings, never raw exception text or URLs.

Intermediate redirect hops are browser-managed, not observable or validated
per-hop by this implementation. Final-host validation is response acceptance,
not a full egress proof; it does not undo requests the browser already made.

Size and MIME caps (`MAX_IMAGE_SIZE_BYTES`, `isAllowedImageMime`) are applied on
the worker path too. The actual stream is capped at 10 MiB even if a length
header is absent or false; a larger declared length rejects early. One existing
five-second AbortSignal/deadline spans the fetch, redirects, and all body reads.

## Consequences

- The original #376 fix restored the then-observed images. The October redirect
  amendment is implemented/offline-verified only: a fresh installed-extension
  authenticated image capture and File/Obsidian output comparison remain a
  live gate. Failed captures must not produce false image links.
- **Packaged updates may require re-consent for the added host permission.** Per
  Chrome's permission-warnings documentation: "When an extension adds a new
  permission that triggers a warning it may temporarily disable it. The
  extension will be re-enabled only after the user agrees to accept the new
  permission." Release notes must disclose the expansion; do not promise a
  silent update or infer that every unpacked reload behaves identically.
- The Chrome Web Store listing needs a justification for the new host
  permission: it is used solely to download images the user asked to export.
- `ADR-008`'s rationale ("blob URLs that only the page context can read") is now
  only half the story. It stays accurate for the `blob:` branch; this ADR
  supersedes it for remote URLs.
- The content script no longer touches the network for remote images, so a
  future CDN requires an explicit source/final-host, permission, CSP, and privacy
  review, not an automatic allow-list expansion.
- The worker leaves eligible cookies entirely to Fetch, sends no referrer, and
  does not reuse cached responses. The requested image URL still reaches the
  provider; no conversation text or extracted credential value is sent. This is
  not a claim of per-hop redirect control or live success.
