# Round 3 — checkpoint A

Base: `codex/fix-meeting-setup-scrolling` at `cf0ef1b` (0.5.8).
Implementation branch: `codex/callwise-round-3-a`.

This checkpoint implements Group A. Groups B–E have not started. The supplied
brief is preserved in [CALLWISE_ROUND_3.md](CALLWISE_ROUND_3.md).
No protected UI files or CSS changed. No app installation, public release,
credentials, meeting content, or saved-data settings changed.

## Changes

| Item | Result |
| --- | --- |
| A1 | Leads and cues truncate at the last complete sentence in the word budget, otherwise at a word boundary without trailing punctuation or an ellipsis. Short text cannot retain a trailing comma, colon, or semicolon. |
| A2 | `trigger.question` contains question/request sentences with leading fillers removed; `trigger.text` retains the original evidence. Classification and extraction share sentence rules. |
| A3 | Corrected final rows invalidate promises, transcript/card coverage, affected cards, deduplication, queued and in-flight help, and the compressed summary. Commitments are derived again. Refusals and noncommittal offers do not become deadline promises. Unrelated segment evidence is retained. |
| A4 | Pasted material title/body and Ask text live in view state. They survive unmounting, rerenders, Settings, and rejected commands. Success clears only the submitted draft; text edited while a command is pending survives. Cancel explicitly clears pasted notes. |
| A5 | Electron is pinned to 44.11.3, the latest stable 44.x returned by the registry at this checkpoint. No blanket audit fix. The lockfile's previously stale root version is synchronized to 0.5.8. |
| A6 | Successful drains keep final speech and derive its commitments. Timeout, provider rejection, negative flush status, or remaining partials leave a visible final-words gap. Existing partials retain their ID and unfinalized marker. |
| A7 | Legacy/sample paths are retained and corrected as detailed below. |
| A8 | Done returns to the call for running, paused, and finishing. |
| A9 | `library.path` returns `{ path, encrypted: true }`; snapshots expose `libraryPath`. `library.reveal` opens that app-owned folder through the OS, propagating errors. |
| A10 | README identifies development version 0.5.8. Promotion of the existing 0.5.x stack into main awaits Matt's approval at this checkpoint. |
| A11 | Pull requests run a branch/path ownership guard, checking deletions and both sides of renames. Only `claude/` branches may touch protected paths. Linux Electron smoke is now an explicit Checks step. |

## Validation

Local Node: 24.22.1 on macOS. All providers in the new regression tests are local
stubs; no real call, API key, capture permission, or model latency is claimed.

- `npm test`: 393 tests, 393 passed. This includes 23 new Group A regression tests.
- `npm run check`: 153 JavaScript modules checked; desktop metadata and secret exclusions passed.
- `npm run test:ui`: existing synthetic layout checks passed; new shipped-handler
  browser checks passed for draft restoration, failed/successful commands,
  explicit cancellation, edits during a pending Ask, and Settings during
  running/paused/finishing.
- `npm run test:meetings`: existing notebook browser checks passed.
- Ownership regression: a Codex branch fails with offending UI paths printed;
  the same protected changes are allowed on a `claude/` branch. Shared state
  and command files remain permitted.
- Linux smoke command in Checks:
  `xvfb-run -a node_modules/.bin/electron . --smoke --no-sandbox`.
  Its result is attached to the pull request's Checks run.

## Dependency audit

| Scope | Before | After |
| --- | --- | --- |
| Full lockfile | 30 affected packages: 2 high, 28 moderate | 29 affected packages: 1 high, 28 moderate |
| Electron (a runtime despite being installed from devDependencies) | High | No advisory |
| Production dependency tree, `npm audit --omit=dev` | Not separately measured before | 0 advisories |

The remaining packages are all development/build dependencies. Audit entries
include propagated findings, so 29 packages does not mean 29 distinct advisories.
They are left unchanged to keep this update on Electron major 44 and avoid the
unrelated packaging-tool downgrades proposed by audit.

| Remaining package | Severity | Why retained in this checkpoint |
| --- | --- | --- |
| `@electron/universal` | Moderate | Mac packaging dependency; propagated minimatch finding. |
| `@npmcli/arborist` | Moderate | Development npm dependency; propagated dependency findings. |
| `@npmcli/config` | Moderate | Development npm configuration; propagated workspace finding. |
| `@npmcli/map-workspaces` | Moderate | Development npm workspace discovery; glob/minimatch findings. |
| `@npmcli/metavuln-calculator` | Moderate | Development npm audit tooling; propagated pacote finding. |
| `@npmcli/package-json` | Moderate | Development npm manifest tooling; propagated glob finding. |
| `@sigstore/tuf` | Moderate | Development npm package verification; propagated TUF finding. |
| `@tufjs/models` | Moderate | Development package verification; propagated minimatch finding. |
| `app-builder-lib` | Moderate | Desktop packaging tooling; propagated dependency findings. |
| `cacache` | Moderate | Development npm cache tooling; propagated glob finding. |
| `dmg-builder` | Moderate | Mac disk-image packaging; propagated builder finding. |
| `electron-builder` | Moderate | Desktop packaging tool; audit proposes an unrelated downgrade. |
| `electron-builder-squirrel-windows` | Moderate | Windows packaging tooling; propagated builder finding. |
| `fast-uri` | Moderate | Build-tool URI parsing; unrelated transitive update deferred. |
| `glob` | Moderate | Build/npm file enumeration; unrelated transitive update deferred. |
| `ignore-walk` | Moderate | Development package-file walking; propagated minimatch finding. |
| `ip-address` | Moderate | Development download/proxy dependency; not in the production tree. |
| `libnpmdiff` | Moderate | Development npm diff tooling; propagated dependency findings. |
| `libnpmexec` | Moderate | Development npm execution tooling; propagated dependency findings. |
| `libnpmfund` | Moderate | Development npm funding tooling; propagated arborist finding. |
| `libnpmpack` | Moderate | Development npm archive tooling; propagated dependency findings. |
| `libnpmpublish` | Moderate | Development npm publishing tooling; propagated verification finding. |
| `minimatch` | Moderate | Build/npm glob matching; unrelated toolchain change deferred. |
| `npm` | Moderate | Pinned development package manager; audit proposes an unrelated downgrade. |
| `npm-packlist` | Moderate | Development package-file listing; propagated glob/ignore-walk findings. |
| `pacote` | Moderate | Development npm download tooling; propagated verification finding. |
| `sigstore` | Moderate | Development package verification; propagated TUF finding. |
| `tuf-js` | Moderate | Development package verification; propagated model finding. |
| `undici` | High | HTTP client under build/npm dependencies; absent from the production tree. |

## A7 reachability inventory

| Path | Reachability and disposition |
| --- | --- |
| `ui/views/ready.mjs` | The notebook uses `meetingReady`; the standalone browser/legacy coaching renderer still uses Ready. Retained. |
| `ui/views/recap.mjs` | Notebook calls use `notebook`; the sample/standalone renderer still uses the old recap. Retained. |
| Recap carry control | Hidden for sample calls; the legacy real-call renderer and `recap.carry` command still support it. Fixed with one recap identity per call across retries. A carried retry replaces its existing history entry, and disabling carry removes it. |
| `recent` / `sheet.load` | Not linked from notebook history, but remains a controller command and the standalone Ready renderer's recent-call action. The whole candidate context, including carried recaps, is now size/count checked before clearing the current draft. Loads are rejected while finishing too. |

No dead UI files were deleted. These paths still have callable/renderable uses,
so the reachable-path fixes were taken. The sample remains unsaved and restores
the user's prepared draft as before.

## Claude handoff

Rebase `claude/stage-ui` on this checkpoint before editing shared files.
The complete Stage/pack interface is a later checkpoint; Group A exposes:

- `card.trigger.question`: clean display question; `card.trigger.text`: raw turn.
- `snapshot.libraryPath`: absolute encrypted library folder, null outside desktop.
- `library.path` and `library.reveal` commands.
- `data-action="library-reveal"` is wired for Claude's Settings control.
- View drafts are held in `viewState.drafts` using the existing field IDs:
  `material-title`, `material-text`, `question`.
  If Claude replaces those IDs, update the shared mapping and browser checks.

## Approval boundary

Group B begins after Matt reviews checkpoint A. The proposed main promotion is
the existing 0.5.x stack plus this checkpoint, not a public release. Real Mac
capture, permission/signing continuity, and real-call quality remain device
acceptance checks after an approved test build; this checkpoint does not install
or replace Matt's current app.
