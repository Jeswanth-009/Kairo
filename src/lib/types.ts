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

export const CONFIDENCE_LEVELS = [
  "Mentioned only",
  "Studied",
  "Experimented",
  "Used in a project",
  "Repeatedly used",
  "Production-like evidence",
] as const;
