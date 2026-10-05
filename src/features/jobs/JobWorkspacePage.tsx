import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { StepNav, type StepStatus } from "../../components/ui/ds";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Feedback";
import { Field, Input, Select } from "../../components/ui/inputs";
import { JOB_REQUIREMENT_KINDS } from "../../lib/types";
import { ipc } from "../../lib/ipc";
import { scrollMainToTop } from "../../lib/dom";
import type {
  Job,
  EvidenceSelection,
  JobRequirement,
  JobRequirementKind,
  MatchReport,
} from "../../lib/types";
import { useJobsStore } from "../../stores/jobsStore";
import { toast } from "../../stores/toastStore";
import { ApplicationTab, InterviewTab, ReviewStage, ResumeStep } from "./workspaceSteps";
import { MatchTab } from "./MatchTab";

const KIND_LABELS: Record<JobRequirementKind, string> = {
  required_skill: "Required skills",
  preferred_skill: "Preferred skills",
  responsibility: "Responsibilities",
};

const KIND_ORDER: JobRequirementKind[] = ["required_skill", "preferred_skill", "responsibility"];
const EMPTY_SELECTIONS: EvidenceSelection[] = [];

type WorkspaceTab = "role" | "evidence" | "resume" | "review" | "applied";

const TAB_META: { key: WorkspaceTab; label: string; hint: string }[] = [
  { key: "role", label: "Role", hint: "The posting and its requirements" },
  { key: "evidence", label: "Evidence", hint: "Where your proof stands" },
  { key: "resume", label: "Resume", hint: "Plan, tailor, export" },
  { key: "review", label: "Review", hint: "Inspect the exact PDF" },
  { key: "applied", label: "Applied", hint: "Track what you sent" },
];

export default function JobWorkspacePage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const id = Number(jobId);

  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("role");
  const loadRequirements = useJobsStore((s) => s.loadRequirements);
  const requirements = useJobsStore((s) => s.reqCache[id]) ?? [];
  // Saved state the statuses derive from — everything below is persisted
  // truth, never "the user visited the tab".
  const report = useJobsStore((s) => s.matchCache[id] ?? null);
  const matchStale = useJobsStore((s) => s.matchStaleCache[id] ?? false);
  const selections = useJobsStore((s) => s.selectionCache[id] ?? EMPTY_SELECTIONS);
  const pdfStatus = useJobsStore((s) => s.pdfStatusCache[id] ?? null);
  const applications = useJobsStore((s) => s.applications ?? null);

  const loadSeq = useRef(0);
  useEffect(() => {
    const seq = ++loadSeq.current;
    void (async () => {
      try {
        const job = await ipcGetJob(id);
        if (seq !== loadSeq.current) return;
        setJob(job);
        // Resume in the stage the user left — saved on the job row.
        const stage = job.activeStage as WorkspaceTab | undefined;
        if (stage && TAB_META.some((t) => t.key === stage)) setTab(stage);
        await loadRequirements(id);
        if (seq !== loadSeq.current) return;
        const [report, stale, sel, pdf, apps] = await Promise.all([
          ipcGetMatch(id).catch(() => null),
          ipc.isMatchStale(id).catch(() => false),
          ipc.listEvidenceSelections(id).catch(() => []),
          ipc.getPdfStatus(id).catch(() => null),
          ipc.listApplications().catch(() => []),
        ]);
        if (seq !== loadSeq.current) return;
        useJobsStore.setState((s) => ({
          matchCache: { ...s.matchCache, [id]: report },
          matchStaleCache: { ...s.matchStaleCache, [id]: stale },
          selectionCache: { ...s.selectionCache, [id]: sel },
          pdfStatusCache: { ...s.pdfStatusCache, [id]: pdf },
          applications: apps,
        }));
      } catch (e) {
        if (seq === loadSeq.current) setError(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const changeStage = (key: WorkspaceTab) => {
    setTab(key);
    // Persist the exit point — navigation never implies completion.
    void ipc
      .setJobActiveStage(id, key)
      .then(() => {
        setJob((prev) => (prev ? { ...prev, activeStage: key } : prev));
      })
      .catch(() => {});
    // Stage bodies differ wildly in height — never land mid-page.
    scrollMainToTop();
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Card className="p-6">
          <p className="text-sm text-bad">{error}</p>
          <Link to="/jobs" className="mt-3 inline-block text-xs text-kairo-blue hover:underline">
            Back to jobs
          </Link>
        </Card>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="mt-4 h-6 w-52" />
        <Skeleton className="mt-6 h-11 w-full" />
        <Skeleton className="mt-6 h-48 w-full" />
      </div>
    );
  }

  const counts: Record<JobRequirementKind, number> = {
    required_skill: requirements.filter((r) => r.kind === "required_skill").length,
    preferred_skill: requirements.filter((r) => r.kind === "preferred_skill").length,
    responsibility: requirements.filter((r) => r.kind === "responsibility").length,
  };

  // A general resume has no posting — the posting-centric stages don't exist.
  const isGeneral = job.kind === "general";
  const tabs = TAB_META.filter((t) => !(isGeneral && t.key === "evidence"));

  // Stage statuses derive from SAVED state only — visiting a stage never
  // completes it. The action text is the specific next step for the stage.
  const confirmedRequirements = requirements.filter((r) => r.userConfirmed);
  const nonMissing = (report?.results ?? []).filter((r) => r.coverage !== "missing");
  const missingCount = (report?.results ?? []).filter((r) => r.coverage === "missing").length;
  const decidedForRequirement = (requirementId: number) =>
    selections.some((s) => s.requirementId === requirementId);
  const undecidedCount = nonMissing.filter((r) => !decidedForRequirement(r.requirementId)).length;
  const reviewed = pdfStatus?.state === "current" && pdfStatus.pdfHash != null && pdfStatus.reviewedPdfHash === pdfStatus.pdfHash;
  const linkedApplications = (applications ?? []).filter((a) => a.jobId === job.id);

  const stageStatus: Record<WorkspaceTab, { status: StepStatus; action: string }> = {
    role: isGeneral
      ? { status: "complete", action: "" }
      : requirements.length === 0
        ? { status: "not-started", action: "Confirm the requirements from the posting" }
        : confirmedRequirements.length < requirements.length
          ? {
              status: "in-progress",
              action: `Confirm ${requirements.length - confirmedRequirements.length} more requirement(s)`,
            }
          : { status: "complete", action: "" },
    evidence: !report
      ? { status: "not-started", action: "Run the match to see your proof" }
      : matchStale
        ? { status: "needs-attention", action: "Requirements or facts changed — re-run the match" }
        : undecidedCount > 0
          ? {
              status: "in-progress",
              action: `Decide on ${undecidedCount} requirement(s) with supporting records`,
            }
          : missingCount > 0
            ? { status: "needs-attention", action: `${missingCount} requirement(s) still have no supporting record; add proof or proceed with an honest gap` }
            : { status: "complete", action: "" },
    resume:
      pdfStatus == null || pdfStatus.state === "none"
        ? { status: "not-started", action: "Compose the resume and export a PDF" }
        : pdfStatus.state === "current"
          ? { status: "complete", action: "" }
          : { status: "needs-attention", action: "The PDF is out of date — export to refresh it" },
    review:
      pdfStatus == null || pdfStatus.state === "none"
        ? { status: "not-started", action: "Export a PDF first" }
        : pdfStatus.state !== "current"
          ? { status: "needs-attention", action: "The PDF changed — re-export, then review it" }
          : reviewed
            ? { status: "complete", action: "" }
            : { status: "in-progress", action: "Look through the PDF, then mark it reviewed" },
    applied:
      linkedApplications.length > 0
        ? { status: "complete", action: "" }
        : (pdfStatus?.pdfHash ?? null) != null
          ? { status: "in-progress", action: "Track the application with the version you sent" }
          : { status: "not-started", action: "Export a PDF, then track the application" },
  };

  const activeStage = stageStatus[tab];
  const hint = activeStage.action
    ? `Next: ${activeStage.action}`
    : TAB_META.find((t) => t.key === tab)?.hint;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl bg-[#0B1020] p-7 text-white shadow-float sm:p-9">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-kairo-blue/25 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-kairo-sky">{isGeneral ? "General resume" : "Role workspace"}</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{job.roleTitle || "Untitled role"}</h1>
            {job.company ? <p className="mt-1 text-base text-slate-300">{job.company}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2">
              {job.seniority ? <Badge tone="violet">{job.seniority}</Badge> : null}
              {job.domain ? <Badge tone="sky">{job.domain}</Badge> : null}
              {!isGeneral ? <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-200">{confirmedRequirements.length} of {requirements.length} requirements confirmed</span> : null}
              {pdfStatus?.state === "current" ? <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">PDF ready</span> : null}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate("/jobs")}>All workspaces</Button>
        </div>
        <p className="relative mt-7 border-t border-white/10 pt-5 text-sm text-slate-300">
          {activeStage.action ? `Next in ${TAB_META.find((t) => t.key === tab)?.label}: ${activeStage.action}` : "Your progress is saved. Continue with any stage below."}
        </p>
      </header>

      <div>
        <StepNav
          steps={tabs.map((t) => ({
            key: t.key,
            label: t.label,
            status: stageStatus[t.key].status,
            action: stageStatus[t.key].action,
          }))}
          active={tab}
          onChange={changeStage}
          hint={hint}
        />
      </div>

      {tab === "role" ? (
        <>
          <OverviewTab job={job} counts={counts} />
          {!isGeneral ? (
            <div className="mt-6">
              <RequirementsTab job={job} />
            </div>
          ) : null}
        </>
      ) : null}
      {tab === "evidence" ? <MatchTab jobId={job.id} domain={job.domain} /> : null}
      {tab === "resume" ? <ResumeStep jobId={job.id} /> : null}
      {tab === "review" ? <ReviewStage jobId={job.id} /> : null}
      {tab === "applied" ? (
        <>
          <ApplicationTab job={job} />
          <div className="mt-6">
            <InterviewTab jobId={job.id} />
          </div>
        </>
      ) : null}
    </div>
  );
}

async function ipcGetJob(id: number): Promise<Job> {
  const { ipc } = await import("../../lib/ipc");
  return ipc.getJob(id);
}

async function ipcGetMatch(id: number): Promise<MatchReport | null> {
  const { ipc } = await import("../../lib/ipc");
  return ipc.getMatch(id);
}

/** One honest line per requirement: which records support it, and why. */
function RequirementSupport({
  support,
}: {
  support: MatchReport["results"][number] | null;
}) {
  if (!support) {
    return (
      <p className="mt-1 text-xs text-muted/80">
        No match computed yet — run step 3 to see which records support this.
      </p>
    );
  }
  if (support.entityRefs.length === 0) {
    return (
      <p className="mt-1 text-xs text-muted/80">
        {support.coverage === "missing"
          ? "Nothing in your Vault supports this yet — no fabrication; close the gap or address it in interviews."
          : support.explanation}
      </p>
    );
  }
  return (
    <div className="mt-1.5 space-y-0.5">
      {support.entityRefs.slice(0, 2).map((ref, i) => (
        <p key={i} className="text-xs text-muted/90">
          <span className="font-medium text-ink/80">{ref.title}</span> — {ref.contribution}
        </p>
      ))}
    </div>
  );
}

function OverviewTab({
  job,
  counts,
}: {
  job: Job;
  counts: Record<JobRequirementKind, number>;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const isGeneral = job.kind === "general";
  return (
    <div className="space-y-5">
      <Card className="p-6">
        <CardTitle>Position</CardTitle>
        <dl className="mt-3 divide-y divide-line">
          <Row label="Role" value={job.roleTitle || "—"} />
          <Row label="Company" value={job.company || "—"} />
          <Row label="Seniority" value={job.seniority || "Unspecified"} />
          <Row label="Domain" value={job.domain || "Unspecified"} />
          <Row
            label="Posting"
            value={
              job.url ? (
                <a href={job.url} target="_blank" rel="noreferrer" className="text-kairo-blue hover:underline">
                  {job.url}
                </a>
              ) : (
                "—"
              )
            }
          />
        </dl>
      </Card>

      {!isGeneral ? (
        <>
          <Card className="p-6">
            <CardTitle>What this role asks for</CardTitle>
            <p className="mt-2 text-xs text-muted">
              Review these requirements before comparing them with your experience.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {KIND_ORDER.map((kind) => (
                <span
                  key={kind}
                  className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs text-ink"
                >
                  {KIND_LABELS[kind]}: <strong>{counts[kind]}</strong>
                </span>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <CardTitle>Raw job description</CardTitle>
              <Button size="sm" variant="secondary" onClick={() => setShowRaw(!showRaw)}>
                {showRaw ? "Hide" : "Show"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">
              Stored verbatim at workspace creation — this is the exact text the requirement model
              was extracted from.
            </p>
            {showRaw ? (
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-accent-soft p-3 font-mono text-xs leading-relaxed text-muted">
                {job.rawJd}
              </pre>
            ) : null}
          </Card>
        </>
      ) : (
        <Card className="p-6 text-sm leading-relaxed text-muted">
          This workspace holds a general resume — no posting, no requirement matching. Compose and
          export from the Resume stage; tailor it per job any time by creating a role workspace.
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-xs">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="break-all text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

function RequirementsTab({ job }: { job: Job }) {
  const requirements = useJobsStore((s) => s.reqCache[job.id]) ?? [];
  const addRequirement = useJobsStore((s) => s.addRequirement);
  const updateRequirement = useJobsStore((s) => s.updateRequirement);
  const deleteRequirement = useJobsStore((s) => s.deleteRequirement);
  const loadRequirements = useJobsStore((s) => s.loadRequirements);
  // The stored report says which records support each requirement — the
  // "why" behind every match, shown right where the user confirms it.
  const [report, setReport] = useState<MatchReport | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await ipcGetMatch(job.id);
        if (!cancelled) setReport(stored);
      } catch {
        if (!cancelled) setReport(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  const supportFor = (reqId: number) =>
    report?.results.find((r) => r.requirementId === reqId) ?? null;

  const [editingId, setEditingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reqToRemove, setReqToRemove] = useState<JobRequirement | null>(null);

  const reExtract = async () => {
    setRefreshing(true);
    try {
      await loadRequirements(job.id);
    } finally {
      setRefreshing(false);
    }
  };

  const rows: { kind: JobRequirementKind; items: JobRequirement[] }[] = KIND_ORDER.map((kind) => ({
    kind,
    items: requirements.filter((r) => r.kind === kind),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Add, reword, reclassify, or remove requirements. Kairo compares your experience with this exact list.
        </p>
        <Button size="sm" variant="secondary" onClick={() => void reExtract()} disabled={refreshing}>
          {refreshing ? "Reloading…" : "Reload"}
        </Button>
      </div>

      {rows.map(({ kind, items }) => (
        <div key={kind}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {KIND_LABELS[kind]} <span className="font-normal text-muted/70">· {items.length}</span>
            </h4>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void (async () => {
                  try {
                    const created = await addRequirement({
                      id: 0,
                      jobId: job.id,
                      kind,
                      rawText: "",
                      normalizedKey: "",
                      importance: kind === "required_skill" ? 0.8 : kind === "preferred_skill" ? 0.4 : 0.6,
                      userConfirmed: true,
                    });
                    // Open the editor immediately — an empty requirement must
                    // not linger in the DB unedited.
                    setEditingId(created.id);
                  } catch (e) {
                    toast.error(String(e));
                  }
                })()
              }
            >
              + Add
            </Button>
          </div>
          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-center text-xs text-muted">
              None in this category.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((req) => (
                <li key={req.id} className="rounded-lg border border-line bg-card p-3.5">
                  {editingId === req.id ? (
                    <RequirementEditRow
                      requirement={req}
                      onDone={async (saved) => {
                        if (saved) {
                          try {
                            await updateRequirement(saved);
                          } catch (e) {
                            toast.error(String(e));
                          }
                        }
                        setEditingId(null);
                      }}
                    />
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-ink">
                          {req.rawText || <span className="text-bad">empty requirement</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-muted/90">
                          importance {Math.round(req.importance * 100)}%
                          {req.userConfirmed ? " · user-confirmed" : " · unconfirmed"}
                        </p>
                        <RequirementSupport support={supportFor(req.id)} />
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(req.id)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-bad hover:bg-bad-soft dark:hover:bg-bad/10 dark:text-red-400"
                          onClick={() => setReqToRemove(req)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {requirements.length === 0 ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn dark:text-kairo-dawn">
          No requirements yet — add them manually or recreate the workspace with the JD text.
        </p>
      ) : null}

      <ConfirmDialog
        open={reqToRemove !== null}
        title="Remove requirement"
        message={`Remove "${reqToRemove?.rawText ?? ""}"? Match scoring and the composer stop using it immediately — re-add it if that wasn't intended.`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (!reqToRemove) return;
          void (async () => {
            try {
              await deleteRequirement(job.id, reqToRemove.id);
              toast.ok("Requirement removed");
            } catch (e) {
              toast.error(String(e));
            }
          })();
        }}
        onClose={() => setReqToRemove(null)}
      />
    </div>
  );
}

function RequirementEditRow({
  requirement,
  onDone,
}: {
  requirement: JobRequirement;
  onDone: (saved: JobRequirement | null) => Promise<void>;
}) {
  const [kind, setKind] = useState<JobRequirementKind>(requirement.kind);
  const [rawText, setRawText] = useState(requirement.rawText);
  const [importance, setImportance] = useState(requirement.importance);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!rawText.trim()) {
      setError("Text is required");
      return;
    }
    await onDone({
      ...requirement,
      kind,
      rawText: rawText.trim(),
      normalizedKey: rawText.trim().toLowerCase(),
      importance,
      userConfirmed: true,
    });
  };

  return (
    <div className="space-y-2">
      <Field label="Requirement text" error={error ?? undefined}>
        <Input
          autoFocus
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            setError(null);
          }}
        />
      </Field>
      <div className="flex items-end gap-2">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as JobRequirementKind)} className="w-40">
            {JOB_REQUIREMENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Importance">
          <Select
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}
            className="w-32"
          >
            <option value={0.2}>Low</option>
            <option value={0.4}>Nice to have</option>
            <option value={0.6}>Standard</option>
            <option value={0.8}>High</option>
            <option value={1.0}>Critical</option>
          </Select>
        </Field>
        <div className="flex gap-2 pb-0.5">
          <Button size="sm" onClick={() => void save()}>
            Save
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void onDone(null)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
