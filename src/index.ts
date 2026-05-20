/**
 * Gob Extension
 *
 * Manages gob background jobs from within pi.
 * Connects to the gob daemon via Unix socket for real-time job monitoring.
 * Emits powerbar:update events with segment id "gob" showing running jobs.
 * Use /gob to view and interact with running and stopped jobs.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { DaemonClient } from "./daemon-client.js";
import { formatJobSegment } from "./segment.js";
import type { Event, JobResponse } from "./types.js";

const SEGMENT_ID = "gob";
const RECONNECT_DELAY_MS = 5000;
const TICK_INTERVAL_MS = 1000;

export default function (pi: ExtensionAPI) {
	// Register powerbar segment
	pi.events.emit("powerbar:register-segment", { id: "gob", label: "Gob Jobs" });

	const client = new DaemonClient();

	// Map of running jobs by ID (only running jobs for the current workdir)
	const runningJobs = new Map<string, JobResponse>();

	// Session CWD
	let sessionCwd: string | undefined;

	// Cleanup handles
	let unsubscribe: (() => void) | undefined;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let tickInterval: ReturnType<typeof setInterval> | undefined;

	/**
	 * Emit a powerbar:update event with current running jobs.
	 */
	function updateSegment(): void {
		const jobs = Array.from(runningJobs.values());

		if (jobs.length === 0) {
			// Clear the segment
			pi.events.emit("powerbar:update", { id: SEGMENT_ID });
			stopTick();
			return;
		}

		const segment = formatJobSegment(jobs);

		pi.events.emit("powerbar:update", {
			id: SEGMENT_ID,
			text: segment.text,
			icon: segment.icon,
			color: segment.color,
		});

		startTick();
	}

	/**
	 * Start the 1-second tick interval for updating elapsed times.
	 */
	function startTick(): void {
		if (tickInterval) return;
		tickInterval = setInterval(() => {
			if (runningJobs.size > 0) {
				updateSegment();
			} else {
				stopTick();
			}
		}, TICK_INTERVAL_MS);
	}

	/**
	 * Stop the tick interval.
	 */
	function stopTick(): void {
		if (tickInterval) {
			clearInterval(tickInterval);
			tickInterval = undefined;
		}
	}

	/**
	 * Handle a daemon event by updating the running jobs map.
	 */
	function handleEvent(event: Event): void {
		const job = event.job;

		switch (event.type) {
			case "job_added":
			case "job_started":
			case "run_started":
			case "job_updated":
			case "ports_updated":
				if (job.status === "running") {
					runningJobs.set(job.id, job);
				} else {
					runningJobs.delete(job.id);
				}
				break;

			case "job_stopped":
			case "run_stopped":
				runningJobs.delete(job.id);
				break;

			case "job_removed":
			case "run_removed":
				runningJobs.delete(job.id);
				break;
		}

		updateSegment();
	}

	/**
	 * Connect to daemon, fetch initial state, and subscribe to events.
	 */
	async function connectAndSubscribe(): Promise<void> {
		// Clear any pending reconnect
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = undefined;
		}

		const ok = await client.connect();
		if (!ok) {
			// Daemon not running, schedule reconnect
			scheduleReconnect();
			return;
		}

		try {
			// Fetch initial list of jobs
			const jobs = await client.list(sessionCwd);
			runningJobs.clear();
			for (const job of jobs) {
				if (job.status === "running") {
					runningJobs.set(job.id, job);
				}
			}
			updateSegment();
		} catch {
			// Failed to list, schedule reconnect
			scheduleReconnect();
			return;
		}

		// Subscribe to events
		unsubscribe = client.subscribe(
			sessionCwd,
			(event) => handleEvent(event),
			(_err) => {
				// Subscription disconnected, try to reconnect
				unsubscribe = undefined;
				runningJobs.clear();
				updateSegment();
				scheduleReconnect();
			},
		);
	}

	/**
	 * Schedule a reconnection attempt.
	 */
	function scheduleReconnect(): void {
		if (reconnectTimer) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = undefined;
			connectAndSubscribe();
		}, RECONNECT_DELAY_MS);
	}

	/**
	 * Cleanup all connections and timers.
	 */
	function cleanup(): void {
		if (unsubscribe) {
			unsubscribe();
			unsubscribe = undefined;
		}
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = undefined;
		}
		stopTick();
		client.disconnect();
		runningJobs.clear();
	}

	// ── Lifecycle ──────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		sessionCwd = ctx.cwd;
		await connectAndSubscribe();
	});

	pi.on("session_shutdown", async () => {
		cleanup();
		pi.events.emit("powerbar:update", { id: SEGMENT_ID });
	});

	// ── Job list UI ──

	async function fetchJobs(): Promise<JobResponse[]> {
		// Try daemon protocol first
		if (client.connected) {
			try {
				return await client.list(sessionCwd);
			} catch {
				// Fall through to CLI
			}
		}

		// CLI fallback
		const result = await pi.exec("gob", ["list"]);
		if (result.code !== 0) {
			return [];
		}
		return parseGobList(result.stdout);
	}

	function parseGobList(output: string): JobResponse[] {
		const jobs: JobResponse[] = [];
		const lines = output.split("\n").filter((l) => l.trim().length > 0);

		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			// Format: <job_id>: [<pid>] <status> (<exit_code>): <command>
			const match = line.match(/^(\S+): \[(\S+)\] (\S+)(?: \((\d+)\))?: (.+)$/);
			if (match) {
				const description =
					i + 1 < lines.length && lines[i + 1].startsWith("         ") ? lines[i + 1].trim() : undefined;

				if (description) i++;

				jobs.push({
					id: match[1],
					pid: Number.parseInt(match[2], 10) || 0,
					status: match[3],
					command: match[5].split(" "),
					workdir: "",
					description,
					created_at: "",
					started_at: "",
					stdout_path: "",
					stderr_path: "",
					exit_code: match[4] ? Number.parseInt(match[4], 10) : undefined,
					run_count: 0,
					success_count: 0,
					failure_count: 0,
					success_rate: 0,
					avg_duration_ms: 0,
					failure_avg_duration_ms: 0,
					min_duration_ms: 0,
					max_duration_ms: 0,
				});
			}
			i++;
		}

		return jobs;
	}

	async function executeJobAction(action: string, jobId: string): Promise<{ message: string; success: boolean }> {
		// Try daemon protocol first
		if (client.connected) {
			try {
				const resp = await client.sendRequest(action, { job_id: jobId });
				if (resp.success) {
					const verb =
						action === "stop"
							? "Stopped"
							: action === "start"
								? "Started"
								: action === "restart"
									? "Restarted"
									: action === "remove"
										? "Removed"
										: action;
					return { message: `${verb} ${jobId}`, success: true };
				}
				return { message: `Error: ${resp.error}`, success: false };
			} catch {
				// Fall through to CLI
			}
		}

		// CLI fallback
		const result = await pi.exec("gob", [action, jobId]);
		if (result.code === 0) {
			const verb =
				action === "stop"
					? "Stopped"
					: action === "start"
						? "Started"
						: action === "restart"
							? "Restarted"
							: action === "remove"
								? "Removed"
								: action;
			return { message: `${verb} ${jobId}`, success: true };
		}
		return { message: `Error: ${result.stderr}`, success: false };
	}

	const showJobList = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) {
			ctx.ui.notify("No UI available", "error");
			return;
		}

		const jobs = await fetchJobs();

		if (jobs.length === 0) {
			ctx.ui.notify("No gob jobs found", "info");
			return;
		}

		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			const container = new Container();

			// Top border
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			// Title
			container.addChild(new Text(theme.fg("accent", theme.bold(" Gob Jobs")), 0, 0));

			// Build select items
			const items: SelectItem[] = jobs.map((job) => {
				const statusColor = job.status === "running" ? "success" : "muted";
				const statusIcon = job.status === "running" ? "●" : "○";
				const exitInfo =
					job.status === "stopped" && job.exit_code != null ? theme.fg("dim", ` (${job.exit_code})`) : "";
				const status = theme.fg(statusColor, statusIcon);
				const cmdStr = job.command.join(" ");
				const label = `${status} ${theme.fg("dim", job.id)} ${cmdStr}${exitInfo}`;
				const description = job.description ? theme.fg("muted", job.description) : undefined;
				return {
					value: job.id,
					label,
					description,
				};
			});

			const visibleRows = Math.min(jobs.length, 15);
			let currentIndex = 0;

			const selectList = new SelectList(items, visibleRows, {
				selectedPrefix: (t) => theme.fg("accent", t),
				selectedText: (t) => t,
				description: (t) => t,
				scrollInfo: (t) => theme.fg("dim", t),
				noMatch: (t) => theme.fg("warning", t),
			});

			selectList.onSelect = async (item) => {
				done();
				const job = jobs.find((j) => j.id === item.value);
				if (job) {
					await showJobActions(ctx, job);
				}
			};
			selectList.onCancel = () => done();
			selectList.onSelectionChange = (item) => {
				currentIndex = items.indexOf(item);
			};
			container.addChild(selectList);

			// Help text
			container.addChild(new Text(theme.fg("dim", " ↑↓ navigate • ←→ page • enter actions • esc close"), 0, 0));

			// Bottom border
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (w) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data) => {
					if (matchesKey(data, Key.left)) {
						currentIndex = Math.max(0, currentIndex - visibleRows);
						selectList.setSelectedIndex(currentIndex);
					} else if (matchesKey(data, Key.right)) {
						currentIndex = Math.min(items.length - 1, currentIndex + visibleRows);
						selectList.setSelectedIndex(currentIndex);
					} else {
						selectList.handleInput(data);
					}
					tui.requestRender();
				},
			};
		});
	};

	const showJobActions = async (ctx: ExtensionContext, job: JobResponse) => {
		const actions: string[] = [];

		if (job.status === "running") {
			actions.push("logs", "stop", "restart");
		} else {
			actions.push("logs", "start", "restart", "remove");
		}

		const cmdStr = job.command.join(" ");
		const action = await ctx.ui.select(`${job.id}: ${cmdStr}`, actions);
		if (!action) return;

		switch (action) {
			case "logs": {
				const result = await pi.exec("gob", ["logs", "--tail", "50", job.id], { timeout: 5000 });
				if (result.code === 0 && result.stdout.trim()) {
					ctx.ui.notify(`Logs for ${job.id}:\n${result.stdout.trim()}`, "info");
				} else {
					ctx.ui.notify(`No logs for ${job.id}`, "info");
				}
				break;
			}
			case "stop":
			case "start":
			case "restart":
			case "remove": {
				const result = await executeJobAction(action, job.id);
				ctx.ui.notify(result.message, result.success ? "info" : "error");
				break;
			}
		}
	};

	// Register /gob command
	pi.registerCommand("gob", {
		description: "View and manage gob background jobs",
		handler: async (_args, ctx) => showJobList(ctx),
	});
}
