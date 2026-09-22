import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/inputs";
import { MessagesSquare, ShieldCheck } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Feedback";
import { ipc } from "../../lib/ipc";
import type { InterviewCategory, InterviewPrep, Job } from "../../lib/types";
import { toast } from "../../stores/toastStore";

const CATEGORY_ORDER: { key: InterviewCategory; label: string; color: string }[] = [
  { key: "weak_area", label: "Weak areas — prepare an answer", color: "text-warn" },
  { key: "project_deep_dive", label: "Project deep-dives", color: "text-kairo-blue" },
  { key: "technical_skill", label: "Technical questions", color: "text-kairo-violet" },
  { key: "responsibility", label: "Behavioral / responsibility", color: "text-sky-700" },
  { key: "resume_question", label: "Resume questions", color: "text-muted" },
];

export default function InterviewPrepPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const jobs = await ipc.listJobs();
        setJobs(jobs);
        if (jobs.length > 0) setJobId(jobs[0].id);
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const generate = async () => {
    if (jobId === null) return;
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

  return (
    <div className="mx-auto max-w-4xl p-8">
      <PageHeader
        title="Interview Prep"
        description="Questions generated only from the exact JD, your submitted resume, your evidence and the match gaps — no invented company-specific patterns."
        actions={
          jobs.length > 0 ? (
            <div className="flex items-center gap-2">
              <Select
                value={jobId ?? undefined}
                onChange={(e) => {
                  setJobId(Number(e.target.value));
                  setPrep(null);
                }}
                className="w-64"
              >
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.roleTitle || "Untitled role"}
                    {job.company ? ` · ${job.company}` : ""}
                  </option>
                ))}
              </Select>
              <Button onClick={() => void generate()} disabled={loading}>
                {loading ? "Generating…" : prep ? "Regenerate" : "Generate prep"}
              </Button>
            </div>
          ) : null
        }
      />

      {!loaded ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare className="size-6" />}
          title="No job workspaces yet"
          description="Paste a job description on the Jobs page first, then come back to generate grounded interview prep."
        >
          <Button onClick={() => navigate("/jobs")}>Go to Jobs</Button>
        </EmptyState>
      ) : !prep ? (
        <EmptyState
          icon={<MessagesSquare className="size-6" />}
          title="Grounded interview prep"
          description="Generate questions from the exact JD, the requirements you reviewed, the resume you submitted and your match gaps. Every question shows why it is being asked and which evidence backs the answer."
        >
          <Button onClick={() => void generate()} disabled={loading}>
            {loading ? "Generating…" : "Generate prep"}
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-5">
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
      )}
    </div>
  );
}
