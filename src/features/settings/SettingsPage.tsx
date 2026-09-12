import { BrandMark } from "../../components/BrandMark";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { useAppStore } from "../../stores/appStore";

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
