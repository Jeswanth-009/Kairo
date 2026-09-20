import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { Job, JobRequirement } from "../lib/types";

interface JobsStore {
  jobs: Job[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  reqCache: Record<number, JobRequirement[]>;
  load: () => Promise<void>;
  createWorkspace: (job: Job, requirements: JobRequirement[]) => Promise<JobWithRequirements_>;
  deleteJob: (id: number) => Promise<void>;
  updateJob: (job: Job) => Promise<Job>;
  loadRequirements: (jobId: number) => Promise<void>;
  addRequirement: (req: JobRequirement) => Promise<JobRequirement>;
  updateRequirement: (req: JobRequirement) => Promise<JobRequirement>;
  deleteRequirement: (jobId: number, id: number) => Promise<void>;
}

interface JobWithRequirements_ {
  job: Job;
  requirements: JobRequirement[];
}

function upsert(list: Job[], item: Job): Job[] {
  const index = list.findIndex((j) => j.id === item.id);
  if (index === -1) return [item, ...list];
  const next = list.slice();
  next[index] = item;
  return next;
}

export const useJobsStore = create<JobsStore>()((set, get) => ({
  jobs: [],
  loaded: false,
  loading: false,
    error: null,
  reqCache: {},

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const jobs = await ipc.listJobs();
      set({ jobs, loaded: true });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  createWorkspace: async (job, requirements) => {
    const created = await ipc.createJobWithRequirements(job, requirements);
    set((state) => ({
      jobs: [created.job, ...state.jobs],
      reqCache: { ...state.reqCache, [created.job.id]: created.requirements },
    }));
    return created;
  },

  deleteJob: async (id) => {
    await ipc.deleteJob(id);
    set((state) => {
      const reqCache = { ...state.reqCache };
      delete reqCache[id];
      return { jobs: state.jobs.filter((j) => j.id !== id), reqCache };
    });
  },

  updateJob: async (job) => {
    const saved = await ipc.updateJob(job);
    set((state) => ({ jobs: upsert(state.jobs, saved) }));
    return saved;
  },

  loadRequirements: async (jobId) => {
    const list = await ipc.listRequirements(jobId);
    set((state) => ({ reqCache: { ...state.reqCache, [jobId]: list } }));
  },

  addRequirement: async (req) => {
    const saved = await ipc.addRequirement(req);
    set((state) => ({
      reqCache: { ...state.reqCache, [saved.jobId]: [...(state.reqCache[saved.jobId] ?? []), saved] },
      jobs: state.jobs.map((j) =>
        j.id === saved.jobId ? { ...j, requirementCount: j.requirementCount + 1 } : j,
      ),
    }));
    return saved;
  },

  updateRequirement: async (req) => {
    const saved = await ipc.updateRequirement(req);
    set((state) => ({
      reqCache: {
        ...state.reqCache,
        [saved.jobId]: (state.reqCache[saved.jobId] ?? []).map((r) => (r.id === saved.id ? saved : r)),
      },
    }));
    return saved;
  },

  deleteRequirement: async (jobId, id) => {
    await ipc.deleteRequirement(id);
    set((state) => ({
      reqCache: {
        ...state.reqCache,
        [jobId]: (state.reqCache[jobId] ?? []).filter((r) => r.id !== id),
      },
      jobs: state.jobs.map((j) =>
        j.id === jobId ? { ...j, requirementCount: Math.max(0, j.requirementCount - 1) } : j,
      ),
    }));
  },
}));
