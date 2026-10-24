# Project status

## Confirmed working

- Repository: `la4ox/liska-threadkeeper`; upstream remains `sho7650/obsidian-AI-exporter`.
- Released baseline: `v3.0.0` at `539c1ae`; cleanup work continues from that tagged commit.
- Product identity is `Liska — AI Threadkeeper`, version `3.0.0`; the major version preserves monotonic browser updates from upstream 2.7.13 and marks the independent product/privacy boundary. Release artifacts use `liska-threadkeeper-<version>.zip`. Original MIT attribution is preserved in `LICENSE` and `NOTICE.md`.
- File and clipboard exports work without Obsidian. Obsidian remains an optional output through Local REST API 5.1.0 on exact loopback host `127.0.0.1`. HTTPS health, certificate, and bearer authentication were verified independently on port `27124`. Because Comet's extension service worker did not inherit the tab's self-signed-certificate exception, the browser integration uses the plugin's HTTP compatibility endpoint on `127.0.0.1:27123`. End-to-end DeepSeek sync produced a 2,854,272-byte note with frontmatter `message_count: 1408` and exactly 1,408 rendered role markers.
- DeepSeek signed-in exports use the same-origin history response, reconstruct the selected active branch, preserve Markdown, and optionally include Thinking. DOM/scroll fallback remains available.
- Live DeepSeek export was verified on a 2,803,334-byte conversation: 1,382 messages (691 user + 691 assistant), 690 reasoning blocks, correct first/last roles, and no alternation breaks. It completed in seconds without scrolling.
- DeepSeek now has a provider-specific `liska-capture/1` → `liska-thread/1` adapter on `codex/deepseek-canonical-core`. It preserves exact non-delta history-response bytes, every validated parent/child node, ordered text/Markdown/reasoning/unknown blocks, manifest unknown-type evidence, and a current-node Markdown projection. Durable File/Obsidian outputs receive raw/manifest/canonical companions through provider-bound inline or staged transport; DOM fallback remains explicitly partial and can retain verified raw/manifest evidence after a post-capture normalization failure. The initial metadata-only checkpoint kept every DeepSeek asset honestly `not-attempted`; the later bounded direct-history acquisition path is described below. A post-reload live File smoke on 2026-09-18 preserved a 40,585-byte raw response, a 955-byte manifest, a 67,220-byte canonical archive, and Markdown marked `structured-api / complete`. Raw and manifest hashes linked exactly; all 12 nodes and 11 edges were reachable from one root with no cycle, dangling, or asymmetric link; three reasoning and three unknown blocks remained typed; credential/signed-URL scans of manifest/canonical were clean. The live provider omitted `cache_control`; Liska accepted the self-contained graph while continuing to reject explicit cache deltas.
- A content-free field-shape probe of an older live raw found a `files` array on every message and two populated metadata-only records. The ledger hashes provider IDs into opaque asset IDs, deduplicates only exact IDs, and retains exact raw pointers. Canonical attachment source references now use null provider IDs, so provider IDs and signed transport remain raw-only.
- The public DeepSeek frontend bundle identifies the page-owned metadata resolver as exact same-origin `GET /api/v0/file/fetch_files` with the query key `file_ids`. Bounded live calls for both an older and the fresh synthetic attachment returned metadata but no usable `signed_path`; product code does not call this route and does not copy its bearer, `x-client`, or `x-device` headers. Its URL builder accepts a path under the configured file-service `/api` base and adds resource mode `ty`; this informed validation but does not authorize an active resolver.
- A fresh synthetic 93-byte text attachment supplied `signed_path` in a verified history `FILE` fragment record (`chat_messages[].fragments[].files[]`); the live message-level `files` field was absent. Clicking its card issued no `fetch_files` request; the page performed one direct `GET https://files.deepseeksvc.com/api${signed_path}&ty=r` and received `200 application/octet-stream`, content length 93, and exact source bytes. A later reloaded canary exposed the complementary legacy shape: `message.files` had SUCCESS/id/size but no `signed_path`; after a page-native card click, current-document ResourceTiming contained the exact file-service URL with `initiatorType=fetch` and exact `file_id,state,ty` keys. Liska now inventories both raw locations and, only after raw persistence, merges valid in-band candidates with the newest 512 already-observed timing entries. Every passive URL must pass the full fixed-host grammar, bind its `file_id` uniquely to current verified raw sourceRefs and a recomputed asset ID, and remain runtime-only; in-band wins. The fallback never clicks a card, clears performance entries, or installs an observer, so an attachment not already previewed remains unresolved. Credential-free GETs remain sequential and bounded to 20 attempts, 64 MiB per asset, and 128 MiB total; exact nonempty response URL, passive MIME, declared size, and locally computed SHA-256 are required. Destination results independently govern regenerated manifest/canonical `fetched` claims. Relative `signed_path`, observed URLs, state tokens, and provider file IDs are removed even from degraded canonical blocks and privacy diagnostics.
- Exports require a trusted user click. Programmatic page clicks cannot trigger file, clipboard, or authenticated Obsidian operations.
- Remote image fetch and offscreen clipboard response waits are bounded to five seconds.
- Append mode visibly warns when images in newly appended messages are skipped instead of silently reporting a complete save.
- The experimental `liska-capture/1` and `liska-thread/1` archive layers now preserve exact raw artifact bytes separately from a credential-free manifest, verify artifact and manifest SHA-256 provenance, validate/traverse complete branch graphs, and project either `currentNodeId` or an explicit leaf into the existing flat Markdown contract while reporting legacy omissions.
- ChatGPT's live web-history route was confirmed as `GET /backend-api/conversation/{conversationId}`. A local structural probe observed a direct `mapping` graph with a structural root, a current node, and sibling branches; no personal response body, title, conversation ID, cookie, header, or credential remains in the worktree or was committed. The pure normalizer consumes only hash-verified exact bytes, retains all graph nodes and ordered typed blocks, scrubs signed URLs and account/correlation identifiers from the canonical layer with diagnostics, and uses synthetic fixtures only.
- ChatGPT no-scroll capture is enabled for Chromium 111+ behind a trusted click and the narrow `scripting` permission. A marker-gated MAIN-world script runs at document start only in an inactive disposable conversation tab, observes the page-native exact GET response, and never reads or serializes request headers, cookies, account data, or unrelated traffic. Responses up to 16 MiB use the inline verified path; larger responses up to 64 MiB use the staged transport described below. Control state remains closure-private, background re-verifies bytes and SHA-256 in extension context, and only the created tab is closed.
- The ChatGPT bridge normalizes the complete captured graph transiently, projects the selected current branch through the existing Deep Research safety guard, and falls back to marked DOM/scroll extraction on any capture, integrity, normalization, or projection failure. Personal raw response bytes are persisted only to the user's selected durable outputs, never the repository or clipboard. A live Comet smoke exported 28 current-branch messages (5 user + 23 assistant role markers) while only 5 turn elements were rendered in the DOM, wrote a 31,187-byte Obsidian note, emitted no fallback warning or capture failure code, and left zero marker tabs open.
- ChatGPT capture authorization now treats `sender.tab.url` as the exact current conversation capability while allowing `MessageSender.url` to retain an older same-origin document path after ChatGPT `history.pushState` navigation. Live Comet smokes passed in both directions between ordinary and custom-GPT chats without reload, and a legacy loss-test that redirected from `/c/...` into a project/custom-GPT route completed structured capture without a capture-failure code.
- The fresh private-corpus pass completed structured capture for a branch-heavy conversation and the largest current positive sample. The latter preserved a 13,117,554-byte raw response with matching manifest length/SHA-256, complete graph/branch claims, and a 29,201,569-byte canonical archive.
- Real ChatGPT Canmore messages are now typed at message level instead of flattened as text. A live Canvas recapture retained 10 calls and 10 results as exactly 20 ordered `canvas_event` blocks (2 create and 18 update halves), with no text duplicates, duplicate content metadata, or invalid raw pointers; the exact raw artifact remains the lossless authority.
- The first explicit branch-view slice is live-verified in Comet. The established `Bring thread home` button still exports the provider-declared current path. A separate trusted `Choose branch` control captures and normalizes the complete graph once, builds an iterative deterministic leaf catalog, shows only bounded visible user/assistant previews in a local picker, and projects exactly the selected leaf. A two-leaf private smoke exported both ordinals independently to Downloads and Obsidian from a 725-node graph with one branch point. Both captures produced raw/manifest/canonical companions; each 1,862,119-byte raw matched its own manifest size and SHA-256, and each canonical archive retained schema `liska-thread/1`, 725 nodes, two leaves, and one branch point. The selected Markdown views contained 619 and 66 legacy-renderable messages; the differences from the picker's 651 and 73 canonical message counts were exactly accounted for by explicit non-user/assistant and empty-message omission warnings. Provider node IDs never enter picker DOM or filenames. Selected notes carry capture/branch provenance, use capture-scoped filenames, and bypass append mode so an alternate branch cannot be merged into the ordinary conversation note. Cancellation writes nothing; failures before or after selection never substitute the rendered current branch.
- The all-branches slice is live-verified in Comet. The same trusted picker can choose `Export all branches`; Liska reuses that single capture/normalization, commits raw/manifest/canonical once per durable destination, then reconstructs and writes one leaf at a time followed by a content-free index. A live two-leaf bundle produced exactly two leaf notes plus one index in both Downloads and Obsidian, with one capture directory and three companion files per destination. The companion bytes were identical across destinations; the 1,862,119-byte raw matched its manifest length and SHA-256; canonical retained schema `liska-thread/1`, 725 nodes, two leaves, and one branch point. Both index links resolved in both destinations, leaf frontmatter retained ordinals 1/2 and rendered counts 619/66, and neither the serialized index nor any leaf filename contained the provider conversation ID or URL. All-branch notes and links use capture-scoped identity and the platform origin. Canonical-only leaves receive explicit stubs rather than disappearing. Clipboard is skipped with one compact warning, progress is reported in ten-branch steps, and a destination receives its index only after every leaf file there succeeds. The catalog retains only targets, counts, and unique suffixes: tests cover 12,000-node depth, a 2,000-node shared prefix with 400 leaves without prefix multiplication, and an 80-leaf sequential bundle with no branch-count ceiling.
- ChatGPT attachment references now receive an offline-first capture ledger before normalization. A content-free structural probe of 16 locally saved raw snapshots confirmed coexisting `sediment:`, older `file-service:`, and metadata-only ID forms without emitting message text, filenames, IDs, URLs, or transport values. The inventory handles content parts plus metadata `attachments`/`files`, deduplicates only exact IDs or exact pointers, keeps same-name ambiguities separate, maps each opaque SHA-256-derived ledger ID to exact raw pointers, and records `not-attempted` rather than falsely claiming unavailable or fetched. A malformed or ambiguous inventory degrades only asset completeness to `unknown` with a stable warning; it does not destroy the verified raw capture.
- The attachment ledger is live-verified in Comet on a private ChatGPT capture without inspecting message bodies, attachment names, IDs, or transport values. The manifest and canonical archive each contained seven assets—four `image_asset_pointer` sources and three metadata records—all in `not-attempted`; every manifest raw pointer resolved to an exact object in the verified raw artifact. Four transport references remained only in raw evidence, while manifest and canonical contained zero `sediment:`/`file-service:` values and zero signed-query markers. The capture directory contained only raw, manifest, and canonical JSON. Downloads and Obsidian copies were byte-identical for all three files, and the raw length/SHA-256 matched its manifest.
- A bounded live route probe on that capture confirmed three `file-service:` image pointers matching three metadata IDs plus one distinct `sediment:` pointer. All four rendered sources used exact same-origin `GET /backend-api/estuary/content` with the query-key schema `cid,id,p,sig,ts,v`; values were never emitted or retained. The four responses were successful `200 image/png` transfers of approximately 1.40, 1.98, 2.59, and 2.77 MiB. Inspection of the already loaded public ChatGPT frontend modules—without another private-data request—confirmed that both pointer schemes are stripped to a file ID, then resolved through the frontend's `/files/download/{file_id}` API helper with conversation context and inline intent; success yields `download_url`, while `file_not_found` and `file_expired` are explicit provider error codes.
- Earlier file-ID resolver work established that Liska must never reconstruct provider authorization or read header/cookie values. The current boundary observes only an exact page-owned helper response, validates its signed same-origin content URL, and performs one browser-authenticated same-origin content GET. Chrome attaches eligible session credentials; extension code never reads, copies, serializes, logs, or persists them.
- Asset acquisition evidence is now fail-closed. `fetched`, `expired`, and `failed` require an attempt timestamp; `not-attempted` and `declined` cannot claim one. Every fetched manifest asset must have exact runtime bytes whose record, length, and SHA-256 are reverified before normalization, and fetched canonical assets require a local path, byte length, and hash. The initial JSON-only ChatGPT companion builder still rejects runtime asset bytes; a separate binary-aware finalizer can accept them only after destination results exist, so no ordinary capture can publish a dangling `fetched` claim. Stable provider file IDs remain only in local canonical source references; signed URLs and `sediment:`/`file-service:` transport values remain raw-only.
- The staged binary persistence route is now connected only to the explicit ChatGPT image-export path. Verified runtime assets are handled sequentially; each crosses Chrome 111 JSON messaging only as independently canonical 512 KiB chunks, is staged under an exact random ID in extension-origin OPFS, and is rechecked for byte length and SHA-256 before output. Persisted names are capture-scoped `assets/<sha256>.<allowlisted-extension>` paths; provider filenames, IDs, signed URLs, and credentials never enter them. Clipboard is rejected; active SVG/HTML/script and macro-capable formats are rejected; File and Obsidian report independent per-asset outcomes; Downloads confirms the actual terminal path after `uniquify`; Obsidian uses no-overwrite preflight plus binary readback/hash verification. A failed release retries one exact abort and reports `binary-stage-cleanup-deferred` if deletion remains unconfirmed. Unconfirmed Downloads ownership is first persisted as a null-ID provisional record, atomically receives Chrome's numeric ID when available, and is reconciled by top-level terminal/startup listeners after MV3 worker suspension or browser restart. The local record is bounded and contains only download ID, random stage ID, extension Blob URL, and timestamp—never archive content or provider identity. A current worker keeps ownership across File and Obsidian siblings; a fresh worker exact-cleans orphaned ownership. Aged exact remnants are pruned only in bounded recovery.
- The staged route is live-verified in Comet with a six-byte synthetic asset and no ChatGPT request or conversation-body read. With Obsidian intentionally stopped, Downloads still succeeded independently and retained exact bytes `00 01 02 03 FE FF` with SHA-256 `7ea646958715ed687aa9ac2f5d785feb1a93411f4f25fdd6c7fcc6ab07fdf0e3`, while Obsidian returned the fixed preflight failure. After Local REST API resumed, a fresh capture wrote byte-identical content-addressed files to both `D:\Downloads` and the configured Obsidian vault, with no warning or error. The temporary trusted-click smoke content script existed only in ignored generated `dist/`; a clean production rebuild removed it and its manifest entry. Two stale generated duplicate files that blocked Vite output cleanup were removed exactly; no source or user archive was deleted.
- The page-owned ChatGPT attachment boundary now has a separate post-persistence opaque resolver observer for the experimental replay route. It opens only after at least one destination has durably written and reverified the initial replay raw. Because ChatGPT defers attachment rendering in hidden documents, the trusted-click observer tab is briefly foregrounded and then exact-closed. The exact marker-gated hook checks only the native plural request URL/method, credentials mode, boolean authorization membership, status, and JSON media type; it reads no plural source body or header value and dispatches zero singular graph requests. A live foreground smoke proved that the earlier two-second window could still open after ChatGPT's cached UI had already requested its image. The corrected state machine starts a dedicated non-extendable eight-second window immediately before the eligible plural source fetch and publishes only after both source `200 JSON` validation and window expiry, in either order. Current public ChatGPT bundles then exposed a second compatibility gap: manual `Vbt` uses `/files/download/{file_id}` with an optional same-conversation `check_context_scopes_for_conversation_id`, while automatic file display/cache can use `/calpico/chatgpt/files/{file_id}`. The observer now accepts only the exact legacy two-key query in either order, the exact scoped three-key query in six orders with both IDs equal to the captured conversation, or the exact query-free Calpico path. Extras, duplicates, aliases, fragments, suffixes, and mismatched IDs fail closed. It still accepts at most 32 responses of 64 KiB each. Background independently revalidates exact shape, base64, length, SHA-256, JSON, signed-URL conversation binding, and committed-raw provider-ID correlation before returning an opaque key plus transient URL. Fresh independent reviews found no material P0-P2 defect.
- Destination-honest attachment orchestration remains trusted-click and raw-first: only raw-successful File/Obsidian destinations continue, Clipboard cannot receive archive binaries, and a zero-asset ledger skips resolver work. The legacy file-ID checkpoint remains metric-only and never acquires bytes. Interpreter acquisition is a separate exact route; it fetches resolved bytes immediately before the remaining-only legacy audit, shares one bounded budget across families, stages once, and writes destination-specific manifest/canonical truth.
- The Standard Codex Security scan of revision `3aa2e8d` reported one medium and six low findings with partial repository coverage. Static follow-up confirmed the useful engineering claims while narrowing the ChatGPT navigation consequence. This working tree closes four relevant boundaries: Deep Research identity is now SHA-256 content-addressed rather than title-only; collision-renamed Obsidian notes use the same resolved namespace for images and wikilinks; common credential aliases are removed from canonical provider extensions and URL queries; and temporary ChatGPT capture is conversation-bound. These fixes are offline-verified but not yet live-browser verified.
- Legacy Markdown warnings now distinguish retained attachment references/metadata from binary files. They no longer imply that omitted attachment bytes were saved merely because canonical JSON succeeded.
- Obsidian archive companions are transported to Local REST API as `application/octet-stream` while retaining `.json` filenames and manifest media types. This avoids the plugin's `application/json` parser/re-serializer and preserves exact bytes for binary readback. Obsidian-only and immediate File+Obsidian live smokes produced Markdown plus raw/manifest/canonical companions; each raw matched its manifest byte length and SHA-256, and all three archive files were byte-identical across Downloads and Obsidian. Fixed allowlisted stage codes report preflight/PUT/readback failures without exposing paths, identifiers, API responses, or exception text.
- `npm run build` and platform lint pass. ESLint has no errors and three pre-existing warnings outside the first-release changes.
- The DeepSeek archive and synthetic attachment canary are verified in draft PR [#8](https://github.com/la4ox/liska-threadkeeper/pull/8). The Obsidian API-key migration is fail-closed and serialized in the service worker in draft PR [#9](https://github.com/la4ox/liska-threadkeeper/pull/9): runtime reads never fall back to the legacy sync secret, and popup saves use a validated worker route. Their local integration preserves both sender gates; combined validation and live File+Obsidian smoke are pending.
- ChatGPT checkpoint PR [#7](https://github.com/la4ox/liska-threadkeeper/pull/7) is merged at `588d390`. PR #8 and PR #9 are separate draft review surfaces; neither is merged or released. Release and merge decisions remain explicit.

## Important limits and risks

- Obsidian browser sync currently sends the bearer over unencrypted HTTP on the local loopback interface because the extension service worker cannot use Comet's tab-scoped certificate exception. The Local REST API binding and Liska's privileged URL validation both restrict this route to exact host `127.0.0.1`; never expose or rebind it to a LAN or Internet interface. HTTPS remains enabled for clients that can explicitly trust the plugin certificate.
- ChatGPT no-scroll current-branch export is live-verified in Comet. DOM/scroll extraction remains a marked fallback for unsupported browsers, provider drift, unavailable document-start state, oversized payloads, and any failed integrity/normalization/projection check.
- The first trusted-click attachment stress smoke on a long branch/voice/Deep-Research conversation failed before raw capture with the stable `conversation-request-timeout` code. The attachment orchestrator therefore never observed resolvers, fetched bytes, or wrote a destination manifest. Read-only structural diagnostics found only six rendered turn nodes; the 479,837-character `client-bootstrap` JSON contained route/session metadata but no `mapping`, `current_node`, or conversation graph. The 142 public JavaScript modules already loaded by that ChatGPT build contained no literal legacy `backend-api/conversation` route. A user-approved reload of only a duplicate test tab, observed without request/response bodies, headers, cookies, or message text, identified the replacement page-owned request: `GET /backend-api/conversations/{conversationId}?include_has_versions=true&num_turns=10`, returning `200 application/json`. The legacy singular endpoint was not requested. Both branch controls enter the same structured capture before catalog construction, so branch count did not cause the timeout; `Choose branch` merely refused the partial DOM fallback. The `num_turns=10` request may itself be partial, so its response structure must be classified before Liska can mark any graph complete. The first CDP buffer no longer retained that response body when structural-read approval arrived; no raw body was read or saved. Later approved reloads, including a cache-bypassing reload whose cache setting was immediately restored, reused provider-managed page state and emitted no plural conversation request. A separately created ephemeral tab, armed on the neutral ChatGPT origin and closed after one target navigation, also inherited that shared state and emitted no plural request. This drift motivated the separate `A-strict` opaque-template experiment rather than another DOM-scroll fallback.
- A read-only static inspection of the locally installed green AI Exporter `4.4.1` package explains its fast `718/718` preview without reading browser storage or message content. Its document-start page-world bridge wraps ChatGPT `fetch`, captures the value of `Authorization` plus `chatgpt-*`/`oai-*` headers in page memory, exposes them to the content script, reads `oai-did` from `document.cookie`, and explicitly performs `GET /backend-api/conversation/{conversationId}` with those headers and `credentials: include`. It therefore bypasses the virtualized `num_turns=10` UI path and still receives a full `mapping` from the legacy singular endpoint in one request. Its parser does not preserve that graph: by default it selects the reachable leaf with the greatest `message.create_time`, flattens the root-to-leaf path, and never consults `current_node`. An internal `otherBranchMessages` projection exists behind `includeAllBranches`, but no ordinary caller enabling it was found; the preview count is not proof that alternative branches were retained.
- The green AI Exporter preview handoff itself is local: the flattened result is stored in extension IndexedDB `chatPreviewDB.chatMessages` with a default seven-day retention and then opened by ID. Its privilege/privacy surface is much wider than Liska's: `*://*/*`, `cookies`, document-start injection, captured bearer/device headers, Google Analytics, remotely enabled Sentry, and header-rewriting rules for Notion/Googleusercontent. PDF export explicitly sends the normalized message payload to `api-service.saveai.net/api/v1/make/power/pdf` (or its unauthenticated limit route) and downloads the returned URL. Explicit Notion export similarly uploads Markdown before importing it. Routine preview creation was not found to upload the conversation body, but ChatGPT conversion failures may send structural context such as mapping counts and root/leaf node identifiers to Sentry; success telemetry also leaves the machine.
- A focused Sol Max architecture review recommends an `A-strict` active-capture experiment and rejects explicit credential extraction as a fallback. The marker-gated MAIN closure may retain a clone of one exact branded plural-conversation `Request` only after verifying exact origin/path/query/UUID, no `fetch(request, init)` override, acceptable credentials, and boolean authorization-header presence. A new singular-endpoint `Request` may copy that `Headers` object opaquely inside the same page realm, but must not read, iterate, serialize, log, message, or store header/cookie/token values. It must use a fresh abort signal, exact same-origin URL, `GET`, `redirect: error`, `cache: no-store`, one dispatch, no retry, and the captured previous fetch. Explicit bearer/device extraction like the green exporter remains forbidden. The strongest residual risk is operational rather than Fetch semantics: provider-managed warm state may suppress every eligible template request in a disposable tab.
- The disabled-by-default `Experimental ChatGPT metadata probe` is implemented without active replay. It has a separate exact message/response contract, a 45-second page deadline inside a 50-second disposable-tab envelope, and exact late cleanup. Two initial warm Comet runs against the current ChatGPT build reached the exact branded plural request and returned `init-present`; after adding value-free RequestInit classification, two further runs after a full extension/page reload both returned `eligible-init-empty` in 6–6.5 seconds with Obsidian intentionally stopped. The probe made zero singular dispatches and exported nothing. A live-discovered ordering bug that required a reachable Obsidian output before the no-output probe is fixed and regression-tested. The MAIN observer classifies RequestInit without reading property values: only absent, null/undefined/ordinary empty, or ordinary exact `signal`-only shapes can proceed to response metadata; header/body/method/credentials-bearing, unknown, custom-prototype, polluted-prototype, throwing Proxy, and malformed shapes fail closed. Exact origin/path/raw query and GET are established before `Request.clone()`, so cross-origin/query/fragment/POST mismatches cannot tee a body. The observer reads only the non-secret credentials mode, boolean `Headers.has('authorization')`, response status, and JSON media type; it never reads request-header values, cookies/storage, or response/conversation bodies. `singularDispatchCount` is structurally fixed to zero, and exact bridge validators reject enumerable, non-enumerable, and symbol extras. Independent review found and rechecked lifecycle, URL-primordial/original-fetch transparency, prototype-pollution, exact-shape, and pre-clone-gating fixes as ready. A transparently lying Proxy remains a documented JavaScript limitation in the current no-replay diagnostic.
- The disabled-by-default replay switch now means **force replay directly**. In normal mode the passive observer waits 15 seconds for a graph request; only `conversation-request-timeout` permits one automatic replay. A claimed request receives its own 180-second response window and is never replayed. Probe and force-replay remain mutually exclusive; each replay dispatches at most once. Explicit replay failure stays fail-closed, while a failed automatic fallback may still produce the existing honestly marked DOM current-branch export. The previously verified stress capture retained its complete 1,083-node graph without credential or signed-transport residue.
- The catalog and writer no longer multiply shared prefixes, but the picker still renders every leaf option in the page DOM; hundreds are covered offline, while extremely wide graphs may eventually need a virtualized list. File Downloads can externally uniquify a manually colliding filename without returning the actual name; capture-scoped UUID filenames make ordinary collisions negligible, but that adversarial collision remains unverified and suppressing the index cannot yet be guaranteed for File as it is for Obsidian.
- Earlier generic `capture-failed` results on project/custom-GPT and ordinary chats were reproduced as an SPA sender-URL mismatch and resolved by the bounded same-origin authorization fix. Fresh legacy, branch-heavy, large, and Canvas smokes did not reproduce those fallbacks. Future provider drift still falls back safely: with auto-scroll disabled, Markdown contains only the rendered DOM subset and is marked `dom-fallback / partial`; user-visible warnings expose only stable stage/error codes.
- Successful ChatGPT structured capture now writes immutable raw JSON, its credential-free manifest, and canonical `liska-thread/1` as separate companion files under `_liska-archive/<opaque-conversation-key>/<capture-id>/` for each selected durable output. Downloads use private Blob URLs rather than data URLs; Obsidian writes are binary-read-back and SHA-256 verified; Clipboard never receives archive bytes.
- Live sub-16-MiB captures produced all three Downloads companions, matched raw SHA-256 to their manifests, retained complete graphs/branches, and generated canonical archives. Markdown frontmatter records `capture_mode: structured-api` and `capture_completeness: complete` while explicit warnings enumerate content that the legacy renderer omits.
- Raw and manifest persistence precede normalization. If provider normalization fails, those two companions remain downloadable for deterministic offline repair; canonical is appended only after normalization succeeds. Deep graph validation is iterative, so long linear conversations no longer overflow the JavaScript call stack.
- The first temporary-tab implementation bounds a single ChatGPT conversation response to 16 MiB and holds a base64 transfer transiently in memory. The largest current live sample is already 13,117,554 bytes, leaving limited headroom. Larger captures need staged local persistence instead of silently raising or hiding the limit.
- Live resolver evidence now contains five empty bounded outcomes and closes the passive-observer experiment. An older seven-reference conversation produced two immutable byte-identical 1,472,828-byte raw captures because a browser-control timeout obscured the first successful click; no files were removed. A newer conversation produced background, foreground, eight-second pre-dispatch, and strict multi-route captures, each with one 1,284,848-byte raw, 17 manifest/canonical references, complete graph/messages/branches, zero attempted/local claims, zero binary files, clean durable transport scans, and no leftover marker tabs. The final run observed the foreground marker lifecycle from zero to one and back to zero while allowing both current public endpoint contracts, yet still received no resolver response. Its verified raw contained eight `sediment:` pointers and no estuary/signed URL, while the active page structurally displayed one direct estuary image. A credential-free scan of the current public React Router manifest and 264 conversation JS modules confirmed that ChatGPT's typed `safeGet` client owns the resolver routes; no private response, cookie, or chat text was used. Current runtime evidence therefore shows that these calls do not surface through the tested `window.fetch` observer path. Real resolver/acquisition, signed-URL lifetime, real attachment MIME behavior, and forced MV3-suspension recovery remain gaps. One asset is capped at 64 MiB until Obsidian upload/readback becomes fully streaming; chunks remain 512 KiB and no whole-asset base64 message is created.
- The first active metric-only trusted-click smoke completed on a short current conversation whose rendered page contained seven direct estuary images. One stale pre-reload click failed before settings read with `Extension context invalidated`, created no marker tab, and wrote nothing. After reloading that page, one real click opened exactly one active marker tab and exact-closed it without duplicates. File output produced one Markdown plus raw/manifest/canonical companions and zero binary files. The 1,284,848-byte raw matched its manifest length and SHA-256, retained 280 graph nodes, and projected complete structured Markdown with 83 messages. Manifest and canonical each retained 17 assets, all `not-attempted`, with zero attempt timestamps, local paths/artifact refs, or acquired hashes. Structural scans of durable JSON found zero provider-ID/auth keys, resolver bodies, transport pointers, estuary URLs, or signed-query values. The short count-only toast expired before observation, so a positive `observed N/M` result is not yet proven and the smoke must not be repeated blindly. The same internally reconstructed safe warning is now duplicated to a local `[G2O]` console entry and the final destination manifest. Both contain only counts; IDs, URLs, response bodies, and conversation content remain excluded. Invalid, negative, reversed, non-integer, or over-cap metrics fail archive finalization rather than persisting.
- One fresh post-reload capture read the durable v1 metric exactly once: `ChatGPT active resolver observed 0/16; binary acquisition remains disabled.` The capture again produced one Markdown plus three archive JSON files and zero archive binaries. Raw retained 280 nodes and matched manifest length/SHA-256; Markdown remained `structured-api / complete` with 83 messages; all 17 manifest/canonical assets remained `not-attempted` with zero attempted/local evidence. Durable structural scans again found zero resolver/auth/provider keys, transport pointers, estuary/signed URL values, or signed-query values. The metric proves that settings were correct, raw verification succeeded, 16 exact ledger-derived IDs were planned, and zero validated resolver responses reached content. It does **not** distinguish a safe early runtime failure from 16 dispatched requests with zero valid responses because metric v1 omitted failure code, dispatch count, and outcome histogram. This is a telemetry gap, not user error and not yet a conclusive route failure.
- Audit v2 now preserves the existing background result without widening the privacy boundary. A completed diagnostic becomes one exact aggregate line containing requested, dispatched, observed, and a stable eleven-code outcome histogram. An early or otherwise incomplete failure instead records `dispatched=unknown`, `outcomes=unavailable`, and one allowlisted stable failure code; it never fabricates dispatches or per-ID outcomes. The detailed line is reconstructed from strictly validated numbers/enums only and is stored in the destination manifest; the toast remains short. Provider IDs, timestamps, URLs, statuses, headers, bodies, exception text, and conversation content are not representable in the durable metric. Invalid counts, keys, totals, ordinal arithmetic, origin-stage codes, or failure combinations fail archive finalization. The attachment ledger and binary behavior are unchanged: every record remains `not-attempted`, acquisition/staging stay disabled, and there is still no retry, Calpico fallback, route widening, source-body/DOM capture, or header-value extraction.
- The one approved audit-v2 live run resolved the v1 ambiguity without widening capture. Its exact aggregate was `requested=16; dispatched=16; observed=0; outcomes=observed:0,http-error:0,rejected:16,non-json:0,oversized:0,timed-out:0,not-dispatched:0; failure=none`. Therefore the lifecycle, one-shot command, and all 16 dispatches completed; this was not a settings or early-runtime failure. No resolver response passed the existing safe acceptance boundary. The new package contained exactly Markdown plus raw/manifest/canonical, no binary files; raw matched the manifest byte length and SHA-256; all 17 manifest assets remained `not-attempted` with zero attempted/local evidence. The aggregate `rejected` code intentionally does not retain whether rejection occurred in native fetch or later body/URL validation. This active route is now closed as reference-only: do not repeat it, connect acquisition, add a fallback, or weaken the diagnostic boundary.
- The user's plausible endpoint-specific authorization hypothesis justified one narrower follow-up without reading credentials. Generic active `rejected` was removed and split into page-owned `fetch-rejected`, page-owned `response-processing-rejected`, and background-owned `payload-validation-rejected`; MAIN cannot originate the last code. Inventory remains 20-reference-capable while every live diagnostic boundary is physically capped at one deterministic ID. A fresh Sol review found and rechecked a setup/fetch attribution bug: Request-construction failure now terminates promptly as `hook-state-failed` before `dispatchCount` changes, rather than producing a contradictory fetch outcome. The one approved live result was `requested=1; dispatched=1; observed=0; payload-validation-rejected=1`, with every other outcome zero and `failure=none`. Therefore Request construction and fetch succeeded, ChatGPT returned `200 JSON`, page-side bounded clone/body/hash processing succeeded, and rejection occurred only in background payload validation. The output contained exactly three capture JSON files plus Markdown; raw matched manifest length/SHA-256; all 17 assets remained `not-attempted` with zero attempted/local evidence; no binary existed; `Syncing` ended and the marker tab exact-closed. This rules out a fetch-level absence of authorization but does not rule out an endpoint-specific authorization/error envelope encoded as `200 JSON`. The remaining likely boundary is a missing/changed `download_url` or a signed URL that fails exact conversation binding. No automatic retry is permitted.
- A fresh neutral-page inspection of 57 already loaded public ChatGPT scripts—without a conversation route, private response, storage, cookie, or header read—identified the concrete mismatch behind that payload result. Current `SendIfAvailable` file helper keeps preview mode (`conversation_id` plus `inline=true`) separate from explicit download mode (`download_intent=true` plus `check_context_scopes_for_conversation_id`); Liska had combined preview and scope parameters into an unsupported hybrid. Current success handling requires `status === "Success"` and then reads top-level `download_url`; `file_not_found` and `file_expired` remain explicit error codes. The local fix now uses exact explicit-download parameters, requires the Success envelope in active and shared passive parsers, and replaces generic background payload rejection with value-free `payload-integrity-rejected`, `download-url-missing`, and `download-url-binding-rejected`. A fresh reviewer found and rechecked the missing-status protocol gap before live use. Default conversations are covered; optional `gizmo_id` for some custom-GPT attachments is not yet derived and remains an explicit limitation.
- The one approved corrected-build smoke returned `requested=1; dispatched=1; observed=0; download-url-missing=1`, with every other outcome zero and `failure=none`. Exact download-mode therefore constructed and fetched successfully, and response bytes passed page processing plus background media/base64/length/SHA validation; no acceptable own `status === "Success"` plus string `download_url` envelope remained. The current value-free code deliberately cannot distinguish `Retry`, `file_not_found`, `file_expired`, another non-success status, malformed JSON, or a protocol-violating Success without URL. Because the deterministic first ledger ID is not freshness-ranked, an old unavailable attachment is a plausible explanation and this result does not show that the corrected route fails for fresh files. Output contained exactly Markdown plus three capture JSON files; raw matched manifest length/SHA-256; all 17 assets stayed `not-attempted` with zero attempted/local evidence; no binary existed; `Syncing` ended and the marker tab exact-closed. No automatic retry is permitted.
- Two separate user-approved clicks on actual visible attachment controls revealed that neither used the file-ID resolver. Each page action issued `GET /backend-api/conversation/{conversationId}/interpreter/download` with only the query keys `message_id` and `sandbox_path`, received `200 application/json`, then fetched a signed `/backend-api/estuary/content` URL and received `200 application/vnd.openxmlformats-officedocument.wordprocessingml.document`. The second helper response was confirmed as a fresh network response; signed DOCX responses were served from the browser disk cache and completed without failure. Query values, file/conversation/message IDs, headers, response bodies, filename, and content were not emitted or retained. Neither click produced a Playwright download event or a new file in `D:\Downloads`, so physical save is not claimed. This independently repeated flow proves that these visible cards are interpreter/sandbox outputs and that ChatGPT attachment acquisition is a discriminated family rather than one resolver: ordinary file-ID download, interpreter `message_id + sandbox_path`, and library-ID download have separate provider contracts. The current active file-ID diagnostic must not be generalized to interpreter/library assets.
- A user-approved real `Скачать файл` action confirmed the provider mechanics: interpreter helper 200, signed-content 200, and a physical valid PDF download. The final fresh Liska canary refined that result: the signed content GET must retain the browser-managed same-origin session. With `credentials: include` and no cookie/header access, one exact DOCX persisted successfully through the same content-addressed staged pipeline.
- Interpreter candidates now come from two exact committed-raw structures: metadata attachments at `/mapping/{node}/message/metadata/attachments/{i}`, or direct assistant-rendered Markdown links whose destination is `sandbox:/mnt/data/...`. Both bind the same-node `message.id`; message/path identity is hashed before it reaches the manifest, so filenames and sandbox paths remain raw-only. User/tool content, arbitrary strings, image syntax, inline/fenced/indented code, malformed/double encoding, traversal, controls, backslashes, ambiguous assets, and unsafe IDs fail closed. Multiple links in one text part receive distinct opaque IDs; exact pairs deduplicate deterministically; the cap remains 20.
- The interpreter adapter is live-verified behind the trusted-click `Export images & attachments` gate on standard `/c/{conversationId}` DOCX and PDF outputs. The pinned helper accepts own-field `status` values `Success` or `success`, ignores extra descriptive fields, and returns only a validated signed URL. Legacy URLs retain UUID `cid` binding; current exact `id,fn,cd,ts,p,cid,sig,v` URLs use numeric `cid` and are bound by the exact same-conversation helper route, pinned document, and committed-raw message/path pair. Content performs one immediate same-origin GET with browser-managed `credentials: include`, `redirect: error`, `no-referrer`, and `no-store`; it never reads or serializes cookies/headers, adds no cookie permission, and never retries. Interpreter bytes are acquired before the remaining-only legacy audit; both families share one 20-attempt/128 MiB budget and persist once. The earlier DOCX canary saved 38,620 verified bytes with valid ZIP entries and exact manifest/canonical evidence. Custom-GPT, library-ID, Calpico fallback, retries, and broad raw/DOM scanning remain unsupported.
- The post-image-fix File-only mixed-attachment canary is live-verified, with **partial overall attachment coverage**. One trusted click after extension/page reload saved a 2,313,476-byte PNG and a 51,741-byte PDF, plus raw (112,121 bytes), manifest (4,377 bytes), canonical (218,453 bytes), and Markdown (15,669 bytes / 16 presentation messages). The PNG is byte-for-byte identical to the separately retained native ChatGPT download, including SHA-256 and its 1448 by 1086 PNG dimensions. Both binaries match actual length/hash/path claims in manifest and canonical; PDF header/EOF passes, without a semantic or visual PDF-review claim. Raw length/SHA-256 matches manifest, and canonical input hashes the exact manifest. Raw and canonical retain identical 36-node / 35-edge graphs, ordered child links, single root/leaf, and current node; all nodes are reachable, with no dangling references or cycles. All six asset IDs, states, and seven raw pointers reconcile across layers. Two assets are `fetched`; the PNG combines two exact raw pointers without duplicate bytes. The prior DOCX and three PNG metadata records remain `not-attempted`, with no attempt timestamps, acquired hashes, or local paths. Their references are preserved; availability or expiration is not established. Manifest warnings are empty, Markdown remains `structured-api / complete`, and the scoped manifest/canonical scan found zero checked runtime resolver/credential keys or signed estuary URLs. Exactly one new capture and one Markdown were added, both older snapshots remain, and no marker tab remains. No Obsidian or clipboard output was requested.
- A long branch-heavy ordinary-chat canary exposed a loss-order bug before attachment acquisition: 267 individually valid asset records included five assistant text parts containing 2, 2, 3, 3, and 4 distinct sandbox links, so the old global one-pointer/one-asset invariant rejected the enriched manifest and discarded an already verified raw response. Source refs now remain unique within each asset, while distinct opaque assets may share one exact raw scalar pointer; ambiguous matching never selects an arbitrary record. The latest post-offscreen-fix strict replay, with acquisition/scroll/append disabled and File-only output, produced raw 9,834,958 bytes, manifest 137,507 bytes, canonical 20,261,613 bytes, and Markdown 2,090,849 bytes. Independent local verification plus parent raw-hash readback confirmed raw length/SHA-256 against manifest and canonical input linkage to the manifest. Raw/canonical have identical node IDs, parent/child edges, roots, and current node: 2,285 reachable nodes, 2,284 edges, 239 leaves, 68 branch points, max fan-out 10, no missing references or cycles. Both retain 267 assets as `not-attempted`, with no acquired binaries and zero manifest warnings. Markdown reports `structured-api`, `complete`, and 927 presentation messages. All outputs are new snapshots; no older export was replaced and no marker tab remained. Canonical has 7,259 diagnostic entries whose message semantics were not audited in this transport checkpoint; their presentation remains separate work. Canonical byte lengths on 243 unacquired assets are permitted provider metadata (`resolvedAssetFields`), not evidence of fetched files; all lack a local artifact reference and acquired hash.
- Structured graph transport now has an explicit `inline | staged` boundary. ChatGPT responses up to 16 MiB keep the live-verified inline route; larger ChatGPT raw responses up to 64 MiB and DeepSeek raw responses above 16 MiB use independently canonical 512 KiB chunks. Background creates a random 192-bit `archive-stage-*` capability in the separate `liska-archive-stages` OPFS namespace, accepts only sequential offsets (or an exact byte-identical acknowledged retry), and seals only after final length/SHA-256 verification. Content reassembles and rehashes raw solely for the existing non-streaming normalizer. Raw remains staged until its selected durable outputs finish; canonical JSON above the 32 MiB inline limit uses the same staged route, while manifest remains inline and never records the stage ID. File/Obsidian paths remain append-only; Obsidian retains binary readback/hash verification. File ownership survives MV3 suspension in a bounded local registry containing only download ID, random stage ID, extension Blob URL, and timestamp. Null callback IDs are never guessed and quarantine exact cleanup for at most 24 hours. Archive-stage messages require the exact top-frame conversation document for their declared ChatGPT or DeepSeek source, while offscreen accepts only the same-extension worker without tab/document metadata. Fresh independent review found no residual P0-P2 issue after source binding, cleanup propagation, and privacy hardening.
- Synthetic staged-graph evidence covers the exact 16 MiB boundary, a complete 20 MiB raw capture, canonical JSON above 32 MiB, UTF-8 split boundaries, duplicate/gap/overlap/conflict handling, OPEN/SEALED retries, exact sender/offscreen gates, cancellation, File/Obsidian release, and fresh-worker terminal recovery without a whole-payload runtime message. A real-provider response above 16 MiB remains unverified. Explicit opaque replay deliberately remains on its existing 16 MiB inline cap rather than becoming an oversized fallback.
- The staged path is now live-verified in Comet after correcting an offscreen-only API mismatch. A zero-byte diagnostic returned `offscreen-worker-entry-unavailable`: Chromium does not expose `runtime.getManifest` to offscreen pages. The exact worker URL is now read once from the installed package's own manifest with a three-second, no-credentials/no-redirect fetch; content tabs and extension documents remain rejected, and no storage operation begins before sender verification. Live zero-byte begin/abort passes. A 16,777,264-byte synthetic stage crossed 33 bounded chunks in 3.792 seconds with an exact SHA-256 readback and acknowledged abort. Two 131-byte synthetic JSON File outputs matched filesystem length/hash; the refined control also proved readable bytes before commit and an unavailable stage after output. No chat data entered those synthetic probes. New live offscreen entrypoint: `offscreen-DFZtwxPD.js`; worker entrypoint: `service-worker.ts-DkgHGaUn.js`.
- Two scan-derived hardening items remain outside this checkpoint: shared structural work budgets for recursive ChatGPT/DeepSeek normalization, and aggregate work/write ceilings for all-branches export. The last item is also practically relevant to unusually wide personal chat graphs even though its security impact is low.
- One earlier settings run attempted an Obsidian archive write after the user had visually disabled that output without a confirmed persisted update. Destination toggles now send an acknowledged popup-only background update, apply an in-memory override before `chrome.storage.sync` completes, and serialize rapid changes. Live Obsidian-only followed immediately by File+Obsidian smokes confirmed the toggle/readback path.
- Automatic scheduled backups are not implemented; every export starts from a real user click.
- Provider-controlled frontmatter strings now quote leading `?`/`,` indicators
  and encode forbidden C0/C1/BOM-sentinel characters as `\\uXXXX`. Existing
  newline/tab/YAML escapes and byte-stable ordinary strings remain unchanged;
  focused coverage includes provider titles, block-sequence tags, append
  parsing and the common note generator used by File, Clipboard and Obsidian.
- DeepSeek images are not captured. The existing attachment pipeline is mainly Gemini-specific and bounded to 20 images, 10 MiB each, and 48 MiB combined base64 data per note.
- Append mode does not upload images into an existing note yet; it appends text and reports the skipped new images.
- DOM-only auto-scroll is intentionally bounded to five minutes. Provider markup changes can still require extractor maintenance.
- The inherited live-E2E authentication/daemon harness was removed. It stored reusable AI sessions and exposed authenticated Chrome through a loopback DevTools port, while providing no CI-backed guarantee for Liska on Windows. Offline extractor fixtures and snapshot tests remain.
- The current visual icon is the inherited purple crystal. A dedicated Liska icon is a separate design task.
- GitHub Pages is intentionally disabled. The privacy policy remains available from its tracked source file.
- Release Please is intentionally removed from the active workflow surface; releases are explicit maintainer actions documented in `docs/maintaining.md`.

## Artifacts

- Loadable unpacked extension: `dist/`
- Current local package: `liska-threadkeeper-3.0.0.zip`, 265,209 bytes, SHA-256 `B0D338765E8DE3DC141A925C5FD16555403FFA146305042233D304389936A3CF`; all 29 packaged files exactly match the final `dist/` tree.
- DeepSeek history client/parser: `src/content/extractors/deepseek-api.ts`
- DeepSeek canonical normalizer and synthetic fixture: `src/archive/normalizers/deepseek.ts`, `src/archive/normalizers/deepseek/`, and `test/fixtures/archive/deepseek-raw/branching-replace.json`
- Provider-neutral inline/staged JSON companion builder: `src/content/capture/json-archive-companion.ts`
- Privacy policy source: `docs/privacy.html`
- Current product and setup guide: `README.md`
- Documentation index: `docs/README.md`
- Maintainer and release guide: `docs/maintaining.md`
- Chat archive pipeline decision and phased plan: `docs/adr/031-loss-aware-archive-pipeline.md`
- Staged large-graph transport decision: `docs/adr/032-staged-large-chatgpt-capture.md`
- Canonical archive core and schema: `src/archive/` and `src/archive/schema/liska-thread-1.schema.json`
- Credential-free raw capture primitives: `src/archive/capture.ts` and `src/content/capture/response.ts`
- ChatGPT verified-byte normalizer: `src/archive/normalizers/chatgpt.ts` and `src/archive/normalizers/chatgpt/`
- Disposable-tab capture primitive and strict runtime contract: `src/background/chatgpt-capture.ts` and `src/lib/chatgpt-capture-contract.ts`
- Staged raw/canonical contract, OPFS store, and MV3 recovery: `src/lib/archive-stage-contract.ts`, `src/offscreen/archive-stage-store.ts`, `src/background/archive-stage-handlers.ts`, and `src/background/archive-stage-download-recovery.ts`
- Marker-gated MAIN-world document-start observer: `src/content/capture/chatgpt-document-start.ts`
- ChatGPT content bridge and current-branch composition: `src/content/capture/chatgpt-current-branch.ts` and `src/content/extractors/chatgpt.ts`
- Destination-honest ChatGPT attachment orchestration: `src/content/chatgpt-asset-export.ts`
- Post-persistence opaque resolver contract/runtime/bridge: `src/lib/chatgpt-opaque-resolver-contract.ts`, `src/background/chatgpt-opaque-resolver.ts`, and `src/content/capture/chatgpt-opaque-resolver-request.ts`
- Active metric-only resolver contract/runtime/bridge: `src/lib/chatgpt-active-resolver-contract.ts`, `src/background/chatgpt-active-resolver.ts`, and `src/content/capture/chatgpt-active-resolver-request.ts`
- Interpreter resolver contract/runtime/bridge: `src/lib/chatgpt-interpreter-resolver-contract.ts`, `src/background/chatgpt-interpreter-resolver.ts`, and `src/content/capture/chatgpt-interpreter-resolver-request.ts`
- Synthetic ChatGPT raw fixture and end-to-end projection test: `test/fixtures/archive/chatgpt-raw/branching-mixed-content.json` and `test/content/chatgpt-archive-pipeline.test.ts`
- Canonical-to-legacy branch adapter: `src/content/archive-projection.ts`

## Current integration checkpoint

Combined [PR #10](https://github.com/la4ox/liska-threadkeeper/pull/10) is merged
into `main` at `ef24f3e`. Current work continues from that exact head on
`codex/chatgpt-2026-10-compat`; no release or tag is implied.

The current ChatGPT compatibility slice repairs the October 2026 page request
shape without weakening the loss-aware archive boundary:

- replay/probe accept a bounded plain own-data `HeadersInit` record as well as
  the established native Request path. Header names and values remain inside the
  document-start MAIN-world closure and never enter messages, logs, storage, or
  diagnostics;
- the page's original fetch receiver, arguments, synchronous exception, and
  returned promise remain unchanged. A singular Request is constructed once and
  dispatched at most once, only after the page-owned plural source resolves as
  exact `200 application/json`;
- source authorization now uses captured native `Response.url` and
  `Response.redirected` getters. The final response must be an unredirected exact
  `https://chatgpt.com/backend-api/conversations/{selectedId}` URL with one of
  the two allowlisted raw query orderings. Empty, malformed, redirected,
  cross-origin, wrong-ID, extra-query, and post-WebIDL base-mutation cases fail
  closed before replay;
- string inputs resolve through a captured genuine `Node.prototype.baseURI`
  getter and are rechecked after the single init/header classification pass.
  Network-path references are rejected; native Request handling is unchanged;
- plain-header snapshots are bounded to 64 fields, 128-byte names, 8 KiB values,
  and 32 KiB aggregate text. Accessors, symbols, inherited pollution, invalid
  bytes, duplicate case-folded names, unstable reflection, and unsupported
  prototypes fail with fixed enum-only diagnostics;
- passive and active resolver modes retain their earlier strict eligibility.
  Interpreter transport alone accepts the confirmed October 2026 source shape:
  a primitive string or genuine native Request with a bounded plain own-data
  header override. It uses only the captured override, requires authorization
  membership without reading its value, allows only `include`/`same-origin`
  credentials, and never clones or consumes the page Request;
- interpreter queue ownership is now explicit across fetch, response-body read,
  and SHA-256 calculation. One per-item timer covers the entire operation; late
  completions cannot advance the queue or overwrite terminal state. A failure
  before the first helper dispatch preserves its fixed run error instead of
  collapsing to `not-dispatched`; once any helper request was dispatched,
  partial ordinal evidence remains authoritative;
- the old generic page timeout is split into `target-not-observed`,
  `source-response-timeout`, and `replay-response-timeout`. Background timeout
  remains explicitly ambiguous. No retry, cache-bypass reload, token/session
  route, active-tab mutation, DOM fallback substitution, or guessed branch was
  added;
- persistence logging now emits only destination enums and success booleans.
  Filenames, paths, note bodies, warnings, errors, response objects, credentials,
  and archive content are excluded.

Live Comet verification on a private 232-message ordinary ChatGPT conversation
completed three successive final-phase exports, including an immediate warm
repeat. The final response-URL-gated build produced a fresh snapshot in both
Downloads and Obsidian:

- raw `conversation.json`: 2,684,770 bytes;
- manifest: 1,884 bytes;
- canonical `liska-thread-1.json`: 4,434,199 bytes;
- complete graph: 453 nodes, one root, current node present, two preserved asset
  references, zero manifest warnings, and `graph/messages/branches = complete`;
- Downloads and Obsidian raw/manifest/canonical copies have identical SHA-256
  values inside the snapshot;
- Markdown was written to both destinations. Downloads retained the ordinary
  547,823-byte form; Obsidian retained the configured flattened 546,535-byte
  form;
- each successful run received a distinct random capture ID and a new archive
  directory. Older snapshots were not replaced, and no marker tab remained.

One earlier warm run on a pre-phase-diagnostic build ended in the old generic
timeout. The exact phase was therefore not recoverable. It did not write a
partial snapshot, and the timeout did not recur in the later cold/warm/final
sequence. This remains an explicit reliability observation rather than a reason
for an automatic retry.

The interpreter attachment compatibility slice is now live-verified on a
private standard ChatGPT conversation containing both current and older
interpreter assets. The metadata-only probe observed the exact
`eligible-init-plain-headers` request class. After an extension and page reload,
three successive trusted-click exports produced new immutable snapshots in both
Downloads and Obsidian:

- raw `conversation.json`: 112,439 bytes;
- manifest: 4,354 bytes;
- canonical `liska-thread-1.json`: 218,585 bytes;
- complete graph: 36 nodes, one root, current node present, six preserved asset
  references, and `graph/messages/branches = complete`;
- one current PDF was fetched through the page-owned interpreter flow and saved
  as a 51,741-byte content-addressed binary. Its manifest length and SHA-256
  match the file; it begins with `%PDF-1.4`, and Poppler parses one unencrypted
  A4 page;
- one older interpreter asset returned HTTP 404 and remains explicitly
  `not-attempted`; four PNG inventory records also remain honestly
  `raw-inventory-not-attempted`. Overall asset completeness is therefore
  `partial`, without inventing missing bytes;
- raw, manifest, canonical, and PDF copies are byte-identical between Downloads
  and Obsidian. Repeated exports retained the same PDF hash while creating new
  capture directories; older snapshots were not replaced;
- manifest/canonical scans contain no authorization or cookie fields, bearer
  token, signed-query parameter, signed OAI URL, or `download_url` field;
- the temporary metadata probe was restored to off and strict replay to on.

A content-free follow-up over the four unresolved PNG ledger entries found
usable identities rather than a settings/routing regression: three have one
accepted direct metadata ID, and the fourth has two equivalent `sediment:`
pointers for one identity. All four are unique active-plan candidates and none
is interpreter-eligible. They remained `not-attempted` because the passive
eight-second observer saw no matching page-owned resolver request for these
historical/lazy assets.

The active file-ID route is now live-verified through its first bounded
data-bearing adapter on a separate ordinary ChatGPT conversation with a freshly
visible generated PNG. Its complete graph has 35 current-path nodes and six
image ledger records. A pure committed-raw plan resolves whole-ledger identity
strength and ambiguity before choosing exactly one eligible PNG; interpreter
ownership wins first, the selected active identity is never retried passively,
and passive matching keeps the complete ledger until after winner selection so
a weaker pointer alias cannot trigger a duplicate fetch. Any unsupported
nonempty direct identity fails closed before sibling or pointer fallback in both
passive and active evidence families.

The helper remains the one page-observed
`/backend-api/files/download/{id}` route with exactly `conversation_id`,
`inline=false`, `download_intent=false`, and
`include_library_file_state=true`. It reuses closure-private source
authorization only inside MAIN, copies no credential outside that closure, and
has no retry, endpoint fallback, route discovery, or concurrent dispatch. Background
rebinds the signed URL to the exact transient plan; the existing downloader then
verifies response URL, media type, PNG bytes, length, and SHA-256 before
destination-specific persistence can claim `fetched`.

A local static interoperability review of installed AI Exporter 4.6.0 explained
its apparent speed without adopting its broader trust model. It captures the
same conversation API, hydrates every mapping image through the same helper
family with `inline=true`, and uses up to six workers while silently skipping
individual failures. It also retains authorization/device headers in its own
runtime, has broad background image-fetch permissions, may compress images, and
chooses the newest reachable leaf rather than ChatGPT `current_node`. Liska
keeps its closure-private authorization, explicit current/selected branch,
original-byte verification, sequential acquisition, and honest failure states.
One same-identity live A/B changed only `inline=false` to `inline=true`; both
modes returned the same `http-error`. The experiment was fully rolled back, so
no second-mode fallback remains.

Two final-build trusted-click exports completed independently. The warm canary
receipt was `requested=1`, `dispatched=1`, `observed=1`, with every failure
bucket zero. It wrote raw 82,854 bytes, manifest 4,734 bytes, canonical 186,521
bytes, and one 1,474,502-byte PNG (1122 by 1402) to both Downloads and Obsidian.
All four companion/binary files were byte-identical across destinations; the
Markdown views were also byte-identical at 25,894 bytes. Manifest and actual
PNG length/SHA-256/path agree, one asset is `fetched`, and five remain honestly
`not-attempted`. The same content-addressed PNG hash repeated across both
immutable captures. Durable manifest/canonical scans found no selected provider
identity or transient signed URL, and no marker tab remained.

A bounded content-level batch now selects at most four distinct ordinary PNG
identities while leaving every background/MAIN transaction single-item. It runs
strictly sequentially, assigns ownership before dispatch, immediately acquires
each successful candidate through the shared 20-attempt/128-MiB budget, excludes
all selected identities from passive retry, and stops before another helper when
the shared attempt or byte budget is exhausted. One aggregate durable audit
preserves completed outcomes, known dispatches, unknown-dispatch run failures,
and allowlisted terminal counts without IDs, URLs, timestamps, or bodies. Its
caller-owned inputs are snapshotted once through own data descriptors before
validation and formatting; iterator, accessor, Proxy-get, repeated-descriptor,
and sparse-array attacks are covered.

The historical four-PNG canary then selected and dispatched all four identities:
three returned `http-error`, while the fourth produced a verified 2,313,476-byte
PNG (1448 by 1086). Its opaque ID and SHA-256 exactly match the one unique PNG
that older captures had fetched, proving historical availability without
inventing expiry for the other three. The current 51,741-byte PDF also remained
fetched. Downloads and Obsidian each retained five byte-identical archive files
plus byte-identical Markdown; all temporary tabs closed.

Structural reconciliation showed that three failed records had tool-role
`metadata.attachments` names shaped as `liska_pdf_render/page-N.png` or
`liska_docx_render/page-N.png`, consistent with transient document previews in
that historical sample. The first policy marked the exact role/MIME/name shape
`declined`, but it had no affirmative source-document relationship. A later
security reconciliation removed that filename-derived exclusion: role, MIME,
name, adjacency and provider-key aliases cannot by themselves authorize binary
omission. Such PNGs now remain ordinary `not-attempted` records, retain opaque
identity and every exact sourceRef, and stay eligible for the existing bounded
resolver/acquisition paths. This can spend an existing PNG slot on a historical
thumbnail but does not expand attempts, bytes, retries or endpoints. Generic
explicit `declined` records remain supported downstream for a user decision or
a future policy with structural proof.

The old canary that retained three previews as `declined`, two assets as
`fetched`, and one document as `not-attempted` remains historical evidence of
the retired heuristic. Current regression evidence instead uses an isolated
preview-shaped PNG with no source document: inventory reports
`not-attempted`, completeness remains honest, and active planning accepts the
asset. Raw and canonical losslessness continue to be the repair authority.

The fresh canary selected its two eligible PNG identities and fetched both:
1,474,502 and 1,429,642 bytes, each a verified 1122-by-1402 PNG. The first hash
matches the earlier one-PNG canary; the second had previously remained
`not-attempted`. Raw/manifest/canonical plus both binaries and Markdown were
byte-identical between Downloads and Obsidian, with no leftover marker tab.

Ordinary JPEG support now has a fail-closed, live-verified boundary. A
content-free structural pass over the latest
committed raw snapshot found one ordinary JPEG represented by a direct metadata
ID plus a `sediment:` pointer alias, and a separate JPEG record carrying an
explicit Library ID. The ordinary planner now resolves the whole evidence
ledger before eligibility and refuses every provider identity associated with
`library_file_id` or `libraryFileId`; `source: local` alone is deliberately not
treated as Library ownership. The deny set is applied before both active and
passive winner selection, so an ambiguous Library record cannot disappear and
promote a weaker pointer alias. Multi-ID and unsupported-direct evidence is
retained in the same deny-only whole-ledger pass instead of disappearing before
strength selection. Library assets therefore remain for their own later
contract instead of being sent through the ordinary file-ID helper.

Fetched PNG/JPEG claims now require bounded structural byte validation before
hashing and persistence. PNG checks cover signature, chunk lengths and CRCs,
IHDR/palette/data ordering, and terminal IEND. JPEG checks cover complete 8-bit
Huffman baseline, extended-sequential, and progressive marker/table/scan
structure, including immutable quantization values across progressive scans.
This is intentionally a container/codec-structure check rather than pixel
decoding: zlib and DCT coefficients are not rendered. Other already supported
binary MIME families retain their existing validation contracts.

The controlled live JPEG canary then completed through the unchanged ordinary
file-ID helper. Its durable audit recorded `selected=1/4`, one known dispatch,
one observed resolver response, and zero run failures. Downloads and Obsidian
each retained the same four byte-identical files: 2,684,770-byte raw JSON,
2,624-byte manifest, 4,434,340-byte canonical JSON, and one original
188,009-byte JPEG. The JPEG is an 8-bit baseline SOF0 image measuring 1015 by
1536; its content-addressed `.jpg` path, length, and SHA-256 reconcile across
actual bytes, manifest, and canonical archive. One second JPEG remains honestly
`not-attempted`, so asset completeness is `partial`. Manifest/canonical scans
found zero credential keys, signed transport URLs, `sediment:` or
`file-service:` values. A separate older JPEG fixture currently fails before
raw capture with `opaque-replay-source-http-error`; it produced no new output
and was not retried. The generated trusted-click smoke hook was never added to
source or packaging and was removed after verification.

Content-free archive reconnaissance found no ordinary GIF example and exactly
one WebP record among the newest snapshots for 16 distinct conversation IDs.
That WebP is a pointerless `metadata.attachments` record with explicit
Library-ID evidence; no `.webp` binary was present in its capture. It therefore
does not justify widening the ordinary active image allowlist and instead
becomes evidence for the separate Library contract.

The first offline Library checkpoint classifies only ledger records reached by
their exact committed-raw source references. Its exported result contains only
opaque asset IDs split into `associated` and `ambiguous` sets; Library ID values
never leave the pure classifier, and no request, URL, endpoint or acquisition
authority is created. Empty aliases and `source: local` alone prove nothing;
conflicting aliases, malformed values, duplicate ledger IDs, missing or
duplicate raw pointers and malformed conversation artifact IDs fail closed as
ambiguous. Separate assets that share one Library association are not merged.
Synthetic inventory plus content-free checks against the saved Library JPEG and
pointerless WebP originally kept both assets `not-attempted` with null local
claims; that frozen offline checkpoint remains the no-authority baseline.

Canonical privacy now treats exact Library, gizmo, project and conversation
template identifier aliases as raw-only structured provider context. Direct and
nested values are omitted with fixed value-free diagnostics at exact raw
pointers. Root gizmo/template evidence retains only `isCustomGpt: true` and
`hasConversationTemplate: true`; authored text, ordinary provider fields, raw
bytes, opaque asset IDs, source references and acquisition states remain
unchanged. Custom-GPT/project ownership remains explicitly unimplemented.

The first live Library transport observation proved that ChatGPT's preview
downloads a `blob:https://chatgpt.com/...`, while the underlying page-owned
flow uses `/backend-api/files/download/<direct attachment id>` and a transient
signed `/backend-api/estuary/content` URL. A browser-owned content GET returned
200; the same signed URL without the authenticated browser session returned 403. The contract therefore reuses the existing MAIN-world credential-bearing
resolver and content-script acquisition seam; it never exports cookies,
Authorization headers, signed URLs or Library IDs and never moves the signed
URL into a background fetch.

The initial production-path canary correctly left the Library JPEG
`not-attempted` and exposed a stricter-than-intended collision rule: a separate
pointer-only inventory record referenced the same provider file as the exact
Library metadata record. The fix permits only that weaker pointer-only alias;
malformed, unsupported, Library-bearing or nonempty direct siblings still fail
closed. Independent review also found and closed a separate merged-ledger
interpreter-precedence defect before the successful canary.

The successful trusted-click canary produced capture
`capture-chatgpt-4bb552a8-ce71-43ce-ae2a-b8632e9a0c4b`. It selected four of four
active slots: one Library JPEG and three ordinary images, with four known
dispatches, four observed helpers and no run failure. The Library JPEG is 9,949
bytes at SHA-256
`29c102f25e517ef317efcd548d120335fd7d146ed42b1482eac8b075be4dcebb`;
it is byte-identical to ChatGPT's own preview download and passes the existing
155 by 194 JPEG structural validator. A second 145,482-byte ordinary JPEG and
two PNGs were also preserved. File and Obsidian contain seven of seven
byte-identical raw/manifest/canonical/binary files. `library_file_id`, signed
transport URLs and credential/header markers are absent from manifest and
canonical output; the immutable raw retains original provider evidence.

The installed extension was returned to its pre-canary `dist` with the exact
29-file tree hash
`8d74d2458ec5f5a6fa978f574ef07896f0f657fa2af539a1df3a21066286d955`.
Temporary screenshots, browser-History copy and both canary builds were removed;
captures remain append-only.

Final exact-tree validation for the combined Library slice passes all 153 test
files / 4,292 tests. Coverage is 95.23% statements, 90.99% branches, 98.47%
functions and 97.72% lines. TypeScript, the production build, source/platform
lint and repository formatting pass; lint retains the same three pre-existing
warnings. The package has 29 of 29 files byte-identical to `dist`, is 228,231
bytes and has SHA-256
`c18d0af1ac2e7a37286d8e83222ba628557fb5379e1e21a4aa044cf07eafcd2c`.
Independent review found and closed the merged-ledger interpreter-precedence
and pointer-alias ambiguity defects, including interpreter ownership on a
separate alias record. GitHub review then exposed and closed nested-envelope
pointer and owner-selection gaps; the final pass found no remaining P0-P2.

Exact-tree validation for this offline Library checkpoint passes all 152 test
files / 4,216 tests. Coverage is 95.20% statements, 90.93% branches, 98.45%
functions and 97.70% lines. TypeScript plus the production build, formatting
and lint also pass; lint retains the same three pre-existing warnings. An
independent review of the complete offline Library checkpoint found no P0-P2 or
material P3 issue and confirmed that this slice creates no acquisition
authority.

Final exact-tree validation for this JPEG slice uses Node 24.18.0 and npm
11.16.0. All 152 test files / 4,192 tests pass; coverage is 95.20% statements,
90.90% branches, 98.45% functions, and 97.70% lines. TypeScript, the production
Vite build, source/platform lint, repository formatting, and ZIP packaging pass;
lint retains only the same three pre-existing advisory warnings. The final ZIP
contains the same 29 files as `dist`, with zero list/hash differences; it is
226,744 bytes with SHA-256
`7348510F48EBE52EA297B88384B469FAE7D421822D0C5C8E3091B8C9A876CAB6`.
Release-to-local reproducibility comparison remains unavailable because no
published `v3.0.0` GitHub release exists. Independent review found no residual
P0-P2 issue after the Library/multi-ID/unsupported-direct whole-ledger fixes.

Fresh exact-tree validation on `codex/upstream-2.14.9-audit`:

- Node 24.18.0 and npm 11.16.0 match the project contract;
- 150 test files / 4,114 tests pass;
- coverage passes at 95.17% statements, 90.73% branches, 98.42% functions, and
  97.65% lines;
- TypeScript, the production Vite build, extension ZIP packaging, source lint,
  platform-registry lint and repository formatting pass; lint retains only the
  same three pre-existing advisory warnings;
- the ZIP contains exactly the same 29 files as `dist`; every hash matches and
  both English and Japanese locale files are present;
- a clean `npm ci` is reproducible and the dated registry `npm audit` result is
  zero known vulnerabilities after the compatible toolchain refresh and removal
  of the single-purpose static-copy plugin;
- independent review reproduced and closed Perplexity mixed-layout ownership,
  duplicate-role, title-order and nested-prose defects; no residual material
  source finding remains in the reviewed upstream-port diff.

Pull request 11 merged to `main` as `6e9098a`. Continuous Security Cloud scans
completed successfully for every newly reachable commit; the fix commits
`1509bfc` and `e676428` and the final source-head commit `493df81` each produced
zero new findings. These are diff-scoped commit scans, not a repository-wide
proof of absence. Older finding occurrences have not been silently treated as
closed and remain a separate reconciliation task.

Pull request 12 merged to `main` as `950f775`. Its final reviewed source head
was `21cebb6`; CI and the final independent review were clean. This JPEG work
continues from that exact merge on `codex/chatgpt-jpeg-assets`.

Pull request 13 merged to `main` as `6c64fd1`; its reviewed source head was
`bc6a6a3`, CI was green and Security review was clean. The repeated ordinary
code-review indicator remained externally stuck after both actionable threads
were resolved, so the merge used the clean CI/Security result, the resolved
review evidence and an independent local review. The Library branch is
rebased onto that exact merge. Its offline privacy and association checkpoint
plus the one-JPEG runtime contract remain unpublished pending their own
reviewable pull request.

The upstream `v2.7.13` → `v2.14.9` audit is retained in
[`docs/upstream-2.14.9-audit.md`](docs/upstream-2.14.9-audit.md). This branch now
adapts the Perplexity rollout fixes, strict popup settings reads, a length-aware
append reader, and compatible dependency/build-chain updates. Claude current
DOM, ChatGPT DOM fallback, typed truncation guards, Gemini completeness/title
and the exact Google image redirect permission remain explicit later slices.

Pull request 14 merged the independently reviewed Library-JPEG slice to `main`
as `a55d9b8`; its reviewed source head was `2948f99`, and CI plus the final
manual security review were clean.

The next owner-context checkpoint is implemented on
`codex/chatgpt-owner-context`. A shared raw classifier selects exactly one direct
or nested graph, fails closed on malformed, conflicting, wrapper-level,
custom-GPT, project, or template evidence, and guards every independently
callable attachment planner. The background derives an immutable content-free
`standard | custom-gpt | project` family from the exact current tab route. Only
that family crosses runtime messaging; owner slugs and paths remain
background-only. Capture and strict replay preserve the validated owner route,
while provider title-slug canonicalization is admitted only when origin,
conversation UUID, route family, empty query, and nonce/mode marker remain
exact. Custom/project routes and owner-bearing raw therefore retain raw,
manifest, canonical, and Markdown but create zero attachment resolver,
acquisition, staging, or fake zero-dispatch audit authority.

A live custom-GPT canary wrote a new append-only Obsidian snapshot with a
41,929-byte hash-bound raw artifact, 11 canonical nodes, no assets, and no owner
route in manifest/canonical. A separate live project canary exercised the
actual denial path: raw 2,609,652 bytes, manifest 5,663 bytes, canonical
4,954,122 bytes, 132 nodes, and nine retained assets. All nine remain
`not-attempted`; attempt timestamps, local artifacts, binary files, and binary
dispatches are zero. The capture directory contains exactly raw, manifest, and
canonical JSON, and the manifest carries one fixed content-free policy warning.
Temporary query-key smoke hooks read no values, headers, bodies, or chat text;
they were removed by a clean build and never entered source or the package.

Final validation passes 155 test files / 4,456 tests. Coverage is 95.25%
statements, 91.06% branches, 98.48% functions, and 97.70% lines. TypeScript,
production build, source/platform lint, repository formatting, ZIP packaging,
and independent review pass; lint retains the same three pre-existing advisory
warnings. The ZIP contains 29 of 29 files byte-identical to `dist`, is 229,975
bytes, and has SHA-256
`9dbb625982acb2006d16dfd731dd80a5ecdc6dc7e770d8db92eff57bb0561f11`.
The installed Comet tree is the same 29-file production build; its pre-live
rollback is retained under `C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks`.

Pull request 15 merged the owner-context archive-only contract to `main` as
`f4c04d5`; its reviewed source head was `9638938`. CI, ordinary review, Security
review, and the final independent local review were clean.

The next standard-chat research-output checkpoint is implemented on
`codex/chatgpt-deep-research`. A finalized destination receipt is emitted only
after that destination has independently confirmed its binary writes and its
final manifest plus canonical companion. The receipt contains only the opaque
capture/conversation keys, exact final manifest SHA-256, and safe
content-addressed binary descriptors. Provider IDs, filenames, URLs, source
pointers, and statuses cannot cross the receipt validator. File and Obsidian
notes are now decorated separately, so each note links only binaries present in
that destination and carries the exact matching `archive_capture_id` and
`archive_manifest_sha256`; Clipboard receives neither local links nor an
arbitrary durable-destination hash. Receipt-bound Markdown uses a capture-scoped
filename and treats every occupied candidate, including the same conversation,
as immutable. Earlier notes and user edits are therefore never overwritten by a
new or repeated archive presentation.

A live standard-chat canary containing research/search evidence and a produced
DOCX retained a direct 49-node graph with 48 messages: 2 user, 24 assistant and
22 tool roles. Canonical JSON preserved 12 text, 12 reasoning, 12 citation, 7
code, 20 execution-output and 13 attachment blocks. The 287,632-byte raw,
8,959-byte manifest and 612,899-byte canonical archive remained hash-bound.
Four historical PNG attempts ended honestly as failed, nine PNG references
remained `not-attempted`, and one 45,036-byte DOCX was fetched under SHA-256
`45e080f46c285def0978eb7c26133b728cc2928cb5a9f90f7f1a1a2bc055a7ee`.
Downloads and Obsidian retained byte-identical raw, manifest, canonical and
DOCX artifacts. Each capture-scoped Markdown note has one local archive link;
both targets exist and hash to that exact content address, while the original
provider `sandbox:` reference remains additive historical text rather than
being guessed away. Both note frontmatters bind to the final reviewed-build
capture `capture-chatgpt-8d66dd07-be72-4285-99cf-8791257386a9` and the exact
persisted manifest hash
`98551c2aa445df27bcd4ead8729704c1d6c7e3b2aa30b30d89b9d20f450389ec`.
File companions now require Chrome to confirm the exact requested terminal path
for both inline and staged archive transport; a uniquified raw, manifest or
canonical filename fails the destination instead of issuing a misleading
receipt. Provenance warnings are likewise emitted only after that destination's
Markdown write succeeds.

The focused Codex Security diff scan of `f4c04d5..d45c911` completed with all
ten changed source files covered and no validated security finding. It did
reproduce one same-user correctness defect in the append-only contract: a
later ordinary `title-date` append could select an existing same-conversation
receipt-bound snapshot. Existing-note lookup and collision reuse now exclude
top-level `archive_capture_id`, `archive_manifest_sha256`, and
`presentation_mode` markers, including simply quoted YAML keys. Nested mappings
and block-scalar text remain ordinary note content rather than false immutable
markers. The snapshot is therefore neither appended to nor overwritten; the
ordinary export selects a fresh collision-free path. A final independent review
found no residual P0-P3 issue in this repair.

Final validation passes 157 test files / 4,602 tests. Coverage is 95.26%
statements, 91.15% branches, 98.53% functions, and 97.70% lines. TypeScript,
production build, source/platform lint, repository formatting, ZIP packaging,
and independent review pass; lint retains only the same three pre-existing
advisory warnings. The ZIP contains 29 of 29 files byte-identical to `dist`, is
231,480 bytes, and has SHA-256
`92ef88ae6fab2b6969278956810ef4e08c08c23cd4b8504fef5aadad58ee24c7`.
The installed Comet tree matches that production build exactly; its 29-file
pre-live rollback is retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\deep-research-prelive-20261023-074014-d2aba19b`.

The next wide-branch checkpoint is implemented on
`codex/chatgpt-wide-branch` at `e29165e`, now integrating the PR 16 merge
`9fb7835`. A prepared session validates the archive and complete catalog
once, resolves ordinals in O(1), reconstructs paths from validated parent links,
and reuses one immutable timestamp across measurement and writing. Public
defensive renderers remain unchanged. Structural preflight rejects before any
output at 50,000 nodes, 512 leaves, 1,000,000 path visits, 1 GiB expanded source
work, or 2,048 planned writes. After archive evidence succeeds, an exact dry
pass uses the same File/Obsidian transforms as the writer and caps each note at
16 MiB, logical Markdown at 1 GiB per destination, and total planned physical
bytes at 2 GiB. A canonical settings snapshot prevents popup changes during a
long run from invalidating that measurement.

All-branches File notes and indexes now wait for an ID-bound terminal Downloads
state and require Chrome's exact requested filename. Interrupted, uniquified,
unknown, and already-owned outcomes cannot issue a false success or index. One
unknown File transfer stops later File dispatches while an independent Obsidian
destination may finish. A trusted persistent `Stop export` control remains
separate from transient progress toasts; cancellation stops scheduling new
work, retains confirmed evidence/files, and never deletes an immutable capture.

The final source passes 161 test files / 4,679 tests. Coverage passes at 95.21%
statements, 91.02% branches, 98.53% functions, and 97.75% lines. TypeScript,
production build, ZIP packaging, repository formatting, independent review,
and source/platform lint pass; lint retains only the same three pre-existing
advisory warnings. The ZIP is 234,395 bytes with SHA-256
`d2959575477525f551ade4f8783b1050502c6edd1cda1a725f421090cd63b778`.
The installed Comet tree matches its 29-file build exactly; rollback is retained
at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\wide-branch-prelive-20261023-090422-8bdaf390`.

Live Comet evidence has two parts. A one-leaf standard chat wrote exact File
branch/index names plus raw (287,632 bytes), manifest (8,959), canonical
(612,899), and one fetched DOCX (45,036). Raw length/hash and canonical manifest
provenance reconcile; the 49-node graph has one leaf, the index link resolves,
and both Markdown files share capture
`capture-chatgpt-6b5be94f-293f-4cdd-817f-d079d2d32102`. On the genuinely wide
graph, the picker became usable after roughly 65 seconds, retained 239 leaves,
and cancellation created no Downloads file. `Export all branches` then rejected
at structural preflight before any output because expanded source work exceeded
the 1 GiB checkpoint limit. A content-free measurement of the existing matching
canonical graph is 2,285 nodes, 239 leaves, 68 branch points, 230,694 path
visits, and 1,128,535,662 expanded source bytes (1.051 GiB). The ceiling remains
unchanged: raising it, for example to 1.25 GiB, requires an explicit maintainer
decision followed by the real full-write/index run.

The next all-branches destination-receipt checkpoint is implemented on
`codex/chatgpt-all-branches-receipts` at `4da4ed1`, now integrating the PR 17
merge `cbf38c1`. Every File/Obsidian branch note and index now
requires one strict destination-owned archive receipt. The plain
attachments-disabled path first confirms that destination's complete
raw/manifest/canonical trio and then constructs an empty-assets receipt; the
attachment-enabled path uses only the receipt emitted after destination-specific
archive finalization. Receipt containers are descriptor-snapshotted without
invoking caller accessors or methods. Missing, duplicate, malformed, or
identity-mismatched receipts fail closed for only that destination.

Each leaf and index is decorated before both exact measurement and writing,
while its already capture-scoped filename is preserved. The second pass must
reproduce the same filename, UTF-8 byte length, and SHA-256 before dispatch;
same-length drift therefore cannot evade the guard. Branch and index notes carry
the exact final manifest hash plus only that destination's confirmed local
capture-level attachment links. Provider links remain untouched and the text
explicitly avoids asserting that a capture-level file belongs to every branch.
An independent adversarial review found and closed one P2 in outer receipt-array
snapshotting; the final review found no residual P0-P2.

Final validation passes 161 test files / 4,710 tests. Coverage passes at 95.22%
statements, 91.06% branches, 98.53% functions, and 97.74% lines. TypeScript,
production build, ZIP packaging, repository formatting, independent review,
and source/platform lint pass; lint retains only the same three pre-existing
advisory warnings. The ZIP is 234,972 bytes with SHA-256
`5f7e920f69b8853091ce3d7e51ce74f9d41fa27e38dcc6c182409c81ef8d18d0`.
The installed Comet tree matches its 29-file production build; rollback is
retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\all-branches-receipts-prelive-20261023-100236-e9cf9886`.

A new append-only File canary created capture
`capture-chatgpt-92ae2c7b-362e-496a-989a-5e76cd3c567d`: raw 287,632 bytes,
manifest 8,959 bytes, canonical 612,899 bytes, one 47,904-byte branch, and one
1,224-byte index. Raw length/hash and canonical input provenance reconcile with
the persisted manifest. Both Markdown frontmatters contain the exact manifest
SHA-256 `9912a092738e39997f8818d1b44a743ac9693733a68d4b04daa4e86e52b71d18`;
the index link resolves to the exact branch filename, with no doubled capture
suffix. Both notes link the same existing 45,036-byte DOCX whose SHA-256 is
`45e080f46c285def0978eb7c26133b728cc2928cb5a9f90f7f1a1a2bc055a7ee`.
This live gate rechecked File output only; the Obsidian variant remains covered
by destination-divergence regressions rather than a fresh vault read in this
checkpoint.

The finalized physical-byte checkpoint is implemented on
`codex/chatgpt-physical-budget` at `dcdaa49`, now integrating the PR 18 merge
`429d2a5`. Every strict destination receipt owns detached byte lengths for
its exact finalized raw, manifest, and canonical artifacts. All-branches
accounting seeds each successful destination from that trio plus each confirmed
receipt asset exactly once, independently of branch count and without
cross-destination deduplication. Supplied receipts must also bind their raw byte
length to the original capture companion; malformed, accessor-backed,
overflowing, or mismatched receipts isolate only that destination.

The same checked destination seed drives summary dispatched/confirmed bytes and
the 2 GiB aggregate physical budget. A representable initial seed above that cap
rejects before any Markdown fingerprint or write, while logical Markdown remains
a separate per-destination counter. Stop after archive finalization retains the
already confirmed physical seed in its summary. This is exact accounting for
successful finalized destinations, not a whole-operation pre-write disk gate:
raw/binary residue from a destination that fails later finalization still needs
a broader per-write ledger before it can be budgeted or summarized exactly.
GitHub review then exposed the remaining adversarial case where two individually
representable destination totals overflow the aggregate safe-integer range. The
budget now short-circuits that aggregate to a bounded over-cap sentinel and
returns an ordinary `physical-planned-bytes` rejection summary before any
Markdown fingerprint/write instead of rejecting the persistence promise.

Final validation passes 162 test files / 4,733 tests. Coverage passes at 95.27%
statements, 91.11% branches, 98.57% functions, and 97.77% lines. TypeScript,
production build, ZIP packaging, repository formatting, independent review,
and source/platform lint pass; lint retains only the same three pre-existing
advisory warnings. The ZIP is 235,317 bytes with SHA-256
`9c5d2617bf255c04d7fb8a9237d93454df00fdc89dce639af3bf6550f5cd2365`.
The installed Comet tree matches its 29-file production build exactly; its clean
pre-live rollback is retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\physical-budget-review-fix-prelive-20261023-104608-f29ded47`.

A fresh two-destination canary created capture
`capture-chatgpt-513c3dd9-f332-412e-b417-28cdb81b0fc8` and reported one branch
plus an index saved to both Obsidian and File. Both destinations retained
byte-identical raw (287,632 bytes), manifest (8,959), canonical (612,899), and
DOCX (45,036) artifacts; raw and canonical provenance reconcile, and the DOCX
hash remains
`45e080f46c285def0978eb7c26133b728cc2928cb5a9f90f7f1a1a2bc055a7ee`.
Both leaf/index pairs bind to manifest SHA-256
`83beb122d73065038858f9b806da2afeca351d3293595f7cad9efe8ebcbe720d`,
their index links and capture-level asset links resolve, and their filenames
remain exact. File serialized the leaf to 47,904 bytes; Obsidian serialized the
same logical leaf to 47,096 bytes because its enabled long-message flattening is
measured separately. Both indexes are 1,224 bytes.

PR 16 merged to `main` as `9fb7835`, PR 17 as `cbf38c1`, PR 18 as `429d2a5`,
and PR 19 as `c112b84`. Every merged reviewed head is an ancestor of the fetched
remote `main`; the four staged checkpoints are now linear.

The current sandbox-link localization checkpoint is implemented on
`codex/chatgpt-sandbox-links` in parser commit `5fc033f`, integration commit
`7dff1b9`, and merge checkpoint `4f9d203`. It does not add a resolver or binary
authority. The bounded presentation parser accepts only ordinary inline links
from exact assistant text parts and rejects code, HTML/angle ambiguity,
blockquotes, reference definitions, malformed nesting, unsafe paths, and
unsupported raw shapes. After one durable destination has finalized its exact
raw/manifest/canonical trio and fetched binaries, detached runtime evidence is
rebound to that destination's strict receipt, original raw bytes, canonical
digest, selected path, whole ledger, exact source pointer, and content-addressed
asset tuple. Only then does a copy-on-write presentation replace the destination
span; raw, manifest, and canonical bytes remain untouched. Clipboard, DOM
fallback, and all-branches presentations remain unchanged, and every mismatch
fails soft to the provider link plus the existing verified appendix.

Independent review found and closed a cross-part Markdown fence edge: matching
identity counts were insufficient when one identical link was hidden in code
and another was visible. The final implementation derives exact text-block
spans from the same projection helper used by legacy rendering and requires the
identity, encoded destination, and absolute UTF-16 start/end to match the
combined visible message. Both the spanning-fence and same-identity swap
regressions now remain unchanged rather than rewriting a code example. The
final independent pass found no residual P0-P3 issue. GitHub current-head review
then found one fail-soft false negative: a reference definition inside an
unambiguous inline or top-level fenced code example vetoed a later ordinary
link. Presentation scanning now computes code ranges first and ignores only
those unambiguous code-only definitions; paragraph-ambiguous indented code
remains conservative. Focused regressions cover both code forms and the later
link, while current-head Security review remains clean.

Live Comet verification used two append-only current-branch captures. The broad
attachment chat created `capture-chatgpt-f6014b81-99b1-4961-9a9d-45b5a5b1d9f1`
in both Downloads and Obsidian, retained byte-identical raw/manifest/canonical
and a 2,313,476-byte PNG, and honestly left its unfetched DOCX/PDF provider links
untouched. The exact DOCX gate then created
`capture-chatgpt-cafbe981-4baf-4458-97af-5a3cb0f5e7c0` in both destinations:
raw 287,632 bytes, manifest 8,966, canonical 612,891, and one 45,036-byte DOCX
with SHA-256
`45e080f46c285def0978eb7c26133b728cc2928cb5a9f90f7f1a1a2bc055a7ee`.
All four artifact hashes match across destinations; raw length/hash and canonical
manifest provenance reconcile. File and Obsidian Markdown are 47,915 and 47,107
bytes respectively because long-message flattening remains destination-specific.
Both bind to manifest SHA-256
`ed019fbcc67720a1500f6da93ebe0ba5eb54cff285662736571a5afe52763aec`,
contain zero `sandbox:` references, and contain exactly two links to the same
existing content-addressed DOCX: the localized inline link and the appendix.

Final exact-tree validation passes 164 test files / 4,898 tests. Coverage is
95.34% statements, 91.27% branches, 98.64% functions, and 97.81% lines.
TypeScript, production build, source/platform lint, repository formatting, ZIP
packaging, diff checks, and independent review pass; lint retains only the same
three pre-existing advisory warnings. The final reviewed-build ZIP is 239,473
bytes with SHA-256
`945d12385e1c2292891a02440d550f5b5e66ef71b68dd26cfa88671fde206408`.
The live-smoke build was 29/29 files byte-identical to the installed Comet tree;
its verified rollback is retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\sandbox-links-prelive-20261023-123622-e87f98df`.

PR 20 merged the live-verified sandbox-link checkpoint to `main` as `c3c6e82`;
its reviewed head `257ee47` is an ancestor of fetched remote `main`.

The next settings-stable routing checkpoint is implemented on
`codex/chatgpt-stable-routing`. Every first-party structured durable write now
carries one detached, canonical, secret-free snapshot of the routing settings
that authorized it: inline and staged archive companions, staged binaries, and
Markdown. Background re-reads current settings and combines them with any
in-flight output override immediately before admitting a durable dispatch. A
different snapshot, or a requested destination that is now disabled, returns
the fixed `settings-changed` result without writing, retrying, stripping guards,
or borrowing authority from a sibling destination. Legacy callers that omit
the snapshot remain compatible but receive no new stability guarantee.

Staged mismatch cleanup remains narrowly authorized. Only a valid
sender-authorized message can exact-abort its named temporary archive or binary
stage; malformed or untrusted messages gain no cleanup authority. A cleanup
failure is retained only as the allowlisted
`archive-stage-cleanup-deferred`/`binary-stage-cleanup-deferred` warning, while
arbitrary private errors remain excluded. ChatGPT binary companion builders now
also preserve the original capture timestamp instead of silently replacing it
at finalization. Final destination receipts remain the sole provenance and link
authority. This checkpoint guarantees routing consistency at message admission;
it does not claim atomic cancellation, a fixed physical vault identity, or
restart recovery.

Independent review found and closed two bounded defects before the live gate:
the real ChatGPT companion builders had dropped `capturedAt`, and exact staged
cleanup warnings were being swallowed by orchestration. The final review found
no residual P0-P3 issue. Exact-tree validation passes 165 test files / 4,950
tests. Coverage is 95.36% statements, 91.30% branches, 98.68% functions, and
97.82% lines. TypeScript, production build, source/platform lint, repository
formatting, ZIP packaging, and diff checks pass; lint retains only the same
three pre-existing advisory warnings. The final ZIP is 239,904 bytes with
SHA-256
`6ad44eb98899bfe559b686cec94c2dc3c772ef17f645a4d856af2ecb07f38dcf`.
Its 29-file production tree is byte-identical to the build currently installed
in Comet.

A fresh positive Comet canary, with settings deliberately left unchanged during
the operation, created
`capture-chatgpt-dadab422-4fae-4f15-8317-68df19f64f0c` in both Downloads and
Obsidian. The destinations retained byte-identical raw (287,632 bytes), manifest
(8,959), canonical (612,899), and DOCX (45,036) artifacts. The DOCX SHA-256 is
`45e080f46c285def0978eb7c26133b728cc2928cb5a9f90f7f1a1a2bc055a7ee`;
raw length/hash, canonical input provenance, and all cross-destination hashes
reconcile. File and Obsidian notes are 47,917 and 47,109 bytes respectively,
contain zero `sandbox:` references, and each contains exactly two resolving
content-addressed links. The negative mid-operation settings race is covered by
the deterministic admission matrix, not claimed as a live UI proof. The clean
pre-live rollback is retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\stable-routing-prelive-20261023-134118-40ac6dab`.

PR 21 merged the settings-stable routing checkpoint to `main` as `c896cd5`;
its reviewed head `87344b2` is an ancestor of fetched remote `main`.

The operation-local write-fact ledger is implemented on
`codex/chatgpt-write-ledger` at `9030de4`. Durable archive and binary routes now
return an exact typed sink observation only when a first-party ledger call opts
in: `confirmed`, `unknown`, or `not-dispatched`, with a separate bounded cleanup
fact. Legacy durable callers and ordinary Markdown keep their previous response
shapes. Confirmation still means the established strict contract—exact
Obsidian readback or terminal exact-path Download—not PUT acceptance or a
download ID. A timed-out/readback-mismatched/path-unconfirmed write is charged
as unknown; settings, preflight, integrity, or start rejection before a durable
dispatch remains not-dispatched.

One closure-owned bounded ledger follows an all-branches operation through raw,
binary, manifest, and canonical attempts. Its detached snapshots contain only
an opaque capture binding, local attempt ordinal, destination/kind enums, exact
verified payload length, terminal state, and cleanup boolean—never bodies,
provider IDs, hashes, paths, filenames, credentials, or arbitrary errors.
Duplicate identical observations are idempotent; conflicts, accessors, foreign
operation evidence, incomplete receipt coverage, unsafe integers, and aggregate
overflow fail closed. Confirmed sink evidence is latched before temporary-stage
cleanup, so a later cleanup/bookkeeping failure cannot erase it.

All requested destinations now remain in the all-branches summary even when a
later artifact prevents finalization. In ledger mode, confirmed plus unknown
artifact bytes from every requested destination seed the shared physical budget;
receipt totals are not added again. Only receipt-qualified destinations may
receive branch Markdown, indexes, manifest provenance, local links, fetched
asset claims, or sandbox localization. A malformed supplied ledger blocks new
Markdown rather than silently falling back to a smaller receipt-only total.
Legacy callers without a ledger retain the previous finalized-receipt accounting.
Current/selected and DeepSeek retain the optional typed seam but do not create
unused ledgers; this checkpoint is neither persistent audit storage nor a
restart, retry, deletion, recovery, or net-disk guarantee.

Independent implementation and follow-up reviews found no residual P0-P3
issue. GitHub current-head review then found two user-honesty gaps: successful
archive writes hid allowlisted cleanup-deferred evidence, and a receipt-qualified
destination could hide unknown binary bytes omitted from its final manifest.
Both are fixed in `e0d3246`; cleanup warnings are now independent of write
success, and unknown artifact bytes are disclosed across every requested
destination. A later current-head review found that the ledger accepted shorter
capture IDs than the existing ChatGPT/DeepSeek contracts; `b6c451a` aligns both
provider-specific maxima and adds boundary/one-over regressions. Exact-tree
validation passes 166 test files / 5,011 tests. Coverage is 95.28% statements,
91.33% branches, 98.60% functions, and 97.73% lines.
TypeScript, production build, source/platform lint, repository formatting, ZIP
packaging, and diff checks pass; lint retains only the same three pre-existing
advisory warnings. A parent rerun of the ten decisive suites passes 286 tests.
The final review-fixed ZIP is 242,564 bytes with SHA-256
`d056682127b5985200925e05bc3fdc3c62497acbf247949c628e170077c79e27`.
Its 29-file production tree is byte-identical to the build installed in Comet.
The clean pre-live rollback is retained at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-rollbacks\write-ledger-capture-id-fix-prelive-20261023-152409-b6c451a`.

A fresh positive all-branches Comet canary created
`capture-chatgpt-0b38fe0b-d061-406b-a3ef-4b3d05a07b41` from the final
review-fixed build in both Downloads and Obsidian. Raw (287,632 bytes), manifest
(8,959), canonical (612,899), and DOCX (45,036) copies are byte-identical across
destinations; raw length/hash and canonical manifest provenance reconcile. Both
one-leaf indexes resolve their exact emitted branch name and all four notes bind
to manifest SHA-256
`295db787b80edb7160770012bc6b56f12bfe5a61f2de3434d4e530ae5cdcfe58`.
File and Obsidian branch notes are 47,904 and 47,096 bytes because their existing
destination transforms remain independent; both indexes are 1,224 bytes. The
manifest retained one fetched, four failed, and nine not-attempted asset records:
the verified DOCX is linked once from every branch/index view, while the
remaining unfetched sandbox reference stays honest. Temporary resolver tabs
exact-closed. This proves the unchanged-settings positive ledger path, not a
live failure race or worker-restart guarantee; those remain deterministic/static
evidence only. The subsequent capture-ID boundary fix does not alter this
ordinary UUID path; its 29-file build is installed, reloaded, and byte-identical
to `dist`.

Next: checkpoint this live-verified write-ledger slice in its own pull request.
The next ChatGPT live gates still require a real provider response above 16 MiB,
a multiple-same-title produced-file sample, or an available additional binary
family. Until such evidence exists, the 1 GiB source-work limit remains a
deliberate refusal for the known 1.051 GiB graph, and custom-GPT/project binaries
plus the archived Library WebP remain separately evidence-gated. The untouched
provider/upstream audit can proceed independently after this checkpoint.

## Local math-Markdown security checkpoint

Branch `codex/security-math-markdown` repairs the still-reachable fallback behind
Security Cloud occurrence `commit:eb1705ab69ac8191a043d3d6cb44fe4c`.
Delimiter-containing, oversized, malformed, or internal-placeholder-shaped
`data-math` values now become readable entity literals instead of active
Markdown. Display lines retain their boundaries without becoming indented code;
math-bearing table cells isolate neighboring punctuation; valid inline/display
TeX remains math, with formatting-only line wraps collapsed and `%` comment
line endings preserved through display promotion. The internal image grammar
now rejects matches spanning math delimiters, while punctuation-rich generated
alt text still resolves.

The Cloud occurrence says fixed, but its saved historical fix-check correctly
records that the earlier backslash/dollar-only fallback remained active at that
older revision. The actual fix merged through PR 25 as `650d8c9`; reviewed head
`d2e9df8` is an ancestor of fetched `origin/main`. Current-head CI and Code
Review were clean, the only P2 review thread was fixed and resolved, and the
local independent parser-backed review was clean. The separate GitHub Security
Review did not execute because its quota was exhausted; no live Obsidian render
was repeated.

## Local Canmore JSON security checkpoint

Security Cloud occurrence
`commit:8fc721c0bb0881919910f4805e72250d`. Message-level Canmore can carry a
JSON string nested inside the already parsed provider graph; the old path called
`JSON.parse` before the canonical sanitizer's depth, entry, and string budgets.
The candidate performs one quote/escape-aware, non-materializing preflight
first. JSON-looking input is limited to 4 MiB of source text, 64 nested
containers, and 4,096 structural tokens. These parse ceilings remain wider than
the existing canonical 16-level/512-entry sanitizer, so valid Canvas payloads
retain the established truncation behavior rather than being silently narrowed.

Exceeded budgets throw fixed code `canmore-json-budget-exceeded`. Inline capture
tests prove the resulting normalization failure retains byte-identical raw
length/hash/body plus manifest and emits no canonical artifact. Plain provider
text, malformed JSON fallback, quoted punctuation/escapes, bounded scalars,
valid create/update events, exact boundaries, and the reviewed 129-character
numeric scalar retain their prior semantics. Evidence: 166 test files / 5,057
tests, the focused seven-file / 202-test matrix, production build, and
source/platform lint with only the same three pre-existing warnings. Independent
review found one P3 numeric-type regression; it is fixed and covered. The source
fix merged through PR 26 as `915e367`; reviewed head `a24d696` is an ancestor of
fetched `origin/main`, with clean current-head CI and Code Review. Browser OPFS
and physical destination persistence were not repeated in this slice.

Per maintainer decision, unavailable per-PR Security Review quota is not an
intermediate blocker when current-head CI/Code Review and the local independent
security evidence are clean. Do not automatically retry paid security review.
After the current large roadmap block, run one explicit Cloud Security scan of
the complete repository and reconcile its findings.

## Local TypedArray capture-integrity checkpoint

Security Cloud occurrence
`commit:0fb1786e6cf08191a25da26b5593adfc`. The document-start hook previously
captured TypedArray methods but later read configurable inherited accessors and
used species-sensitive `Uint8Array.subarray` / `ArrayBuffer.slice`. Page code
running after startup could therefore observe or mutate closure-owned response
bytes before their SHA-256 and Base64 were finalized.

The candidate snapshots native TypedArray `buffer` and `byteLength` getters at
document start, performs every later size read through captured `Reflect.apply`,
copies digest input through captured `Uint8Array.set`, and encodes Base64 directly
from bounded indexed bytes. Staged chunks are encoded as ranges without creating
subarrays. Chunk storage uses null-prototype records, and `readBoundedClone`
crosses its async Promise boundary through a null-prototype envelope so a late
`Uint8Array.prototype.then` cannot receive the exact aggregate. Direct mutation,
throwing accessors, `length`, both species constructors, thenable assimilation,
non-zero-offset views, empty/inline/staged limits, and every resolver mode are
covered.

Evidence: 166 test files / 5,069 tests, the focused 22-file / 758-test
capture-resolver matrix, production build, formatting, diff checks, and
source/platform lint with only the same three pre-existing warnings. Independent
review found the additional async-then path; it is fixed and covered. The first
GitHub Code Review then found that direct Base64 concatenation could create one
multi-million-node rope; encoding now flushes bounded 4,096-triplet blocks. A
live browser MAIN-world smoke was not repeated for this slice. The source fix
merged through PR 27 as `cf733f1`; reviewed head `51183a7` is an ancestor of
fetched `origin/main`. Fresh current-head CI and Code Review were clean; Security
Review was clean on the pre-batching security head, with the batching-only review
thread fixed and resolved. Retain the planned final full-repository Cloud scan.

## Local question-heading security checkpoint

PR 28, merged as `f53fd6d`, addresses Security Cloud occurrence
`commit:3a431a24ce6c81919819b0c524645220`. Optional question headers are built
from raw user/provider content. The previous cleanup deleted backticks and
underscores before emitting the label directly, so code-formatted HTML or even
`<i_mg>` could become an active `<img>` heading.

The candidate keeps whitespace normalization, Markdown-character stripping,
word-boundary truncation, and the 60-visible-character contract unchanged. Only
after that decision, the shared heading serializer converts backslashes and
ASCII angle brackets to numeric entities. Entity parsing yields text without a
second HTML parse, and encoding the backslashes removes odd/even escape-parity
ambiguity. The same line feeds callout, blockquote, and plain formats; disabled
headers and assistant messages remain untouched.

Evidence: all 166 test files / 5,075 tests pass in six memory-bounded batches;
the focused formatter/Markdown/append/count matrix passes 4 files / 279 tests.
Independent review found no P0-P3 issue and ran a separate 301-test pass plus 78
parser probes without an HTML node. Production build and source/platform lint
pass with only the same three pre-existing warnings. Actual Obsidian rendering
was not repeated; the reviewer used the installed Markdown parser. Existing
UTF-16 truncation can still split an emoji surrogate pair; that predates and is
not changed by this slice. Reviewed source head `bbde708` is an ancestor of
fetched `origin/main`; current-head CI, Code Review, and Security Review were
clean.

## Local tool-content boundary security checkpoint

PR 29, merged as `f58758f`, addresses Security Cloud occurrence
`commit:1a0101353b0c819183fb067d15974853`. Provider-controlled tool/search
metadata previously reached generated Markdown as active links, images,
Obsidian embeds/callouts, or message-shaped labels. The shared formatter now
uses a punctuation-encoded `Tool Activity` title and preserves the complete
body inside a collision-safe literal fence in callout, blockquote, and plain
formats. Blank lines and nested backtick runs remain intact; message counting
stays honest before and after long-callout flattening.

Claude `.standard-markdown` tool fragments are sanitized and converted to
readable Markdown before that literal boundary. A placeholder pass preserves
exact pre/code indentation and terminal blank lines without replacement-string
interpretation, cross-block marker collisions, or adjacent-fence concatenation.
When no normal Markdown body is present, Claude's whole-response fallback now
removes status/tool headers from a clone before sanitization, so the opt-in data
cannot leak through ordinary assistant content while the setting is disabled.

Evidence: all 166 test files / 5,086 tests pass in six memory-bounded batches;
the independent final review passed seven focused suites / 431 tests and found
no remaining P0-P3 issue after three converter regressions were fixed. Production
build, repository formatting, diff checks, and source/platform lint pass with
only the same three pre-existing warnings. No live Claude-page or Obsidian-render
smoke was repeated. Reviewed source head `5e88298` is an ancestor of fetched
`origin/main`; CI and current-head Code Review were clean. The historical Cloud
occurrence is closed as fixed. The late Security Review then found a separate
P2 availability issue: Claude tool conversion rescanned the full fragment per
code block and again per marker restoration.

Follow-up source head `6fe968b` replaces those scans with one conversion-local
128-bit capability and one literal restoration traversal. One mutable budget is
fresh per ordinary extraction and shared across every auto-scroll harvest before
deduplication. It bounds per-section and aggregate HTML work, markup count,
sections, code candidates, metadata rows, DOM nodes, ancestor/line work,
ordered-list sibling scans, table nesting, and retained/generated Markdown.
Exceeding a ceiling fails the complete extraction with a value-free error; it
never silently omits tool evidence or reports a partial result as complete.

Independent review additionally found pre-conversion amplification through
nested blockquotes, decoded math attributes, table descendant selectors,
repeated favicon rows, ordered-list indexing, and detached nested KaTeX nodes.
Each bounded reproducer is covered. Nested tables now fail visibly rather than
being flattened, shared result rows are read once, and KaTeX preprocessing skips
static-list candidates disconnected by an outer replacement.

Evidence: all 170 test files / 5,201 tests pass in six memory-bounded batches;
the focused converter/extractor/Markdown/sanitizer matrix passes 5 files / 233
tests. The final independent pass reran the three Claude suites plus sanitizer
(192 tests) and found no remaining P0-P3 issue. Production build, targeted
formatting, diff checks, source/platform lint, and `npm audit` pass with only the
same three pre-existing advisory warnings and zero known dependency
vulnerabilities. A real Chrome/Claude timing smoke was not repeated, so JSDOM
proves the bounded paths and regressions but not a hard browser wall-clock.

## Canonical HTML renderer foundation checkpoint

Source head `3a5af58` introduces the pure `liska-html/1` presentation boundary
described by ADR-036. It renders one validated canonical branch directly rather
than reconstructing HTML from the deliberately lossy legacy Markdown view.
The renderer is deterministic and browser/destination-independent: it performs
no capture, network, storage, clock, DOM, download, or archive mutation.

The default profile exposes only ordinary visible user/assistant messages.
Non-user roles, hidden/non-final/tool-recipient messages, and their bodies stay
canonical-only. Enabling tool content reveals only typed reasoning, tool,
execution, and error blocks inside otherwise eligible messages. Every canonical
block family is either rendered or represented by an explicit aggregate
diagnostic/placeholder; provider HTML and Markdown images remain inert.
External navigation is limited to exact credential-free HTTP(S) links that
require a user click.

Optional local assets require a separate finalized binding set. Each binding
must agree with a canonical fetched asset on opaque ID, content-addressed path,
lowercase SHA-256, MIME type, and byte length. Only PNG/JPEG/GIF/WebP may become
local images; other allowlisted passive types are download links. The renderer
never infers authority from canonical paths, filenames, provider URLs, or
acquisition state alone, and it cannot itself verify absent bytes or a caller's
binding-set digest.

Work is bounded before recursive validation and before expensive Markdown AST
construction. Caller ceilings may only tighten global limits. The parser guard
covers direct and mixed quote/list nesting, CR/LF/CRLF, CommonMark backtick and
tilde fences, invalid backtick info strings, ambiguous raw-HTML fence state,
per-line container runs, and aggregate container work. UTF-8 output bytes are
counted incrementally. Exceeding a limit fails with a stable value-free code and
never returns a partial HTML document.

Evidence: the focused renderer suite passes 127 tests. Independent review found
and closed inherited array behavior plus four Markdown pre-parser/state bypass
families; its final pass found no remaining P0-P3 issue. All 171 repository test
files / 5,329 tests pass in six memory-bounded groups. Production build/typecheck,
repository formatting, diff checks, source/platform lint, and `npm audit` pass
with only the same three pre-existing warnings and zero known vulnerabilities.
Live provider/browser delivery and offline asset-bundle opening are intentionally
not claimed: settings, destination receipts, File persistence, and UI wiring are
the next slice. Automatic PDF remains a separate transport/rendering decision.

## Local append-boundary security checkpoint

PR 30, merged as `7ff531f`, addresses Security Cloud occurrence
`commit:65c64c5574f08191871348273e586bf6`. Visible `**User:**` and provider
labels were both presentation and identity, so hostile plain-format content
could inflate the old body count and turn a real append into a successful
zero-message no-op.

Ordinary conversation bodies now declare boundary format v1 and place one
exact extension-owned sentinel before each complete message group. Tool/search
evidence and question headers sit inside that group. Provider, user, and tool
content reserve the exact spellings. Image placeholder stripping and
destination-specific resolution preserve only pre-existing service lines in a
declared v1 body and neutralize marker substrings newly composed by each
transform; unterminated provider fences cannot hide later sentinels.

V1 notes count exact markers. Unmarked legacy notes recover from their valid
extension-generated frontmatter count, so already-poisoned bodies can append
the right tail while remaining byte-preserved. An unmarked legacy note without
a trustworthy count returns fixed error `append-message-boundaries-untrusted`,
writes nothing, and cannot fall through to overwrite. ADR-033 records the
format, compatibility, image-transform, CRLF, and explicit-migration rules.

All 167 test files / 5,103 tests pass in six memory-bounded batches. Focused
source-to-sink tests cover the historical forged-label suppression,
plain/callout/blockquote, question headers, tool groups, LF/CRLF, optional
counts, unclosed fences, image-composed markers, repeated no-op, personal
annotations, and multi-output refusal. Independent review found and rechecked
the frontmatter separator, post-image transform, and v1 heading-lookback seams
with 240 round-trip scenarios plus 26 probes; no P0-P3 issue remains. Production
build, repository formatting, diff checks, and source/platform lint pass with
only the same three pre-existing warnings. A live browser/Obsidian append was
not repeated. Reviewed source head `e26f648` is an ancestor of fetched
`origin/main`; CI and current-head Code Review were clean. The historical Cloud
occurrence is closed as fixed. Security Review was still running when the
non-blocking merge completed and was not retried.

## Local citation-boundary security checkpoint

PR 31, merged as `76f1254`, addresses Security Cloud occurrences
`commit:cb0e9bb83f88819181f8a884fdf468a9` and
`commit:1972e53d5bbc81918ded9e6b8bd3b4d7`. Provider HTML previously gained
extension-only footnote authority from public attribute names, NotebookLM
fallback labels were not typed, and a valid HTTP(S) source URL could terminate
its Markdown destination.

Extension-generated refs/definitions now carry a 128-bit per-run capability
and strict decimal / `mN-N` labels. Ordinary, definition, and table consumers
all require both. Marker-like provider DOM is retained as entity-literal text.
NotebookLM rejects nonnumeric fallback labels. Perplexity and Gemini/Claude
Research share one canonical HTTP(S) destination serializer that percent-encodes
literal backslashes and parentheses without double encoding existing escapes.

All 168 test files / 5,112 tests pass in six memory-bounded batches. Focused
tests cover forged refs/definitions, guessed/cross-realm tokens,
malformed labels, table carriers, hostile Research URLs, unsafe schemes,
encoded delimiters, ordering, deduplication, title upgrades, and ordinary
provider/Research output. Independent review found and rechecked the query/
fragment backslash edge. It passed 284 citation tests, 37 targeted Research
checks, and a final 176-test rerun; CommonMark probes produced one link and zero
injected images, with no P0-P3 remaining. Production build, repository
formatting, diff checks, and source/platform lint pass with only the same three
pre-existing warnings. Live provider sharing and Obsidian rendering were not
repeated. Merge `76f1254` is on fetched `origin/main`; current-head CI, Code
Review, and Security Review were clean. Both Cloud occurrences are closed as
fixed.

## Local provider-Markdown rendering security checkpoint

Branch `codex/security-deepseek-markdown` addresses Security Cloud occurrence
`commit:4aa52b95bddc819189aa49cfe8ef0559`. Structured provider Markdown previously
passed from the canonical projection to the reading export with only raw angle
brackets escaped. Remote and loopback images, unsupported destinations, and
Obsidian links/embeds could therefore remain active in a rendered note.

The reading boundary now parses CommonMark and edits exact source positions.
Provider-authored inline/reference images, private or unsupported link and
definition destinations, and Obsidian `[[...]]` / `![[...]]` prose become
entity-literal. Public HTTP(S) links, fragments, formatting, math, footnotes,
multiline labels, indented/fenced/list-contained code, and multiline inline
code remain intact. Structured user-role records receive the same protection.
Raw, manifest, and canonical companions remain unchanged.

Validated local ChatGPT archive links are not recognized by shape alone. The
sandbox localizer carries only exact destinations it generated after raw,
canonical, receipt, source-reference, hash, and destination verification. The
formatter requires membership in that runtime set plus the established
content-addressed path grammar. Provider-authored lookalikes stay literal.
ADR-035 records the contract.

All 169 test files / 5,160 tests pass in memory-bounded batches. Nine focused
source-to-sink suites pass 416 tests. The first independent patch review found
seven concrete issues in the discarded bespoke scanner: malformed-container
nesting, list-fence lifetime, multiline/reference parsing, entity/backslash URL
decoding, path-shape-only trust, code corruption, and quadratic escape scans.
The structural implementation covers every reproducer, including the adjacent
provider-controlled user-record path. Two GitHub Code Review passes then found
nested image descriptions, single-token/active-body Obsidian footnotes,
cross-message image references and fence state, assistant math, and newly
exposed unsafe-link titles. All seven are covered without flattening code,
footnotes, or math. Production build, repository formatting, and
source/platform lint pass with only the same three pre-existing warnings; `npm
audit` reports zero known vulnerabilities. Actual Obsidian rendering was not
repeated, so renderer network behavior remains an explicit live proof gap.

## Canonical HTML File-delivery checkpoint

Source head `4528871` completes the first opt-in File-only delivery slice on
`codex/canonical-html-delivery`. Structured ChatGPT and DeepSeek snapshots retain
provider-neutral presentation context only after the raw/manifest/canonical
archive trio is confirmed. The content layer then reserializes and rehashes the
exact canonical archive once, invokes pure `liska-html/1`, and asks background to
persist fixed `index.html` followed by a deterministic
`presentation/liska-html-1.receipt.json`. Background independently revalidates
base64, strict UTF-8, byte length, SHA-256, sender, destination, and current
settings. HTML is not offered for PDF, Obsidian, Clipboard, DOM fallback, or an
unfinalized asset-bearing snapshot.

The popup exposes `Canonical HTML reading view` as a default-off opt-in enabled
only while File output is selected. A live Comet smoke found that the new field
had been omitted from the storage pass-through list: the popup reported success,
but reload returned it to false. The field is now persisted alongside the other
non-secret sync settings, with a round-trip regression test. The temporary
test-only sender relaxation was never committed. The original user settings
were restored after the smoke, and the previously installed stable build was
put back after an exact reload.

The first private canary unexpectedly contained attachment evidence. It
correctly retained Markdown plus raw/manifest/canonical and a verified JPEG,
while producing no HTML or receipt under the current no-unfinalized-assets rule.
A separate no-asset structured canary then wrote raw (41,929 bytes), manifest
(857 bytes), canonical (73,478 bytes), HTML (33,716 bytes), receipt (539 bytes),
and Markdown (33,033 bytes). It retained 11 canonical nodes, one root, zero
manifest warnings, and zero assets. A local 36-check verifier reconciled every
length/hash/provenance edge, canonical metadata, fixed paths, null asset-binding
digest, renderer version, CSP, and the absence of executable elements, event
handlers, remote `src`, external styles, base elements, and meta refresh. Comet
also rendered the saved file as a readable offline conversation.

All 180 test files / 5,615 tests pass in the established six memory-bounded
batches. A monolithic Vitest run again exhausted worker memory and is not used as
evidence; it produced no assertion failure before worker teardown. Production
build/typecheck, repository formatting, source/platform lint, and `npm audit`
pass with only the same three pre-existing warnings and zero known dependency
vulnerabilities. Independent review found no P0-P3 issue in the persistence fix;
its requested close/reopen Comet proof is covered by the live reload above. The
next HTML slice is destination-finalized local-asset bindings and then
all-branches reading bundles. Automatic PDF remains separate.

## Canonical HTML finalized-asset checkpoint

Source head `d1eae64` on `codex/html-finalized-assets` adds the second opt-in
File-only HTML slice. ChatGPT and DeepSeek attachment finalization can now return
the exact destination-final canonical archive plus confirmed File asset records.
Only after raw, manifest, canonical, and asset writes succeed does the content
layer build `liska-html-asset-bindings/1`, rebind the retained presentation to
that final canonical, and render local images/download links. Every binding must
match opaque asset ID, content-addressed path, MIME type, byte length, SHA-256,
canonical acquisition state, and `localArtifactRef`; unsupported active types
remain unbound. Obsidian success cannot authorize File HTML.

All 181 test files / 5,707 tests pass in six memory-bounded batches. The content
batch passes with four workers; an additional unlimited-worker rerun exhausted
memory without an assertion failure and is not used as evidence. Production
build/typecheck, repository formatting, diff checks, source/platform lint, and
`npm audit` pass with only the same three pre-existing warnings and zero known
dependency vulnerabilities. Independent review found no P0-P3 issue.

A local real-archive smoke reused an earlier destination-confirmed ChatGPT
snapshot containing one fetched 188,009-byte JPEG and one honest
`not-attempted` sibling. Production code reverified the actual JPEG bytes,
canonical descriptor, final record, selected path, and non-null binding digest;
the derived receipt carried the same digest. The saved HTML contained one exact
local `assets/<sha256>.jpg` image, no remote image source and no script element.
It rendered successfully in a browser; the unbound sibling remained an explicit
placeholder plus diagnostic rather than disappearing or borrowing the fetched
file. A separate live no-asset File smoke from the parent slice remains valid.

Fresh live recapture attempts on two older image conversations exposed a
separate provider-capture gap before any destination write: fail-closed A-strict
replay rejected a newly observed opaque path, then ordinary structured capture
timed out and the current ChatGPT DOM fallback found no primary turn selectors.
No archive or Markdown was falsely reported as saved. Treat this as a ChatGPT
capture-compatibility follow-up, not as evidence against finalized HTML binding.

All temporary smoke overrides were removed; the worktree is clean. The user's
stable installed build and ordinary settings (Obsidian + File on, Clipboard and
HTML off) were restored. The exact asset-aware candidate build is preserved at
`C:\Users\GIGABYTE\AppData\Local\CodexTools\liska-html-assets-candidate-d1eae64-20261024`.
Do not open this slice's PR until parent PR 36 merges cleanly; then rebase onto
current main, rerun focused/build checks, and open the next reviewed PR.

## Canonical HTML all-branches B1 core checkpoint

Stacked source commits `47e9f2b` and `002f998` define the pure all-branches
foundation without adding delivery. The separate
`liska-derived-branch-html/1` and
`liska-derived-branch-output-receipt/1` contracts accept only a closed leaf
ordinal or index role and derive exact capture-root paths themselves:
`branch-000001.html`, `branches.html`, and matching fixed receipt paths under
`presentation/`. Existing current-view v1 validators remain mutually exclusive
and unchanged.

`prepareArchiveHtmlBranchSession` preflights and validates the archive, profile,
limits and finalized binding evidence once. An iterative private graph snapshot
retains deterministic declared root/child order, parent links and compact branch
metrics. Each `renderLeaf(ordinal)` rebuilds only that selected message path and
returns one HTML result plus a frozen compact fact; the session retains no leaf
HTML cache and performs no repeated child-array, catalog or `getNodePath` work.
The default 512-leaf ceiling may only be tightened. A deterministic local index
accepts only the complete ordered set of unmodified facts issued by the same
session and exposes only generated local links, generic branch labels, counts,
current flags, aggregate diagnostics and canonical/binding provenance.

An independent review found one confirmed P2 validation-to-use race: a stateful
top-level Proxy could present a valid canonical digest during validation and
markup during a later index read. Inputs, profile/limits, binding-set headers and
binding scalars are now captured once from own enumerable data descriptors and
used only through detached snapshots; both index digests are escaped as defense
in depth. Exact Proxy regressions now perform zero ordinary getter reads. The
repeat review found no remaining P0-P3 issue.

Evidence: all 183 test files / 5,865 tests pass in six memory-bounded batches.
The focused 13-suite / 894-test matrix includes byte-equivalence with the
defensive current renderer, a 12,000-node chain, exact 512/513 leaf boundaries,
wide/shared-prefix order, session-bound fact rejection, hostile inputs and both
current/branch transport contracts. Production typecheck/build (241 modules),
repository formatting, diff checks, source/platform lint and `npm audit` pass
with only the same three pre-existing warnings and zero known dependency
vulnerabilities. Browser delivery, persistence, aggregate HTML budgets,
cancellation and unknown-write behavior remain B2/B3; the closure-private
message bodies retain the documented no-mutation obligation.

## Canonical HTML all-branches B2a persistence checkpoint

Source commits `395c80d` and `f28281e` add a closed, not-yet-invoked File
transport for one already-built branch leaf or index. The exact
`persistDerivedBranchHtmlPresentation` envelope accepts no caller path, receipt,
bundle count or completeness flag. Background verifies the detached
`liska-derived-branch-html/1` bytes first, writes the exact generated HTML path
once, and only terminal exact-path confirmation authorizes construction and one
write of the locally matched receipt. Current-view v1 remains a separate action
and response contract.

`liska-derived-branch-html-persist-response/1` retains two independent sink
facts. Confirmed HTML is not downgraded when its receipt is unknown or
not-dispatched; unknown HTML blocks the receipt and cannot authorize a retry.
Cleanup-deferred evidence stays on the affected write. A bounded content sender
distinguishes pre-dispatch refusal, attempted-but-unconfirmed transport, and a
validated detached response; its 120-second deadline reports only unconfirmed,
does not cancel the background write, ignores late callbacks and never retries.

Independent review found two admission P2s before the final state. First,
descriptor validation did not retain the admitted caller envelope, so a Proxy
or mutation during `getSettings()` could replace capture identity before File
dispatch. The listener now snapshots the complete envelope, artifact and dense
File output exactly once before sizing and uses that detached value throughout.
Second, a stateful `action` descriptor could initially evade detachment and flip
later. New branch dispatch now also requires a closure-local admission
capability threaded through every async gate and checked at the final handler;
the message cannot supply it. Five tested flip points produce zero writes. A
separate callback-context loss that could leave the sender pending is bounded
and settles value-free as unconfirmed.

Evidence: all 188 test files / 6,079 tests pass in six memory-bounded batches.
The focused background/B1/B2a matrix passes 33 suites / 1,097 tests, and the
bounded sender matrix passes 10 suites / 434 tests. Production typecheck/build
(244 modules), repository formatting, diff checks, source/platform lint and
`npm audit` pass with only the same three pre-existing warnings and zero known
dependency vulnerabilities. B2a has no bootstrap caller and makes no delivery
claim; live Chrome timing, B2b canonical authorization and B3 bundle
orchestration remain explicit next gates.

## Canonical HTML all-branches B2b authorization checkpoint

Source commit `107e763` adds the target-free archive evidence and authorization
layer without enabling the exporter. `StructuredArchivePresentationContext`
retains only provider-neutral archive identity, exact manifest/canonical
descriptors and the presentation profile. The existing selected context extends
that base with an exact target/path; ChatGPT's stricter subtype and current
single-view API remain compatible.

One shared authorization boundary preflights the closure-private archive,
serializes the exact canonical JSON once, verifies UTF-8 length and SHA-256, and
rechecks detached identity/descriptors across the single async hash. Current
`prepareDerivedHtmlArtifact` and the new branch adapter use that same path.
`prepareDerivedHtmlBranchPresentationSession` then creates one B1 session and
builds leaf or index artifacts on demand: canonical hashing is not repeated,
each materialized HTML body receives its own artifact hash, and no all-leaf HTML
cache or persistence claim exists.

File-finalized evidence now also has an archive-level builder. It reconciles the
whole final canonical asset map and binding digest once; the prior selected-view
builder is a compatibility wrapper over the same work. Tests compose one
synthetic ChatGPT/DeepSeek finalized context through B2b into the bounded B2a
sender, but no bootstrap/provider route invokes it yet.

Independent review found one selected-path P2 during the refactor: the manual
parent walk had lost declared-root membership and parent-to-child symmetry checks
from the old `getNodePath`. A shared descriptor-only helper now verifies dense
root/child arrays, exact bidirectional ancestry, root uniqueness, path bounds and
cycle/repeat rejection in both retention and selected authorization. The initial
authorization preserves the prior archive/selected JSON-preflight ordering and
error codes; post-hash checks preflight only the selected array before detecting
structural drift. Repeat review found no remaining P0-P3 issue.

Evidence: all 190 test files / 6,212 tests pass in six memory-bounded batches.
The focused B2b matrix passes 15 suites / 848 tests, including a 4,096-node
selected path, once-only canonical hashing, per-output hashes, 512 branches,
same-session facts, hostile descriptors and B2b-to-B2a composition. Production
typecheck/build (246 modules), repository formatting, diff checks,
source/platform lint and `npm audit` pass with only the same three pre-existing
warnings and zero known dependency vulnerabilities. B3 orchestration, aggregate
budgets, cancellation, index-completion gating and live browser delivery remain
explicitly unimplemented.

## Canonical HTML all-branches B3a measurement checkpoint

The pure B3a plan now measures the complete File HTML bundle without dispatching
or writing anything. One destination-finalized archive capability authorizes the
canonical bytes once, then renders every leaf followed by the local index. The
plan retains only compact artifact, receipt and exact message-envelope
fingerprints plus the original same-session rendering facts; HTML/base64 bodies
exist only transiently. A closure recreates one document at a time in the same
session and withholds the body unless its descriptor, provenance, receipt bytes
and full JSON envelope reproduce exactly. Cancellation and failure are sticky,
concurrent recreation fails closed, and there is no retry or caller-supplied
path/completeness authority.

Markdown and HTML now share one exact physical-byte budget. HTML reserves its
artifact and receipt bytes atomically and separately accounts the homogeneous
HTML bytes produced by both render passes. Structural preflight also counts two
File writes for every leaf and the index: 512 leaves with two Markdown
destinations plus File HTML is rejected before persistence at 2,052 planned
writes rather than silently raising the 2,048 ceiling or omitting an output.
The normal sender and dry measurement use the same deterministic envelope
builder, so message-size admission cannot drift between the two passes.

Independent review found and the implementation closed one P2 identity race: a
stateful context could previously present capture identity A through ordinary
property reads and canonical B through own descriptors. The plan now detaches
the exact archive-context descriptors before its first await and uses that one
snapshot for both receipt identity and B2b authorization. Proxy and first-yield
shell-mutation regressions cover the boundary. The repeat review found no
remaining P0-P3 issue.

Evidence after the fix: the focused plan/budget/transport set passes 3 suites /
95 tests; the complete content set passes 62 suites / 2,523 tests. Production
typecheck/build transforms 246 modules, scoped ESLint, Prettier and diff checks
are clean, and the independent rereview passes 5 suites / 199 tests. B3a still
has no bootstrap caller and performs zero destination writes. B3b must wire the
shared structural option, finalized File evidence, sequential observations,
unknown-write halting and index-completion summary before any live canary.

## Canonical HTML all-branches B3b1 evidence checkpoint

ChatGPT all-branches extraction now retains a separate target-free
`StructuredArchivePresentationContext` from the exact captured archive,
companion descriptors and snapshotted tool-content profile. It carries no
selected target or path and remains distinct from the existing current/selected
presentation capability. Invalid archive evidence fails closed through the
established selection-failure path without provider-value details.

Attachment finalization can now return a separate
`fileArchivePresentation` capability. It is created only after the
destination-normalized File manifest/canonical pair is confirmed and only from
asset records whose exact File binary writes were reconciled as fetched.
Obsidian completion, incomplete File finalization and evidence-builder failure
cannot authorize it; builder failure also does not downgrade the already
completed archive. Bootstrap forwards the archive context only for an explicit
all-branches HTML + File request. The deferred warning remains and no HTML or
receipt dispatch is enabled by this checkpoint.

Evidence: the complete repository suite passes 191 files / 6,234 tests; content
passes 62 / 2,528 and extractors pass 17 / 578. Production build transforms 246
modules; lint has zero errors and only the same three baseline warnings;
formatting and diff checks are clean. Main-agent focused verification passes 3
suites / 110 tests and the independent review passes 5 suites / 251 tests with
no P0-P3 finding. B3b2 still owns the no-attachment File evidence path, combined
measurement, sequential delivery, unknown-write halting and user summary.

## Canonical HTML all-branches B3b2a persistence checkpoint

The all-branches persistence layer can now accept an explicit File HTML request,
and that request must match the exact bit retained by the structural preflight.
HTML cannot be added after a weaker preflight. Markdown measurement and B3a HTML
measurement consume one physical-byte budget before the first presentation
write; a combined budget rejection leaves the retained archive intact and
dispatches neither Markdown nor HTML. Without the opt-in, the legacy version-1
summary shape and behavior remain unchanged.

After combined measurement, Markdown keeps its existing per-destination
independence. File HTML then recreates and sends one leaf pair at a time. HTML
and receipt outcomes are counted separately; an unconfirmed transport charges
both planned files as unknown and stops all later File HTML without retry.
Confirmed HTML remains confirmed when its receipt is unavailable. Known
non-dispatch may allow later leaves, but the index body is not even recreated
unless every leaf pair is confirmed. A Stop waits for an in-flight pair's
observation, records it, and prevents the next pair. File Markdown unknown also
blocks subsequent HTML, while a confirmed Markdown failure may leave the
independent HTML route available.

Plain/no-attachment export may create presentation evidence only after the exact
File trio is confirmed. Attachment-finalized export may use only its supplied
evidence and never rebuild from the older pre-attachment archive. A new
reconciliation boundary detaches context descriptors and bindings once, then
matches them to the exact accepted File receipt by destination, identity,
manifest digest/length, canonical length and every supported asset's
path/hash/MIME/length. The accepted receipt protocol does not carry canonical
SHA-256, so B3a still reserializes and authorizes the canonical body/hash; the
sink link available here is its exact length plus the finalized manifest hash.

Independent review found and the implementation closed one P2: valid evidence
for canonical B could previously be paired with a File receipt for A when both
shared capture identity. The mixed A/B regression now produces HTML
`evidence-unavailable`, preserves Markdown, and sends zero HTML messages. The
repeat review found no remaining P0-P3 issue.

Evidence: the complete content set passes 63 suites / 2,577 tests; main-agent
focused verification passes 5 suites / 284 tests. Production build transforms
250 modules, scoped ESLint, Prettier and diff checks are clean, and the final
independent rereview passes 4 suites / 216 tests. This checkpoint exposes no
bootstrap/UI caller yet; summary rendering and live delivery remain B3b2b.

## Canonical HTML all-branches B3b2b bootstrap checkpoint

Bootstrap now computes one File HTML opt-in before the structural preflight and
passes the same decision into the prepared persistence session. An oversized
combined plan is therefore rejected before the ChatGPT attachment/raw pipeline
writes anything. Attachment mode forwards only the destination-final
`fileArchivePresentation`; the plain/no-attachment path supplies no evidence
and lets the persistence layer create it only after the File trio is confirmed.
HTML-off and no-File paths omit the request entirely and preserve the legacy
summary/messages. The single-view HTML helper is never used for all-branches.

The former “not available yet” warning is removed. The authoritative summary
now reports Markdown/archive and File-only HTML separately. A clean complete
run names both formats and attributes HTML only to File even when Markdown also
reaches Obsidian. Partial, failed, rejected and cancelled runs expose closed
HTML status/reason, confirmed leaf pairs, index-pair state, confirmed/unknown/
not-dispatched sink counts, unknown bytes and deferred cleanup without
inventing a failed physical-write state or leaking provider/native errors.
Attachment caveats still turn an otherwise complete run into a warning.

Evidence: focused bootstrap/summary verification passes 3 suites / 48 tests;
the complete content set passes 63 suites / 2,584 tests. Production build
transforms 250 modules; scoped ESLint, Prettier and diff checks are clean. The
independent bootstrap review passes 4 suites / 142 tests with no P0-P3 finding.
The content chunk is now 501.07 kB minified and crosses Vite's informational
500 kB warning threshold; behavior is unaffected, and code splitting remains a
later maintainability task rather than a last-minute delivery rewrite. Live
browser delivery is the remaining gate for this stacked checkpoint.
