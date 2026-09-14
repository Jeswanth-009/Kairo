import { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { Field, Input, Textarea } from "../../components/ui/inputs";
import { ipc } from "../../lib/ipc";
import type {
  Achievement,
  AchievementDraft,
  CertificateCandidate,
  Education,
  EducationDraft,
  Experience,
  ExperienceDraft,
  GithubRepoCandidate,
  ImportProfile,
  Project,
  ProjectDraft,
  SkillCategory,
  SkillDraft,
  SkillRef,
} from "../../lib/types";
import { useVaultStore } from "../../stores/vaultStore";
import { toast } from "../../stores/toastStore";

type ImportTab = "resume" | "github" | "certificate";

const TAB_LABELS: Record<ImportTab, string> = {
  resume: "Resume text",
  github: "GitHub",
  certificate: "Certificate",
};

/**
 * Phase 3 import review. Extraction produces candidates; a candidate becomes a
 * Vault record only when the user presses Accept (or saves it after Edit).
 */
export function ImportDialog({
  open,
  onClose,
  initialTab = "resume",
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: ImportTab;
}) {
  const [tab, setTab] = useState<ImportTab>(initialTab);

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} title="Import into the Vault" maxWidth="max-w-2xl">
      <div className="mb-5 flex flex-wrap gap-1.5">
        {(Object.keys(TAB_LABELS) as ImportTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-200",
              tab === t ? "bg-kairo-midnight text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200",
            ].join(" ")}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "resume" ? <ResumeImportTab onDone={onClose} /> : null}
      {tab === "github" ? <GithubImportTab onDone={onClose} /> : null}
      {tab === "certificate" ? <CertificateImportTab onDone={onClose} /> : null}

      <p className="mt-5 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
        Imported data is never trusted automatically: candidates stay out of the Vault until you
        press Accept. Every candidate shows its source so you can verify before approving.
      </p>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Shared candidate card scaffolding (Accept / Edit / Reject / source preview)
// ---------------------------------------------------------------------------

function CandidateShell({
  badge,
  badgeColor,
  children,
  source,
  editing,
  setEditing,
  onAccept,
  onReject,
  acceptLabel = "Accept",
  saving,
}: {
  badge: string;
  badgeColor: string;
  children: React.ReactNode;
  source: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onAccept: () => void;
  onReject: () => void;
  acceptLabel?: string;
  saving?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeColor}`}>{badge}</span>
        <div className="flex items-center gap-1">
          {editing ? (
            <Button size="sm" onClick={onAccept} disabled={saving}>
              {saving ? "Saving…" : "Save & accept"}
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" onClick={onAccept} disabled={saving}>
                {saving ? "Saving…" : acceptLabel}
              </Button>
              <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={onReject}>
                Reject
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="mt-2.5">{children}</div>
      {source ? (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-slate-400 hover:text-ink">
            Source preview
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-500">
            {source}
          </pre>
        </details>
      ) : null}
    </Card>
  );
}

/** Shared helper: link suggested skills to existing Vault skills or create them. */
function useSkillResolver() {
  const skills = useVaultStore((s) => s.skills);
  const saveRecord = useVaultStore((s) => s.saveRecord);
  return async (items: (string | SkillDraft)[]): Promise<SkillRef[]> => {
    const refs: SkillRef[] = [];
    const createdInRun = new Map<string, SkillRef>();
    for (const item of items) {
      const name = typeof item === "string" ? item.trim() : item.name.trim();
      const category: SkillCategory = typeof item === "object" && item.category ? item.category : "other";
      if (!name) continue;
      const lower = name.toLowerCase();
      const existing = createdInRun.get(lower) ??
        skills.find(
          (s) =>
            s.canonicalName.toLowerCase() === lower ||
            s.aliases.some((a) => a.alias.toLowerCase() === lower),
        );
      if (existing) {
        refs.push(
          "skillId" in existing
            ? existing
            : { skillId: existing.id, canonicalName: existing.canonicalName, confidence: 3 },
        );
      } else {
        const created = await saveRecord("skills", {
          id: 0,
          canonicalName: name,
          category,
          aliases: [],
        });
        const ref: SkillRef = {
          skillId: created.id,
          canonicalName: created.canonicalName,
          confidence: 3,
        };
        createdInRun.set(lower, ref);
        refs.push(ref);
      }
    }
    return refs;
  };
}

// ---------------------------------------------------------------------------
// Resume text import
// ---------------------------------------------------------------------------

function ResumeImportTab({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof ipc.parseResumeText>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await ipc.parseResumeText(text));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = (key: string) =>
    setDismissed((prev) => new Set(prev).add(key));

  const show = (key: string) => !dismissed.has(key);

  return (
    <div className="space-y-4">
      <Field label="Paste resume text" hint="Plain text — sections named Projects / Experience / Education / Skills work best">
        <Textarea
          rows={6}
          value={text}
          placeholder="Paste the full text of an existing resume here…"
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button onClick={() => void analyze()} disabled={busy || text.trim().length < 10}>
          {busy ? "Analyzing…" : "Analyze"}
        </Button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>

      {result ? <ResumeCandidates result={result} show={show} dismiss={dismiss} onDone={onDone} /> : null}
    </div>
  );
}

function ResumeCandidates({
  result,
  show,
  dismiss,
  onDone,
}: {
  result: Awaited<ReturnType<typeof ipc.parseResumeText>>;
  show: (key: string) => boolean;
  dismiss: (key: string) => void;
  onDone: () => void;
}) {
  const vaultSkills = useVaultStore((s) => s.skills);
  const saveProfile = useVaultStore((s) => s.saveProfile);
  const profile = useVaultStore((s) => s.profile);
  const saveRecord = useVaultStore((s) => s.saveRecord);
  const resolveSkills = useSkillResolver();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusyKey(key);
    try {
      await fn();
      dismiss(key);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const p = result.profile;
  const total =
    (p && (p.fullName || p.email || p.phone || p.headline || p.summary) ? 1 : 0) +
    result.projects.length +
    result.experiences.length +
    result.education.length +
    (result.achievements?.length ?? 0) +
    (result.skills.length > 0 ? 1 : 0);

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    if (p && (p.fullName || p.email || p.phone || p.headline || p.summary)) keys.push("profile");
    result.projects.forEach((_, i) => keys.push(`project:${i}`));
    result.experiences.forEach((_, i) => keys.push(`experience:${i}`));
    result.education.forEach((_, i) => keys.push(`education:${i}`));
    (result.achievements ?? []).forEach((_, i) => keys.push(`achievement:${i}`));
    if (result.skills.length > 0) keys.push("skills");
    return keys;
  }, [p, result]);

  const activeKeys = allKeys.filter((k) => show(k));

  if (total === 0 || activeKeys.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-muted">
        No candidates recognized. Try text with clear section headings — or add records manually.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {activeKeys.length > 1 ? (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-2 text-xs">
          <span className="font-medium text-slate-600">
            {activeKeys.length} candidate items to review
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => {
              activeKeys.forEach((k) => dismiss(k));
              toast.ok("All candidates dismissed");
            }}
          >
            Reject / clear all candidates
          </Button>
        </div>
      ) : null}

      {p && (p.fullName || p.email || p.phone || p.headline || p.summary) && show("profile") ? (
        <ProfileCandidate
          candidate={p}
          busy={busyKey === "profile"}
          onAccept={async (updated) =>
            run("profile", async () => {
              await saveProfile({
                fullName: updated.fullName,
                email: updated.email,
                github: updated.github,
                website: updated.website,
                linkedin: updated.linkedin,
                headline: updated.headline || profile?.headline || "",
                phone: updated.phone || profile?.phone || "",
                location: profile?.location || "",
                summary: updated.summary || profile?.summary || "",
              });
              toast.ok("Profile updated from import");
              onDone();
            })
          }
          onReject={() => dismiss("profile")}
        />
      ) : null}

      {result.projects.map((draft, i) => {
        const key = `project:${i}`;
        if (!show(key)) return null;
        return (
          <ProjectCandidate
            key={key}
            draft={draft}
            busy={busyKey === key}
            onAccept={async (title, description) =>
              run(key, async () => {
                const skills = await resolveSkills(draft.skills);
                const project = await saveRecord("projects", {
                  id: 0,
                  title,
                  description,
                  startDate: null,
                  endDate: null,
                  isCurrent: false,
                  url: "",
                  repoUrl: "",
                  skills,
                  evidenceCount: 0,
                } satisfies Project);
                toast.ok(`Project "${project.title}" added — add evidence in its inspector`);
              })
            }
            onReject={() => dismiss(key)}
          />
        );
      })}

      {result.experiences.map((draft, i) => {
        const key = `experience:${i}`;
        if (!show(key)) return null;
        return (
          <ExperienceCandidate
            key={key}
            draft={draft}
            busy={busyKey === key}
            onAccept={async (data) =>
              run(key, async () => {
                const text = `${data.organization} ${data.role} ${data.description}`.toLowerCase();
                const matchedSkills = vaultSkills
                  .filter((s) => {
                    const names = [s.canonicalName, ...s.aliases.map((a) => a.alias)];
                    return names.some((n) => {
                      const lower = n.toLowerCase();
                      if (lower.length <= 2) {
                        return text.split(/[^a-z0-9+#]/).includes(lower);
                      }
                      return text.includes(lower);
                    });
                  })
                  .map((s) => ({
                    skillId: s.id,
                    canonicalName: s.canonicalName,
                    confidence: 3,
                  }));

                const experience = await saveRecord("experiences", {
                  id: 0,
                  organization: data.organization,
                  role: data.role,
                  description: data.description,
                  startDate: data.startDate,
                  endDate: data.endDate,
                  isCurrent: data.isCurrent,
                  location: data.location,
                  skills: matchedSkills,
                  evidenceCount: 0,
                } satisfies Experience);
                toast.ok(`Experience "${experience.organization}" added`);
              })
            }
            onReject={() => dismiss(key)}
          />
        );
      })}

      {result.achievements?.map((draft, i) => {
        const key = `achievement:${i}`;
        if (!show(key)) return null;
        return (
          <AchievementCandidate
            key={key}
            draft={draft}
            busy={busyKey === key}
            onAccept={async (title, issuer, description, achievedOn) =>
              run(key, async () => {
                const achievement = await saveRecord("achievements", {
                  id: 0,
                  title,
                  issuer,
                  description,
                  achievedOn,
                } satisfies Achievement);
                toast.ok(`Achievement "${achievement.title}" added`);
              })
            }
            onReject={() => dismiss(key)}
          />
        );
      })}

      {result.education.map((draft, i) => {
        const key = `education:${i}`;
        if (!show(key)) return null;
        return (
          <EducationCandidate
            key={key}
            draft={draft}
            busy={busyKey === key}
            onAccept={async (data) =>
              run(key, async () => {
                const education = await saveRecord("education", {
                  id: 0,
                  institution: data.institution,
                  degree: data.degree,
                  fieldOfStudy: data.fieldOfStudy,
                  description: "",
                  startDate: data.startDate,
                  endDate: data.endDate,
                  isCurrent: data.isCurrent,
                } satisfies Education);
                toast.ok(`Education "${education.institution}" added`);
              })
            }
            onReject={() => dismiss(key)}
          />
        );
      })}

      {result.skills.length > 0 && show("skills") ? (
        <SkillsCandidate
          skills={result.skills}
          busy={busyKey === "skills"}
          onAccept={async (selected) =>
            run("skills", async () => {
              await resolveSkills(selected);
              toast.ok(`${selected.length} skill${selected.length === 1 ? "" : "s"} added with categories`);
            })
          }
          onReject={() => dismiss("skills")}
        />
      ) : null}
    </div>
  );
}

function ProfileCandidate({
  candidate,
  busy,
  onAccept,
  onReject,
}: {
  candidate: ImportProfile;
  busy: boolean;
  onAccept: (data: ImportProfile) => Promise<void>;
  onReject: () => void;
}) {
  const [fullName, setFullName] = useState(candidate.fullName);
  const [headline, setHeadline] = useState(candidate.headline);
  const [email, setEmail] = useState(candidate.email);
  const [phone, setPhone] = useState(candidate.phone);
  const [github, setGithub] = useState(candidate.github);
  const [website, setWebsite] = useState(candidate.website);
  const [linkedin, setLinkedin] = useState(candidate.linkedin);
  const [summary, setSummary] = useState(candidate.summary);
  const [editing, setEditing] = useState(false);

  const contactLine = [email, phone, linkedin, github, website].filter(Boolean).join(" · ");

  return (
    <CandidateShell
      badge="Profile"
      badgeColor="bg-kairo-violet/10 text-kairo-violet"
      source={[fullName, headline, contactLine, summary].filter(Boolean).join("\n")}
      editing={editing}
      setEditing={setEditing}
      onAccept={() =>
        void onAccept({
          fullName,
          headline,
          email,
          phone,
          github,
          website,
          linkedin,
          summary,
        })
      }
      onReject={onReject}
      saving={busy}
      acceptLabel="Accept into profile"
    >
      {editing ? (
        <div className="space-y-2">
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full Name" />
          <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Headline (e.g. Software Developer)" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="LinkedIn URL" />
            <Input value={github} onChange={(e) => setGithub(e.target.value)} placeholder="GitHub URL" />
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website URL" />
          </div>
          <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Professional summary" />
        </div>
      ) : (
        <div className="text-sm">
          <p className="font-medium text-ink">{fullName || <span className="text-muted">no name found</span>}</p>
          {headline ? <p className="text-xs font-medium text-kairo-violet">{headline}</p> : null}
          <p className="text-xs text-muted">{contactLine || "no contact details found"}</p>
          {summary ? <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-600 line-clamp-3">{summary}</p> : null}
        </div>
      )}
    </CandidateShell>
  );
}

function ProjectCandidate({
  draft,
  busy,
  onAccept,
  onReject,
}: {
  draft: ProjectDraft;
  busy: boolean;
  onAccept: (title: string, description: string) => Promise<void>;
  onReject: () => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [editing, setEditing] = useState(false);
  const skills = useVaultStore((s) => s.skills);
  const existing = (name: string) =>
    skills.some(
      (s) =>
        s.canonicalName.toLowerCase() === name.toLowerCase() ||
        s.aliases.some((a) => a.alias.toLowerCase() === name.toLowerCase()),
    );

  return (
    <CandidateShell
      badge="Project"
      badgeColor="bg-kairo-blue/10 text-kairo-blue"
      source={draft.sourceSnippet}
      editing={editing}
      setEditing={setEditing}
      onAccept={() => void onAccept(title, description)}
      onReject={onReject}
      saving={busy}
    >
      {editing ? (
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
        </div>
      ) : (
        <div className="text-sm">
          <p className="font-medium text-ink">{title}</p>
          {description ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted">{description}</p> : null}
        </div>
      )}
      {draft.skills.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {draft.skills.map((s) => (
            <span
              key={s}
              title={existing(s) ? "Links to an existing Vault skill" : "Will be created on accept"}
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                existing(s) ? "bg-kairo-blue/10 text-kairo-blue" : "bg-slate-100 text-slate-500"
              }`}
            >
              {s}{existing(s) ? " ✓" : " +"}
            </span>
          ))}
        </div>
      ) : null}
    </CandidateShell>
  );
}

function ExperienceCandidate({
  draft,
  busy,
  onAccept,
  onReject,
}: {
  draft: ExperienceDraft;
  busy: boolean;
  onAccept: (data: {
    organization: string;
    role: string;
    description: string;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    location: string;
  }) => Promise<void>;
  onReject: () => void;
}) {
  const [organization, setOrganization] = useState(draft.organization);
  const [role, setRole] = useState(draft.role);
  const [description, setDescription] = useState(draft.description);
  const [startDate, setStartDate] = useState(draft.startDate ?? "");
  const [endDate, setEndDate] = useState(draft.endDate ?? "");
  const [isCurrent, setIsCurrent] = useState(draft.isCurrent);
  const [location, setLocation] = useState(draft.location);
  const [editing, setEditing] = useState(false);

  const dateStr = [startDate, isCurrent ? "Present" : endDate].filter(Boolean).join(" – ");

  return (
    <CandidateShell
      badge="Experience"
      badgeColor="bg-kairo-dawn/20 text-amber-700"
      source={draft.sourceSnippet}
      editing={editing}
      setEditing={setEditing}
      onAccept={() =>
        void onAccept({
          organization,
          role,
          description,
          startDate: startDate || null,
          endDate: isCurrent ? null : endDate || null,
          isCurrent,
          location,
        })
      }
      onReject={onReject}
      saving={busy}
    >
      {editing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="Organization" />
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="Start (YYYY-MM)" />
            <Input value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="End (YYYY-MM)" disabled={isCurrent} />
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} />
            Currently working here
          </label>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description / Bullet points" />
        </div>
      ) : (
        <div className="text-sm">
          <div className="flex items-center justify-between">
            <p className="font-medium text-ink">{[organization, role].filter(Boolean).join(" · ")}</p>
            {dateStr ? <span className="font-mono text-xs text-muted">{dateStr}</span> : null}
          </div>
          {location ? <p className="text-xs text-slate-500">{location}</p> : null}
          {description ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{description}</p> : null}
        </div>
      )}
    </CandidateShell>
  );
}

function AchievementCandidate({
  draft,
  busy,
  onAccept,
  onReject,
}: {
  draft: AchievementDraft;
  busy: boolean;
  onAccept: (title: string, issuer: string, description: string, achievedOn: string | null) => Promise<void>;
  onReject: () => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [issuer, setIssuer] = useState(draft.issuer);
  const [description, setDescription] = useState(draft.description);
  const [achievedOn, setAchievedOn] = useState(draft.achievedOn ?? "");
  const [editing, setEditing] = useState(false);

  return (
    <CandidateShell
      badge="Achievement"
      badgeColor="bg-amber-100 text-amber-800"
      source={draft.sourceSnippet}
      editing={editing}
      setEditing={setEditing}
      onAccept={() => void onAccept(title, issuer, description, achievedOn || null)}
      onReject={onReject}
      saving={busy}
    >
      {editing ? (
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title / Award" />
          <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuer / Organization / Field" />
          <Input value={achievedOn} onChange={(e) => setAchievedOn(e.target.value)} placeholder="Date (YYYY-MM)" />
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
        </div>
      ) : (
        <div className="text-sm">
          <div className="flex items-center justify-between">
            <p className="font-medium text-ink">{title}</p>
            {achievedOn ? <span className="font-mono text-xs text-muted">{achievedOn}</span> : null}
          </div>
          {issuer ? <p className="text-xs text-slate-500">{issuer}</p> : null}
          {description ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{description}</p> : null}
        </div>
      )}
    </CandidateShell>
  );
}

function EducationCandidate({
  draft,
  busy,
  onAccept,
  onReject,
}: {
  draft: EducationDraft;
  busy: boolean;
  onAccept: (data: {
    institution: string;
    degree: string;
    fieldOfStudy: string;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
  }) => Promise<void>;
  onReject: () => void;
}) {
  const [institution, setInstitution] = useState(draft.institution);
  const [degree, setDegree] = useState(draft.degree);
  const [fieldOfStudy, setFieldOfStudy] = useState(draft.fieldOfStudy);
  const [startDate, setStartDate] = useState(draft.startDate ?? "");
  const [endDate, setEndDate] = useState(draft.endDate ?? "");
  const [isCurrent, setIsCurrent] = useState(draft.isCurrent);
  const [editing, setEditing] = useState(false);

  const dateStr = [startDate, isCurrent ? "Present" : endDate].filter(Boolean).join(" – ");

  return (
    <CandidateShell
      badge="Education"
      badgeColor="bg-emerald-100 text-emerald-700"
      source={draft.sourceSnippet}
      editing={editing}
      setEditing={setEditing}
      onAccept={() =>
        void onAccept({
          institution,
          degree,
          fieldOfStudy,
          startDate: startDate || null,
          endDate: isCurrent ? null : endDate || null,
          isCurrent,
        })
      }
      onReject={onReject}
      saving={busy}
    >
      {editing ? (
        <div className="space-y-2">
          <Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Institution" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={degree} onChange={(e) => setDegree(e.target.value)} placeholder="Degree" />
            <Input value={fieldOfStudy} onChange={(e) => setFieldOfStudy(e.target.value)} placeholder="Field of study" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="Start (YYYY-MM)" />
            <Input value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="End (YYYY-MM)" disabled={isCurrent} />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} />
            Currently studying here
          </label>
        </div>
      ) : (
        <div className="text-sm">
          <div className="flex items-center justify-between">
            <p className="font-medium text-ink">{institution}</p>
            {dateStr ? <span className="font-mono text-xs text-muted">{dateStr}</span> : null}
          </div>
          <p className="text-xs text-muted">{[degree, fieldOfStudy].filter(Boolean).join(" · ")}</p>
        </div>
      )}
    </CandidateShell>
  );
}

const CATEGORY_META: Record<SkillCategory, { label: string; badge: string }> = {
  language: { label: "Languages", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  framework: { label: "Frameworks & Libraries", badge: "bg-purple-50 text-purple-700 border-purple-200" },
  tool: { label: "Developer Tools", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  database: { label: "Databases", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  cloud: { label: "Cloud & Infrastructure", badge: "bg-sky-50 text-sky-700 border-sky-200" },
  devops: { label: "DevOps & CI/CD", badge: "bg-teal-50 text-teal-700 border-teal-200" },
  soft: { label: "Soft Skills", badge: "bg-rose-50 text-rose-700 border-rose-200" },
  other: { label: "Other Skills", badge: "bg-slate-50 text-slate-700 border-slate-200" },
};

function SkillsCandidate({
  skills,
  busy,
  onAccept,
  onReject,
}: {
  skills: SkillDraft[];
  busy: boolean;
  onAccept: (selected: SkillDraft[]) => Promise<void>;
  onReject: () => void;
}) {
  const vaultSkills = useVaultStore((s) => s.skills);
  const [items] = useState<SkillDraft[]>(skills);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(
    new Set(skills.map((s) => s.name))
  );

  const existing = (name: string) =>
    vaultSkills.some(
      (s) =>
        s.canonicalName.toLowerCase() === name.toLowerCase() ||
        s.aliases.some((a) => a.alias.toLowerCase() === name.toLowerCase()),
    );

  const toggle = (name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleCategory = (cat: SkillCategory) => {
    const inCat = items.filter((s) => s.category === cat).map((s) => s.name);
    const allSelected = inCat.every((n) => selectedNames.has(n));
    setSelectedNames((prev) => {
      const next = new Set(prev);
      for (const n of inCat) {
        if (allSelected) next.delete(n);
        else next.add(n);
      }
      return next;
    });
  };

  const selectedCount = selectedNames.size;

  const order: SkillCategory[] = [
    "language",
    "framework",
    "tool",
    "database",
    "cloud",
    "devops",
    "soft",
    "other",
  ];

  const grouped = order
    .map((cat) => ({
      category: cat,
      meta: CATEGORY_META[cat],
      skills: items.filter((s) => s.category === cat),
    }))
    .filter((g) => g.skills.length > 0);

  const handleAccept = () => {
    const toSave = items.filter((s) => selectedNames.has(s.name));
    void onAccept(toSave);
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            Skills by Category
          </span>
          <span className="ml-2 text-xs text-muted">
            Divided into {grouped.length} {grouped.length === 1 ? "category" : "categories"}
          </span>
        </div>
        <div className="flex gap-1">
          <Button size="sm" disabled={busy || selectedCount === 0} onClick={handleAccept}>
            {busy ? "Saving…" : `Add ${selectedCount} selected`}
          </Button>
          <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={onReject}>
            Reject
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-4">
        {grouped.map(({ category, meta, skills: catSkills }) => {
          const allCatSelected = catSkills.every((s) => selectedNames.has(s.name));
          return (
            <div key={category} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-ink hover:text-kairo-blue cursor-pointer"
                >
                  <span className={`inline-block h-2 w-2 rounded-full ${allCatSelected ? "bg-kairo-blue" : "bg-slate-300"}`} />
                  <span>{meta.label}</span>
                  <span className="text-[11px] font-normal text-muted">({catSkills.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className="text-[11px] text-muted hover:text-ink cursor-pointer"
                >
                  {allCatSelected ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {catSkills.map((s) => {
                  const isSelected = selectedNames.has(s.name);
                  const isEx = existing(s.name);
                  return (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => toggle(s.name)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors duration-150 cursor-pointer ${
                        isSelected
                          ? isEx
                            ? "border-kairo-blue/40 bg-kairo-blue/10 text-kairo-blue font-medium"
                            : "border-transparent bg-kairo-blue text-white"
                          : "border-slate-200 bg-slate-50 text-slate-400 line-through"
                      }`}
                      title={isEx ? "Already in Vault — will link" : `Will be saved as ${meta.label}`}
                    >
                      {s.name}
                      {isEx ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// GitHub import
// ---------------------------------------------------------------------------

function GithubImportTab({ onDone }: { onDone: () => void }) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [candidate, setCandidate] = useState<GithubRepoCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRepo = async () => {
    setBusy(true);
    setError(null);
    setCandidate(null);
    try {
      setCandidate(await ipc.githubRepoCandidate(owner.trim(), repo.trim()));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">
        Reads public metadata, description and languages from the GitHub API to suggest a project
        record. Public repositories only — and every field stays editable before it enters the
        Vault.
      </p>
      <div className="flex items-end gap-2">
        <Field label="Owner">
          <Input value={owner} placeholder="e.g. torvalds" onChange={(e) => setOwner(e.target.value)} />
        </Field>
        <Field label="Repository">
          <Input value={repo} placeholder="e.g. linux" onChange={(e) => setRepo(e.target.value)} />
        </Field>
        <div className="pb-0.5">
          <Button onClick={() => void fetchRepo()} disabled={busy || !owner.trim() || !repo.trim()}>
            {busy ? "Fetching…" : "Fetch"}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}
      {candidate ? <GithubCandidateCard candidate={candidate} onDone={onDone} /> : null}
    </div>
  );
}

function GithubCandidateCard({
  candidate,
  onDone,
}: {
  candidate: GithubRepoCandidate;
  onDone: () => void;
}) {
  const saveRecord = useVaultStore((s) => s.saveRecord);
  const resolveSkills = useSkillResolver();
  const [title, setTitle] = useState(candidate.title);
  const [description, setDescription] = useState(candidate.description);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const vaultSkills = useVaultStore((s) => s.skills);
  const existing = (name: string) =>
    vaultSkills.some(
      (s) =>
        s.canonicalName.toLowerCase() === name.toLowerCase() ||
        s.aliases.some((a) => a.alias.toLowerCase() === name.toLowerCase()),
    );

  if (rejected) {
    return <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-muted">Candidate rejected.</p>;
  }

  const accept = async () => {
    setBusy(true);
    try {
      const skills = await resolveSkills(candidate.skills);
      const project = await saveRecord("projects", {
        id: 0,
        title,
        description,
        startDate: candidate.startDate,
        endDate: null,
        isCurrent: false,
        url: candidate.url,
        repoUrl: candidate.repoUrl,
        skills,
        evidenceCount: 0,
      } satisfies Project);
      toast.ok(`Project "${project.title}" imported from GitHub — review and add evidence`);
      onDone();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CandidateShell
      badge="Project · from GitHub"
      badgeColor="bg-kairo-midnight/10 text-kairo-midnight"
      source={candidate.sourcePreview}
      editing={editing}
      setEditing={setEditing}
      onAccept={() => void accept()}
      onReject={() => setRejected(true)}
      saving={busy}
    >
      {editing ? (
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
        </div>
      ) : (
        <div className="text-sm">
          <p className="font-medium text-ink">{title}</p>
          <p className="mt-0.5 text-xs text-muted">{description || "no description"}</p>
          <p className="mt-1 break-all text-[11px] text-slate-400">
            {[candidate.repoUrl, candidate.url !== candidate.repoUrl ? candidate.url : "", candidate.startDate ? `started ${candidate.startDate}` : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
      {candidate.skills.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {candidate.skills.map((s) => (
            <span
              key={s}
              title={existing(s) ? "Links to an existing Vault skill" : "Will be created on accept"}
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                existing(s) ? "bg-kairo-blue/10 text-kairo-blue" : "bg-slate-100 text-slate-500"
              }`}
            >
              {s}
              {existing(s) ? " ✓" : " +"}
            </span>
          ))}
        </div>
      ) : null}
    </CandidateShell>
  );
}

// ---------------------------------------------------------------------------
// Certificate import
// ---------------------------------------------------------------------------

function CertificateImportTab({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [candidate, setCandidate] = useState<CertificateCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      setCandidate(await ipc.parseCertificateText(text));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Paste certificate text or email" hint="Issuer emails, certificate pages or plain pasted text">
        <Textarea
          rows={6}
          value={text}
          placeholder={"e.g.\nCertificate of Completion\nhas successfully completed Rust Fundamentals\nissued by Coursera\nMarch 2025"}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button onClick={() => void analyze()} disabled={busy || text.trim().length < 10}>
          {busy ? "Analyzing…" : "Analyze"}
        </Button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
      {candidate ? <CertificateCandidateCard candidate={candidate} onDone={onDone} /> : null}
    </div>
  );
}

function CertificateCandidateCard({
  candidate,
  onDone,
}: {
  candidate: CertificateCandidate;
  onDone: () => void;
}) {
  const saveRecord = useVaultStore((s) => s.saveRecord);
  const [title, setTitle] = useState(candidate.title);
  const [issuer, setIssuer] = useState(candidate.issuer);
  const [issueDate, setIssueDate] = useState(candidate.issueDate ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);

  if (rejected) {
    return <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-muted">Candidate rejected.</p>;
  }

  const accept = async () => {
    setBusy(true);
    try {
      const certification = await saveRecord("certifications", {
        id: 0,
        title,
        issuer,
        description: "",
        issueDate: issueDate || null,
        expiryDate: null,
        credentialId: "",
        url: "",
      });
      toast.ok(`Certification "${certification.title}" added — attach the certificate file as evidence`);
      onDone();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CandidateShell
      badge="Certification"
      badgeColor="bg-emerald-100 text-emerald-700"
      source={candidate.sourceSnippet}
      editing={editing}
      setEditing={setEditing}
      onAccept={() => void accept()}
      onReject={() => setRejected(true)}
      saving={busy}
    >
      {editing ? (
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuer" />
          <Input type="month" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} placeholder="Issue date" />
        </div>
      ) : (
        <div className="text-sm">
          <p className="font-medium text-ink">{title || <span className="text-muted">no title recognized — edit the candidate</span>}</p>
          <p className="mt-0.5 text-xs text-muted">
            {[issuer, candidate.issueDate ? `issued ${candidate.issueDate}` : ""].filter(Boolean).join(" · ") ||
              "no issuer/date recognized"}
          </p>
          {candidate.email ? <p className="mt-0.5 text-[11px] text-slate-400">{candidate.email}</p> : null}
        </div>
      )}
    </CandidateShell>
  );
}
