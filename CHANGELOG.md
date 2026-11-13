# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

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
