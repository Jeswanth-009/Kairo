/**
 * Dev-only fixtures mirroring real Vault data (trimmed). Used by the
 * `?mock` browser harness so pages render without the Tauri backend.
 */
import type {
  Achievement,
  Application,
  CanonicalBullet,
  Certification,
  ClaimRule,
  DashboardOverview,
  Diagnostics,
  Evidence,
  Experience,
  Job,
  Profile,
  Project,
  ResumePlan,
  ResumeVersion,
  Skill,
  SkillRef,
  TailorSuggestion,
} from "../lib/types";
import { APP_VERSION } from "../lib/version";

const EXPERIENCE_LINES = {
  bdl: [
    "Reduced message delivery latency to <100ms by optimizing WebSocket payload serialization and implementing per-room connection pooling, while maintaining AES-256-GCM + RSA-OAEP E2E encryption with zero server-side key exposure",
    "Containerized Node.js WebSocket server and Express API with Docker Compose; wrote 15+ integration tests covering connection drops, key exchange failures, and message replay attacks",
  ].join("\n"),
  infosys: [
    "Engineered PyKV, an in-memory LRU cache engine with O(1) GET/SET via OrderedDict + asyncio.Lock; implemented AOF append-only persistence with atomic log compaction, reducing disk usage by 60% over 30-day operation",
    "Built automated benchmarking pipeline with 20-way concurrent httpx load, characterizing true server throughput at 708 ops/s (1.41ms/op) vs. in-process dict baseline; identified serialization and connection pooling as primary latency drivers",
  ].join("\n"),
};

export const mockJobs: Job[] = [
  {
    id: 3,
    company: "Electronic Arts",
    roleTitle: "AI Full Stack Intern (Paid)",
    url: "",
    rawJd: "General Information\nLocations: Chennai, Tamil Nadu, India\nBuild AI-powered web tooling…",
    seniority: "Internship",
    domain: "AI/ML",
    requirementCount: 12,
  },
  {
    id: 4,
    company: "GitHub",
    roleTitle: "Software Engineering Intern",
    url: "",
    rawJd: "",
    seniority: "Internship",
    domain: "Developer Tools",
    requirementCount: 9,
  },
];

export const mockProfile: Profile = {
  fullName: "Alex Rivera",
  headline: "Software Developer | Open-Source Contributor (Rust · Python) | HackFusion '25 Winner | 1300+ Codeforces",
  email: "alex.rivera@example.com",
  phone: "+91 9876543210",
  location: "Chennai, India",
  website: "https://alexrivera.dev",
  github: "https://github.com/alex-rivera-dev",
  linkedin: "https://linkedin.com/in/alex-rivera",
  summary: "Software developer focused on systems, backend and applied AI.",
};

export const mockSkills: Skill[] = [
  { id: 1, canonicalName: "Rust", category: "language", aliases: [] },
  { id: 2, canonicalName: "Python", category: "language", aliases: [] },
  { id: 3, canonicalName: "TypeScript", category: "language", aliases: [] },
  { id: 4, canonicalName: "JavaScript", category: "language", aliases: [] },
  { id: 5, canonicalName: "C++", category: "language", aliases: [] },
  { id: 6, canonicalName: "Java", category: "language", aliases: [] },
  { id: 7, canonicalName: "SQL", category: "language", aliases: [] },
  { id: 8, canonicalName: "Tauri", category: "framework", aliases: [] },
  { id: 9, canonicalName: "React", category: "framework", aliases: [] },
  { id: 10, canonicalName: "FastAPI", category: "framework", aliases: [] },
  { id: 11, canonicalName: "Node.js", category: "framework", aliases: [] },
  { id: 12, canonicalName: "Next.js", category: "framework", aliases: [] },
  { id: 13, canonicalName: "Tailwind CSS", category: "framework", aliases: [] },
  { id: 14, canonicalName: "PostgreSQL", category: "database", aliases: [] },
  { id: 15, canonicalName: "MongoDB", category: "database", aliases: [] },
  { id: 16, canonicalName: "SQLite", category: "database", aliases: [] },
  { id: 17, canonicalName: "DynamoDB", category: "database", aliases: [] },
  { id: 18, canonicalName: "AWS", category: "cloud", aliases: [] },
  { id: 19, canonicalName: "Lambda", category: "cloud", aliases: [] },
  { id: 20, canonicalName: "Bedrock", category: "cloud", aliases: [] },
  { id: 21, canonicalName: "Docker", category: "devops", aliases: [] },
  { id: 22, canonicalName: "Git", category: "devops", aliases: [] },
  { id: 23, canonicalName: "GitHub Actions", category: "devops", aliases: [] },
  { id: 24, canonicalName: "Linux", category: "devops", aliases: [] },
  { id: 25, canonicalName: "NumPy", category: "tool", aliases: [] },
  { id: 26, canonicalName: "Pandas", category: "tool", aliases: [] },
];

export const mockPlan: ResumePlan = {
  composerVersion: 1,
  config: {
    targetPages: 1,
    maxProjects: 3,
    maxExperienceItems: 2,
    maxBulletsPerItem: 3,
    minFontSizePt: 9.5,
    templateId: "jake",
    paper: "a4",
  },
  header: {
    fullName: "Alex Rivera",
    headline: "Software Developer | Open-Source Contributor (Rust · Python) | HackFusion '25 Winner | 1300+ Codeforces",
    email: "alex.rivera@example.com",
    phone: "+91 9876543210",
    location: "Chennai, India",
    website: "https://alexrivera.dev",
    github: "https://github.com/alex-rivera-dev",
    linkedin: "https://linkedin.com/in/alex-rivera",
  },
  education: [
    {
      id: 1,
      institution: "Riverside Institute of Technology, Chennai",
      degree: "Bachelor of Technology",
      fieldOfStudy: "Computer Science & Systems Engineering",
      startDate: "2023-09",
      endDate: "2027-05",
      isCurrent: false,
    },
  ],
  experience: [
    {
      entityType: "experience",
      id: 2,
      title: "Helix Dynamics — Project Intern",
      subtitle: "Chennai, India",
      startDate: "2025-06",
      endDate: "2025-07",
      isCurrent: false,
      description: EXPERIENCE_LINES.bdl,
      bullets: [],
      skills: ["Python", "Docker", "SQLite"],
      relevance: 0.9,
      evidenceCount: 3,
      excluded: false,
    },
    {
      entityType: "experience",
      id: 1,
      title: "Skilstack Academy — Python Intern",
      subtitle: "Remote",
      startDate: "2026-02",
      endDate: "2026-04",
      isCurrent: false,
      description: EXPERIENCE_LINES.infosys,
      bullets: [],
      skills: ["Python", "FastAPI"],
      relevance: 0.7,
      evidenceCount: 2,
      excluded: false,
    },
  ],
  projects: [
    {
      entityType: "project",
      id: 20,
      title: "CodeSensei",
      subtitle: "",
      startDate: null,
      endDate: null,
      isCurrent: false,
      description: [
        "Architected 4-layer Socratic reasoning pipeline (Beginner → Design → Pitfalls → Socratic) via structured JSON prompts to Amazon Bedrock Nova Lite; multi-turn conversation history with role alternation prevents context loss across follow-ups",
        "Optimized cross-region architecture (ap-south-2 Lambda → us-east-1 Bedrock) reducing model costs by 60% while maintaining sub-2s end-to-end latency; DynamoDB TTL enables 30-day per-user history at INR 0 idle cost",
        "Built auto-explain provider with 1.5s diagnostic debounce and CodeLens coverage for 10+ languages; serverless stack (SAM, Lambda, API Gateway) scales to zero with INR 0/month when inactive",
      ].join("\n"),
      bullets: [],
      skills: ["TypeScript", "AWS", "Bedrock"],
      relevance: 0.95,
      evidenceCount: 4,
      excluded: false,
    },
    {
      entityType: "project",
      id: 19,
      title: "WatchDog",
      subtitle: "",
      startDate: null,
      endDate: null,
      isCurrent: false,
      description: [
        "Built user-space background daemon implementing async producer-consumer pipeline with queue.Queue and SQLite executemany batch writes, eliminating synchronous I/O blocking on telemetry ingestion",
        "Replaced static threat thresholds with Exponential Moving Average (EMA) algorithm learning per-process resource baselines; flags anomalies at 3σ deviation with <5% false positive rate during 72-hour testing",
        "Enforced tamper-evident log integrity via canonical JSON serialization + SHA-256 hashing; implemented session-authenticated glassmorphic SOC dashboard with real-time threat feed and forensic audit trail",
      ].join("\n"),
      bullets: [],
      skills: ["Python", "SQLite"],
      relevance: 0.6,
      evidenceCount: 2,
      excluded: false,
    },
    {
      entityType: "project",
      id: 21,
      title: "Kairo",
      subtitle: "",
      startDate: null,
      endDate: null,
      isCurrent: false,
      description: [
        "Architected a local-first career workspace in Rust and Tauri 2 with decoupled domain modules and an append-only migration SQLite WAL layer, verified through unit and integration tests",
        "Built a deterministic constraint solver and matching engine computing coverage against JDs via pure functions, enforcing zero-fabrication metrics and technology diff validation on rewrites",
        "Integrated headless ATS-safe PDF compilation via portable Tectonic LaTeX binary, running unlocked async I/O to guarantee zero UI thread blocking during compilation",
      ].join("\n"),
      bullets: [],
      skills: ["Rust", "Tauri", "SQL"],
      relevance: 0.8,
      evidenceCount: 3,
      excluded: true,
    },
  ],
  achievements: [
    {
      id: 1,
      title: "OpenForge '26 Finalist",
      issuer: "OpenForge Foundation",
      description: "Selected for the final round after the proposal stage.",
      achievedOn: "2026-05-01",
      excluded: false,
    },
    {
      id: 2,
      title: "HackFusion '25 Winner",
      issuer: "HackFusion",
      description: "1st place among 100+ teams.",
      achievedOn: "2025-11-20",
      excluded: false,
    },
  ],
  skills: mockSkills.map((s) => s.canonicalName),
  skillsGrouped: [
    { category: "Languages", skills: ["Rust", "Python", "TypeScript", "JavaScript", "C++", "Java", "SQL"] },
    { category: "Frameworks", skills: ["Tauri", "React", "FastAPI", "Node.js", "Next.js", "Tailwind CSS"] },
    { category: "Databases", skills: ["PostgreSQL", "MongoDB", "SQLite", "DynamoDB"] },
    { category: "Cloud", skills: ["AWS", "Lambda", "Bedrock"] },
    { category: "DevOps", skills: ["Docker", "Git", "GitHub Actions", "Linux"] },
    { category: "Tools", skills: ["NumPy", "Pandas"] },
  ],
  excludedSkills: [],
  estimatedLines: 58,
  fitsOnePage: true,
  warnings: [],
};

export const mockSuggestions: TailorSuggestion[] = [];

// --- Vault records (mirroring mockDashboard.counts) ------------------------

const skillRef = (name: string, confidence: number): SkillRef | null => {
  const skill = mockSkills.find((s) => s.canonicalName.toLowerCase() === name.toLowerCase());
  return skill ? { skillId: skill.id, canonicalName: skill.canonicalName, confidence } : null;
};

const skillRefs = (names: string[], base: number): SkillRef[] =>
  names.map((name, i) => skillRef(name, Math.max(3, base - (i % 2)))).filter((s): s is SkillRef => s !== null);

export const mockProjects: Project[] = mockPlan.projects.map((p) => ({
  id: p.id,
  title: p.title,
  description: p.description,
  startDate: null,
  endDate: null,
  isCurrent: false,
  url: "",
  repoUrl: p.title === "WatchDog" ? "https://github.com/alex-rivera-dev/watchdog" : "",
  skills: skillRefs(p.skills, 5),
  evidenceCount: p.evidenceCount,
}));

export const mockExperiences: Experience[] = mockPlan.experience.map((e) => {
  const [organization, role] = e.title.split(" — ");
  return {
    id: e.id,
    organization,
    role: role ?? "",
    description: e.description,
    startDate: e.startDate,
    endDate: e.endDate,
    isCurrent: e.isCurrent,
    location: e.subtitle,
    skills: skillRefs(e.skills, 4),
    evidenceCount: e.evidenceCount,
  };
});

export const mockCertifications: Certification[] = [
  {
    id: 1,
    title: "Cloud Practitioner Essentials",
    issuer: "Amazon Web Services",
    description: "Foundational AWS cloud architecture, services and billing models.",
    issueDate: "2025-03-01",
    expiryDate: null,
    credentialId: "AWS-CCP-88412",
    url: "",
  },
  {
    id: 2,
    title: "Python Data Structures",
    issuer: "Skilstack Academy",
    description: "Core Python data structures, complexity analysis and testing.",
    issueDate: "2024-08-15",
    expiryDate: null,
    credentialId: "SKA-PY-1042",
    url: "",
  },
];

export const mockAchievements: Achievement[] = [
  ...(mockPlan.achievements ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    issuer: a.issuer,
    description: a.description,
    achievedOn: a.achievedOn ?? null,
  })),
  {
    id: 3,
    title: "1300+ Codeforces rating",
    issuer: "Codeforces",
    description: "Peak competitive-programming rating, top 8% of participants.",
    achievedOn: "2025-12-01",
  },
  {
    id: 4,
    title: "40+ merged open-source PRs",
    issuer: "GitHub",
    description: "Merged contributions across Rust and Python projects.",
    achievedOn: "2026-06-15",
  },
];

// 18 evidence items, 11 verified — matching mockDashboard.counts.
export const mockEvidence: Evidence[] = [
  { id: 1, entityType: "project", entityId: 20, kind: "metric", title: "60% model cost reduction", reference: "benchmark-notes.md", note: "Measured over a 30-day window across regions.", verified: true },
  { id: 2, entityType: "project", entityId: 20, kind: "document", title: "Sub-2s latency trace", reference: "latency-trace.json", note: "", verified: true },
  { id: 3, entityType: "project", entityId: 20, kind: "repository", title: "CodeSensei repo", reference: "github.com/alex-rivera-dev/codesensei", note: "", verified: true },
  { id: 4, entityType: "project", entityId: 20, kind: "note", title: "Bedrock pricing worksheet", reference: "", note: "", verified: false },
  { id: 5, entityType: "project", entityId: 19, kind: "repository", title: "WatchDog repo", reference: "github.com/alex-rivera-dev/watchdog", note: "", verified: true },
  { id: 6, entityType: "project", entityId: 19, kind: "metric", title: "EMA anomaly results", reference: "dog-eval.md", note: "", verified: false },
  { id: 7, entityType: "project", entityId: 21, kind: "repository", title: "Kairo repo", reference: "github.com/Jeswanth-009/Kairo", note: "", verified: true },
  { id: 8, entityType: "project", entityId: 21, kind: "metric", title: "118 tests passing", reference: "ci-run-2231", note: "", verified: true },
  { id: 9, entityType: "project", entityId: 21, kind: "document", title: "Architecture notes", reference: "docs/architecture.md", note: "", verified: false },
  { id: 10, entityType: "experience", entityId: 1, kind: "metric", title: "708 ops/s benchmark", reference: "pykv-bench.py", note: "20-way concurrent load test.", verified: true },
  { id: 11, entityType: "experience", entityId: 1, kind: "document", title: "Internship completion letter", reference: "", note: "", verified: true },
  { id: 12, entityType: "experience", entityId: 2, kind: "repository", title: "Secure messenger repo", reference: "github.com/alex-rivera-dev/messenger", note: "", verified: true },
  { id: 13, entityType: "experience", entityId: 2, kind: "document", title: "Internship report", reference: "", note: "", verified: false },
  { id: 14, entityType: "experience", entityId: 2, kind: "metric", title: "<100ms delivery latency", reference: "ws-bench.md", note: "", verified: false },
  { id: 15, entityType: "education", entityId: 1, kind: "document", title: "Enrollment record", reference: "", note: "", verified: true },
  { id: 16, entityType: "certification", entityId: 1, kind: "certificate", title: "AWS CCP certificate", reference: "AWS-CCP-88412", note: "", verified: true },
  { id: 17, entityType: "certification", entityId: 2, kind: "certificate", title: "Python course certificate", reference: "SKA-PY-1042", note: "", verified: false },
  { id: 18, entityType: "achievement", entityId: 1, kind: "link", title: "OpenForge finalist page", reference: "openforge.org/finalists", note: "", verified: true },
];

// 9 canonical bullets, 8 approved — matching mockDashboard.counts.
export const mockBullets: CanonicalBullet[] = [
  { id: 1, entityType: "project", entityId: 20, text: "Architected a 4-layer Socratic reasoning pipeline over Amazon Bedrock with multi-turn conversation history", approved: true, sortOrder: 1, evidence: [{ id: 1, title: "60% model cost reduction", kind: "metric", verified: true }], evidenceIds: [1] },
  { id: 2, entityType: "project", entityId: 20, text: "Cut model costs 60% with a cross-region architecture while keeping sub-2s end-to-end latency", approved: true, sortOrder: 2, evidence: [{ id: 1, title: "60% model cost reduction", kind: "metric", verified: true }], evidenceIds: [1] },
  { id: 3, entityType: "project", entityId: 20, text: "Built an auto-explain provider with 1.5s diagnostic debounce covering 10+ languages", approved: true, sortOrder: 3, evidence: [], evidenceIds: [] },
  { id: 4, entityType: "project", entityId: 19, text: "Built a user-space monitoring daemon with an async producer-consumer pipeline over SQLite", approved: true, sortOrder: 1, evidence: [{ id: 5, title: "WatchDog repo", kind: "repository", verified: true }], evidenceIds: [5] },
  { id: 5, entityType: "project", entityId: 21, text: "Led a platform team of 12 engineers across three regions", approved: false, sortOrder: 1, evidence: [], evidenceIds: [] },
  { id: 6, entityType: "experience", entityId: 2, text: "Reduced message delivery latency to <100ms via payload serialization and per-room pooling", approved: true, sortOrder: 1, evidence: [{ id: 12, title: "Secure messenger repo", kind: "repository", verified: true }], evidenceIds: [12] },
  { id: 7, entityType: "experience", entityId: 2, text: "Containerized the Node.js WebSocket server and Express API with Docker Compose; 15+ integration tests", approved: true, sortOrder: 2, evidence: [], evidenceIds: [] },
  { id: 8, entityType: "experience", entityId: 1, text: "Engineered PyKV, an in-memory LRU cache with O(1) GET/SET and AOF append-only persistence", approved: true, sortOrder: 1, evidence: [{ id: 10, title: "708 ops/s benchmark", kind: "metric", verified: true }], evidenceIds: [10] },
  { id: 9, entityType: "experience", entityId: 1, text: "Characterized true server throughput at 708 ops/s under 20-way concurrent load", approved: true, sortOrder: 2, evidence: [{ id: 10, title: "708 ops/s benchmark", kind: "metric", verified: true }], evidenceIds: [10] },
];

export const mockClaimRules: ClaimRule[] = [
  { id: 1, entityType: null, entityId: null, ruleType: "forbidden_claim", pattern: "led a team of", note: "Never claim leadership scope without evidence." },
  { id: 2, entityType: null, entityId: null, ruleType: "forbidden_claim", pattern: "nationwide", note: "" },
  { id: 3, entityType: "project", entityId: 20, ruleType: "allowed_claim", pattern: "cut model costs", note: "Backed by benchmark-notes.md." },
];

// Requirements per job — matching each job's requirementCount badge.
const req = (id: number, jobId: number, kind: string, rawText: string, importance: number) => ({
  id,
  jobId,
  kind,
  rawText,
  normalizedKey: rawText.toLowerCase(),
  importance,
  userConfirmed: true,
});

export const mockRequirements = [
  req(1, 3, "required_skill", "TypeScript", 0.9),
  req(2, 3, "required_skill", "React", 0.9),
  req(3, 3, "required_skill", "REST APIs", 0.85),
  req(4, 3, "required_skill", "Node.js", 0.8),
  req(5, 3, "preferred_skill", "AWS", 0.6),
  req(6, 3, "preferred_skill", "LLM integration", 0.6),
  req(7, 3, "preferred_skill", "Docker", 0.55),
  req(8, 3, "responsibility", "Build AI-powered web tooling", 0.8),
  req(9, 3, "responsibility", "Ship features end to end", 0.7),
  req(10, 3, "responsibility", "Write tested, reviewed code", 0.7),
  req(11, 3, "responsibility", "Collaborate with designers", 0.6),
  req(12, 3, "responsibility", "Work with product on scope", 0.6),
  req(13, 4, "required_skill", "Ruby on Rails", 0.9),
  req(14, 4, "required_skill", "Distributed systems", 0.85),
  req(15, 4, "required_skill", "SQL", 0.8),
  req(16, 4, "preferred_skill", "Go", 0.6),
  req(17, 4, "preferred_skill", "Kubernetes", 0.6),
  req(18, 4, "preferred_skill", "gRPC", 0.55),
  req(19, 4, "responsibility", "Design review APIs", 0.8),
  req(20, 4, "responsibility", "Improve CI pipelines", 0.7),
  req(21, 4, "responsibility", "On-call rotation", 0.6),
];

export const mockVersions: ResumeVersion[] = [];

export const mockApplications: Application[] = [
  {
    id: 1,
    jobId: 3,
    resumeVersionId: null,
    company: "Electronic Arts",
    role: "AI Full Stack Intern",
    url: "",
    status: "applied",
    appliedDate: "2026-09-10",
    nextAction: "Follow up next week",
    notes: "Referred by a senior dev on the team.",
  },
  {
    id: 2,
    jobId: 4,
    resumeVersionId: null,
    company: "GitHub",
    role: "Software Engineering Intern",
    url: "",
    status: "interview",
    appliedDate: "2026-09-01",
    nextAction: "Tech round prep",
    notes: "",
  },
  {
    id: 3,
    jobId: null,
    resumeVersionId: null,
    company: "Stripe",
    role: "Backend Intern",
    url: "",
    status: "wishlist",
    appliedDate: null,
    nextAction: "",
    notes: "",
  },
];

export const mockDiagnostics: Diagnostics = {
  appVersion: APP_VERSION,
  schemaVersion: 11,
  latestMigration: "0011_artifact_template",
  sqliteVersion: "3.46.0",
  dbPath: "%APPDATA%/com.kairo.app/kairo.db",
  migrationsApplied: ["0001_init", "0002_career_vault", "0010_applications"],
};

export const mockDashboard: DashboardOverview = {
  counts: {
    projects: 3,
    experiences: 2,
    education: 1,
    certifications: 2,
    achievements: 4,
    skills: 26,
    evidenceTotal: 18,
    evidenceVerified: 11,
    evidenceUnverified: 7,
    canonicalBullets: 9,
    bulletsApproved: 8,
    claimRules: 3,
    jobs: 2,
    jobsWithMatch: 1,
    jobsWithPlan: 1,
    pdfsCompiled: 2,
    resumeVersions: 1,
    suggestionsPending: 2,
    applications: 3,
    applicationsActive: 2,
  },
  evidenceNeedingReview: [
    {
      id: 1,
      entityType: "project",
      entityId: 20,
      entityLabel: "CodeSensei",
      kind: "metric",
      title: "60% model cost reduction",
      reference: "benchmark-notes.md",
      createdAt: "2026-09-14T10:00:00",
    },
    {
      id: 2,
      entityType: "experience",
      entityId: 2,
      entityLabel: "Helix Dynamics — Project Intern",
      kind: "repository",
      title: "Secure messenger repo",
      reference: "github.com/alex-rivera-dev/messenger",
      createdAt: "2026-09-13T18:30:00",
    },
  ],
  recentActivity: [
    { kind: "pdf_exported", refType: "job", refId: 3, label: "PDF compiled", detail: "AI Full Stack Intern · 1 page", at: "2026-09-17T20:12:00" },
    { kind: "plan_saved", refType: "job", refId: 3, label: "Resume plan saved", detail: "AI Full Stack Intern", at: "2026-09-17T19:58:00" },
    { kind: "application_created", refType: "application", refId: 1, label: "Application tracked", detail: "Electronic Arts · Applied", at: "2026-09-15T09:20:00" },
    { kind: "job_created", refType: "job", refId: 4, label: "Job workspace created", detail: "GitHub · SWE Intern", at: "2026-09-14T16:40:00" },
  ],
};
