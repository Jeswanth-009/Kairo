import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { CONFIDENCE_LEVELS } from "../../lib/types";
import type { AnyVaultRecord } from "../../lib/types";
import { descriptionOf, linksOf, rangeOf, subtitleOf } from "./vaultConfig";
import type { EntityKey } from "./vaultConfig";

export function VaultCard({
  entityKey,
  record,
  selected = false,
  onToggleSelect,
  onOpen,
  onEdit,
  onDelete,
}: {
  entityKey: EntityKey;
  record: AnyVaultRecord;
  selected?: boolean;
  onToggleSelect?: (selected: boolean) => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const title = "title" in record ? record.title : ("canonicalName" in record ? record.canonicalName : "");
  const subtitle = subtitleOf(entityKey, record);
  const range = rangeOf(entityKey, record);
  const description = descriptionOf(record);
  const links = linksOf(record);
  const skills = "skills" in record ? record.skills : [];
  const evidenceCount =
    "evidenceCount" in record ? (record.evidenceCount as number) : null;

  return (
    <Card className={`flex flex-col p-5 transition-all ${selected ? "ring-2 ring-kairo-blue/70 bg-kairo-blue/[0.02]" : ""}`}>
      <div className="flex items-start gap-2.5">
        {onToggleSelect ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onToggleSelect(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line-strong text-kairo-blue focus:ring-kairo-blue cursor-pointer shrink-0"
            title="Select item"
          />
        ) : null}
        <button type="button" onClick={onOpen} className="text-left flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink hover:text-kairo-blue truncate">{title}</h3>
            {range ? <span className="shrink-0 text-xs text-muted">{range}</span> : null}
          </div>
          {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
          {description ? (
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{description}</p>
          ) : null}
        </button>
      </div>

      {skills.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {skills.map((ref) => (
            <span
              key={ref.skillId}
              title={`${CONFIDENCE_LEVELS[ref.confidence] ?? "Confidence " + ref.confidence} (level ${ref.confidence})`}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                ref.confidence >= 3
                  ? "bg-kairo-blue/10 text-kairo-blue"
                  : "bg-accent-soft text-muted"
              }`}
            >
              {ref.canonicalName} · {ref.confidence}
            </span>
          ))}
        </div>
      ) : null}

      {evidenceCount !== null ? (
        <div className="mt-3">
          <span
            title={
              evidenceCount > 0
                ? `${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"} attached`
                : "No evidence attached yet — open the record to add proof"
            }
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              evidenceCount > 0 ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
            }`}
          >
            {evidenceCount > 0 ? "✓" : "…"} {evidenceCount} evidence
          </span>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <div className="flex gap-3">
          {links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-kairo-blue hover:underline"
            >
              {link.label} ↗
            </a>
          ))}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-bad hover:bg-bad-soft dark:text-red-400 dark:hover:bg-bad/10"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
