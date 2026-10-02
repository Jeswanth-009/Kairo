import { useCallback } from "react";
import { useSyncExternalStore } from "react";
import { planSaveStatus, subscribePlanSaveStatus, type PlanSaveStatus } from "./planAutosave";

/**
 * Reactive read of a job's autosave status — subscribes via
 * useSyncExternalStore, so components render Saving/Saved/error transitions
 * without effects or local duplication.
 */
export function usePlanSaveStatus(jobId: number | null): PlanSaveStatus {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (jobId === null) return () => undefined;
      return subscribePlanSaveStatus(jobId, onChange);
    },
    [jobId],
  );
  const getSnapshot = useCallback(() => planSaveStatus(jobId), [jobId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
