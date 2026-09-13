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
    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
    "transition-all duration-200",
    isActive
      ? "bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.07)]"
      : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100",
  ].join(" ");

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.end} className={linkClasses}>
      {({ isActive }) => (
        <>
          {isActive ? (
            <span
              aria-hidden
              className="absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-kairo-sky to-kairo-violet"
            />
          ) : null}
          <item.icon
            className={[
              "shrink-0 transition-colors duration-200",
              isActive ? "text-kairo-sky" : "text-slate-500 group-hover:text-slate-300",
            ].join(" ")}
          />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside className="relative flex w-60 shrink-0 flex-col overflow-hidden bg-kairo-midnight">
      {/* Ambient brand glow — decoration only, keeps nav text on solid contrast. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(420px 220px at -20% -10%, rgba(37,99,235,0.28), transparent 65%), radial-gradient(380px 260px at 120% 110%, rgba(139,92,246,0.16), transparent 60%)",
        }}
      />

      <div className="relative flex items-center gap-3 px-5 py-5">
        <BrandMark size={36} />
        <div className="min-w-0">
          <div className="text-[15px] leading-tight font-semibold tracking-tight text-white">
            Kairo
          </div>
          <div className="truncate text-[11px] leading-tight text-slate-500">
            Your career. A brighter next step.
          </div>
        </div>
      </div>

      <div className="relative px-5 pt-2 pb-1">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-slate-600 uppercase">
          Workspace
        </span>
      </div>
      <nav className="relative flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {NAV_ITEMS.map((item) => (
          <NavItemLink key={item.to} item={item} />
        ))}
      </nav>

      <div className="relative border-t border-white/[0.06] px-3 py-3">
        <NavItemLink
          item={{ to: "/settings", label: "Settings", icon: IconSettings }}
        />
        <div className="px-3 pt-2.5 text-[11px] text-slate-600">v0.1.0 · Local-first</div>
      </div>
    </aside>
  );
}
