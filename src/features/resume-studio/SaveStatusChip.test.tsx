import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveStatusChip } from "./SaveStatusChip";
import { ipc } from "../../lib/ipc";
import { enqueuePlanSave, resetPlanSaves } from "../../lib/planAutosave";
import type { ResumePlan } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({ ipc: { savePlan: vi.fn() } }));

const savePlan = vi.mocked(ipc.savePlan);
const anyPlan = { skills: [] } as unknown as ResumePlan;

describe("SaveStatusChip", () => {
  beforeEach(() => {
    resetPlanSaves();
    savePlan.mockReset();
    savePlan.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("renders nothing while idle", () => {
    const { container } = render(<SaveStatusChip jobId={1} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows Saving… then Saved after a save completes", async () => {
    let resolveSave!: () => void;
    savePlan.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveSave = res;
        }),
    );
    render(<SaveStatusChip jobId={2} />);

    await act(async () => {
      enqueuePlanSave(2, anyPlan);
    });
    expect(screen.getByTestId("save-status").textContent).toBe("Saving…");

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });
    expect(screen.getByTestId("save-status").textContent).toBe("Saved");
  });

  it("shows Couldn't save — Retry and re-persists on click", async () => {
    let rejectSave!: (e: unknown) => void;
    savePlan
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectSave = reject;
          }),
      )
      .mockResolvedValueOnce(undefined);
    render(<SaveStatusChip jobId={3} />);

    await act(async () => {
      enqueuePlanSave(3, anyPlan);
    });
    await act(async () => {
      rejectSave(new Error("disk full"));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /couldn't save/i })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /couldn't save/i }));
    });
    expect(savePlan).toHaveBeenCalledTimes(2);
  });

  it("does not render for a null job", () => {
    const { container } = render(<SaveStatusChip jobId={null} />);
    expect(container.firstChild).toBeNull();
  });
});
