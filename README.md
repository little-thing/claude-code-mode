<div align="center">

# claude-code-mode

**A session workspace for DeepSeek Harness, modeled on the Claude app.**

<a href="https://www.npmjs.com/package/claude-code-mode"><img alt="npm version" src="https://img.shields.io/npm/v/claude-code-mode" /></a>
<a href="https://www.npmjs.com/package/claude-code-mode"><img alt="npm downloads" src="https://img.shields.io/npm/dm/claude-code-mode" /></a>
<a href="https://github.com/little-thing/claude-code-mode/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/little-thing/claude-code-mode/actions/workflows/ci.yml/badge.svg" /></a>
<a href="https://github.com/little-thing/claude-code-mode/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/little-thing/claude-code-mode" /></a>
<a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
<a href="https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions"><img alt="DSH 0.2.2-rc.1+" src="https://img.shields.io/badge/DSH-0.2.2--rc.1%2B-4d6bfe" /></a>

English · <a href="./README_ZH.md">简体中文</a>

</div>

<div align="center">
  <video src="https://github.com/user-attachments/assets/d6eb91bd-b836-41ce-af9d-90cd9acd4bf1" muted autoplay loop playsinline controls width="100%"></video>
</div>

DSH keeps every session as an independent row in a flat list. A fork looks like any other conversation, and comparing two sessions means switching back and forth.

claude-code-mode gives that list the structure of the Claude app: sessions remember where they came from, several can stay visible at once, and each carries its own tools. Everything DSH already does keeps working — the plugin changes how sessions are organised and presented, not what the host can do.

## Features

| | |
|---|---|
| **Session tree**<br/>Forked sessions stay attached to their source, and a fork of a fork still hangs under the same root, so a line of work reads as one continuous tree. Collapsed branches keep their parent visible with a count of what is hidden.<br/><img alt="Session tree" src="docs/media/session-tree.png" width="100%"> | **Split view**<br/>Up to four sessions on one screen, arranged in two columns and two rows. Each pane is a complete session with its own composer, scroll position and right rail, and the layout survives a reload.<br/><img alt="Split view" src="docs/media/split-view.png" width="100%"> |
| **Pins and sections**<br/>Pin the sessions you return to most. Sections are groups that cut across projects, so sessions from different repositories can sit in one place without being moved out of their project.<br/><img alt="Pins and sections" src="docs/media/sections.png" width="100%"> | **Right rail**<br/>Files, editor, terminal, Git, browser and session diagnostics live in a rail bound to the session rather than to the window. Panels can be split, maximized and rearranged, and every pane in split view keeps its own rail.<br/><img alt="Right rail" src="docs/media/right-rail.png" width="100%"> |
| **Views and sorting**<br/>Group sessions by folder, date, status, or not at all; sort by last update, creation date or name in either direction. Archived sessions can be shown or hidden, and each group remembers its own view.<br/><img alt="View menu" src="docs/media/view-menu.png" width="100%"> | **Message rewind**<br/>Return to any user message and continue from there. The session log is left untouched, and files changed in the rewound range can be restored when nothing has touched them since.<br/><img alt="Message rewind" src="docs/media/rewind.png" width="100%"> |
| **Search and new sessions**<br/>One palette searches sessions, projects, automations and actions. Unsent drafts survive switching sessions and follow you when you start a session in another project.<br/><img alt="Search" src="docs/media/search.png" width="100%"> | **Image preview**<br/>Every image inside a session — tool output, collapsed summaries, message links and delivered files — opens in the same full-size lightbox.<br/><img alt="Image preview" src="docs/media/image-preview.png" width="100%"> |
| **Session actions**<br/>Rename in place, fork, archive, delete, copy the session ID, and browse every session in a full page with active and archived tabs.<br/><img alt="Session actions" src="docs/media/session-actions.png" width="100%"> | **Skins**<br/>A light and a dark skin modeled on the Claude app. The skin is a separate layer: switch it off and every feature keeps working in DSH's native look.<br/><img alt="Skin" src="docs/media/skin.png" width="100%"> |

**Also**: a settings page with a switch per feature (sidebar, split view, session header, right rail, message rewind, image preview — all on by default) · background jobs with running and completed groups · window controls for the sidebar, back and forward · `mcp_tool_search`, which keeps MCP tools out of the model context until they are needed · a shimmer on sessions that are still running.

## Settings

Every feature can be turned off in **Settings → claude-code-mode**. Switches are grouped by what you see — the sidebar, split view, the session header, the right rail, message rewind and image preview — so a single switch can cover several related behaviours. Turning one off hands that part of the interface back to DSH. The skin picker lives in the same section and offers the Claude skin or DSH's native look.

## Install

**Web profile:**

```bash
dsh plugin --profile web add claude-code-mode@latest
```

**Desktop app:**

```bash
dsh plugin --profile desktop add claude-code-mode@latest
```

Open DeepSeek Harness Desktop once so it initializes its profile, then quit the app before running the command.

Restart DSH if the plugin does not load by itself, then refresh the page.

Requires DSH **0.2.2-rc.1** or newer; older hosts are rejected at install time.

<details>
<summary><b>Install from source</b></summary>

```bash
git clone https://github.com/little-thing/claude-code-mode.git
cd claude-code-mode
pnpm install && pnpm build
dsh plugin --profile web add file:$PWD   # or --profile desktop
```

</details>

## Compatibility

| DSH version | Status |
|---|---|
| `0.2.2-rc.1` and newer | Supported |
| `< 0.2.2-rc.1` | Rejected at install time |

## Development

<details>
<summary><b>Build and test</b></summary>

```bash
pnpm install
pnpm build
node --test test/mcp-tool-search/*.test.mjs test/theme/*.test.mjs
```

</details>

## License

MIT.

---

<div align="center">
  <sub>Built for the <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> ecosystem · <a href="https://github.com/little-thing/claude-code-mode">github.com/little-thing/claude-code-mode</a></sub>
</div>
