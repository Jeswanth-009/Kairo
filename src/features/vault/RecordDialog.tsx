import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Checkbox, Field, Input, Select, Textarea } from "../../components/ui/inputs";
import { CONFIDENCE_LEVELS, SKILL_CATEGORIES } from "../../lib/types";
import type {
  Achievement,
  AnyVaultRecord,
  Certification,
  Education,
  EntityKey,
  Experience,
  Project,
  Skill,
  SkillCategory,
  SkillRef,
} from "../../lib/types";
import { useVaultStore } from "../../stores/vaultStore";
import { toast } from "../../stores/toastStore";
import { validateValues, type FieldDef, ENTITY_CONFIGS } from "./vaultConfig";

function initialValues(fields: FieldDef[], record: AnyVaultRecord | null) {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const existing = record
      ? (record as unknown as Record<string, unknown>)[field.name]
      : undefined;
    if (field.type === "checkbox") values[field.name] = Boolean(existing);
    else if (field.type === "month") values[field.name] = (existing as string | null) ?? "";
    else values[field.name] = (existing as string | undefined) ?? "";
  }
  return values;
}

/** Linked-skills editor for projects and experiences (confidence 0–5). */
function SkillLinkEditor({
  value,
  onChange,
}: {
  value: SkillRef[];
  onChange: (next: SkillRef[]) => void;
}) {
  const skills = useVaultStore((s) => s.skills);
  const saveSkill = useVaultStore((s) => s.saveRecord);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<SkillCategory>("language");

  const linked = new Map(value.map((ref) => [ref.skillId, ref]));
  const filtered = skills.filter((s) =>
    s.canonicalName.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const toggle = (skill: Skill) => {
    if (linked.has(skill.id)) {
      onChange(value.filter((ref) => ref.skillId !== skill.id));
    } else {
      onChange([
        ...value,
        { skillId: skill.id, canonicalName: skill.canonicalName, confidence: 3 },
      ]);
    }
  };

  const setConfidence = (skillId: number, confidence: number) => {
    onChange(value.map((ref) => (ref.skillId === skillId ? { ...ref, confidence } : ref)));
  };

  const createSkill = async () => {
    if (!newName.trim()) return;
    try {
      const created = await saveSkill("skills", {
        id: 0,
        canonicalName: newName.trim(),
        category: newCategory,
        aliases: [],
      });
      onChange([
        ...value,
        { skillId: created.id, canonicalName: created.canonicalName, confidence: 3 },
      ]);
      setNewName("");
      setAdding(false);
      toast.ok(`Skill "${created.canonicalName}" added to the Vault`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center gap-2 border-b border-line p-2.5">
        <Input
          placeholder="Search skills…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 flex-1 py-1 text-xs"
        />
        <Button size="sm" variant={adding ? "secondary" : "primary"} onClick={() => setAdding(!adding)}>
          {adding ? "Cancel" : "+ New skill"}
        </Button>
      </div>

      {adding ? (
        <div className="flex items-end gap-2 border-b border-line bg-surface p-2.5">
          <div className="flex-1">
            <Input
              autoFocus
              placeholder="Skill name (e.g. PostgreSQL)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createSkill();
              }}
              className="h-8 py-1 text-xs"
            />
          </div>
          <Select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as SkillCategory)}
            className="h-8 w-36 py-1 text-xs"
          >
            {SKILL_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => void createSkill()}>
            Add
          </Button>
        </div>
      ) : null}

      <div className="max-h-44 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted">
            No skills yet — create the first one with “+ New skill”.
          </p>
        ) : (
          filtered.map((skill) => {
            const ref = linked.get(skill.id);
            return (
              <div
                key={skill.id}
                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${
                  ref ? "bg-kairo-blue/5" : ""
                }`}
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={!!ref}
                    onChange={() => toggle(skill)}
                    className="h-4 w-4 rounded border-line-strong accent-kairo-blue"
                  />
                  {skill.canonicalName}
                  {skill.aliases.length > 0 ? (
                    <span className="text-xs text-muted">
                      ({skill.aliases.map((a) => a.alias).join(", ")})
                    </span>
                  ) : null}
                </label>
                {ref ? (
                  <select
                    value={ref.confidence}
                    title={CONFIDENCE_LEVELS[ref.confidence]}
                    onChange={(e) => setConfidence(skill.id, Number(e.target.value))}
                    className="rounded-md border border-line bg-card px-1.5 py-1 text-xs text-ink focus:border-kairo-blue focus:outline-none"
                  >
                    {CONFIDENCE_LEVELS.map((label, level) => (
                      <option key={level} value={level}>
                        {level} · {label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function RecordDialog({
  open,
  onClose,
  entityKey,
  record,
}: {
  open: boolean;
  onClose: () => void;
  entityKey: EntityKey;
  record: AnyVaultRecord | null;
}) {
  const config = ENTITY_CONFIGS[entityKey];
  const saveRecord = useVaultStore((s) => s.saveRecord);

  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialValues(config.fields, record),
  );
  const [skills, setSkills] = useState<SkillRef[]>(
    () => ("skills" in (record ?? {}) ? ((record as { skills: SkillRef[] }).skills ?? []) : []),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setField = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const save = async () => {
    const fieldErrors = validateValues(config.fields, values);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const payload = {
        id: record ? record.id : 0,
        ...values,
        ...(config.hasSkills ? { skills } : {}),
      } as unknown as Project | Experience | Education | Certification | Achievement;
      await saveRecord(entityKey, payload);
      toast.ok(`${config.singular} saved`);
      onClose();
    } catch (e) {
      setServerError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={record ? `Edit ${config.singular}` : config.addLabel}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {serverError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{serverError}</p>
        ) : null}

        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          {config.fields.map((field) => {
            const value = values[field.name];
            switch (field.type) {
              case "textarea":
                return (
                  <div key={field.name} className="col-span-2">
                    <Field label={field.label} error={errors[field.name]}>
                      <Textarea
                        value={String(value ?? "")}
                        placeholder={field.placeholder}
                        error={!!errors[field.name]}
                        onChange={(e) => setField(field.name, e.target.value)}
                      />
                    </Field>
                  </div>
                );
              case "checkbox":
                return (
                  <div key={field.name} className="flex items-end pb-1.5">
                    <Checkbox
                      label={field.label}
                      checked={Boolean(value)}
                      onChange={(checked) => setField(field.name, checked)}
                    />
                  </div>
                );
              case "month":
                return (
                  <div key={field.name}>
                    <Field label={field.label} error={errors[field.name]}>
                      <Input
                        type="month"
                        value={String(value ?? "")}
                        error={!!errors[field.name]}
                        disabled={Boolean(values.isCurrent) && field.name === "endDate"}
                        onChange={(e) => setField(field.name, e.target.value)}
                      />
                    </Field>
                  </div>
                );
              default:
                return (
                  <div key={field.name} className={field.name === "title" || !field.half ? "col-span-2" : ""}>
                    <Field label={field.label} required={field.required} error={errors[field.name]}>
                      <Input
                        value={String(value ?? "")}
                        placeholder={field.placeholder}
                        error={!!errors[field.name]}
                        onChange={(e) => setField(field.name, e.target.value)}
                      />
                    </Field>
                  </div>
                );
            }
          })}
        </div>

        {config.hasSkills ? (
          <Field label="Skills used" hint="Confidence 0–5">
            <SkillLinkEditor value={skills} onChange={setSkills} />
          </Field>
        ) : null}

        <div className="flex justify-end gap-3 pt-1">
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
