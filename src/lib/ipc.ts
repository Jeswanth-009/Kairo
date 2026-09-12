import { invoke } from "@tauri-apps/api/core";
import type {
  Achievement,
  Certification,
  Diagnostics,
  Education,
  Experience,
  Profile,
  Project,
  Skill,
  SmokeTestResult,
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
};
