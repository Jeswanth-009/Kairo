import { useEffect, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Field, Input } from "../../components/ui/inputs";
import { ipc } from "../../lib/ipc";
import type { BackupInfo } from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import { toast } from "../../stores/toastStore";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-xs">
      <dt className="text-muted">{label}</dt>
      <dd className="max-w-[60%] break-all text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

export default function SettingsPage() {
  const diagnostics = useAppStore((s) => s.diagnostics);
  const diagnosticsError = useAppStore((s) => s.diagnosticsError);
  const smoke = useAppStore((s) => s.smoke);
  const smokeBusy = useAppStore((s) => s.smokeBusy);
  const runSmokeTest = useAppStore((s) => s.runSmokeTest);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <Card className="flex items-center gap-4 p-6">
        <BrandMark size={44} />
        <div>
          <h2 className="text-sm font-semibold text-ink">Kairo</h2>
          <p className="text-xs text-muted">
            v{diagnostics?.appVersion ?? "0.1.0"} · Local-first career intelligence workspace
          </p>
          <p className="mt-1 text-xs text-muted">
            Tauri 2 · React · TypeScript · SQLite · Rust domain services
          </p>
        </div>
      </Card>

      <Card className="p-6">
        <CardTitle>Database</CardTitle>
        {diagnosticsError ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Tauri bridge unavailable — run the desktop app to inspect the database.
          </p>
        ) : (
          <dl className="mt-3 divide-y divide-slate-100">
            <Row label="Schema version" value={String(diagnostics?.schemaVersion ?? "—")} />
            <Row label="Latest migration" value={diagnostics?.latestMigration ?? "—"} />
            <Row label="SQLite version" value={diagnostics?.sqliteVersion ?? "—"} />
            <Row label="Database file" value={diagnostics?.dbPath ?? "—"} />
          </dl>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={() => void runSmokeTest()} disabled={smokeBusy}>
            {smokeBusy ? "Running…" : "Run read/write smoke test"}
          </Button>
          {smoke ? (
            <span className={smoke.ok ? "text-xs text-emerald-600" : "text-xs text-red-600"}>
              {smoke.ok ? `Verified in ${smoke.durationMs} ms` : `Failed: ${smoke.error ?? "unknown"}`}
            </span>
          ) : null}
        </div>
      </Card>

      <AiProviderCard />

      <BackupsCard />
    </div>
  );
}

function fmtStamp(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]} UTC` : stamp;
}

function fmtBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function BackupsCard() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setBackups(await ipc.listBackups());
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      const info = await ipc.createBackup();
      toast.ok(`Backup saved: ${info.fileName}`);
      await refresh();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  };

  const restore = async (backup: BackupInfo) => {
    setBusy(true);
    try {
      const report = await ipc.restoreBackup(backup.fileName);
      toast.ok(`Restored from ${backup.fileName} (schema at ${report.appliedMigrations} migrations). Reloading…`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      toast.error(String(e));
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <CardTitle>Backup &amp; restore</CardTitle>
        <Button size="sm" onClick={() => void create()} disabled={creating}>
          {creating ? "Backing up…" : "Create backup"}
        </Button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Backups are consistent snapshots of the whole database, saved under the app&apos;s
        data directory (<span className="font-mono">backups/</span>). The ten most recent are kept.
        Restoring replaces all current data with the backup — older backups are upgraded to the
        current schema automatically.
      </p>
      {loaded && backups.length === 0 ? (
        <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-xs text-muted">
          No backups yet — create one before importing data you care about.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {backups.map((backup) => (
            <li key={backup.fileName} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-ink">{backup.fileName}</p>
                <p className="text-[11px] text-muted">
                  {fmtStamp(backup.createdAt)} · {fmtBytes(backup.bytes)}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => setRestoring(backup)}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!restoring}
        title="Restore backup"
        message={`Replace ALL current data with "${restoring?.fileName ?? ""}"? Everything changed since that backup is lost. The app reloads afterwards.`}
        onConfirm={() => {
          if (restoring) void restore(restoring);
        }}
        onClose={() => setRestoring(null)}
      />
    </Card>
  );
}


function AiProviderCard() {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const config = await ipc.aiGetConfig();
        setBaseUrl(config.baseUrl);
        setModel(config.model);
        setHasKey(config.hasApiKey);
      } catch (e) {
        toast.error(String(e));
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await ipc.aiSaveConfig(baseUrl, model, apiKey.trim() ? apiKey : undefined);
      setHasKey(saved.hasApiKey);
      setApiKey("");
      toast.ok("AI provider settings saved");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const answer = await ipc.aiTestConnection();
      setTestResult({ ok: true, message: `Provider replied: ${answer}` });
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-6">
      <CardTitle>AI provider &middot; grounded tailoring</CardTitle>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Any OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, a local Ollama server). The API
        key is stored in the Windows Credential Manager &mdash; never in the database or plan
        files. Tailoring is optional; everything else in Kairo works without it.
      </p>
      <div className="mt-4 space-y-4">
        <Field label="Base URL">
          <Input
            value={baseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Model">
            <Input value={model} placeholder="gpt-4o-mini" onChange={(e) => setModel(e.target.value)} />
          </Field>
          <Field
            label="API key"
            hint={hasKey ? "a key is stored — leave blank to keep it" : "not set"}
          >
            <Input
              type="password"
              value={apiKey}
              placeholder={hasKey ? "••••••••" : "sk-…"}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => void save()} disabled={saving || !baseUrl.trim() || !model.trim()}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void test()} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {testResult ? (
            <span className={testResult.ok ? "text-xs text-emerald-600" : "text-xs text-red-600"}>
              {testResult.ok ? "✓ " : "✕ "}
              {testResult.message}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
