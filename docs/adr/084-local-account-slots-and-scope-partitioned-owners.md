# ADR-084: Local account slots and scope-partitioned owners

Status: accepted for PR-1; storage is implemented, but adoption and wiring are future work.

## Context

The installed Claude collector gate is accepted through PR #152. One explicit
current-personal click committed a paused owner. Its content-free aggregate was
two requests, two pages, twelve targets and twelve markers; active was terminal,
the archive page was terminal and empty, the response header pair matched, and
retention was owner-committed. `accountComplete` and `executionAuthorized` were
false. Detail requests and downloads were both zero. T33 is fulfilled by this
gate; it does not authorize detail or File work.

The accepted singleton Claude owner and generic execution owner remain valid
for their original contracts, but neither is a safe multi-account catalog.
Multi-account storage must precede any detail/File baseline so a later capture
cannot silently cross account or workspace boundaries. The user explicitly
defers a second-account/KYC live check. Ordinary offline and fake-IndexedDB
coverage is sufficient for this storage slice; no native harness is part of
PR-1.

## Decision

Use a local display slot as a user-managed partition, not as provider identity.
An owner is keyed by the tuple `[provider, slotId, scopeKey]`. `collectionId` is
immutable seed data, not part of that key. One slot may contain multiple
observed scopes/workspaces, and the same observed scope may be stored in two
explicit slots. This permits an explicit later choice without automatically
merging, rebinding, selecting a default/latest slot, or claiming a verified
human principal.

PR-1 creates a rollback-isolated IndexedDB database,
`liska-account-catalog-owner-v1`, for slots and owners. The key layout is
provider-neutral, but schema `/1` accepts Claude only. It is storage-only and
unwired: no network, UI, download, journal, execution, or production consumer is
added. The existing Claude singleton owner v1 and generic execution owner are
not changed.

Do not widen the existing Claude singleton v1 in place or repurpose the generic
execution owner as a multi-account catalog. Do not treat `scopeKey` alone as
account identity. A scope hash is workspace/scope evidence, not proof of a
human principal. Existing identities remain separate unless a future explicit,
evidence-backed action associates them.

Legacy singleton adoption is a later PR-2 operation, not part of this
implementation. It must be explicitly selected and copy-only: a noncreating
read, canonical validation, a new account-catalog owner commit, then a read-back. The old owner must
never be mutated, deleted, or moved, and a failure must not silently fall back
to another owner. Adoption has not been implemented by PR-1.

## Consequences and sequence

- PR-2: implement only the explicit read/validate/copy/read-back adoption above.
- PR-3: add explicit slot UI and Claude collector wiring, with a canary limited
  to the current account.
- Establish ChatGPT account-scope evidence and its adapter separately; Claude's
  scope evidence does not transfer to ChatGPT.
- Only after the scope/owner boundaries are in place may a later decision open
  detail/File baseline work.
- After Claude work, run a fresh installed ChatGPT regression pass covering
  ordinary and long chats, branches, images/files/attachments/tool results,
  selected preview, Markdown/HTML/PDF/DOCX, File and Obsidian, and append/re-export.

The explicitly deferred second-account/KYC live test is not a blocker for this
storage-only slice. A real cross-account manual check belongs to later backup
work and requires its own authorization. Passing the offline/fake-IndexedDB
matrix proves storage behavior only; it does not prove provider identity,
account completeness, or cross-account isolation in a live session.

## Evidence

- [PR #152](https://github.com/la4ox/liska-threadkeeper/pull/152) — accepted
  installed/live collector gate; repository-safe aggregate only.
- [Claude collector contract](083-claude-account-collector-v6.md) and
  [singleton owner](082-claude-account-baseline-owner-v1.md).
- [Account catalog owner source](../../src/account-catalog-owner/index.ts),
  [offline storage tests](../../test/account-catalog-owner/storage.test.ts),
  [fault tests](../../test/account-catalog-owner/faults.test.ts), and
  [boundary tests](../../test/arch/account-catalog-owner-boundary.test.ts).
