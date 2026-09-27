import { useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { Badge } from "./Badge";
import { Spinner } from "./Feedback";
import { fmtAgo } from "../../lib/dateFmt";
import { ipc } from "../../lib/ipc";
import { TRASH_ENTITY_LABELS } from "../../lib/types";
import type { TrashItem, TrashEntityType } from "../../lib/types";
import { toast } from "../../stores/toastStore";

/**
 * "Recently deleted" — everything soft-deleted in the last 30 days. Restore
 * brings a record back with all its evidence and links; Delete forever is the
 * only irreversible removal.
 */
export function TrashDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    try {
      setItems(await ipc.trashList());
    } catch (e) {
      toast.error(String(e));
      setItems([]);
    }
  };

  useEffect(() => {
    if (open) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const restore = async (item: TrashItem) => {
    const key = `${item.entityType}:${item.entityId}`;
    setBusy(key);
    try {
      await ipc.trashRestore(item.entityType, item.entityId);
      setItems((prev) => prev?.filter((i) => i !== item) ?? []);
      toast.ok(`${item.label} restored`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  };

  const purge = async (item: TrashItem) => {
    const key = `${item.entityType}:${item.entityId}`;
    setBusy(key);
    try {
      await ipc.trashPurge(item.entityType, item.entityId);
      setItems((prev) => prev?.filter((i) => i !== item) ?? []);
      toast.ok(`${item.label} permanently deleted`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
      setPurging(null);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Recently deleted"
        maxWidth="max-w-lg"
      >
        <p className="-mt-1 mb-3 text-xs leading-relaxed text-muted">
          Deleted records stay here for 30 days before they are removed automatically. Restoring
          brings back the record together with its proof, resume points and links.
        </p>

        {items === null ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-5" />
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-lg bg-accent-soft px-4 py-6 text-center text-sm text-muted">
            Nothing here — deleted records will appear for 30 days.
          </p>
        ) : (
          <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
            {items.map((item) => {
              const key = `${item.entityType}:${item.entityId}`;
              return (
                <li
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{item.label || "Untitled"}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                      <Badge tone="neutral">{TRASH_ENTITY_LABELS[item.entityType as TrashEntityType] ?? item.entityType}</Badge>
                      deleted {item.deletedAt ? fmtAgo(item.deletedAt) : "recently"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === key}
                      onClick={() => void restore(item)}
                    >
                      <RotateCcw className="size-3.5" /> Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-bad hover:bg-bad-soft dark:text-red-400 dark:hover:bg-bad/10"
                      disabled={busy === key}
                      onClick={() => setPurging(item)}
                    >
                      <Trash2 className="size-3.5" /> Forever
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>

      <ConfirmDialog
        open={purging !== null}
        title="Delete forever"
        message={
          purging
            ? `Permanently delete "${purging.label}"? Its proof, resume points and links are removed too — this cannot be undone.`
            : ""
        }
        confirmLabel="Delete forever"
        onConfirm={() => {
          if (purging) void purge(purging);
        }}
        onClose={() => setPurging(null)}
      />
    </>
  );
}
