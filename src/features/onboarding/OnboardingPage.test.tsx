import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingPage from "./OnboardingPage";
import { ipc } from "../../lib/ipc";
import { useJobsStore } from "../../stores/jobsStore";
import { useVaultStore } from "../../stores/vaultStore";
import type { ResumeImport } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  ipc: {
    parseResumeText: vi.fn(),
    parseJd: vi.fn(),
    runJobMatch: vi.fn(),
    runComposer: vi.fn(),
    getMatch: vi.fn(),
    markVerified: vi.fn(),
    unmarkVerified: vi.fn(),
    getOnboardingStatus: vi.fn(),
    estimatePlanLines: vi.fn(),
    savePlan: vi.fn(),
  },
}));

const parseResumeText = vi.mocked(ipc.parseResumeText);
const markVerified = vi.mocked(ipc.markVerified);

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
    markVerified.mockResolvedValue(undefined);
    useJobsStore.setState({
      createWorkspace: vi.fn(async (job) => ({ job, requirements: [] })),
    });
    useVaultStore.setState({
      skills: [],
      profile: null,
      saveProfile: vi.fn(async () => undefined),
      saveRecord: vi.fn(async (_key, data) => ({ ...data, id: 42 })) as never,
    });
  });

  afterEach(cleanup);

  it("walks welcome → import → review and saves records with honest provenance", async () => {
    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
    );

    // Welcome: primary action is bringing a resume, secondary is manual.
    expect(screen.getByText("Turn your existing resume into your first application")).toBeTruthy();
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

    await waitFor(() => expect(useJobsStore.getState).toBeTruthy());
    const saveRecord = useVaultStore.getState().saveRecord as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(saveRecord).toHaveBeenCalled());

    const experienceCall = saveRecord.mock.calls.find(([key]) => key === "experiences");
    expect(experienceCall).toBeTruthy();
    expect(experienceCall?.[1]).toMatchObject({
      organization: "Acme Robotics",
      origin: "imported",
      editedAt: expect.any(String),
    });
    const projectCall = saveRecord.mock.calls.find(([key]) => key === "projects");
    expect(projectCall?.[1]).toMatchObject({ origin: "imported", editedAt: null });

    // The verified group's records were explicitly verified.
    await waitFor(() => expect(markVerified).toHaveBeenCalled());
    expect(markVerified.mock.calls.every(([kind]) => kind === "experience")).toBe(true);
  });

  it("offers Start manually as the secondary path", () => {
    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
    );
    const manual = screen.getByRole("button", { name: /start manually instead/i });
    expect(manual).toBeTruthy();
    fireEvent.click(manual);
    expect(screen.getByText("Add a role")).toBeTruthy();
  });
});
