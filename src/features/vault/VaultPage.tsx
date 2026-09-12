import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/inputs";
import { IconSpark, IconVault } from "../../components/icons";
import { useVaultStore } from "../../stores/vaultStore";
import { toast } from "../../stores/toastStore";
import type { AnyVaultRecord, EntityKey } from "../../lib/types";
import { ProfileCard } from "./ProfileCard";
import { RecordDetail } from "./RecordDetail";
import { RecordDialog } from "./RecordDialog";
import { SkillsTab } from "./SkillsTab";
import { VaultCard } from "./VaultCard";
import { ENTITY_CONFIGS } from "./vaultConfig";

type TabKey = EntityKey | "skills";

const TABS: { key: TabKey; label: string }[] = [
  { key: "projects", label: "Projects" },
  { key: "experiences", label: "Experience" },
  { key: "education", label: "Education" },
  { key: "certifications", label: "Certifications" },
  { key: "achievements", label: "Achievements" },
  { key: "skills", label: "Skills" },
];

export default function VaultPage() {
  const store = useVaultStore();
  const { loaded, loading } = store;

  const [tab, setTab] = useState<TabKey>("projects");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AnyVaultRecord | null>(null);
  const [detail, setDetail] = useState<AnyVaultRecord | null>(null);
  const [deleting, setDeleting] = useState<AnyVaultRecord | null>(null);

  useEffect(() => {
    void store.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const records: Record<TabKey, AnyVaultRecord[]> = {
    projects: store.projects,
    experiences: store.experiences,
    education: store.education,
    certifications: store.certifications,
    achievements: store.achievements,
    skills: store.skills,
  };

  const totalCount = TABS.reduce((sum, t) => sum + records[t.key].length, 0);
  const config = tab === "skills" ? null : ENTITY_CONFIGS[tab];

  const filtered = useMemo(() => {
    const items = records[tab];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const parts = Object.entries(item as unknown as Record<string, unknown>)
        .filter(([k]) => k !== "skills")
        .map(([, v]) => (Array.isArray(v) ? v.join(" ") : String(v ?? "")));
      if ("skills" in item) {
        parts.push(item.skills.map((s) => s.canonicalName).join(" "));
      }
      return parts.join(" ").toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, tab, query]);

  const deleteRecord = useVaultStore((s) => s.deleteRecord);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRecord(tab === "skills" ? "skills" : tab, deleting.id);
      toast.ok("Deleted");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const tabLabel = tab === "skills" ? "Skills" : ENTITY_CONFIGS[tab].label;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <ProfileCard />

      {loading && !loaded ? <p className="py-16 text-center text-sm text-muted">Loading vault…</p> : null}

      {totalCount === 0 && loaded && !loading ? (
        <EmptyState
          icon={<IconVault width={24} height={24} />}
          title="Start your Career Vault"
          description="Add your first project or import an existing resume. Every record you store here becomes verified evidence that the rest of Kairo builds on."
        >
          <Button
            onClick={() => {
              setTab("projects");
              setCreating(true);
            }}
          >
            Add project
          </Button>
          <Button variant="secondary" disabled title="Arrives in Phase 3 · Imports">
            Import resume
          </Button>
        </EmptyState>
      ) : null}

      {loaded || loading ? (
        <>
          <div className="mb-6 flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTab(t.key);
                  setQuery("");
                }}
                className={[
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-200",
                  tab === t.key ? "bg-kairo-midnight text-white" : "text-muted hover:bg-slate-100",
                ].join(" ")}
              >
                {t.label}
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    tab === t.key ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {records[t.key].length}
                </span>
              </button>
            ))}
          </div>

          {tab === "skills" ? (
            <SkillsTab />
          ) : config ? (
            <div>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold text-ink">
                  {config.label}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {filtered.length} of {records[tab].length}
                  </span>
                </h2>
                <Input
                  placeholder={`Search ${config.label.toLowerCase()}…`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9 w-64"
                />
                <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
                  {config.addLabel}
                </Button>
              </div>

              {records[tab].length === 0 ? (
                <EmptyState
                  icon={<IconSpark width={24} height={24} />}
                  title={`No ${config.label.toLowerCase()} yet`}
                  description={`Add your first ${config.singular.toLowerCase()} — only approved, factual records belong in the Vault.`}
                >
                  <Button onClick={() => setCreating(true)}>{config.addLabel}</Button>
                </EmptyState>
              ) : filtered.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted">Nothing matches this search.</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((record) => (
                    <VaultCard
                      key={record.id}
                      entityKey={tab}
                      record={record}
                      onOpen={() => setDetail(record)}
                      onEdit={() => setEditing(record)}
                      onDelete={() => setDeleting(record)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {tab !== "skills" && creating ? (
        <RecordDialog open onClose={() => setCreating(false)} entityKey={tab} record={null} />
      ) : null}
      {tab !== "skills" && editing ? (
        <RecordDialog open onClose={() => setEditing(null)} entityKey={tab} record={editing} />
      ) : null}
      <RecordDetail
        open={!!detail}
        onClose={() => setDetail(null)}
        entityKey={tab === "skills" ? "projects" : tab}
        record={detail}
      />
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${tabLabel.toLowerCase()}`}
        message="This permanently removes the record from your Vault. Evidence attachments that reference it will need review."
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
