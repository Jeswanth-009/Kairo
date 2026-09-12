import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dialog } from "../../components/ui/Dialog";
import { Checkbox, Field, Input, Select, Textarea } from "../../components/ui/inputs";
import {
  CONFIDENCE_LEVELS,
  EVIDENCE_KINDS,
} from "../../lib/types";
import type {
  AnyVaultRecord,
  CanonicalBullet,
  ClaimRule,
  ClaimRuleType,
  Evidence,
  EvidenceKind,
  TrustEntityType,
} from "../../lib/types";
import { useVaultStore } from "../../stores/vaultStore";
import { toast } from "../../stores/toastStore";
import { ENTITY_CONFIGS, subtitleOf, type EntityKey } from "./vaultConfig";

const ENTITY_TYPE: Record<EntityKey, TrustEntityType> = {
  projects: "project",
  experiences: "experience",
  education: "education",
  certifications: "certification",
  achievements: "achievement",
};

const KIND_COLORS: Record<string, string> = {
  repository: "bg-kairo-violet/10 text-kairo-violet",
  document: "bg-kairo-blue/10 text-kairo-blue",
  certificate: "bg-kairo-blue/10 text-kairo-blue",
  metric: "bg-emerald-100 text-emerald-700",
  note: "bg-slate-100 text-slate-600",
  link: "bg-kairo-sky/20 text-sky-700",
  other: "bg-slate-100 text-slate-600",
};

type InspectorTab = "overview" | "evidence" | "bullets" | "rules";

export function RecordInspector({
  onClose,
  entityKey,
  record,
}: {
  onClose: () => void;
  entityKey: EntityKey;
  record: AnyVaultRecord;
}) {
  const entityType = ENTITY_TYPE[entityKey];
  const entityId = record.id;
  const config = ENTITY_CONFIGS[entityKey];
  const hasBullets = entityType === "project" || entityType === "experience";

  const [tab, setTab] = useState<InspectorTab>("overview");
  const loadEvidence = useVaultStore((s) => s.loadEvidence);
  const loadBullets = useVaultStore((s) => s.loadBullets);
  const loadRules = useVaultStore((s) => s.loadRules);

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([
          loadEvidence(entityType, entityId),
          hasBullets ? loadBullets(entityType, entityId) : Promise.resolve(),
          loadRules(entityType, entityId),
        ]);
      } catch (e) {
        toast.error(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  const evidence = useVaultStore((s) => s.evidenceCache[`${entityType}:${entityId}`]) ?? [];
  const bullets = useVaultStore((s) => s.bulletsCache[`${entityType}:${entityId}`]) ?? [];
  const rules = useVaultStore((s) => s.rulesCache[`${entityType}:${entityId}`]) ?? [];

  const title = "title" in record ? record.title : "";
  const subtitle = subtitleOf(entityKey, record);

  const TABS: { key: InspectorTab; label: string; count?: number; show: boolean }[] = [
    { key: "overview", label: "Overview", show: true },
    { key: "evidence", label: "Evidence", count: evidence.length, show: true },
    { key: "bullets", label: "Bullets", count: bullets.length, show: hasBullets },
    { key: "rules", label: "Claim rules", count: rules.length, show: true },
  ];

  return (
    <Dialog open onClose={onClose} title={`${config.singular} · ${title}`} maxWidth="max-w-2xl">
      <div className="mb-5 flex flex-wrap gap-1.5">
        {TABS.filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-200",
              tab === t.key ? "bg-kairo-midnight text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200",
            ].join(" ")}
          >
            {t.label}
            {t.count !== undefined ? (
              <span
                className={`ml-1.5 rounded-full px-1.5 text-[10px] ${
                  tab === t.key ? "bg-white/15 text-white" : "bg-white text-slate-500"
                }`}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? <OverviewTab entityKey={entityKey} record={record} subtitle={subtitle} /> : null}
      {tab === "evidence" ? <EvidenceTab entityType={entityType} entityId={entityId} evidence={evidence} /> : null}
      {tab === "bullets" && hasBullets ? (
        <BulletsTab entityType={entityType} entityId={entityId} bullets={bullets} evidence={evidence} />
      ) : null}
      {tab === "rules" ? <RulesTab entityType={entityType} entityId={entityId} rules={rules} /> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewTab({
  entityKey,
  record,
  subtitle,
}: {
  entityKey: EntityKey;
  record: AnyVaultRecord;
  subtitle: string;
}) {
  const config = ENTITY_CONFIGS[entityKey];
  const rows: { label: string; value: string }[] = [];
  if (config) {
    for (const field of config.fields) {
      if (field.type === "textarea" || field.type === "checkbox") continue;
      if (field.name === "title") continue;
      const raw = (record as unknown as Record<string, unknown>)[field.name];
      if (typeof raw === "string" && raw) rows.push({ label: field.label, value: raw });
    }
  }
  const description = (record as { description?: string }).description ?? "";
  const skills = "skills" in record ? record.skills : [];

  return (
    <div>
      <h3 className="text-base font-semibold text-ink">{"title" in record ? record.title : ""}</h3>
      {subtitle ? <p className="mt-1 text-xs text-muted">{subtitle}</p> : null}

      {description ? (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">{description}</p>
      ) : null}

      {skills.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Skills</h4>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {skills.map((ref) => (
              <span
                key={ref.skillId}
                title={`Confidence ${ref.confidence}: ${CONFIDENCE_LEVELS[ref.confidence]}`}
                className="rounded-full bg-kairo-blue/10 px-2.5 py-1 text-xs font-medium text-kairo-blue"
              >
                {ref.canonicalName} · {ref.confidence}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-100 pt-2">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-6 py-2 text-sm">
              <dt className="shrink-0 text-xs text-muted">{row.label}</dt>
              <dd className="break-all text-right text-xs text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

function EvidenceTab({
  entityType,
  entityId,
  evidence,
}: {
  entityType: TrustEntityType;
  entityId: number;
  evidence: Evidence[];
}) {
  const saveEvidence = useVaultStore((s) => s.saveEvidence);
  const deleteEvidence = useVaultStore((s) => s.deleteEvidence);
  const [editing, setEditing] = useState<Evidence | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Evidence | null>(null);

  const verifiedCount = evidence.filter((e) => e.verified).length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-muted">
          {evidence.length === 0
            ? "No proof attached yet — claims without evidence cannot be trusted downstream."
            : `${verifiedCount} of ${evidence.length} verified`}
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          Add evidence
        </Button>
      </div>

      {evidence.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-muted">
          Attach a repository, document, certificate, measured metric or note — then mark it
          verified once you have confirmed it.
        </div>
      ) : (
        <ul className="space-y-2">
          {evidence.map((item) => (
            <li key={item.id} className="rounded-lg border border-slate-200 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        KIND_COLORS[item.kind] ?? KIND_COLORS.other
                      }`}
                    >
                      {item.kind}
                    </span>
                    <span className="text-sm font-medium text-ink">{item.title}</span>
                    {item.verified ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        ✓ Verified
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        Unverified
                      </span>
                    )}
                  </div>
                  {item.reference ? (
                    <p className="mt-1.5 break-all text-xs text-muted">
                      {/^https?:\/\//.test(item.reference) ? (
                        <a
                          href={item.reference}
                          target="_blank"
                          rel="noreferrer"
                          className="text-kairo-blue hover:underline"
                        >
                          {item.reference}
                        </a>
                      ) : (
                        item.reference
                      )}
                    </p>
                  ) : null}
                  {item.note ? <p className="mt-1 text-xs text-muted">{item.note}</p> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(item)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => setDeleting(item)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <EvidenceDialog
        open={creating || !!editing}
        evidence={editing}
        entityType={entityType}
        entityId={entityId}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={async (data) => {
          await saveEvidence(data);
          toast.ok(editing ? "Evidence updated" : "Evidence added");
          setCreating(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete evidence"
        message={`Delete "${deleting?.title ?? ""}"? Bullets referencing it will lose this proof reference.`}
        onConfirm={() => {
          if (deleting) {
            void (async () => {
              try {
                await deleteEvidence(entityType, entityId, deleting.id);
                toast.ok("Evidence deleted");
              } catch (e) {
                toast.error(String(e));
              }
            })();
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function EvidenceDialog({
  open,
  evidence,
  entityType,
  entityId,
  onClose,
  onSave,
}: {
  open: boolean;
  evidence: Evidence | null;
  entityType: TrustEntityType;
  entityId: number;
  onClose: () => void;
  onSave: (data: Evidence) => Promise<void>;
}) {
  const [values, setValues] = useState<Evidence>(
    evidence ?? {
      id: 0,
      entityType,
      entityId,
      kind: "repository",
      title: "",
      reference: "",
      note: "",
      verified: false,
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const set = <K extends keyof Evidence>(name: K, value: Evidence[K]) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const save = async () => {
    if (!values.title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    try {
      await onSave(values);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={evidence ? "Edit evidence" : "Add evidence"} maxWidth="max-w-md">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Kind">
            <Select value={values.kind} onChange={(e) => set("kind", e.target.value as EvidenceKind)}>
              {EVIDENCE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" required error={error ?? undefined}>
            <Input
              autoFocus
              value={values.title}
              placeholder="e.g. GitHub repository"
              onChange={(e) => {
                set("title", e.target.value);
                setError(null);
              }}
            />
          </Field>
        </div>
        <Field label="Reference" hint="URL or file path">
          <Input
            value={values.reference}
            placeholder="https://…"
            onChange={(e) => set("reference", e.target.value)}
          />
        </Field>
        <Field label="Note">
          <Textarea
            rows={2}
            value={values.note}
            placeholder="What does this prove?"
            onChange={(e) => set("note", e.target.value)}
          />
        </Field>
        <Checkbox
          label="Verified — I have confirmed this source supports the claim"
          checked={values.verified}
          onChange={(checked) => set("verified", checked)}
        />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Canonical bullets
// ---------------------------------------------------------------------------

function BulletsTab({
  entityType,
  entityId,
  bullets,
  evidence,
}: {
  entityType: TrustEntityType;
  entityId: number;
  bullets: CanonicalBullet[];
  evidence: Evidence[];
}) {
  const saveBullet = useVaultStore((s) => s.saveBullet);
  const deleteBullet = useVaultStore((s) => s.deleteBullet);
  const [editing, setEditing] = useState<CanonicalBullet | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CanonicalBullet | null>(null);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-muted">
          Approved bullets are the exact factual language resumes are built from. Link each one to
          the evidence that supports it.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          Add bullet
        </Button>
      </div>

      {bullets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-muted">
          No canonical bullets yet. Write the factual sentences a resume would use — nothing gets
          approved without support.
        </div>
      ) : (
        <ul className="space-y-2">
          {bullets.map((bullet) => (
            <li key={bullet.id} className="rounded-lg border border-slate-200 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm leading-relaxed text-ink">{bullet.text}</p>
                {bullet.approved ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    ✓ Approved
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    Draft
                  </span>
                )}
              </div>
              {bullet.evidence.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {bullet.evidence.map((ref) => (
                    <span
                      key={ref.id}
                      title={`${ref.kind}${ref.verified ? " · verified" : " · unverified"}`}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                        ref.verified ? "bg-kairo-blue/10 text-kairo-blue" : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {ref.verified ? "✓" : "…"} {ref.title}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-amber-600">
                  No evidence linked — approve only what you can support.
                </p>
              )}
              <div className="mt-2 flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(bullet)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => setDeleting(bullet)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <BulletDialog
        open={creating || !!editing}
        bullet={editing}
        entityType={entityType}
        entityId={entityId}
        evidence={evidence}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={async (data, isNew) => {
          await saveBullet(data, isNew);
          toast.ok(isNew ? "Bullet added" : "Bullet updated");
          setCreating(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete bullet"
        message="Delete this canonical bullet? This cannot be undone."
        onConfirm={() => {
          if (deleting) {
            void (async () => {
              try {
                await deleteBullet(entityType, entityId, deleting.id);
                toast.ok("Bullet deleted");
              } catch (e) {
                toast.error(String(e));
              }
            })();
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function BulletDialog({
  open,
  bullet,
  entityType,
  entityId,
  evidence,
  onClose,
  onSave,
}: {
  open: boolean;
  bullet: CanonicalBullet | null;
  entityType: TrustEntityType;
  entityId: number;
  evidence: Evidence[];
  onClose: () => void;
  onSave: (data: CanonicalBullet, isNew: boolean) => Promise<void>;
}) {
  const isNew = !bullet;
  const [text, setText] = useState(bullet?.text ?? "");
  const [approved, setApproved] = useState(bullet?.approved ?? false);
  const [evidenceIds, setEvidenceIds] = useState<number[]>(
    bullet?.evidence.map((r) => r.id) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const toggle = (id: number) =>
    setEvidenceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    if (!text.trim()) {
      setError("Bullet text is required");
      return;
    }
    setSaving(true);
    try {
      await onSave(
        {
          id: bullet?.id ?? 0,
          entityType: entityType as "project" | "experience",
          entityId,
          text: text.trim(),
          approved,
          sortOrder: bullet?.sortOrder ?? 0,
          evidence: [],
          evidenceIds: isNew ? evidenceIds : evidence.length > 0 ? evidenceIds : [],
        },
        isNew,
      );
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? "Add bullet" : "Edit bullet"} maxWidth="max-w-md">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Bullet text" required error={error ?? undefined} hint="Factual language only">
          <Textarea
            autoFocus
            value={text}
            placeholder="e.g. Implemented WAL with crash recovery and TTL eviction"
            error={!!error}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <div>
          <h4 className="mb-1.5 text-xs font-medium text-ink">Supporting evidence</h4>
          {evidence.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              No evidence records exist for this record yet — add evidence first so this bullet can
              reference it.
            </p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {evidence.map((e) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={evidenceIds.includes(e.id)}
                    onChange={() => toggle(e.id)}
                    className="h-4 w-4 rounded border-slate-300 accent-kairo-blue"
                  />
                  <span className={e.verified ? "" : "text-muted"}>{e.title}</span>
                  <span className="text-[11px] text-slate-400">{e.kind}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <Checkbox
          label="Approved — this is the exact factual wording"
          checked={approved}
          onChange={setApproved}
        />

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Claim rules
// ---------------------------------------------------------------------------

function RulesTab({
  entityType,
  entityId,
  rules,
}: {
  entityType: TrustEntityType;
  entityId: number;
  rules: ClaimRule[];
}) {
  const saveRule = useVaultStore((s) => s.saveRule);
  const deleteRule = useVaultStore((s) => s.deleteRule);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClaimRule | null>(null);
  const [deleting, setDeleting] = useState<ClaimRule | null>(null);

  const scoped = rules.filter((r) => r.entityType !== null);
  const global = rules.filter((r) => r.entityType === null);

  const list = (items: ClaimRule[], emptyText: string) =>
    items.length === 0 ? (
      <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-muted">
        {emptyText}
      </p>
    ) : (
      <ul className="space-y-2">
        {items.map((rule) => (
          <li key={rule.id} className="rounded-lg border border-slate-200 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    rule.ruleType === "forbidden_claim"
                      ? "bg-red-100 text-red-700"
                      : "bg-kairo-blue/10 text-kairo-blue"
                  }`}
                >
                  {rule.ruleType === "forbidden_claim" ? "Forbidden claim" : "Allowed claim"}
                </span>
                <p className="mt-1.5 font-mono text-xs text-ink">“{rule.pattern}”</p>
                {rule.note ? <p className="mt-1 text-xs text-muted">{rule.note}</p> : null}
              </div>
              <div className="flex shrink-0 gap-1">
                {rule.entityType !== null ? (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(rule)}>
                    Edit
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => setDeleting(rule)}
                >
                  Delete
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-muted">
          Boundaries the AI rewriter must respect in Phase 7 — forbidden claims are blocked, allowed
          claims are the only exaggerations permitted.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          Add rule
        </Button>
      </div>

      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        For this record
      </h4>
      {list(
        scoped,
        "No rules for this record yet. Example: forbid “production-scale distributed system”.",
      )}

      <h4 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Global (apply to everything)
      </h4>
      {list(global, "No global rules yet.")}

      <RuleDialog
        open={creating || !!editing}
        rule={editing}
        entityType={entityType}
        entityId={entityId}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={async (data) => {
          await saveRule(data);
          toast.ok(editing ? "Rule updated" : "Rule added");
          setCreating(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete claim rule"
        message={`Delete the rule “${deleting?.pattern ?? ""}”?`}
        onConfirm={() => {
          if (deleting) {
            void (async () => {
              try {
                await deleteRule(entityType, entityId, deleting.id);
                toast.ok("Rule deleted");
              } catch (e) {
                toast.error(String(e));
              }
            })();
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function RuleDialog({
  open,
  rule,
  entityType,
  entityId,
  onClose,
  onSave,
}: {
  open: boolean;
  rule: ClaimRule | null;
  entityType: TrustEntityType;
  entityId: number;
  onClose: () => void;
  onSave: (data: ClaimRule) => Promise<void>;
}) {
  const [values, setValues] = useState<ClaimRule>(
    rule ?? {
      id: 0,
      entityType,
      entityId,
      ruleType: "forbidden_claim",
      pattern: "",
      note: "",
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const save = async () => {
    if (!values.pattern.trim()) {
      setError("Pattern is required");
      return;
    }
    setSaving(true);
    try {
      await onSave(values);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={rule ? "Edit claim rule" : "Add claim rule"} maxWidth="max-w-md">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Rule type">
          <Select
            value={values.ruleType}
            onChange={(e) => setValues((prev) => ({ ...prev, ruleType: e.target.value as ClaimRuleType }))}
          >
            <option value="forbidden_claim">Forbidden claim — must never appear</option>
            <option value="allowed_claim">Allowed claim — explicitly permitted</option>
          </Select>
        </Field>
        <Field label="Pattern" required error={error ?? undefined} hint="Phrase to match">
          <Input
            autoFocus
            value={values.pattern}
            placeholder="e.g. production-scale distributed system"
            onChange={(e) => {
              setValues((prev) => ({ ...prev, pattern: e.target.value }));
              setError(null);
            }}
          />
        </Field>
        <Field label="Note">
          <Textarea
            rows={2}
            value={values.note}
            placeholder="Why does this boundary exist?"
            onChange={(e) => setValues((prev) => ({ ...prev, note: e.target.value }))}
          />
        </Field>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
