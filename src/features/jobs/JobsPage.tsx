import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Briefcase } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Feedback";
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
          {job.seniority ? <Badge tone="violet">{job.seniority}</Badge> : null}
          {job.domain ? <Badge tone="sky">{job.domain}</Badge> : null}
          <Badge tone={job.requirementCount > 0 ? "green" : "amber"}>
            {job.requirementCount} requirements
          </Badge>
        </div>
      </button>
      <div className="mt-4 flex items-center justify-end border-t border-line pt-3">
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-bad hover:bg-bad-soft dark:hover:bg-bad/10 dark:text-red-400"
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
  const loadError = useJobsStore((s) => s.error);
  const deleteJob = useJobsStore((s) => s.deleteJob);

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Job | null>(null);

  useEffect(() => {
    load().catch(() => { /* surfaced via store error */ });
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

      {loadError ? (
        <div className="mb-6 rounded-xl border border-bad/25 bg-bad-soft p-4 text-sm text-bad dark:border-red-500/30 dark:bg-bad/10 dark:text-red-300">
          Could not load job workspaces: {loadError}
        </div>
      ) : null}

      {loading && !loaded ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : jobs.length === 0 && !loadError ? (
        <EmptyState
          icon={<Briefcase className="size-6" />}
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
