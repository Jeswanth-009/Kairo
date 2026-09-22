import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Field, Input } from "../../components/ui/inputs";
import { cn } from "../../lib/cn";
import { ipc } from "../../lib/ipc";
import type { BackupInfo } from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import { useThemeStore } from "../../stores/themeStore";
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
      <AppearanceCard />
      <AboutCard version={diagnostics?.appVersion} />

      <Card className="p-6">
        <CardTitle>Database</CardTitle>
        {diagnosticsError ? (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
            Tauri bridge unavailable — run the desktop app to inspect the database.
          </p>
        ) : (
          <dl className="mt-3 divide-y divide-line">
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
            <span className={smoke.ok ? "text-xs text-ok" : "text-xs text-bad"}>
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

/** Light/Dark segmented control — v4 boots dark (Midnight), user choice persists. */
function AppearanceCard() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.set);
  const options = [
    { id: "light" as const, label: "Light", icon: Sun },
    { id: "dark" as const, label: "Dark", icon: Moon },
  ];
  return (
    <Card className="p-6">
      <CardTitle>Appearance</CardTitle>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Kairo v4 is designed around the Midnight look. Your choice is remembered on this machine.
      </p>
      <div className="mt-4 inline-flex items-center gap-1 rounded-xl border border-line bg-accent-soft p-1">
        {options.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={theme === id}
            onClick={() => setTheme(id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-medium transition-all duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kairo-blue/50",
              theme === id
                ? "bg-kairo-midnight text-white shadow-sm dark:bg-gradient-to-br dark:from-kairo-blue dark:to-kairo-violet"
                : "text-muted hover:text-ink",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
    </Card>
  );
}

/** Brand about card — the horizontal lockup from the v4 brand kit. */
function AboutCard({ version }: { version?: string }) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-5 p-6">
        <img
          src={theme === "dark" ? "/brand/lockup-horizontal-dark-400.png" : "/brand/lockup-horizontal-light-400.png"}
          alt="Kairo — Your career. A brighter next step."
          draggable={false}
          className="h-16 w-auto rounded-xl select-none"
        />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">
            v{version ?? "4.0.0"} · Local-first career intelligence workspace
          </h2>
          <p className="mt-1 text-xs text-muted">
            Tauri 2 · React · TypeScript · SQLite · Rust domain services
          </p>
          <p className="mt-1 text-xs text-muted">
            No fabrication, ever — every resume line traces back to verified evidence.
          </p>
        </div>
      </div>
    </Card>
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
        <ul className="mt-3 divide-y divide-line">
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


const PROVIDER_PRESETS: { label: string; baseUrl: string; hint: string }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", hint: "Cloud — API key required" },
  { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", hint: "No key needed — run `ollama serve`" },
  { label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", hint: "No key needed — start the local server" },
];

function AiProviderCard() {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

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

  const save = async (clearKey = false) => {
    setSaving(true);
    try {
      // An explicitly cleared key removes the stored credential so local
      // providers run without auth.
      const saved = await ipc.aiSaveConfig(baseUrl, model, clearKey ? "" : apiKey.trim() ? apiKey : undefined);
      setHasKey(saved.hasApiKey);
      setApiKey("");
      toast.ok(clearKey ? "Stored API key cleared" : "AI provider settings saved");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const fetchModels = async () => {
    if (!baseUrl.trim()) return;
    setLoadingModels(true);
    try {
      const list = await ipc.aiListModels(baseUrl);
      setModels(list);
      if (list.length === 0) {
        toast.error("The provider listed no models — is the server running with a model installed?");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoadingModels(false);
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
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              title={preset.hint}
              onClick={() => setBaseUrl(preset.baseUrl)}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                baseUrl === preset.baseUrl
                  ? "border-kairo-blue/50 bg-kairo-blue/10 text-kairo-blue"
                  : "border-line bg-card text-muted hover:bg-accent-soft hover:text-ink",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <Field label="Base URL">
          <Input
            value={baseUrl}
            placeholder="http://localhost:11434/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Model" hint={models.length > 0 ? `${models.length} available` : undefined}>
            <Input
              value={model}
              placeholder="llama3.1:8b"
              list="ai-model-list"
              onChange={(e) => setModel(e.target.value)}
            />
            <datalist id="ai-model-list">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field
            label="API key"
            hint={hasKey ? "a key is stored — leave blank to keep it" : "not set (fine for local providers)"}
          >
            <Input
              type="password"
              value={apiKey}
              placeholder={hasKey ? "••••••••" : "not needed for local models"}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => void fetchModels()} disabled={loadingModels || !baseUrl.trim()}>
          {loadingModels ? "Fetching…" : "Fetch model list from provider"}
        </Button>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => void save()} disabled={saving || !baseUrl.trim() || !model.trim()}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void test()} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {hasKey ? (
            <Button size="sm" variant="ghost" className="text-bad dark:text-red-400" onClick={() => void save(true)} disabled={saving}>
              Clear stored key
            </Button>
          ) : null}
          {testResult ? (
            <span className={testResult.ok ? "text-xs text-ok" : "text-xs text-bad"}>
              {testResult.ok ? "✓ " : "✕ "}
              {testResult.message}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
