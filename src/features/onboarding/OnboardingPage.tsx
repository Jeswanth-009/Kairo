import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileUp, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field, Input, Textarea } from "../../components/ui/inputs";
import { cn } from "../../lib/cn";
import { ipc } from "../../lib/ipc";
import { enqueuePlanSave } from "../../lib/planAutosave";
import { extractTextFromFile } from "../imports/extractFile";
import { originBadge, utcNow } from "../../lib/origin";
import type {
  Education,
  Experience,
  Job,
  JobRequirement,
  MatchReport,
  Project,
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

type Step = "welcome" | "import" | "review" | "role" | "draft";

const STEPS: { id: Step; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "import", label: "Bring your resume" },
  { id: "review", label: "Review the facts" },
  { id: "role", label: "Add a role" },
  { id: "draft", label: "First draft" },
];

/** A review candidate keeps its extracted values plus what the user changed. */
type Editable<T> = T & { dismissed: boolean; changed: Set<string> };

function editable<T>(value: T): Editable<T> {
  return { ...value, dismissed: false, changed: new Set<string>() };
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");

  // Import → review state (owned here so Review can render the groups).
  const [parsed, setParsed] = useState<ResumeImport | null>(null);
  // The workspace created in the role step — the draft composes for it.
  const [jobId, setJobId] = useState<number | null>(null);

  const go = (s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {STEPS.map((s, i) => {
          const active = s.id === step;
          const done = STEPS.findIndex((x) => x.id === step) > i;
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
          onDone={() => go("role")}
          onSkip={() => go("role")}
        />
      ) : null}
      {step === "role" ? (
        <RoleStep
          onCreated={(id) => {
            setJobId(id);
            go("draft");
          }}
        />
      ) : null}
      {step === "draft" ? (
        <DraftStep
          jobId={jobId}
          onContinue={() => {
            void navigate("/resume-studio");
          }}
        />
      ) : null}

      <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
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
        <span className="text-[11px] text-muted">PDF, DOCX or plain text — parsed on your machine, never uploaded</span>
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
          <span className="text-[11px] text-muted">{text.length.toLocaleString()} characters ready</span>
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
  onDone,
  onSkip,
}: {
  parsed: ResumeImport | null;
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
  return <ReviewGroups parsed={parsed} onDone={onDone} onSkip={onSkip} />;
}

function ReviewGroups({
  parsed,
  onDone,
  onSkip,
}: {
  parsed: ResumeImport;
  onDone: (outcome: ReviewOutcome) => void;
  onSkip: () => void;
}) {
  const saveRecord = useVaultStore((s) => s.saveRecord);
  const saveProfile = useVaultStore((s) => s.saveProfile);
  const vaultSkills = useVaultStore((s) => s.skills);

  const [contact, setContact] = useState(() => editable(parsed.profile ?? emptyProfile()));
  const [experiences, setExperiences] = useState(() => parsed.experiences.map(editable));
  const [projects, setProjects] = useState(() => parsed.projects.map(editable));
  const [education, setEducation] = useState(() => parsed.education.map(editable));
  const allSkills = parsed.skills;
  const [removedSkills, setRemovedSkills] = useState<Set<string>>(new Set());
  const [skillsDismissed, setSkillsDismissed] = useState(false);
  const activeSkills = allSkills.filter((s) => !removedSkills.has(s.name));
  const [verifyContact, setVerifyContact] = useState(false);
  const [verifyWork, setVerifyWork] = useState(false);
  const [verifyProjects, setVerifyProjects] = useState(false);
  const [verifyEducation, setVerifyEducation] = useState(false);
  const [verifySkills, setVerifySkills] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasContact = Boolean(
    contact.fullName || contact.email || contact.phone || contact.headline || contact.summary,
  );

  const pendingCount =
    (hasContact && !contact.dismissed ? 1 : 0) +
    experiences.filter((e) => !e.dismissed).length +
    projects.filter((p) => !p.dismissed).length +
    education.filter((e) => !e.dismissed).length +
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

  /** Create missing skills and return canonical names for record links. */
  const resolveSkills = async (names: string[]): Promise<void> => {
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      const exists = vaultSkills.some(
        (s) =>
          s.canonicalName.toLowerCase() === lower ||
          s.aliases.some((a) => a.alias.toLowerCase() === lower),
      );
      if (!exists) {
        await saveRecord("skills", { id: 0, canonicalName: name, category: "other", aliases: [] });
      }
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      let created = 0;
      const verified: { kind: string; id: number }[] = [];

      if (hasContact && !contact.dismissed) {
        await saveProfile({
          fullName: contact.fullName,
          headline: contact.headline,
          email: contact.email,
          phone: contact.phone,
          location: "",
          github: contact.github,
          website: contact.website,
          linkedin: contact.linkedin,
          summary: contact.summary,
        });
        created += 1;
        if (verifyContact) toast.ok("Contact details saved — mark them verified from the Vault record.");
      }

      for (const exp of experiences) {
        if (exp.dismissed) continue;
        const record = await saveRecord("experiences", {
          id: 0,
          organization: exp.organization,
          role: exp.role,
          description: exp.description,
          startDate: exp.startDate || null,
          endDate: exp.isCurrent ? null : exp.endDate || null,
          isCurrent: exp.isCurrent,
          location: exp.location,
          skills: [],
          evidenceCount: 0,
          origin: "imported" as const,
          editedAt: exp.changed.size > 0 ? utcNow() : null,
          verifiedAt: null,
        } satisfies Experience);
        created += 1;
        if (verifyWork) verified.push({ kind: "experience", id: record.id });
      }

      for (const proj of projects) {
        if (proj.dismissed) continue;
        await resolveSkills(proj.skills);
        const record = await saveRecord("projects", {
          id: 0,
          title: proj.title,
          description: proj.description,
          startDate: null,
          endDate: null,
          isCurrent: false,
          url: "",
          repoUrl: "",
          skills: proj.skills
            .filter((s) => s.trim())
            .map((s) => {
              const match = vaultSkills.find((v) => v.canonicalName.toLowerCase() === s.toLowerCase());
              return {
                skillId: match?.id ?? 0,
                canonicalName: s,
                confidence: 3,
              };
            }),
          evidenceCount: 0,
          origin: "imported" as const,
          editedAt: proj.changed.size > 0 ? utcNow() : null,
          verifiedAt: null,
        } satisfies Project);
        created += 1;
        if (verifyProjects) verified.push({ kind: "project", id: record.id });
      }

      for (const edu of education) {
        if (edu.dismissed) continue;
        const record = await saveRecord("education", {
          id: 0,
          institution: edu.institution,
          degree: edu.degree,
          fieldOfStudy: edu.fieldOfStudy,
          description: "",
          startDate: edu.startDate || null,
          endDate: edu.isCurrent ? null : edu.endDate || null,
          isCurrent: edu.isCurrent,
          origin: "imported" as const,
          editedAt: edu.changed.size > 0 ? utcNow() : null,
          verifiedAt: null,
        } satisfies Education);
        created += 1;
        if (verifyEducation) verified.push({ kind: "education", id: record.id });
      }

      if (allSkills.length > 0 && !skillsDismissed) {
        await resolveSkills(activeSkills.map((s) => s.name));
        created += 1;
      }

      for (const v of verified) {
        await ipc.markVerified(v.kind, v.id);
      }

      toast.ok(
        `${created} record${created === 1 ? "" : "s"} saved to your Vault — each shows where it came from.`,
      );
      onDone({ createdCount: created });
    } catch (e) {
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
            {proj.skills.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {proj.skills.map((s) => (
                  <span key={s} className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-muted">
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
              className="mt-2 text-[11px] text-muted hover:text-ink"
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
          className="text-[11px] text-muted hover:text-bad"
        >
          {dismissed ? "Restore" : "Don't import this"}
        </button>
      </div>
      {dismissed ? (
        <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-[11px] text-muted">
          Dismissed — it won't be saved.
        </p>
      ) : (
        <>
          <div className="mt-3">{children}</div>
          <label className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
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
                  <span className="text-[11px] text-muted">
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
          <p className="text-[11px] text-muted">
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
          className="w-fit text-[11px] text-muted hover:text-ink"
          onClick={() => navigate("/jobs")}
        >
          Skip for now — I'll add a role from the Jobs page later
        </button>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 5 · First draft (selections + honest explanations + provenance)
// ---------------------------------------------------------------------------

function DraftStep({ jobId, onContinue }: { jobId: number | null; onContinue: () => void }) {
  const [plan, setPlan] = useState<ResumePlan | null>(null);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-ink">Your first draft</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Kairo picked the records most relevant to the role and kept each one's provenance. Every
          selection says why it's here — remove anything you disagree with.
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
            <Button onClick={onContinue}>Continue to the Studio</Button>
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
                    className="text-[11px]"
                    onClick={() => toggle(item)}
                  >
                    {item.excluded ? "Include" : "Remove"}
                  </Button>
                </div>
                <div className="mt-3 rounded-lg bg-accent-soft px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Why it's here
                  </p>
                  {reasons.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {reasons.slice(0, 3).map((reason, i) => (
                        <li key={i} className="text-[11px] leading-relaxed text-muted">
                          · {reason}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted">
                      Included from your Vault — the posting didn't mention it directly, but it
                      rounds out the page.
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
          <div className="flex justify-end">
            <Button onClick={onContinue}>
              Continue to the Studio — pick a template and export <ArrowRight className="size-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
