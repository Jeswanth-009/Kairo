import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingPage from "../features/onboarding/OnboardingPage";
import { NewJobDialog } from "../features/jobs/NewJobDialog";
import ResumeStudioPage from "../features/resume-studio/ResumeStudioPage";
import { resetPlanSaves } from "../lib/planAutosave";
import { useJobsStore } from "../stores/jobsStore";
import { useVaultStore } from "../stores/vaultStore";
import type { JobExtraction, PdfArtifact, ResumePlan } from "../lib/types";

/**
 * Phase-3 clickable designs, as executable journeys. These four tests define
 * the target UX for the overhaul's four key tasks and are written before the
 * screens they exercise; the screens are rebuilt until these pass.
 */

vi.mock("../lib/ipc", () => ({
  ipc: new Proxy(
    { __mocked: true },
    {
      get(_t, prop: string) {
        const store = (globalThis as Record<string, unknown>).__ipcMocks as
          | Record<string, ReturnType<typeof vi.fn>>
          | undefined;
        return store?.[prop] ?? vi.fn().mockRejectedValue(new Error(`unexpected ipc.${prop}`));
      },
    },
  ),
}));

const mocks: Record<string, ReturnType<typeof vi.fn>> = {};
beforeEach(() => {
  (globalThis as Record<string, unknown>).__ipcMocks = mocks;
  for (const key of Object.keys(mocks)) delete mocks[key];
  resetPlanSaves();
  useJobsStore.setState({
    createWorkspace: vi.fn(async (job) => ({ job, requirements: [] })),
  });
  useVaultStore.setState({
    skills: [],
    profile: null,
    saveProfile: vi.fn(async () => undefined),
    saveRecord: vi.fn(async (_k, d) => ({ ...d, id: 7 })) as never,
  });
});
afterEach(cleanup);

const renderAt = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

// ---------------------------------------------------------------------------
// Task 1 — importing a resume
// ---------------------------------------------------------------------------

describe("journey · importing a resume", () => {
  it("welcome → import → review → save, with honest provenance and no Settings visit", async () => {
    mocks.parseResumeText = vi.fn().mockResolvedValue({
      profile: { fullName: "Ada Lovelace", headline: "", email: "a@x.io", phone: "", github: "", website: "", linkedin: "", summary: "" },
      experiences: [],
      projects: [],
      education: [],
      achievements: [],
      skills: [{ name: "Rust", category: "language" }],
    });
    mocks.markVerified = vi.fn().mockResolvedValue(undefined);

    renderAt(<OnboardingPage />);

    // The journey never requires Settings.
    expect(screen.queryByRole("button", { name: /configure ai provider/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /bring an existing resume/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste the full text/i), {
      target: { value: "Ada Lovelace — resume text …" },
    });
    fireEvent.click(screen.getByRole("button", { name: /extract my facts/i }));

    expect(await screen.findByText("Review the facts")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /save \d+ records/i }));

    const saveRecord = useVaultStore.getState().saveRecord as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(saveRecord).toHaveBeenCalled());
    const skillCall = saveRecord.mock.calls.find(([key]) => key === "skills");
    expect(skillCall?.[1]).toMatchObject({ canonicalName: "Rust" });
  });
});

// ---------------------------------------------------------------------------
// Task 2 — creating a job
// ---------------------------------------------------------------------------

describe("journey · creating a job", () => {
  it("paste JD → confirm the important requirements → workspace created", async () => {
    const extraction: JobExtraction = {
      company: "Acme",
      role: "Backend Engineer",
      url: "",
      seniority: "Mid-level",
      domain: "Backend",
      requirements: [
        { kind: "required_skill", rawText: "Rust", importance: 0.9 },
        { kind: "required_skill", rawText: "SQL", importance: 0.8 },
        { kind: "preferred_skill", rawText: "K8s", importance: 0.4 },
      ],
    } as unknown as JobExtraction;
    mocks.parseJd = vi.fn().mockResolvedValue(extraction);

    const onClosed = vi.fn();
    renderAt(<NewJobDialog open onClose={onClosed} />);

    fireEvent.change(screen.getByPlaceholderText(/paste the exact job description/i), {
      target: { value: "Acme is hiring a Backend Engineer. Requirements: Rust, SQL. Nice: K8s." },
    });
    fireEvent.click(screen.getByRole("button", { name: /analyze description/i }));

    // Confirm step: requirements arrive as editable rows — remove the
    // preferred one, keep only what matters.
    await screen.findByDisplayValue("K8s");
    expect(screen.getByDisplayValue("Rust")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /remove requirement: k8s/i }));
    expect(screen.queryByDisplayValue("K8s")).toBeNull();
    void 0;

    fireEvent.click(screen.getByRole("button", { name: /save workspace/i }));

    const createWorkspace = useJobsStore.getState().createWorkspace as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(createWorkspace).toHaveBeenCalled());
    const [, requirements] = createWorkspace.mock.calls[0];
    expect(requirements).toHaveLength(2);
    expect(requirements.map((r: { rawText: string }) => r.rawText).sort()).toEqual(["Rust", "SQL"]);
  });
});

// ---------------------------------------------------------------------------
// Fixtures for Studio journeys
// ---------------------------------------------------------------------------

const JOB = { id: 11, company: "Acme", roleTitle: "Backend Engineer", url: "", rawJd: "jd", seniority: "", domain: "", requirementCount: 2 };

const PLAN: ResumePlan = {
  composerVersion: 1,
  config: { targetPages: 1, maxProjects: 4, maxExperienceItems: 4, maxBulletsPerItem: 4, minFontSizePt: 9, templateId: "jake", paper: "letter" },
  header: { fullName: "Ada Lovelace", headline: "", email: "a@x.io", phone: "", location: "", website: "", github: "", linkedin: "" },
  education: [],
  experience: [
    {
      entityType: "experience",
      id: 3,
      title: "Acme — Intern",
      subtitle: "",
      startDate: "2025-06",
      endDate: "2025-09",
      isCurrent: false,
      description: "",
      bullets: [{ id: 31, text: "Shipped internal tooling", supports: [], excluded: false }],
      skills: ["Rust"],
      relevance: 0.8,
      evidenceCount: 2,
      origin: "imported",
      excluded: false,
    },
  ],
  projects: [],
  achievements: [],
  skills: ["Rust"],
  skillsGrouped: [],
  excludedSkills: [],
  estimatedLines: 10,
  fitsOnePage: true,
  warnings: [],
};

const ARTIFACT: PdfArtifact = {
  jobId: 11,
  texPath: "resume.tex",
  pdfPath: "resume.pdf",
  pageCount: 1,
  compiledAt: "2026-10-01 10:00:00",
  templateId: "jake",
  paper: "letter",
  fingerprint: "fp",
  pdfHash: "hash",
};

function studioMocks(artifact: PdfArtifact | null) {
  mocks.listJobs = vi.fn().mockResolvedValue([JOB]);
  mocks.getPlan = vi.fn().mockResolvedValue({ config: PLAN.config, plan: PLAN });
  mocks.tailorList = vi.fn().mockResolvedValue([]);
  mocks.getPdfArtifact = vi.fn().mockResolvedValue(artifact);
  mocks.listResumeVersions = vi.fn().mockResolvedValue([]);
  mocks.getProfile = vi.fn().mockResolvedValue(null);
  mocks.listSkills = vi.fn().mockResolvedValue([]);
  mocks.estimatePlanLines = vi.fn().mockResolvedValue(10);
  mocks.savePlan = vi.fn().mockResolvedValue(undefined);
  mocks.getOnboardingStatus = vi.fn().mockResolvedValue({
    hasProfile: true, projectCount: 1, experienceCount: 1, educationCount: 1, skillCount: 1, jobCount: 1, hasAnyContent: true,
  });
}

async function renderStudio() {
  renderAt(<ResumeStudioPage />);
  // The status bar is the journey's stable landmark (the page title is
  // split across header elements, so don't match on it).
  await waitFor(() => expect(screen.getByTestId("studio-status")).toBeTruthy(), {
    timeout: 4000,
  });
}

// ---------------------------------------------------------------------------
// Task 3 — editing a bullet
// ---------------------------------------------------------------------------

describe("journey · editing a bullet", () => {
  it("exclude → undo restores, and every change persists through the autosave queue", async () => {
    studioMocks(ARTIFACT);
    mocks.exportPdf = vi.fn();
    await renderStudio();

    // The bullet reveals its source and evidence honestly.
    const source = screen.getByText(/from/i, { selector: "[data-testid='bullet-source']" });
    expect(source).toBeTruthy();

    // Exclude the bullet, then undo — both states persist.
    fireEvent.click(screen.getByRole("button", { name: /^exclude$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^include$/i })).toBeTruthy(),
    );
    const saveAfterExclude = (mocks.savePlan as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(saveAfterExclude).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("studio-undo"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^exclude$/i })).toBeTruthy());
    expect((mocks.savePlan as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(saveAfterExclude);
  });

  it("editing content after an export flips the status to PDF needs update", async () => {
    studioMocks(ARTIFACT);
    await renderStudio();
    expect(screen.getByTestId("studio-status").textContent).toMatch(/current pdf/i);

    fireEvent.click(screen.getByRole("button", { name: /^exclude$/i }));
    await waitFor(() =>
      expect(screen.getByTestId("studio-status").textContent).toMatch(/pdf needs update/i),
    );
  });
});

// ---------------------------------------------------------------------------
// Task 4 — exporting a PDF
// ---------------------------------------------------------------------------

describe("journey · exporting a PDF", () => {
  it("Draft → Current PDF with a real page count, and the final review gates version 1", async () => {
    studioMocks(null);
    mocks.exportPdf = vi.fn().mockResolvedValue({ artifact: { ...ARTIFACT, compiledAt: "2026-10-02 09:00:00" }, logTail: "ok" });
    await renderStudio();

    // No artifact yet: the status is Draft and export is the next action.
    expect(screen.getByTestId("studio-status").textContent).toMatch(/draft/i);

    fireEvent.click(screen.getAllByRole("button", { name: /export pdf/i })[0]);
    await waitFor(() =>
      expect(screen.getByTestId("studio-status").textContent).toMatch(/current pdf/i),
    );
    expect(screen.getAllByText(/1 page/i).length).toBeGreaterThan(0);

    // Version 1 is locked behind the final review.
    const saveVersion = screen.getByRole("button", { name: /save version/i }) as HTMLButtonElement;
    expect(saveVersion.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/i've read the actual pdf/i));
    expect((screen.getByRole("button", { name: /save version/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a failed export keeps the previous PDF and says so", async () => {
    studioMocks(ARTIFACT);
    mocks.exportPdf = vi.fn().mockRejectedValue(new Error("tectonic failed"));
    await renderStudio();
    expect(screen.getByTestId("studio-status").textContent).toMatch(/current pdf/i);

    fireEvent.click(screen.getAllByRole("button", { name: /export pdf/i })[0]);
    await waitFor(() =>
      expect(screen.getByTestId("studio-status").textContent).toMatch(/export failed/i),
    );
    // The previous good PDF is still shown.
    expect(screen.getByTestId("studio-status").textContent).toMatch(/previous/i);
  });
});

