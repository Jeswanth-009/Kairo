import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, PencilLine, Search, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { ipc } from "../../lib/ipc";
import type {
  Coverage,
  EvidenceDecision,
  EvidenceSelection,
  MatchReport,
  RequirementResult,
} from "../../lib/types";
import { useUiStore } from "../../stores/uiStore";
import { useJobsStore } from "../../stores/jobsStore";
import { flushPlanSave } from "../../lib/planAutosave";
import { toast } from "../../stores/toastStore";
const COVERAGE_META: Record<Coverage, { label: string; dot: string; badge: string; hint: string }> = {
  covered: {
    label: "Covered",
    dot: "bg-ok",
    badge: "bg-ok-soft text-ok dark:bg-ok/15 dark:text-emerald-300",
    hint: "",
  },
  partial: {
    label: "Partial",
    dot: "bg-warn",
    badge: "bg-warn-soft text-warn dark:bg-warn/15 dark:text-kairo-dawn",
    hint: "Strengthen the proof: add proof or use the skill more prominently.",
  },
  missing: {
    label: "Missing",
    dot: "bg-bad",
    badge: "bg-bad-soft text-bad",
    hint: "No fabrication — close the gap by learning/building with it, or address it in interviews.",
  },
};

const KIND_LABELS: Record<string, string> = {
  required_skill: "Required",
  preferred_skill: "Preferred",
  responsibility: "Responsibility",
};

/** The Evidence stage: each requirement beside its strongest supporting
 *  records, with the four decisions that make the resume defensible —
 *  Use it, Dismiss it, Edit the fact, or find another example. */
export function MatchTab({ jobId, domain }: { jobId: number; domain: string }) {
  const navigate = useNavigate();
  const focusVaultRecord = useUiStore((s) => s.focusVaultRecord);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [stale, setStale] = useState(false);
  const [selections, setSelections] = useState<EvidenceSelection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [r, s, sel] = await Promise.all([
          ipc.getMatch(jobId),
          ipc.isMatchStale(jobId),
          ipc.listEvidenceSelections(jobId),
        ]);
        setReport(r);
        setStale(s);
        setSelections(sel);
        useJobsStore.setState((state) => ({
          matchCache: { ...state.matchCache, [jobId]: r },
          matchStaleCache: { ...state.matchStaleCache, [jobId]: s },
          selectionCache: { ...state.selectionCache, [jobId]: sel },
        }));
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoaded(true);
      }
    })();
  }, [jobId]);

  const run = async () => {
    setRunning(true);
    try {
      const report = await ipc.runJobMatch(jobId);
      setReport(report);
      setStale(false);
      useJobsStore.setState((state) => ({
        matchCache: { ...state.matchCache, [jobId]: report },
        matchStaleCache: { ...state.matchStaleCache, [jobId]: false },
      }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRunning(false);
    }
  };

  const decisionFor = (requirementId: number, entityType: string, entityId: number) =>
    selections.find(
      (s) =>
        s.requirementId === requirementId &&
        s.entityType === entityType &&
        s.entityId === entityId,
    );

  /** Persist the decision and keep the resume draft honest: Use includes the
   *  record in the plan, Dismiss excludes it (item-level). */
  const decide = async (
    result: RequirementResult,
    entityType: string,
    entityId: number,
    decision: EvidenceDecision,
  ) => {
    const existing = decisionFor(result.requirementId, entityType, entityId);
    try {
      // The backend updates the decision and draft in one DB transaction.
      // Finish any Studio autosave first so it cannot overwrite that choice.
      const flush = await flushPlanSave(jobId);
      if (!flush.ok) throw new Error(flush.error ?? "Save the draft before changing evidence.");
      if (existing && existing.decision === decision) {
        // Clearing the choice leaves any direct Studio edits intact.
        await ipc.deleteEvidenceSelection(result.requirementId, entityType, entityId);
        const next = selections.filter((s) => s.id !== existing.id);
        setSelections(next);
        useJobsStore.setState((state) => ({ selectionCache: { ...state.selectionCache, [jobId]: next } }));
        return;
      }
      const saved = await ipc.setEvidenceSelection(
        jobId,
        result.requirementId,
        entityType,
        entityId,
        decision,
      );
      const next = [...selections.filter((s) => s.id !== (existing?.id ?? -1)), saved];
      setSelections(next);
      useJobsStore.setState((state) => ({ selectionCache: { ...state.selectionCache, [jobId]: next } }));
    } catch (e) {
      toast.error(String(e));
    }
  };

  /** Alternative records for a requirement: the matcher's ranked entities
   *  that are not already supporting it. */
  const alternativesFor = (result: RequirementResult) => {
    const used = new Set(result.entityRefs.map((r) => `${r.entityType}-${r.id}`));
    return report?.entityRanking
      .filter((e) => !used.has(`${e.entityType}-${e.id}`))
      .slice(0, 4);
  };

  const openFact = (entityType: string, entityId: number) => {
    const key = entityType === "experience" ? "experiences" : entityType === "education" ? "education" : entityType === "achievement" ? "achievements" : "projects";
    focusVaultRecord(key, entityId);
    navigate("/story");
  };

  if (!loaded) {
    return <p className="py-12 text-center text-sm text-muted">Loading match…</p>;
  }

  if (!report) {
    return (
      <Card className="p-8 text-center">
        <h3 className="text-base font-semibold text-ink">No match computed yet</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Kairo compares each reviewed requirement with the experience and proof in My Story, then shows why each item is covered or missing.
        </p>
        <div className="mt-5">
          <Button onClick={() => void run()} disabled={running}>
            {running ? "Matching…" : "Run match"}
          </Button>
        </div>
      </Card>
    );
  }

  const counts = {
    covered: report.results.filter((r) => r.coverage === "covered").length,
    partial: report.results.filter((r) => r.coverage === "partial").length,
    missing: report.results.filter((r) => r.coverage === "missing").length,
  };
  const usedCount = selections.filter((s) => s.decision === "use").length;

  const sorted: RequirementResult[] = [...report.results].sort((a, b) => {
    const order: Record<Coverage, number> = { partial: 0, missing: 1, covered: 2 };
    return order[a.coverage] - order[b.coverage] || a.kind.localeCompare(b.kind);
  });

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok">
              {counts.covered} covered
            </span>
            <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn">
              {counts.partial} partial
            </span>
            <span className="rounded-full bg-bad-soft px-2.5 py-1 text-xs font-medium text-bad">
              {counts.missing} missing
            </span>
            {usedCount > 0 ? (
              <span className="rounded-full bg-kairo-blue/10 px-2.5 py-1 text-xs font-medium text-kairo-blue">
                {usedCount} record{usedCount === 1 ? "" : "s"} used
              </span>
            ) : null}
            {domain ? (
              <span className="rounded-full bg-kairo-sky/20 px-2.5 py-1 text-xs font-medium text-sky-700">
                domain: {domain}
              </span>
            ) : null}
          </div>
          <Button size="sm" variant="secondary" onClick={() => void run()} disabled={running}>
            {running ? "Re-running…" : "Re-run match"}
          </Button>
        </div>

        {stale ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn dark:border-warn/25 dark:bg-warn/10 dark:text-kairo-dawn">
            <span>
              Your requirements or Vault changed after this match — the coverage below may be out
              of date. Your Use/Dismiss decisions are kept.
            </span>
            <Button size="sm" variant="secondary" onClick={() => void run()} disabled={running}>
              {running ? "Re-running…" : "Re-run match"}
            </Button>
          </div>
        ) : null}

        <p className="mt-3 text-xs leading-relaxed text-muted">
          Every requirement beside its strongest proof. Decide per record: use it, dismiss it,
          edit the fact, or find another example. Missing requirements stay visible — Kairo never
          invents content to fill a gap.
        </p>

        <details className="mt-3 rounded-lg border border-line bg-accent-soft/60 px-3 py-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted hover:text-ink">How Kairo finds support</summary>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Local matching compares requirement wording with your saved skills, aliases, record text, recency, and attached proof. It ranks possible support so you can review it; the labels are a starting point, not a hiring prediction or factual verification. Matching engine v{report.matchingVersion}.
          </p>
        </details>
      </Card>

      <div className="space-y-2">
        {sorted.map((result) => {
          const meta = COVERAGE_META[result.coverage];
          const alternatives = alternativesFor(result);
          return (
            <Card key={result.requirementId} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{result.rawText}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {KIND_LABELS[result.kind] ?? result.kind}
                      {result.matchedSkills.length > 0
                        ? ` · matched: ${result.matchedSkills.join(", ")}`
                        : ""}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}>
                  {meta.label}
                </span>
              </div>

              <p className="mt-2 text-xs leading-relaxed text-muted">{result.explanation}</p>

              {result.entityRefs.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Supporting records
                  </p>
                  {result.entityRefs.map((ref, i) => {
                    const decision = decisionFor(result.requirementId, ref.entityType, ref.id);
                    return (
                      <div
                        key={`${ref.entityType}-${ref.id}-${i}`}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                          decision?.decision === "dismiss"
                            ? "border-line bg-accent-soft opacity-60"
                            : decision?.decision === "use"
                              ? "border-ok/30 bg-ok-soft/50"
                              : "border-line bg-card"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
                            {decision?.decision === "use" ? (
                              <Check className="size-3.5 text-ok" />
                            ) : decision?.decision === "dismiss" ? (
                              <X className="size-3.5 text-muted" />
                            ) : null}
                            {ref.title}
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted">
                            {ref.contribution}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Button
                            size="sm"
                            variant={decision?.decision === "use" ? "primary" : "ghost"}
                            className="text-xs"
                            onClick={() =>
                              void decide(result, ref.entityType, ref.id, "use")
                            }
                          >
                            Use
                          </Button>
                          <Button
                            size="sm"
                            variant={decision?.decision === "dismiss" ? "secondary" : "ghost"}
                            className="text-xs"
                            onClick={() =>
                              void decide(result, ref.entityType, ref.id, "dismiss")
                            }
                          >
                            Dismiss
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs"
                            onClick={() => openFact(ref.entityType, ref.id)}
                          >
                            <PencilLine className="size-3" /> Edit fact
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {alternatives && alternatives.length > 0 ? (
                <details className="mt-3 rounded-lg border border-line bg-accent-soft/60 px-3 py-2">
                  <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-muted hover:text-ink">
                    <Search className="size-3" /> Find another example
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {alternatives.map((alt) => (
                      <div
                        key={`${alt.entityType}-${alt.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-ink">{alt.title}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {alt.reasons.slice(0, 2).join(" · ") ||
                              `relevance ${alt.relevance.toFixed(2)}`}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="text-xs"
                          onClick={() => void decide(result, alt.entityType, alt.id, "use")}
                        >
                          Use this instead
                        </Button>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {meta.hint ? (
                <p className="mt-2 text-xs text-muted">{meta.hint}</p>
              ) : null}
            </Card>
          );
        })}
      </div>

      {report.entityRanking.length > 0 ? (
        <Card className="p-6">
          <CardTitle>Your strongest proof for this job</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Ranked by requirement coverage, skill confidence and recency.
          </p>
          <ul className="mt-4 space-y-3">
            {report.entityRanking.map((entity, index) => (
              <li key={`${entity.entityType}-${entity.id}`} className="rounded-xl border border-line bg-card-muted/50 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-kairo-blue/10 text-xs font-semibold text-kairo-blue">{index + 1}</span>
                  <span className="text-sm font-medium text-ink">{entity.title}</span>
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 pl-8">
                  {entity.reasons.slice(0, 4).map((reason, i) => (
                    <li key={i} className="text-xs text-muted">
                      {reason}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
