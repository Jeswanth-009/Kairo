import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Briefcase, FileText } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Input } from "../../components/ui/inputs";
import { TrashDialog } from "../../components/ui/TrashDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
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

  useEffect(() => {
    load().catch(() => {
      /* surfaced via store error */
    });
    void ipcOverview().then(setOverview).catch(() => setOverview([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overviewFor = (id: number): JobHomeRow | undefined =>
    overview.find((o) => o.jobId === id);

  const filtered = jobs.filter((j) => {
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
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title="Jobs"
        description="Each workspace keeps the posting, its requirements, and the resume you build for it."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setTrashOpen(true)}>
              Recently deleted
            </Button>
            <Button onClick={() => setCreating(true)}>New job</Button>
          </>
        }
      />
      <TrashDialog open={trashOpen} onClose={() => setTrashOpen(false)} />

      {jobs.length > 6 ? (
        <div className="mb-5">
          <Input
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            placeholder="Search by role or company…"
          />
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
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {filtered.map((job) => {
            const row = overviewFor(job.id);
            const state: ResumeState = row?.pdfState ?? "missing";
            const meta = RESUME_STATE_META[state];
            return (
              <li key={job.id}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-accent-soft/60">
                  <button
                    type="button"
                    onClick={() => navigate(`/jobs/${job.id}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <span className="truncate hover:text-kairo-blue">
                        {job.roleTitle || "Untitled role"}
                      </span>
                      {job.kind === "general" ? <Badge tone="violet">General</Badge> : null}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {job.company || "No company"}
                      {job.domain ? ` · ${job.domain}` : ""}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-4">
                    <Badge tone={meta.badge}>
                      <FileText className="mr-1 inline size-3" /> {meta.label}
                    </Badge>
                    <span
                      className="w-16 text-right text-xs text-muted"
                      title={row?.lastActivity}
                    >
                      {fmtActivity(row?.lastActivity ?? "")}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          state === "stale" ? `/jobs/${job.id}/resume` : `/jobs/${job.id}`,
                        )
                      }
                      className="flex items-center gap-1 text-xs font-medium text-kairo-blue hover:underline"
                    >
                      {meta.next} <ArrowRight className="size-3.5" />
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-bad hover:bg-bad-soft dark:hover:bg-bad/10 dark:text-red-400"
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
