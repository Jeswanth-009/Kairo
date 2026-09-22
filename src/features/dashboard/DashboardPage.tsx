import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandMark } from "../../components/BrandMark";
import {
  ArrowUpRight,
  Briefcase,
  CircleCheck,
  ClipboardCheck,
  Code2,
  FileText,
  Folder,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Badge } from "../../components/ui/Badge";
import { Card, CardTitle } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Feedback";
import { fmtAgo } from "../../lib/dateFmt";
import { ipc } from "../../lib/ipc";
import type { ActivityItem, DashboardOverview, EvidenceReviewItem } from "../../lib/types";

const KIND_COLORS: Record<string, string> = {
  job: "bg-kairo-blue/10 text-kairo-blue",
  application: "bg-ok-soft text-ok dark:bg-ok/15 dark:text-emerald-300",
  version: "bg-kairo-violet/10 text-kairo-violet",
  evidence: "bg-kairo-dawn/25 text-warn dark:text-kairo-dawn",
  bullet: "bg-sky-100 text-sky-700 dark:bg-kairo-sky/15 dark:text-kairo-sky",
  project: "bg-accent-soft text-muted",
  experience: "bg-accent-soft text-muted",
  education: "bg-accent-soft text-muted",
  certification: "bg-accent-soft text-muted",
  achievement: "bg-accent-soft text-muted",
};

function activityRoute(item: ActivityItem): string {
  if (item.refType === "job") return `/jobs/${item.refId}`;
  if (item.refType === "application") return "/applications";
  return "/vault";
}

interface Tile {
  to: string;
  value: number | string;
  label: string;
  sub?: string;
  subClass?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconClass: string;
}

function StatTile({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  return (
    <Link
      to={tile.to}
      className="group flex flex-col rounded-xl border border-line bg-card p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-kairo-blue/30 hover:shadow-raised"
    >
      <div className="flex items-start justify-between">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 ${tile.iconClass}`}
        >
          <Icon width={17} height={17} />
        </span>
        <ArrowUpRight className="size-3.5 text-muted/50 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-kairo-blue group-hover:opacity-100" />
      </div>
      <div className="mt-3 text-2xl leading-none font-semibold tracking-tight text-ink">
        {tile.value}
      </div>
      <div className="mt-1.5 text-xs font-medium text-ink">{tile.label}</div>
      {tile.sub ? <div className={`mt-0.5 text-[11px] ${tile.subClass ?? "text-muted"}`}>{tile.sub}</div> : null}
    </Link>
  );
}

function EvidenceRow({ item }: { item: EvidenceReviewItem }) {
  return (
    <Link
      to="/vault"
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-200 hover:bg-accent-soft"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn dark:bg-warn/15 dark:text-amber-400">
        <TriangleAlert className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-xs">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              KIND_COLORS[item.kind] ?? "bg-accent-soft text-muted"
            }`}
          >
            {item.kind}
          </span>
          <span className="truncate text-muted">{item.entityLabel}</span>
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-muted">{fmtAgo(item.createdAt)}</span>
      <ArrowUpRight className="size-3 shrink-0 text-muted/50 transition-colors duration-200 group-hover:text-kairo-blue" />
    </Link>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <Link
      to={activityRoute(item)}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-200 hover:bg-accent-soft"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold uppercase ${
          KIND_COLORS[item.kind] ?? "bg-accent-soft text-muted"
        }`}
      >
        {item.kind.slice(0, 2)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{item.label}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">{item.detail}</span>
      </span>
      <span className="shrink-0 text-[11px] text-muted">{fmtAgo(item.at)}</span>
    </Link>
  );
}

function CountPill({ value, tone = "neutral" }: { value: string; tone?: "neutral" | "amber" | "green" }) {
  return <Badge tone={tone}>{value}</Badge>;
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
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line bg-gradient-to-r from-kairo-blue/[0.04] to-kairo-violet/[0.04] px-6 py-4">
        <CardTitle>Start here — three steps to your first application</CardTitle>
      </div>
      <ol className="grid grid-cols-1 divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
        {steps.map((step, i) => (
          <li key={step.title} className="flex flex-col p-6">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-kairo-blue to-kairo-violet text-xs font-bold text-white shadow-sm">
              {i + 1}
            </span>
            <p className="mt-3 text-sm font-semibold text-ink">{step.title}</p>
            <p className="mt-1 flex-1 text-xs leading-relaxed text-muted">{step.body}</p>
            <Link
              to={step.to}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-kairo-blue hover:underline"
            >
              {step.cta}
              <ArrowUpRight className="size-3" />
            </Link>
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
        <section className="relative mb-6 overflow-hidden rounded-2xl bg-kairo-midnight p-8 text-white">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(500px 260px at 12% -20%, rgba(37,99,235,0.4), transparent 60%), radial-gradient(480px 300px at 105% 120%, rgba(139,92,246,0.3), transparent 60%)",
            }}
          />
          <div className="relative flex items-center gap-4">
            <BrandMark size={48} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Welcome to Kairo</h1>
              <p className="mt-1 text-sm text-muted/60">
                Store verified career evidence once. For every opportunity, select the strongest
                proof, improve the wording without changing the facts, and review every change.
              </p>
            </div>
          </div>
        </section>
        <Card className="p-6">
          <CardTitle>Dashboard unavailable</CardTitle>
          <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn dark:text-kairo-dawn">
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
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  const { counts, evidenceNeedingReview, recentActivity } = overview;
  const brandNew =
    counts.projects + counts.experiences + counts.jobs + counts.applications === 0;

  const vaultTiles: Tile[] = [
    {
      to: "/vault",
      value: counts.projects,
      label: "Projects",
      icon: Folder,
      iconClass: "bg-info-soft text-kairo-blue dark:bg-kairo-blue/15 dark:text-blue-400",
    },
    {
      to: "/vault",
      value: counts.experiences,
      label: "Experiences",
      icon: Briefcase,
      iconClass: "bg-kairo-violet/10 text-violet-600 dark:bg-kairo-violet/15 dark:text-violet-400",
    },
    {
      to: "/vault",
      value: counts.skills,
      label: "Skills",
      icon: Code2,
      iconClass: "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400",
    },
    {
      to: "/vault",
      value: counts.evidenceVerified,
      label: "Evidence verified",
      sub:
        counts.evidenceUnverified > 0
          ? `${counts.evidenceUnverified} awaiting review`
          : counts.evidenceTotal === 0
            ? "no evidence yet"
            : "all verified",
      subClass: counts.evidenceUnverified > 0 ? "text-warn" : "text-ok",
      icon: ShieldCheck,
      iconClass:
        counts.evidenceUnverified > 0 ? "bg-warn-soft text-warn dark:bg-warn/15 dark:text-amber-400" : "bg-ok-soft text-ok dark:bg-ok/15 dark:text-emerald-400",
    },
  ];

  const pipelineTiles: Tile[] = [
    {
      to: "/jobs",
      value: counts.jobs,
      label: "Job workspaces",
      sub: counts.jobs > 0 ? `${counts.jobsWithPlan} with a resume plan` : "paste a JD to start",
      icon: Briefcase,
      iconClass: "bg-info-soft text-kairo-blue dark:bg-kairo-blue/15 dark:text-blue-400",
    },
    {
      to: "/applications",
      value: counts.applicationsActive,
      label: "Applications in flight",
      sub:
        counts.applications > 0
          ? `${counts.applications} tracked in total`
          : "track them manually here",
      icon: ClipboardCheck,
      iconClass: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
    },
    {
      to: "/resume-studio",
      value: counts.resumeVersions,
      label: "Resume versions",
      sub: counts.pdfsCompiled > 0 ? `${counts.pdfsCompiled} ${counts.pdfsCompiled === 1 ? "PDF compiled" : "PDFs compiled"}` : "export to create",
      icon: FileText,
      iconClass: "bg-kairo-violet/10 text-violet-600 dark:bg-kairo-violet/15 dark:text-violet-400",
    },
    {
      to: "/jobs",
      value: counts.suggestionsPending,
      label: "Pending suggestions",
      sub:
        counts.suggestionsPending > 0
          ? "AI rewrites awaiting your review"
          : "nothing awaiting review",
      subClass: counts.suggestionsPending > 0 ? "text-kairo-violet" : "text-muted",
      icon: Sparkles,
      iconClass: "bg-warn-soft text-warn dark:bg-warn/15 dark:text-amber-400",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl p-8">
      {/* Identity moment — the only place a gradient hero is allowed. */}
      <section className="relative mb-8 overflow-hidden rounded-2xl bg-kairo-midnight p-8 text-white shadow-raised">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(560px 280px at 10% -30%, rgba(37,99,235,0.45), transparent 62%), radial-gradient(520px 320px at 108% 130%, rgba(139,92,246,0.35), transparent 60%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
        />
        <div className="relative flex flex-wrap items-center gap-4">
          <BrandMark size={52} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {brandNew ? "Welcome to Kairo" : "Welcome back"}
            </h1>
            <p className="mt-1 text-sm text-muted/60">
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
          {["Local-first", "Offline-ready", "No fabrication, ever"].map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-white/[0.08] px-3 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/10"
            >
              {chip}
            </span>
          ))}
        </div>
      </section>

      {/* Real counts — every tile is a live query result, no derived scores. */}
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">Vault</h2>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {vaultTiles.map((tile) => (
          <StatTile key={tile.label} tile={tile} />
        ))}
      </div>

      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">Pipeline</h2>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {pipelineTiles.map((tile) => (
          <StatTile key={tile.label} tile={tile} />
        ))}
      </div>

      {brandNew ? (
        <GettingStarted />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card className="p-5 lg:col-span-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-warn-soft text-warn dark:bg-warn/15 dark:text-amber-400">
                  <ShieldCheck className="size-3.5" />
                </span>
                <CardTitle>Evidence needing review</CardTitle>
              </div>
              <CountPill
                tone={counts.evidenceUnverified > 0 ? "amber" : "green"}
                value={`${counts.evidenceUnverified} of ${counts.evidenceTotal} unverified`}
              />
            </div>
            <div className="mt-3 space-y-0.5">
              {evidenceNeedingReview.length === 0 ? (
                <p
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-3 text-xs ${
                    counts.evidenceTotal === 0
                      ? "bg-accent-soft text-muted"
                      : "bg-ok-soft text-ok dark:bg-ok/15 dark:text-emerald-300"
                  }`}
                >
                  <CircleCheck className="size-3.5 shrink-0" />
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
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-info-soft text-kairo-blue dark:bg-kairo-blue/15 dark:text-blue-400">
                  <Briefcase className="size-3.5" />
                </span>
                <CardTitle>Recent activity</CardTitle>
              </div>
              {recentActivity.length > 0 ? (
                <CountPill value={`${recentActivity.length} recent`} />
              ) : null}
            </div>
            <div className="mt-3 space-y-0.5">
              {recentActivity.length === 0 ? (
                <p className="rounded-lg bg-accent-soft px-3 py-3 text-xs text-muted">
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

      {/* Brand close — the "Progress Builds Possibilities." banner, edge to
          edge at a reduced height (center crop keeps the wordmark band). */}
      <div aria-hidden className="mt-8 overflow-hidden rounded-2xl border border-line shadow-card">
        <img
          src="/brand/banner-waves-1600.jpg"
          alt=""
          draggable={false}
          className="h-48 w-full object-cover object-center select-none"
        />
      </div>
    </div>
  );
}
