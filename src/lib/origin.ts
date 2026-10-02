import type { RecordOrigin } from "./types";

/**
 * The honest review-state ladder for vault records (Phase "first-use").
 *
 * Imported text is never called "verified evidence": a record shows exactly
 * one state, computed from its provenance columns —
 *   Verified by you   (explicit action, wins over everything)
 *   Evidence attached (derived from the evidence count)
 *   Edited by you     (trigger-stamped first content edit of an import)
 *   Imported from resume
 * Manual (Vault-authored) records carry no badge — that is the default
 * trust state, not something to advertise.
 */
export type OriginState = "imported" | "edited" | "evidenced" | "verified" | "manual";

export interface ProvenanceShape {
  origin?: RecordOrigin;
  editedAt?: string | null;
  verifiedAt?: string | null;
  evidenceCount?: number;
}

export function originState(rec: ProvenanceShape): OriginState {
  if (rec.verifiedAt) return "verified";
  if ((rec.evidenceCount ?? 0) > 0) return "evidenced";
  if (rec.origin === "imported") return rec.editedAt ? "edited" : "imported";
  return "manual";
}

export const ORIGIN_BADGES: Record<
  Exclude<OriginState, "manual">,
  { label: string; className: string }
> = {
  imported: {
    label: "Imported from resume",
    className: "bg-accent-soft text-muted border-line",
  },
  edited: {
    label: "Edited by you",
    className: "bg-kairo-blue/10 text-kairo-blue border-kairo-blue/30",
  },
  evidenced: {
    label: "Evidence attached",
    className: "bg-ok-soft text-ok border-ok/30 dark:bg-ok/15 dark:text-emerald-300",
  },
  verified: {
    label: "Verified by you",
    className: "bg-kairo-violet/10 text-kairo-violet border-kairo-violet/30",
  },
};

/** Badge for a record, or null for manual records (no badge by design). */
export function originBadge(rec: ProvenanceShape): {
  label: string;
  className: string;
} | null {
  const state = originState(rec);
  return state === "manual" ? null : ORIGIN_BADGES[state];
}

/** Record kinds that carry provenance (jobs and skills do not). */
export const ORIGIN_KINDS = [
  "project",
  "experience",
  "education",
  "certification",
  "achievement",
] as const;

/** UTC "YYYY-MM-DD HH:MM:SS" — matches SQLite datetime('now') formatting. */
export function utcNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}
