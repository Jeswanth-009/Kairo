import { Dialog } from "../../components/ui/Dialog";
import { CONFIDENCE_LEVELS } from "../../lib/types";
import type { AnyVaultRecord } from "../../lib/types";
import { ENTITY_CONFIGS, rangeOf, subtitleOf } from "./vaultConfig";
import type { EntityKey } from "./vaultConfig";

/** Read-only record view — the "detail" half of Vault search/filter/detail. */
export function RecordDetail({
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
  if (!record) return null;
  const config = ENTITY_CONFIGS[entityKey];
  const title = (record as { title?: string }).title ?? "";
  const subtitle = subtitleOf(entityKey, record);
  const range = rangeOf(entityKey, record);
  const description = (record as { description?: string }).description ?? "";
  const skills = "skills" in record ? record.skills : [];

  const rows: { label: string; value: string }[] = [];
  for (const field of config.fields) {
    if (field.type === "textarea" || field.type === "checkbox") continue;
    if (field.name === "title") continue;
    const raw = (record as unknown as Record<string, unknown>)[field.name];
    if (typeof raw === "string" && raw) {
      rows.push({ label: field.label, value: raw });
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`${config.singular} details`}>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {subtitle || range ? (
        <p className="mt-1 text-xs text-muted">{[subtitle, range].filter(Boolean).join(" · ")}</p>
      ) : null}

      {description ? (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">{description}</p>
      ) : null}

      {skills.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Skills</h4>
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
    </Dialog>
  );
}
