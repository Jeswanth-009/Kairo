import { Link } from "react-router-dom";
import { BrandMark } from "../../components/BrandMark";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { useAppStore } from "../../stores/appStore";

function CheckRow({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <span
        className={[
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
          done ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600",
        ].join(" ")}
      >
        {done ? "✓" : "…"}
      </span>
      <span className={done ? "text-ink" : "text-muted"}>{children}</span>
    </li>
  );
}

function DiagnosticsRows() {
  const diagnostics = useAppStore((s) => s.diagnostics);
  const diagnosticsError = useAppStore((s) => s.diagnosticsError);

  if (diagnosticsError) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
        Tauri bridge unavailable ({diagnosticsError}). Launch the desktop app with{" "}
        <code className="font-mono">npm run tauri dev</code> instead of the browser.
      </p>
    );
  }
  if (!diagnostics) {
    return <p className="px-3 py-2 text-xs text-muted">Loading diagnostics…</p>;
  }
  return (
    <dl className="space-y-2 text-xs">
      <div className="flex justify-between gap-4">
        <dt className="text-muted">App version</dt>
        <dd className="font-medium text-ink">{diagnostics.appVersion}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted">Schema version</dt>
        <dd className="font-medium text-ink">
          {diagnostics.schemaVersion} ({diagnostics.latestMigration})
        </dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted">SQLite version</dt>
        <dd className="font-medium text-ink">{diagnostics.sqliteVersion}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="shrink-0 text-muted">Database</dt>
        <dd className="break-all text-right font-mono text-[11px] text-ink">{diagnostics.dbPath}</dd>
      </div>
    </dl>
  );
}

export default function DashboardPage() {
  const smoke = useAppStore((s) => s.smoke);
  const smokeBusy = useAppStore((s) => s.smokeBusy);
  const diagnostics = useAppStore((s) => s.diagnostics);
  const runSmokeTest = useAppStore((s) => s.runSmokeTest);

  return (
    <div className="mx-auto max-w-5xl p-8">
      {/* Identity moment — the only place a gradient is allowed on an overview surface. */}
      <section className="relative mb-6 overflow-hidden rounded-xl bg-kairo-midnight p-8 text-white">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-kairo-blue/30 via-kairo-violet/20 to-transparent"
        />
        <div className="relative flex items-center gap-4">
          <BrandMark size={48} />
          <div>
            <h1 className="text-xl font-semibold">Welcome to Kairo</h1>
            <p className="mt-1 text-sm text-slate-300">
              Store verified career evidence once. For every opportunity, select the strongest proof,
              improve the wording without changing the facts, and review every change.
            </p>
          </div>
        </div>
        <div className="relative mt-5 flex gap-2">
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
            Phase 0 · Foundation
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium">Local-first</span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium">Offline-ready</span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <CardTitle>Foundation checklist</CardTitle>
          <ul className="mt-3 divide-y divide-slate-100">
            <CheckRow done>
              Tauri 2 shell running with React + TypeScript + Vite
            </CheckRow>
            <CheckRow done>Design tokens, sidebar navigation and routes</CheckRow>
            <CheckRow done={!!diagnostics}>
              SQLite database opened and migration <span className="font-mono">0001_init</span>{" "}
              applied
            </CheckRow>
            <CheckRow done={!!smoke?.ok}>
              Database read/write smoke test
              <span className="ml-3 inline-flex align-middle">
                <Button size="sm" onClick={() => void runSmokeTest()} disabled={smokeBusy}>
                  {smokeBusy ? "Running…" : smoke ? "Run again" : "Run smoke test"}
                </Button>
              </span>
            </CheckRow>
          </ul>

          {smoke ? (
            smoke.ok ? (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                Write → read verified in {smoke.durationMs} ms · token{" "}
                <span className="font-mono">{smoke.tokenWritten}</span>
              </p>
            ) : (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                Smoke test failed: {smoke.error ?? "token mismatch"}
              </p>
            )
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <CardTitle>Diagnostics</CardTitle>
            <div className="mt-3">
              <DiagnosticsRows />
            </div>
          </Card>

          <Card className="p-6">
            <CardTitle>Next up · Phase 5 Matching</CardTitle>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Job requirements are ready. Matching will compare them against your verified Vault
              evidence and explain every Covered / Partial / Missing verdict — deterministically,
              with no fake ATS scores.
            </p>
            <div className="mt-4 flex gap-3">
              <Link to="/jobs">
                <Button size="sm">Open Jobs</Button>
              </Link>
              <Link to="/vault">
                <Button size="sm" variant="secondary">
                  Career Vault
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
