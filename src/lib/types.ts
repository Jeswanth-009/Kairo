export interface Diagnostics {
  appVersion: string;
  schemaVersion: number;
  latestMigration: string;
  sqliteVersion: string;
  dbPath: string;
  migrationsApplied: string[];
}

export interface SmokeTestResult {
  ok: boolean;
  tokenWritten: string;
  tokenReadBack: string;
  durationMs: number;
  error: string | null;
}

export type DbStatus = "unverified" | "ok" | "error";

// --- Career Vault (Phase 1) ----------------------------------------------

export interface SkillRef {
  skillId: number;
  canonicalName: string;
  confidence: number; // 0-5
}

/** Where a vault record came from — provenance is always shown honestly. */
export type RecordOrigin = "manual" | "imported";

/** Provenance columns shared by the five record kinds. */
export interface RecordProvenance {
  /** 'manual' (authored in Kairo) or 'imported' (from a resume). */
  origin?: RecordOrigin;
  /** First content edit after an import — the honest "Edited by you" mark. */
  editedAt?: string | null;
  /** Set only by an explicit "verified by you" action. */
  verifiedAt?: string | null;
}

export interface Project extends RecordProvenance {
  id: number;
  title: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  url: string;
  repoUrl: string;
  skills: SkillRef[];
  evidenceCount: number;
}

export interface Experience extends RecordProvenance {
  id: number;
  organization: string;
  role: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  location: string;
  skills: SkillRef[];
  evidenceCount: number;
}

export interface Education extends RecordProvenance {
  id: number;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

export interface Certification extends RecordProvenance {
  id: number;
  title: string;
  issuer: string;
  description: string;
  issueDate: string | null;
  expiryDate: string | null;
  credentialId: string;
  url: string;
}

export interface Achievement extends RecordProvenance {
  id: number;
  title: string;
  issuer: string;
  description: string;
  achievedOn: string | null;
}

/** Snapshot for the first-run redirect and the dashboard CTA. */
export interface OnboardingStatus {
  hasProfile: boolean;
  projectCount: number;
  experienceCount: number;
  educationCount: number;
  skillCount: number;
  jobCount: number;
  /** Imported records still on the bottom rung of the review ladder. */
  importedUnreviewed: number;
  hasAnyContent: boolean;
}

/** Per-job resume state for the Home continue card, newest activity first. */
export interface JobHomeRow {
  jobId: number;
  roleTitle: string;
  company: string;
  hasPlan: boolean;
  /** missing (no compiled PDF) · stale (changed after export) · current. */
  pdfState: "missing" | "stale" | "current";
  lastActivity: string;
}

export type SkillCategory =
  | "language"
  | "framework"
  | "tool"
  | "database"
  | "cloud"
  | "devops"
  | "soft"
  | "other";

export const SKILL_CATEGORIES: { value: SkillCategory; label: string }[] = [
  { value: "language", label: "Language" },
  { value: "framework", label: "Framework" },
  { value: "tool", label: "Tool" },
  { value: "database", label: "Database" },
  { value: "cloud", label: "Cloud" },
  { value: "devops", label: "DevOps" },
  { value: "soft", label: "Soft skill" },
  { value: "other", label: "Other" },
];

export interface SkillAlias {
  id: number;
  alias: string;
}

export interface Skill {
  id: number;
  canonicalName: string;
  category: SkillCategory;
  aliases: SkillAlias[];
}

export interface Profile {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  github: string;
  linkedin: string;
  summary: string;
}

export type EntityKey =
  | "projects"
  | "experiences"
  | "education"
  | "certifications"
  | "achievements";

export type VaultRecords = {
  projects: Project[];
  experiences: Experience[];
  education: Education[];
  certifications: Certification[];
  achievements: Achievement[];
  skills: Skill[];
};

export type VaultRecord = Project | Experience | Education | Certification | Achievement | Skill;
export type AnyVaultRecord = VaultRecord;

// --- Evidence & Trust (Phase 2) ------------------------------------------

export type TrustEntityType = "project" | "experience" | "education" | "certification" | "achievement";

export const EVIDENCE_KINDS: { value: EvidenceKind; label: string }[] = [
  { value: "repository", label: "Repository" },
  { value: "document", label: "Document" },
  { value: "certificate", label: "Certificate" },
  { value: "metric", label: "Measured metric" },
  { value: "note", label: "Note" },
  { value: "link", label: "Link" },
  { value: "other", label: "Other" },
];

export type EvidenceKind =
  | "repository"
  | "document"
  | "certificate"
  | "metric"
  | "note"
  | "link"
  | "other";

export interface Evidence {
  id: number;
  entityType: TrustEntityType;
  entityId: number;
  kind: EvidenceKind;
  title: string;
  reference: string;
  note: string;
  verified: boolean;
}

export interface BulletEvidenceRef {
  id: number;
  title: string;
  kind: EvidenceKind;
  verified: boolean;
}

export interface CanonicalBullet {
  id: number;
  entityType: "project" | "experience";
  entityId: number;
  text: string;
  approved: boolean;
  sortOrder: number;
  evidence: BulletEvidenceRef[];
  evidenceIds: number[];
}

export type ClaimRuleType = "forbidden_claim" | "allowed_claim";

export interface ClaimRule {
  id: number;
  entityType: string | null;
  entityId: number | null;
  ruleType: ClaimRuleType;
  pattern: string;
  note: string;
}

// --- Imports (Phase 3) — candidates only, never auto-saved ----------------

export interface ImportProfile {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  github: string;
  website: string;
  linkedin: string;
  summary: string;
}

export interface SkillDraft {
  name: string;
  category: SkillCategory;
}

export interface AchievementDraft {
  title: string;
  issuer: string;
  description: string;
  achievedOn: string | null;
  sourceSnippet: string;
}

export interface ProjectDraft {
  title: string;
  description: string;
  skills: string[];
  /** Dates printed on the project heading, when the resume carries one. */
  startDate?: string | null;
  endDate?: string | null;
  isCurrent?: boolean;
  /** Live/demo and repository links lifted from the project block. */
  url?: string;
  repoUrl?: string;
  sourceSnippet: string;
}

export interface ExperienceDraft {
  organization: string;
  role: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  location: string;
  sourceSnippet: string;
}

export interface EducationDraft {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  sourceSnippet: string;
}

export interface CertificateCandidate {
  title: string;
  issuer: string;
  issueDate: string | null;
  email: string;
  sourceSnippet: string;
}

export interface GithubRepoCandidate {
  title: string;
  description: string;
  url: string;
  repoUrl: string;
  startDate: string | null;
  skills: string[];
  sourcePreview: string;
}

export interface ResumeImport {
  profile: ImportProfile | null;
  projects: ProjectDraft[];
  experiences: ExperienceDraft[];
  education: EducationDraft[];
  achievements: AchievementDraft[];
  skills: SkillDraft[];
}

// --- Transactional import batch (one SQLite transaction, all-or-nothing) ----

/** Everything a first-run import saves, committed in a single call. */
export interface ImportBatch {
  /** Null saves nothing — an absent profile never erases an existing one. */
  profile: Profile | null;
  projects: ProjectDraft[];
  experiences: ExperienceDraft[];
  education: EducationDraft[];
  achievements: AchievementDraft[];
  /** Skill names referenced anywhere in the batch; missing ones are created. */
  skills: SkillDraft[];
}

export interface ImportBatchResult {
  profileSaved: boolean;
  projectIds: number[];
  experienceIds: number[];
  educationIds: number[];
  achievementIds: number[];
  /** Ids of the skills the batch resolved or created (deduplicated). */
  skillIds: number[];
}

// --- Evidence stage decisions ------------------------------------------------

export type EvidenceDecision = "use" | "dismiss";

export interface EvidenceSelection {
  id: number;
  jobId: number;
  requirementId: number;
  entityType: string;
  entityId: number;
  decision: EvidenceDecision;
  createdAt: string | null;
  updatedAt: string | null;
}

// --- Job Workspace (Phase 4) ----------------------------------------------

export type JobRequirementKind = "required_skill" | "preferred_skill" | "responsibility";

export const JOB_REQUIREMENT_KINDS: { value: JobRequirementKind; label: string }[] = [
  { value: "required_skill", label: "Required skill" },
  { value: "preferred_skill", label: "Preferred skill" },
  { value: "responsibility", label: "Responsibility" },
];

export interface Job {
  id: number;
  company: string;
  roleTitle: string;
  url: string;
  rawJd: string;
  seniority: string;
  domain: string;
  /** "role" (job application) or "general" (no-job resume workspace). */
  kind?: "role" | "general";
  requirementCount: number;
}

export interface JobRequirement {
  id: number;
  jobId: number;
  kind: JobRequirementKind;
  rawText: string;
  normalizedKey: string;
  importance: number;
  userConfirmed: boolean;
}

export interface JobRequirementDraft {
  kind: JobRequirementKind;
  rawText: string;
  importance: number;
}

export interface JobExtraction {
  role: string;
  company: string;
  url: string;
  seniority: string;
  domain: string;
  requirements: JobRequirementDraft[];
}

export interface JobWithRequirements {
  job: Job;
  requirements: JobRequirement[];
}

// --- Matching (Phase 5) ----------------------------------------------------

export type Coverage = "covered" | "partial" | "missing";

export interface EntityRef {
  entityType: string;
  id: number;
  title: string;
  contribution: string;
}

export interface RequirementResult {
  requirementId: number;
  kind: JobRequirementKind;
  rawText: string;
  importance: number;
  coverage: Coverage;
  explanation: string;
  matchedSkills: string[];
  entityRefs: EntityRef[];
}

export interface RankedEntity {
  entityType: string;
  id: number;
  title: string;
  relevance: number;
  reasons: string[];
}

export interface ScoreComponents {
  requiredSkills: number;
  preferredSkills: number;
  responsibilities: number;
  domain: number;
  recency: number;
  evidenceStrength: number;
}

export interface Weights {
  requiredSkills: number;
  preferredSkills: number;
  responsibilities: number;
  domain: number;
  recency: number;
  evidenceStrength: number;
}

export interface MatchReport {
  matchingVersion: number;
  weights: Weights;
  overallScore: number;
  components: ScoreComponents;
  results: RequirementResult[];
  entityRanking: RankedEntity[];
}

// --- Composer (Phase 6) -----------------------------------------------------

export type ResumeTemplateId = "jake" | "expressive" | "plushcv";

export interface ComposerConfig {
  targetPages: number;
  maxProjects: number;
  maxExperienceItems: number;
  maxBulletsPerItem: number;
  minFontSizePt: number;
  /** Persisted so the Studio and exports agree across restarts. */
  templateId?: ResumeTemplateId | string;
  /** Paper size for the compiled PDF: "letter" | "a4". */
  paper?: string;
}

export interface PlanBullet {
  id: number;
  text: string;
  supports: string[];
  excluded?: boolean;
}

export interface PlanItem {
  entityType: string;
  id: number;
  title: string;
  subtitle: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  description: string;
  bullets: PlanBullet[];
  skills: string[];
  relevance: number;
  evidenceCount: number;
  /** Provenance of the source record ('manual' | 'imported'). */
  origin?: "manual" | "imported";
  excluded?: boolean;
}

export interface PlanEducation {
  id: number;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

export interface PlanAchievement {
  id: number;
  title: string;
  issuer: string;
  description: string;
  achievedOn?: string | null;
  excluded?: boolean;
}

export interface PlanHeader {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  github: string;
  linkedin: string;
}

export interface PlanSkillGroup {
  category: string;
  skills: string[];
}

export interface ResumePlan {
  composerVersion: number;
  config: ComposerConfig;
  header: PlanHeader;
  education: PlanEducation[];
  experience: PlanItem[];
  projects: PlanItem[];
  achievements?: PlanAchievement[];
  skills: string[];
  skillsGrouped?: PlanSkillGroup[];
  excludedSkills?: string[];
  estimatedLines: number;
  fitsOnePage: boolean;
  warnings: string[];
}

// --- PDF (Phase 9) ------------------------------------------------------------

export interface PdfArtifact {
  jobId: number;
  texPath: string;
  pdfPath: string;
  pageCount: number | null;
  compiledAt: string | null;
  /** Template the PDF was compiled with (empty for pre-3.0 artifacts). */
  templateId?: string;
  paper?: string;
  /** Render-input fingerprint recorded at export (null for pre-13 rows). */
  fingerprint?: string | null;
  /** SHA-256 of the generated PDF file at export time. */
  pdfHash?: string | null;
  /** Saved plan revision this PDF was compiled from (null for pre-15 rows). */
  artifactPlanRevision?: number | null;
}

/** The saved plan vs the recorded artifact — the one truth for PDF labels. */
export type PdfState = "none" | "missing-file" | "stale" | "template-stale" | "current";

export interface PdfStatusView {
  state: PdfState;
  planRevision: number | null;
  artifactPlanRevision: number | null;
  templateId: string | null;
  artifactTemplateId: string | null;
  paper: string | null;
  artifactPaper: string | null;
  pageCount: number | null;
  compiledAt: string | null;
  pdfHash: string | null;
  /** The exact artifact hash the user marked reviewed (Review stage). */
  reviewedPdfHash: string | null;
  reviewedAt: string | null;
}

// --- Versions (Phase 10) -------------------------------------------------------

export interface ResumeVersion {
  id: number;
  jobId: number;
  versionNumber: number;
  createdAt: string;
  pdfPath: string;
  /** Export fingerprint frozen with this version (null for pre-13 rows). */
  fingerprint?: string | null;
  /** SHA-256 of this version's own PDF copy. */
  pdfHash?: string | null;
  snapshot: {
    versionNumber: number;
    job: Job;
    requirements: JobRequirement[];
    plan: ResumePlan;
    acceptedTailorings: TailorSuggestion[];
    matchingVersion: number;
    composerVersion: number;
    templateVersion: number;
    pdfPath: string;
  };
}

// --- Applications (Phase 11) ---------------------------------------------------

export type ApplicationStatus =
  | "wishlist"
  | "preparing"
  | "applied"
  | "oa"
  | "interview"
  | "final"
  | "offer"
  | "rejected"
  | "withdrawn";

export const APPLICATION_STATUSES: { value: ApplicationStatus; label: string }[] = [
  { value: "wishlist", label: "Wishlist" },
  { value: "preparing", label: "Preparing" },
  { value: "applied", label: "Applied" },
  { value: "oa", label: "OA" },
  { value: "interview", label: "Interview" },
  { value: "final", label: "Final round" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

export const STATUS_COLORS: Record<ApplicationStatus, string> = {
  wishlist: "bg-accent-soft text-muted",
  preparing: "bg-kairo-sky/20 text-sky-700",
  applied: "bg-kairo-blue/10 text-kairo-blue",
  oa: "bg-kairo-violet/10 text-kairo-violet",
  interview: "bg-amber-100 text-amber-700",
  final: "bg-orange-100 text-orange-700",
  offer: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  withdrawn: "bg-slate-200 text-muted",
};

export interface Application {
  id: number;
  jobId: number | null;
  resumeVersionId: number | null;
  company: string;
  role: string;
  url: string;
  status: ApplicationStatus;
  appliedDate: string | null;
  nextAction: string;
  notes: string;
}

// --- Grounded AI tailoring (Phase 7) ----------------------------------------

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

export interface TailorSuggestion {
  id: number;
  jobId: number;
  bulletId: number;
  originalText: string;
  suggestedText: string;
  status: "pending" | "accepted" | "rejected";
  validation: ValidationResult;
  model: string;
}

export interface TailorBatchReport {
  suggestions: TailorSuggestion[];
  model: string;
  /** true = one LLM call covered the whole plan; false = per-bullet fallback. */
  batchUsed: boolean;
  cancelled: boolean;
  durationMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface AiConfigView {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

export const CONFIDENCE_LEVELS = [
  "Mentioned only",
  "Studied",
  "Experimented",
  "Used in a project",
  "Repeatedly used",
  "Production-like evidence",
] as const;

// --- Interview Prep (Phase 12) ----------------------------------------------

export type InterviewCategory =
  | "project_deep_dive"
  | "technical_skill"
  | "responsibility"
  | "weak_area"
  | "resume_question";

export interface InterviewQuestion {
  category: InterviewCategory;
  question: string;
  why: string;
  evidenceRefs: string[];
}

export interface PrepInputsSummary {
  rawJdChars: number;
  requirementCount: number;
  planBulletCount: number;
  gapCount: number;
  evidenceCount: number;
}

export interface InterviewPrep {
  jobLabel: string;
  questions: InterviewQuestion[];
  inputs: PrepInputsSummary;
}

// --- Dashboard (Phase 13) ----------------------------------------------------

export type TrashEntityType =
  | "project"
  | "experience"
  | "education"
  | "certification"
  | "achievement"
  | "skill"
  | "job";

/** One entry in the Recently Deleted view (30-day soft delete). */
export interface TrashItem {
  entityType: TrashEntityType;
  entityId: number;
  label: string;
  deletedAt: string;
}

export const TRASH_ENTITY_LABELS: Record<TrashEntityType, string> = {
  project: "Project",
  experience: "Experience",
  education: "Education",
  certification: "Certification",
  achievement: "Achievement",
  skill: "Skill",
  job: "Job workspace",
};

export interface DashboardCounts {
  projects: number;
  experiences: number;
  education: number;
  certifications: number;
  achievements: number;
  skills: number;
  evidenceTotal: number;
  evidenceVerified: number;
  evidenceUnverified: number;
  canonicalBullets: number;
  bulletsApproved: number;
  claimRules: number;
  jobs: number;
  jobsWithMatch: number;
  jobsWithPlan: number;
  pdfsCompiled: number;
  resumeVersions: number;
  suggestionsPending: number;
  applications: number;
  applicationsActive: number;
}

export interface EvidenceReviewItem {
  id: number;
  entityType: TrustEntityType;
  entityId: number;
  entityLabel: string;
  kind: EvidenceKind;
  title: string;
  reference: string;
  createdAt: string;
}

export type ActivityRefType = "job" | "application" | "vault";

export interface ActivityItem {
  kind: string;
  refType: ActivityRefType;
  refId: number;
  label: string;
  detail: string;
  at: string;
}

export interface DashboardOverview {
  counts: DashboardCounts;
  evidenceNeedingReview: EvidenceReviewItem[];
  recentActivity: ActivityItem[];
}

// --- Backup & restore (Phase 14) ----------------------------------------------

export interface BackupInfo {
  fileName: string;
  path: string;
  bytes: number;
  createdAt: string;
  /** "archive" = portable zip (db + PDFs + manifest); "database" = legacy .db. */
  kind: "archive" | "database";
  jobCount?: number | null;
  versionCount?: number | null;
}

export interface RestoreOk {
  ok: boolean;
  appliedMigrations: number;
  filesRestored: number;
}
