import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileUp, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Feedback";
import { Field, Input, Textarea } from "../../components/ui/inputs";
import { cn } from "../../lib/cn";
import { ipc } from "../../lib/ipc";
import { enqueuePlanSave, flushPlanSave } from "../../lib/planAutosave";
import { extractTextFromFile } from "../imports/extractFile";
import { PdfViewer } from "../resume-studio/PdfViewer";
import { originBadge, utcNow } from "../../lib/origin";
import type {
  Job,
  PdfArtifact,
  JobRequirement,
  MatchReport,
  ResumePlan,
  ResumeImport,
  SkillCategory,
} from "../../lib/types";
import { useJobsStore } from "../../stores/jobsStore";
import { useVaultStore } from "../../stores/vaultStore";
import { toast } from "../../stores/toastStore";

/**
 * The guided first run (Phase "rebuild the first-use experience"):
 * welcome → bring a resume → review the facts → add a role → first draft.
 * The Vault is populated through this flow; AI, evidence and applications
 * come later. Imported records always carry their provenance honestly.
 */

/** Mirrors the backend cap in `import_commands.rs`. */
const MAX_IMPORT_CHARS = 1_000_000;

type Step = "welcome" | "import" | "review" | "path" | "role" | "draft";

const STEPS: { id: Step; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "import", label: "Bring your resume" },
  { id: "review", label: "Review the facts" },
  { id: "role", label: "Add a role" },
  { id: "draft", label: "First draft" },
];

/** The stepper shows five milestones; "path" lives between review and role. */
const stepperId = (s: Step): Step => (s === "path" ? "role" : s);

/** What survives leaving mid-journey: the reached step, the extracted and
 *  reviewed draft, and the workspace once created. Persisted via
 *  get/set_onboarding_state (backend meta storage) and cleared when the
 *  first PDF exists. */
interface PersistedOnboarding {
  step: Step;
  parsed: ResumeImport | null;
  jobId: number | null;
  /** Serialized ReviewGroups state — the user's review decisions. */
  review?: unknown;
}

const RESUMABLE_STEPS: Step[] = ["import", "review", "path", "role", "draft"];

/** A review candidate keeps its extracted values plus what the user changed. */
type Editable<T> = T & { dismissed: boolean; changed: Set<string> };

function editable<T>(value: T): Editable<T> {
  return { ...value, dismissed: false, changed: new Set<string>() };
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const createWorkspace = useJobsStore((s) => s.createWorkspace);
  const [step, setStep] = useState<Step>("welcome");

  // Import → review state (owned here so Review can render the groups).
  const [parsed, setParsed] = useState<ResumeImport | null>(null);
  // The workspace created in the role step — the draft composes for it.
  const [jobId, setJobId] = useState<number | null>(null);
  // Review decisions survive leaving: restored into ReviewGroups on return.
  const [review, setReview] = useState<unknown>(null);
  const [restored, setRestored] = useState(false);

  // Leave-and-resume: the reached step and the reviewed draft are the user's
  // work — persist them (a broken snapshot just restarts the journey).
  useEffect(() => {
    void (async () => {
      try {
        const raw = await ipc.getOnboardingState();
        if (raw) {
          const saved = JSON.parse(raw) as PersistedOnboarding;
          if (saved && RESUMABLE_STEPS.includes(saved.step)) {
            setStep(saved.step);
            setParsed(saved.parsed ?? null);
            setJobId(saved.jobId ?? null);
            setReview(saved.review ?? null);
          }
        }
      } catch {
        // No saved state or unreadable JSON — a fresh journey.
      }
      setRestored(true);
    })();
  }, []);

  const persist = (patch: Partial<PersistedOnboarding>) => {
    const next: PersistedOnboarding = {
      step,
      parsed,
      jobId,
      review,
      ...patch,
    };
    try {
      void Promise.resolve(ipc.setOnboardingState(JSON.stringify(next))).catch(() => {});
    } catch {
      // Persistence is best-effort — never break the journey on it.
    }
  };

  const go = (s: Step) => {
    setStep(s);
    persist({ step: s });
    window.scrollTo({ top: 0 });
  };

  // Nothing renders until restoration has been attempted — otherwise a
  // resuming user flashes the welcome screen before their step arrives.
  if (!restored) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Skeleton className="h-9 w-64" />
        <div className="mt-6 grid gap-5 lg:grid-cols-12">
          <Skeleton className="h-96 lg:col-span-5" />
          <Skeleton className="h-96 lg:col-span-7" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-1.5 text-xs">
        {STEPS.map((s, i) => {
          const active = stepperId(step) === s.id;
          const done = STEPS.findIndex((x) => x.id === stepperId(step)) > i;
          return (
            <li key={s.id} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 font-medium",
                  active
                    ? "bg-kairo-midnight text-white"
                    : done
                      ? "bg-ok-soft text-ok dark:bg-ok/15 dark:text-emerald-300"
                      : "bg-accent-soft text-muted",
                )}
              >
                {i + 1}. {s.label}
              </span>
              {i < STEPS.length - 1 ? <ArrowRight className="size-3 text-muted/50" /> : null}
            </li>
          );
        })}
      </ol>

      {step === "welcome" ? <Welcome onResume={() => go("import")} onManual={() => go("role")} /> : null}
      {step === "import" ? (
        <ImportStep
          onParsed={(result) => {
            setParsed(result);
            go("review");
          }}
        />
      ) : null}
      {step === "review" ? (
        <ReviewStep
          parsed={parsed}
          initialReview={review}
          onReviewChange={setReview}
          onDone={() => go("path")}
          onSkip={() => go("path")}
        />
      ) : null}
      {step === "path" ? (
        <PathStep
          onGeneral={() => {
            void (async () => {
              try {
                const created = await createWorkspace(
                  {
                    id: 0,
                    company: "",
                    roleTitle: "General resume",
                    url: "",
                    rawJd: "",
                    seniority: "",
                    domain: "",
                    kind: "general",
                    requirementCount: 0,
                  },
                  [],
                );
                setJobId(created.job.id);
                persist({ jobId: created.job.id, step: "draft" });
                toast.ok("General resume workspace created");
                setStep("draft");
              } catch (e) {
                toast.error(String(e));
              }
            })();
          }}
          onJob={() => go("role")}
          onBack={() => go("review")}
        />
      ) : null}
      {step === "role" ? (
        <RoleStep
          onCreated={(id) => {
            setJobId(id);
            persist({ jobId: id });
            go("draft");
          }}
        />
      ) : null}
      {step === "draft" ? (
        <DraftStep
          jobId={jobId}
          onContinue={() => {
            if (jobId !== null) navigate(`/jobs/${jobId}/resume`);
            else navigate("/jobs");
          }}
          onComplete={() => void ipc.clearOnboardingState().catch(() => {})}
        />
      ) : null}

      <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">
        Kairo never calls imported text “verified evidence”. Every record shows where it came
        from — <span className="font-medium">Imported from resume</span>,{" "}
        <span className="font-medium">Edited by you</span>,{" "}
        <span className="font-medium">Evidence attached</span>, or{" "}
        <span className="font-medium">Verified by you</span> — and only you can move it up that
        ladder.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1 · Welcome
// ---------------------------------------------------------------------------

function Welcome({ onResume, onManual }: { onResume: () => void; onManual: () => void }) {
  return (
    <Card className="p-8 text-center">
      <Sparkles className="mx-auto size-8 text-kairo-violet" />
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">
        Turn your existing resume into your first application
      </h1>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">
        Bring the resume you already have — Kairo pulls out your contact details, work, projects,
        education and skills for you to review. Then paste one job description and get a relevant
        first draft with a real PDF. Everything stays editable; nothing is trusted automatically.
      </p>
      <div className="mt-6 flex flex-col items-center gap-2">
        <Button className="w-full max-w-xs justify-center" onClick={onResume}>
          <FileUp className="size-4" /> Bring an existing resume
        </Button>
        <Button variant="ghost" className="text-xs" onClick={onManual}>
          Start manually instead
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 2 · Import (PDF / DOCX / pasted text, with size limit + extraction state)
// ---------------------------------------------------------------------------

function ImportStep({ onParsed }: { onParsed: (r: ResumeImport) => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const takeFile = async (file: File) => {
    setFileBusy(true);
    setError(null);
    try {
      const extracted = await extractTextFromFile(file);
      if (extracted.length > MAX_IMPORT_CHARS) {
        throw new Error(
          `That file is too large to analyze (limit ${MAX_IMPORT_CHARS.toLocaleString()} characters).`,
        );
      }
      setText(extracted);
      setFileName(file.name);
    } catch (e) {
      setFileName(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFileBusy(false);
    }
  };

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.parseResumeText(text);
      onParsed(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const tooLarge = text.length > MAX_IMPORT_CHARS;

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-sm font-semibold text-ink">Bring your resume</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Load a PDF, DOCX or text file — or paste the text. Kairo extracts candidates for you to
          review; nothing is saved until you approve it.
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void takeFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={fileBusy}
        className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-strong px-6 py-8 text-center transition-colors hover:border-kairo-blue/40 hover:bg-kairo-blue/[0.03] disabled:opacity-60"
      >
        <FileUp className="size-6 text-muted" />
        <span className="text-sm font-medium text-ink">
          {fileBusy ? "Extracting text…" : "Choose a resume file"}
        </span>
        <span className="text-xs text-muted">PDF, DOCX or plain text — parsed on your machine, never uploaded</span>
      </button>
      {fileName ? (
        <p className="text-xs text-ok">Loaded {fileName} — check the text below, then analyze.</p>
      ) : null}
      <Field label="Or paste the resume text" hint="Sections named Experience / Projects / Education / Skills work best">
        <Textarea
          rows={7}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder="Paste the full text of your existing resume here…"
        />
      </Field>
      {tooLarge ? (
        <p className="text-xs text-warn">
          {text.length.toLocaleString()} characters — over the {MAX_IMPORT_CHARS.toLocaleString()} limit. Split the document and import the sections one at a time.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad dark:bg-bad/10 dark:text-red-300">{error}</p>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {text.trim().length > 0 && !tooLarge ? (
          <span className="text-xs text-muted">{text.length.toLocaleString()} characters ready</span>
        ) : null}
        <Button onClick={() => void analyze()} disabled={busy || text.trim().length < 10 || tooLarge}>
          {busy ? "Extracting…" : "Extract my facts"}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 3 · Review the facts (grouped, editable, dismissible, honest provenance)
// ---------------------------------------------------------------------------

interface ReviewOutcome {
  createdCount: number;
}

function ReviewStep({
  parsed,
  initialReview,
  onReviewChange,
  onDone,
  onSkip,
}: {
  parsed: ResumeImport | null;
  initialReview: unknown;
  onReviewChange: (state: unknown) => void;
  onDone: (outcome: ReviewOutcome) => void;
  onSkip: () => void;
}) {
  if (!parsed) {
    return (
      <Card className="p-6 text-center text-sm text-muted">
        Nothing was extracted — go back and paste more text, or skip ahead and add records manually.
      </Card>
    );
  }
  const empty =
    !parsed.profile &&
    parsed.projects.length === 0 &&
    parsed.experiences.length === 0 &&
    parsed.education.length === 0 &&
    parsed.achievements.length === 0 &&
    parsed.skills.length === 0;
  if (empty) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm font-semibold text-ink">
          This doesn't look like a resume
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          No contact details, work, projects, education or skills were found. If this was a
          presentation or a report (slides extract poorly), try the actual resume PDF instead —
          or paste the resume text directly.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => window.history.back()}>
            Try another file
          </Button>
          <Button variant="ghost" onClick={onSkip}>
            Skip — add records manually
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <ReviewGroups
      parsed={parsed}
      initialReview={initialReview}
      onReviewChange={onReviewChange}
      onDone={onDone}
      onSkip={onSkip}
    />
  );
}

function ReviewGroups({
  parsed,
  initialReview,
  onReviewChange,
  onDone,
  onSkip,
}: {
  parsed: ResumeImport;
  initialReview: unknown;
  onReviewChange: (state: unknown) => void;
  onDone: (outcome: ReviewOutcome) => void;
  onSkip: () => void;
}) {
  // The review decisions persist with the journey: revive what the user left
  // behind (dismissals, edits, verify ticks) instead of starting over.
  const saved = (initialReview ?? null) as ReviewSnapshot | null;
  const reloadVault = useVaultStore((s) => s.load);
  const revive = <T,>(raw: unknown, fallback: Editable<T>): Editable<T> =>
    raw && typeof raw === "object"
      ? { ...(raw as object), changed: new Set((raw as { changed?: string[] }).changed ?? []) } as Editable<T>
      : fallback;

  const [contact, setContact] = useState(() =>
    revive(saved?.contact, editable(parsed.profile ?? emptyProfile())),
  );
  const [experiences, setExperiences] = useState(() =>
    parsed.experiences.map((e, i) => revive(saved?.experiences?.[i], editable(e))),
  );
  const [projects, setProjects] = useState(() =>
    parsed.projects.map((p, i) => revive(saved?.projects?.[i], editable(p))),
  );
  const [education, setEducation] = useState(() =>
    parsed.education.map((e, i) => revive(saved?.education?.[i], editable(e))),
  );
  const [achievements, setAchievements] = useState(() =>
    parsed.achievements.map((a, i) => revive(saved?.achievements?.[i], editable(a))),
  );
  const allSkills = parsed.skills;
  const [removedSkills, setRemovedSkills] = useState<Set<string>>(
    () => new Set(saved?.removedSkills ?? []),
  );
  const [skillsDismissed, setSkillsDismissed] = useState(saved?.skillsDismissed ?? false);
  const activeSkills = allSkills.filter((s) => !removedSkills.has(s.name));
  const [verifyContact, setVerifyContact] = useState(saved?.verify?.contact ?? false);
  const [verifyWork, setVerifyWork] = useState(saved?.verify?.work ?? false);
  const [verifyProjects, setVerifyProjects] = useState(saved?.verify?.projects ?? false);
  const [verifyEducation, setVerifyEducation] = useState(saved?.verify?.education ?? false);
  const [verifyAchievements, setVerifyAchievements] = useState(saved?.verify?.achievements ?? false);
  const [verifySkills, setVerifySkills] = useState(saved?.verify?.skills ?? false);
  const [saving, setSaving] = useState(false);

  // Persist review decisions as they change (debounced — every keystroke
  // must not hit the backend).
  useEffect(() => {
    const timer = setTimeout(() => {
      onReviewChange({
        contact: serializeEditable(contact),
        experiences: experiences.map(serializeEditable),
        projects: projects.map(serializeEditable),
        education: education.map(serializeEditable),
        achievements: achievements.map(serializeEditable),
        removedSkills: [...removedSkills],
        skillsDismissed,
        verify: {
          contact: verifyContact,
          work: verifyWork,
          projects: verifyProjects,
          education: verifyEducation,
          achievements: verifyAchievements,
          skills: verifySkills,
        },
      });
    }, 400);
    return () => clearTimeout(timer);
  });

  const hasContact = Boolean(
    contact.fullName || contact.email || contact.phone || contact.headline || contact.summary,
  );

  const pendingCount =
    (hasContact && !contact.dismissed ? 1 : 0) +
    experiences.filter((e) => !e.dismissed).length +
    projects.filter((p) => !p.dismissed).length +
    education.filter((e) => !e.dismissed).length +
    achievements.filter((a) => !a.dismissed).length +
    (allSkills.length > 0 && !skillsDismissed ? 1 : 0);

  const patch = <T,>(
    list: Editable<T>[],
    setList: (v: Editable<T>[]) => void,
    index: number,
    field: keyof T,
    value: T[keyof T],
  ) => {
    setList(
      list.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, changed: new Set(item.changed).add(String(field)) };
        (next as Record<string, unknown>)[field as string] = value;
        return next as Editable<T>;
      }),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      // Skills referenced by records stay in the batch even when the user
      // pruned the top-level list — a record's own chips decide its links.
      const referenced = new Set<string>();
      for (const proj of projects) {
        if (proj.dismissed) continue;
        for (const s of proj.skills) if (s.trim()) referenced.add(s.trim());
      }
      const skillList: { name: string; category: SkillCategory }[] = [];
      if (!skillsDismissed) {
        for (const s of activeSkills) skillList.push({ name: s.name, category: s.category });
      }
      for (const name of referenced) {
        if (!skillList.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
          skillList.push({ name, category: "other" });
        }
      }

      // One transactional call: every record and skill link commits together,
      // or nothing does — a failed save can never leave a partial import.
      const result = await ipc.importResumeBatch({
        profile:
          hasContact && !contact.dismissed
            ? {
                fullName: contact.fullName,
                headline: contact.headline,
                email: contact.email,
                phone: contact.phone,
                location: "",
                github: contact.github,
                website: contact.website,
                linkedin: contact.linkedin,
                summary: contact.summary,
              }
            : null,
        projects: projects
          .filter((p) => !p.dismissed)
          .map((p) => ({
            title: p.title,
            description: p.description,
            skills: p.skills.filter((s) => s.trim()),
            startDate: p.startDate || null,
            endDate: p.isCurrent ? null : p.endDate || null,
            isCurrent: p.isCurrent ?? false,
            url: p.url ?? "",
            repoUrl: p.repoUrl ?? "",
            sourceSnippet: p.sourceSnippet ?? "",
          })),
        experiences: experiences
          .filter((e) => !e.dismissed)
          .map((e) => ({
            organization: e.organization,
            role: e.role,
            description: e.description,
            startDate: e.startDate || null,
            endDate: e.isCurrent ? null : e.endDate || null,
            isCurrent: e.isCurrent,
            location: e.location,
            sourceSnippet: e.sourceSnippet ?? "",
          })),
        education: education
          .filter((e) => !e.dismissed)
          .map((e) => ({
            institution: e.institution,
            degree: e.degree,
            fieldOfStudy: e.fieldOfStudy,
            startDate: e.startDate || null,
            endDate: e.isCurrent ? null : e.endDate || null,
            isCurrent: e.isCurrent,
            sourceSnippet: e.sourceSnippet ?? "",
          })),
        achievements: achievements
          .filter((a) => !a.dismissed)
          .map((a) => ({
            title: a.title,
            issuer: a.issuer,
            description: a.description,
            achievedOn: a.achievedOn || null,
            sourceSnippet: a.sourceSnippet ?? "",
          })),
        skills: skillList,
      });

      // Verify the exact records the user confirmed, by their real ids.
      const verifications: { kind: string; id: number }[] = [];
      if (verifyWork) {
        for (const id of result.experienceIds) verifications.push({ kind: "experience", id });
      }
      if (verifyProjects) {
        for (const id of result.projectIds) verifications.push({ kind: "project", id });
      }
      if (verifyEducation) {
        for (const id of result.educationIds) verifications.push({ kind: "education", id });
      }
      if (verifyAchievements) {
        for (const id of result.achievementIds) verifications.push({ kind: "achievement", id });
      }
      for (const v of verifications) {
        await ipc.markVerified(v.kind, v.id);
      }

      // The batch wrote rows behind the store's back — reload so the Vault
      // and the rest of onboarding see what actually saved.
      await reloadVault();

      const created =
        (result.profileSaved ? 1 : 0) +
        result.projectIds.length +
        result.experienceIds.length +
        result.educationIds.length +
        result.achievementIds.length +
        (skillList.length > 0 ? 1 : 0);
      if (verifyContact && result.profileSaved) {
        toast.ok("Contact details saved — mark them verified from the Vault record.");
      }
      toast.ok(
        `${created} record${created === 1 ? "" : "s"} saved to your Vault — each shows where it came from.`,
      );
      onDone({ createdCount: created });
    } catch (e) {
      // Nothing was saved — the whole batch rolled back. Retrying is safe.
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-ink">Review the facts</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Straight from your resume, grouped the way Kairo stores them. Edit anything that came out
          wrong, dismiss what you don't want — records you change are honestly marked “Edited by
          you”.
        </p>
        {pendingCount === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-xs text-muted">
            Nothing left to review — skip ahead to add a role.
          </p>
        ) : (
          <p className="mt-4 text-xs font-medium text-ink">
            {pendingCount} item{pendingCount === 1 ? "" : "s"} waiting for your review
          </p>
        )}
      </Card>

      {hasContact ? (
        <GroupCard
          title="Contact"
          subtitle="Shown as the resume header"
          verify={verifyContact}
          setVerify={setVerifyContact}
          dismissed={contact.dismissed}
          setDismissed={(v) => setContact({ ...contact, dismissed: v })}
        >
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={contact.fullName}
              placeholder="Full name"
              onChange={(e) => patch([contact], (v) => setContact(v[0]), 0, "fullName", e.target.value)}
            />
            <Input
              value={contact.headline}
              placeholder="Headline"
              onChange={(e) => patch([contact], (v) => setContact(v[0]), 0, "headline", e.target.value)}
            />
            <Input
              value={contact.email}
              placeholder="Email"
              onChange={(e) => patch([contact], (v) => setContact(v[0]), 0, "email", e.target.value)}
            />
            <Input
              value={contact.phone}
              placeholder="Phone"
              onChange={(e) => patch([contact], (v) => setContact(v[0]), 0, "phone", e.target.value)}
            />
          </div>
        </GroupCard>
      ) : null}

      {experiences.map((exp, i) =>
        exp.dismissed ? null : (
          <GroupCard
            key={`exp-${i}`}
            title="Work"
            subtitle={[exp.organization, exp.role].filter(Boolean).join(" · ") || "Extracted from your resume"}
            verify={verifyWork}
            setVerify={setVerifyWork}
            edited={exp.changed.size > 0}
            dismissed={exp.dismissed}
            setDismissed={(v) => setExperiences(experiences.map((x, j) => (j === i ? { ...x, dismissed: v } : x)))}
          >
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={exp.organization}
                placeholder="Organization"
                onChange={(e) => patch(experiences, setExperiences, i, "organization", e.target.value)}
              />
              <Input
                value={exp.role}
                placeholder="Role"
                onChange={(e) => patch(experiences, setExperiences, i, "role", e.target.value)}
              />
              <Input
                value={exp.startDate ?? ""}
                placeholder="Start (YYYY-MM)"
                onChange={(e) => patch(experiences, setExperiences, i, "startDate", e.target.value)}
              />
              <Input
                value={exp.endDate ?? ""}
                placeholder="End (YYYY-MM)"
                onChange={(e) => patch(experiences, setExperiences, i, "endDate", e.target.value)}
              />
            </div>
            <Textarea
              rows={3}
              className="mt-2"
              value={exp.description}
              placeholder="What you did there"
              onChange={(e) => patch(experiences, setExperiences, i, "description", e.target.value)}
            />
            <SourceNote snippet={exp.sourceSnippet} />
          </GroupCard>
        ),
      )}

      {projects.map((proj, i) =>
        proj.dismissed ? null : (
          <GroupCard
            key={`proj-${i}`}
            title="Project"
            subtitle={proj.title || "Extracted from your resume"}
            verify={verifyProjects}
            setVerify={setVerifyProjects}
            edited={proj.changed.size > 0}
            dismissed={proj.dismissed}
            setDismissed={(v) => setProjects(projects.map((x, j) => (j === i ? { ...x, dismissed: v } : x)))}
          >
            <Input
              value={proj.title}
              placeholder="Project name"
              onChange={(e) => patch(projects, setProjects, i, "title", e.target.value)}
            />
            <Textarea
              rows={3}
              className="mt-2"
              value={proj.description}
              placeholder="What it is and what you built"
              onChange={(e) => patch(projects, setProjects, i, "description", e.target.value)}
            />
            {proj.startDate || proj.endDate || proj.url || proj.repoUrl ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input
                  value={proj.startDate ?? ""}
                  placeholder="Start (YYYY-MM)"
                  onChange={(e) => patch(projects, setProjects, i, "startDate", e.target.value)}
                />
                <Input
                  value={proj.endDate ?? ""}
                  placeholder="End (YYYY-MM)"
                  onChange={(e) => patch(projects, setProjects, i, "endDate", e.target.value)}
                />
                <Input
                  value={proj.url ?? ""}
                  placeholder="Live URL"
                  onChange={(e) => patch(projects, setProjects, i, "url", e.target.value)}
                />
                <Input
                  value={proj.repoUrl ?? ""}
                  placeholder="Repository URL"
                  onChange={(e) => patch(projects, setProjects, i, "repoUrl", e.target.value)}
                />
              </div>
            ) : null}
            <SourceNote snippet={proj.sourceSnippet} />
            {proj.skills.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {proj.skills.map((s) => (
                  <span key={s} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-muted">
                    {s}
                  </span>
                ))}
              </div>
            ) : null}
          </GroupCard>
        ),
      )}

      {education.map((edu, i) =>
        edu.dismissed ? null : (
          <GroupCard
            key={`edu-${i}`}
            title="Education"
            subtitle={[edu.degree, edu.institution].filter(Boolean).join(" · ") || "Extracted from your resume"}
            verify={verifyEducation}
            setVerify={setVerifyEducation}
            edited={edu.changed.size > 0}
            dismissed={edu.dismissed}
            setDismissed={(v) => setEducation(education.map((x, j) => (j === i ? { ...x, dismissed: v } : x)))}
          >
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={edu.institution}
                placeholder="Institution"
                onChange={(e) => patch(education, setEducation, i, "institution", e.target.value)}
              />
              <Input
                value={edu.degree}
                placeholder="Degree"
                onChange={(e) => patch(education, setEducation, i, "degree", e.target.value)}
              />
              <Input
                value={edu.startDate ?? ""}
                placeholder="Start (YYYY-MM)"
                onChange={(e) => patch(education, setEducation, i, "startDate", e.target.value)}
              />
              <Input
                value={edu.endDate ?? ""}
                placeholder="End (YYYY-MM)"
                onChange={(e) => patch(education, setEducation, i, "endDate", e.target.value)}
              />
            </div>
            <SourceNote snippet={edu.sourceSnippet} />
          </GroupCard>
        ),
      )}

      {achievements.map((ach, i) =>
        ach.dismissed ? null : (
          <GroupCard
            key={`ach-${i}`}
            title="Achievement"
            subtitle={[ach.title, ach.issuer].filter(Boolean).join(" · ") || "Extracted from your resume"}
            verify={verifyAchievements}
            setVerify={setVerifyAchievements}
            edited={ach.changed.size > 0}
            dismissed={ach.dismissed}
            setDismissed={(v) => setAchievements(achievements.map((x, j) => (j === i ? { ...x, dismissed: v } : x)))}
          >
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={ach.title}
                placeholder="Title"
                onChange={(e) => patch(achievements, setAchievements, i, "title", e.target.value)}
              />
              <Input
                value={ach.issuer}
                placeholder="Issuer"
                onChange={(e) => patch(achievements, setAchievements, i, "issuer", e.target.value)}
              />
              <Input
                value={ach.achievedOn ?? ""}
                placeholder="Achieved (YYYY-MM)"
                onChange={(e) => patch(achievements, setAchievements, i, "achievedOn", e.target.value)}
              />
            </div>
            <Textarea
              rows={2}
              className="mt-2"
              value={ach.description}
              placeholder="What it involved"
              onChange={(e) => patch(achievements, setAchievements, i, "description", e.target.value)}
            />
            <SourceNote snippet={ach.sourceSnippet} />
          </GroupCard>
        ),
      )}

      {allSkills.length > 0 ? (
        <GroupCard
          title="Skills"
          subtitle={`${activeSkills.length} of ${allSkills.length} recognized — uncheck anything that isn't really you`}
          verify={verifySkills}
          setVerify={setVerifySkills}
          dismissed={skillsDismissed}
          setDismissed={setSkillsDismissed}
        >
          <SkillChips
            skills={activeSkills}
            onRemove={(name) =>
              setRemovedSkills((prev) => new Set(prev).add(name))
            }
          />
          {removedSkills.size > 0 ? (
            <button
              type="button"
              className="mt-2 text-xs text-muted hover:text-ink"
              onClick={() => setRemovedSkills(new Set())}
            >
              Restore removed skills ({removedSkills.size})
            </button>
          ) : null}
        </GroupCard>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" className="text-xs" onClick={onSkip}>
          Skip — I'll add records manually
        </Button>
        <Button onClick={() => void save()} disabled={saving || pendingCount === 0}>
          {saving ? "Saving…" : `Save ${pendingCount} record${pendingCount === 1 ? "" : "s"} to my Vault`}
        </Button>
      </div>
    </div>
  );
}

/** The supporting passage from the original resume, shown beside the fact. */
function SourceNote({ snippet }: { snippet?: string | null }) {
  if (!snippet) return null;
  return (
    <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-xs leading-relaxed text-muted">
      <span className="font-semibold text-ink">From your resume: </span>
      {snippet}
    </p>
  );
}

/** JSON-safe shape of one reviewed group entry (Set → string[]). */
function serializeEditable<T>(entry: Editable<T>): Record<string, unknown> {
  const { changed, ...rest } = entry as Editable<T> & { changed: Set<string> };
  return { ...(rest as object), changed: [...changed] };
}

/** The serialized ReviewGroups state that travels through the persistence. */
interface ReviewSnapshot {
  contact?: unknown;
  experiences?: unknown[];
  projects?: unknown[];
  education?: unknown[];
  achievements?: unknown[];
  removedSkills?: string[];
  skillsDismissed?: boolean;
  verify?: {
    contact?: boolean;
    work?: boolean;
    projects?: boolean;
    education?: boolean;
    achievements?: boolean;
    skills?: boolean;
  };
}

function emptyProfile() {
  return {
    fullName: "",
    headline: "",
    email: "",
    phone: "",
    github: "",
    website: "",
    linkedin: "",
    summary: "",
  };
}

/** One reviewed group: provenance note, verify checkbox, dismiss. */
function GroupCard({
  title,
  subtitle,
  children,
  verify,
  setVerify,
  edited,
  dismissed,
  setDismissed,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  verify: boolean;
  setVerify: (v: boolean) => void;
  edited?: boolean;
  dismissed: boolean;
  setDismissed: (v: boolean) => void;
}) {
  const badge = edited ? originBadge({ origin: "imported", editedAt: utcNow() }) : originBadge({ origin: "imported" });
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</span>
            {badge ? (
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", badge.className)}>
                {badge.label}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(!dismissed)}
          className="text-xs text-muted hover:text-bad"
        >
          {dismissed ? "Restore" : "Don't import this"}
        </button>
      </div>
      {dismissed ? (
        <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-xs text-muted">
          Dismissed — it won't be saved.
        </p>
      ) : (
        <>
          <div className="mt-3">{children}</div>
          <label className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={verify}
              onChange={(e) => setVerify(e.target.checked)}
              className="accent-kairo-blue"
            />
            <ShieldCheck className="size-3.5" />
            I've double-checked {title.toLowerCase()} against the real world — mark it “Verified by you”
          </label>
        </>
      )}
    </Card>
  );
}

/** Skill chips with remove — the saved set is exactly what remains. */
function SkillChips({
  skills,
  onRemove,
}: {
  skills: { name: string; category: SkillCategory }[];
  onRemove: (name: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((s) => (
        <button
          key={s.name}
          type="button"
          title="Remove this skill"
          onClick={() => onRemove(s.name)}
          className="rounded-full border border-line bg-accent-soft px-2.5 py-1 text-xs text-ink line-through opacity-60 transition-opacity hover:opacity-100"
        >
          {s.name} ✕
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3.5 · Choose the path — tailor for a job, or a general resume
// ---------------------------------------------------------------------------

function PathStep({
  onJob,
  onGeneral,
  onBack,
}: {
  onJob: () => void;
  onGeneral: () => void;
  onBack: () => void;
}) {
  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-sm font-semibold text-ink">What is this resume for?</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Both paths end at a real PDF you can send. You can always add the other kind later —
          every workspace edits the same Vault.
        </p>
      </div>
      <button
        type="button"
        onClick={onJob}
        className="w-full rounded-xl border border-line bg-card p-5 text-left transition-colors hover:border-kairo-blue/40 hover:bg-accent-soft"
      >
        <p className="text-sm font-semibold text-ink">Tailor for a job</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Paste a job description — Kairo extracts the requirements, matches your records against
          them, and drafts the resume that fits this role.
        </p>
      </button>
      <button
        type="button"
        onClick={onGeneral}
        className="w-full rounded-xl border border-line bg-card p-5 text-left transition-colors hover:border-kairo-blue/40 hover:bg-accent-soft"
      >
        <p className="text-sm font-semibold text-ink">General resume</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          No posting in hand — Kairo composes your strongest records into one clean resume, ready
          to customize for any role later.
        </p>
      </button>
      <button type="button" className="w-fit text-xs text-muted hover:text-ink" onClick={onBack}>
        Back to the review
      </button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 4 · Add a role (paste JD → confirm the important requirements)
// ---------------------------------------------------------------------------

function RoleStep({ onCreated }: { onCreated: (jobId: number) => void }) {
  const navigate = useNavigate();
  const createWorkspace = useJobsStore((s) => s.createWorkspace);

  const [step, setStep] = useState<"paste" | "confirm">("paste");
  const [jdText, setJdText] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [requirements, setRequirements] = useState<(JobRequirement & { keep: boolean })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const extraction = await ipc.parseJd(jdText);
      setCompany(extraction.company);
      setRole(extraction.role);
      setRequirements(
        extraction.requirements.map((d, i) => ({
          id: -(i + 1),
          jobId: 0,
          kind: d.kind,
          rawText: d.rawText,
          normalizedKey: d.rawText.toLowerCase(),
          importance: d.importance,
          userConfirmed: true,
          keep: true,
        })),
      );
      setStep("confirm");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const kept = requirements.filter((r) => r.keep && r.rawText.trim());
    if (kept.length === 0) {
      setError("Keep at least one requirement — they drive what the draft includes.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const job: Job = {
        id: 0,
        company: company.trim(),
        roleTitle: role.trim(),
        url: "",
        rawJd: jdText,
        seniority: "",
        domain: "",
        kind: "role",
        requirementCount: 0,
      };
      const created = await createWorkspace(
        job,
        kept.map(({ keep: _keep, ...req }) => req),
      );
      // The match runs silently — it powers selection + explanations; the
      // score itself is never surfaced in this flow.
      try {
        await ipc.runJobMatch(created.job.id);
      } catch {
        // Matching is advisory; the draft can still be composed.
      }
      toast.ok(`Workspace for "${created.job.roleTitle || "Untitled role"}" created`);
      onCreated(created.job.id);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const keptCount = requirements.filter((r) => r.keep).length;

  return (
    <Card className="space-y-4 p-6">
      {step === "paste" ? (
        <>
          <div>
            <h2 className="text-sm font-semibold text-ink">Add a role</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Paste the job description exactly as posted. Kairo extracts the requirements and you
              confirm which ones matter — that decides what your draft includes.
            </p>
          </div>
          <Field label="Job description" hint="Stored verbatim — never edited">
            <Textarea
              rows={9}
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              placeholder="Paste the exact job description here…"
            />
          </Field>
          {error ? (
            <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad dark:bg-bad/10 dark:text-red-300">{error}</p>
          ) : null}
          <div className="flex justify-end">
            <Button onClick={() => void analyze()} disabled={busy || jdText.trim().length < 30}>
              {busy ? "Reading…" : "Find the requirements"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div>
            <h2 className="text-sm font-semibold text-ink">
              Confirm what matters{role ? ` — ${role}` : ""}{company ? ` at ${company}` : ""}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Uncheck anything the job doesn't really require. You can refine these later in the
              workspace.
            </p>
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {requirements.map((req) => (
              <label
                key={req.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors",
                  req.keep ? "border-line bg-card" : "border-line bg-accent-soft opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={req.keep}
                  onChange={(e) =>
                    setRequirements((prev) =>
                      prev.map((r) => (r.id === req.id ? { ...r, keep: e.target.checked } : r)),
                    )
                  }
                  className="mt-0.5 accent-kairo-blue"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-ink">{req.rawText}</span>
                  <span className="text-xs text-muted">
                    {req.kind === "required_skill"
                      ? "Required skill"
                      : req.kind === "preferred_skill"
                        ? "Preferred"
                        : "Responsibility"}
                    {req.importance >= 0.8 ? " · emphasized in the posting" : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">
            {keptCount} of {requirements.length} requirements kept.
          </p>
          {error ? (
            <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad dark:bg-bad/10 dark:text-red-300">{error}</p>
          ) : null}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep("paste")}>
              Back to the description
            </Button>
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? "Building…" : "Build my first draft"}
            </Button>
          </div>
        </>
      )}
      {step === "paste" ? (
        <button
          type="button"
          className="w-fit text-xs text-muted hover:text-ink"
          onClick={() => navigate("/jobs")}
        >
          Skip for now — I'll add a role from the Jobs page later
        </button>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 5 · First draft (selections + honest explanations + provenance) — and the
// journey's destination: a real, reviewable first PDF, exported right here.
// ---------------------------------------------------------------------------

function DraftStep({
  jobId,
  onContinue,
  onComplete,
}: {
  jobId: number | null;
  onContinue: () => void;
  /** Fires when the first PDF exists — the journey is done. */
  onComplete: () => void;
}) {
  const [plan, setPlan] = useState<ResumePlan | null>(null);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<PdfArtifact | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Honest unresolved-issues list: what the user should still double-check.
  const vaultProjects = useVaultStore((s) => s.projects);
  const vaultExperiences = useVaultStore((s) => s.experiences);
  const vaultEducation = useVaultStore((s) => s.education);
  const vaultAchievements = useVaultStore((s) => s.achievements);
  const unverifiedCount = [
    ...vaultProjects,
    ...vaultExperiences,
    ...vaultEducation,
    ...vaultAchievements,
  ].filter((r) => r.origin === "imported" && !r.verifiedAt).length;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        if (jobId === null) {
          setPlan(null);
          return;
        }
        // Matching runs silently: it powers the selection and the "why it's
        // here" reasons — the score itself is never surfaced in this flow.
        let report: MatchReport | null = null;
        try {
          report = await ipc.getMatch(jobId);
        } catch {
          report = null;
        }
        if (cancelled) return;
        setReport(report);
        setPlan(await ipc.runComposer(jobId));
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const reasonsFor = (entityType: string, id: number): string[] => {
    const ranked = report?.entityRanking.find((e) => e.entityType === entityType && e.id === id);
    return ranked?.reasons ?? [];
  };

  const toggle = (item: { entityType: string; id: number }) => {
    if (!plan || jobId === null) return;
    const flip = (list: ResumePlan["experience"]) =>
      list.map((i) => (i.entityType === item.entityType && i.id === item.id ? { ...i, excluded: !i.excluded } : i));
    const next: ResumePlan = {
      ...plan,
      experience: flip(plan.experience),
      projects: flip(plan.projects),
    };
    setPlan(next);
    // Persist through the shared queue; Studio keeps editing from here.
    enqueuePlanSave(jobId, next);
  };

  /** The destination of the whole journey: compile the first PDF here. The
   *  flush+revision contract is the same as the Studio's — never compile an
   *  unsaved draft. */
  const exportFirstPdf = async () => {
    if (jobId === null || !plan) return;
    setExporting(true);
    setExportError(null);
    try {
      const flush = await flushPlanSave(jobId);
      if (!flush.ok) {
        setExportError(flush.error);
        return;
      }
      const result = await ipc.exportPdf(jobId, plan.config.templateId || "jake", flush.revision);
      setArtifact(result.artifact);
      onComplete();
    } catch (e) {
      // The previous state is untouched — the journey continues right here.
      setExportError(String(e));
    } finally {
      setExporting(false);
    }
  };

  if (busy) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-muted">Choosing what fits the role — one moment…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-sm text-bad">{error}</p>
        <Button className="mt-3" variant="secondary" onClick={onContinue}>
          Continue to the Studio anyway
        </Button>
      </Card>
    );
  }

  const items = plan ? [...plan.experience, ...plan.projects] : [];
  const included = items.filter((i) => !i.excluded);

  // The destination: an actual PDF, its honest caveats, and the two ways
  // forward. A failed compile keeps everything editable right here.
  if (artifact) {
    return (
      <div className="space-y-4">
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-ink">Your first PDF is ready</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Compiled from the draft you just reviewed — {artifact.pageCount ?? "?"} page(s). This
            exact file is what “Current PDF” means in the editor.
          </p>
        </Card>
        <Card className="overflow-hidden p-4">
          <PdfViewer jobId={jobId ?? 0} className="min-h-[500px]" />
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Still worth a look
          </p>
          {unverifiedCount > 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-muted">
              · {unverifiedCount} imported record{unverifiedCount === 1 ? "" : "s"} not yet marked
              “Verified by you” — check them in My story when you get a chance.
            </p>
          ) : null}
          {(plan?.warnings ?? []).slice(0, 3).map((w, i) => (
            <p key={i} className="mt-2 text-xs leading-relaxed text-muted">
              · {w}
            </p>
          ))}
          {unverifiedCount === 0 && (plan?.warnings ?? []).length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-muted">
              · Nothing open — every record is verified and the draft had no warnings.
            </p>
          ) : null}
        </Card>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              void ipc
                .saveJobPdfToDownloads(jobId ?? 0)
                .then((p) => toast.ok(`Saved to ${p}`))
                .catch((e) => toast.error(String(e)))
            }
          >
            Save to Downloads
          </Button>
          <Button onClick={onContinue}>
            Customize in the editor <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-ink">Your first draft</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Kairo picked the records most relevant and kept each one's provenance. Every selection
          says why it's here — remove anything you disagree with, then create the PDF.
        </p>
        {plan ? (
          <p className="mt-3 text-xs font-medium text-ink">
            {included.length} of {items.length} records included
            {plan.achievements?.length ? ` · ${plan.achievements.filter((a) => !a.excluded).length} achievement(s)` : ""}
          </p>
        ) : null}
      </Card>

      {!plan || items.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">
          There was nothing to select yet — add records in the Vault and compose again from the
          Studio. You can also write bullets manually there.
          <div className="mt-3">
            <Button onClick={onContinue}>Continue</Button>
          </div>
        </Card>
      ) : (
        <>
          {items.map((item) => {
            const reasons = reasonsFor(item.entityType, item.id);
            const badge = originBadge({
              origin: item.origin ?? "manual",
              evidenceCount: item.evidenceCount,
            });
            return (
              <Card key={`${item.entityType}-${item.id}`} className={cn("p-5", item.excluded && "opacity-60")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{item.title}</p>
                    {item.subtitle ? <p className="text-xs text-muted">{item.subtitle}</p> : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {badge ? (
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", badge.className)}>
                          {badge.label}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-muted">
                        {item.bullets.length} resume point{item.bullets.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={item.excluded ? "secondary" : "ghost"}
                    className="text-xs"
                    onClick={() => toggle(item)}
                  >
                    {item.excluded ? "Include" : "Remove"}
                  </Button>
                </div>
                <div className="mt-3 rounded-lg bg-accent-soft px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Why it's here
                  </p>
                  {reasons.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {reasons.slice(0, 3).map((reason, i) => (
                        <li key={i} className="text-xs leading-relaxed text-muted">
                          · {reason}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Included from your Vault — the posting didn't mention it directly, but it
                      rounds out the page.
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
          {exportError ? (
            <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad dark:bg-bad/10 dark:text-red-300">
              {exportError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" className="text-xs" onClick={onContinue}>
              Skip — customize in the Studio first
            </Button>
            <Button onClick={() => void exportFirstPdf()} disabled={exporting}>
              {exporting ? "Compiling your PDF…" : "Create my first PDF"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
