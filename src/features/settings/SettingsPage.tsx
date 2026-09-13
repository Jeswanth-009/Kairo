import { useEffect, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/inputs";
import { ipc } from "../../lib/ipc";
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

      <Card className="p-6">
        <CardTitle>Data &amp; backups</CardTitle>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          All career data stays on this machine. Automated backup/restore and the Windows installer
          ship in Phase 14 (Hardening); JSON export is part of the Vault milestone (Phase 1/2).
        </p>
      </Card>
    </div>
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
            hint={hasKey ? "a key is stored &mdash; leave blank to keep it" : "not set"}
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
