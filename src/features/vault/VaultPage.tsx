import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/inputs";
import { PageHeader } from "../../components/ui/PageHeader";
import { Archive, Sparkles } from "lucide-react";
import { Tabs } from "../../components/ui/Tabs";
import { Skeleton } from "../../components/ui/Feedback";
import { useVaultStore } from "../../stores/vaultStore";
import { toast } from "../../stores/toastStore";
import type { AnyVaultRecord } from "../../lib/types";
import { ImportDialog } from "../imports/ImportDialog";
import { ProfileCard } from "./ProfileCard";
import { RecordInspector } from "./RecordInspector";
import { RecordDialog } from "./RecordDialog";
import { SkillsTab } from "./SkillsTab";
import { VaultCard } from "./VaultCard";
import { ENTITY_CONFIGS } from "./vaultConfig";
import type { EntityKey } from "./vaultConfig";

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
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<AnyVaultRecord | null>(null);
  const [detail, setDetail] = useState<{ key: EntityKey; record: AnyVaultRecord } | null>(null);
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [tab]);

  const toggleSelect = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(filtered.map((item) => item.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRecord(tab === "skills" ? "skills" : tab, deleting.id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleting.id);
        return next;
      });
      toast.ok("Deleted");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0 || tab === "skills") return;
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await deleteRecord(tab, id);
      }
      toast.ok(`Deleted ${ids.length} ${ids.length === 1 ? config?.singular.toLowerCase() : config?.label.toLowerCase()}`);
      setSelectedIds(new Set());
      setConfirmBatchDelete(false);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const tabLabel = tab === "skills" ? "Skills" : ENTITY_CONFIGS[tab].label;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title="Career Vault"
        description="Your verified history — every record here is the source material the rest of Kairo builds on."
      />
      <ProfileCard />

      {loading && !loaded ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : null}

      {totalCount === 0 && loaded && !loading ? (
        <EmptyState
          icon={<Archive className="size-6" />}
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
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import resume
          </Button>
        </EmptyState>
      ) : null}

      {loaded || loading ? (
        <>
          <div className="mb-6">
            <Tabs
              tabs={TABS.map((t) => ({ id: t.key, label: t.label, count: records[t.key].length }))}
              active={tab}
              onChange={(id) => {
                setTab(id);
                setQuery("");
              }}
              className="flex-wrap"
            />
          </div>

          {tab === "skills" ? (
            <SkillsTab />
          ) : config ? (
            <div>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold text-ink">
                  {config.label}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {filtered.length} of {records[tab].length}
                  </span>
                </h2>
                <Input
                  placeholder={`Search ${config.label.toLowerCase()}…`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9 w-64"
                />
                <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setImportOpen(true)}>
                  Import
                </Button>
                <Button size="sm" onClick={() => setCreating(true)}>
                  {config.addLabel}
                </Button>
              </div>

              {filtered.length > 0 ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-accent-soft/70 px-4 py-2">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-medium text-ink cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id))}
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                        className="h-4 w-4 rounded border-line-strong text-kairo-blue focus:ring-kairo-blue cursor-pointer"
                      />
                      Select all ({filtered.length})
                    </label>
                    {selectedIds.size > 0 ? (
                      <span className="rounded-full bg-kairo-blue/10 px-2.5 py-0.5 text-xs font-semibold text-kairo-blue">
                        {selectedIds.size} selected
                      </span>
                    ) : null}
                  </div>

                  {selectedIds.size > 0 ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedIds(new Set())}
                      >
                        Deselect
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setConfirmBatchDelete(true)}
                      >
                        Delete {selectedIds.size} selected
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {records[tab].length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="size-6" />}
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
                      selected={selectedIds.has(record.id)}
                      onToggleSelect={(checked) => toggleSelect(record.id, checked)}
                      onOpen={() => setDetail({ key: tab, record })}
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
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      {tab !== "skills" && editing ? (
        <RecordDialog open onClose={() => setEditing(null)} entityKey={tab} record={editing} />
      ) : null}
      {detail ? (
        <RecordInspector onClose={() => setDetail(null)} entityKey={detail.key} record={detail.record} />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${tabLabel.toLowerCase()}`}
        message="This permanently removes the record from your Vault. Evidence attachments that reference it will need review."
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={confirmBatchDelete}
        title={`Delete ${selectedIds.size} ${selectedIds.size === 1 ? config?.singular.toLowerCase() : config?.label.toLowerCase()}`}
        message={`This will permanently remove ${selectedIds.size} record${selectedIds.size === 1 ? "" : "s"} from your Career Vault. This cannot be undone.`}
        onConfirm={() => void handleBatchDelete()}
        onClose={() => setConfirmBatchDelete(false)}
      />
    </div>
  );
}
