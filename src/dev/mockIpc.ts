/**
 * Dev-only Tauri IPC mock. Installs `window.__TAURI_INTERNALS__` so the real
 * app runs in a plain browser against fixtures. Enabled via the `?mock` dev
 * entry (mock.html) — never bundled into the production app.
 */
import { mockApplications, mockDashboard, mockDiagnostics, mockJobs, mockPlan, mockProfile, mockSkills, mockSuggestions, mockVersions } from "./fixtures";
import { parseCertificate, parseGithubRepo, parseResume } from "./mockParsers";

type Handler = (args: Record<string, unknown>) => unknown;

const jobs = structuredClone(mockJobs);
const applications = structuredClone(mockApplications);
const skills = structuredClone(mockSkills);
const profile = structuredClone(mockProfile);
const plan = structuredClone(mockPlan);
const suggestions = structuredClone(mockSuggestions);
const versions = structuredClone(mockVersions);

const wrappedLines = (text: string) =>
  text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 95));

function estimateLines(p: typeof mockPlan): number {
  let lines = 4 + p.education.length * 2;
  for (const item of [...p.experience, ...p.projects]) {
    if (item.excluded) continue;
    lines += 2;
    const bullets =
      item.bullets.filter((b) => !b.excluded).map((b) => b.text) ||
      [];
    if (bullets.length > 0) {
      for (const b of bullets) lines += wrappedLines(b);
    } else {
      for (const l of item.description.split("\n")) {
        if (l.trim().length > 5) lines += wrappedLines(l);
      }
    }
  }
  return lines;
}

const handlers: Record<string, Handler> = {
  // foundation
  get_diagnostics: () => mockDiagnostics,
  db_smoke_test: () => ({ ok: true, tokenWritten: "mock-token" }),

  // jobs
  list_jobs: () => jobs,
  get_job: (a) => {
    const job = jobs.find((j) => j.id === a.id) ?? jobs[0];
    return { ...job, requirementCount: 12 };
  },
  create_job_with_requirements: (a) => {
    const job = a.job as (typeof jobs)[number] & { id?: number };
    const next = {
      ...job,
      id: Math.max(...jobs.map((j) => j.id), 0) + 1,
      requirementCount: (a.requirements as unknown[])?.length ?? 0,
    };
    jobs.push(next);
    return { job: next, requirements: a.requirements };
  },
  update_job: (a) => {
    const job = a.job as (typeof jobs)[number];
    const idx = jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) jobs[idx] = job;
    return job;
  },
  delete_job: () => ({ ok: true }),
  list_requirements: () => [],
  parse_jd: () => ({
    role: "Software Engineering Intern",
    company: "",
    url: "",
    seniority: "Internship",
    domain: "Software",
    requirements: [],
  }),

  // composer / plan
  run_composer: () => plan,
  get_plan: () => ({ config: plan.config, plan }),
  save_plan: (a) => {
    Object.assign(plan, a.plan);
    return { ok: true };
  },
  estimate_plan_lines: (a) => estimateLines(a.plan as typeof mockPlan),

  // matching
  run_job_match: () => ({
    matchingVersion: 1,
    weights: { requiredSkills: 0.4, preferredSkills: 0.15, responsibilities: 0.2, domain: 0.1, recency: 0.05, evidenceStrength: 0.1 },
    overallScore: 0.72,
    components: { requiredSkills: 0.8, preferredSkills: 0.5, responsibilities: 0.7, domain: 0.6, recency: 0.9, evidenceStrength: 0.66 },
    results: [],
    entityRanking: [],
  }),
  get_match: () => null,

  // tailoring
  tailor_list: () => suggestions,
  tailor_suggest: (a) => {
    const existing = suggestions.find((x) => x.bulletId === a.bulletId);
    if (existing) return existing;
    const created = {
      id: suggestions.length + 1,
      jobId: 3,
      bulletId: Number(a.bulletId),
      originalText: "Original bullet text",
      suggestedText: "Tailored bullet text (mock)",
      status: "pending" as const,
      validation: { ok: true, violations: [] },
      model: "mock",
    };
    suggestions.unshift(created);
    return created;
  },
  tailor_delete: (a) => {
    const idx = suggestions.findIndex((x) => x.id === a.id);
    if (idx >= 0) suggestions.splice(idx, 1);
    return { ok: true };
  },
  tailor_plan_batch: () => ({
    suggestions,
    model: "mock",
    batchUsed: true,
    cancelled: false,
    durationMs: 1400,
    promptTokens: 950,
    completionTokens: 320,
  }),
  tailor_cancel: () => ({ ok: true }),
  claim_changes: () => ({ ok: true, violations: [] }),
  tailor_save_manual_edit: () => ({ ok: true, violations: [] }),
  tailor_set_status: (a) => {
    const s = suggestions.find((x) => x.id === a.id);
    if (s && typeof a.text === "string") s.suggestedText = a.text;
    return s;
  },

  // PDF
  export_pdf: () => ({
    artifact: {
      jobId: 3,
      texPath: "mock://resume.tex",
      pdfPath: "sample-resume.pdf",
      pageCount: 1,
      compiledAt: new Date().toISOString(),
    },
    logTail: "mock compile ok",
  }),
  get_pdf_artifact: () => ({
    jobId: 3,
    texPath: "mock://resume.tex",
    pdfPath: "sample-resume.pdf",
    pageCount: 1,
    compiledAt: "2026-09-17T20:12:00",
  }),
  read_pdf_bytes: async (a) => {
    const res = await fetch(String(a.path));
    const buf = await res.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  },
  open_file: () => undefined,
  reveal_file: () => undefined,
  save_pdf_to_downloads: (a) => String(a.customName ?? "resume.pdf"),

  // versions
  save_resume_version: () => {
    const v = {
      id: versions.length + 1,
      jobId: 3,
      versionNumber: versions.length + 1,
      createdAt: new Date().toISOString(),
      pdfPath: "sample-resume.pdf",
      snapshot: {
        versionNumber: versions.length + 1,
        job: mockJobs[0],
        requirements: [],
        plan,
        acceptedTailorings: [],
        matchingVersion: 1,
        composerVersion: 1,
        templateVersion: 1,
        pdfPath: "sample-resume.pdf",
      },
    };
    versions.unshift(v);
    return v;
  },
  list_resume_versions: () => versions,

  // vault (read-only in mock; create/update echo back)
  list_projects: () => [],
  list_experiences: () => [],
  list_education: () => [
    {
      id: 1,
      institution: "Riverside Institute of Technology, Chennai",
      degree: "Bachelor of Technology",
      fieldOfStudy: "Computer Science & Systems Engineering",
      description: "",
      startDate: "2023-09",
      endDate: "2027-05",
      isCurrent: false,
    },
  ],
  list_certifications: () => [],
  list_achievements: () => [],
  list_skills: () => skills,
  get_profile: () => profile,
  upsert_profile: (a) => Object.assign(profile, a.profile),
  create_project: (a) => a.project,
  create_experience: (a) => a.experience,
  create_education: (a) => a.education,
  create_certification: (a) => a.certification,
  create_achievement: (a) => a.achievement,
  create_skill: (a) => a.skill,
  update_project: (a) => a.project,
  update_experience: (a) => a.experience,
  update_education: (a) => a.education,
  update_certification: (a) => a.certification,
  update_achievement: (a) => a.achievement,
  update_skill: (a) => a.skill,
  delete_project: () => ({ ok: true }),
  delete_experience: () => ({ ok: true }),
  delete_education: () => ({ ok: true }),
  delete_certification: () => ({ ok: true }),
  delete_achievement: () => ({ ok: true }),
  delete_skill: () => ({ ok: true }),
  list_evidence: () => [],
  list_bullets: () => [],
  list_claim_rules: () => [],
  add_skill_alias: (a) => ({ id: 1, alias: String(a.alias ?? "") }),
  delete_skill_alias: () => ({ ok: true }),

  // applications
  list_applications: () => applications,
  create_application: (a) => {
    const app = a.application as (typeof applications)[number] & { id?: number };
    const next = { ...app, id: Math.max(...applications.map((x) => x.id), 0) + 1 };
    applications.unshift(next);
    return next;
  },
  update_application: (a) => a.application,
  set_application_status: (a) => {
    const app = applications.find((x) => x.id === a.id);
    if (app) app.status = a.status as (typeof app)["status"];
    return app;
  },
  delete_application: () => ({ ok: true }),

  // interview / dashboard / settings
  generate_interview_prep: (a) => ({
    jobLabel: jobs.find((j) => j.id === a.jobId)?.roleTitle ?? "Job",
    questions: [
      {
        category: "project_deep_dive",
        question: "Walk me through the producer-consumer pipeline in WatchDog — why async?",
        why: "Directly references your WatchDog project bullet.",
        evidenceRefs: ["benchmark-notes.md"],
      },
      {
        category: "technical_skill",
        question: "How does WAL persistence differ from append-only logs in your PyKV cache?",
        why: "JD mentions databases; your vault shows SQLite + AOF experience.",
        evidenceRefs: [],
      },
    ],
    inputs: { rawJdChars: 2400, requirementCount: 12, planBulletCount: 9, gapCount: 2, evidenceCount: 18 },
  }),
  get_dashboard: () => mockDashboard,
  ai_get_config: () => ({
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3.5:9b",
    hasApiKey: false,
  }),
  ai_save_config: (a) => ({ baseUrl: String(a.baseUrl), model: String(a.model), hasApiKey: Boolean(a.apiKey) }),
  ai_list_models: () => ["qwen3.5:9b", "llama3.1:8b", "mistral:7b"],
  ai_test_connection: () => "ok (mock)",
  list_backups: () => [],
  create_backup: () => ({ fileName: "kairo-backup-mock.db", path: "mock://backups", bytes: 10240, createdAt: new Date().toISOString() }),
  restore_backup: () => ({ ok: true, appliedMigrations: 11 }),

  // import parsers (pure heuristics — the real extraction lives in the backend)
  parse_resume_text: (a) => parseResume(String(a.text ?? "")),
  parse_certificate_text: (a) => parseCertificate(String(a.text ?? "")),
  github_repo_candidate: (a) => parseGithubRepo(String(a.owner ?? ""), String(a.repo ?? "")),
};

export function installMockIpc() {
  const internals = {
    transformCallback: (cb: unknown) => cb,
    invoke: (cmd: string, args: Record<string, unknown> = {}) => {
      const handler = handlers[cmd];
      if (!handler) {
        return Promise.reject(new Error(`[mock] command not implemented: ${cmd}`));
      }
      try {
        return Promise.resolve(handler(args));
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    plugins: {},
  };
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals;
  // The dev PDF fixture lives in /public — copy it there when missing.
  console.info("[kairo dev] Tauri IPC mock installed — backend calls resolve to fixtures.");
}
