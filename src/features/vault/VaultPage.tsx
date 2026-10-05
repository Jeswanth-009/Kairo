import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { TrashDialog } from "../../components/ui/TrashDialog";
import { Input } from "../../components/ui/inputs";
import { Archive, ArrowUpRight, Sparkles } from "lucide-react";
import { Tabs } from "../../components/ui/Tabs";
import { Skeleton } from "../../components/ui/Feedback";
import { useVaultStore } from "../../stores/vaultStore";
import { useUiStore } from "../../stores/uiStore";
import { toast } from "../../stores/toastStore";
import type { AnyVaultRecord } from "../../lib/types";
import { ImportDialog } from "../imports/ImportDialog";
import { ProfileCard } from "./ProfileCard";
import { RecordInspector } from "./RecordInspector";
import { scrollMainToTop } from "../../lib/dom";
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
];

export default function VaultPage() {
  const navigate = useNavigate();
  const store = useVaultStore();
  const loadError = useVaultStore((s) => s.error);
  const { loaded, loading } = store;

  const [tab, setTab] = useState<TabKey>("projects");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<AnyVaultRecord | null>(null);
  const [detail, setDetail] = useState<{ key: EntityKey; record: AnyVaultRecord } | null>(null);
  const [deleting, setDeleting] = useState<AnyVaultRecord | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  // Intents raised by the command palette (Ctrl+K): deep-open a record once
  // this page and its data are on screen.
  const vaultFocus = useUiStore((s) => s.vaultFocus);
  const clearVaultFocus = useUiStore((s) => s.clearVaultFocus);
  const vaultAction = useUiStore((s) => s.vaultAction);
  const clearVaultAction = useUiStore((s) => s.clearVaultAction);

  useEffect(() => {
    store.load().catch(() => { /* surfaced via store error */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable identity per store slice so `filtered` recomputes only when data
  // actually changes, not on every render.
  const records: Record<TabKey, AnyVaultRecord[]> = useMemo(
    () => ({
      projects: store.projects,
      experiences: store.experiences,
      education: store.education,
      certifications: store.certifications,
      achievements: store.achievements,
      skills: store.skills,
    }),
    [
      store.projects,
      store.experiences,
      store.education,
      store.certifications,
      store.achievements,
      store.skills,
    ],
  );

  useEffect(() => {
    if (!vaultAction) return;
    setImportOpen(true);
    clearVaultAction();
  }, [vaultAction, clearVaultAction]);

  useEffect(() => {
    if (!vaultFocus || !loaded) return;
    if (vaultFocus.key === "skills") {
      clearVaultFocus();
      navigate("/skills");
      return;
    }
    const list = records[vaultFocus.key] ?? [];
    const target = list.find((r) => r.id === vaultFocus.id);
    if (target) {
      setTab(vaultFocus.key);
      setDetail({ key: vaultFocus.key, record: target });
    }
    clearVaultFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultFocus, loaded, clearVaultFocus]);

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
    <div className="mx-auto max-w-7xl px-6 py-7 lg:px-10 lg:py-9">
      <section className="relative mb-7 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#15285B] via-[#112047] to-[#0B1020] px-7 py-8 text-white sm:px-9">
        <div aria-hidden className="absolute -right-12 -top-28 size-80 rounded-full border border-white/10 bg-kairo-violet/15" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-kairo-sky">Your source of truth</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">My Story</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">Keep your experience, projects, and proof accurate here. Every role-specific resume starts with these records.</p>
          </div>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>Import a resume <ArrowUpRight className="ml-2 size-4" /></Button>
        </div>
      </section>
      <div className="mb-5 flex justify-end"><Button variant="ghost" size="sm" onClick={() => setTrashOpen(true)}>Recently deleted</Button></div>
      <TrashDialog open={trashOpen} onClose={() => setTrashOpen(false)} />
      <ProfileCard />

      {loadError ? (
        <div className="mb-6 rounded-xl border border-bad/25 bg-bad-soft p-4 text-sm text-bad dark:border-red-500/30 dark:bg-bad/10 dark:text-red-300">
          Could not load the Vault: {loadError}
        </div>
      ) : null}

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
          title="Start your story"
          description="Add a project or import an existing resume. Review each saved record before you use it in a resume."
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
                // Tabs range from 0 to 26 cards — reset scroll so the new
                // tab always opens at its heading.
                scrollMainToTop();
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
        message="The record moves to Recently deleted for 30 days — restoring brings it back with its proof and links."
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={confirmBatchDelete}
        title={`Delete ${selectedIds.size} ${selectedIds.size === 1 ? config?.singular.toLowerCase() : config?.label.toLowerCase()}`}
        message={`These ${selectedIds.size} record${selectedIds.size === 1 ? "" : "s"} move to Recently deleted for 30 days, then are removed for good.`}
        onConfirm={() => void handleBatchDelete()}
        onClose={() => setConfirmBatchDelete(false)}
      />
    </div>
  );
}
