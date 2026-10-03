import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Feedback";
import { ipc } from "../../lib/ipc";
import { StatusLine, type DocState } from "../../components/ui/ds";
import { PdfViewer } from "../resume-studio/PdfViewer";
import type { PdfArtifact } from "../../lib/types";
import type { Application, InterviewCategory, InterviewPrep, Job } from "../../lib/types";
import { toast } from "../../stores/toastStore";

/**
 * Step 4 · Resume — a gateway into the job-scoped editor. The full editing
 * experience (content curation, tailoring, export) lives in the editor at
 * /jobs/:jobId/resume; this stage shows the current state and opens it.
 */
export function ResumeStep({ jobId }: { jobId: number }) {
  const navigate = useNavigate();
  const [artifact, setArtifact] = useState<PdfArtifact | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const a = await ipc.getPdfArtifact(jobId);
        if (!cancelled) setArtifact(a);
      } catch {
        if (!cancelled) setArtifact(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!loaded) return <Skeleton className="h-40 w-full" />;

  const state: DocState = !artifact
    ? "draft"
    : "current";

  return (
    <div className="space-y-4">
      <StatusLine
        state={state}
        detail={artifact ? `${artifact.pageCount ?? "?"} page(s)` : "no PDF yet"}
        actions={
          <Button size="sm" onClick={() => navigate(`/jobs/${jobId}/resume`)}>
            Open editor
          </Button>
        }
      />
      <Card className="p-5 text-center">
        <p className="text-sm text-muted">
          Content curation, AI tailoring, template design and PDF export all
          happen in the full editor.
        </p>
        <Button className="mt-3" onClick={() => navigate(`/jobs/${jobId}/resume`)}>
          Open the resume editor
        </Button>
      </Card>
    </div>
  );
}

/**
 * Review stage: the exact exported PDF is inspected here with a checklist.
 */
export function ReviewStage({ jobId }: { jobId: number }) {
  const [artifact, setArtifact] = useState<PdfArtifact | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const a = await ipc.getPdfArtifact(jobId);
        if (!cancelled) setArtifact(a);
      } catch (e) {
        toast.error(String(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!loaded) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <StatusLine
        state={artifact ? "current" : "draft"}
        detail={
          artifact
            ? `${artifact.pageCount ?? "?"} page(s) · ${artifact.compiledAt ?? "unknown"}`
            : "export the PDF first"
        }
      />
      {artifact ? (
        <Card className="overflow-hidden p-0">
          <PdfViewer jobId={jobId} className="min-h-[500px]" />
        </Card>
      ) : (
        <Card className="p-8 text-center text-sm text-muted">
          No PDF yet — compile one in the Resume stage first.
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 · Interview — grounded prep for this exact job
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: { key: InterviewCategory; label: string; color: string }[] = [
  { key: "weak_area", label: "Weak areas — prepare an answer", color: "text-warn" },
  { key: "project_deep_dive", label: "Project deep-dives", color: "text-kairo-blue" },
  { key: "technical_skill", label: "Technical questions", color: "text-kairo-violet" },
  { key: "responsibility", label: "Behavioral / responsibility", color: "text-sky-700" },
  { key: "resume_question", label: "Resume questions", color: "text-muted" },
];

export function InterviewTab({ jobId }: { jobId: number }) {
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPrep(null);
    setLoaded(false);
    void (async () => {
      try {
        // A stored prep comes back immediately; regenerating is explicit.
        const existing = await ipc.generateInterviewPrep(jobId);
        if (!cancelled) setPrep(existing);
      } catch {
        // No prep yet — show the empty state; generation stays explicit.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const generate = async () => {
    setLoading(true);
    try {
      setPrep(await ipc.generateInterviewPrep(jobId));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const grouped = useMemo(() => {
    if (!prep) return [];
    return CATEGORY_ORDER.map((meta) => ({
      ...meta,
      items: prep.questions.filter((q) => q.category === meta.key),
    })).filter((g) => g.items.length > 0);
  }, [prep]);

  if (!loaded) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!prep) {
    return (
      <Card className="p-8 text-center">
        <h3 className="text-base font-semibold text-ink">Interview prep for this role</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Questions come only from this job's description, the resume you sent, your proof and the
          match gaps — every question shows why it's asked and which proof backs the answer.
        </p>
        <div className="mt-5">
          <Button onClick={() => void generate()} disabled={loading}>
            {loading ? "Generating…" : "Generate prep"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Grounded in this job's JD, your requirements, resume and match gaps.
        </p>
        <Button size="sm" variant="secondary" onClick={() => void generate()} disabled={loading}>
          {loading ? "Generating…" : "Regenerate"}
        </Button>
      </div>

      <Card className="p-6">
        <CardTitle>Inputs used</CardTitle>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg border border-line bg-card px-3 py-1.5 text-ink">
            JD: {prep.inputs.rawJdChars} chars stored
          </span>
          <span className="rounded-lg border border-line bg-card px-3 py-1.5 text-ink">
            {prep.inputs.requirementCount} requirements
          </span>
          <span className="rounded-lg border border-line bg-card px-3 py-1.5 text-ink">
            {prep.inputs.planBulletCount} resume bullets
          </span>
          <span
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              prep.inputs.gapCount > 0
                ? "bg-warn-soft text-warn dark:text-kairo-dawn"
                : "bg-ok-soft text-ok dark:text-emerald-300"
            }`}
          >
            {prep.inputs.gapCount} match gaps
          </span>
          <span className="rounded-lg border border-line bg-card px-3 py-1.5 text-ink">
            {prep.inputs.evidenceCount} evidence records
          </span>
        </div>
      </Card>

      {grouped.map((group) => (
        <div key={group.key}>
          <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${group.color}`}>
            {group.label} · {group.items.length}
          </h3>
          <div className="space-y-2">
            {group.items.map((q, i) => (
              <Card key={i} className="p-4">
                <p className="text-sm leading-relaxed text-ink">{q.question}</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted/90">
                  <span className="font-medium text-muted">Why asked:</span> {q.why}
                </p>
                {q.evidenceRefs.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {q.evidenceRefs.map((ref, j) => (
                      <Badge key={j} tone="green">
                        <ShieldCheck className="size-3" /> {ref}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6 · Application — what was sent, and what happened
// ---------------------------------------------------------------------------

export function ApplicationTab({ job }: { job: Job }) {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setApplications(await ipc.listApplications());
      } catch (e) {
        toast.error(String(e));
        setApplications([]);
      }
    })();
  }, [job.id]);

  const linked = (applications ?? []).filter((a) => a.jobId === job.id);

  const track = async () => {
    setTracking(true);
    try {
      const created = await ipc.createApplication({
        id: 0,
        jobId: job.id,
        resumeVersionId: null,
        company: job.company,
        role: job.roleTitle,
        url: job.url,
        status: "wishlist",
        appliedDate: null,
        nextAction: "",
        notes: "",
      });
      toast.ok("Application tracked — update it as you progress.");
      navigate("/applications");
      void created;
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTracking(false);
    }
  };

  if (applications === null) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Applications for this role</CardTitle>
            <p className="mt-1 text-xs text-muted">
              What you sent (which version) and what happened next.
            </p>
          </div>
          {linked.length === 0 ? (
            <Button onClick={() => void track()} disabled={tracking}>
              {tracking ? "Tracking…" : "Track this application"}
            </Button>
          ) : null}
        </div>

        {linked.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-xs text-muted">
            Not tracked yet — “Track this application” creates one for {job.roleTitle || "this role"}
            {job.company ? ` at ${job.company}` : ""} and links it to this workspace.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {linked.map((a) => (
              <li key={a.id} className="rounded-lg border border-line p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">
                    {a.role || job.roleTitle}
                    {a.company ? <span className="text-muted"> · {a.company}</span> : null}
                  </span>
                  <Badge tone={a.status === "applied" || a.status === "interview" ? "blue" : "neutral"}>
                    {a.status}
                  </Badge>
                </div>
                {a.nextAction ? (
                  <p className="mt-1 text-xs text-muted">Next: {a.nextAction}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <button
        type="button"
        className="text-[11px] text-muted hover:text-ink"
        onClick={() => navigate("/applications")}
      >
        Open all applications
      </button>
    </div>
  );
}
