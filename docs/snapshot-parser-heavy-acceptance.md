# Parser-heavy snapshot acceptance

This tests-only, synthetic acceptance slice exercises the production manifest builder,
ChatGPT normalizer, snapshot JSON writer, strict parser, `analyzeSnapshots`, and
`encodeSnapshotAnalysisPlan`. It neither changes production limits nor reads private captures.

The suite is skipped unless `LISKA_RUN_PARSER_HEAVY_ACCEPTANCE` is exactly `1`.
Run from the repository root in PowerShell, with one worker and no file parallelism:

```powershell
$env:LISKA_RUN_PARSER_HEAVY_ACCEPTANCE = '1'
try {
  npm test -- test/archive/snapshot-parser-heavy.acceptance.test.ts --maxWorkers=1 --no-file-parallelism --reporter=verbose --silent=false
} finally {
  Remove-Item Env:LISKA_RUN_PARSER_HEAVY_ACCEPTANCE -ErrorAction SilentlyContinue
}
```

Without that flag the same focused invocation reports two skipped tests and constructs
no heavy inventories. The suite is sequential, with a finite 120-second timeout per
test and for fixture setup. Expected local runtime and measured metrics are recorded below.

## Workload and assertions

Each heavy inventory has a two-node graph, one assistant message with 240 ordinary
ASCII text parts of exactly 32,768 code units, and only three JSON files. Capture
labels and observation times differ; the raw bytes are identical. There are no URLs,
credentials, private-like identifiers, prose sources, assets, or private files.

The strict parser measures each inventory with unchanged defaults. Summing those
content-free counters matches the production verification sequence's shared JSON
budget. The accepted pair must use 90–99% of the actual default 33,554,432-code-unit
string ceiling. All unrelated input, structure, projection, hashing, relation, and
report ceilings that are actually reached remain at or below 50% utilization.
The refusing triple returns no relation/report, so only its pre-report ceilings
are measured. Projection lengths come from the production projection encoder;
hash accounting wraps real SHA-256 with numeric counters only, not a spy retaining
hash-input buffers.

Both accepted snapshots verify, yielding exactly one sparse
`same-raw-different-evidence` relation with `preserveBoth: true`. The report remains
analysis-only, unauthorized for mutation, and explicit about unassessed external
references. Repeating the selection produces identical encoded bytes. Reversing
selection and file order preserves report facts; byte equivalence is checked after
normalizing selection ordinals and relation endpoints. The actual public report
continues to retain its intentional selection order, so raw reversed-report byte
identity is not claimed.

The separate refusal test checks each heavy inventory with a tiny valid peer (the
API requires at least two inputs), then selects all three heavy inventories. Only
the shared default string ceiling is exceeded. It must throw the fixed sanitized
`Snapshot analysis failed (limit-exceeded).` error and return no partial plan.

Source lengths and SHA-256 hashes are checked after success, repeat, reversal, and
refusal. Baselines contain only paths, lengths and digests, not extra full corpus
copies. Encoded reports must be LF-terminated and contain no text canary, repeated
payload text, synthetic source identities, input slot paths, or local working path.
The suite writes no reports or captures to disk; its console metrics are content-free.

## Measured run

Measured on Windows with Node 24.18.0, npm 11.16.0, Vitest 4.1.12, on
2026-10-30. Both tests passed. The verbose focused invocation took 7.05 seconds
(5.95 seconds in tests including fixture setup). Scenario timers were 2,705 ms
for the accepted/repeated/reversed analyses and 2,836 ms for third/control fixture
construction, the three individual admission checks, and the aggregate refusal.
The initial non-verbose opt-in run also passed in 6.89 seconds. No downward tuning
was needed. The focused default invocation skipped both tests (0 ms test work).

All sizes are exact bytes; all strings are ASCII, so the strict parser's work
counter equals the total JSON byte size for these fixtures. These are complete
successful per-inventory parser counters, not partial counters at the refusal point.

| Metric                        | Each heavy inventory (a, b, c) | Tiny control |
| ----------------------------- | -----------------------------: | -----------: |
| Manifest bytes                |                            825 |          827 |
| Raw bytes                     |                      7,865,403 |          430 |
| Canonical bytes               |                      7,989,984 |        3,821 |
| Total bytes                   |                     15,856,212 |        5,078 |
| Strict JSON values            |                          5,811 |          314 |
| Strict JSON string code units |                     15,776,879 |        2,468 |
| Strict JSON work              |                     15,856,212 |        5,078 |
| Maximum container depth       |                              9 |            9 |
| Canonical nodes / blocks      |                        2 / 240 |        2 / 1 |
| Assets / diagnostics          |                          0 / 0 |        0 / 0 |
| Semantic projection bytes     |                      7,927,786 |        2,562 |
| Graph projection bytes        |                            174 |          174 |

| Operation metric               |      Accepted pair |            Refusing triple | Unchanged default ceiling |
| ------------------------------ | -----------------: | -------------------------: | ------------------------: |
| Selected inventories           |                  2 |                          3 |                        16 |
| Total files                    |                  6 |                          9 |                     1,024 |
| Input bytes                    |         31,712,424 |                 47,568,636 |               268,435,456 |
| Strict JSON values             |             11,622 |                     17,433 |                 1,000,000 |
| Strict JSON string code units  |         31,553,758 |                 47,330,637 |                33,554,432 |
| String ceiling utilization     | 94.03752684593201% |          141.056290268898% |                      100% |
| Strict JSON work               |         31,712,424 |                 47,568,636 |               134,217,728 |
| Total planned projection bytes |         15,855,920 |                 23,783,880 |                67,108,864 |
| Observed SHA-256 calls         |                 18 |          23 before refusal |                     8,192 |
| Observed SHA-256 input bytes   |         79,032,292 | 102,754,250 before refusal |             1,073,741,824 |
| Largest observed hash input    |          7,989,984 |                  7,989,984 |       No separate ceiling |
| Sparse relations returned      |                  1 |         No report returned |                        48 |
| Encoded report bytes           |              1,102 |         No report returned |                   262,144 |

The triple's projection figure is the sum of full individual projections, used for
conservative headroom checks; the refusing operation stops before producing all
of them. Each heavy-plus-control admission returned two verified snapshots and
used 18 SHA-256 calls / 39,525,983 hash-input bytes. Each such selection has only
15,779,347 strict string code units. Repeated/reversed pair operations are real
independent default-budget analyses, not cached plans.

The largest unrelated utilization is a single semantic projection:
7,927,786 / 16,777,216 = approximately 47.2533%. Other enforced ceilings include
64 MiB per input file, 256 files per snapshot, depth 96, 20,000 canonical nodes,
100,000 blocks, 10,000 assets, and 20,000 diagnostics. All unrelated assertions
reached before the triple refusal pass the deliberately stronger <=50% headroom
condition. Relation/report headroom is asserted only for operations that return a
report; the triple intentionally returns none.

## Validation commands

All passed: the first command intentionally reports two skips; the core,
strict-JSON, and page-test command reports 174 passing tests across seven files.

```powershell
npm test -- test/archive/snapshot-parser-heavy.acceptance.test.ts --maxWorkers=1 --no-file-parallelism
# Run the opt-in command above for the two heavyweight tests and visible counters.
npm test -- test/archive/snapshot-analysis.test.ts test/archive/snapshot-strict-json.test.ts test/snapshot-analysis --maxWorkers=1 --no-file-parallelism
npx tsc --noEmit
npx tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution bundler --types node,chrome --strict --skipLibCheck --esModuleInterop test/snapshot-analysis/parser-heavy-fixtures.ts test/archive/snapshot-parser-heavy.acceptance.test.ts
npx prettier --check test/snapshot-analysis/parser-heavy-fixtures.ts test/archive/snapshot-parser-heavy.acceptance.test.ts docs/snapshot-parser-heavy-acceptance.md
git diff --check
```

The explicit two-file TypeScript command also checks the new test infrastructure;
the repository's ordinary TypeScript configuration includes `src/` only.

## Installed Comet acceptance

The same accepted pair was written to two temporary synthetic snapshot folders
and selected separately in the installed private snapshot-analysis page. Each
card reported exactly 3 files / 15,856,212 bytes. After one uninstrumented
Analyze, the terminal `Analysis complete. No source files were changed.` state
was first observed about 11.9 seconds after the trusted click. Both cards
reported `Verified byte consistency`, and the only candidate relationship
rendered as `Same raw bytes, different evidence. Keep both.`

The Save control was not used. No `liska-snapshot-analysis.json` report appeared
with mtime at or after the pre-run receipt in either the browser-configured or
profile top-level Downloads root. One older report predates this run. Independent
post-run reconciliation matched all six source file lengths, SHA-256 values and
exact `mtimeMs` values to the pre-run receipt, with exactly three files still
present in each selected folder. The temporary analysis tab was exact-closed
afterward.

The elapsed observation includes browser/UI scheduling and is not a performance
guarantee. This closes installed-Comet responsiveness for this measured 94.04%
string-budget pair; it does not measure peak memory, prove immediate cancellation
of synchronous parsing, cover the refusing triple in-browser, or establish other
browser families.

## Scope and nonclaims

The executable suite remains Node/Vitest acceptance; the separately recorded
Comet canary supplies the bounded installed-Comet evidence above. Timing is
observational and machine-specific, not a benchmark guarantee. Neither run proves
peak memory or instant cancellation of the synchronous strict parser. Vitest's
finite timeout is not parser preemption. They do not establish provider transport
authenticity, all-pairs relation discovery, absence of external references, or
permission to deduplicate, delete, merge, or mutate.
