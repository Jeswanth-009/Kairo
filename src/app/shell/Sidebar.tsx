import { NavLink } from "react-router-dom";
import { BrandMark } from "../../components/BrandMark";
import {
  IconApplications,
  IconDashboard,
  IconInterview,
  IconJobs,
  IconResume,
  IconSettings,
  IconVault,
} from "../../components/icons";
import type { ComponentType, SVGProps } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: IconDashboard, end: true },
  { to: "/vault", label: "Career Vault", icon: IconVault },
  { to: "/jobs", label: "Jobs", icon: IconJobs },
  { to: "/resume-studio", label: "Resume Studio", icon: IconResume },
  { to: "/applications", label: "Applications", icon: IconApplications },
  { to: "/interview", label: "Interview Prep", icon: IconInterview },
];

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  [
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200",
    isActive ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
  ].join(" ");

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col bg-kairo-midnight">
      <div className="flex items-center gap-3 border-b border-white/5 px-5 py-4">
        <BrandMark size={34} />
        <div>
          <div className="text-[15px] font-semibold leading-tight text-white">Kairo</div>
          <div className="text-[11px] leading-tight text-slate-500">
            Your career. A brighter next step.
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={linkClasses}>
            <item.icon className="shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="space-y-1 border-t border-white/5 px-3 py-3">
        <NavLink to="/settings" className={linkClasses}>
          <IconSettings className="shrink-0" />
          <span>Settings</span>
        </NavLink>
        <div className="px-3 pt-2 text-[11px] text-slate-600">v0.1.0 · Phase 0 · Foundation</div>
      </div>
    </aside>
  );
}
