# Project: cc-manager
A conversation-first requirement and development manager powered by Claude Code.

---

## Status
Drafting

---

## Context & Intent
`cc-manager` is designed to work exactly like how this conversation is happening right now.

The user shares thoughts incrementally, informally, and sometimes out of order. Claude Code continuously listens, understands intent, and **maintains a single living Markdown document** that evolves over time.

This is not a prompt-to-output tool.  
It is an **ongoing collaboration** where:
- Chat is the thinking space
- The editor is the source of truth
- Claude Code acts as an active editor and interpreter

The goal is to allow users to:
- capture ideas anytime (driving, showering, inspiration moments)
- draft TODOs without friction
- refine requirements over time
- later attach the project to a GitHub repo and start development

---

## Assumptions
- User prefers conversational input over structured forms
- Claude Code is available and authenticated via token
- Claude Code has the Ralph-wiggum plugin enabled
- Single-user usage initially
- Projects are logically independent and isolated
- ❌ Invalidated assumptions must be explicitly marked

---

## Constraints
- Projects MUST be isolated and must not share chat memory or editor content
- GitHub repository link is REQUIRED before any development begins
- Development actions are forbidden without an attached repository
- Entire system MUST run using Docker Compose
- Claude Code is accessed using a **Claude Code Token**
- **All UI components MUST be built using `shadcn/ui`**
  - No alternative UI libraries allowed
  - Custom components must be composed from shadcn primitives or follow shadcn conventions
- **All code and utilities must follow Claude Code’s “compact function” style**
  - Prefer small, single-purpose functions
  - Avoid large multi-responsibility functions
  - Keep functions short and readable (Claude Code-like compactness)
  - Extract helpers early instead of nesting logic deeply

---

## Open Questions
- How should drafts be merged into existing projects (manual vs guided)?
- Should quick-capture mode support voice input in the future?
- How much chat history should be summarized vs stored verbatim?
- What is the exact definition/threshold for “compact function” (max lines, max branches)?

---

## Requirements

### Functional
- **FR-001** — System shall provide a dashboard listing all projects
- **FR-002** — User shall be able to create a new project from the dashboard
- **FR-003** — Each project shall open a workspace with chat (left) and editor (right)
- **FR-004** — Chat history shall persist per project
- **FR-005** — Switching projects shall load that project’s chat and editor content
- **FR-006** — Projects shall be fully isolated from one another
- **FR-007** — Chat input shall incrementally update the Markdown editor via Claude Code
- **FR-008** — Editor shall allow manual user edits and saving
- **FR-009** — Editor content shall be treated as the canonical project state
- **FR-010** — System shall support requirement drafting without a GitHub repo
- **FR-011** — User shall be able to link a GitHub repo at a later stage
- **FR-012** — Once a repo is linked, project shall enter Development Mode
- **FR-013** — In Development Mode, Claude Code shall operate in Ralph-wiggum mode
- **FR-014** — Claude Code shall generate, modify, commit, and push code to the linked repo
- **FR-015** — Draft projects shall be attachable to an existing project explicitly by user action

### Non-Functional
- **NFR-001** — Claude updates must apply minimal diffs, not full rewrites
- **NFR-002** — Editor updates must be auditable and versioned
- **NFR-003** — System must enforce strict project context boundaries
- **NFR-004** — UI must be responsive and usable for quick idea capture
- **NFR-005** — System must support real-time editor updates
- **NFR-006** — Codebase must adhere to “compact function” style consistently

### Out of Scope
- **OS-001** — Multi-user collaboration
- **OS-002** — CI/CD pipeline management
- **OS-003** — Exporting documents
- **OS-004** — Cross-project shared memory

---

## TODO

### Phase 0 — Setup
- [ ] T-001 — Initialize Docker Compose setup
- [ ] T-002 — Setup backend API service
- [ ] T-003 — Setup frontend with shadcn/ui
- [ ] T-004 — Setup database schema for projects, chats, and documents

### Phase 1 — Core
- [ ] T-005 — Implement dashboard with project list
- [ ] T-006 — Implement project creation flow
- [ ] T-007 — Implement project workspace (chat + editor layout)
- [ ] T-008 — Persist chat history per project
- [ ] T-009 — Persist editor Markdown per project
- [ ] T-010 — Integrate Claude Code via token
- [ ] T-011 — Implement incremental editor update logic (diff-based)
- [ ] T-012 — Add coding guideline enforcement docs for “compact function” style

### Phase 2 — Enhancements
- [ ] T-013 — Implement quick-capture mode for draft projects
- [ ] T-014 — Implement draft-to-project attachment flow
- [ ] T-015 — Add version history and diff viewer
- [ ] T-016 — Implement GitHub repo linking
- [ ] T-017 — Enable Ralph-wiggum mode for development actions

---

## Decisions & Notes
- [2026-01-07] Editor Markdown is the single source of truth
- [2026-01-07] Projects are strictly isolated with no shared context
- [2026-01-07] shadcn/ui is mandated for all UI components
- [2026-01-07] Code style must follow Claude Code-like compact functions

---

## Change Log
- [2026-01-07 01:32] Added constraint and NFR enforcing Claude Code-like compact function style across the codebase
