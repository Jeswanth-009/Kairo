import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { ToastHost } from "../components/ui/Toast";
import { useAppStore } from "../stores/appStore";
import DashboardPage from "../features/dashboard/DashboardPage";
import VaultPage from "../features/vault/VaultPage";
import JobsPage from "../features/jobs/JobsPage";
import ResumeStudioPage from "../features/resume-studio/ResumeStudioPage";
import ApplicationsPage from "../features/applications/ApplicationsPage";
import InterviewPrepPage from "../features/interview/InterviewPrepPage";
import SettingsPage from "../features/settings/SettingsPage";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/vault": "Career Vault",
  "/jobs": "Jobs",
  "/resume-studio": "Resume Studio",
  "/applications": "Applications",
  "/interview": "Interview Prep",
  "/settings": "Settings",
};

export default function App() {
  const location = useLocation();
  const loadDiagnostics = useAppStore((s) => s.loadDiagnostics);

  useEffect(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-ink">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={TITLES[location.pathname] ?? "Kairo"} />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/vault" element={<VaultPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/resume-studio" element={<ResumeStudioPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/interview" element={<InterviewPrepPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
      <ToastHost />
    </div>
  );
}
