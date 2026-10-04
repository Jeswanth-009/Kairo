import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "./ipc";
import {
  enqueuePlanSave,
  flushPlanSave,
  planSaveStatus,
  resetPlanSaves,
  retryPlanSave,
  subscribePlanSaveStatus,
} from "./planAutosave";
import type { ResumePlan } from "./types";

vi.mock("./ipc", () => ({ ipc: { savePlan: vi.fn() } }));

const savePlan = vi.mocked(ipc.savePlan);

function plan(skills: string[]): ResumePlan {
  // The queue is opaque to plan contents, so a minimal cast keeps the tests
  // readable — identity of the snapshot object is what matters here.
  return { skills } as unknown as ResumePlan;
}

/** Deferred savePlan handle: resolve/reject a specific call manually. */
type Deferred = { resolve: () => void; reject: (e: unknown) => void };
function deferredCalls(): Deferred[] {
  const calls: Deferred[] = [];
  savePlan.mockImplementation(
    () =>
      new Promise<{ ok: boolean; revision: number }>((resolve, reject) => {
        calls.push({ resolve: () => resolve({ ok: true, revision: 1 }), reject });
      }),
  );
  return calls;
}

/** Let pending queue microtasks (pump callbacks) run to completion. */
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  resetPlanSaves();
  savePlan.mockReset();
  savePlan.mockResolvedValue({ ok: true, revision: 1 });
});

describe("planAutosave", () => {
  it("coalesces a synchronous burst of edits into one save with the latest payload", async () => {
    enqueuePlanSave(1, plan(["Rust"]));
    enqueuePlanSave(1, plan(["Rust", "SQL"]));
    enqueuePlanSave(1, plan(["Rust", "SQL", "K8s"]));

    await flushPlanSave(1);

    expect(savePlan).toHaveBeenCalledTimes(1);
    expect(savePlan).toHaveBeenCalledWith(1, plan(["Rust", "SQL", "K8s"]));
    expect(planSaveStatus(1)).toBe("saved");
  });

  it("never lets an older in-flight save overwrite a newer edit", async () => {
    const calls = deferredCalls();
    enqueuePlanSave(7, plan(["v1"]));
    await Promise.resolve(); // the writer's microtask registers save #1

    // Save #1 is in flight; the user edits while it is still pending.
    enqueuePlanSave(7, plan(["v2"]));

    calls[0].resolve();
    await settle();
    expect(savePlan).toHaveBeenCalledTimes(2);

    // The follow-up save carries v2 — one writer at a time, newest wins.
    expect(savePlan.mock.calls[0]).toEqual([7, plan(["v1"])]);
    expect(savePlan.mock.calls[1]).toEqual([7, plan(["v2"])]);

    calls[1].resolve();
    await flushPlanSave(7);
    expect(planSaveStatus(7)).toBe("saved");
  });

  it("reports an error and keeps the snapshot queued until retry succeeds", async () => {
    const calls = deferredCalls();
    const statuses: string[] = [];
    subscribePlanSaveStatus(3, (s) => statuses.push(s));

    enqueuePlanSave(3, plan(["doomed"]));
    await Promise.resolve(); // the writer's microtask registers the save
    calls[0].reject(new Error("disk full"));
    await flushPlanSave(3);

    expect(planSaveStatus(3)).toBe("error");
    expect(statuses).toContain("saving");
    expect(statuses[statuses.length - 1]).toBe("error");

    // The failed snapshot is still queued; retry persists it.
    const retried = deferredCalls();
    retryPlanSave(3);
    await settle();
    expect(planSaveStatus(3)).toBe("saving");
    retried[0].resolve();
    await flushPlanSave(3);
    expect(savePlan).toHaveBeenCalledTimes(2);
    expect(savePlan).toHaveBeenLastCalledWith(3, plan(["doomed"]));
    expect(planSaveStatus(3)).toBe("saved");
  });

  it("a later edit after a failure saves the newest state, not the failed one", async () => {
    const calls = deferredCalls();
    enqueuePlanSave(5, plan(["old"]));
    await Promise.resolve();
    calls[0].reject(new Error("boom"));
    await flushPlanSave(5);

    const next = deferredCalls();
    enqueuePlanSave(5, plan(["new"]));
    await Promise.resolve();
    next[0].resolve();
    await flushPlanSave(5);

    expect(savePlan).toHaveBeenCalledTimes(2);
    expect(savePlan).toHaveBeenLastCalledWith(5, plan(["new"]));
    expect(planSaveStatus(5)).toBe("saved");
  });

  it("keeps jobs isolated from each other", async () => {
    const calls = deferredCalls();
    enqueuePlanSave(1, plan(["job1"]));
    enqueuePlanSave(2, plan(["job2"]));
    await Promise.resolve(); // both writers register their saves

    calls[0].resolve();
    calls[1].resolve();
    await flushPlanSave(1);
    await flushPlanSave(2);

    const jobIds = savePlan.mock.calls.map(([id]) => id);
    expect(jobIds).toContain(1);
    expect(jobIds).toContain(2);
    expect(planSaveStatus(1)).toBe("saved");
    expect(planSaveStatus(2)).toBe("saved");
  });

  it("starts idle and reports idle for unknown jobs", () => {
    expect(planSaveStatus(42)).toBe("idle");
    expect(planSaveStatus(null)).toBe("idle");
  });

  it("flush resolves ok with the persisted revision for an unknown job", async () => {
    await expect(flushPlanSave(42)).resolves.toEqual({ ok: true, revision: null });
  });

  it("flush actively saves a queued snapshot and reports ok", async () => {
    savePlan.mockResolvedValue({ ok: true, revision: 7 });
    enqueuePlanSave(9, plan(["queued"]));
    const result = await flushPlanSave(9);
    expect(result).toEqual({ ok: true, revision: 7 });
    expect(planSaveStatus(9)).toBe("saved");
  });

  it("flush refuses to hand out a revision after a failed save", async () => {
    const calls = deferredCalls();
    enqueuePlanSave(4, plan(["doomed"]));
    await Promise.resolve();
    calls[0].reject(new Error("disk full"));
    const result = await flushPlanSave(4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("could not be saved");
      expect(result.revision).toBeNull();
    }
    expect(planSaveStatus(4)).toBe("error");
    // The failed snapshot is still queued for a real retry — flush itself
    // must not spin on it.
    expect(savePlan).toHaveBeenCalledTimes(1);
  });

  it("flush waits out an in-flight save, including its scheduled follow-up", async () => {
    const calls = deferredCalls();
    enqueuePlanSave(6, plan(["v1"]));
    await Promise.resolve();
    enqueuePlanSave(6, plan(["v2"]));
    savePlan.mockResolvedValue({ ok: true, revision: 3 });

    const flushed = flushPlanSave(6);
    calls[0].resolve(); // save #1 lands; the follow-up save for v2 pumps
    const result = await flushed;

    expect(result).toEqual({ ok: true, revision: 3 });
    expect(savePlan).toHaveBeenLastCalledWith(6, plan(["v2"]));
  });
});
