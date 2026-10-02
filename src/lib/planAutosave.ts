import { ipc } from "./ipc";
import type { ResumePlan } from "./types";

/**
 * Serialized plan autosave (Phase "make autosave reliable").
 *
 * Every mutation enqueues the newest plan snapshot for its job; a per-job
 * writer loop persists them one IPC call at a time. Guarantees:
 *
 * - An older snapshot can never overwrite a newer edit — only one save is in
 *   flight per job, and it always carries the latest snapshot taken when the
 *   save started. Edits made mid-flight coalesce into the next save.
 * - A failed save keeps the unsaved snapshot queued (dirty) so the next edit
 *   or an explicit retry re-persists it; the status stays "error" until then.
 *
 * The Studio and the Resume tab both write plans, so the queue lives here as
 * a module singleton — one writer per job across every component.
 */

export type PlanSaveStatus = "idle" | "saving" | "saved" | "error";

type JobQueue = {
  /** Newest snapshot to persist; replaced by every enqueue. */
  plan: ResumePlan;
  /** True while `plan` has not been persisted yet (including after a failure). */
  dirty: boolean;
  inFlight: boolean;
  /** Serializes the writer loop — never more than one save per job at once. */
  chain: Promise<void>;
};

const queues = new Map<number, JobQueue>();
const statuses = new Map<number, PlanSaveStatus>();
const listeners = new Map<number, Set<(status: PlanSaveStatus) => void>>();

function statusFor(jobId: number): PlanSaveStatus {
  return statuses.get(jobId) ?? "idle";
}

function setStatus(jobId: number, status: PlanSaveStatus) {
  statuses.set(jobId, status);
  listeners.get(jobId)?.forEach((cb) => cb(status));
}

function pump(jobId: number) {
  const queue = queues.get(jobId);
  if (!queue || queue.inFlight || !queue.dirty) return;
  queue.inFlight = true;
  setStatus(jobId, "saving");
  queue.chain = queue.chain
    .then(async () => {
      // Snapshot at execution time, not enqueue time: a synchronous burst of
      // edits coalesces into a single save carrying the newest plan.
      const snapshot = queue.plan;
      queue.dirty = false;
      await ipc.savePlan(jobId, snapshot);
      queue.inFlight = false;
      if (queue.dirty) {
        // Edits landed while saving — persist the newest snapshot now.
        pump(jobId);
      } else {
        setStatus(jobId, "saved");
      }
    })
    .catch(() => {
      // Keep the snapshot queued for retry and surface the failure; the
      // chain is reset so the next pump can start fresh.
      queue.inFlight = false;
      queue.dirty = true;
      setStatus(jobId, "error");
    });
}

/** Queue `plan` as the newest state for `jobId` and start the writer. */
export function enqueuePlanSave(jobId: number, plan: ResumePlan): void {
  const queue = queues.get(jobId);
  if (!queue) {
    queues.set(jobId, { plan, dirty: true, inFlight: false, chain: Promise.resolve() });
  } else {
    queue.plan = plan;
    queue.dirty = true;
  }
  pump(jobId);
}

/** Re-attempt a failed save (the snapshot is still queued). */
export function retryPlanSave(jobId: number): void {
  const queue = queues.get(jobId);
  if (queue?.dirty) pump(jobId);
}

/**
 * Resolves once nothing is queued or in flight for `jobId` — used by flows
 * that must observe a persisted plan (e.g. Sync from Vault's toast).
 */
export async function flushPlanSave(jobId: number): Promise<void> {
  const queue = queues.get(jobId);
  if (queue) await queue.chain;
}

export function planSaveStatus(jobId: number | null): PlanSaveStatus {
  return jobId === null ? "idle" : statusFor(jobId);
}

/** Subscribe to a job's save status; fires immediately with the current one. */
export function subscribePlanSaveStatus(
  jobId: number,
  cb: (status: PlanSaveStatus) => void,
): () => void {
  let set = listeners.get(jobId);
  if (!set) {
    set = new Set();
    listeners.set(jobId, set);
  }
  set.add(cb);
  cb(statusFor(jobId));
  return () => {
    set?.delete(cb);
  };
}

/** Test hook: drop all queued state for a job. */
export function resetPlanSaves(jobId?: number): void {
  if (jobId === undefined) {
    queues.clear();
    statuses.clear();
    listeners.clear();
    return;
  }
  queues.delete(jobId);
  statuses.delete(jobId);
  listeners.delete(jobId);
}
