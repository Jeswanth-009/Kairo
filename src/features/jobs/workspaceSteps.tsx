import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Feedback";
import { ipc } from "../../lib/ipc";
import { StatusLine, type DocState } from "../../components/ui/ds";
import { PdfViewer } from "../resume-studio/PdfViewer";
import type { PdfStatusView, Profile } from "../../lib/types";
import type { Application, InterviewCategory, InterviewPrep, Job } from "../../lib/types";
import { toast } from "../../stores/toastStore";

/**
 * Step 4 · Resume — a gateway into the job-scoped editor. The full editing
 * experience (content curation, tailoring, export) lives in the editor at
 * /jobs/:jobId/resume; this stage shows the current state and opens it.
 */
export function ResumeStep({ jobId }: { jobId: number }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PdfStatusView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await ipc.getPdfStatus(jobId);
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!loaded) return <Skeleton className="h-40 w-full" />;

  const state: DocState =
    status == null || status.state === "none"
      ? "draft"
      : status.state === "current"
        ? "current"
        : "needs-update";

  return (
    <div className="space-y-4">
      <StatusLine
        state={state}
        detail={
          status && status.state !== "none" ? `${status.pageCount ?? "?"} page(s)` : "no PDF yet"
        }
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
 * Review stage: the exact exported PDF with the checklist that gives
 * "reviewed" a durable meaning — the artifact's hash is what gets marked,
 * so any later compile or edit shows up as needs-review again.
 */
export function ReviewStage({ jobId }: { jobId: number }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PdfStatusView | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [importedUnreviewed, setImportedUnreviewed] = useState(0);
  const [targetPages, setTargetPages] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [marking, setMarking] = useState(false);

  const refresh = (cancelled: () => boolean = () => false) =>
    void (async () => {
      try {
        const [s, prof, onboarding, plan] = await Promise.all([
          ipc.getPdfStatus(jobId),
          ipc.getProfile().catch(() => null),
          ipc.getOnboardingStatus().catch(() => null),
          ipc.getPlan(jobId).catch(() => null),
        ]);
        if (cancelled()) return;
        setStatus(s);
        setProfile(prof);
        setImportedUnreviewed(onboarding?.importedUnreviewed ?? 0);
        setTargetPages(plan?.config.targetPages ?? null);
        setWarnings(plan?.plan.warnings ?? []);
      } finally {
        if (!cancelled()) setLoaded(true);
      }
    })();

  useEffect(() => {
    let cancelled = false;
    refresh(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const markReviewed = async () => {
    setMarking(true);
    try {
      await ipc.markArtifactReviewed(jobId);
      refresh();
      toast.ok("Marked reviewed — this exact PDF is what you checked.");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setMarking(false);
    }
  };

  if (!loaded) return <Skeleton className="h-64 w-full" />;

  const hasArtifact = status != null && status.state !== "none";
  const state: DocState = !hasArtifact
    ? "draft"
    : status.state === "current"
      ? "current"
      : status.state === "missing-file"
        ? "export-failed"
        : "needs-update";
  const reviewed = status?.pdfHash != null && status.reviewedPdfHash === status.pdfHash;
  const overflow =
    status?.pageCount != null && targetPages != null && status.pageCount > targetPages;
  const missingContact = !profile?.fullName || !profile.email;

  const checks: { ok: boolean; label: string }[] = hasArtifact
    ? [
        {
          ok: status.state === "current",
          label:
            status.state === "current"
              ? `Saved draft and PDF match (${status.pageCount ?? "?"} page(s))`
              : status.state === "missing-file"
                ? "The PDF file is missing on disk — re-export"
                : "The saved draft changed after this export — re-export",
        },
        {
          ok: !overflow,
          label: overflow
            ? `${status.pageCount} page(s) — more than the ${targetPages}-page target`
            : `Page count fits the ${targetPages ?? 1}-page target`,
        },
        {
          ok: !missingContact,
          label: missingContact
            ? "Contact details incomplete — add your name and email in My story"
            : "Contact details complete",
        },
        {
          ok: importedUnreviewed === 0,
          label:
            importedUnreviewed === 0
              ? "No imported records waiting for verification"
              : `${importedUnreviewed} imported record(s) not yet verified`,
        },
        {
          ok: warnings.length === 0,
          label: warnings.length === 0 ? "No composer warnings" : warnings[0],
        },
        {
          ok: reviewed,
          label: reviewed
            ? `Reviewed by you${status?.reviewedAt ? ` · ${status.reviewedAt}` : ""}`
            : "Not reviewed yet — look through the PDF below, then mark it",
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <StatusLine
        state={state}
        detail={
          hasArtifact
            ? `${status?.pageCount ?? "?"} page(s) · compiled ${status?.compiledAt ?? "unknown"}`
            : "export the PDF first"
        }
        actions={
          hasArtifact ? (
            reviewed ? (
              <span className="flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok dark:bg-ok/15 dark:text-emerald-300">
                <Check className="size-3.5" /> Reviewed
              </span>
            ) : (
              <Button size="sm" onClick={() => void markReviewed()} disabled={marking}>
                {marking ? "Marking…" : "Mark this PDF reviewed"}
              </Button>
            )
          ) : (
            <Button size="sm" onClick={() => navigate(`/jobs/${jobId}/resume`)}>
              Open editor
            </Button>
          )
        }
      />

      {hasArtifact ? (
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Review checklist
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                {c.ok ? (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
                ) : (
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
                )}
                <span className={c.ok ? "text-muted" : "font-medium text-ink"}>{c.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            “Reviewed” refers to this exact file — its hash is recorded. Any new export or draft
            edit resets it, so a version can only freeze a PDF you actually looked at.
          </p>
        </Card>
      ) : null}

      {hasArtifact ? (
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
                <p className="mt-1.5 text-xs leading-relaxed text-muted/90">
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
  const [versions, setVersions] = useState<{ id: number; versionNumber: number }[]>([]);
  const [tracking, setTracking] = useState(false);
  // The version actually sent is the user's call — never assumed to be the
  // newest one. Defaults to the newest, but every track names its version.
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [apps, vers] = await Promise.all([
          ipc.listApplications(),
          ipc.listResumeVersions(job.id).catch(() => []),
        ]);
        setApplications(apps);
        const sorted = [...vers].sort((a, b) => b.versionNumber - a.versionNumber);
        setVersions(sorted);
        setSelectedVersion(sorted[0]?.id ?? null);
      } catch (e) {
        toast.error(String(e));
        setApplications([]);
      }
    })();
  }, [job.id]);

  const linked = (applications ?? []).filter((a) => a.jobId === job.id);

  const track = async (versionId: number | null) => {
    setTracking(true);
    try {
      const created = await ipc.createApplication({
        id: 0,
        jobId: job.id,
        resumeVersionId: versionId,
        company: job.company,
        role: job.roleTitle,
        url: job.url,
        status: "applied",
        appliedDate: new Date().toISOString().slice(0, 10),
        nextAction: "",
        notes: versionId ? `Sent version ${versions.find((v) => v.id === versionId)?.versionNumber ?? "?"}` : "",
      });
      toast.ok(
        versionId
          ? "Application tracked with the selected resume version."
          : "Application tracked — link a resume version when you send it.",
      );
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
          {linked.length === 0 && versions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted" htmlFor="sent-version">
                Sent version
              </label>
              <select
                id="sent-version"
                value={selectedVersion ?? ""}
                onChange={(e) => setSelectedVersion(Number(e.target.value))}
                className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs text-ink"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber}
                  </option>
                ))}
              </select>
              <Button onClick={() => void track(selectedVersion)} disabled={tracking}>
                {tracking ? "Tracking…" : "Track application"}
              </Button>
            </div>
          ) : linked.length === 0 ? (
            <Button onClick={() => void track(null)} disabled={tracking}>
              {tracking ? "Tracking…" : "Track without a version"}
            </Button>
          ) : null}
        </div>

        {linked.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-xs text-muted">
            {versions.length === 0
              ? "Not tracked yet — save a version in the editor first, then track it here."
              : "Not tracked yet — pick the exact version you sent above; nothing is assumed."}
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
                {a.resumeVersionId ? (
                  <p className="mt-0.5 text-xs text-muted">
                    Sent: version #{versions.find((v) => v.id === a.resumeVersionId)?.versionNumber ?? a.resumeVersionId}
                  </p>
                ) : null}
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
        className="text-[13px] text-muted hover:text-ink"
        onClick={() => navigate("/applications")}
      >
        Open all applications
      </button>
    </div>
  );
}
