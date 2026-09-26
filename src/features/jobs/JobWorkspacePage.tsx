import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Tabs } from "../../components/ui/Tabs";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Feedback";
import { Field, Input, Select } from "../../components/ui/inputs";
import { JOB_REQUIREMENT_KINDS } from "../../lib/types";
import { scrollMainToTop } from "../../lib/dom";
import type { Job, JobRequirement, JobRequirementKind } from "../../lib/types";
import { useJobsStore } from "../../stores/jobsStore";
import { toast } from "../../stores/toastStore";
import { MatchTab } from "./MatchTab";
import { PlanTab } from "./PlanTab";
import { TailorTab } from "./TailorTab";
import { ResumeTab } from "./ResumeTab";

const KIND_LABELS: Record<JobRequirementKind, string> = {
  required_skill: "Required skills",
  preferred_skill: "Preferred skills",
  responsibility: "Responsibilities",
};

const KIND_ORDER: JobRequirementKind[] = ["required_skill", "preferred_skill", "responsibility"];

type WorkspaceTab = "overview" | "requirements" | "match" | "plan" | "tailor" | "resume";

const TAB_META: { key: WorkspaceTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "requirements", label: "Requirements" },
  { key: "match", label: "Match" },
  { key: "plan", label: "Plan" },
  { key: "tailor", label: "Tailor" },
  { key: "resume", label: "Resume" },
];

export default function JobWorkspacePage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const id = Number(jobId);

  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const loadRequirements = useJobsStore((s) => s.loadRequirements);
  const requirements = useJobsStore((s) => s.reqCache[id]) ?? [];

  const loadSeq = useRef(0);
  useEffect(() => {
    const seq = ++loadSeq.current;
    void (async () => {
      try {
        const job = await ipcGetJob(id);
        if (seq !== loadSeq.current) return;
        setJob(job);
        await loadRequirements(id);
      } catch (e) {
        if (seq === loadSeq.current) setError(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {job.roleTitle || "Untitled role"}
            {job.company ? <span className="text-muted"> · {job.company}</span> : null}
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {job.seniority ? <Badge tone="violet">{job.seniority}</Badge> : null}
            {job.domain ? <Badge tone="sky">{job.domain}</Badge> : null}
            <Badge tone={job.requirementCount > 0 ? "green" : "amber"}>
              {job.requirementCount} requirements reviewed
            </Badge>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => navigate("/jobs")}>
          All jobs
        </Button>
      </div>

      <div className="mb-6">
        <Tabs
          tabs={TAB_META.map((t) => ({ id: t.key, label: t.label }))}
          active={tab}
          onChange={(id) => {
            setTab(id as WorkspaceTab);
            // Tab bodies differ wildly in height — never land mid-page.
            scrollMainToTop();
          }}
          className="flex-wrap"
        />
      </div>

      {tab === "overview" ? <OverviewTab job={job} counts={counts} /> : null}
      {tab === "requirements" ? <RequirementsTab job={job} /> : null}
      {tab === "match" ? <MatchTab jobId={job.id} domain={job.domain} /> : null}
      {tab === "plan" ? <PlanTab jobId={job.id} /> : null}
      {tab === "tailor" ? <TailorTab jobId={job.id} onComposePlan={() => setTab("plan")} /> : null}
      {tab === "resume" ? <ResumeTab jobId={job.id} /> : null}
    </div>
  );
}

async function ipcGetJob(id: number): Promise<Job> {
  const { ipc } = await import("../../lib/ipc");
  return ipc.getJob(id);
}

function OverviewTab({
  job,
  counts,
}: {
  job: Job;
  counts: Record<JobRequirementKind, number>;
}) {
  const [showRaw, setShowRaw] = useState(false);
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

      <Card className="p-6">
        <CardTitle>Requirement model</CardTitle>
        <p className="mt-2 text-xs text-muted">
          Matching runs against this reviewed set — correct anything before Phase 5.
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
          Stored verbatim at workspace creation — this is the exact text the requirement model was
          extracted from.
        </p>
        {showRaw ? (
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-accent-soft p-3 font-mono text-[11px] leading-relaxed text-muted">
            {job.rawJd}
          </pre>
        ) : null}
      </Card>
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

  const [editingId, setEditingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
          Every requirement is user-confirmed. Add, reword, re-classify or remove lines — matching
          (Phase 5) runs on exactly this list.
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
                        <p className="mt-0.5 text-[11px] text-muted/90">
                          importance {Math.round(req.importance * 100)}%
                          {req.userConfirmed ? " · user-confirmed" : " · unconfirmed"}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(req.id)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-bad hover:bg-bad-soft dark:hover:bg-bad/10 dark:text-red-400"
                          onClick={() => {
                            void (async () => {
                              try {
                                await deleteRequirement(job.id, req.id);
                                toast.ok("Requirement removed");
                              } catch (e) {
                                toast.error(String(e));
                              }
                            })();
                          }}
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
