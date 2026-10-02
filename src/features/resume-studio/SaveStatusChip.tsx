import { useEffect, useState } from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import {
  planSaveStatus,
  retryPlanSave,
  subscribePlanSaveStatus,
  type PlanSaveStatus,
} from "../../lib/planAutosave";
import { cn } from "../../lib/cn";

const LABELS: Record<PlanSaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
};

/**
 * Saving / Saved / Could not save indicator for plan autosave. Subscribes to
 * the shared autosave queue's status for the selected job; "Could not save"
 * doubles as the retry button.
 */
export function SaveStatusChip({ jobId }: { jobId: number | null }) {
  const [status, setStatus] = useState<PlanSaveStatus>(() => planSaveStatus(jobId));

  useEffect(() => {
    if (jobId === null) {
      setStatus("idle");
      return;
    }
    return subscribePlanSaveStatus(jobId, setStatus);
  }, [jobId]);

  if (jobId === null || status === "idle") return null;

  const tone =
    status === "saving"
      ? "text-muted"
      : status === "saved"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-bad dark:text-red-300";

  if (status === "error") {
    return (
      <button
        type="button"
        onClick={() => retryPlanSave(jobId)}
        title="Your latest edits are queued — click to retry saving"
        className={cn(
          "flex items-center gap-1.5 rounded-full border border-bad/30 bg-bad-soft px-2.5 py-1 text-[11px] font-medium",
          "text-bad hover:border-bad/50 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
        )}
      >
        <TriangleAlert className="size-3.5" />
        {LABELS.error} — Retry
      </button>
    );
  }

  return (
    <span
      data-testid="save-status"
      className={cn("flex items-center gap-1.5 px-1 text-[11px] font-medium", tone)}
    >
      {status === "saving" ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <Check className="size-3.5" />
      )}
      {LABELS[status]}
    </span>
  );
}
