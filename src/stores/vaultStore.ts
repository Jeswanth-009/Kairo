import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { Profile, VaultRecords } from "../lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecord = { id: number };

const api: Record<keyof VaultRecords, { create: (x: any) => Promise<any>; update: (x: any) => Promise<any>; remove: (id: number) => Promise<void> }> = {
  projects: { create: ipc.createProject, update: ipc.updateProject, remove: ipc.deleteProject },
  experiences: { create: ipc.createExperience, update: ipc.updateExperience, remove: ipc.deleteExperience },
  education: { create: ipc.createEducation, update: ipc.updateEducation, remove: ipc.deleteEducation },
  certifications: { create: ipc.createCertification, update: ipc.updateCertification, remove: ipc.deleteCertification },
  achievements: { create: ipc.createAchievement, update: ipc.updateAchievement, remove: ipc.deleteAchievement },
  skills: { create: ipc.createSkill, update: ipc.updateSkill, remove: ipc.deleteSkill },
};

function upsert<T extends AnyRecord>(list: T[], item: T): T[] {
  const index = list.findIndex((r) => r.id === item.id);
  if (index === -1) return [item, ...list];
  const next = list.slice();
  next[index] = item;
  return next;
}

interface VaultStore extends VaultRecords {
  loaded: boolean;
  loading: boolean;
  profile: Profile | null;
  load: () => Promise<void>;
  saveProfile: (profile: Profile) => Promise<void>;
  saveRecord: <K extends keyof VaultRecords>(key: K, data: VaultRecords[K][number]) => Promise<VaultRecords[K][number]>;
  deleteRecord: (key: keyof VaultRecords, id: number) => Promise<void>;
  addAlias: (skillId: number, alias: string) => Promise<void>;
  deleteAlias: (aliasId: number) => Promise<void>;
}

export const useVaultStore = create<VaultStore>()((set, get) => ({
  projects: [],
  experiences: [],
  education: [],
  certifications: [],
  achievements: [],
  skills: [],
  loaded: false,
  loading: false,
  profile: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [projects, experiences, education, certifications, achievements, skills, profile] =
        await Promise.all([
          ipc.listProjects(),
          ipc.listExperiences(),
          ipc.listEducation(),
          ipc.listCertifications(),
          ipc.listAchievements(),
          ipc.listSkills(),
          ipc.getProfile(),
        ]);
      set({ projects, experiences, education, certifications, achievements, skills, profile, loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  saveProfile: async (profile) => {
    const saved = await ipc.upsertProfile(profile);
    set({ profile: saved });
  },

  saveRecord: async (key, data) => {
    const existing = (data as AnyRecord).id > 0;
    const saved = await (existing ? api[key].update(data) : api[key].create(data));
    set((state) => ({ [key]: upsert(state[key] as AnyRecord[], saved as AnyRecord) } as any));
    return saved;
  },

  deleteRecord: async (key, id) => {
    await api[key].remove(id);
    set((state) => ({ [key]: (state[key] as AnyRecord[]).filter((r) => r.id !== id) } as any));
  },

  addAlias: async (skillId, alias) => {
    await ipc.addSkillAlias(skillId, alias);
    set({ skills: await ipc.listSkills() });
  },

  deleteAlias: async (aliasId) => {
    await ipc.deleteSkillAlias(aliasId);
    set({ skills: await ipc.listSkills() });
  },
}));
