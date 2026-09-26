import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { ipc } from "../../lib/ipc";
import type { Coverage, MatchReport, RequirementResult } from "../../lib/types";
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
    hint: "Strengthen the evidence: add proof or use the skill more prominently.",
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

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-36 shrink-0 text-[11px] text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent-soft">
        <div
          className="h-full rounded-full bg-kairo-blue transition-all duration-300"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="w-9 text-right text-[11px] font-medium text-ink">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

export function MatchTab({ jobId, domain }: { jobId: number; domain: string }) {
  const [report, setReport] = useState<MatchReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setReport(await ipc.getMatch(jobId));
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
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRunning(false);
    }
  };

  if (!loaded) {
    return <p className="py-12 text-center text-sm text-muted">Loading match…</p>;
  }

  if (!report) {
    return (
      <Card className="p-8 text-center">
        <h3 className="text-base font-semibold text-ink">No match computed yet</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          The matcher compares each reviewed requirement against your Vault evidence — skills with
          confidence, canonical bullets, dates — and explains every verdict. Deterministic: the same
          Vault always produces the same result.
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

  const sorted: RequirementResult[] = [...report.results].sort((a, b) => {
    const order: Record<Coverage, number> = { partial: 0, missing: 1, covered: 2 };
    return order[a.coverage] - order[b.coverage] || a.kind.localeCompare(b.kind);
  });

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-medium text-ok">
              {counts.covered} covered
            </span>
            <span className="rounded-full bg-warn-soft px-2.5 py-1 text-[11px] font-medium text-warn">
              {counts.partial} partial
            </span>
            <span className="rounded-full bg-bad-soft px-2.5 py-1 text-[11px] font-medium text-bad">
              {counts.missing} missing
            </span>
            {domain ? (
              <span className="rounded-full bg-kairo-sky/20 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                domain: {domain}
              </span>
            ) : null}
          </div>
          <Button size="sm" variant="secondary" onClick={() => void run()} disabled={running}>
            {running ? "Re-running…" : "Re-run match"}
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          <ScoreRow label="Required skills" value={report.components.requiredSkills} />
          <ScoreRow label="Preferred skills" value={report.components.preferredSkills} />
          <ScoreRow label="Responsibilities" value={report.components.responsibilities} />
          <ScoreRow label="Domain" value={report.components.domain} />
          <ScoreRow label="Recency" value={report.components.recency} />
          <ScoreRow label="Evidence strength" value={report.components.evidenceStrength} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Weighted overall relevance {report.overallScore.toFixed(2)} — a ranking of your own
          evidence, not a prediction of hiring outcomes. Weights: required 35% · preferred 20% ·
          responsibilities 15% · domain 10% · recency 10% · evidence strength 10% · engine v
          {report.matchingVersion}.
        </p>
      </Card>

      <div className="space-y-2">
        {sorted.map((result) => {
          const meta = COVERAGE_META[result.coverage];
          return (
            <Card key={result.requirementId} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{result.rawText}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {KIND_LABELS[result.kind] ?? result.kind}
                      {result.matchedSkills.length > 0
                        ? ` · matched: ${result.matchedSkills.join(", ")}`
                        : ""}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}>
                  {meta.label}
                </span>
              </div>

              <p className="mt-2 text-xs leading-relaxed text-muted">{result.explanation}</p>

              {result.entityRefs.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.entityRefs.map((ref, i) => (
                    <span
                      key={`${ref.entityType}-${ref.id}-${i}`}
                      title={ref.contribution}
                      className="rounded-full bg-kairo-blue/10 px-2 py-0.5 text-[11px] font-medium text-kairo-blue"
                    >
                      {ref.title}
                    </span>
                  ))}
                </div>
              ) : null}

              {meta.hint ? (
                <p className="mt-2 text-[11px] text-muted">{meta.hint}</p>
              ) : null}
            </Card>
          );
        })}
      </div>

      {report.entityRanking.length > 0 ? (
        <Card className="p-6">
          <CardTitle>Your strongest evidence for this job</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Ranked by requirement coverage, skill confidence and recency.
          </p>
          <ul className="mt-4 space-y-3">
            {report.entityRanking.map((entity) => (
              <li key={`${entity.entityType}-${entity.id}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{entity.title}</span>
                  <span className="text-[11px] text-muted">
                    relevance {entity.relevance.toFixed(2)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-accent-soft">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-kairo-blue to-kairo-violet"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (entity.relevance /
                            (report.entityRanking[0].relevance || 1)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
                <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  {entity.reasons.slice(0, 4).map((reason, i) => (
                    <li key={i} className="text-[11px] text-muted">
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
