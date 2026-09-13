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

export interface Project {
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

export interface Experience {
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

export interface Education {
  id: number;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

export interface Certification {
  id: number;
  title: string;
  issuer: string;
  description: string;
  issueDate: string | null;
  expiryDate: string | null;
  credentialId: string;
  url: string;
}

export interface Achievement {
  id: number;
  title: string;
  issuer: string;
  description: string;
  achievedOn: string | null;
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
  email: string;
  github: string;
  website: string;
}

export interface ProjectDraft {
  title: string;
  description: string;
  skills: string[];
  sourceSnippet: string;
}

export interface ExperienceDraft {
  organization: string;
  role: string;
  description: string;
  sourceSnippet: string;
}

export interface EducationDraft {
  institution: string;
  degree: string;
  fieldOfStudy: string;
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
  skills: string[];
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

export interface ComposerConfig {
  targetPages: number;
  maxProjects: number;
  maxExperienceItems: number;
  maxBulletsPerItem: number;
  minFontSizePt: number;
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

export interface ResumePlan {
  composerVersion: number;
  config: ComposerConfig;
  header: PlanHeader;
  education: PlanEducation[];
  experience: PlanItem[];
  projects: PlanItem[];
  skills: string[];
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
}

// --- Versions (Phase 10) -------------------------------------------------------

export interface ResumeVersion {
  id: number;
  jobId: number;
  versionNumber: number;
  createdAt: string;
  pdfPath: string;
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
  wishlist: "bg-slate-100 text-slate-600",
  preparing: "bg-kairo-sky/20 text-sky-700",
  applied: "bg-kairo-blue/10 text-kairo-blue",
  oa: "bg-kairo-violet/10 text-kairo-violet",
  interview: "bg-amber-100 text-amber-700",
  final: "bg-orange-100 text-orange-700",
  offer: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  withdrawn: "bg-slate-200 text-slate-500",
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
}

export interface RestoreOk {
  ok: boolean;
  appliedMigrations: number;
}
