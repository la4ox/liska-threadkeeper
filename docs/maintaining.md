# Maintaining Liska

Liska intentionally keeps its repository automation small. GitHub Actions runs
one required CI workflow; releases are explicit maintainer actions. There is no
workflow with permission to create pull requests, publish Pages, or release code
without a maintainer command.

## Pull requests

Work on a topic branch and open a pull request into `main`. The protected main
branch requires the `ci` job, which performs linting, format checking, the full
coverage-gated test suite, and a production ZIP build. Conventional commit
messages remain a readable convention, not a local hook or merge gate.

## Release checklist

1. Merge a green pull request that updates both `package.json` and
   `src/manifest.json` to the intended Chrome-compatible version.
2. Switch to the resulting `main`, record the exact commit, and require a clean
   worktree before building:

   ```powershell
   git switch main
   git pull --ff-only
   $testedCommit = (git rev-parse HEAD).Trim()
   if (git status --porcelain) { throw "Release worktree is not clean" }
   ```

3. Run the complete maintained test and coverage suite, then build:

   ```powershell
   npm ci
   npm run test:coverage
   npm run build:zip
   ```

4. Inspect `liska-threadkeeper-<version>.zip` and load its extracted contents as
   an unpacked extension for a short browser smoke test.
5. Verify that neither `HEAD` nor the tracked tree changed during verification,
   then create the release against that exact commit:

   ```powershell
   if ((git rev-parse HEAD).Trim() -ne $testedCommit) { throw "HEAD changed" }
   if (git status --porcelain) { throw "Release worktree changed" }
   gh release create v<version> .\liska-threadkeeper-<version>.zip `
     --target $testedCommit `
     --title "Liska <version>" `
     --notes-file <release-notes.md>
   ```

6. Confirm the release asset digest and tag target through GitHub before
   announcing the release.

`npm run build:zip` is cross-platform. It uses `tar.exe` on Windows and `zip`
on macOS/Linux, after staging the same filtered `dist/` tree on every platform.
It fails closed when the package and extension-manifest versions disagree.

## Documentation hosting

User documentation and the privacy policy live in this repository. GitHub Pages
is deliberately not enabled yet. If Liska later needs a public product site,
add a site entry point and a dedicated deployment workflow as a separate,
reviewed feature rather than granting unused Pages permissions now.

## Upstream changes

Do not use GitHub's one-click **Sync fork** on `main`. Fetch upstream changes,
review them on a topic branch, and take only the commits or patches that fit
Liska's supported behavior. Run the full CI surface and a live provider smoke
test before merging extractor changes.
