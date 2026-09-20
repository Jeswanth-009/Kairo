import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Field, Input, Select } from "../../components/ui/inputs";
import { ipc } from "../../lib/ipc";
import { fmtRange } from "../../lib/dateFmt";
import type { ComposerConfig, PlanItem, ResumePlan, TailorSuggestion } from "../../lib/types";
import { toast } from "../../stores/toastStore";

const DEFAULT_CONFIG: ComposerConfig = {
  targetPages: 1,
  maxProjects: 3,
  maxExperienceItems: 2,
  maxBulletsPerItem: 3,
  minFontSizePt: 9.5,
};

function PlanItemCard({ item, suggestions }: { item: PlanItem; suggestions: TailorSuggestion[] }) {
  const acceptedFor = (bulletId: number) =>
    suggestions.find((s) => s.bulletId === bulletId && s.status === "accepted");
  return (
    <li className="rounded-lg border border-line p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{item.title}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {[
              item.subtitle,
              fmtRange({ startDate: item.startDate, endDate: item.endDate, isCurrent: item.isCurrent }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full bg-kairo-blue/10 px-2 py-0.5 text-[11px] font-medium text-kairo-blue"
          title="Relevance from the match report"
        >
          rel {item.relevance.toFixed(2)}
        </span>
      </div>

      {item.bullets.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {item.bullets.map((bullet) => {
            const accepted = acceptedFor(bullet.id);
            return (
              <li key={bullet.id} className="flex items-start gap-2 text-xs text-ink">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-kairo-blue" />
                <span>
                  {accepted ? (
                    <>
                      <span
                        className="mr-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                        title="Accepted AI wording — canonical bullet unchanged"
                      >
                        tailored
                      </span>
                      {accepted.suggestedText}
                    </>
                  ) : (
                    bullet.text
                  )}
                  {bullet.supports.length > 0 ? (
                    <span
                      className="ml-1.5 text-[10px] text-emerald-600"
                      title={`Backs: ${bullet.supports.join(" · ")}`}
                    >
                      ✓ supports {bullet.supports.length} requirement
                      {bullet.supports.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-amber-600">
          No approved canonical bullets — approve some in the record inspector.
        </p>
      )}

      {item.skills.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.skills.map((s) => (
            <span key={s} className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-muted">
              {s}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function PlanTab({ jobId }: { jobId: number }) {
  const [plan, setPlan] = useState<ResumePlan | null>(null);
  const [config, setConfig] = useState<ComposerConfig>(DEFAULT_CONFIG);
  const [suggestions, setSuggestions] = useState<TailorSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await ipc.getPlan(jobId);
        if (stored) {
          setPlan(stored.plan);
          setConfig(stored.config);
        }
        setSuggestions(await ipc.tailorList(jobId));
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const compose = async () => {
    setBusy(true);
    try {
      setPlan(await ipc.runComposer(jobId, config));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return <p className="py-12 text-center text-sm text-muted">Loading plan…</p>;
  }

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <CardTitle>Constraints</CardTitle>
        <p className="mt-1 text-xs text-muted">
          Deterministic selection — no AI. The solver reserves header and education, ranks records
          by match relevance, picks approved bullets by requirement support, and trims to fit.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Max projects">
            <Input
              type="number"
              min={0}
              max={6}
              value={config.maxProjects}
              onChange={(e) =>
                setConfig({ ...config, maxProjects: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </Field>
          <Field label="Max experience items">
            <Input
              type="number"
              min={0}
              max={6}
              value={config.maxExperienceItems}
              onChange={(e) =>
                setConfig({ ...config, maxExperienceItems: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </Field>
          <Field label="Max bullets / item">
            <Input
              type="number"
              min={0}
              max={6}
              value={config.maxBulletsPerItem}
              onChange={(e) =>
                setConfig({ ...config, maxBulletsPerItem: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </Field>
          <Field label="Target pages">
            <Select
              value={String(config.targetPages)}
              onChange={(e) =>
                setConfig({ ...config, targetPages: Math.min(3, Math.max(1, Number(e.target.value) || 1)) })
              }
            >
              <option value="1">1 page</option>
              <option value="2">2 pages</option>
              <option value="3">3 pages</option>
            </Select>
          </Field>
        </div>
        <div className="mt-4">
          <Button onClick={() => void compose()} disabled={busy}>
            {busy ? "Composing…" : plan ? "Re-compose plan" : "Compose plan"}
          </Button>
        </div>
      </Card>

      {plan ? (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Resume plan · engine v{plan.composerVersion}</CardTitle>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  plan.fitsOnePage
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                }`}
              >
                ~{plan.estimatedLines} lines ·{" "}
                {plan.fitsOnePage
                  ? `fits ${plan.config.targetPages} page${plan.config.targetPages > 1 ? "s" : ""}`
                  : `over ${plan.config.targetPages} page${plan.config.targetPages > 1 ? "s" : ""}`}
              </span>
            </div>

            {plan.warnings.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {plan.warnings.map((warning, i) => (
                  <li key={i} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 space-y-1.5 text-sm">
              <p className="font-semibold text-ink">
                {plan.header.fullName || <span className="text-muted">(no profile)</span>}
              </p>
              {plan.header.headline ? (
                <p className="text-xs text-muted">{plan.header.headline}</p>
              ) : null}
              <p className="text-[11px] text-muted">
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
          </Card>

          {plan.education.length > 0 ? (
            <Card className="p-6">
              <CardTitle>Education · mandatory</CardTitle>
              <ul className="mt-3 space-y-2">
                {plan.education.map((e) => (
                  <li key={e.id} className="text-sm text-ink">
                    <span className="font-medium">{e.institution}</span>
                    <span className="ml-2 text-xs text-muted">
                      {[e.degree, e.fieldOfStudy].filter(Boolean).join(" · ")}
                    </span>
                    <span className="ml-2 text-[11px] text-muted">
                      {fmtRange({ startDate: e.startDate, endDate: e.endDate, isCurrent: e.isCurrent })}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {[
            { label: "Experience", items: plan.experience },
            { label: "Projects", items: plan.projects },
          ].map(({ label, items }) =>
            items.length > 0 ? (
              <Card key={label} className="p-6">
                <CardTitle>{label}</CardTitle>
                <ul className="mt-3 space-y-3">
                  {items.map((item) => (
                    <PlanItemCard key={`${item.entityType}-${item.id}`} item={item} suggestions={suggestions} />
                  ))}
                </ul>
              </Card>
            ) : null,
          )}

          {plan.skills.length > 0 ? (
            <Card className="p-6">
              <CardTitle>Skills</CardTitle>
              <p className="mt-1 text-[11px] text-muted">
                Linked to selected records; skills named in the job requirements come first.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {plan.skills.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-kairo-blue/10 px-2.5 py-1 text-xs font-medium text-kairo-blue"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
