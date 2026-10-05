import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Briefcase, FileText, Plus, Search } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Input } from "../../components/ui/inputs";
import { TrashDialog } from "../../components/ui/TrashDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Feedback";
import type { Job, JobHomeRow } from "../../lib/types";
import { useJobsStore } from "../../stores/jobsStore";
import { toast } from "../../stores/toastStore";
import { NewJobDialog } from "./NewJobDialog";

type ResumeState = "missing" | "stale" | "current";

const RESUME_STATE_META: Record<ResumeState, { label: string; badge: "green" | "amber" | "neutral"; next: string }> = {
  current: { label: "Current PDF", badge: "green", next: "Review and track the application" },
  stale: { label: "PDF needs update", badge: "amber", next: "Update the PDF" },
  missing: { label: "Draft", badge: "neutral", next: "Compose the resume and export" },
};

function fmtActivity(stamp: string): string {
  if (!stamp) return "—";
  const then = new Date(stamp.replace(" ", "T") + (stamp.includes("Z") ? "" : "Z"));
  if (Number.isNaN(then.getTime())) return stamp;
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** The Jobs page scales as a list: role, company, resume state, last
 *  activity and the specific next action — one row per workspace. */
export default function JobsPage() {
  const navigate = useNavigate();
  const jobs = useJobsStore((s) => s.jobs);
  const loaded = useJobsStore((s) => s.loaded);
  const loading = useJobsStore((s) => s.loading);
  const load = useJobsStore((s) => s.load);
  const loadError = useJobsStore((s) => s.error);
  const deleteJob = useJobsStore((s) => s.deleteJob);

  const [overview, setOverview] = useState<JobHomeRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Job | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showRepeated, setShowRepeated] = useState(false);

  useEffect(() => {
    load().catch(() => {
      /* surfaced via store error */
    });
    void ipcOverview().then(setOverview).catch(() => setOverview([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overviewFor = (id: number): JobHomeRow | undefined =>
    overview.find((o) => o.jobId === id);

  const repeatedIds = new Set<number>();
  for (let i = 0; i < jobs.length; i += 1) {
    if (jobs[i].kind === "general") continue;
    for (let j = i + 1; j < jobs.length; j += 1) {
      if (jobs[j].kind === "general") continue;
      const leftUrl = jobs[i].url.trim().replace(/\/+$/, "").toLowerCase();
      const rightUrl = jobs[j].url.trim().replace(/\/+$/, "").toLowerCase();
      const leftJd = jobs[i].rawJd.trim().replace(/\s+/g, " ").toLowerCase();
      const rightJd = jobs[j].rawJd.trim().replace(/\s+/g, " ").toLowerCase();
      const normalized = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
      const sameRole = normalized(jobs[i].company) === normalized(jobs[j].company)
        && normalized(jobs[i].roleTitle) === normalized(jobs[j].roleTitle);
      if ((leftUrl && leftUrl === rightUrl) || (sameRole && leftJd && leftJd === rightJd)) {
        repeatedIds.add(jobs[i].id);
        repeatedIds.add(jobs[j].id);
      }
    }
  }

  const filtered = jobs.filter((j) => {
    if (showRepeated && !repeatedIds.has(j.id)) return false;
    const q = search.trim().toLowerCase();
    if (q && !`${j.roleTitle} ${j.company}`.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteJob(deleting.id);
      toast.ok("Job workspace deleted");
      void ipcOverview().then(setOverview).catch(() => {});
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-7 lg:px-10 lg:py-9">
      <section className="relative mb-7 overflow-hidden rounded-[28px] bg-[#101B3D] px-7 py-8 text-white sm:px-9">
        <div aria-hidden className="absolute -right-16 -top-36 size-96 rounded-full border border-white/10 bg-kairo-blue/15" />
        <div aria-hidden className="absolute right-12 -top-24 size-64 rounded-full border border-white/10" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="mb-4 inline-flex size-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-kairo-sky"><Briefcase className="size-5" /></div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-kairo-sky">Your opportunities</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Workspaces</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Each role keeps its requirements, evidence, resume, and sent version together.</p>
          </div>
          <Button onClick={() => setCreating(true)}><Plus className="mr-2 size-4" /> New workspace</Button>
        </div>
      </section>
      <TrashDialog open={trashOpen} onClose={() => setTrashOpen(false)} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            className="pl-10"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            placeholder="Search by role or company…"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => setTrashOpen(true)}>Recently deleted</Button>
      </div>

      {repeatedIds.size > 0 ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-ink">
          <span>{repeatedIds.size} workspaces appear to reference repeated postings. Open them to compare their drafts and sent versions before removing any.</span>
          <Button size="sm" variant="secondary" onClick={() => setShowRepeated((v) => !v)}>
            {showRepeated ? "Show all" : "Review repeats"}
          </Button>
        </div>
      ) : null}

      {loadError ? (
        <div className="mb-6 rounded-xl border border-bad/25 bg-bad-soft p-4 text-sm text-bad dark:border-red-500/30 dark:bg-bad/10 dark:text-red-300">
          Could not load job workspaces: {loadError}
        </div>
      ) : null}

      {loading && !loaded ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : jobs.length === 0 && !loadError ? (
        <>
          <EmptyState
            icon={<Briefcase className="size-6" />}
            title="Paste a job description to start a workspace."
            description="The original text is stored unchanged, then turned into an editable requirement model you can correct before anything is matched."
          >
            <Button onClick={() => setCreating(true)}>New job</Button>
          </EmptyState>
          <p className="mt-4 text-center text-xs text-muted">
            Not applying anywhere yet? Onboarding can create a{" "}
            <button
              type="button"
              className="font-medium text-kairo-blue hover:underline"
              onClick={() => navigate("/onboarding")}
            >
              general resume
            </button>{" "}
            instead — no posting needed.
          </p>
        </>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
          No jobs match "{search.trim()}".
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((job) => {
            const row = overviewFor(job.id);
            const state: ResumeState = row?.pdfState ?? "missing";
            const meta = RESUME_STATE_META[state];
            return (
              <li key={job.id} className="min-w-0">
                <div className="group flex h-full min-h-[216px] flex-col rounded-2xl border border-line bg-card p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-kairo-blue/40 hover:shadow-raised">
                  <button
                    type="button"
                    onClick={() => navigate(`/jobs/${job.id}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="mb-4 flex items-center justify-between gap-2"><span className="flex size-10 items-center justify-center rounded-xl bg-kairo-blue/10 text-kairo-blue"><Briefcase className="size-5" /></span><span className="text-xs text-muted" title={row?.lastActivity}>{fmtActivity(row?.lastActivity ?? "")}</span></div>
                    <p className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-ink">
                      <span className="truncate group-hover:text-kairo-blue">
                        {job.roleTitle || "Untitled role"}
                      </span>
                    </p>
                    <p className="mt-1 truncate text-sm text-muted">
                      {job.company || "No company"}
                      {job.domain ? ` · ${job.domain}` : ""}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Badge tone={meta.badge}><FileText className="mr-1 inline size-3" /> {meta.label}</Badge>
                      {job.kind === "general" ? <Badge tone="violet">General</Badge> : null}
                      {repeatedIds.has(job.id) ? <Badge tone="amber">Repeated posting</Badge> : null}
                    </div>
                  </button>
                  <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          state === "stale" ? `/jobs/${job.id}/resume` : `/jobs/${job.id}`,
                        )
                      }
                      className="flex min-w-0 items-center gap-1 text-left text-xs font-semibold text-kairo-blue hover:underline"
                    >
                      <span className="truncate">{meta.next}</span> <ArrowRight className="size-3.5 shrink-0" />
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted hover:bg-bad-soft hover:text-bad dark:hover:bg-bad/10 dark:hover:text-red-400"
                      onClick={() => setDeleting(job)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <NewJobDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={!!deleting}
        title="Delete job workspace"
        message={`Delete the workspace for "${deleting?.roleTitle || "Untitled role"}"? It moves to Recently deleted for 30 days — restoring brings back the description, requirements, match and plan.`}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

async function ipcOverview(): Promise<JobHomeRow[]> {
  const { ipc } = await import("../../lib/ipc");
  return ipc.getHomeOverview();
}
