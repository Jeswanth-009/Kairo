import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, afterEach, expect, it, vi, beforeEach } from "vitest";
import { TailorTab } from "./TailorTab";
import { ipc } from "../../lib/ipc";
import type { PlanItem, ResumePlan } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  ipc: {
    aiGetConfig: vi.fn(),
    tailorList: vi.fn(),
    getPlan: vi.fn(),
    tailorSuggest: vi.fn(),
    tailorPlanBatch: vi.fn(),
    tailorSetStatus: vi.fn(),
    tailorDelete: vi.fn(),
    tailorCancel: vi.fn(),
  },
}));

vi.mock("../../stores/toastStore", () => ({
  toast: { ok: vi.fn(), error: vi.fn() },
}));

const BULLET_PLAN: ResumePlan = {
  composerVersion: 1,
  estimatedLines: 12,
  fitsOnePage: true,
  warnings: [],
  config: {
    targetPages: 1,
    maxProjects: 4,
    maxExperienceItems: 4,
    maxBulletsPerItem: 4,
    minFontSizePt: 9,
    templateId: "jake",
    paper: "letter",
  },
  header: {
    fullName: "Test",
    headline: "",
    email: "",
    phone: "",
    location: "",
    website: "",
    github: "",
    linkedin: "",
  },
  skills: [],
  experience: [],
  projects: [
    {
      entityType: "project",
      id: 1,
      title: "Payments API",
      subtitle: "",
      description: "Ledger",
      startDate: null,
      endDate: null,
      isCurrent: false,
      skills: [],
      evidenceCount: 0,
      relevance: 0,
      bullets: [
        {
          id: 11,
          text: "Built ledger",
          supports: [],
        },
      ],
    },
  ] satisfies PlanItem[],
  education: [],
  achievements: [],
};

describe("TailorTab AI onboarding", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(ipc.tailorList).mockResolvedValue([]);
    vi.mocked(ipc.getPlan).mockResolvedValue({
    config: BULLET_PLAN.config,
    plan: BULLET_PLAN,
  });
  });

  it("shows the setup card instead of raw errors when AI is unconfigured", async () => {
    vi.mocked(ipc.aiGetConfig).mockResolvedValue({
      baseUrl: "",
      model: "",
      hasApiKey: false,
    });
    render(
      <MemoryRouter>
        <TailorTab jobId={1} onComposePlan={() => {}} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Set up AI to unlock tailoring")).toBeTruthy();
    expect(screen.getByText("Configure AI provider")).toBeTruthy();
  });

  it("does not show the setup card when a provider is configured", async () => {
    vi.mocked(ipc.aiGetConfig).mockResolvedValue({
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.1:8b",
      hasApiKey: true,
    });
    render(
      <MemoryRouter>
        <TailorTab jobId={1} onComposePlan={() => {}} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByText("Set up AI to unlock tailoring")).toBeNull());
    expect(screen.getByText("Payments API")).toBeTruthy();
  });
});
