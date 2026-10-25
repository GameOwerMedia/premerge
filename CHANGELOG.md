# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-25

### Added
- `report`: a merge report per branch from git facts (files with +/-, modules, exports added/changed/removed, commits), the author's notes, and generated risks: hot files, partial files, same files in other reports, other unmerged branches touching the same files.
- Mandatory `--why`: no stated purpose, no report (exit 3).
- `--commit`: the report is committed onto the branch through a temporary index; a worktree that has the branch checked out stays clean, and uncommitted edits of its report file are refused, never overwritten.
- `save`: commit chosen files (or only your hunks with `--patch`) from a shared working tree onto your branch without checkout or stash; well-known private file names and lines that look like credentials are refused (best effort, pattern-based; use a dedicated secret scanner as well).
- `list`: every unmerged branch with its report status, purpose and shared files.
- Registry of reports in `.git/premerge/`, shared by all worktrees; `PREMERGE_REGISTRY` to share across repositories.
- Optional `.premerge.json` for base, hot files, module map, production branches.
- Claude Code skill and plugin manifests.
