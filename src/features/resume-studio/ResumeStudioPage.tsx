import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Select, Textarea } from "../../components/ui/inputs";
import { ipc } from "../../lib/ipc";
import { fmtRange } from "../../lib/dateFmt";
import type { Job, PlanItem, ResumePlan, TailorSuggestion, ValidationResult } from "../../lib/types";
import { toast } from "../../stores/toastStore";

const CAPACITY = 56; // one letter page at 9.5-10pt (mirrors composer.rs)

/** One canonical bullet + its tailoring state, as shown in the editor column. */
function EditorPanel({
  jobId,
  bullet,
  entity,
  suggestion,
  onAccept,
  onReject,
  onReset,
  onManualSave,
  busy,
}: {
  jobId: number;
  bullet: { id: number; text: string };
  entity: PlanItem;
  suggestion: TailorSuggestion | null;
  onAccept: () => void;
  onReject: () => void;
  onReset: () => void;
  onManualSave: (text: string) => Promise<void>;
  busy: boolean;
}) {
  const [evidence, setEvidence] = useState<
    { id: number; kind: string; title: string; verified: boolean }[]
  >([]);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [claimReport, setClaimReport] = useState<ValidationResult | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setEvidence(await ipc.listEvidence(entity.entityType, entity.id));
      } catch {
        setEvidence([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.entityType, entity.id]);

  // Reset edit state when a different bullet is selected.
  useEffect(() => {
    setEditing(false);
    setEditText("");
    setClaimReport(null);
  }, [bullet.id]);

  // Live "detected claim changes" while editing (debounced).
  useEffect(() => {
    if (!editing) return;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          setClaimReport(await ipc.claimChanges(jobId, bullet.id, editText));
        } catch {
          setClaimReport(null);
        }
      })();
    }, 400);
    return () => clearTimeout(handle);
  }, [editText, editing, jobId, bullet.id]);

  const accepted = suggestion?.status === "accepted";
  const currentWording = accepted && suggestion ? suggestion.suggestedText : bullet.text;

  const saveManual = async () => {
    if (!editText.trim()) return;
    await onManualSave(editText.trim());
    setEditing(false);
    setClaimReport(null);
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Canonical bullet (Vault source of truth)
        </p>
        <p className="mt-1 rounded-lg bg-surface p-2.5 text-xs leading-relaxed text-ink">
          {bullet.text}
        </p>
      </div>

      {suggestion ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {accepted ? "Accepted tailored wording" : "AI suggestion"}
            {suggestion.model ? ` · ${suggestion.model}` : ""}
          </p>
          <p
            className={`mt-1 rounded-lg p-2.5 text-xs leading-relaxed ${
              suggestion.validation.ok ? "bg-kairo-blue/5 text-ink" : "bg-red-50 text-red-700"
            }`}
          >
            {suggestion.suggestedText}
          </p>
          {suggestion.validation.violations.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {suggestion.validation.violations.map((v, i) => (
                <li key={i} className="text-[11px] text-red-600">
                  ✕ {v}
                </li>
              ))}
            </ul>
          ) : null}
          {!accepted ? (
            <div className="mt-2 flex gap-1.5">
              <Button size="sm" onClick={onAccept} disabled={busy || !suggestion.validation.ok}>
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600 hover:bg-red-50"
                onClick={onReject}
                disabled={busy}
              >
                Reject
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex gap-1.5">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                ✓ In the plan preview
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600 hover:bg-red-50"
                onClick={onReset}
                disabled={busy}
              >
                Reset to canonical
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400">
          No AI suggestion for this bullet yet — generate one in the workspace's Tailor tab, or
          edit the wording manually below.
        </p>
      )}

      {/* Manual edit — the "edit" of accept/edit/reset. */}
      {editing ? (
        <div className="rounded-lg border border-kairo-blue/30 bg-kairo-blue/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Edit wording
          </p>
          <Textarea
            autoFocus
            rows={3}
            className="mt-1.5"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <div className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Detected claim changes
            </p>
            {claimReport === null ? (
              <p className="mt-1 text-[11px] text-slate-400">Checking…</p>
            ) : claimReport.violations.length === 0 ? (
              <p className="mt-1 text-[11px] text-emerald-600">
                ✓ No new metrics, technologies or forbidden claims detected.
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {claimReport.violations.map((v, i) => (
                  <li key={i} className="text-[11px] text-amber-600">
                    ⚠ {v}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" onClick={() => void saveManual()} disabled={!editText.trim()}>
              Save edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setClaimReport(null);
              }}
            >
              Cancel
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] text-slate-400">
            Manual edits are user-approved by definition — warnings are advisory, not blocking.
          </p>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditText(currentWording);
              setEditing(true);
            }}
          >
            Edit wording
          </Button>
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Evidence ({evidence.length})
        </p>
        {evidence.length === 0 ? (
          <p className="mt-1 text-[11px] text-amber-600">No evidence attached to this record.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {evidence.map((e) => (
              <li key={e.id} className="text-[11px] text-muted">
                <span className={e.verified ? "text-emerald-600" : "text-amber-600"}>
                  {e.verified ? "✓" : "…"}
                </span>{" "}
                {e.title} <span className="text-slate-400">({e.kind})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Paper-like preview of the plan as the final resume would be laid out. */
function PreviewPane({
  plan,
  excludedCount,
  suggestions,
}: {
  plan: ResumePlan;
  excludedCount: number;
  suggestions: TailorSuggestion[];
}) {
  const acceptedFor = (bulletId: number) =>
    suggestions.find((s) => s.bulletId === bulletId && s.status === "accepted");

  const includedSkills = plan.skills.filter((s) => !(plan.excludedSkills ?? []).includes(s));

  const renderItems = (items: PlanItem[]) =>
    items
      .filter((i) => !i.excluded)
      .map((item) => (
        <div key={`${item.entityType}-${item.id}`} className="mb-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-neutral-900">
              {item.title}
              {item.subtitle ? <span className="font-normal"> — {item.subtitle}</span> : null}
            </span>
            <span className="text-[11px] text-neutral-500">
              {fmtRange({ startDate: item.startDate, endDate: item.endDate, isCurrent: item.isCurrent })}
            </span>
          </div>
          {item.bullets.filter((b) => !b.excluded).length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {item.bullets
                .filter((b) => !b.excluded)
                .map((b) => {
                  const accepted = acceptedFor(b.id);
                  return (
                    <li key={b.id} className="text-[12px] leading-snug text-neutral-800">
                      {accepted ? accepted.suggestedText : b.text}
                    </li>
                  );
                })}
            </ul>
          ) : null}
        </div>
      ));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="border-b border-neutral-300 pb-2 text-center">
        <p className="text-lg font-bold tracking-wide text-neutral-900">
          {plan.header.fullName || "Your Name"}
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-500">
          {[
            plan.header.email,
            plan.header.phone,
            plan.header.location,
            plan.header.github,
            plan.header.website,
            plan.header.linkedin,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {plan.education.length > 0 ? (
        <div className="mt-3">
          <p className="text-[12px] font-bold uppercase tracking-widest text-neutral-900">Education</p>
          {plan.education.map((e) => (
            <div key={e.id} className="mt-1 flex items-baseline justify-between">
              <span className="text-[13px] text-neutral-900">
                <span className="font-semibold">{e.institution}</span>
                {e.degree ? ` — ${e.degree}` : ""}
                {e.fieldOfStudy ? `, ${e.fieldOfStudy}` : ""}
              </span>
              <span className="text-[11px] text-neutral-500">
                {fmtRange({ startDate: e.startDate, endDate: e.endDate, isCurrent: e.isCurrent })}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {plan.experience.some((i) => !i.excluded) ? (
        <div className="mt-3">
          <p className="text-[12px] font-bold uppercase tracking-widest text-neutral-900">Experience</p>
          <div className="mt-1">{renderItems(plan.experience)}</div>
        </div>
      ) : null}

      {plan.projects.some((i) => !i.excluded) ? (
        <div className="mt-3">
          <p className="text-[12px] font-bold uppercase tracking-widest text-neutral-900">Projects</p>
          <div className="mt-1">{renderItems(plan.projects)}</div>
        </div>
      ) : null}

      {includedSkills.length > 0 ? (
        <div className="mt-3">
          <p className="text-[12px] font-bold uppercase tracking-widest text-neutral-900">Skills</p>
          <p className="mt-1 text-[12px] leading-snug text-neutral-800">{includedSkills.join(" · ")}</p>
        </div>
      ) : null}

      {excludedCount > 0 ? (
        <p className="mt-4 border-t border-dashed border-neutral-300 pt-2 text-[10px] italic text-neutral-400">
          {excludedCount} excluded item(s) are hidden from this preview.
        </p>
      ) : null}
    </div>
  );
}

export default function ResumeStudioPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [plan, setPlan] = useState<ResumePlan | null>(null);
  const [suggestions, setSuggestions] = useState<TailorSuggestion[]>([]);
  const [selected, setSelected] = useState<{ entityType: string; itemId: number; bulletId: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [estimatedLines, setEstimatedLines] = useState<number | null>(null);

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

  useEffect(() => {
    if (jobId === null) return;
    void (async () => {
      try {
        const stored = await ipc.getPlan(jobId);
        setPlan(stored?.plan ?? null);
        setSuggestions(await ipc.tailorList(jobId));
        if (stored?.plan) {
          setEstimatedLines(await ipc.estimatePlanLines(stored.plan));
        } else {
          setEstimatedLines(null);
        }
      } catch (e) {
        toast.error(String(e));
      }
    })();
  }, [jobId]);

  const mutatePlan = (mutator: (plan: ResumePlan) => void) => {
    if (!plan || jobId === null) return;
    const copy: ResumePlan = structuredClone(plan);
    mutator(copy);
    setPlan(copy);
    void (async () => {
      try {
        await ipc.savePlan(jobId, copy);
        setEstimatedLines(await ipc.estimatePlanLines(copy));
      } catch (e) {
        toast.error(String(e));
      }
    })();
  };

  const findItem = (plan: ResumePlan | null, entityType: string, id: number) =>
    plan ? [...plan.experience, ...plan.projects].find((i) => i.entityType === entityType && i.id === id) : undefined;

  const moveItem = (entityType: string, index: number, direction: -1 | 1) => {
    mutatePlan((plan) => {
      const list = entityType === "experience" ? plan.experience : plan.projects;
      const target = index + direction;
      if (target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target], list[index]];
    });
  };

  const moveBullet = (entityType: string, itemId: number, bulletIndex: number, direction: -1 | 1) => {
    mutatePlan((plan) => {
      const item = findItem(plan, entityType, itemId);
      if (!item) return;
      const target = bulletIndex + direction;
      if (target < 0 || target >= item.bullets.length) return;
      [item.bullets[bulletIndex], item.bullets[target]] = [item.bullets[target], item.bullets[bulletIndex]];
    });
  };

  const toggleExcludeItem = (entityType: string, itemId: number) => {
    mutatePlan((plan) => {
      const item = findItem(plan, entityType, itemId);
      if (item) item.excluded = !item.excluded;
    });
  };

  const toggleExcludeBullet = (entityType: string, itemId: number, bulletId: number) => {
    mutatePlan((plan) => {
      const item = findItem(plan, entityType, itemId);
      const bullet = item?.bullets.find((b) => b.id === bulletId);
      if (bullet) bullet.excluded = !bullet.excluded;
    });
  };

  // Skills management: reorder + exclude (persisted in the plan).
  const moveSkill = (index: number, direction: -1 | 1) => {
    mutatePlan((plan) => {
      const target = index + direction;
      if (target < 0 || target >= plan.skills.length) return;
      [plan.skills[index], plan.skills[target]] = [plan.skills[target], plan.skills[index]];
    });
  };

  const toggleSkill = (name: string) => {
    mutatePlan((plan) => {
      plan.excludedSkills = plan.excludedSkills ?? [];
      if (plan.excludedSkills.includes(name)) {
        plan.excludedSkills = plan.excludedSkills.filter((s) => s !== name);
      } else {
        plan.excludedSkills.push(name);
      }
    });
  };

  const acceptSuggestion = (suggestion: TailorSuggestion) => {
    void (async () => {
      try {
        const updated = await ipc.tailorSetStatus(suggestion.id, "accepted");
        setSuggestions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        toast.ok("Accepted — preview updated");
      } catch (e) {
        toast.error(String(e));
      }
    })();
  };

  const rejectSuggestion = (suggestion: TailorSuggestion) => {
    void (async () => {
      try {
        const updated = await ipc.tailorSetStatus(suggestion.id, "rejected");
        setSuggestions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      } catch (e) {
        toast.error(String(e));
      }
    })();
  };

  const resetSuggestion = (suggestion: TailorSuggestion) => {
    void (async () => {
      try {
        await ipc.tailorDelete(suggestion.id);
        setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
        toast.ok("Reset to canonical wording");
      } catch (e) {
        toast.error(String(e));
      }
    })();
  };

  const saveManualEdit = async (bulletId: number, text: string) => {
    if (jobId === null) return;
    try {
      const saved = await ipc.tailorSaveManualEdit(jobId, bulletId, text);
      setSuggestions((prev) => [
        saved,
        ...prev.filter((s) => !(s.bulletId === saved.bulletId && s.model === "manual" && s.id !== saved.id)),
      ]);
      toast.ok(
        saved.validation.violations.length === 0
          ? "Manual edit saved — no claim changes detected"
          : "Manual edit saved — review the detected claim changes",
      );
    } catch (e) {
      toast.error(String(e));
    }
  };

  const contentSections: { key: string; label: string; items: PlanItem[]; cap: number | null }[] = plan
    ? [
        { key: "experience", label: "Experience", items: plan.experience, cap: plan.config.maxExperienceItems },
        { key: "projects", label: "Projects", items: plan.projects, cap: plan.config.maxProjects },
      ]
    : [];

  const selectedBulletState = useMemo(() => {
    if (!selected || !plan) return null;
    const item = findItem(plan, selected.entityType, selected.itemId);
    const bullet = item?.bullets.find((b) => b.id === selected.bulletId);
    if (!item || !bullet) return null;
    const suggestion =
      suggestions
        .filter((s) => s.bulletId === bullet.id)
        .sort((a, b) => b.id - a.id)[0] ?? null;
    return { item, bullet, suggestion };
  }, [selected, plan, suggestions]);

  const excludedCount =
    plan
      ? [...plan.experience, ...plan.projects].filter((i) => i.excluded).length +
        [...plan.experience, ...plan.projects].flatMap((i) => i.bullets).filter((b) => b.excluded).length +
        (plan.excludedSkills?.length ?? 0)
      : 0;

  const overflows = estimatedLines !== null && estimatedLines > CAPACITY;

  if (!loaded) {
    return <p className="py-16 text-center text-sm text-muted">Loading studio…</p>;
  }

  if (jobs.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Card className="p-8 text-center">
          <p className="text-sm text-muted">
            No job workspaces yet — paste a job description on the Jobs page first.
          </p>
          <div className="mt-4">
            <Button onClick={() => navigate("/jobs")}>Go to Jobs</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Card className="p-8 text-center">
          <p className="text-sm text-muted">
            No plan for this workspace yet — compose one in the workspace's Plan tab.
          </p>
          <div className="mt-4">
            <Button onClick={() => navigate(`/jobs/${jobId}`)}>Open workspace</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Resume Studio</h2>
          <p className="text-xs text-muted">
            Content · Editor · Preview — changes to the plan save automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {jobs.length > 0 ? (
            <Select
              value={jobId ?? undefined}
              onChange={(e) => setJobId(Number(e.target.value))}
              className="w-64"
            >
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.roleTitle || "Untitled role"}
                  {job.company ? ` · ${job.company}` : ""}
                </option>
              ))}
            </Select>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => navigate("/jobs")}>
            Jobs
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-4">
        {/* Column 1 · Content */}
        <div className="col-span-4 flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <Card className="p-4">
            <CardTitle>Header</CardTitle>
            <div className="mt-2 text-xs">
              <p className="font-medium text-ink">{plan.header.fullName || "(no profile)"}</p>
              <p className="mt-0.5 break-all text-slate-400">
                {[
                  plan.header.email,
                  plan.header.phone,
                  plan.header.location,
                  plan.header.github,
                  plan.header.website,
                  plan.header.linkedin,
                ]
                  .filter(Boolean)
                  .join(" · ") || "no contact details"}
              </p>
              <button
                type="button"
                className="mt-1 text-[11px] text-kairo-blue hover:underline"
                onClick={() => navigate("/vault")}
              >
                Edit in Vault profile →
              </button>
            </div>
          </Card>

          {contentSections.map(({ key, label, items, cap }) => {
            const included = items.filter((i) => !i.excluded).length;
            const atCap = cap !== null && included >= cap;
            return (
              <Card key={key} className="p-4">
                <CardTitle>
                  {label}{" "}
                  <span
                    className={`text-slate-300 ${atCap ? "font-bold text-amber-500" : ""}`}
                    title={cap === null ? undefined : atCap ? `At the composer cap of ${cap}` : `Cap: ${cap} from the Plan tab`}
                  >
                    · {included}/{cap ?? "—"}
                  </span>
                </CardTitle>
                <ul className="mt-2 space-y-2">
                  {items.map((item, index) => {
                    const bulletCap = plan.config.maxBulletsPerItem;
                    const bulletsUsed = item.bullets.filter((b) => !b.excluded).length;
                    return (
                      <li
                        key={`${item.entityType}-${item.id}`}
                        className={`rounded-lg border p-2.5 ${
                          item.excluded ? "border-dashed border-slate-300 opacity-60" : "border-slate-200"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="text-xs font-medium text-ink">{item.title}</span>
                          <span className="flex shrink-0">
                            <button
                              type="button"
                              title="Move up"
                              className="px-1 text-slate-400 hover:text-ink disabled:opacity-30"
                              disabled={index === 0}
                              onClick={() => moveItem(item.entityType, index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              title="Move down"
                              className="px-1 text-slate-400 hover:text-ink disabled:opacity-30"
                              disabled={index === items.length - 1}
                              onClick={() => moveItem(item.entityType, index, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              title={item.excluded ? "Include" : "Exclude"}
                              className="px-1 text-slate-400 hover:text-kairo-blue"
                              onClick={() => toggleExcludeItem(item.entityType, item.id)}
                            >
                              {item.excluded ? "⭕" : "◉"}
                            </button>
                          </span>
                        </div>
                        {item.bullets.length > 0 ? (
                          <>
                            <p
                              className={`mt-1 text-[10px] ${
                                bulletsUsed >= bulletCap ? "font-medium text-amber-500" : "text-slate-400"
                              }`}
                            >
                              {bulletsUsed}/{bulletCap} bullets
                            </p>
                            <ul className="mt-1 space-y-1">
                              {item.bullets.map((bullet, bIndex) => (
                                <li key={bullet.id} className="flex items-start gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelected({
                                        entityType: item.entityType,
                                        itemId: item.id,
                                        bulletId: bullet.id,
                                      })
                                    }
                                    className={`min-w-0 flex-1 truncate text-left text-[11px] hover:text-kairo-blue ${
                                      selected?.bulletId === bullet.id
                                        ? "font-medium text-kairo-blue"
                                        : bullet.excluded
                                          ? "text-slate-400 line-through"
                                          : "text-muted"
                                    }`}
                                  >
                                    {bullet.text}
                                  </button>
                                  <span className="flex shrink-0 text-[10px] text-slate-400">
                                    <button
                                      type="button"
                                      title="Move up"
                                      disabled={bIndex === 0}
                                      className="px-0.5 hover:text-ink disabled:opacity-30"
                                      onClick={() => moveBullet(item.entityType, item.id, bIndex, -1)}
                                    >
                                      ↑
                                    </button>
                                    <button
                                      type="button"
                                      title="Move down"
                                      disabled={bIndex === item.bullets.length - 1}
                                      className="px-0.5 hover:text-ink disabled:opacity-30"
                                      onClick={() => moveBullet(item.entityType, item.id, bIndex, 1)}
                                    >
                                      ↓
                                    </button>
                                    <button
                                      type="button"
                                      title={bullet.excluded ? "Include bullet" : "Exclude bullet"}
                                      className="px-0.5 hover:text-kairo-blue"
                                      onClick={() => toggleExcludeBullet(item.entityType, item.id, bullet.id)}
                                    >
                                      {bullet.excluded ? "⭕" : "◉"}
                                    </button>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p className="mt-1 text-[10px] text-slate-400">no approved bullets</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}

          <Card className="p-4">
            <CardTitle>
              Skills{" "}
              <span className="text-slate-300">
                ·{" "}
                {plan.skills.filter((s) => !(plan.excludedSkills ?? []).includes(s)).length}/
                {plan.skills.length}
              </span>
            </CardTitle>
            <ul className="mt-2 space-y-1">
              {plan.skills.map((skill, index) => {
                const isExcluded = (plan.excludedSkills ?? []).includes(skill);
                return (
                  <li key={skill} className="flex items-center gap-1 text-xs">
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        isExcluded ? "text-slate-400 line-through" : "text-ink"
                      }`}
                    >
                      {skill}
                    </span>
                    <span className="flex shrink-0 text-[10px] text-slate-400">
                      <button
                        type="button"
                        title="Move up"
                        disabled={index === 0}
                        className="px-0.5 hover:text-ink disabled:opacity-30"
                        onClick={() => moveSkill(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        disabled={index === plan.skills.length - 1}
                        className="px-0.5 hover:text-ink disabled:opacity-30"
                        onClick={() => moveSkill(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        title={isExcluded ? "Include skill" : "Exclude skill"}
                        className="px-0.5 hover:text-kairo-blue"
                        onClick={() => toggleSkill(skill)}
                      >
                        {isExcluded ? "⭕" : "◉"}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        {/* Column 2 · Editor */}
        <div className="col-span-4 overflow-y-auto pr-1">
          <Card className="p-4">
            <CardTitle>Editor</CardTitle>
            {selectedBulletState ? (
              <div className="mt-3">
                <EditorPanel
                  jobId={jobId ?? 0}
                  bullet={selectedBulletState.bullet}
                  entity={selectedBulletState.item}
                  suggestion={selectedBulletState.suggestion}
                  busy={false}
                  onAccept={() => acceptSuggestion(selectedBulletState.suggestion!)}
                  onReject={() => rejectSuggestion(selectedBulletState.suggestion!)}
                  onReset={() => resetSuggestion(selectedBulletState.suggestion!)}
                  onManualSave={(text) => saveManualEdit(selectedBulletState.bullet.id, text)}
                />
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted">
                Select a bullet in the Content column to inspect its canonical wording, tailored
                suggestion, evidence — or edit the wording manually with live claim-change
                detection.
              </p>
            )}
          </Card>
        </div>

        {/* Column 3 · Preview */}
        <div className="col-span-4 flex min-h-0 flex-col gap-3 overflow-y-auto">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <CardTitle>Preview</CardTitle>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  estimatedLines === null
                    ? "bg-slate-100 text-slate-500"
                    : overflows
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {estimatedLines === null
                  ? "no estimate"
                  : `~${estimatedLines} / ${CAPACITY} lines${overflows ? " · overflows" : " · fits"}`}
              </span>
            </div>
            {excludedCount > 0 ? (
              <p className="mt-2 text-[11px] text-slate-400">{excludedCount} excluded element(s)</p>
            ) : null}
            <div className="mt-3">
              <Button size="sm" disabled title="LaTeX + Tectonic compile arrives in Phase 9">
                Export PDF
              </Button>
              <span className="ml-2 text-[11px] text-slate-400">Phase 9</span>
            </div>
          </Card>
          <div className="mx-auto w-full max-w-[420px]">
            <PreviewPane plan={plan} excludedCount={excludedCount} suggestions={suggestions} />
          </div>
        </div>
      </div>
    </div>
  );
}
