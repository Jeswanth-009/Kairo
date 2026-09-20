import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/inputs";
import { Card, CardTitle } from "../../components/ui/Card";
import { ipc } from "../../lib/ipc";
import { fmtRange } from "../../lib/dateFmt";
import type { PlanItem, ResumePlan, TailorSuggestion } from "../../lib/types";
import { toast } from "../../stores/toastStore";

const STATUS_META: Record<TailorSuggestion["status"], { label: string; badge: string }> = {
  pending: { label: "Pending review", badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  accepted: { label: "Accepted", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  rejected: { label: "Rejected", badge: "bg-red-100 text-red-700" },
};

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

  const suggest = async (bulletId: number) => {
    setBusyBullet(bulletId);
    try {
      const suggestion = await ipc.tailorSuggest(jobId, bulletId);
      setSuggestions((prev) => [suggestion, ...prev.filter((s) => s.id !== suggestion.id)]);
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

  const suggestAll = async () => {
    if (!plan) return;
    setRunningAll(true);
    try {
      const bullets = [...plan.experience, ...plan.projects].flatMap((item) =>
        item.bullets.map((b) => b.id),
      );
      let ok = 0;
      let rejected = 0;
      for (const bulletId of bullets) {
        try {
          const suggestion = await ipc.tailorSuggest(jobId, bulletId);
          setSuggestions((prev) => [suggestion, ...prev.filter((s) => s.id !== suggestion.id)]);
          if (suggestion.validation.ok) ok += 1;
          else rejected += 1;
        } catch (e) {
          rejected += 1;
          // Surface the rejection reason per bullet in the card itself.
          setSuggestions((prev) => [
            {
              id: -Date.now() - bulletId,
              jobId,
              bulletId,
              originalText: "",
              suggestedText: String(e),
              status: "rejected",
              validation: { ok: false, violations: [String(e)] },
              model: "",
            },
            ...prev,
          ]);
        }
      }
      toast.ok(`${ok} suggestion(s) ready, ${rejected} rejected by validation`);
    } finally {
      setRunningAll(false);
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
          The AI rewrites only this workspace's approved bullets, one at a time, with the target
          requirement, your evidence notes and your claim rules as its only inputs. Every rewrite
          passes the validation pipeline — new technologies, new metrics, forbidden claims and
          uncited facts are rejected before you ever see them. Nothing is applied without your
          Accept.
        </p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => void suggestAll()} disabled={runningAll || !plan || items.length === 0}>
            {runningAll ? "Rewriting…" : "Suggest for all bullets"}
          </Button>
          {!plan ? (
            <Button variant="secondary" onClick={onComposePlan}>
              Compose a plan first
            </Button>
          ) : null}
          {plan && bulletsNeedingSuggestions === 0 ? (
            <span className="self-center text-xs text-emerald-600">All planned bullets have accepted wording</span>
          ) : null}
        </div>
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
                        disabled={busy || runningAll}
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
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {suggestion.validation.ok
                              ? STATUS_META[suggestion.status].label
                              : "Rejected by validator"}
                          </span>
                        </div>

                        {suggestion.status === "rejected" && suggestion.validation.violations.length > 0 ? (
                          <p className="mt-1.5 text-xs text-red-600">{suggestion.suggestedText}</p>
                        ) : (
                          <p className="mt-1.5 text-sm text-ink">{suggestion.suggestedText}</p>
                        )}

                        {suggestion.validation.violations.length > 0 ? (
                          <ul className="mt-2 space-y-0.5">
                            {suggestion.validation.violations.map((violation, i) => (
                              <li key={i} className="text-[11px] text-red-600">
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
                    ) : null}
                  </li>
                );
              })}
              {item.bullets.length === 0 ? (
                <li className="text-xs text-amber-600">
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
          className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
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
