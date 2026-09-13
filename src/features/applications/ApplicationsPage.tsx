import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dialog } from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Field, Input, Select } from "../../components/ui/inputs";
import { IconApplications } from "../../components/icons";
import { ipc } from "../../lib/ipc";
import {
  APPLICATION_STATUSES,
  STATUS_COLORS,
} from "../../lib/types";
import type { Application, ApplicationStatus } from "../../lib/types";
import { toast } from "../../stores/toastStore";

const PIPELINE_ORDER: ApplicationStatus[] = [
  "wishlist",
  "preparing",
  "applied",
  "oa",
  "interview",
  "final",
  "offer",
  "rejected",
  "withdrawn",
];

const STATUS_LABEL: Record<ApplicationStatus, string> = Object.fromEntries(
  APPLICATION_STATUSES.map((s) => [s.value, s.label]),
) as Record<ApplicationStatus, string>;

function ApplicationDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Application | null;
  onClose: () => void;
  onSaved: (app: Application, isNew: boolean) => void;
}) {
  const [values, setValues] = useState<Application>(
    initial ?? {
      id: 0,
      jobId: null,
      resumeVersionId: null,
      company: "",
      role: "",
      url: "",
      status: "wishlist",
      appliedDate: null,
      nextAction: "",
      notes: "",
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Application>(name: K, value: Application[K]) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  if (!open) return null;

  const save = async () => {
    if (!values.company.trim() || !values.role.trim()) {
      setError("Company and role are required");
      return;
    }
    setSaving(true);
    try {
      const saved = values.id > 0
        ? await ipc.updateApplication(values)
        : await ipc.createApplication(values);
      onSaved(saved, values.id === 0);
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={initial ? "Edit application" : "New application"}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company" required >
            <Input
              autoFocus
              value={values.company}
              onChange={(e) => set("company", e.target.value)}
            />
          </Field>
          <Field label="Role" required>
            <Input value={values.role} onChange={(e) => set("role", e.target.value)} />
          </Field>
          <Field label="Posting URL">
            <Input value={values.url} placeholder="https://…" onChange={(e) => set("url", e.target.value)} />
          </Field>
          <Field label="Status">
            <Select
              value={values.status}
              onChange={(e) => set("status", e.target.value as ApplicationStatus)}
            >
              {APPLICATION_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | ApplicationStatus>("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState<Application | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setApps(await ipc.listApplications());
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const counts = useMemo(() => {
    const map = Object.fromEntries(PIPELINE_ORDER.map((s) => [s, 0])) as Record<
      ApplicationStatus,
      number
    >;
    for (const a of apps) map[a.status] += 1;
    return map;
  }, [apps]);

  const filtered = filter === "all" ? apps : apps.filter((a) => a.status === filter);

  const changeStatus = async (app: Application, status: ApplicationStatus) => {
    try {
      const updated = await ipc.setApplicationStatus(app.id, status);
      setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      toast.ok(`${app.company}: ${STATUS_LABEL[status]}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const remove = async (app: Application) => {
    try {
      await ipc.deleteApplication(app.id);
      setApps((prev) => prev.filter((a) => a.id !== app.id));
      toast.ok("Application deleted");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const saveApp = async (saved: Application) => {
    setApps((prev) => {
      const index = prev.findIndex((a) => a.id === saved.id);
      if (index === -1) return [saved, ...prev];
      const next = prev.slice();
      next[index] = saved;
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader
        title="Applications"
        description="Manual by design — you record every application and update every status. Each entry links the exact resume version submitted."
        actions={<Button onClick={() => setCreating(true)}>New application</Button>}
      />

      {/* Status pipeline summary */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
            filter === "all" ? "bg-kairo-midnight text-white" : "bg-white text-muted hover:bg-slate-100 ring-1 ring-slate-200"
          }`}
        >
          All · {apps.length}
        </button>
        {PIPELINE_ORDER.map((status) =>
          counts[status] > 0 ? (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
                filter === status
                  ? "bg-kairo-midnight text-white"
                  : `ring-1 ring-slate-200 hover:bg-slate-100 ${STATUS_COLORS[status]}`
              }`}
            >
              {STATUS_LABEL[status]} · {counts[status]}
            </button>
          ) : null,
        )}
      </div>

      {loaded && apps.length === 0 ? (
        <EmptyState
          icon={<IconApplications width={24} height={24} />}
          title="Track applications manually"
          description="Use “New application” above to record your first one — link the exact resume version submitted, then move it through the pipeline by hand. No email scraping, no auto-detection."
        />
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">
          {apps.length === 0 ? "" : "No applications with this status."}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((app) => (
            <Card key={app.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        STATUS_COLORS[app.status]
                      }`}
                    >
                      {STATUS_LABEL[app.status]}
                    </span>
                    <span className="text-sm font-medium text-ink">{app.company}</span>
                    <span className="text-xs text-muted">· {app.role}</span>
                  </div>
                  {app.nextAction ? (
                    <p className="mt-1 text-xs text-muted">Next: {app.nextAction}</p>
                  ) : null}
                  {app.notes ? <p className="mt-0.5 text-[11px] text-slate-400">{app.notes}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Select
                    value={app.status}
                    onChange={(e) => void changeStatus(app, e.target.value as ApplicationStatus)}
                    className="h-8 w-36 text-xs"
                  >
                    {APPLICATION_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(app)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => setDeleting(app)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ApplicationDialog open={creating} initial={null} onClose={() => setCreating(false)} onSaved={saveApp} />
      <ApplicationDialog
        open={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onSaved={saveApp}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete application"
        message={`Delete the application for "${deleting?.company ?? ""}"? This cannot be undone.`}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
