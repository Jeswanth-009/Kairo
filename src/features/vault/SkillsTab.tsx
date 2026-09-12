import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dialog } from "../../components/ui/Dialog";
import { Field, Input, Select } from "../../components/ui/inputs";
import { IconSpark } from "../../components/icons";
import { SKILL_CATEGORIES } from "../../lib/types";
import type { Skill, SkillCategory } from "../../lib/types";
import { useVaultStore } from "../../stores/vaultStore";
import { toast } from "../../stores/toastStore";

function SkillDialog({
  open,
  skill,
  onClose,
}: {
  open: boolean;
  skill: Skill | null;
  onClose: () => void;
}) {
  const saveRecord = useVaultStore((s) => s.saveRecord);
  const [name, setName] = useState(skill?.canonicalName ?? "");
  const [category, setCategory] = useState<SkillCategory>(skill?.category ?? "language");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const save = async () => {
    if (!name.trim()) {
      setError("Skill name is required");
      return;
    }
    try {
      await saveRecord("skills", {
        id: skill?.id ?? 0,
        canonicalName: name.trim(),
        category,
        aliases: skill?.aliases ?? [],
      });
      toast.ok(skill ? "Skill updated" : "Skill added");
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={skill ? "Edit skill" : "Add skill"} maxWidth="max-w-md">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Canonical name" required error={error ?? undefined}>
          <Input
            autoFocus
            value={name}
            placeholder="e.g. PostgreSQL"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as SkillCategory)}>
            {SKILL_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

function SkillCard({ skill }: { skill: Skill }) {
  const deleteRecord = useVaultStore((s) => s.deleteRecord);
  const addAlias = useVaultStore((s) => s.addAlias);
  const deleteAlias = useVaultStore((s) => s.deleteAlias);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [aliasOpen, setAliasOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [aliasError, setAliasError] = useState<string | null>(null);

  const categoryLabel =
    SKILL_CATEGORIES.find((c) => c.value === skill.category)?.label ?? skill.category;

  const submitAlias = async () => {
    if (!alias.trim()) return;
    try {
      await addAlias(skill.id, alias.trim());
      setAlias("");
      setAliasOpen(false);
      setAliasError(null);
    } catch (e) {
      setAliasError(String(e));
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{skill.canonicalName}</h3>
          <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {categoryLabel}
          </span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50"
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Aliases <span className="font-normal normal-case">(used for matching)</span>
        </h4>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {skill.aliases.map((row) => (
            <span
              key={row.id}
              className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs text-ink ring-1 ring-slate-200"
            >
              {row.alias}
              <button
                type="button"
                aria-label={`Remove alias ${row.alias}`}
                className="text-slate-400 hover:text-red-600"
                onClick={() => {
                  void (async () => {
                    try {
                      await deleteAlias(row.id);
                    } catch (e) {
                      toast.error(String(e));
                    }
                  })();
                }}
              >
                ×
              </button>
            </span>
          ))}
          {aliasOpen ? (
            <span className="inline-flex items-center gap-1">
              <input
                autoFocus
                value={alias}
                placeholder="alias"
                onChange={(e) => {
                  setAlias(e.target.value);
                  setAliasError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitAlias();
                  if (e.key === "Escape") setAliasOpen(false);
                }}
                className="h-7 w-28 rounded-full border border-slate-200 px-2.5 text-xs focus:border-kairo-blue focus:outline-none"
              />
              <Button size="sm" onClick={() => void submitAlias()}>
                Add
              </Button>
            </span>
          ) : (
            <button
              type="button"
              className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-500 transition-colors duration-200 hover:border-kairo-blue hover:text-kairo-blue"
              onClick={() => setAliasOpen(true)}
            >
              + alias
            </button>
          )}
        </div>
        {aliasError ? <p className="mt-1 text-xs text-red-600">{aliasError}</p> : null}
      </div>

      <SkillDialog open={editing} skill={skill} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={confirming}
        title="Delete skill"
        message={`Delete "${skill.canonicalName}"? Its aliases and all links to projects and experience are removed too.`}
        onConfirm={() => {
          void (async () => {
            try {
              await deleteRecord("skills", skill.id);
              toast.ok("Skill deleted");
            } catch (e) {
              toast.error(String(e));
            }
          })();
        }}
        onClose={() => setConfirming(false)}
      />
    </Card>
  );
}

function EmptySkills() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm">
        <IconSpark width={24} height={24} />
      </div>
      <h3 className="text-base font-semibold text-ink">Build your canonical skill vocabulary</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Skills here become the single source of truth. Aliases (like “JS” for “JavaScript”) teach the
        matching engine to normalize job descriptions later.
      </p>
    </div>
  );
}

export function SkillsTab() {
  const skills = useVaultStore((s) => s.skills);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | SkillCategory>("all");

  const filtered = skills.filter((s) => {
    if (category !== "all" && s.category !== category) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      s.canonicalName.toLowerCase().includes(q) ||
      s.aliases.some((a) => a.alias.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search skills and aliases…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 w-64"
        />
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof category)}
          className="h-9 w-40"
        >
          <option value="all">All categories</option>
          {SKILL_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <span className="text-xs text-slate-400">{filtered.length} skills</span>
        <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>
          Add skill
        </Button>
      </div>

      {skills.length === 0 ? (
        <EmptySkills />
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">No skills match this search.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      )}

      <SkillDialog open={adding} skill={null} onClose={() => setAdding(false)} />
    </div>
  );
}
