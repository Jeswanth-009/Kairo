import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field, Input, Select, Textarea } from "../../components/ui/inputs";
import { ipc } from "../../lib/ipc";
import { JOB_REQUIREMENT_KINDS } from "../../lib/types";
import type { Job, JobRequirement, JobRequirementKind } from "../../lib/types";
import { useJobsStore } from "../../stores/jobsStore";
import { toast } from "../../stores/toastStore";

const IMPORTANCE_OPTIONS: { value: number; label: string }[] = [
  { value: 0.2, label: "Low" },
  { value: 0.4, label: "Nice to have" },
  { value: 0.6, label: "Standard" },
  { value: 0.8, label: "High" },
  { value: 1.0, label: "Critical" },
];

const SENIORITIES = ["", "Internship", "Junior", "Mid-level", "Senior", "Staff", "Lead", "Leadership"];

/** Step 1: paste the JD. Step 2: review + correct the extraction, then save. */
export function NewJobDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const createWorkspace = useJobsStore((s) => s.createWorkspace);

  const [step, setStep] = useState<"paste" | "review">("paste");
  const [jdText, setJdText] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [url, setUrl] = useState("");
  const [seniority, setSeniority] = useState("");
  const [domain, setDomain] = useState("");
  const [requirements, setRequirements] = useState<JobRequirement[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setStep("paste");
    setJdText("");
    setCompany("");
    setRole("");
    setUrl("");
    setSeniority("");
    setDomain("");
    setRequirements([]);
    setError(null);
  };

  const close = () => {
    onClose();
    reset();
  };

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const extraction = await ipc.parseJd(jdText);
      // Merge extraction suggestions with anything the user already typed.
      setCompany((c) => c || extraction.company);
      setRole((r) => r || extraction.role);
      setUrl((u) => u || extraction.url);
      setSeniority((s) => s || extraction.seniority);
      setDomain((d) => d || extraction.domain);
      setRequirements(
        extraction.requirements.map((d, i) => ({
          id: -(i + 1),
          jobId: 0,
          kind: d.kind,
          rawText: d.rawText,
          normalizedKey: d.rawText.toLowerCase(),
          importance: d.importance,
          userConfirmed: true,
        })),
      );
      setStep("review");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (requirements.length === 0) {
      setError("Add or extract at least one requirement before saving.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const job: Job = {
        id: 0,
        company: company.trim(),
        roleTitle: role.trim(),
        url: url.trim(),
        rawJd: jdText,
        seniority: seniority.trim(),
        domain: domain.trim(),
        requirementCount: 0,
      };
      const created = await createWorkspace(job, requirements);
      toast.ok(`Workspace for "${created.job.roleTitle || "Untitled role"}" created`);
      close();
      navigate(`/jobs/${created.job.id}`);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const updateReq = (id: number, patch: Partial<JobRequirement>) =>
    setRequirements((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeReq = (id: number) => setRequirements((prev) => prev.filter((r) => r.id !== id));

  const addReq = () =>
    setRequirements((prev) => [
      ...prev,
      {
        id: Math.min(-1, Math.min(...prev.map((r) => r.id)) - 1),
        jobId: 0,
        kind: "required_skill" as JobRequirementKind,
        rawText: "",
        normalizedKey: "",
        importance: 0.8,
        userConfirmed: true,
      },
    ]);

  return (
    <Dialog open={open} onClose={close} title="New job workspace" maxWidth="max-w-2xl">
      {step === "paste" ? (
        <div className="space-y-4">
          <Field
            label="Job description"
            required
            hint="Stored verbatim — the original text is never edited"
          >
            <Textarea
              autoFocus
              rows={10}
              value={jdText}
              placeholder={"Paste the exact job description here…"}
              onChange={(e) => {
                setJdText(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company" hint="optional — extracted if left blank">
              <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            </Field>
            <Field label="Role" hint="optional">
              <Input value={role} onChange={(e) => setRole(e.target.value)} />
            </Field>
            <Field label="Posting URL" hint="optional">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>
          </div>
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={() => void analyze()} disabled={busy || jdText.trim().length < 30}>
              {busy ? "Analyzing…" : "Analyze description"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Role">
              <Input value={role} onChange={(e) => setRole(e.target.value)} />
            </Field>
            <Field label="Company">
              <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            </Field>
            <Field label="Seniority">
              <Select value={seniority} onChange={(e) => setSeniority(e.target.value)}>
                {SENIORITIES.map((s) => (
                  <option key={s} value={s}>
                    {s || "Unspecified"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Domain" hint="suggested, editable">
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. Fintech" />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Requirements ({requirements.length})
                </h4>
                {requirements.length > 0 ? (
                  <span className="text-[11px] text-muted">
                    · {requirements.filter((r) => r.kind === "required_skill").length} required
                    · {requirements.filter((r) => r.kind === "responsibility").length} responsibilities
                    {requirements.filter((r) => r.kind === "preferred_skill").length > 0 ? (
                      <> · {requirements.filter((r) => r.kind === "preferred_skill").length} preferred</>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {requirements.length > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => setRequirements([])}
                  >
                    Clear all
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" onClick={addReq}>
                  + Add requirement
                </Button>
              </div>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {requirements.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-xs text-muted">
                  Nothing was extracted — add requirements manually or go back and paste the full
                  posting.
                </p>
              ) : (
                requirements.map((req) => (
                  <div key={req.id} className="flex items-center gap-2">
                    <Select
                      value={req.kind}
                      onChange={(e) => updateReq(req.id, { kind: e.target.value as JobRequirementKind })}
                      className="h-9 w-40 shrink-0 text-xs"
                    >
                      {JOB_REQUIREMENT_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={req.rawText}
                      onChange={(e) => updateReq(req.id, { rawText: e.target.value })}
                      className="h-9 text-xs"
                    />
                    <Select
                      value={req.importance}
                      onChange={(e) => updateReq(req.id, { importance: Number(e.target.value) })}
                      className="h-9 w-32 shrink-0 text-xs"
                    >
                      {IMPORTANCE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-red-600 hover:bg-red-50"
                      onClick={() => removeReq(req.id)}
                    >
                      ✕
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          ) : null}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep("paste")}>
              Back to text
            </Button>
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? "Creating…" : "Save workspace"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
