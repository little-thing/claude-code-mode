# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [0.3.6] — 2026-11-17

### Changed

- Releases now ship their own changelog. `node release.mjs` refuses to bump the
  version until both `CHANGELOG.md` and `CHANGELOG_ZH.md` describe the release,
  so a published package always tells users what changed. The missing 0.3.4 and
  0.3.5 records are included in this package as well.

## [0.3.5] — 2026-11-17

### Fixed

- The sidebar's project and session list is visible again on DSH 0.2.2 and
  later. 0.2.2 moved the panel navigation and the workspace seat into a
  scrolling grid inside the sidebar; the plugin kept inserting its own middle
  scroller on the same level, which packed both grid items into a single
  4×8 px cell and left the tree 0 px wide — it kept rendering, just invisibly.
  The adapter now tells the two shells apart by structure, leaves the shipped
  grid alone and keeps the native scrolling; a collapsed sidebar is never
  restructured.
- The New Session row keeps its label and shortcut again: the button is looked
  up through the `sidebar.session.action` slot and fills its row instead of
  shrinking down to its own padding.

## [0.3.4] — 2026-11-13

### Changed

- Blocked reasons show variable names clearly instead of an internal
  placeholder.

### Fixed

- MCP tool search no longer fails every turn with `'get' on proxy: property
  'dispose' is a read-only and non-configurable data property ...`. The wrapped
  tool set is now a shape-preserving proxy, so deferred MCP tools stay out of
  the first request and `mcp_tool_search` stays callable.

## [0.3.3] — 2026-11-13

The first public release that ships the safety guardrails.

### Added

- **Safety guardrails**: a built-in deterministic check that runs before any
  model-based review and does not rely on model judgement.
  - Blocks deleting critical directories (the home directory, the filesystem
    root, top-level directories, the working directory and its ancestors), as
    well as `curl | bash`, destructive git commands, and writes to protected
    paths such as `~/.zshrc`, `~/.ssh`, `.git` and `.mcp.json`.
  - A match asks you once for that call; unattended sessions refuse it without
    a prompt.
  - The read-only "recently blocked" list under Safety guardrails in
    **Settings → claude-code-mode** keeps every rejection; repeated attempts
    only raise a hint, never an automatic allow.
  - Variable targets are blocked only when an empty value would land on the
    root or a top-level directory.
  - Configurable through `dangerGuard.enabled` and
    `dangerGuard.protectedPaths`.

### Changed

- A command that fails shell parsing is sent for approval only when its text
  still carries a dangerous action; every other parse failure goes back to
  DSH's own permission flow.

### Fixed

- Tool calls and their results no longer lose pairing after a rewind.

### Limitations

- It is a command-and-write check, not a sandbox: code a runtime executes
  internally is outside its view.

## Earlier releases

`0.3.0` (2026-11-11) was the first public release; no per-change record was
kept for it.
