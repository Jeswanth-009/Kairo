import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingPage from "./OnboardingPage";
import { ipc } from "../../lib/ipc";
import { useJobsStore } from "../../stores/jobsStore";
import { useVaultStore } from "../../stores/vaultStore";
import type { ImportBatch, ImportBatchResult, ResumeImport } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  ipc: {
    parseResumeText: vi.fn(),
    parseJd: vi.fn(),
    runJobMatch: vi.fn(),
    runComposer: vi.fn(),
    getMatch: vi.fn(),
    importResumeBatch: vi.fn(),
    markVerified: vi.fn(),
    unmarkVerified: vi.fn(),
    getOnboardingStatus: vi.fn(),
    getOnboardingState: vi.fn().mockResolvedValue(null),
    setOnboardingState: vi.fn().mockResolvedValue(undefined),
    clearOnboardingState: vi.fn().mockResolvedValue(undefined),
    saveJobPdfToDownloads: vi.fn(),
    getPdfArtifact: vi.fn(),
    getPdfStatus: vi.fn(),
    exportPdf: vi.fn(),
    listResumeVersions: vi.fn().mockResolvedValue([]),
    estimatePlanLines: vi.fn(),
    savePlan: vi.fn(),
  },
}));

const parseResumeText = vi.mocked(ipc.parseResumeText);
const importResumeBatch = vi.mocked(ipc.importResumeBatch);
const markVerified = vi.mocked(ipc.markVerified);

const BATCH_RESULT: ImportBatchResult = {
  profileSaved: true,
  projectIds: [11],
  experienceIds: [21],
  educationIds: [31],
  achievementIds: [],
  skillIds: [41],
};

const FIXTURE: ResumeImport = {
  profile: {
    fullName: "Ada Lovelace",
    headline: "Backend developer",
    email: "ada@example.com",
    phone: "",
    github: "",
    website: "",
    linkedin: "",
    summary: "",
  },
  experiences: [
    {
      organization: "Acme",
      role: "Intern",
      description: "Built internal tooling",
      startDate: "2025-06",
      endDate: "2025-09",
      isCurrent: false,
      location: "",
    },
  ],
  projects: [
    {
      title: "PyKV",
      description: "In-memory key-value store",
      skills: ["Python"],
      sourceSnippet: "PyKV — in-memory key-value store",
    },
  ],
  education: [
    {
      institution: "IIT",
      degree: "B.Tech",
      fieldOfStudy: "CSE",
      startDate: "2022-08",
      endDate: "2026-05",
      isCurrent: false,
    },
  ],
  achievements: [],
  skills: [{ name: "Python", category: "language" }],
} as unknown as ResumeImport;

describe("OnboardingPage — guided first run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseResumeText.mockResolvedValue(FIXTURE);
    importResumeBatch.mockResolvedValue(BATCH_RESULT);
    markVerified.mockResolvedValue(undefined);
    useJobsStore.setState({
      createWorkspace: vi.fn(async (job) => ({ job, requirements: [] })),
    });
    useVaultStore.setState({
      skills: [],
      profile: null,
      load: vi.fn(async () => undefined) as never,
    });
  });

  afterEach(cleanup);

  it("walks welcome → import → review and saves everything in one transactional batch", async () => {
    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
    );

    // The journey state restores before anything renders.
    await waitFor(() =>
      expect(
        screen.getByText("Turn your existing resume into your first application"),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /bring an existing resume/i }));

    // Import: paste text and extract.
    fireEvent.change(screen.getByPlaceholderText(/paste the full text/i), {
      target: { value: "Ada Lovelace — backend developer. Experience: Acme…" },
    });
    fireEvent.click(screen.getByRole("button", { name: /extract my facts/i }));

    // Review: grouped candidates appear with their honest badge.
    await waitFor(() => expect(screen.getByText("Review the facts")).toBeTruthy());
    expect(await screen.findByDisplayValue("Ada Lovelace")).toBeTruthy();
    expect(screen.getAllByText("Imported from resume").length).toBeGreaterThan(0);

    // Editing a field flips that record to "Edited by you" on save.
    const org = screen.getByDisplayValue("Acme");
    fireEvent.change(org, { target: { value: "Acme Robotics" } });
    expect(screen.getAllByText("Edited by you").length).toBeGreaterThan(0);

    // Tick the work group's verify checkbox (scoped to its card), then save.
    const workCard = org.closest("div.rounded-xl") ?? org.closest("[class*=card]");
    fireEvent.click(within(workCard as HTMLElement).getByLabelText(/verified by you/i));
    fireEvent.click(screen.getByRole("button", { name: /save \d+ records to my vault/i }));

    // One transactional batch carries every accepted record — no save loop.
    await waitFor(() => expect(importResumeBatch).toHaveBeenCalledTimes(1));
    const batch = importResumeBatch.mock.calls[0][0] as ImportBatch;
    expect(batch.profile).toMatchObject({ fullName: "Ada Lovelace" });
    expect(batch.experiences).toHaveLength(1);
    expect(batch.experiences[0]).toMatchObject({
      organization: "Acme Robotics",
      startDate: "2025-06",
    });
    expect(batch.projects).toHaveLength(1);
    expect(batch.projects[0]).toMatchObject({
      title: "PyKV",
      skills: ["Python"],
      url: "",
      repoUrl: "",
    });
    // The skill referenced by the project stays in the batch even though the
    // top-level list is what was reviewed.
    expect(batch.skills).toEqual([{ name: "Python", category: "language" }]);

    // The verified group's records were verified by their real ids.
    await waitFor(() => expect(markVerified).toHaveBeenCalled());
    expect(markVerified.mock.calls).toEqual([["experience", 21]]);
  });

  it("offers Start manually as the secondary path", async () => {
    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
    );
    const manual = await screen.findByRole("button", { name: /start manually instead/i });
    expect(manual).toBeTruthy();
    fireEvent.click(manual);
    expect(screen.getByText("Add a role")).toBeTruthy();
  });
});
