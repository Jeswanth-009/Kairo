import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/inputs";
import { Card, CardTitle } from "../../components/ui/Card";
import { ipc } from "../../lib/ipc";
import { fmtRange } from "../../lib/dateFmt";
import type { PlanItem, ResumePlan, TailorBatchReport, TailorSuggestion } from "../../lib/types";
import { toast } from "../../stores/toastStore";

const STATUS_META: Record<TailorSuggestion["status"], { label: string; badge: string }> = {
  pending: { label: "Pending review", badge: "bg-warn-soft text-warn dark:bg-warn/15 dark:text-kairo-dawn" },
  accepted: { label: "Accepted", badge: "bg-ok-soft text-ok dark:bg-ok/15 dark:text-emerald-300" },
  rejected: { label: "Rejected", badge: "bg-bad-soft text-bad" },
};

/** "42.3s" style elapsed formatting for run timers. */
function fmtSeconds(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TailorTab({
  jobId,
  onComposePlan,
}: {
  jobId: number;
  onComposePlan: () => void;
}) {
  const [suggestions, setSuggestions] = useState<TailorSuggestion[]>([]);
  const [plan, setPlan] = useState<ResumePlan | null>(null);
  const [busyBullet, setBusyBullet] = useState<number | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [report, setReport] = useState<TailorBatchReport | null>(null);

  const reload = async () => {
    try {
      setSuggestions(await ipc.tailorList(jobId));
      setPlan((await ipc.getPlan(jobId))?.plan ?? null);
    } catch (e) {
      toast.error(String(e));
    }
  };

  useEffect(() => {
    void (async () => {
      await reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Live elapsed timer while a tailor run is in flight.
  useEffect(() => {
    if (!runningAll) return;
    setElapsedMs(0);
    const timer = window.setInterval(() => setElapsedMs((e) => e + 1000), 1000);
    return () => window.clearInterval(timer);
  }, [runningAll]);

  const mergeSuggestions = (incoming: TailorSuggestion[]) =>
    setSuggestions((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      for (const s of incoming) byId.set(s.id, s);
      return [...byId.values()].sort((a, b) => b.id - a.id);
    });

  const suggest = async (bulletId: number) => {
    setBusyBullet(bulletId);
    try {
      const suggestion = await ipc.tailorSuggest(jobId, bulletId);
      mergeSuggestions([suggestion]);
      if (suggestion.validation.ok) {
        toast.ok("Rewrite suggestion ready — review before accepting");
      } else {
        toast.error("Suggestion rejected by the claim validator");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyBullet(null);
    }
  };

  const tailorAll = async () => {
    setRunningAll(true);
    setReport(null);
    try {
      const result = await ipc.tailorPlanBatch(jobId);
      mergeSuggestions(result.suggestions);
      setReport(result);
      const ok = result.suggestions.filter((s) => s.validation.ok).length;
      toast.ok(
        `${ok} rewrite(s) ready in ${fmtSeconds(result.durationMs)}${
          result.batchUsed ? "" : " (per-bullet fallback)"
        }`,
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRunningAll(false);
    }
  };

  const stop = async () => {
    try {
      await ipc.tailorCancel();
    } catch {
      /* best effort — the run finishes on its own timeout */
    }
  };

  const items: PlanItem[] = plan ? [...plan.experience, ...plan.projects] : [];
  const bulletsNeedingSuggestions = items.filter(
    (item) =>
      item.bullets.length > 0 &&
      item.bullets.some((b) => !suggestions.some((s) => s.bulletId === b.id && s.status === "accepted")),
  ).length;

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <CardTitle>Grounded tailoring</CardTitle>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          One AI pass rewrites every planned bullet — each with its target requirement, evidence
          notes and claim rules as the only inputs. Every rewrite passes the validation pipeline —
          new technologies, new metrics, forbidden claims and uncited facts are rejected before you
          ever see them. Nothing is applied without your Accept.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void tailorAll()}
            disabled={runningAll || !plan || items.length === 0}
          >
            {runningAll ? "Rewriting…" : "Tailor all — one pass"}
          </Button>
          {runningAll ? (
            <Button variant="danger-outline" onClick={() => void stop()}>
              Stop
            </Button>
          ) : null}
          {!plan ? (
            <Button variant="secondary" onClick={onComposePlan}>
              Compose a plan first
            </Button>
          ) : null}
          {runningAll ? (
            <span className="text-xs text-muted">
              {fmtSeconds(elapsedMs)} elapsed — one call, the whole plan
            </span>
          ) : null}
          {plan && !runningAll && bulletsNeedingSuggestions === 0 ? (
            <span className="text-xs text-ok">All planned bullets have accepted wording</span>
          ) : null}
        </div>

        {report && !runningAll ? (
          <div className="mt-4 rounded-lg border border-line bg-surface p-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-ink">
                Last run: {report.batchUsed ? "one AI call" : "per-bullet fallback"}
              </span>
              <span className="text-muted">{report.model}</span>
              <span className="text-muted">{fmtSeconds(report.durationMs)}</span>
              {report.promptTokens !== null ? (
                <span className="text-muted">
                  {report.promptTokens.toLocaleString()} in ·{" "}
                  {report.completionTokens?.toLocaleString() ?? "?"} out
                </span>
              ) : null}
              <span className="text-ok">
                {report.suggestions.filter((s) => s.validation.ok).length} ready
              </span>
              {report.suggestions.some((s) => !s.validation.ok) ? (
                <span className="text-bad">
                  {report.suggestions.filter((s) => !s.validation.ok).length} rejected
                </span>
              ) : null}
            </div>
            {report.durationMs > 30_000 ? (
              <p className="mt-1.5 text-warn">
                The model took {fmtSeconds(report.durationMs)}. Free-tier and large local models are
                the usual cause — a smaller or paid-tier model in Settings → AI provider rewrites in
                seconds.
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      {!plan ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
          Compose a plan first — tailoring works on planned bullets only.
        </p>
      ) : (
        items.map((item) => (
          <Card key={`${item.entityType}-${item.id}`} className="p-6">
            <div className="flex items-center justify-between">
              <CardTitle>
                {item.title}
                <span className="ml-2 text-[11px] font-normal text-muted">
                  {fmtRange({ startDate: item.startDate, endDate: item.endDate, isCurrent: item.isCurrent })}
                </span>
              </CardTitle>
            </div>
            <ul className="mt-3 space-y-3">
              {item.bullets.map((bullet) => {
                const suggestion = suggestions.find((s) => s.bulletId === bullet.id);
                const busy = busyBullet === bullet.id;
                const running = runningAll;
                return (
                  <li key={bullet.id} className="rounded-lg border border-line p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-ink">
                        <span className="mr-1.5 text-muted">canonical:</span>
                        {bullet.text}
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || running}
                        onClick={() => void suggest(bullet.id)}
                      >
                        {busy ? "Rewriting…" : suggestion ? "Re-suggest" : "Suggest rewrite"}
                      </Button>
                    </div>

                    {suggestion ? (
                      <div className="mt-3 rounded-lg bg-surface p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-medium text-muted">
                            AI wording{suggestion.model ? ` · ${suggestion.model}` : ""}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              suggestion.validation.ok
                                ? STATUS_META[suggestion.status].badge
                                : "bg-bad-soft text-bad"
                            }`}
                          >
                            {suggestion.validation.ok
                              ? STATUS_META[suggestion.status].label
                              : "Rejected by validator"}
                          </span>
                        </div>

                        {suggestion.status === "rejected" && suggestion.validation.violations.length > 0 ? (
                          <p className="mt-1.5 text-xs text-bad">{suggestion.suggestedText}</p>
                        ) : (
                          <p className="mt-1.5 text-sm text-ink">{suggestion.suggestedText}</p>
                        )}

                        {suggestion.validation.violations.length > 0 ? (
                          <ul className="mt-2 space-y-0.5">
                            {suggestion.validation.violations.map((violation, i) => (
                              <li key={i} className="text-[11px] text-bad">
                                ✕ {violation}
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        {suggestion.status === "pending" && suggestion.validation.ok ? (
                          <AcceptRow
                            suggestion={suggestion}
                            onDone={async (updated) => {
                              if (updated) {
                                setSuggestions((prev) =>
                                  prev.map((s) => (s.id === updated.id ? updated : s)),
                                );
                              } else {
                                setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
                              }
                            }}
                          />
                        ) : null}
                      </div>
                    ) : running ? (
                      <p className="mt-2 text-xs text-muted">Queued for the one-pass rewrite…</p>
                    ) : null}
                  </li>
                );
              })}
              {item.bullets.length === 0 ? (
                <li className="text-xs text-warn">
                  No approved canonical bullets for this record — nothing to tailor.
                </li>
              ) : null}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}

function AcceptRow({
  suggestion,
  onDone,
}: {
  suggestion: TailorSuggestion;
  onDone: (updated: TailorSuggestion | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(suggestion.suggestedText);

  return (
    <div className="mt-3 space-y-2">
      {editing ? (
        <Input value={text} onChange={(e) => setText(e.target.value)} />
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            void (async () => {
              try {
                const updated = await ipc.tailorSetStatus(
                  suggestion.id,
                  "accepted",
                  editing ? text : undefined,
                );
                toast.ok("Accepted — the plan now shows this wording");
                await onDone(updated);
              } catch (e) {
                toast.error(String(e));
              }
            })()
          }
        >
          Accept{editing ? " edit" : ""}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setEditing(!editing)}>
          {editing ? "Stop editing" : "Edit first"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-bad hover:bg-bad-soft dark:text-red-400 dark:hover:bg-bad/10"
          onClick={() =>
            void (async () => {
              try {
                await ipc.tailorDelete(suggestion.id);
                await onDone(null);
              } catch (e) {
                toast.error(String(e));
              }
            })()
          }
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
