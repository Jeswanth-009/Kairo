import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Splash } from "../components/Splash";
import { CommandPalette, useCommandPalette } from "../components/CommandPalette";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { ToastHost } from "../components/ui/Toast";
import { Skeleton } from "../components/ui/Feedback";
import { useAppStore } from "../stores/appStore";
import { ipc } from "../lib/ipc";
import type { OnboardingStatus } from "../lib/types";
import { useTopBarStore } from "../stores/topBarStore";
const DashboardPage = lazy(() => import("../features/dashboard/DashboardPage"));
const OnboardingPage = lazy(() => import("../features/onboarding/OnboardingPage"));
const VaultPage = lazy(() => import("../features/vault/VaultPage"));
const SkillsPage = lazy(() => import("../features/vault/SkillsPage"));
const JobsPage = lazy(() => import("../features/jobs/JobsPage"));
const JobWorkspacePage = lazy(() => import("../features/jobs/JobWorkspacePage"));
const ResumeStudioPage = lazy(() => import("../features/resume-studio/ResumeStudioPage"));
const ApplicationsPage = lazy(() => import("../features/applications/ApplicationsPage"));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage"));
const DesignPage = lazy(() => import("../features/design/DesignPage"));

const TITLES: Record<string, string> = {
  "/": "Home",
  "/onboarding": "Get started",
  "/story": "My story",
  "/skills": "Skills",
  "/jobs": "Workspaces",
  "/resume-studio": "Resume Studio",
  "/applications": "Applications",
  "/settings": "Settings",
  "/design": "Design system",
};

/** Location trail derived from the URL; pages can override via the store. */
function crumbsFor(pathname: string): { label: string; to?: string }[] {
  if (/^\/jobs\/\d+\/resume/.test(pathname)) {
    const id = pathname.split("/")[2];
    return [
      { label: "Workspaces", to: "/jobs" },
      { label: `Job #${id}`, to: `/jobs/${id}` },
      { label: "Resume" },
    ];
  }
  if (/^\/jobs\/\d+/.test(pathname)) {
    const id = pathname.split("/")[2];
    return [
      { label: "Workspaces", to: "/jobs" },
      { label: `Job #${id}` },
    ];
  }
  const label = TITLES[pathname] ?? "";
  return label ? [{ label }] : [];
}

export default function App() {
  const location = useLocation();
  const loadDiagnostics = useAppStore((s) => s.loadDiagnostics);
  const { open: paletteOpen, openPalette, closePalette } = useCommandPalette();
  const topBar = useTopBarStore();
  // First run: a blank slate goes straight to the guided flow.
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    void loadDiagnostics();
    ipc
      .getOnboardingStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [loadDiagnostics, location.pathname]);

  // The shell clears page-published top-bar state on every navigation so a
  // stale breadcrumb/action never bleeds into the next page.
  useEffect(() => {
    topBar.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const needsOnboarding = status !== null && !status.hasAnyContent && location.pathname === "/";

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-ink">
      <Splash />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          crumbs={topBar.crumbs ?? crumbsFor(location.pathname)}
          saveState={topBar.saveState ?? undefined}
          primaryAction={topBar.primaryAction ?? undefined}
          onSearchClick={openPalette}
        />
        <main id="app-main" className="flex-1 overflow-y-auto">
          {/* Keyed by path so each page plays the enter animation on navigation. */}
          <div key={location.pathname} className="page-enter h-full">
            <Suspense fallback={<div className="mx-auto max-w-6xl space-y-5 p-8" aria-label="Loading page"><Skeleton className="h-10 w-72" /><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>}><Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/story" element={<VaultPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              {/* Old routes keep working: the story moved, interview moved
                  into each job workspace. */}
              <Route path="/vault" element={<Navigate to="/story" replace />} />
              <Route path="/interview" element={<Navigate to="/jobs" replace />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/jobs/:jobId" element={<JobWorkspacePage />} />
              <Route path="/jobs/:jobId/resume" element={<ResumeStudioPage />} />
              {/* Legacy global link: the editor is job-scoped now. */}
              <Route path="/resume-studio" element={<Navigate to="/jobs" replace />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/design" element={<DesignPage />} />
              {needsOnboarding ? (
                <Route path="*" element={<Navigate to="/onboarding" replace />} />
              ) : null}
            </Routes></Suspense>
          </div>
        </main>
      </div>
      <ToastHost />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
