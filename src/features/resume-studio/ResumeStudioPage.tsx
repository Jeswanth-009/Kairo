import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  CircleCheck,
  FileText,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Undo2,
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
import { enqueuePlanSave, flushPlanSave } from "../../lib/planAutosave";
import { usePlanSaveStatus } from "../../lib/usePlanSaveStatus";
import { usePdfProgress } from "../../lib/pdfProgress";
import { fmtAgo, fmtRange } from "../../lib/dateFmt";
import { PdfViewer } from "./PdfViewer";
import { SaveStatusChip } from "./SaveStatusChip";
import { TailorTab } from "../jobs/TailorTab";
import type {
  Job,
  JobRequirement,
  PdfArtifact,
  PdfStatusView,
  PlanItem,
  Profile,
  ResumePlan,
  ResumeTemplateId,
  ResumeVersion,
  Skill,
  TailorSuggestion,
} from "../../lib/types";
import { toast } from "../../stores/toastStore";
import { useTopBarStore } from "../../stores/topBarStore";

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
    suggestions.find((s) => s.bulletId === bulletId && s.status === "accepted" &&
      (s.validation.ok || s.model === "manual") && s.suggestedText.trim().length > 0);

  const excluded = plan.excludedSkills ?? [];
  const includedSkills = plan.skills.filter((s) => !excluded.includes(s));
  const grouped = (plan.skillsGrouped ?? []).filter(
    (g) => g.skills.filter((s) => !excluded.includes(s)).length > 0,
  );
  const groupedNames = new Set(grouped.flatMap((g) => g.skills.map((s) => s.toLowerCase())));
  const additionalSkills = includedSkills.filter((s) => !groupedNames.has(s.toLowerCase()));
  const groups = additionalSkills.length > 0
    ? [...grouped, { category: "Additional", skills: additionalSkills }]
    : grouped;

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
              <span className="shrink-0 text-xs text-neutral-500">
                {fmtRange({ startDate: item.startDate, endDate: item.endDate, isCurrent: item.isCurrent })}
              </span>
            </div>
            {role || location ? (
              <p className="text-xs text-neutral-500">
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
        <p className="mt-1 text-xs text-neutral-500">
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
                <span className="text-xs text-neutral-500">
                  {fmtRange({ startDate: e.startDate, endDate: e.endDate, isCurrent: e.isCurrent })}
                </span>
              </div>
              <span className="text-xs text-neutral-600">
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
                  <span className="shrink-0 text-xs text-neutral-500">
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
  // Job-scoped routing: the editor always belongs to the job in the URL.
  // No param is treated as a navigation mistake — never silently open the
  // first job in the list (that is how users edit the wrong resume).
  // The URL is the single source of job identity: the visible job, the saved
  // plan, undo history, and the export target are all this one id, and the
  // picker below navigates instead of mutating local state.
  const params = useParams();
  const routeJobId = params.jobId ? Number(params.jobId) : null;
  const jobId = routeJobId;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobMissing, setJobMissing] = useState(false);
  const [plan, setPlan] = useState<ResumePlan | null>(null);
  const [suggestions, setSuggestions] = useState<TailorSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [estimatedLines, setEstimatedLines] = useState<number | null>(null);
  const [artifact, setArtifact] = useState<PdfArtifact | null>(null);
  const [pdfStatus, setPdfStatus] = useState<PdfStatusView | null>(null);
  const [exporting, setExporting] = useState(false);
  const pdfProgress = usePdfProgress(exporting);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [savingVersion, setSavingVersion] = useState(false);
  const [previewMode, setPreviewMode] = useState<"pdf" | "plan" | "design">("pdf");
  const [aiWritingOpen, setAiWritingOpen] = useState(false);
  const [showFilesPanel, setShowFilesPanel] = useState(false);
  useEffect(() => {
    if (!aiWritingOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAiWritingOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [aiWritingOpen]);
  // Ephemeral, in-session only: the failed-export overlay. Durable PDF state
  // (stale / template-stale / current) always comes from the backend status.
  const [exportFailed, setExportFailed] = useState(false);

  const historyRef = useRef<ResumePlan[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const saveStatus = usePlanSaveStatus(jobId);

  const templateId = (plan?.config.templateId ?? "jake") as ResumeTemplateId;
  const paper = plan?.config.paper ?? "letter";
  const [syncing, setSyncing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [showVaultSkills, setShowVaultSkills] = useState(false);
  const [vaultSkills, setVaultSkills] = useState<Skill[]>([]);
  const [roleRequirements, setRoleRequirements] = useState<JobRequirement[]>([]);
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
        if (routeJobId === null) {
          // No job in the URL: route to the Jobs list instead of guessing.
          navigate("/jobs");
          toast.error("Open the Resume Studio from a specific job workspace.");
          return;
        }
        if (!list.some((j) => j.id === routeJobId)) {
          // A deleted or bad id: a recovery screen, not a silent redirect —
          // the user should know why they landed nowhere.
          setJobMissing(true);
        }
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoaded(true);
      }
    })();
  }, [routeJobId]);

  // Stale-response guard: rapidly switching jobs must never interleave
  // plan/artifact/version state from two different workspaces.
  const loadSeq = useRef(0);
  // Mirror of the loaded plan for the autosave queue: null between job
  // switches so a mutation can never write the old job's plan into the new
  // job while its own plan is still loading.
  const planRef = useRef<ResumePlan | null>(null);
  useEffect(() => {
    if (jobId === null) return;
    const seq = ++loadSeq.current;
    planRef.current = null;
    // Everything session-scoped belongs to the job, not the page: undo
    // history and export state must never leak across workspaces.
    historyRef.current = [];
    setCanUndo(false);
    setExportFailed(false);
    setAiWritingOpen(false);
    void (async () => {
      try {
        const stored = await ipc.getPlan(jobId);
        const requirements = await ipc.listRequirements(jobId);
        if (seq !== loadSeq.current) return;
        setRoleRequirements(requirements);
        planRef.current = stored?.plan ?? null;
        setPlan(stored?.plan ?? null);
        const suggestions = await ipc.tailorList(jobId);
        if (seq !== loadSeq.current) return;
        setSuggestions(suggestions);
        setEstimatedLines(stored?.plan ? await ipc.estimatePlanLines(stored.plan) : null);
        const [artifact, status] = await Promise.all([
          ipc.getPdfArtifact(jobId),
          ipc.getPdfStatus(jobId),
        ]);
        if (seq !== loadSeq.current) return;
        setArtifact(artifact);
        setPdfStatus(status);
        setPreviewMode("pdf");
        const versions = await ipc.listResumeVersions(jobId);
        if (seq !== loadSeq.current) return;
        setVersions(versions);
      } catch (e) {
        if (seq === loadSeq.current) toast.error(String(e));
      }
    })();
  }, [jobId]);

  // Every save that lands changes the saved-vs-artifact relationship —
  // refresh the authoritative status when the queue goes quiet.
  useEffect(() => {
    if (jobId === null) return;
    if (saveStatus !== "saved") return;
    let alive = true;
    ipc
      .getPdfStatus(jobId)
      .then((s) => {
        if (alive) setPdfStatus(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [jobId, saveStatus]);

  // ---------------------------------------------------------------------------
  // Plan mutations — auto-save on every change through the shared serialized
  // queue (one writer per job, latest snapshot always wins). plan.config now
  // round-trips, so template/paper choices persist through the same path.
  // ---------------------------------------------------------------------------

  const saveSeq = useRef(0);
  const mutatePlan = (mutator: (p: ResumePlan) => void) => {
    if (jobId === null) return;
    const current = planRef.current;
    if (!current) return;
    historyRef.current.push(current);
    if (historyRef.current.length > 10) historyRef.current.shift();
    setCanUndo(true);
    const copy: ResumePlan = structuredClone(current);
    mutator(copy);
    planRef.current = copy;
    setPlan(copy);
    const seq = ++saveSeq.current;
    enqueuePlanSave(jobId, copy);
    void ipc
      .estimatePlanLines(copy)
      .then((lines) => {
        if (seq === saveSeq.current) setEstimatedLines(lines);
      })
      .catch(() => {/* real save failures surface via the save status chip */});
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
      const prev = plan;      const mergeItem = (item: PlanItem): PlanItem => {
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
      planRef.current = merged;
      setPlan(merged);
      enqueuePlanSave(jobId, merged);
      // The toast should only promise a synced Vault once the plan is on disk.
      const flush = await flushPlanSave(jobId);
      if (!flush.ok) {
        toast.error(flush.error);
        return;
      }
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

  /** Restore the last plan state; the restored state persists too. */
  const undoPlan = () => {
    const previous = historyRef.current.pop();
    if (!previous || jobId === null) return;
    planRef.current = previous;
    setPlan(previous);
    setCanUndo(historyRef.current.length > 0);
    enqueuePlanSave(jobId, previous);
  };

  // ---------------------------------------------------------------------------
  // Export / versions
  // ---------------------------------------------------------------------------

  const exportPdf = async () => {
    if (jobId === null) return;
    setExporting(true);
    try {
      // Export must describe the SAVED draft: flush the queue first, then
      // pass the persisted revision so the backend refuses a stale compile.
      // A flush that could not persist everything refuses to hand out a
      // revision — exporting then would silently build on unknown content.
      const flush = await flushPlanSave(jobId);
      if (!flush.ok) {
        toast.error(flush.error);
        return;
      }
      const result = await ipc.exportPdf(jobId, templateId, flush.revision);
      setArtifact(result.artifact);
      setPdfStatus(await ipc.getPdfStatus(jobId));
      setPreviewMode("pdf");
      setExportFailed(false);
      toast.ok(`PDF compiled — ${result.artifact.pageCount ?? "?"} page(s)`);
    } catch (e) {
      // The staging export never touched the previous good PDF — say so.
      setExportFailed(true);
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

  // The version gate is the recorded review of THIS artifact — the backend
  // refuses to freeze an unreviewed PDF, so the button state mirrors it.
  const reviewed =
    pdfStatus?.pdfHash != null && pdfStatus.reviewedPdfHash === pdfStatus.pdfHash;
  const [markingReviewed, setMarkingReviewed] = useState(false);
  const markReviewed = async () => {
    if (jobId === null) return;
    setMarkingReviewed(true);
    try {
      await ipc.markArtifactReviewed(jobId);
      setPdfStatus(await ipc.getPdfStatus(jobId));
      toast.ok("Marked reviewed — this exact PDF is what you checked.");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setMarkingReviewed(false);
    }
  };

  // The shell's TopBar mirrors this workspace: location trail, save state,
  // and the single primary action. exportPdf is read through a ref so the
  // published action always runs the latest closure.
  const exportPdfRef = useRef(exportPdf);
  useEffect(() => {
    exportPdfRef.current = exportPdf;
  });
  const jobTitle = jobs.find((j) => j.id === jobId)?.roleTitle || "Workspace";
  useEffect(() => {
    if (jobId === null) return;
    useTopBarStore.getState().set({
      crumbs: [
        { label: "Jobs", to: "/jobs" },
        { label: jobTitle, to: `/jobs/${jobId}` },
        { label: "Resume" },
      ],
      saveState: saveStatus === "idle" ? "saved" : saveStatus,
      primaryAction: {
        label: exporting ? "Compiling…" : "Export PDF",
        onClick: () => void exportPdfRef.current(),
        disabled: exporting,
      },
    });
  }, [jobId, saveStatus, exporting, jobTitle]);

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  const pages = Math.min(3, Math.max(1, plan?.config.targetPages ?? 1));
  const capacity = (CAPACITY[templateId] ?? 56) * pages;
  const overflows = estimatedLines !== null && estimatedLines > capacity;
  // Durable PDF truth: derived by the backend from the saved revision vs the
  // artifact revision (plus template/paper and file existence).
  const pdfState = pdfStatus?.state ?? "none";
  const artifactStale = pdfState === "template-stale";

  // The one status the whole page agrees on. Order matters: a failed export
  // (previous PDF still shown) outranks a draft, which outranks saving.
  const studioStatus: { label: string; tone: string } = exportFailed
    ? { label: "Export failed — showing the previous good PDF", tone: "bad" }
    : pdfState === "none"
      ? { label: "Draft — no PDF yet", tone: "neutral" }
      : saveStatus === "saving"
        ? { label: "Saving…", tone: "muted" }
        : saveStatus === "error"
          ? { label: "Couldn't save — retry from the chip", tone: "bad" }
          : pdfState === "missing-file"
            ? { label: "PDF file is missing — export to recreate it", tone: "bad" }
            : pdfState === "stale" || pdfState === "template-stale"
              ? { label: "PDF needs update — your changes came after the export", tone: "warn" }
              : { label: "Current PDF", tone: "ok" };

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

  if (jobMissing) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-ink">This workspace no longer exists</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            The job at <code className="rounded bg-accent-soft px-1.5 py-0.5">/jobs/{jobId}/resume</code> was
            deleted or the link is stale. Your other workspaces are on the Jobs page.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Button onClick={() => navigate("/jobs")}>Go to Jobs</Button>
            <Button variant="secondary" onClick={() => navigate("/applications")}>Applications</Button>
          </div>
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
                        // The empty state bypasses mutatePlan, so wire the
                        // composed plan into the same session state every
                        // edit path relies on — otherwise the first click
                        // after composing silently no-ops.
                        historyRef.current = [];
                        setCanUndo(false);
                        planRef.current = fresh;
                        setPlan(fresh);
                        setEstimatedLines(await ipc.estimatePlanLines(fresh));
                        enqueuePlanSave(jobId, fresh);
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
  const roleText = ` ${roleRequirements.map((r) => r.rawText).join(" ").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ")} `;
  const skillMentioned = (name: string) => roleText.includes(` ${name.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim()} `);

  // Everything below renders per-job controls; a plan only exists once a job
  // is selected (plans load with the job, and mutatePlan guards null).
  if (jobId === null) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="Resume Studio"
        description="Choose your evidence, write with or without AI, and review the exact PDF."
        actions={
          <>
            <SaveStatusChip jobId={jobId} />
            <Button
              variant="secondary"
              onClick={() => void (async () => {
                const flushed = await flushPlanSave(jobId);
                if (!flushed.ok) {
                  toast.error(flushed.error ?? "Save the draft before requesting AI suggestions.");
                  return;
                }
                setAiWritingOpen(true);
              })()}
            >
              <Sparkles className="size-4" aria-hidden /> AI writing
            </Button>
            <Button variant="secondary" onClick={() => setShowFilesPanel((open) => !open)} aria-expanded={showFilesPanel}>
              <FolderOpen className="size-4" aria-hidden /> {showFilesPanel ? "Hide files" : "Files & versions"}
            </Button>
            <Select
              value={jobId ?? undefined}
              onChange={(e) => navigate(`/jobs/${Number(e.target.value)}/resume`)}
              className="w-60"
              title="Switch workspace — the editor follows the URL"
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

      <div
        data-testid="studio-status"
        role="status"
        className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs font-medium shadow-card ${
          studioStatus.tone === "bad"
            ? "border-bad/30 bg-bad-soft text-bad dark:border-red-500/30 dark:bg-bad/10 dark:text-red-300"
            : studioStatus.tone === "warn"
              ? "border-warn/30 bg-warn-soft text-warn dark:border-warn/25 dark:bg-warn/10 dark:text-kairo-dawn"
              : studioStatus.tone === "ok"
                ? "border-ok/30 bg-ok-soft text-ok dark:border-ok/25 dark:bg-ok/10 dark:text-emerald-300"
                : "border-line bg-card text-muted"
        }`}
      >
        <span className="flex items-center gap-2">
          {studioStatus.tone === "ok" ? (
            <CircleCheck className="size-3.5" aria-hidden />
          ) : studioStatus.tone === "bad" ? (
            <TriangleAlert className="size-3.5" aria-hidden />
          ) : (
            <FileText className="size-3.5" aria-hidden />
          )}
          {studioStatus.label}
        </span>
        <span className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            data-testid="studio-undo"
            onClick={undoPlan}
            disabled={!canUndo}
            title="Restore the previous plan state"
          >
            <Undo2 className="size-3.5" /> Undo
          </Button>
          {artifact === null || exportFailed || studioStatus.tone === "warn" ? (
            <Button size="sm" onClick={() => void exportPdf()} disabled={exporting}>
              {exporting ? "Compiling…" : "Export PDF"}
            </Button>
          ) : null}
        </span>
      </div>

      <div className={cn(
        "grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-rows-[minmax(0,1fr)]",
        showFilesPanel
          ? "lg:grid-cols-[minmax(290px,3fr)_minmax(0,5fr)_minmax(260px,3fr)]"
          : "lg:grid-cols-[minmax(320px,2fr)_minmax(0,4fr)]",
      )}>
        {/* ------------------------------------------------------------- */}
        {/* LEFT — Content curation                                        */}
        {/* ------------------------------------------------------------- */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
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
                <p className="mt-1 truncate text-xs text-muted/80">
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
                    <span className={cn("ml-1.5 text-xs font-normal", atCap ? "text-warn dark:text-amber-400" : "text-muted")}>
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
                            <p className="truncate text-xs text-muted">
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
                              label={item.excluded ? "Include" : "Exclude"}
                              title={item.excluded ? "Include this record in the resume" : "Exclude this record from the resume"}
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
                                  (s) => s.bulletId === bullet.id && s.status === "accepted" &&
                                    (s.validation.ok || s.model === "manual") && s.suggestedText.trim().length > 0,
                                );
                                return (
                                  <li key={bullet.id} className="flex items-start gap-1.5">
                                    <span className="min-w-0 flex-1">
                                      <span
                                        className={cn(
                                          "block text-xs leading-relaxed",
                                          bullet.excluded ? "text-muted/60 line-through" : "text-muted",
                                        )}
                                      >
                                        {accepted ? accepted.suggestedText : bullet.text}
                                        {accepted ? (
                                          <Sparkles className="ml-1 inline size-3 text-kairo-violet" aria-label="tailored" />
                                        ) : null}
                                      </span>
                                      <span
                                        data-testid="bullet-source"
                                        className="mt-0.5 block text-[10px] text-muted/70"
                                      >
                                        from {item.title}
                                        {bullet.supports.length > 0
                                          ? ` · evidence: ${bullet.supports.join(", ")}`
                                          : " · no evidence linked yet"}
                                      </span>
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
                        <p className="truncate text-xs text-muted">
                          {[ach.issuer, ach.achievedOn].filter(Boolean).join(" · ")}
                        </p>
                        {ach.description ? (
                          <p className={cn("mt-1 text-xs", ach.excluded ? "text-muted/60 line-through" : "text-muted")}>
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
            <p className="mb-3 text-sm leading-relaxed text-muted">
              Choose the skills for this resume. Your full library is on the Skills screen; skills appear here only when you select them.
            </p>

            <div className="mb-3">
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-center"
                onClick={() => setShowVaultSkills((v) => !v)}
              >
                {showVaultSkills ? "Hide skill library" : "Choose from skill library"}
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
                      [...vaultSkills]
                        .filter((sk) =>
                          sk.canonicalName.toLowerCase().includes(vaultQuery.trim().toLowerCase()),
                        )
                        .sort((a, b) => Number(skillMentioned(b.canonicalName)) - Number(skillMentioned(a.canonicalName)) || a.canonicalName.localeCompare(b.canonicalName))
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
                              <span className="flex items-center gap-1 text-xs text-muted">
                                {skillMentioned(sk.canonicalName) ? <Badge tone="blue">In role</Badge> : null}
                                {sk.category}
                              </span>
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
              <p className="text-xs text-muted/80">
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
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
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
            <p className="px-1 pb-1 text-xs text-muted/80">
              {excludedCount} item(s) excluded — they won't appear in the PDF.
            </p>
          ) : null}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* CENTER — Preview (the PDF is the point of this screen)         */}
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
                  { id: "design", label: "Design" },
                ]}
                active={previewMode}
                onChange={(id) => setPreviewMode(id as "pdf" | "plan" | "design")}
              />
            ) : null}
          </div>

          {artifactStale ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-2.5 text-xs text-amber-800 dark:border-warn/30 dark:text-kairo-dawn">
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

          {previewMode === "design" ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl bg-accent-soft p-4 ring-1 ring-line">
              {/* Secondary Design area: template controls live here, so the
                  PDF — not the template picker — leads the screen. */}
              <div className="rounded-xl border border-line bg-card p-4">
                <p className="text-sm font-semibold text-ink">Template</p>
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
                          <span className="mt-0.5 block text-xs leading-tight text-muted">{t.desc}</span>
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
              </div>
              <p className="text-center text-xs text-muted">
                Changes save with the draft — switch back to PDF and export to see them compiled.
              </p>
            </div>
          ) : previewMode === "pdf" && artifact && jobId !== null ? (
            <PdfViewer
              key={artifact.pdfHash ?? artifact.compiledAt ?? artifact.pdfPath}
              jobId={jobId}
              candidateName={plan.header.fullName}
              className="min-h-0 flex-1"
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-accent-soft p-4 ring-1 ring-line">
              <PlanPreview plan={plan} suggestions={suggestions} />
              {artifact ? (
                <p className="mt-3 text-center text-xs text-muted">
                  The compiled PDF reflects the plan at export time — re-export after edits.
                </p>
              ) : (
                <p className="mt-3 text-center text-xs text-muted">
                  Export the PDF to see the real compiled output.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* RIGHT — Template & export rail                                 */}
        {/* ------------------------------------------------------------- */}
        {showFilesPanel ? <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
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
            {exporting ? (
              <div className="mt-3 rounded-lg border border-line bg-accent-soft p-3">
                <p className="text-xs leading-relaxed text-muted">
                  {pdfProgress.waiting
                    ? "Starting the compiler… the very first run also downloads the TeX bundle, which can take a few minutes."
                    : "Compiler output — first run downloads the TeX bundle and can take a few minutes."}
                </p>
                {pdfProgress.lines.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-muted/80">
                    {pdfProgress.lines.map((line, i) => (
                      <li key={i} className="truncate">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {overflows ? (
              <p className="mt-2 text-xs leading-relaxed text-warn dark:text-amber-400">
                Estimate exceeds {pages} page{pages > 1 ? "s" : ""} for this template — raise "Target pages" or trim content, and check the page count after export.
              </p>
            ) : null}

            {artifact ? (
              <div className="mt-3 rounded-lg border border-ok/30 bg-ok-soft/70 p-3 dark:border-emerald-500/30 dark:bg-ok/10">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">Compiled</span>
                  {artifact.pageCount ? (
                    <span className="text-xs text-ok dark:text-emerald-400">
                      · {artifact.pageCount} page(s)
                    </span>
                  ) : null}
                  <span className="text-xs text-ok/80 dark:text-emerald-400/70">
                    · {fmtAgo(artifact.compiledAt)}
                  </span>
                </div>
                <p className="mt-2 font-mono text-[10px] break-all text-emerald-800/80 select-all dark:text-emerald-300/70">
                  {artifact.pdfPath}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-ok/30/70 pt-2 dark:border-emerald-500/20">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    onClick={() =>
                      void ipc
                        .saveJobPdfToDownloads(
                          jobId,
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
                    className="h-7 text-xs"
                    onClick={() => void ipc.revealJobPdf(jobId).catch((e) => toast.error(String(e)))}
                  >
                    <FolderOpen className="size-3.5" /> Reveal
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => void ipc.openJobPdf(jobId).catch((e) => toast.error(String(e)))}
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
                disabled={savingVersion || !artifact || pdfState !== "current" || !reviewed}
                title={
                  !artifact
                    ? "Export the PDF first"
                    : pdfState !== "current"
                      ? "Save the plan and recompile so the version freezes the current PDF"
                      : !reviewed
                        ? "Mark this exact PDF reviewed first (below or in the Review stage)"
                        : "Freeze this plan + PDF as a version"
                }
              >
                {savingVersion ? "Saving…" : "Save version"}
              </Button>
            </div>
            {artifact ? (
              <div className="mt-3 flex items-start justify-between gap-2 rounded-lg border border-line bg-accent-soft px-3 py-2.5 text-xs leading-relaxed text-muted">
                {reviewed ? (
                  <span>
                    <span className="font-medium text-ok">Reviewed</span>
                    {pdfStatus?.reviewedAt ? ` · ${pdfStatus.reviewedAt}` : ""} — this exact PDF
                    ({artifact.pageCount ?? "?"} page(s) for {plan.header.fullName || "you"}) was
                    checked by you. Any new export resets this.
                  </span>
                ) : (
                  <>
                    <span>
                      <span className="font-medium text-ink">Not reviewed yet</span> — every
                      version must freeze a PDF you actually looked at. Read the PDF, then mark it.
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="shrink-0 text-xs"
                      onClick={() => void markReviewed()}
                      disabled={markingReviewed}
                    >
                      {markingReviewed ? "Marking…" : "Mark reviewed"}
                    </Button>
                  </>
                )}
              </div>
            ) : null}
            {versions.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-ink">v{v.versionNumber}</span>
                    <span className="text-muted">{fmtAgo(v.createdAt)}</span>
                    <button
                      type="button"
                      onClick={() => void ipc.openVersionPdf(v.id).catch((e: unknown) => toast.error(String(e)))}
                      className="shrink-0 text-kairo-blue hover:underline"
                    >
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted/80">No versions saved yet.</p>
            )}
          </Card>
        </div> : null}
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
      {aiWritingOpen ? (
        <div className="fixed inset-0 z-50 bg-[#0B1020]/75 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label="AI writing studio">
          <div className="mx-auto flex h-full max-w-[1440px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-line bg-card px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Sparkles className="size-5 text-kairo-violet" aria-hidden /> AI writing studio</h2>
                <p className="text-sm text-muted">Compare each suggestion with your approved wording. Nothing changes until you accept it.</p>
              </div>
              <Button variant="secondary" onClick={() => setAiWritingOpen(false)}>Return to resume</Button>
            </div>
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
              <div className="min-h-0 overflow-y-auto p-5">
                <TailorTab
                  jobId={jobId}
                  onComposePlan={() => setAiWritingOpen(false)}
                  onSuggestionsChange={() => {
                    void ipc.tailorList(jobId).then(setSuggestions).catch((e) => toast.error(String(e)));
                    void ipc.getPdfStatus(jobId).then(setPdfStatus).catch(() => {});
                  }}
                />
              </div>
              <div className="hidden min-h-0 overflow-y-auto border-l border-line bg-accent-soft p-5 lg:block">
                <p className="mb-3 text-sm font-semibold text-ink">Resume preview</p>
                <PlanPreview plan={plan} suggestions={suggestions} />
                <p className="mt-3 text-sm text-muted">Export again after accepting wording to update the PDF.</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
