# Fitness-Function Assessment (検収)

**Question:** Is this codebase adapted to its original design intent, and can that be verified objectively?

**Answer:** Yes, with one deliberate distinction. Most principles are enforced
by blocking checks; the maintainability size and complexity limits are advisory
warnings while the codebase is ratcheted toward stricter limits. [ADR-012](adr/012-fitness-functions.md)
adds the layering, cycle, code-side SSOT, and maintainability checks. This
document is the mapping. Terminology follows _Building Evolutionary
Architectures_ (Neal Ford / Rebecca Parsons).

## Design principle → fitness function

| #   | Design principle (source)                                                                                    | Fitness function                                                                                                                                                              | Classification                         | Status                                   |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| 1   | One-way layering: `Content → Background → Obsidian`; `lib` shared base; `popup`/`offscreen` leaves (ADR-012) | `test/arch/layering.test.ts` — `modules().resideInFolder().should().notImportFrom()` for each layer                                                                           | atomic · triggered · static            | Current                                  |
| 2   | No architecture erosion via circular coupling                                                                | `test/arch/cycles.test.ts` — `slices('src/*/').beFreeOfCycles()`                                                                                                              | atomic · triggered · static            | Current                                  |
| 3   | Platform SSOT = `manifest.json` matches; code and maintained docs must agree (ADR-014)                       | `test/arch/platform-ssot.test.ts` (code side: `AIPlatform` union, `ALLOWED_ORIGINS`, `getExtractor()`, `host_permissions`) + `scripts/lint-platforms.mjs` (docs/locales side) | holistic · triggered · static          | Current                                  |
| 4   | No untyped escape hatches; clean console usage                                                               | ESLint `@typescript-eslint/no-explicit-any`, `no-console`                                                                                                                     | atomic · triggered · static            | Existing                                 |
| 5   | Type safety (strict mode, no type errors)                                                                    | `tsc --noEmit` (in `build`)                                                                                                                                                   | atomic · triggered · static            | Existing                                 |
| 6   | Maintainability: files ≤ 800 lines, functions < 50, nesting ≤ 4, bounded complexity (ADR-012)                | ESLint `max-lines`, `max-lines-per-function`, `max-depth`, `complexity` (warn-first)                                                                                          | atomic · triggered · static (advisory) | Current — warnings do not fail CI yet    |
| 7   | Test confidence                                                                                              | Vitest coverage thresholds 95/85/95/95 (statements/branches/functions/lines)                                                                                                  | atomic · triggered · static            | Existing                                 |
| 8   | Explicit, reviewed releases                                                                                  | Protected `main`, required `ci`, and the clean-worktree checklist in `docs/maintaining.md`                                                                                    | holistic · triggered · static + manual | Updated by ADR-029                       |
| 9   | Consistent formatting                                                                                        | `prettier --check`                                                                                                                                                            | atomic · triggered · static            | Existing                                 |
| 10  | DOM selectors keep working against captured provider pages                                                   | Static offline fixtures and snapshots under `test/extractors/e2e/`; changed extractors also get a bounded manual live smoke test                                              | holistic · triggered · static + manual | Current; live harness retired by ADR-030 |

All triggered functions run in `.github/workflows/ci.yml` on every PR (lint →
format → coverage → packaged build). The maintainability rules report advisory
warnings in that run; they are not a pass/fail release gate yet. Provider DOM
coverage comes from static offline fixtures, with a bounded manual live smoke
test when extractor code changes.

## What "verification (検収)" looks like

- **Green on `main`** = the blocking checks for principles 1–5 and 7–9 pass,
  while principle 6's advisory limits are reported for review. Principle 10 is
  evidenced by offline fixtures plus the relevant manual smoke test.
- **Plant-violation proof** (done during ADR-012 implementation): adding a `src/lib → src/content` import makes case 1 fail; dropping a platform from `ALLOWED_ORIGINS` makes case 3 fail. The gate demonstrably catches regressions, not just passes vacuously.
- **Warn-first limits** (principle 6) reveal drift without blocking a release;
  promotion to `error` is a future, explicit ratchet rather than a claim that
  warnings already protect CI.

## Deferred (candidate future fitness functions)

Scoped out of ADR-012 to keep the change focused; recorded here so the backlog is explicit (the note warns against over-fitting to all `-ilities`):

- **Chrome-API purity** — assert designated pure modules (e.g. `note-generator.ts`, `path-utils.ts`) never reference `chrome.*`, protecting testability. (`messaging`/`storage`/`i18n` legitimately use `chrome`.)
- **Sanitization-path invariant** — assert extractor HTML always flows through `sanitizeHtml()` (DOMPurify).
- **Immutability lint** — `no-param-reassign` and related, codifying the immutability rule.
- **Dependency-drift / vulnerability gate** — `npm audit --audit-level=high` (or osv-scanner) as a temporal gate — the `failBuildOnCVSS` analog.
- **Content-script bundle-size budget** — regression gate on the built bundle size.

## References

- _Building Evolutionary Architectures_ (Ford, Parsons, Kua) — the fitness-functions concept this operationalizes.
- [ADR-012](adr/012-fitness-functions.md) — the decision and concrete settings.
