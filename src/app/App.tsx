import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Splash } from "../components/Splash";
import { CommandPalette, useCommandPalette } from "../components/CommandPalette";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { ToastHost } from "../components/ui/Toast";
import { useAppStore } from "../stores/appStore";
import { ipc } from "../lib/ipc";
import type { OnboardingStatus } from "../lib/types";
import DashboardPage from "../features/dashboard/DashboardPage";
import OnboardingPage from "../features/onboarding/OnboardingPage";
import VaultPage from "../features/vault/VaultPage";
import JobsPage from "../features/jobs/JobsPage";
import JobWorkspacePage from "../features/jobs/JobWorkspacePage";
import ResumeStudioPage from "../features/resume-studio/ResumeStudioPage";
import ApplicationsPage from "../features/applications/ApplicationsPage";
import SettingsPage from "../features/settings/SettingsPage";

const TITLES: Record<string, string> = {
  "/": "Home",
  "/onboarding": "Get started",
  "/story": "My story",
  "/jobs": "Jobs",
  "/resume-studio": "Resume Studio",
  "/applications": "Applications",
  "/settings": "Settings",
};

function titleFor(pathname: string): string {
  if (/^\/jobs\/\d+$/.test(pathname)) return "Job Workspace";
  return TITLES[pathname] ?? "Kairo";
}

export default function App() {
  const location = useLocation();
  const loadDiagnostics = useAppStore((s) => s.loadDiagnostics);
  const { open: paletteOpen, openPalette, closePalette } = useCommandPalette();
  // First run: a blank slate goes straight to the guided flow.
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    void loadDiagnostics();
    ipc
      .getOnboardingStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [loadDiagnostics, location.pathname]);

  const needsOnboarding = status !== null && !status.hasAnyContent && location.pathname === "/";

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-ink">
      <Splash />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={titleFor(location.pathname)} onSearchClick={openPalette} />
        <main id="app-main" className="flex-1 overflow-y-auto">
          {/* Keyed by path so each page plays the enter animation on navigation. */}
          <div key={location.pathname} className="page-enter h-full">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/story" element={<VaultPage />} />
              {/* Old routes keep working: the story moved, interview moved
                  into each job workspace. */}
              <Route path="/vault" element={<Navigate to="/story" replace />} />
              <Route path="/interview" element={<Navigate to="/jobs" replace />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/jobs/:jobId" element={<JobWorkspacePage />} />
              <Route path="/resume-studio" element={<ResumeStudioPage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              {needsOnboarding ? (
                <Route path="*" element={<Navigate to="/onboarding" replace />} />
              ) : null}
            </Routes>
          </div>
        </main>
      </div>
      <ToastHost />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
