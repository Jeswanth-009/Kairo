import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  CirclePlus,
  CircleMinus,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { IconButton } from "../../components/ui/IconButton";
import { Tabs } from "../../components/ui/Tabs";
import { Select } from "../../components/ui/inputs";
import { SectionLabel } from "../../components/ui/SectionLabel";
import { Skeleton, Spinner } from "../../components/ui/Feedback";
import { ProfileDialog } from "../vault/ProfileDialog";
import { cn } from "../../lib/cn";
import { ipc } from "../../lib/ipc";
import { fmtAgo, fmtRange } from "../../lib/dateFmt";
import { PdfViewer } from "./PdfViewer";
import type {
  Job,
  PdfArtifact,
  PlanItem,
  Profile,
  ResumePlan,
  ResumeTemplateId,
  ResumeVersion,
  Skill,
  TailorSuggestion,
} from "../../lib/types";
import { toast } from "../../stores/toastStore";

/** Rough per-template line capacity of one page (mirrors LaTeX layout). */
const CAPACITY: Record<ResumeTemplateId | string, number> = {
  jake: 56,
  expressive: 50,
  plushcv: 70,
};

const TEMPLATES: {
  id: ResumeTemplateId;
  name: string;
  desc: string;
}[] = [
  { id: "jake", name: "Jake", desc: "Classic single-column, ATS-safe" },
  { id: "expressive", name: "Expressive", desc: "Narrative style with objective" },
  { id: "plushcv", name: "PlushCV", desc: "Two-column with dark header" },
];

/** Abstract mini-layouts echoing each template's real look. */
function TemplateThumb({ id, active }: { id: ResumeTemplateId; active: boolean }) {
  const line = active ? "fill-kairo-blue/60" : "fill-slate-400/80";
  const faint = "fill-slate-300";
  const accent = active ? "fill-kairo-blue" : "fill-slate-500";

  return (
    <div
      className={cn(
        "flex h-[88px] w-[64px] shrink-0 overflow-hidden rounded-md border border-line bg-white shadow-sm transition-colors",
        active ? "border-kairo-blue/60 ring-1 ring-kairo-blue/40" : "border-line",
      )}
    >
      {id === "jake" ? (
        <svg viewBox="0 0 64 88" className="h-full w-full">
          <rect x="18" y="8" width="28" height="4" rx="1" className={accent} />
          <rect x="22" y="15" width="20" height="2" rx="1" className={line} />
          <rect x="6" y="24" width="20" height="2.5" rx="1" className={line} />
          <rect x="6" y="29" width="52" height="1" className={faint} />
          {[
            [6, 33, 46], [6, 37, 52], [6, 41, 40],
            [6, 48, 44], [6, 52, 50],
            [6, 59, 46], [6, 63, 38],
            [6, 70, 42], [6, 74, 52],
          ].map(([x, y, w], i) => (
            <rect key={i} x={x} y={y} width={w} height="2" rx="1" className={line} />
          ))}
        </svg>
      ) : id === "expressive" ? (
        <svg viewBox="0 0 64 88" className="h-full w-full">
          <rect x="6" y="8" width="30" height="4" rx="1" className={line} />
          <rect x="6" y="15" width="40" height="1.5" rx="0.75" className={accent} />
          {[[6, 22, 24], [6, 30, 30], [6, 38, 26], [6, 46, 32], [6, 58, 28], [6, 66, 34], [6, 74, 30]].map(
            ([x, y, w], i) => (
              <g key={i}>
                <rect x={x} y={y} width="10" height="2.5" rx="1" className={accent} />
                <rect x={x} y={y + 5} width={w} height="2" rx="1" className={line} />
                <circle cx={x + 2.5} cy={y + 12} r="1.1" className={line} />
                <rect x={x + 6} y={y + 11} width={w - 10} height="2" rx="1" className={line} />
              </g>
            ),
          )}
        </svg>
      ) : (
        <svg viewBox="0 0 64 88" className="h-full w-full">
          <rect x="0" y="0" width="64" height="18" rx="1" className={active ? "fill-kairo-midnight" : "fill-slate-700"} />
          <rect x="14" y="5" width="36" height="3.5" rx="1" className="fill-white/90" />
          <rect x="20" y="11" width="24" height="2" rx="1" className="fill-white/50" />
          {[[4, 24], [4, 36], [4, 48], [4, 62], [4, 74]].map(([x, y], i) => (
            <g key={i}>
              <rect x={x} y={y} width="16" height="2.5" rx="1" className={accent} />
              <rect x={x} y={y + 5} width="30" height="2" rx="1" className={line} />
              <circle cx={x + 2.5} cy={y + 12} r="1.1" className={line} />
              <rect x={x + 6} y={y + 11} width="22" height="2" rx="1" className={line} />
            </g>
          ))}
          <rect x="40" y="24" width="20" height="2.5" rx="1" className={accent} />
          {[26, 30, 34, 42, 46, 50, 58, 62, 66, 74, 78].map((y, i) => (
            <rect key={i} x="40" y={y} width="20" height="2" rx="1" className={line} />
          ))}
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HTML plan preview (approximation shown before/alongside the compiled PDF)
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

  const excluded = plan.excludedSkills ?? [];
  const includedSkills = plan.skills.filter((s) => !excluded.includes(s));
  const groups = (plan.skillsGrouped ?? []).filter(
    (g) => g.skills.filter((s) => !excluded.includes(s)).length > 0,
  );

  /** Mirrors the renderer: bullets, falling back to description lines. */
  const previewBullets = (item: PlanItem) => {
    const included = item.bullets.filter((b) => !b.excluded);
    if (included.length > 0) return included.map((b) => ({
      id: b.id,
      text: acceptedFor(b.id)?.suggestedText ?? b.text,
      tailored: Boolean(acceptedFor(b.id)),
    }));
    return item.description
      .split("\n")
      .map((l, i) => ({ id: i, text: l, tailored: false }))
      .filter((l) => l.text.trim().length > 5);
  };

  const renderItems = (items: PlanItem[]) =>
    items
      .filter((i) => !i.excluded)
      .map((item) => {
        // item.title is "Org — Role" for experience; just title for projects
        const dashIdx = item.title.indexOf(" \u2014 ");
        const org  = dashIdx >= 0 ? item.title.slice(0, dashIdx) : item.title;
        const role = dashIdx >= 0 ? item.title.slice(dashIdx + 3) : item.subtitle;
        const location = dashIdx >= 0 ? item.subtitle : "";
        const bullets = previewBullets(item);
        return (
          <div key={`${item.entityType}-${item.id}`} className="mb-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-neutral-900">{org}</span>
              <span className="shrink-0 text-[11px] text-neutral-500">
                {fmtRange({ startDate: item.startDate, endDate: item.endDate, isCurrent: item.isCurrent })}
              </span>
            </div>
            {role || location ? (
              <p className="text-[11px] text-neutral-500">
                {role}{role && location ? " · " : ""}{location}
              </p>
            ) : null}
            {bullets.length > 0 ? (
              <ul className="mt-1 list-disc pl-5">
                {bullets.map((b) => (
                  <li key={b.id} className="text-[12px] leading-snug text-neutral-800">
                    {b.text}
                    {b.tailored ? (
                      <Sparkles className="ml-1 inline size-3 text-kairo-violet" aria-label="tailored" />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      });

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 font-sans text-neutral-900 shadow-card">
      {/* Header */}
      <div className="border-b border-neutral-300 pb-3 text-center">
        <p className="text-xl font-bold tracking-wide">{plan.header.fullName || "Your Name"}</p>
        {plan.header.headline ? (
          <p className="mt-0.5 text-[12px] italic text-neutral-600">{plan.header.headline}</p>
        ) : null}
        <p className="mt-1 text-[11px] text-neutral-500">
          {[
            plan.header.phone,
            plan.header.email,
            plan.header.location,
            plan.header.github,
            plan.header.website,
            plan.header.linkedin,
          ]
            .filter(Boolean)
            .map((part) => part.replace(/^https?:\/\//, ""))
            .join(" · ")}
        </p>
      </div>

      {/* Education */}
      {plan.education.length > 0 ? (
        <div className="mt-4">
          <SectionLabel className="mb-2">Education</SectionLabel>
          {plan.education.map((e) => (
            <div key={e.id} className="mb-1">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold">{e.institution}</span>
                <span className="text-[11px] text-neutral-500">
                  {fmtRange({ startDate: e.startDate, endDate: e.endDate, isCurrent: e.isCurrent })}
                </span>
              </div>
              <span className="text-[11px] text-neutral-600">
                {[e.degree, e.fieldOfStudy].filter(Boolean).join(", ")}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Experience */}
      {plan.experience.some((i) => !i.excluded) ? (
        <div className="mt-4">
          <SectionLabel className="mb-2">Experience</SectionLabel>
          {renderItems(plan.experience)}
        </div>
      ) : null}

      {/* Projects */}
      {plan.projects.some((i) => !i.excluded) ? (
        <div className="mt-4">
          <SectionLabel className="mb-2">Projects</SectionLabel>
          {renderItems(plan.projects)}
        </div>
      ) : null}

      {/* Achievements */}
      {plan.achievements?.some((a) => !a.excluded) ? (
        <div className="mt-4">
          <SectionLabel className="mb-2">Achievements & Awards</SectionLabel>
          {plan.achievements
            .filter((a) => !a.excluded)
            .map((a) => (
              <div key={a.id} className="mb-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-neutral-900">{a.title}</span>
                  <span className="shrink-0 text-[11px] text-neutral-500">
                    {[a.issuer, fmtRange({ startDate: a.achievedOn, endDate: null, isCurrent: false })]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {a.description ? (
                  <p className="mt-0.5 text-[12px] text-neutral-700">{a.description}</p>
                ) : null}
              </div>
            ))}
        </div>
      ) : null}

      {/* Skills */}
      {includedSkills.length > 0 ? (
        <div className="mt-4">
          <SectionLabel className="mb-2">Skills</SectionLabel>
          {groups.length > 0
            ? groups.map((g) => (
                <p key={g.category} className="text-[12px] text-neutral-800">
                  <span className="font-semibold">{g.category}: </span>
                  {g.skills.filter((s) => !excluded.includes(s)).join(" · ")}
                </p>
              ))
            : (
              <p className="text-[12px] text-neutral-800">{includedSkills.join(" · ")}</p>
            )}
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
  const [exporting, setExporting] = useState(false);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [savingVersion, setSavingVersion] = useState(false);
  const [previewMode, setPreviewMode] = useState<"pdf" | "plan">("pdf");

  const templateId = (plan?.config.templateId ?? "jake") as ResumeTemplateId;
  const paper = plan?.config.paper ?? "letter";
  const [syncing, setSyncing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [showVaultSkills, setShowVaultSkills] = useState(false);
  const [vaultSkills, setVaultSkills] = useState<Skill[]>([]);
  const [vaultQuery, setVaultQuery] = useState("");

  useEffect(() => {
    ipc
      .getProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    if (showVaultSkills && vaultSkills.length === 0) {
      ipc
        .listSkills()
        .then(setVaultSkills)
        .catch((e) => toast.error(String(e)));
    }
  }, [showVaultSkills, vaultSkills.length]);

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

  // Stale-response guard: rapidly switching jobs must never interleave
  // plan/artifact/version state from two different workspaces.
  const loadSeq = useRef(0);
  useEffect(() => {
    if (jobId === null) return;
    const seq = ++loadSeq.current;
    void (async () => {
      try {
        const stored = await ipc.getPlan(jobId);
        if (seq !== loadSeq.current) return;
        setPlan(stored?.plan ?? null);
        const suggestions = await ipc.tailorList(jobId);
        if (seq !== loadSeq.current) return;
        setSuggestions(suggestions);
        setEstimatedLines(stored?.plan ? await ipc.estimatePlanLines(stored.plan) : null);
        const artifact = await ipc.getPdfArtifact(jobId);
        if (seq !== loadSeq.current) return;
        setArtifact(artifact);
        setPreviewMode("pdf");
        const versions = await ipc.listResumeVersions(jobId);
        if (seq !== loadSeq.current) return;
        setVersions(versions);
      } catch (e) {
        if (seq === loadSeq.current) toast.error(String(e));
      }
    })();
  }, [jobId]);

  // ---------------------------------------------------------------------------
  // Plan mutations — auto-save on every change; plan.config now round-trips,
  // so template/paper choices persist through the same path.
  // ---------------------------------------------------------------------------

  const saveSeq = useRef(0);
  const mutatePlan = (mutator: (p: ResumePlan) => void) => {
    if (!plan || jobId === null) return;
    const copy: ResumePlan = structuredClone(plan);
    mutator(copy);
    setPlan(copy);
    const seq = ++saveSeq.current;
    void (async () => {
      try {
        await ipc.savePlan(jobId, copy);
        const lines = await ipc.estimatePlanLines(copy);
        if (seq === saveSeq.current) setEstimatedLines(lines);
      } catch (e) {
        toast.error(String(e));
      }
    })();
  };

  /**
   * Re-runs the composer against the current Vault and merges the user's
   * curation back in: exclusions per item/bullet/achievement (matched by id)
   * and custom skills survive, so a sync never wipes manual work.
   */
  const syncFromVault = async () => {
    if (!plan || jobId === null) return;
    setSyncing(true);
    try {
      const fresh = await ipc.runComposer(jobId, plan.config);
      const prev = plan;
      const mergeItem = (item: PlanItem): PlanItem => {
        const old = [...prev.experience, ...prev.projects].find(
          (i) => i.entityType === item.entityType && i.id === item.id,
        );
        if (!old) return item;
        return {
          ...item,
          excluded: old.excluded,
          bullets: item.bullets.map((b) => ({
            ...b,
            excluded: old.bullets.find((ob) => ob.id === b.id)?.excluded ?? false,
          })),
        };
      };
      const merged: ResumePlan = {
        ...fresh,
        experience: fresh.experience.map(mergeItem),
        projects: fresh.projects.map(mergeItem),
        achievements: fresh.achievements?.map((a) => ({
          ...a,
          excluded: prev.achievements?.find((pa) => pa.id === a.id)?.excluded ?? false,
        })),
        skills: [...fresh.skills],
        excludedSkills: prev.excludedSkills ?? [],
      };
      // Custom skills that no longer exist in the Vault stay in the plan.
      for (const sk of prev.skills) {
        if (!merged.skills.some((x) => x.toLowerCase() === sk.toLowerCase())) {
          merged.skills.push(sk);
        }
      }
      merged.excludedSkills = (merged.excludedSkills ?? []).filter((sk) =>
        merged.skills.some((x) => x.toLowerCase() === sk.toLowerCase()),
      );
      setPlan(merged);
      await ipc.savePlan(jobId, merged);
      setEstimatedLines(await ipc.estimatePlanLines(merged));
      toast.ok(
        `Synced from Vault — ${merged.skills.length} skills, ${merged.achievements?.length ?? 0} achievements, ${merged.experience.length + merged.projects.length} records`,
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSyncing(false);
    }
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

  const toggleAchievement = (id: number) =>
    mutatePlan((p) => {
      const ach = p.achievements?.find((a) => a.id === id);
      if (ach) ach.excluded = !ach.excluded;
    });

  const moveAchievement = (index: number, dir: -1 | 1) =>
    mutatePlan((p) => {
      if (!p.achievements) return;
      const t = index + dir;
      if (t < 0 || t >= p.achievements.length) return;
      [p.achievements[index], p.achievements[t]] = [p.achievements[t], p.achievements[index]];
    });

  const [newSkillInput, setNewSkillInput] = useState("");

  const addCustomSkill = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newSkillInput.trim();
    if (!trimmed) return;
    mutatePlan((p) => {
      if (!p.skills.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
        p.skills.push(trimmed);
      }
      if (p.excludedSkills) {
        p.excludedSkills = p.excludedSkills.filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
      }
    });
    setNewSkillInput("");
    toast.ok(`Added skill "${trimmed}"`);
  };

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
      setPreviewMode("pdf");
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

  const pages = Math.min(3, Math.max(1, plan?.config.targetPages ?? 1));
  const capacity = (CAPACITY[templateId] ?? 56) * pages;
  const overflows = estimatedLines !== null && estimatedLines > capacity;
  // The compiled PDF can lag behind the current picks (same file path, older
  // template/paper) — surface that instead of silently showing stale output.
  const artifactStale =
    artifact != null &&
    ((artifact.templateId != null && artifact.templateId !== "" && artifact.templateId !== templateId) ||
      (artifact.paper != null && artifact.paper !== "" && artifact.paper !== paper));

  const excludedCount = useMemo(
    () =>
      plan
        ? [...plan.experience, ...plan.projects].filter((i) => i.excluded).length +
          [...plan.experience, ...plan.projects].flatMap((i) => i.bullets).filter((b) => b.excluded).length +
          (plan.achievements ?? []).filter((a) => a.excluded).length +
          (plan.excludedSkills?.length ?? 0)
        : 0,
    [plan],
  );

  // ---------------------------------------------------------------------------
  // Guard states
  // ---------------------------------------------------------------------------

  if (!loaded) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <Skeleton className="h-9 w-64" />
        <div className="mt-6 grid gap-5 lg:grid-cols-12">
          <Skeleton className="h-96 lg:col-span-5" />
          <Skeleton className="h-96 lg:col-span-7" />
        </div>
      </div>
    );
  }

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
          <p className="text-sm text-muted">No plan for this workspace yet — compose one from the Vault right here.</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Button
              onClick={() =>
                jobId !== null
                  ? void (async () => {
                      try {
                        const fresh = await ipc.runComposer(jobId);
                        setPlan(fresh);
                        setEstimatedLines(await ipc.estimatePlanLines(fresh));
                        toast.ok("Plan composed from the Vault");
                      } catch (e) {
                        toast.error(String(e));
                      }
                    })()
                  : undefined
              }
            >
              Compose from Vault
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/jobs/${jobId}`)}>Open workspace</Button>
          </div>
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
        description="Curate what goes in, pick a template, and export a polished PDF."
        actions={
          <>
            <Select
              value={jobId ?? undefined}
              onChange={(e) => setJobId(Number(e.target.value))}
              className="w-60"
            >
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.roleTitle || "Untitled role"}
                  {job.company ? ` · ${job.company}` : ""}
                </option>
              ))}
            </Select>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)_minmax(0,auto)] xl:grid-cols-[minmax(0,4fr)_minmax(0,5fr)_minmax(0,3fr)] xl:grid-rows-[minmax(0,1fr)]">
        {/* ------------------------------------------------------------- */}
        {/* LEFT — Content curation                                        */}
        {/* ------------------------------------------------------------- */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1 lg:row-span-2 xl:row-span-1">
          {/* Page fit meter */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-2.5 shadow-card">
            <span className="text-xs font-medium text-muted">Page fit</span>
            <div className="flex items-center gap-2">
              <Badge tone={estimatedLines === null ? "neutral" : overflows ? "amber" : "green"}>
                {estimatedLines === null
                  ? "no estimate"
                  : `~${estimatedLines}/${capacity} lines${overflows ? " · may overflow" : " · fits"}`}
              </Badge>
              <IconButton
                label="Sync from Vault"
                onClick={() => void syncFromVault()}
                disabled={syncing}
                title="Re-pull records, skills and achievements from the Vault (keeps your exclusions and custom skills)"
              >
                {syncing ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
              </IconButton>
            </div>
          </div>

          {/* Header summary */}
          <Card className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{plan.header.fullName || "(no name)"}</p>
                {plan.header.headline ? (
                  <p className="mt-0.5 line-clamp-2 text-xs italic text-muted">{plan.header.headline}</p>
                ) : null}
                <p className="mt-1 truncate text-[11px] text-muted/80">
                  {[plan.header.email, plan.header.phone, plan.header.location].filter(Boolean).join(" · ") || "no contact details"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingProfile(true)}
                title="Edit name, email, phone, GitHub, LinkedIn… (saved to the Vault and applied here)"
              >
                <Pencil className="size-3.5" /> Contact details
              </Button>
            </div>
          </Card>

          {/* Experience + Projects */}
          {contentSections.map(({ key, label, items, cap }) => {
            const included = items.filter((i) => !i.excluded).length;
            const atCap = included >= cap;
            return (
              <Card key={key} className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <CardTitle>
                    {label}
                    <span className={cn("ml-1.5 text-xs font-normal", atCap ? "text-amber-600 dark:text-amber-400" : "text-muted")}>
                      {included}/{cap}
                    </span>
                  </CardTitle>
                </div>
                <ul className="space-y-2">
                  {items.map((item, index) => {
                    const bulletsUsed = item.bullets.filter((b) => !b.excluded).length;
                    const usesDescription = bulletsUsed === 0 && item.description.trim().length > 0;
                    return (
                      <li
                        key={`${item.entityType}-${item.id}`}
                        className={cn(
                          "rounded-lg border p-3 transition-colors",
                          item.excluded
                            ? "border-dashed border-line bg-accent-soft opacity-60"
                            : "border-line bg-card",
                        )}
                      >
                        {/* Item header */}
                        <div className="flex items-start gap-1.5">
                          <div className="min-w-0 flex-1">
                            <p className={cn("truncate text-xs font-semibold", item.excluded ? "text-muted/70 line-through" : "text-ink")}>
                              {item.title}
                            </p>
                            <p className="truncate text-[11px] text-muted">
                              {item.subtitle ? `${item.subtitle} · ` : ""}
                              {fmtRange({ startDate: item.startDate, endDate: item.endDate, isCurrent: item.isCurrent })}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <IconButton
                              label="Move up"
                              size="sm"
                              disabled={index === 0}
                              onClick={() => moveItem(item.entityType, index, -1)}
                            >
                              <ChevronUp />
                            </IconButton>
                            <IconButton
                              label="Move down"
                              size="sm"
                              disabled={index === items.length - 1}
                              onClick={() => moveItem(item.entityType, index, 1)}
                            >
                              <ChevronDown />
                            </IconButton>
                            <IconButton
                              label={item.excluded ? "Include in resume" : "Exclude from resume"}
                              size="sm"
                              tone={item.excluded ? "neutral" : "danger"}
                              onClick={() => toggleItem(item.entityType, item.id)}
                            >
                              {item.excluded ? <CirclePlus /> : <CircleMinus />}
                            </IconButton>
                          </div>
                        </div>

                        {/* Bullets */}
                        {!item.excluded ? (
                          <div className="mt-2">
                            <p className={cn("mb-1 text-[10px] font-medium", usesDescription ? "text-kairo-blue" : "text-muted/80")}>
                              {bulletsUsed > 0
                                ? `${bulletsUsed}/${plan.config.maxBulletsPerItem} bullets shown`
                                : usesDescription
                                  ? `renders ${item.description.split("\n").filter((l) => l.trim().length > 5).length} line(s) from the record description`
                                  : "no content yet"}
                            </p>
                            <ul className="space-y-1">
                              {item.bullets.map((bullet) => {
                                const accepted = suggestions.find(
                                  (s) => s.bulletId === bullet.id && s.status === "accepted",
                                );
                                return (
                                  <li key={bullet.id} className="flex items-start gap-1.5">
                                    <span
                                      className={cn(
                                        "min-w-0 flex-1 text-[11px] leading-relaxed",
                                        bullet.excluded ? "text-muted/60 line-through" : "text-muted",
                                      )}
                                    >
                                      {accepted ? accepted.suggestedText : bullet.text}
                                      {accepted ? (
                                        <Sparkles className="ml-1 inline size-3 text-kairo-violet" aria-label="tailored" />
                                      ) : null}
                                    </span>
                                    <IconButton
                                      label={bullet.excluded ? "Include bullet" : "Exclude bullet"}
                                      size="sm"
                                      onClick={() => toggleBullet(item.entityType, item.id, bullet.id)}
                                    >
                                      {bullet.excluded ? <EyeOff /> : <Eye />}
                                    </IconButton>
                                  </li>
                                );
                              })}
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

          {/* Achievements */}
          {plan.achievements && plan.achievements.length > 0 ? (
            <Card className="p-4">
              <div className="mb-3">
                <CardTitle>
                  Achievements & Awards
                  <span className="ml-1.5 text-xs font-normal text-muted">
                    {plan.achievements.filter((a) => !a.excluded).length}/{plan.achievements.length}
                  </span>
                </CardTitle>
              </div>
              <ul className="space-y-2">
                {plan.achievements.map((ach, index) => (
                  <li
                    key={ach.id}
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      ach.excluded ? "border-dashed border-line bg-accent-soft opacity-60" : "border-line bg-card",
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-xs font-semibold", ach.excluded ? "text-muted/70 line-through" : "text-ink")}>
                          {ach.title}
                        </p>
                        <p className="truncate text-[11px] text-muted">
                          {[ach.issuer, ach.achievedOn].filter(Boolean).join(" · ")}
                        </p>
                        {ach.description ? (
                          <p className={cn("mt-1 text-[11px]", ach.excluded ? "text-muted/60 line-through" : "text-muted")}>
                            {ach.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <IconButton
                          label="Move up"
                          size="sm"
                          disabled={index === 0}
                          onClick={() => moveAchievement(index, -1)}
                        >
                          <ChevronUp />
                        </IconButton>
                        <IconButton
                          label="Move down"
                          size="sm"
                          disabled={index === (plan.achievements?.length ?? 0) - 1}
                          onClick={() => moveAchievement(index, 1)}
                        >
                          <ChevronDown />
                        </IconButton>
                        <IconButton
                          label={ach.excluded ? "Include achievement" : "Exclude achievement"}
                          size="sm"
                          tone={ach.excluded ? "neutral" : "danger"}
                          onClick={() => toggleAchievement(ach.id)}
                        >
                          {ach.excluded ? <CirclePlus /> : <CircleMinus />}
                        </IconButton>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* Skills */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <CardTitle>
                Skills
                <span className="ml-1.5 text-xs font-normal text-muted">
                  {plan.skills.filter((s) => !(plan.excludedSkills ?? []).includes(s)).length}/{plan.skills.length}
                </span>
              </CardTitle>
            </div>

            <div className="mb-3">
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-center"
                onClick={() => setShowVaultSkills((v) => !v)}
              >
                {showVaultSkills ? "Hide vault skills" : "Browse vault skills"}
              </Button>
              {showVaultSkills ? (
                <div className="mt-2 rounded-lg border border-line">
                  <div className="border-b border-line p-2">
                    <input
                      type="text"
                      placeholder={`Search ${vaultSkills.length} vault skills…`}
                      value={vaultQuery}
                      onChange={(e) => setVaultQuery(e.target.value)}
                      className="h-8 w-full rounded-md border border-line bg-card px-2.5 text-xs text-ink placeholder:text-muted/70 focus:border-kairo-blue focus:outline-none"
                    />
                  </div>
                  <div className="max-h-44 overflow-y-auto p-1.5">
                    {vaultSkills.length === 0 ? (
                      <p className="px-2 py-3 text-xs text-muted">
                        Loading vault skills…
                      </p>
                    ) : (
                      vaultSkills
                        .filter((sk) =>
                          sk.canonicalName.toLowerCase().includes(vaultQuery.trim().toLowerCase()),
                        )
                        .map((sk) => {
                          const inPlan = plan.skills.some(
                            (x) => x.toLowerCase() === sk.canonicalName.toLowerCase(),
                          );
                          return (
                            <label
                              key={sk.id}
                              className={cn(
                                "flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-ink",
                                inPlan ? "bg-kairo-blue/5 dark:bg-kairo-blue/10" : "hover:bg-accent-soft",
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={inPlan}
                                  onChange={() => {
                                    mutatePlan((p) => {
                                      const lower = sk.canonicalName.toLowerCase();
                                      if (inPlan) {
                                        p.skills = p.skills.filter((x) => x.toLowerCase() !== lower);
                                        p.excludedSkills = (p.excludedSkills ?? []).filter(
                                          (x) => x.toLowerCase() !== lower,
                                        );
                                      } else {
                                        if (!p.skills.some((x) => x.toLowerCase() === lower)) {
                                          p.skills.push(sk.canonicalName);
                                        }
                                        p.excludedSkills = (p.excludedSkills ?? []).filter(
                                          (x) => x.toLowerCase() !== lower,
                                        );
                                      }
                                    });
                                  }}
                                  className="h-4 w-4 rounded border-line-strong accent-kairo-blue"
                                />
                                {sk.canonicalName}
                              </span>
                              <span className="text-[10px] uppercase tracking-wide text-muted">{sk.category}</span>
                            </label>
                          );
                        })
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <form onSubmit={addCustomSkill} className="mb-3 flex gap-1.5">
              <input
                type="text"
                placeholder="Add a skill (e.g. Docker)…"
                value={newSkillInput}
                onChange={(e) => setNewSkillInput(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-line bg-card px-2.5 py-1.5 text-xs text-ink placeholder:text-muted/70 focus:border-kairo-blue focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newSkillInput.trim()}
                className="flex items-center gap-1 rounded-md bg-kairo-blue/10 px-2.5 py-1.5 text-xs font-medium text-kairo-blue transition-colors hover:bg-kairo-blue/20 disabled:opacity-40 dark:bg-kairo-blue/20"
              >
                <Plus className="size-3.5" /> Add
              </button>
            </form>

            {plan.skills.length === 0 ? (
              <p className="text-[11px] text-muted/80">
                No skills yet — add one above, or link skills to records in the Vault.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {plan.skills.map((skill) => {
                  const excluded = (plan.excludedSkills ?? []).includes(skill);
                  return (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      title={excluded ? "Click to include" : "Click to exclude"}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                        excluded
                          ? "border-line bg-accent-soft text-muted/70 line-through"
                          : "border-kairo-blue/30 bg-kairo-blue/5 text-kairo-blue hover:bg-kairo-blue/10 dark:bg-kairo-blue/15",
                      )}
                    >
                      {skill}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {excludedCount > 0 ? (
            <p className="px-1 pb-1 text-[11px] text-muted/80">
              {excludedCount} item(s) excluded — they won't appear in the PDF.
            </p>
          ) : null}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* CENTER — Preview                                               */}
        {/* ------------------------------------------------------------- */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle>Preview</CardTitle>
              {artifact?.pageCount ? <Badge tone="neutral">{artifact.pageCount} page(s)</Badge> : null}
              {artifact?.templateId ? (
                <Badge tone={artifactStale ? "amber" : "blue"}>
                  {TEMPLATES.find((t) => t.id === artifact.templateId)?.name ?? artifact.templateId}
                </Badge>
              ) : null}
            </div>
            {artifact ? (
              <Tabs
                tabs={[
                  { id: "pdf", label: "PDF" },
                  { id: "plan", label: "Plan layout" },
                ]}
                active={previewMode}
                onChange={(id) => setPreviewMode(id as "pdf" | "plan")}
              />
            ) : null}
          </div>

          {artifactStale ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-warn-soft px-4 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:text-amber-200">
              <span>
                The PDF on disk was compiled as{" "}
                <strong>{TEMPLATES.find((t) => t.id === artifact?.templateId)?.name ?? artifact?.templateId ?? "an older template"}</strong>
                {artifact?.paper ? <span> · {artifact.paper === "a4" ? "A4" : "Letter"}</span> : null} — your picks changed.
              </span>
              <Button size="sm" variant="secondary" onClick={() => void exportPdf()} disabled={exporting}>
                {exporting ? "Compiling…" : "Recompile"}
              </Button>
            </div>
          ) : null}

          {previewMode === "pdf" && artifact ? (
            <PdfViewer
              key={artifact.compiledAt ?? artifact.pdfPath}
              pdfPath={artifact.pdfPath}
              candidateName={plan.header.fullName}
              className="min-h-0 flex-1"
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-accent-soft p-4 ring-1 ring-line">
              <PlanPreview plan={plan} suggestions={suggestions} />
              {artifact ? (
                <p className="mt-3 text-center text-[11px] text-muted">
                  The compiled PDF reflects the plan at export time — re-export after edits.
                </p>
              ) : (
                <p className="mt-3 text-center text-[11px] text-muted">
                  Export the PDF to see the real compiled output.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* RIGHT — Template & export rail                                 */}
        {/* ------------------------------------------------------------- */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pl-0 lg:col-start-2 xl:col-start-3 xl:row-start-1 lg:pr-1">
          {/* Template picker */}
          <Card className="p-4">
            <CardTitle>Template</CardTitle>
            <div className="mt-3 flex flex-col gap-2">
              {TEMPLATES.map((t) => {
                const active = templateId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => mutatePlan((p) => { p.config.templateId = t.id; })}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-2.5 text-left transition-all",
                      active
                        ? "border-kairo-blue/60 bg-kairo-blue/5 ring-1 ring-kairo-blue/40 dark:bg-kairo-blue/10"
                        : "border-line bg-card hover:border-line-strong hover:shadow-sm",
                    )}
                  >
                    <TemplateThumb id={t.id} active={active} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                        {t.name}
                        {active ? <Badge tone="blue">selected</Badge> : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-tight text-muted">{t.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted">Paper</span>
                <Select
                  value={paper}
                  onChange={(e) => mutatePlan((p) => { p.config.paper = e.target.value; })}
                  className="w-24 py-1 text-xs"
                >
                  <option value="letter">Letter</option>
                  <option value="a4">A4</option>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted">Target pages</span>
                <Select
                  value={String(pages)}
                  onChange={(e) => mutatePlan((p) => { p.config.targetPages = Number(e.target.value); })}
                  className="w-24 py-1 text-xs"
                >
                  <option value="1">1 page</option>
                  <option value="2">2 pages</option>
                  <option value="3">3 pages</option>
                </Select>
              </div>
            </div>
          </Card>

          {/* Export */}
          <Card className="p-4">
            <CardTitle>Export</CardTitle>
            <Button
              className="mt-3 w-full justify-center"
              onClick={() => void exportPdf()}
              disabled={exporting}
              title="Compile to PDF with Tectonic (first run downloads TeX packages)"
            >
              {exporting ? (
                <>
                  <Spinner className="size-4" /> Compiling…
                </>
              ) : (
                "Export PDF"
              )}
            </Button>
            {overflows ? (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                Estimate exceeds {pages} page{pages > 1 ? "s" : ""} for this template — raise "Target pages" or trim content, and check the page count after export.
              </p>
            ) : null}

            {artifact ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">Compiled</span>
                  {artifact.pageCount ? (
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      · {artifact.pageCount} page(s)
                    </span>
                  ) : null}
                  <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400/70">
                    · {fmtAgo(artifact.compiledAt)}
                  </span>
                </div>
                <p className="mt-2 font-mono text-[10px] break-all text-emerald-800/80 select-all dark:text-emerald-300/70">
                  {artifact.pdfPath}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-emerald-200/70 pt-2 dark:border-emerald-500/20">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[11px]"
                    onClick={() =>
                      void ipc
                        .savePdfToDownloads(
                          artifact.pdfPath,
                          `${plan.header.fullName.replace(/\s+/g, "_") || "Resume"}.pdf`,
                        )
                        .then((p) => toast.ok(`Saved copy to Downloads: ${p}`))
                        .catch((e) => toast.error(String(e)))
                    }
                  >
                    <FileDown className="size-3.5" /> Downloads
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => void ipc.revealFile(artifact.pdfPath).catch((e) => toast.error(String(e)))}
                  >
                    <FolderOpen className="size-3.5" /> Reveal
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => void ipc.openFile(artifact.pdfPath).catch((e) => toast.error(String(e)))}
                  >
                    <ExternalLink className="size-3.5" /> Open
                  </Button>
                  <IconButton
                    label="Copy path"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(artifact.pdfPath)
                        .then(() => toast.ok("Path copied to clipboard"))
                        .catch((e) => toast.error(`Copy failed: ${String(e)}`));
                    }}
                  >
                    <Copy />
                  </IconButton>
                </div>
              </div>
            ) : null}
          </Card>

          {/* Versions */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <CardTitle>Saved versions</CardTitle>
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
              <ul className="mt-3 space-y-1">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[11px]"
                  >
                    <span className="font-medium text-ink">v{v.versionNumber}</span>
                    <span className="text-muted">{fmtAgo(v.createdAt)}</span>
                    <button
                      type="button"
                      onClick={() => void ipc.openFile(v.pdfPath).catch((e: unknown) => toast.error(String(e)))}
                      className="shrink-0 text-kairo-blue hover:underline"
                    >
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-muted/80">No versions saved yet.</p>
            )}
          </Card>
        </div>
      </div>

      <ProfileDialog
        open={editingProfile}
        profile={profile ?? {
          fullName: plan.header.fullName,
          headline: plan.header.headline,
          email: plan.header.email,
          phone: plan.header.phone,
          location: plan.header.location,
          website: plan.header.website,
          github: plan.header.github,
          linkedin: plan.header.linkedin,
          summary: "",
        }}
        onClose={() => setEditingProfile(false)}
        onSaved={(p) => {
          setProfile(p);
          // Apply immediately to the plan snapshot so the next export uses it.
          mutatePlan((plan) => {
            plan.header = {
              fullName: p.fullName,
              headline: p.headline,
              email: p.email,
              phone: p.phone,
              location: p.location,
              website: p.website,
              github: p.github,
              linkedin: p.linkedin,
            };
          });
        }}
      />
    </div>
  );
}
