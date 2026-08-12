# DES-008: `/release` Custom Slash Command

> **Superseded by ADR-029 (2026-08-12).** This document describes the inherited
> historical workflow, not Liska's active release process.

> **Revision History**
> | Rev | Date | Changes |
> |-----|------|---------|
> | 1 | 2026-02-03 | Initial design |

## 1. Overview

### 1.1 Purpose

A Claude Code custom slash command (`/release`) that automates the full release-please-compatible workflow: **analyze changes -> create branch -> stage -> commit -> push -> create PR**.

### 1.2 Problem Statement

The current release workflow requires developers to manually:

1. Create a properly named branch
2. Stage files carefully (avoiding secrets)
3. Write a conventional commit message that passes commitlint
4. Push with upstream tracking
5. Create a PR with a structured body via `gh`

Each step has format requirements (commitlint types, header max-length, PR body structure, branch naming) that are easy to get wrong. A single command should encapsulate all conventions.

### 1.3 References

- Conventional Commits: https://www.conventionalcommits.org/
- release-please: `release-please-config.json` in repo root
- commitlint: `commitlint.config.js` in repo root
- Claude Code custom commands: `.claude/commands/*.md`

---

## 2. Design

### 2.1 File Location

`.claude/commands/release.md`

This is a Claude Code custom slash command file. It consists of YAML frontmatter (metadata) and a Markdown prompt body (instructions for Claude). It is NOT executable code — Claude interprets the prompt and uses its tools (Bash, etc.) to carry out the workflow.

### 2.2 `.gitignore` Change

Currently `.claude/` is gitignored. To track the command file while keeping `settings.local.json` ignored:

```gitignore
.claude/
!.claude/commands/
```

The negation rule `!.claude/commands/` allows the `commands/` subdirectory to be tracked by git. All other `.claude/` contents (e.g., `settings.local.json` with local MCP permissions) remain ignored.

### 2.3 Invocation

```
/release                              # Auto-detect type, auto-generate description
/release "add platform lint script"   # Auto-detect type, use provided description
/release "fix: handle null extractor" # Use explicit type and description
```

The argument text is available as `$ARGUMENTS` in the command template.

### 2.4 Workflow Steps

```
Step 1: Verify preconditions
    ├─ git status + git diff --stat
    ├─ Abort if no changes
    └─ Warn on sensitive files

Step 2: Detect commit type
    ├─ Parse $ARGUMENTS for explicit "type: ..." prefix
    └─ OR analyze changed file paths for dominant type

Step 3: Generate commit message
    ├─ Format: "{type}: {description}"
    ├─ Header < 100 chars (commitlint rule)
    └─ Use $ARGUMENTS as description, or auto-generate

Step 4: Create branch (if on main)
    ├─ Slugify description → branch name
    └─ git checkout -b {type}/{slug}

Step 5: Stage and commit
    ├─ git add (explicit file paths, never -A)
    ├─ Skip sensitive files
    └─ Commit with Co-Authored-By trailer

Step 6: Push
    └─ git push -u origin HEAD

Step 7: Create PR
    ├─ Check for existing PR on branch
    ├─ gh pr create --title --body
    └─ Body: ## Summary + ## Test plan

Step 8: Report
    └─ Output: branch, commit message, PR URL
```

### 2.5 Commit Type Auto-Detection

When `$ARGUMENTS` does not start with a recognized `type:` prefix, the command analyzes the changed file paths to determine the dominant type:

| Changed File Patterns                                              | Detected Type          |
| ------------------------------------------------------------------ | ---------------------- |
| `src/` with new files or substantial new functionality             | `feat`                 |
| `src/` with bug fix modifications                                  | `fix`                  |
| `src/` with structural changes, no new features                    | `refactor`             |
| Only `docs/`, `README*`, `CLAUDE.md`, `*.html` (doc files)         | `docs`                 |
| Only test files (`*.test.ts`, `*.spec.ts`, `test/`)                | `test`                 |
| Only config files (`package.json` scripts, eslint, vite, tsconfig) | `chore`                |
| Only `.github/workflows/`                                          | `ci`                   |
| Only CSS/formatting changes                                        | `style`                |
| Performance-focused changes                                        | `perf`                 |
| Security-related changes                                           | `security`             |
| UI-only changes (popup, CSS)                                       | `ui`                   |
| `scripts/` new tooling + docs updates                              | Dominant by proportion |

When changes span multiple categories, the type covering the most impactful changes wins. For truly mixed changes, `feat` is used if new functionality is present, otherwise `chore`.

### 2.6 Allowed Commit Types

From `commitlint.config.js`:

```
feat, fix, docs, style, refactor, perf, test, chore, revert, build, ci, security, ui, release
```

Header max-length: **100 characters** (commitlint rule).

### 2.7 Branch Naming

| Property        | Rule                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Pattern         | `{type}/{slug}`                                                                                                                  |
| Slug derivation | Lowercase description, non-alphanumeric chars replaced with `-`, consecutive hyphens collapsed, leading/trailing hyphens trimmed |
| Max slug length | 50 characters                                                                                                                    |
| Trigger         | Only when current branch is `main`                                                                                               |

Examples:

- `feat: add platform lint script` -> `feat/add-platform-lint-script`
- `docs: update README with Perplexity` -> `docs/update-readme-with-perplexity`
- `fix: handle null pointer in gemini extractor` -> `fix/handle-null-pointer-in-gemini-extractor`

Branch prefix mapping uses `{type}/` directly (e.g., `feat/`, `fix/`, `docs/`).

### 2.8 Commit Message Format

```
{type}: {description}

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

Rules:

- Description starts lowercase
- No trailing period
- No emoji in the header
- Total header line under 100 characters
- Blank line between header and trailer
- Co-Authored-By trailer always present

Implementation uses a heredoc to ensure correct multi-line formatting:

```bash
git commit -m "$(cat <<'EOF'
{type}: {description}

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

### 2.9 File Staging Rules

**Stage**: All changed/new files relevant to the work, added by explicit path.

**Never stage**:

- `.env`, `.env.local`, `.mcp.json`
- `node_modules/`, `dist/`, `coverage/`
- `.DS_Store`, `Thumbs.db`
- Files matching `*credential*`, `*secret*`, `*token*`, `*.key`, `*.pem`

**Warn and ask user**: Any file not in the skip list but matching a suspicious pattern (e.g., contains "password", "api_key" in filename).

NEVER use `git add -A` or `git add .`.

### 2.10 PR Creation

**Check first**: `gh pr view --json url 2>/dev/null` — if a PR already exists for the branch, report the existing URL and skip creation.

**Title**: Exactly matches the commit header (e.g., `feat: add platform lint script`).

**Body structure**:

```markdown
## Summary
- {bullet points summarizing changes, derived from the diff}

## Test plan
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] {additional checks relevant to the change}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

The summary and test plan are customized based on the actual changes — not a static template.

### 2.11 Safety Rules

| Rule                                  | Rationale                           |
| ------------------------------------- | ----------------------------------- |
| NEVER `git push --force`              | Prevents history destruction        |
| NEVER `--no-verify` on commit         | Commitlint hook provides safety net |
| NEVER `--amend`                       | Prevents modifying previous commits |
| NEVER `git add -A` or `git add .`     | Prevents staging secrets            |
| Abort on divergent remote             | Prevents silent overwrites          |
| Check for existing PR before creating | Prevents duplicates                 |

### 2.12 Edge Cases

| Scenario                                    | Behavior                                               |
| ------------------------------------------- | ------------------------------------------------------ |
| No changes detected                         | Abort with "Nothing to release — no changes detected." |
| Already on non-main branch                  | Use current branch, skip branch creation               |
| Remote branch exists with divergent history | Abort and report, never force push                     |
| PR already exists for branch                | Report existing PR URL, skip PR creation               |
| Commit fails (commitlint rejects message)   | Fix message format and create NEW commit               |
| `gh` CLI not authenticated                  | Report error and suggest `gh auth login`               |
| Push fails (no remote access)               | Report error with the push failure message             |

---

## 3. YAML Frontmatter Specification

```yaml
---
description: "Commit, push, and create PR following release-please conventions"
---
```

Only the `description` field is needed. The command is user-invocable by default. No tool restrictions are specified — Claude needs access to Bash (for git/gh), Read (for diff analysis), and other standard tools.

---

## 4. Files Modified

| File                          | Type     | Change                                 |
| ----------------------------- | -------- | -------------------------------------- |
| `.claude/commands/release.md` | **New**  | Custom slash command                   |
| `.gitignore`                  | Modified | Add `!.claude/commands/` negation rule |

**Total: 2 files (1 new, 1 modified)**

---

## 5. Verification Plan

### 5.1 File Tracking Verification

```bash
# Confirm release.md is NOT ignored by git
git check-ignore .claude/commands/release.md
# Expected: no output (file is tracked)

# Confirm settings.local.json IS still ignored
git check-ignore .claude/settings.local.json
# Expected: .claude/settings.local.json
```

### 5.2 Functional Verification

1. Open a new Claude Code session in the project
2. Type `/release` — confirm the command appears in autocomplete
3. Make a trivial change (e.g., add a comment to a test file)
4. Run `/release "test the release command"` — confirm the full workflow executes:
   - Branch created: `test/test-the-release-command` (or similar)
   - Commit: `test: test the release command`
   - Push succeeds
   - PR created with structured body
5. Delete the test PR and branch after verification
