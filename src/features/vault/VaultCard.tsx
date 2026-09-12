import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { CONFIDENCE_LEVELS } from "../../lib/types";
import type { AnyVaultRecord } from "../../lib/types";
import { descriptionOf, linksOf, rangeOf, subtitleOf } from "./vaultConfig";
import type { EntityKey } from "./vaultConfig";

export function VaultCard({
  entityKey,
  record,
  onOpen,
  onEdit,
  onDelete,
}: {
  entityKey: EntityKey;
  record: AnyVaultRecord;
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

  return (
    <Card className="flex flex-col p-5">
      <button type="button" onClick={onOpen} className="text-left">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink hover:text-kairo-blue">{title}</h3>
          {range ? <span className="shrink-0 text-xs text-slate-400">{range}</span> : null}
        </div>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
        {description ? (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{description}</p>
        ) : null}
      </button>

      {skills.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {skills.map((ref) => (
            <span
              key={ref.skillId}
              title={`${CONFIDENCE_LEVELS[ref.confidence] ?? "Confidence " + ref.confidence} (level ${ref.confidence})`}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                ref.confidence >= 3
                  ? "bg-kairo-blue/10 text-kairo-blue"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {ref.canonicalName} · {ref.confidence}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
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
            className="text-red-600 hover:bg-red-50"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
