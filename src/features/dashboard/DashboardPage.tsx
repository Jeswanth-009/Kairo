import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Feedback";
import { fmtAgo } from "../../lib/dateFmt";
import { ipc } from "../../lib/ipc";
import type {
  ActivityItem,
  DashboardOverview,
  EvidenceReviewItem,
  JobHomeRow,
  OnboardingStatus,
} from "../../lib/types";

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
  return "/story";
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
  const navigate = useNavigate();

  const steps: { title: string; body: string; cta: string; action: () => void }[] = [
    {
      title: "Import your resume",
      body: "One guided flow: bring a PDF / DOCX or paste text, review the facts it extracts, add a role, and get a first draft with a real PDF.",
      cta: "Start the guided flow",
      action: () => {
        navigate("/onboarding");
      },
    },
    {
      title: "Add a job",
      body: "Paste the job description verbatim. Kairo extracts the requirements and you review every one before matching.",
      cta: "Open Jobs",
      action: () => navigate("/jobs"),
    },
    {
      title: "Match, plan, tailor",
      body: "Run the deterministic match, generate the one-page plan, review AI rewording, export the PDF and save an immutable version.",
      cta: "Open Jobs",
      action: () => navigate("/jobs"),
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
            <button
              type="button"
              onClick={step.action}
              className="mt-3 inline-flex w-fit items-center gap-1 text-xs font-medium text-kairo-blue hover:underline"
            >
              {step.cta}
              <ArrowUpRight className="size-3" />
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** The next specific action for a job, derived from its resume state. */
function nextActionFor(job: JobHomeRow): { label: string; to: string } {
  const editor = `/jobs/${job.jobId}/resume`;
  if (job.pdfState === "missing") {
    return job.hasPlan
      ? { label: "Compile the resume you planned", to: editor }
      : { label: "Compose the resume from your Vault", to: editor };
  }
  if (job.pdfState === "stale") {
    return {
      label: "Recompile — your edits came after the last export",
      to: editor,
    };
  }
  return { label: "Review the current PDF and save a version", to: editor };
}

function ContinueCard({
  homeRows,
  navigate,
}: {
  homeRows: JobHomeRow[];
  navigate: (to: string) => void;
}) {
  if (homeRows.length === 0) {
    return (
      <Card className="p-6">
        <CardTitle>Continue where you left off</CardTitle>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted">
          Your job workspaces will show up here with the next specific action — compose, compile,
          or save a version.
        </p>
        <Button className="mt-4" onClick={() => navigate("/jobs")}>
          Add a job
        </Button>
      </Card>
    );
  }
  const job = homeRows[0];
  const action = nextActionFor(job);
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle>Continue this job</CardTitle>
          <p className="mt-1.5 text-base font-semibold text-ink">
            {job.roleTitle || "Untitled role"}
            {job.company ? <span className="font-normal text-muted"> · {job.company}</span> : null}
          </p>
          <p className="mt-1 text-xs text-muted">
            {homeRows.length > 1
              ? `${homeRows.length - 1} other job${homeRows.length === 2 ? "" : "s"} waiting`
              : "Your only active workspace"}
          </p>
        </div>
        <Button onClick={() => navigate(action.to)}>{action.label}</Button>
      </div>
      {homeRows.length > 1 ? (
        <ul className="mt-4 space-y-1 border-t border-line pt-3">
          {homeRows.slice(1, 4).map((row) => {
            const next = nextActionFor(row);
            return (
              <li key={row.jobId}>
                <button
                  type="button"
                  onClick={() => navigate(next.to)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent-soft"
                >
                  <span className="truncate font-medium text-ink">
                    {row.roleTitle || "Untitled role"}
                    {row.company ? <span className="text-muted"> · {row.company}</span> : null}
                  </span>
                  <span className="shrink-0 text-muted">
                    {row.pdfState === "stale"
                      ? "PDF needs update"
                      : row.pdfState === "missing"
                        ? "No PDF yet"
                        : "Up to date"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}

/** Prominent, honest attention list: what needs the user's eyes. */
function AttentionRow({
  homeRows,
  importedUnreviewed,
  navigate,
}: {
  homeRows: JobHomeRow[];
  importedUnreviewed: number;
  navigate: (to: string) => void;
}) {
  const stale = homeRows.filter((j) => j.pdfState === "stale");
  const items: { label: string; detail: string; to: string; tone: string }[] = [];
  for (const job of stale.slice(0, 3)) {
    items.push({
      label: `PDF needs update — ${job.roleTitle || "Untitled role"}`,
      detail: "Changed after the last export",
      to: `/jobs/${job.jobId}/resume`,
      tone: "warn",
    });
  }
  if (importedUnreviewed > 0) {
    items.push({
      label: `${importedUnreviewed} imported item${importedUnreviewed === 1 ? "" : "s"} to review`,
      detail: "Still marked “Imported from resume”",
      to: "/story",
      tone: "info",
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="mb-6 grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => navigate(item.to)}
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-accent-soft ${
            item.tone === "warn"
              ? "border-warn/30 bg-warn-soft/60 dark:border-warn/25 dark:bg-warn/10"
              : "border-line bg-card"
          }`}
        >
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-ink">{item.label}</span>
            <span className="text-[11px] text-muted">{item.detail}</span>
          </span>
          <ArrowUpRight className="size-3.5 shrink-0 text-muted" />
        </button>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [homeRows, setHomeRows] = useState<JobHomeRow[]>([]);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [overview, homeRows, onboarding] = await Promise.all([
          ipc.getDashboard(),
          ipc.getHomeOverview().catch(() => [] as JobHomeRow[]),
          ipc.getOnboardingStatus().catch(() => null),
        ]);
        setOverview(overview);
        setHomeRows(homeRows);
        setStatus(onboarding);
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
                Store verified career proof once. For every opportunity, select the strongest
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
      to: "/story",
      value: counts.projects,
      label: "Projects",
      icon: Folder,
      iconClass: "bg-info-soft text-kairo-blue dark:bg-kairo-blue/15 dark:text-blue-400",
    },
    {
      to: "/story",
      value: counts.experiences,
      label: "Experiences",
      icon: Briefcase,
      iconClass: "bg-kairo-violet/10 text-violet-600 dark:bg-kairo-violet/15 dark:text-violet-400",
    },
    {
      to: "/story",
      value: counts.skills,
      label: "Skills",
      icon: Code2,
      iconClass: "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400",
    },
    {
      to: "/story",
      value: counts.evidenceVerified,
      label: "Proof verified",
      sub:
        counts.evidenceUnverified > 0
          ? `${counts.evidenceUnverified} awaiting review`
          : counts.evidenceTotal === 0
            ? "no proof yet"
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
      to: "/jobs",
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
      {/* Quiet identity strip — the brand stays, the glow goes. */}
      <section className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-card p-6 shadow-card">
        <BrandMark size={44} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {brandNew ? "Welcome to Kairo" : "Welcome back"}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {brandNew
              ? "Bring your resume, add a role, and get a reviewed PDF — in one sitting."
              : `${counts.projects + counts.experiences} records · ${counts.evidenceVerified} verified proof · ${counts.jobs} job workspace${counts.jobs === 1 ? "" : "s"}`}
          </p>
        </div>
      </section>

      {/* First: the single most important unfinished action. */}
      {brandNew ? (
        <GettingStarted />
      ) : (
        <>
          <div className="mb-4">
            <ContinueCard homeRows={homeRows} navigate={(to) => navigate(to)} />
          </div>
          <AttentionRow
            homeRows={homeRows}
            importedUnreviewed={status?.importedUnreviewed ?? 0}
            navigate={(to) => navigate(to)}
          />
        </>
      )
      }

      {/* Secondary: compact live counts — no derived scores. */}
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">Overview</h2>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {vaultTiles.map((tile) => (
          <StatTile key={tile.label} tile={tile} />
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...vaultTiles, ...pipelineTiles].map((tile) => (
          <StatTile key={tile.label} tile={tile} />
        ))}
      </div>

      {brandNew ? null : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card className="p-5 lg:col-span-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-warn-soft text-warn dark:bg-warn/15 dark:text-amber-400">
                  <ShieldCheck className="size-3.5" />
                </span>
                <CardTitle>Proof needing review</CardTitle>
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
                    ? "No proof yet — attach proof to your records in the Career Vault."
                    : counts.evidenceTotal === 1
                      ? "The 1 proof item is verified."
                      : `All ${counts.evidenceTotal} proof items are verified.`}
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
