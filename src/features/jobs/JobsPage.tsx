import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { IconJobs } from "../../components/icons";
import type { Job } from "../../lib/types";
import { useJobsStore } from "../../stores/jobsStore";
import { toast } from "../../stores/toastStore";
import { NewJobDialog } from "./NewJobDialog";

function JobCard({ job, onOpen, onDelete }: { job: Job; onOpen: () => void; onDelete: () => void }) {  return (
    <Card className="flex flex-col p-5">
      <button type="button" onClick={onOpen} className="text-left">
        <h3 className="text-sm font-semibold text-ink hover:text-kairo-blue">
          {job.roleTitle || "Untitled role"}
        </h3>
        {job.company ? <p className="mt-0.5 text-xs text-muted">{job.company}</p> : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {job.seniority ? (
            <span className="rounded-full bg-kairo-violet/10 px-2 py-0.5 text-[11px] font-medium text-kairo-violet">
              {job.seniority}
            </span>
          ) : null}
          {job.domain ? (
            <span className="rounded-full bg-kairo-sky/20 px-2 py-0.5 text-[11px] font-medium text-sky-700">
              {job.domain}
            </span>
          ) : null}
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              job.requirementCount > 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {job.requirementCount} requirements
          </span>
        </div>
      </button>
      <div className="mt-4 flex items-center justify-end border-t border-slate-100 pt-3">
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function JobsPage() {
  const navigate = useNavigate();
  const jobs = useJobsStore((s) => s.jobs);
  const loaded = useJobsStore((s) => s.loaded);
  const loading = useJobsStore((s) => s.loading);
  const load = useJobsStore((s) => s.load);
  const deleteJob = useJobsStore((s) => s.deleteJob);

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Job | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteJob(deleting.id);
      toast.ok("Job workspace deleted");
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title="Job workspaces"
        description="The exact job description is stored verbatim; requirements are only saved after your review."
        actions={<Button onClick={() => setCreating(true)}>New workspace</Button>}
      />

      {loading && !loaded ? (
        <p className="py-16 text-center text-sm text-muted">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<IconJobs width={24} height={24} />}
          title="Paste a job description to start a workspace."
          description="The original text is stored unchanged, then turned into an editable requirement model you can correct before anything is matched."
        >
          <Button onClick={() => setCreating(true)}>New workspace</Button>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onOpen={() => navigate(`/jobs/${job.id}`)}
              onDelete={() => setDeleting(job)}
            />
          ))}
        </div>
      )}

      <NewJobDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={!!deleting}
        title="Delete job workspace"
        message={`Delete the workspace for "${deleting?.roleTitle || "Untitled role"}"? The stored job description and its requirements are removed.`}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
