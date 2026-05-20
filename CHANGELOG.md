# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Prefer job description over command in segment display (thanks @HazAT for the idea in PR #1)
- Migrated from `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` to `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`

## [0.5.0] - 2026-03-23

### Changed

- Updated `@mariozechner/pi-coding-agent` dev dependency to ^0.62.0

## [0.4.1] - 2026-03-07

### Fixed

- Repository URL in package.json now uses https instead of git+ssh

## [0.4.0] - 2026-02-07

- Register `gob` powerbar segment via `powerbar:register-segment` event for ordered multi-select settings

## [0.3.0] - 2026-02-07

### Changed

- Replaced standalone widget with a powerbar segment (`gob`) via `powerbar:update` events
- Removed `widget.ts`; added `segment.ts` for powerbar formatting
- 1 running job shows `⚙ <command>`, multiple shows `⚙ N jobs`
- Jobs with historical run data show a progress bar and percentage via the powerbar's built-in bar support
- Multiple jobs with history show average progress across all tracked jobs

## [0.2.0] - 2026-02-04

- Connect to gob daemon via Unix socket for real-time job monitoring
- Show live widget below editor with running jobs and progress bars

## [0.1.0] - 2026-02-04

- Initial release
- `/gob` command for viewing and managing background jobs
- CLI-based job listing and actions
