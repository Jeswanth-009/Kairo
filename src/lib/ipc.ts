import { invoke } from "@tauri-apps/api/core";
import type {
  Achievement,
  AiConfigView,
  Application,
  CanonicalBullet,
  Certification,
  CertificateCandidate,
  ClaimRule,
  ComposerConfig,
  Diagnostics,
  Education,
  Evidence,
  Experience,
  GithubRepoCandidate,
  Job,
  JobExtraction,
  JobRequirement,
  JobWithRequirements,
  MatchReport,
  Profile,
  Project,
  ResumeImport,
  ResumePlan,
  Skill,
  SmokeTestResult,
  TailorBatchReport,
  TailorSuggestion,
  PdfArtifact,
  ResumeVersion,
  InterviewPrep,
  ValidationResult,
  DashboardOverview,
  BackupInfo,
  RestoreOk,
} from "./types";

/**
 * Typed command boundary — every Tauri call goes through here so command names
 * and payload shapes stay in one place (spec §3.3).
 */
export const ipc = {
  // Foundation
  getDiagnostics: (): Promise<Diagnostics> => invoke<Diagnostics>("get_diagnostics"),
  dbSmokeTest: (): Promise<SmokeTestResult> => invoke<SmokeTestResult>("db_smoke_test"),

  // Projects
  listProjects: (): Promise<Project[]> => invoke<Project[]>("list_projects"),
  createProject: (project: Project): Promise<Project> =>
    invoke<Project>("create_project", { project }),
  updateProject: (project: Project): Promise<Project> =>
    invoke<Project>("update_project", { project }),
  deleteProject: (id: number): Promise<void> => invoke("delete_project", { id }),

  // Experience
  listExperiences: (): Promise<Experience[]> => invoke<Experience[]>("list_experiences"),
  createExperience: (experience: Experience): Promise<Experience> =>
    invoke<Experience>("create_experience", { experience }),
  updateExperience: (experience: Experience): Promise<Experience> =>
    invoke<Experience>("update_experience", { experience }),
  deleteExperience: (id: number): Promise<void> => invoke("delete_experience", { id }),

  // Education
  listEducation: (): Promise<Education[]> => invoke<Education[]>("list_education"),
  createEducation: (education: Education): Promise<Education> =>
    invoke<Education>("create_education", { education }),
  updateEducation: (education: Education): Promise<Education> =>
    invoke<Education>("update_education", { education }),
  deleteEducation: (id: number): Promise<void> => invoke("delete_education", { id }),

  // Certifications
  listCertifications: (): Promise<Certification[]> => invoke<Certification[]>("list_certifications"),
  createCertification: (certification: Certification): Promise<Certification> =>
    invoke<Certification>("create_certification", { certification }),
  updateCertification: (certification: Certification): Promise<Certification> =>
    invoke<Certification>("update_certification", { certification }),
  deleteCertification: (id: number): Promise<void> => invoke("delete_certification", { id }),

  // Achievements
  listAchievements: (): Promise<Achievement[]> => invoke<Achievement[]>("list_achievements"),
  createAchievement: (achievement: Achievement): Promise<Achievement> =>
    invoke<Achievement>("create_achievement", { achievement }),
  updateAchievement: (achievement: Achievement): Promise<Achievement> =>
    invoke<Achievement>("update_achievement", { achievement }),
  deleteAchievement: (id: number): Promise<void> => invoke("delete_achievement", { id }),

  // Skills + aliases
  listSkills: (): Promise<Skill[]> => invoke<Skill[]>("list_skills"),
  createSkill: (skill: Skill): Promise<Skill> => invoke<Skill>("create_skill", { skill }),
  updateSkill: (skill: Skill): Promise<Skill> => invoke<Skill>("update_skill", { skill }),
  deleteSkill: (id: number): Promise<void> => invoke("delete_skill", { id }),
  addSkillAlias: (skillId: number, alias: string): Promise<void> =>
    invoke("add_skill_alias", { skillId, alias }),
  deleteSkillAlias: (aliasId: number): Promise<void> => invoke("delete_skill_alias", { aliasId }),

  // Profile
  getProfile: (): Promise<Profile | null> => invoke<Profile | null>("get_profile"),
  upsertProfile: (profile: Profile): Promise<Profile> =>
    invoke<Profile>("upsert_profile", { profile }),

  // Evidence & trust (Phase 2)
  listEvidence: (entityType: string, entityId: number): Promise<Evidence[]> =>
    invoke<Evidence[]>("list_evidence", { entityType, entityId }),
  createEvidence: (evidence: Evidence): Promise<Evidence> =>
    invoke<Evidence>("create_evidence", { evidence }),
  updateEvidence: (evidence: Evidence): Promise<Evidence> =>
    invoke<Evidence>("update_evidence", { evidence }),
  deleteEvidence: (id: number): Promise<void> => invoke("delete_evidence", { id }),
  listBullets: (entityType: string, entityId: number): Promise<CanonicalBullet[]> =>
    invoke<CanonicalBullet[]>("list_bullets", { entityType, entityId }),
  createBullet: (bullet: CanonicalBullet): Promise<CanonicalBullet> =>
    invoke<CanonicalBullet>("create_bullet", { bullet }),
  updateBullet: (bullet: CanonicalBullet): Promise<CanonicalBullet> =>
    invoke<CanonicalBullet>("update_bullet", { bullet }),
  deleteBullet: (id: number): Promise<void> => invoke("delete_bullet", { id }),
  listClaimRules: (entityType: string | null, entityId: number | null): Promise<ClaimRule[]> =>
    invoke<ClaimRule[]>("list_claim_rules", { entityType, entityId }),
  createClaimRule: (rule: ClaimRule): Promise<ClaimRule> =>
    invoke<ClaimRule>("create_claim_rule", { rule }),
  updateClaimRule: (rule: ClaimRule): Promise<ClaimRule> =>
    invoke<ClaimRule>("update_claim_rule", { rule }),
  deleteClaimRule: (id: number): Promise<void> => invoke("delete_claim_rule", { id }),

  // Imports (Phase 3) — extraction only; candidates never touch the DB here
  parseResumeText: (text: string): Promise<ResumeImport> =>
    invoke<ResumeImport>("parse_resume_text", { text }),
  parseCertificateText: (text: string): Promise<CertificateCandidate> =>
    invoke<CertificateCandidate>("parse_certificate_text", { text }),
  githubRepoCandidate: (owner: string, repo: string): Promise<GithubRepoCandidate> =>
    invoke<GithubRepoCandidate>("github_repo_candidate", { owner, repo }),

  // Job Workspace (Phase 4)
  parseJd: (text: string): Promise<JobExtraction> => invoke<JobExtraction>("parse_jd", { text }),
  listJobs: (): Promise<Job[]> => invoke<Job[]>("list_jobs"),
  getJob: (id: number): Promise<Job> => invoke<Job>("get_job", { id }),
  updateJob: (job: Job): Promise<Job> => invoke<Job>("update_job", { job }),
  deleteJob: (id: number): Promise<void> => invoke("delete_job", { id }),
  createJobWithRequirements: (job: Job, requirements: JobRequirement[]): Promise<JobWithRequirements> =>
    invoke<JobWithRequirements>("create_job_with_requirements", { job, requirements }),
  listRequirements: (jobId: number): Promise<JobRequirement[]> =>
    invoke<JobRequirement[]>("list_requirements", { jobId }),
  addRequirement: (requirement: JobRequirement): Promise<JobRequirement> =>
    invoke<JobRequirement>("add_requirement", { requirement }),
  updateRequirement: (requirement: JobRequirement): Promise<JobRequirement> =>
    invoke<JobRequirement>("update_requirement", { requirement }),
  deleteRequirement: (id: number): Promise<void> => invoke("delete_requirement", { id }),

  // Matching (Phase 5)
  runJobMatch: (jobId: number): Promise<MatchReport> =>
    invoke<MatchReport>("run_job_match", { jobId }),
  getMatch: (jobId: number): Promise<MatchReport | null> =>
    invoke<MatchReport | null>("get_match", { jobId }),

  // Composer (Phase 6)
  runComposer: (
    jobId: number,
    config?: Partial<ComposerConfig>,
  ): Promise<ResumePlan> => invoke<ResumePlan>("run_composer", { jobId, config }),
  getPlan: (jobId: number): Promise<{ config: ComposerConfig; plan: ResumePlan } | null> =>
    invoke<{ config: ComposerConfig; plan: ResumePlan } | null>("get_plan", { jobId }),
  savePlan: (jobId: number, plan: ResumePlan): Promise<void> =>
    invoke("save_plan", { jobId, plan }),
  estimatePlanLines: (plan: ResumePlan): Promise<number> =>
    invoke<number>("estimate_plan_lines", { plan }),


  // Grounded AI tailoring (Phase 7)
  aiGetConfig: (): Promise<AiConfigView> => invoke<AiConfigView>("ai_get_config"),
  aiSaveConfig: (baseUrl: string, model: string, apiKey?: string): Promise<AiConfigView> =>
    invoke<AiConfigView>("ai_save_config", { baseUrl, model, apiKey }),
  aiTestConnection: (): Promise<string> => invoke("ai_test_connection"),
  aiListModels: (baseUrl: string): Promise<string[]> =>
    invoke<string[]>("ai_list_models", { baseUrl }),
  tailorSuggest: (jobId: number, bulletId: number): Promise<TailorSuggestion> =>
    invoke<TailorSuggestion>("tailor_suggest", { jobId, bulletId }),
  tailorList: (jobId: number): Promise<TailorSuggestion[]> =>
    invoke<TailorSuggestion[]>("tailor_list", { jobId }),
  tailorSetStatus: (
    id: number,
    status: "accepted" | "rejected",
    text?: string,
  ): Promise<TailorSuggestion> =>
    invoke<TailorSuggestion>("tailor_set_status", { id, status, text }),
  tailorDelete: (id: number): Promise<void> => invoke("tailor_delete", { id }),
  tailorPlanBatch: (jobId: number): Promise<TailorBatchReport> =>
    invoke<TailorBatchReport>("tailor_plan_batch", { jobId }),
  tailorCancel: (): Promise<void> => invoke("tailor_cancel"),

  // Interview Prep (Phase 12)
  generateInterviewPrep: (jobId: number): Promise<InterviewPrep> =>
    invoke<InterviewPrep>("generate_interview_prep", { jobId }),

  // Dashboard (Phase 13)
  getDashboard: (): Promise<DashboardOverview> => invoke<DashboardOverview>("get_dashboard"),

  // Backup & restore (Phase 14)
  listBackups: (): Promise<BackupInfo[]> => invoke<BackupInfo[]>("list_backups"),
  createBackup: (): Promise<BackupInfo> => invoke<BackupInfo>("create_backup"),
  restoreBackup: (fileName: string): Promise<RestoreOk> =>
    invoke<RestoreOk>("restore_backup", { fileName }),

  // PDF (Phase 9)
  exportPdf: (jobId: number, templateId: string = "classic"): Promise<{ artifact: PdfArtifact; logTail: string }> =>
    invoke<{ artifact: PdfArtifact; logTail: string }>("export_pdf", { jobId, templateId }),
  getPdfArtifact: (jobId: number): Promise<PdfArtifact | null> =>
    invoke<PdfArtifact | null>("get_pdf_artifact", { jobId }),
  openFile: (path: string): Promise<void> => invoke<void>("open_file", { path }),
  readPdfBytes: (path: string): Promise<number[]> => invoke<number[]>("read_pdf_bytes", { path }),
  revealFile: (path: string): Promise<void> => invoke<void>("reveal_file", { path }),
  savePdfToDownloads: (srcPath: string, customName?: string): Promise<string> =>
    invoke<string>("save_pdf_to_downloads", { srcPath, customName }),

  // Applications (Phase 11)
  listApplications: (): Promise<Application[]> => invoke<Application[]>("list_applications"),
  createApplication: (application: Application): Promise<Application> =>
    invoke<Application>("create_application", { application }),
  updateApplication: (application: Application): Promise<Application> =>
    invoke<Application>("update_application", { application }),
  setApplicationStatus: (id: number, status: string): Promise<Application> =>
    invoke<Application>("set_application_status", { id, status }),
  deleteApplication: (id: number): Promise<void> => invoke("delete_application", { id }),

  // Versions (Phase 10)
  saveResumeVersion: (jobId: number): Promise<ResumeVersion> =>
    invoke<ResumeVersion>("save_resume_version", { jobId }),
  listResumeVersions: (jobId: number): Promise<ResumeVersion[]> =>
    invoke<ResumeVersion[]>("list_resume_versions", { jobId }),
  getResumeVersion: (id: number): Promise<ResumeVersion> =>
    invoke<ResumeVersion>("get_resume_version", { id }),
  claimChanges: (
    jobId: number,
    bulletId: number,
    newText: string,
  ): Promise<ValidationResult> =>
    invoke<ValidationResult>("claim_changes", { jobId, bulletId, newText }),
  tailorSaveManualEdit: (
    jobId: number,
    bulletId: number,
    text: string,
  ): Promise<TailorSuggestion> =>
    invoke<TailorSuggestion>("tailor_save_manual_edit", { jobId, bulletId, text }),
};
