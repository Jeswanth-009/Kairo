import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/inputs";
import { IconInterview } from "../../components/icons";
import { ipc } from "../../lib/ipc";
import type { InterviewCategory, InterviewPrep, Job } from "../../lib/types";
import { toast } from "../../stores/toastStore";

const CATEGORY_ORDER: { key: InterviewCategory; label: string; color: string }[] = [
  { key: "weak_area", label: "Weak areas — prepare an answer", color: "text-amber-600" },
  { key: "project_deep_dive", label: "Project deep-dives", color: "text-kairo-blue" },
  { key: "technical_skill", label: "Technical questions", color: "text-kairo-violet" },
  { key: "responsibility", label: "Behavioral / responsibility", color: "text-sky-700" },
  { key: "resume_question", label: "Resume questions", color: "text-slate-500" },
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
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : jobs.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400">
            <IconInterview width={24} height={24} />
          </div>
          <p className="text-sm text-muted">
            No job workspaces yet — paste a job description on the Jobs page first.
          </p>
          <div className="mt-4">
            <Button onClick={() => navigate("/jobs")}>Go to Jobs</Button>
          </div>
        </Card>
      ) : !prep ? (
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400">
            <IconInterview width={24} height={24} />
          </div>
          <h3 className="text-base font-semibold text-ink">Grounded interview prep</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            Generate questions from the exact JD, the requirements you reviewed, the resume you
            submitted and your match gaps. Every question shows why it is being asked and which
            evidence backs the answer.
          </p>
          <div className="mt-5">
            <Button onClick={() => void generate()} disabled={loading}>
              {loading ? "Generating…" : "Generate prep"}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card className="p-6">
            <CardTitle>Inputs used</CardTitle>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-ink">
                JD: {prep.inputs.rawJdChars} chars stored
              </span>
              <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-ink">
                {prep.inputs.requirementCount} requirements
              </span>
              <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-ink">
                {prep.inputs.planBulletCount} resume bullets
              </span>
              <span
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  prep.inputs.gapCount > 0
                    ? "bg-amber-50 text-amber-700"
                    : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {prep.inputs.gapCount} match gaps
              </span>
              <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-ink">
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
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                      <span className="font-medium text-slate-500">Why asked:</span> {q.why}
                    </p>
                    {q.evidenceRefs.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {q.evidenceRefs.map((ref, j) => (
                          <span
                            key={j}
                            className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                          >
                            ✓ {ref}
                          </span>
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
