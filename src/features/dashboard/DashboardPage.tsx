import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandMark } from "../../components/BrandMark";
import { Card, CardTitle } from "../../components/ui/Card";
import { fmtAgo } from "../../lib/dateFmt";
import { ipc } from "../../lib/ipc";
import type { ActivityItem, DashboardOverview, EvidenceReviewItem } from "../../lib/types";

const KIND_COLORS: Record<string, string> = {
  job: "bg-kairo-blue/10 text-kairo-blue",
  application: "bg-emerald-100 text-emerald-700",
  version: "bg-kairo-violet/10 text-kairo-violet",
  evidence: "bg-kairo-dawn/25 text-amber-700",
  bullet: "bg-sky-100 text-sky-700",
  project: "bg-slate-100 text-slate-600",
  experience: "bg-slate-100 text-slate-600",
  education: "bg-slate-100 text-slate-600",
  certification: "bg-slate-100 text-slate-600",
  achievement: "bg-slate-100 text-slate-600",
};

function activityRoute(item: ActivityItem): string {
  if (item.refType === "job") return `/jobs/${item.refId}`;
  if (item.refType === "application") return "/applications";
  return "/vault";
}

function StatTile({
  to,
  value,
  label,
  sub,
  subClass = "text-muted",
}: {
  to: string;
  value: number | string;
  label: string;
  sub?: string;
  subClass?: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors duration-200 hover:border-kairo-blue/40"
    >
      <div className="text-2xl font-semibold text-ink">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-ink">{label}</div>
      {sub ? <div className={`mt-0.5 text-[11px] ${subClass}`}>{sub}</div> : null}
    </Link>
  );
}

function EvidenceRow({ item }: { item: EvidenceReviewItem }) {
  return (
    <Link
      to="/vault"
      className="block rounded-lg px-3 py-2 transition-colors duration-200 hover:bg-slate-50"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-ink">{item.title}</span>
        <span className="shrink-0 text-[11px] text-muted">added {fmtAgo(item.createdAt)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            KIND_COLORS[item.kind] ?? "bg-slate-100 text-slate-600"
          }`}
        >
          {item.kind}
        </span>
        <span className="truncate text-muted">{item.entityLabel}</span>
      </div>
    </Link>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <Link
      to={activityRoute(item)}
      className="block rounded-lg px-3 py-2 transition-colors duration-200 hover:bg-slate-50"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-ink">{item.label}</span>
        <span className="shrink-0 text-[11px] text-muted">{fmtAgo(item.at)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            KIND_COLORS[item.kind] ?? "bg-slate-100 text-slate-600"
          }`}
        >
          {item.kind}
        </span>
        <span className="truncate text-muted">{item.detail}</span>
      </div>
    </Link>
  );
}

function GettingStarted() {
  const steps = [
    {
      title: "Build your Vault",
      body: "Add your profile, projects and experience. Attach evidence to every claim and approve the canonical bullets you want on a resume.",
      to: "/vault",
      cta: "Open Career Vault",
    },
    {
      title: "Add a job",
      body: "Paste the job description verbatim. Kairo extracts the requirements and you review every one before matching.",
      to: "/jobs",
      cta: "Open Jobs",
    },
    {
      title: "Match, plan, tailor",
      body: "Run the deterministic match, generate the one-page plan, review AI rewording, export the PDF and save an immutable version.",
      to: "/jobs",
      cta: "Open Jobs",
    },
  ];
  return (
    <Card className="p-6">
      <CardTitle>Start here</CardTitle>
      <ol className="mt-4 space-y-4">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kairo-blue/10 text-xs font-bold text-kairo-blue">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-ink">{step.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.body}</p>
              <Link
                to={step.to}
                className="mt-1 inline-block text-xs font-medium text-kairo-blue hover:underline"
              >
                {step.cta} →
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setOverview(await ipc.getDashboard());
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl p-8">
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
                Store verified career evidence once. For every opportunity, select the strongest
                proof, improve the wording without changing the facts, and review every change.
              </p>
            </div>
          </div>
        </section>
        <Card className="p-6">
          <CardTitle>Dashboard unavailable</CardTitle>
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
            Tauri bridge unavailable ({error}). Launch the desktop app with{" "}
            <code className="font-mono">npm run tauri dev</code> instead of the browser.
          </p>
        </Card>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <p className="py-24 text-center text-sm text-muted">Loading your workspace…</p>
      </div>
    );
  }

  const { counts, evidenceNeedingReview, recentActivity } = overview;
  const brandNew =
    counts.projects + counts.experiences + counts.jobs + counts.applications === 0;

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
            <h1 className="text-xl font-semibold">
              {brandNew ? "Welcome to Kairo" : "Welcome back"}
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              {brandNew
                ? "Store verified career evidence once. For every opportunity, select the strongest proof, improve the wording without changing the facts, and review every change."
                : `${counts.projects + counts.experiences} records · ${
                    counts.evidenceVerified
                  } verified evidence ${counts.evidenceVerified === 1 ? "item" : "items"} · ${
                    counts.jobs
                  } job workspace${counts.jobs === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
            Local-first
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
            Offline-ready
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
            No fabrication, ever
          </span>
        </div>
      </section>

      {/* Real counts — every tile is a live query result, no derived scores. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile to="/vault" value={counts.projects} label="Projects" />
        <StatTile to="/vault" value={counts.experiences} label="Experiences" />
        <StatTile to="/vault" value={counts.skills} label="Skills" />
        <StatTile
          to="/vault"
          value={counts.evidenceVerified}
          label="Evidence verified"
          sub={
            counts.evidenceUnverified > 0
              ? `${counts.evidenceUnverified} awaiting review`
              : counts.evidenceTotal === 0
                ? "no evidence yet"
                : "all verified"
          }
          subClass={counts.evidenceUnverified > 0 ? "text-amber-600" : "text-emerald-600"}
        />
        <StatTile
          to="/jobs"
          value={counts.jobs}
          label="Job workspaces"
          sub={
            counts.jobs > 0
              ? `${counts.jobsWithPlan} with a resume plan`
              : "paste a JD to start"
          }
        />
        <StatTile
          to="/applications"
          value={counts.applicationsActive}
          label="Applications in flight"
          sub={
            counts.applications > 0
              ? `${counts.applications} tracked in total`
              : "track them manually here"
          }
        />
        <StatTile
          to="/resume-studio"
          value={counts.resumeVersions}
          label="Resume versions"
          sub={counts.pdfsCompiled > 0 ? `${counts.pdfsCompiled} ${counts.pdfsCompiled === 1 ? "PDF compiled" : "PDFs compiled"}` : "export to create"}
        />
        <StatTile
          to="/jobs"
          value={counts.suggestionsPending}
          label="Pending suggestions"
          sub={
            counts.suggestionsPending > 0
              ? "AI rewrites awaiting your review"
              : "nothing awaiting review"
          }
          subClass={counts.suggestionsPending > 0 ? "text-kairo-violet" : "text-muted"}
        />
      </div>

      {brandNew ? (
        <GettingStarted />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card className="p-5 lg:col-span-3">
            <div className="flex items-baseline justify-between gap-3">
              <CardTitle>Evidence needing review</CardTitle>
              <span className="text-[11px] text-muted">
                {counts.evidenceUnverified} of {counts.evidenceTotal} unverified
              </span>
            </div>
            <div className="mt-3 divide-y divide-slate-100">
              {evidenceNeedingReview.length === 0 ? (
                <p
                  className={`rounded-lg px-3 py-2 text-xs ${
                    counts.evidenceTotal === 0
                      ? "bg-slate-50 text-muted"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {counts.evidenceTotal === 0
                    ? "No evidence yet — attach proof to your records in the Career Vault."
                    : counts.evidenceTotal === 1
                      ? "The 1 evidence item is verified."
                      : `All ${counts.evidenceTotal} evidence items are verified.`}
                </p>
              ) : (
                evidenceNeedingReview.map((item) => <EvidenceRow key={item.id} item={item} />)
              )}
            </div>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <CardTitle>Recent activity</CardTitle>
            <div className="mt-3 divide-y divide-slate-100">
              {recentActivity.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted">
                  No activity yet — add a record or a job to get started.
                </p>
              ) : (
                recentActivity.map((item, i) => (
                  <ActivityRow key={`${item.kind}-${item.refId}-${i}`} item={item} />
                ))
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
