/**
 * Widget rendering for gob running jobs.
 * Renders a single horizontal line showing running jobs.
 *
 * Layout: ● server 0:12:34 │ ● build ████░░░ 57% │ ● lint 0:00:05
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import type { JobResponse } from "./types.js";

/**
 * Format elapsed time as H:MM:SS or M:SS.
 */
function formatElapsed(startedAt: string): string {
	const start = new Date(startedAt).getTime();
	const now = Date.now();
	const elapsed = Math.max(0, Math.floor((now - start) / 1000));

	const hours = Math.floor(elapsed / 3600);
	const minutes = Math.floor((elapsed % 3600) / 60);
	const seconds = elapsed % 60;

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Render a progress bar for a job with known average duration.
 * Returns something like "████░░░░ 57%" or "████████ 2:15" (overtime).
 */
function renderProgress(startedAt: string, avgDurationMs: number, theme: Theme): string {
	const start = new Date(startedAt).getTime();
	const elapsedMs = Date.now() - start;
	const ratio = Math.min(elapsedMs / avgDurationMs, 1);
	const barWidth = 8;
	const filled = Math.round(ratio * barWidth);
	const empty = barWidth - filled;

	const isOvertime = elapsedMs > avgDurationMs;

	if (isOvertime) {
		// Full bar in warning color + overtime elapsed
		const bar = theme.fg("warning", "█".repeat(barWidth));
		const overtime = formatElapsed(startedAt);
		return `${bar} ${theme.fg("warning", overtime)}`;
	}

	const percent = Math.round(ratio * 100);
	const bar = theme.fg("success", "█".repeat(filled)) + theme.fg("dim", "░".repeat(empty));
	return `${bar} ${theme.fg("dim", `${percent}%`)}`;
}

/**
 * Render a single job entry for the widget.
 * Returns: "● {id} {elapsed_or_progress}"
 */
function renderJob(job: JobResponse, theme: Theme): string {
	const dot = theme.fg("success", "●");
	const cmd = theme.fg("text", job.description || job.command.join(" "));

	if (job.avg_duration_ms > 0) {
		const info = renderProgress(job.started_at, job.avg_duration_ms, theme);
		return `${dot} ${cmd} ${info}`;
	}

	return `${dot} ${cmd}`;
}

/**
 * Render the running jobs widget as a single horizontal line.
 * Returns an empty array if no running jobs.
 *
 * @param jobs - Running jobs to display
 * @param theme - Theme for styling
 * @param width - Terminal width for truncation
 */
export function renderJobWidget(jobs: JobResponse[], theme: Theme, width: number): string[] {
	if (jobs.length === 0) {
		return [];
	}

	const separator = theme.fg("dim", " │ ");
	const parts = jobs.map((job) => renderJob(job, theme));
	const line = parts.join(separator);

	return [truncateToWidth(line, width)];
}
