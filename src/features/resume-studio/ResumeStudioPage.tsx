import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/inputs";
import { ipc } from "../../lib/ipc";
import { fmtRange } from "../../lib/dateFmt";
import { convertFileSrc } from "@tauri-apps/api/core";
import type {
  Job,
  PdfArtifact,
  PlanItem,
  ResumePlan,
  ResumeVersion,
  TailorSuggestion,
} from "../../lib/types";
import { toast } from "../../stores/toastStore";

const CAPACITY = 56;

const TEMPLATES = [
  {
    id: "jake",
    name: "Jake",
    desc: "Clean ATS-friendly — classic column layout",
    preview: "Jake Gutierrez's popular MIT-licensed resume",
  },
  {
    id: "expressive",
    name: "Expressive",
    desc: "Narrative style with headline and objective",
    preview: "Expressive Resume — color-accented sections",
  },
  {
    id: "plushcv",
    name: "PlushCV",
    desc: "Two-column — skills/education on sidebar",
    preview: "PlushCV — dark header, two-column layout",
  },
] as const;

type TemplateId = (typeof TEMPLATES)[number]["id"];

// ---------------------------------------------------------------------------
// HTML Plan preview (used before PDF is compiled)
// ---------------------------------------------------------------------------

function PlanPreview({
  plan,
  suggestions,
}: {
  plan: ResumePlan;
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
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-neutral-900">
              {item.title}
              {item.subtitle ? <span className="font-normal text-neutral-600"> — {item.subtitle}</span> : null}
            </span>
            <span className="shrink-0 text-[11px] text-neutral-500">
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
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm font-sans text-neutral-900">
      {/* Header */}
      <div className="border-b border-neutral-300 pb-3 text-center">
        <p className="text-xl font-bold tracking-wide">{plan.header.fullName || "Your Name"}</p>
        {plan.header.headline ? (
          <p className="mt-0.5 text-[12px] italic text-neutral-600">{plan.header.headline}</p>
        ) : null}
        <p className="mt-1 text-[11px] text-neutral-500">
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

      {/* Education */}
      {plan.education.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 border-b border-neutral-200 pb-0.5 mb-2">Education</p>
          {plan.education.map((e) => (
            <div key={e.id} className="flex items-baseline justify-between">
              <span className="text-[13px] font-semibold">{e.institution}</span>
              <span className="text-[11px] text-neutral-500">
                {fmtRange({ startDate: e.startDate, endDate: e.endDate, isCurrent: e.isCurrent })}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Experience */}
      {plan.experience.some((i) => !i.excluded) ? (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 border-b border-neutral-200 pb-0.5 mb-2">Experience</p>
          {renderItems(plan.experience)}
        </div>
      ) : null}

      {/* Projects */}
      {plan.projects.some((i) => !i.excluded) ? (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 border-b border-neutral-200 pb-0.5 mb-2">Projects</p>
          {renderItems(plan.projects)}
        </div>
      ) : null}

      {/* Skills */}
      {includedSkills.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 border-b border-neutral-200 pb-0.5 mb-2">Skills</p>
          <p className="text-[12px] text-neutral-800">{includedSkills.join(" · ")}</p>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ResumeStudioPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [plan, setPlan] = useState<ResumePlan | null>(null);
  const [suggestions, setSuggestions] = useState<TailorSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [estimatedLines, setEstimatedLines] = useState<number | null>(null);
  const [artifact, setArtifact] = useState<PdfArtifact | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [templateId, setTemplateId] = useState<TemplateId>("jake");
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [savingVersion, setSavingVersion] = useState(false);
  const [showPdf, setShowPdf] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const list = await ipc.listJobs();
        setJobs(list);
        if (list.length > 0) setJobId(list[0].id);
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (jobId === null) return;
    setPdfUrl(null);
    setShowPdf(false);
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
        const existing = await ipc.getPdfArtifact(jobId);
        setArtifact(existing);
        if (existing) {
          setPdfUrl(convertFileSrc(existing.pdfPath));
        }
        setVersions(await ipc.listResumeVersions(jobId));
      } catch (e) {
        toast.error(String(e));
      }
    })();
  }, [jobId]);

  // ---------------------------------------------------------------------------
  // Plan mutations (reorder / exclude) — auto-save on every change
  // ---------------------------------------------------------------------------

  const mutatePlan = (mutator: (p: ResumePlan) => void) => {
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

  const findItem = (p: ResumePlan, entityType: string, id: number) =>
    [...p.experience, ...p.projects].find((i) => i.entityType === entityType && i.id === id);

  const moveItem = (entityType: string, index: number, dir: -1 | 1) =>
    mutatePlan((p) => {
      const list = entityType === "experience" ? p.experience : p.projects;
      const t = index + dir;
      if (t < 0 || t >= list.length) return;
      [list[index], list[t]] = [list[t], list[index]];
    });

  const toggleItem = (entityType: string, id: number) =>
    mutatePlan((p) => {
      const item = findItem(p, entityType, id);
      if (item) item.excluded = !item.excluded;
    });

  const toggleBullet = (entityType: string, itemId: number, bulletId: number) =>
    mutatePlan((p) => {
      const bullet = findItem(p, entityType, itemId)?.bullets.find((b) => b.id === bulletId);
      if (bullet) bullet.excluded = !bullet.excluded;
    });

  const toggleSkill = (name: string) =>
    mutatePlan((p) => {
      p.excludedSkills = p.excludedSkills ?? [];
      if (p.excludedSkills.includes(name)) {
        p.excludedSkills = p.excludedSkills.filter((s) => s !== name);
      } else {
        p.excludedSkills.push(name);
      }
    });

  // ---------------------------------------------------------------------------
  // Export / versions
  // ---------------------------------------------------------------------------

  const exportPdf = async () => {
    if (jobId === null) return;
    setExporting(true);
    try {
      const result = await ipc.exportPdf(jobId, templateId);
      setArtifact(result.artifact);
      const url = convertFileSrc(result.artifact.pdfPath);
      setPdfUrl(url);
      setShowPdf(true);
      toast.ok(`PDF compiled — ${result.artifact.pageCount ?? "?"} page(s)`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  };

  const saveVersion = async () => {
    if (jobId === null) return;
    setSavingVersion(true);
    try {
      const version = await ipc.saveResumeVersion(jobId);
      setVersions((prev) => [version, ...prev]);
      toast.ok(`Version ${version.versionNumber} saved`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingVersion(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  const excludedCount = useMemo(
    () =>
      plan
        ? [...plan.experience, ...plan.projects].filter((i) => i.excluded).length +
          [...plan.experience, ...plan.projects].flatMap((i) => i.bullets).filter((b) => b.excluded).length +
          (plan.excludedSkills?.length ?? 0)
        : 0,
    [plan],
  );

  const overflows = estimatedLines !== null && estimatedLines > CAPACITY;

  // ---------------------------------------------------------------------------
  // Guard states
  // ---------------------------------------------------------------------------

  if (!loaded) return <p className="py-16 text-center text-sm text-muted">Loading studio…</p>;

  if (jobs.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Card className="p-8 text-center">
          <p className="text-sm text-muted">No job workspaces yet — paste a job description on the Jobs page first.</p>
          <div className="mt-4"><Button onClick={() => navigate("/jobs")}>Go to Jobs</Button></div>
        </Card>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Card className="p-8 text-center">
          <p className="text-sm text-muted">No plan for this workspace yet — compose one in the Plan tab.</p>
          <div className="mt-4"><Button onClick={() => navigate(`/jobs/${jobId}`)}>Open workspace</Button></div>
        </Card>
      </div>
    );
  }

  const contentSections = [
    { key: "experience", label: "Experience", items: plan.experience, cap: plan.config.maxExperienceItems },
    { key: "projects", label: "Projects", items: plan.projects, cap: plan.config.maxProjects },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="Resume Studio"
        description="Curate your content, pick a template, and export a polished PDF."
        actions={
          <>
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
            <Button variant="secondary" size="sm" onClick={() => navigate("/jobs")}>Jobs</Button>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-5">
        {/* ----------------------------------------------------------------- */}
        {/* LEFT COLUMN — Content curation                                     */}
        {/* ----------------------------------------------------------------- */}
        <div className="col-span-5 flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">

          {/* Page fit badge */}
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
            <span className="text-xs font-medium text-slate-600">Page estimate</span>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                estimatedLines === null
                  ? "bg-slate-100 text-slate-500"
                  : overflows
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {estimatedLines === null
                ? "no estimate"
                : `~${estimatedLines} / ${CAPACITY} lines · ${overflows ? "overflows ⚠" : "fits ✓"}`}
            </span>
          </div>

          {/* Header summary */}
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">{plan.header.fullName || "(no name)"}</p>
                {plan.header.headline ? (
                  <p className="mt-0.5 text-xs italic text-muted">{plan.header.headline}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-slate-400">
                  {[plan.header.email, plan.header.phone, plan.header.location].filter(Boolean).join(" · ") || "no contact"}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-[11px] text-kairo-blue hover:underline"
                onClick={() => navigate("/vault")}
              >
                Edit →
              </button>
            </div>
          </Card>

          {/* Experience + Projects */}
          {contentSections.map(({ key, label, items, cap }) => {
            const included = items.filter((i) => !i.excluded).length;
            const atCap = cap !== null && included >= cap;
            return (
              <Card key={key} className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <CardTitle>
                    {label}
                    <span className={`ml-1 text-slate-300 ${atCap ? "font-bold !text-amber-500" : ""}`}>
                      · {included}/{cap ?? "—"}
                    </span>
                  </CardTitle>
                </div>
                <ul className="space-y-2">
                  {items.map((item, index) => {
                    const bulletsUsed = item.bullets.filter((b) => !b.excluded).length;
                    const bulletCap = plan.config.maxBulletsPerItem;
                    return (
                      <li
                        key={`${item.entityType}-${item.id}`}
                        className={`rounded-lg border p-3 transition-colors ${
                          item.excluded ? "border-dashed border-slate-300 bg-slate-50 opacity-60" : "border-slate-200 bg-white"
                        }`}
                      >
                        {/* Item header */}
                        <div className="flex items-start gap-1">
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-xs font-semibold ${item.excluded ? "text-slate-400 line-through" : "text-ink"}`}>
                              {item.title}
                            </p>
                            {item.subtitle ? (
                              <p className="truncate text-[11px] text-muted">{item.subtitle}</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5 text-slate-400">
                            <button
                              type="button"
                              title="Move up"
                              className="rounded px-1 py-0.5 hover:bg-slate-100 hover:text-ink disabled:opacity-30"
                              disabled={index === 0}
                              onClick={() => moveItem(item.entityType, index, -1)}
                            >↑</button>
                            <button
                              type="button"
                              title="Move down"
                              className="rounded px-1 py-0.5 hover:bg-slate-100 hover:text-ink disabled:opacity-30"
                              disabled={index === items.length - 1}
                              onClick={() => moveItem(item.entityType, index, 1)}
                            >↓</button>
                            <button
                              type="button"
                              title={item.excluded ? "Include" : "Exclude"}
                              className="rounded px-1 py-0.5 text-xs hover:bg-slate-100 hover:text-kairo-blue"
                              onClick={() => toggleItem(item.entityType, item.id)}
                            >
                              {item.excluded ? "+" : "−"}
                            </button>
                          </div>
                        </div>

                        {/* Bullets */}
                        {!item.excluded && item.bullets.length > 0 ? (
                          <div className="mt-2">
                            <p className={`mb-1 text-[10px] ${bulletsUsed >= bulletCap ? "font-semibold text-amber-500" : "text-slate-400"}`}>
                              {bulletsUsed}/{bulletCap} bullets
                            </p>
                            <ul className="space-y-1">
                              {item.bullets.map((bullet) => (
                                <li key={bullet.id} className="flex items-start gap-1">
                                  <span
                                    className={`min-w-0 flex-1 text-[11px] leading-relaxed ${
                                      bullet.excluded ? "text-slate-400 line-through" : "text-muted"
                                    }`}
                                  >
                                    {bullet.text}
                                  </span>
                                  <button
                                    type="button"
                                    title={bullet.excluded ? "Include bullet" : "Exclude bullet"}
                                    className="shrink-0 rounded px-1 text-[10px] text-slate-400 hover:bg-slate-100 hover:text-kairo-blue"
                                    onClick={() => toggleBullet(item.entityType, item.id, bullet.id)}
                                  >
                                    {bullet.excluded ? "+" : "−"}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}

          {/* Skills */}
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <CardTitle>
                Skills
                <span className="ml-1 text-slate-300">
                  · {plan.skills.filter((s) => !(plan.excludedSkills ?? []).includes(s)).length}/{plan.skills.length}
                </span>
              </CardTitle>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.skills.map((skill) => {
                const excluded = (plan.excludedSkills ?? []).includes(skill);
                return (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => toggleSkill(skill)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      excluded
                        ? "border-slate-200 bg-slate-100 text-slate-400 line-through"
                        : "border-kairo-blue/30 bg-kairo-blue/5 text-kairo-blue hover:bg-kairo-blue/10"
                    }`}
                  >
                    {skill}
                  </button>
                );
              })}
            </div>
          </Card>

          {excludedCount > 0 ? (
            <p className="px-1 text-[11px] text-slate-400">{excludedCount} item(s) excluded — they won't appear in the PDF.</p>
          ) : null}
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* RIGHT COLUMN — Export + Preview                                    */}
        {/* ----------------------------------------------------------------- */}
        <div className="col-span-7 flex min-h-0 flex-col gap-4 overflow-y-auto">

          {/* Export card */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <CardTitle>Export PDF</CardTitle>
              {artifact && (
                <button
                  type="button"
                  onClick={() => void ipc.openFile(artifact.pdfPath).catch((e: unknown) => toast.error(String(e)))}
                  className="text-[11px] text-kairo-blue hover:underline"
                >
                  Open last PDF ↗
                </button>
              )}
            </div>

            {/* Template picker */}
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Template</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  className={`flex flex-col rounded-xl border p-3 text-left transition-all ${
                    templateId === t.id
                      ? "border-kairo-blue bg-kairo-blue/5 ring-1 ring-kairo-blue shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`h-2.5 w-2.5 rounded-full border-2 ${
                        templateId === t.id ? "border-kairo-blue bg-kairo-blue" : "border-slate-300"
                      }`}
                    />
                    <span className="text-xs font-semibold text-ink">{t.name}</span>
                  </span>
                  <span className="mt-1 text-[10px] leading-tight text-slate-400">{t.desc}</span>
                </button>
              ))}
            </div>

            {/* Export button */}
            <Button
              className="w-full justify-center"
              onClick={() => void exportPdf()}
              disabled={exporting || !plan.fitsOnePage}
              title={!plan.fitsOnePage ? "Resolve page overflow first" : "Compile to PDF with Tectonic (first run downloads TeX packages)"}
            >
              {exporting ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Compiling… (first run may take a few minutes)
                </span>
              ) : (
                "Export PDF"
              )}
            </Button>

            {artifact && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[11px]">
                <span className="text-emerald-600">✓ Compiled</span>
                {artifact.pageCount ? <span className="text-emerald-600">· {artifact.pageCount} page(s)</span> : null}
                {artifact.compiledAt ? (
                  <span className="text-emerald-500">· {artifact.compiledAt.replace("T", " ").slice(0, 16)}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShowPdf(!showPdf)}
                  className="ml-auto text-kairo-blue hover:underline"
                >
                  {showPdf ? "Show plan view" : "Show PDF ↗"}
                </button>
              </div>
            )}

            {/* Versions */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Saved versions</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void saveVersion()}
                  disabled={savingVersion || !artifact}
                  title={!artifact ? "Export the PDF first" : "Freeze this plan + PDF as a version"}
                >
                  {savingVersion ? "Saving…" : "Save version"}
                </Button>
              </div>
              {versions.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-[11px]">
                      <span className="font-medium text-ink">v{v.versionNumber}</span>
                      <span className="text-slate-400">{v.createdAt.replace("T", " ").slice(0, 16)}</span>
                      <button
                        type="button"
                        onClick={() => void ipc.openFile(v.pdfPath).catch((e: unknown) => toast.error(String(e)))}
                        className="shrink-0 text-kairo-blue hover:underline"
                      >
                        Open ↗
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[11px] text-slate-400">No versions saved yet.</p>
              )}
            </div>
          </Card>

          {/* Preview area — PDF iframe or HTML plan preview */}
          {showPdf && pdfUrl ? (
            <Card className="overflow-hidden p-0">
              <iframe
                src={`${pdfUrl}#toolbar=0`}
                className="h-[750px] w-full border-0"
                title="Resume PDF Preview"
              />
            </Card>
          ) : (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Plan preview
                {artifact && !showPdf ? (
                  <button
                    type="button"
                    onClick={() => setShowPdf(true)}
                    className="ml-2 normal-case font-normal text-kairo-blue hover:underline"
                  >
                    Switch to PDF view
                  </button>
                ) : null}
              </p>
              <PlanPreview plan={plan} suggestions={suggestions} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
