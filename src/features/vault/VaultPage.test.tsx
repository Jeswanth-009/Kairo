// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VaultPage from "./VaultPage";
import { useVaultStore } from "../../stores/vaultStore";
import type { Project } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  ipc: {
    vaultDeleteBatch: vi.fn(),
    deleteProject: vi.fn(),
    listProjects: vi.fn().mockResolvedValue([]),
    listExperiences: vi.fn().mockResolvedValue([]),
    listEducation: vi.fn().mockResolvedValue([]),
    listCertifications: vi.fn().mockResolvedValue([]),
    listAchievements: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getProfile: vi.fn().mockResolvedValue(null),
  },
}));

import { ipc } from "../../lib/ipc";

const project = (id: number, title: string): Project =>
  ({
    id,
    title,
    description: "",
    startDate: null,
    endDate: null,
    isCurrent: false,
    url: "",
    repoUrl: "",
    origin: "manual",
    editedAt: null,
    verifiedAt: null,
    skills: [],
    evidenceCount: 0,
  }) as unknown as Project;

beforeEach(() => {
  useVaultStore.setState({
    loaded: true,
    loading: false,
    error: null,
    projects: [project(1, "PyKV"), project(2, "Ledger"), project(3, "Muse")],
    experiences: [],
    education: [],
    certifications: [],
    achievements: [],
    skills: [],
    profile: null,
    // The page reloads from IPC on mount; the journey under test is the
    // delete itself, so keep the seeded rows instead.
    load: vi.fn(async () => undefined) as never,
  });
  vi.mocked(ipc.vaultDeleteBatch).mockReset();
});

afterEach(cleanup);

function selectAll() {
  fireEvent.click(screen.getByLabelText(/select all/i));
}

describe("VaultPage — batch delete (issue #12)", () => {
  it("deletes the whole selection with one IPC call, in one transaction", async () => {
    vi.mocked(ipc.vaultDeleteBatch).mockResolvedValue({ deleted: 3 });
    render(
      <MemoryRouter>
        <VaultPage />
      </MemoryRouter>,
    );
    selectAll();
    fireEvent.click(screen.getByRole("button", { name: /delete 3 selected/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(ipc.vaultDeleteBatch).toHaveBeenCalledTimes(1));
    expect(ipc.vaultDeleteBatch).toHaveBeenCalledWith("project", [1, 2, 3]);
    // The selection is gone from the store — no stale rows.
    await waitFor(() => expect(useVaultStore.getState().projects).toHaveLength(0));
  });

  it("keeps every record when the transaction fails", async () => {
    vi.mocked(ipc.vaultDeleteBatch).mockRejectedValue(new Error("database is locked"));
    render(
      <MemoryRouter>
        <VaultPage />
      </MemoryRouter>,
    );
    selectAll();
    fireEvent.click(screen.getByRole("button", { name: /delete 3 selected/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(ipc.vaultDeleteBatch).toHaveBeenCalled());
    expect(useVaultStore.getState().projects).toHaveLength(3);
  });
});
