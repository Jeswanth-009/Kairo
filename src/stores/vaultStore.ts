import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { Profile, VaultRecords } from "../lib/types";
import type { CanonicalBullet, ClaimRule, Evidence } from "../lib/types";

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

const trustKey = (entityType: string, entityId: number) => `${entityType}:${entityId}`;

interface VaultStore extends VaultRecords {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  profile: Profile | null;
  load: () => Promise<void>;
  saveProfile: (profile: Profile) => Promise<void>;
  saveRecord: <K extends keyof VaultRecords>(key: K, data: VaultRecords[K][number]) => Promise<VaultRecords[K][number]>;
  deleteRecord: (key: keyof VaultRecords, id: number) => Promise<void>;
  addAlias: (skillId: number, alias: string) => Promise<void>;
  deleteAlias: (aliasId: number) => Promise<void>;

  // Evidence & trust caches, keyed "entityType:entityId"
  evidenceCache: Record<string, Evidence[]>;
  bulletsCache: Record<string, CanonicalBullet[]>;
  rulesCache: Record<string, ClaimRule[]>;
  loadEvidence: (entityType: string, entityId: number) => Promise<void>;
  saveEvidence: (evidence: Evidence) => Promise<Evidence>;
  deleteEvidence: (entityType: string, entityId: number, id: number) => Promise<void>;
  loadBullets: (entityType: string, entityId: number) => Promise<void>;
  saveBullet: (bullet: CanonicalBullet, isNew: boolean) => Promise<CanonicalBullet>;
  deleteBullet: (entityType: string, entityId: number, id: number) => Promise<void>;
  loadRules: (entityType: string, entityId: number) => Promise<void>;
  saveRule: (rule: ClaimRule) => Promise<ClaimRule>;
  deleteRule: (entityType: string, entityId: number, id: number) => Promise<void>;
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
  error: null,
  profile: null,
  evidenceCache: {},
  bulletsCache: {},
  rulesCache: {},

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
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
    } catch (e) {
      set({ error: String(e) });
      throw e;
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

  loadEvidence: async (entityType, entityId) => {
    const list = await ipc.listEvidence(entityType, entityId);
    set((state) => ({ evidenceCache: { ...state.evidenceCache, [trustKey(entityType, entityId)]: list } }));
  },

  saveEvidence: async (evidence) => {
    const saved = evidence.id > 0 ? await ipc.updateEvidence(evidence) : await ipc.createEvidence(evidence);
    const key = trustKey(saved.entityType, saved.entityId);
    set((state) => ({
      evidenceCache: { ...state.evidenceCache, [key]: upsert(state.evidenceCache[key] ?? [], saved) },
    }));
    return saved;
  },

  deleteEvidence: async (entityType, entityId, id) => {
    await ipc.deleteEvidence(id);
    const key = trustKey(entityType, entityId);
    set((state) => ({
      evidenceCache: { ...state.evidenceCache, [key]: (state.evidenceCache[key] ?? []).filter((e) => e.id !== id) },
    }));
  },

  loadBullets: async (entityType, entityId) => {
    const list = await ipc.listBullets(entityType, entityId);
    set((state) => ({ bulletsCache: { ...state.bulletsCache, [trustKey(entityType, entityId)]: list } }));
  },

  saveBullet: async (bullet, isNew) => {
    const saved = isNew ? await ipc.createBullet(bullet) : await ipc.updateBullet(bullet);
    const key = trustKey(saved.entityType, saved.entityId);
    set((state) => ({
      bulletsCache: { ...state.bulletsCache, [key]: upsert(state.bulletsCache[key] ?? [], saved) },
    }));
    return saved;
  },

  deleteBullet: async (entityType, entityId, id) => {
    await ipc.deleteBullet(id);
    const key = trustKey(entityType, entityId);
    set((state) => ({
      bulletsCache: { ...state.bulletsCache, [key]: (state.bulletsCache[key] ?? []).filter((b) => b.id !== id) },
    }));
  },

  loadRules: async (entityType, entityId) => {
    const list = await ipc.listClaimRules(entityType, entityId);
    set((state) => ({ rulesCache: { ...state.rulesCache, [trustKey(entityType, entityId)]: list } }));
  },

  saveRule: async (rule) => {
    const saved = rule.id > 0 ? await ipc.updateClaimRule(rule) : await ipc.createClaimRule(rule);
    if (saved.entityType && saved.entityId !== null) {
      const key = trustKey(saved.entityType, saved.entityId);
      set((state) => ({
        rulesCache: { ...state.rulesCache, [key]: upsert(state.rulesCache[key] ?? [], saved) },
      }));
    }
    return saved;
  },

  deleteRule: async (entityType, entityId, id) => {
    await ipc.deleteClaimRule(id);
    const key = trustKey(entityType, entityId);
    set((state) => ({
      rulesCache: { ...state.rulesCache, [key]: (state.rulesCache[key] ?? []).filter((r) => r.id !== id) },
    }));
  },
}));
