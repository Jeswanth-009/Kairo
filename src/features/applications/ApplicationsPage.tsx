import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dialog } from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Field, Input, Select, Textarea } from "../../components/ui/inputs";
import { ClipboardCheck } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Tabs } from "../../components/ui/Tabs";
import { Skeleton } from "../../components/ui/Feedback";
import { ipc } from "../../lib/ipc";
import { APPLICATION_STATUSES } from "../../lib/types";
import type { Application, ApplicationStatus, Job } from "../../lib/types";
import type { BadgeTone } from "../../components/ui/Badge";
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

const STATUS_TONE: Record<ApplicationStatus, BadgeTone> = {
  wishlist: "neutral",
  preparing: "sky",
  applied: "blue",
  oa: "violet",
  interview: "amber",
  final: "dawn",
  offer: "green",
  rejected: "red",
  withdrawn: "neutral",
};

function ApplicationDialog({
  open,
  initial,
  jobs,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Application | null;
  jobs: Job[];
  onClose: () => void;
  onSaved: (app: Application, isNew: boolean) => void;
}) {
  const empty: Application = {
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
  };
  const [values, setValues] = useState<Application>(initial ?? empty);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Application>(name: K, value: Application[K]) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  // The dialog stays mounted in its parent — re-sync the form every time it
  // opens so "Edit" never starts from a stale first-mount snapshot.
  useEffect(() => {
    if (open) {
      setValues(initial ?? empty);
      setError(null);
    }
    // `initial` is captured when the parent opens the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

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
          <Field label="Linked job workspace" hint="optional">
            <Select
              value={values.jobId ?? ""}
              onChange={(e) => set("jobId", e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">— none —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.roleTitle || "Untitled role"}
                  {j.company ? ` · ${j.company}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Applied on" hint="filled when you apply">
            <Input
              type="date"
              value={values.appliedDate ?? ""}
              onChange={(e) => set("appliedDate", e.target.value === "" ? null : e.target.value)}
            />
          </Field>
        </div>
        <Field label="Next action" hint="what moves this forward">
          <Input
            value={values.nextAction}
            placeholder="Follow up, prep tech round…"
            onChange={(e) => set("nextAction", e.target.value)}
          />
        </Field>
        <Field label="Notes">
          <Textarea
            rows={2}
            value={values.notes}
            placeholder="Referrals, contacts, anything worth remembering."
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</p>
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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | ApplicationStatus>("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState<Application | null>(null);

  useEffect(() => {
    ipc.listJobs().then(setJobs).catch(() => setJobs([]));
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
      <div className="mb-6">
        <Tabs
          variant="pills"
          tabs={[
            { id: "all", label: `All · ${apps.length}` },
            ...PIPELINE_ORDER.filter((status) => counts[status] > 0).map((status) => ({
              id: status,
              label: `${STATUS_LABEL[status]} · ${counts[status]}`,
            })),
          ]}
          active={filter}
          onChange={(id) => setFilter(id as "all" | ApplicationStatus)}
          className="max-w-full flex-wrap"
        />
      </div>

      {!loaded ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="size-6" />}
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
                    <Badge tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</Badge>
                    <span className="text-sm font-medium text-ink">{app.company}</span>
                    <span className="text-xs text-muted">· {app.role}</span>
                  </div>
                  {app.nextAction ? (
                    <p className="mt-1 text-xs text-muted">Next: {app.nextAction}</p>
                  ) : null}
                  {app.notes ? <p className="mt-0.5 text-[11px] text-muted/80">{app.notes}</p> : null}
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
                    className="text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 dark:text-red-400"
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

      <ApplicationDialog open={creating} initial={null} jobs={jobs} onClose={() => setCreating(false)} onSaved={saveApp} />
      <ApplicationDialog
        open={!!editing}
        initial={editing}
        jobs={jobs}
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
