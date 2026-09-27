import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrashDialog } from "./TrashDialog";
import { ipc } from "../../lib/ipc";
import type { TrashItem } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  ipc: {
    trashList: vi.fn(),
    trashRestore: vi.fn(),
    trashPurge: vi.fn(),
  },
}));

vi.mock("../../stores/toastStore", () => ({
  toast: { ok: vi.fn(), error: vi.fn() },
}));

const ITEMS: TrashItem[] = [
  {
    entityType: "project",
    entityId: 3,
    label: "Payments API",
    deletedAt: "2026-09-20 10:00:00",
  },
  {
    entityType: "job",
    entityId: 9,
    label: "Senior Backend — Acme",
    deletedAt: "2026-09-25 09:00:00",
  },
];

describe("TrashDialog", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(ipc.trashList).mockResolvedValue(ITEMS);
    vi.mocked(ipc.trashRestore).mockResolvedValue({ ok: true });
    vi.mocked(ipc.trashPurge).mockResolvedValue({ ok: true });
  });

  it("lists trashed records with their type labels", async () => {
    render(<TrashDialog open onClose={() => {}} />);
    expect(await screen.findByText("Payments API")).toBeTruthy();
    expect(screen.getByText("Job workspace")).toBeTruthy();
    expect(screen.getByText("Senior Backend — Acme")).toBeTruthy();
  });

  it("restores a record and drops it from the list", async () => {
    render(<TrashDialog open onClose={() => {}} />);
    const row = await screen.findByText("Payments API");
    fireEvent.click(row.closest("li")!.querySelector("button")!);
    await waitFor(() => expect(ipc.trashRestore).toHaveBeenCalledWith("project", 3));
    await waitFor(() => expect(screen.queryByText("Payments API")).toBeNull());
  });

  it("purges only after the delete-forever confirmation", async () => {
    render(<TrashDialog open onClose={() => {}} />);
    const row = await screen.findByText("Payments API");
    fireEvent.click(row.closest("li")!.querySelector("button:last-child")!);
    const confirm = screen.getByRole("button", { name: "Delete forever" });
    expect(ipc.trashPurge).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(ipc.trashPurge).toHaveBeenCalledWith("project", 3));
  });

  it("shows the empty state when nothing is trashed", async () => {
    vi.mocked(ipc.trashList).mockResolvedValue([]);
    render(<TrashDialog open onClose={() => {}} />);
    expect(await screen.findByText(/Nothing here/)).toBeTruthy();
  });
});
