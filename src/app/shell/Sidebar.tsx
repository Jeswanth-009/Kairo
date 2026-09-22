import { NavLink } from "react-router-dom";
import {
  Archive,
  Briefcase,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  MessagesSquare,
  Settings,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { BrandMark } from "../../components/BrandMark";
import { useAppStore } from "../../stores/appStore";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/vault", label: "Career Vault", icon: Archive },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/resume-studio", label: "Resume Studio", icon: FileText },
  { to: "/applications", label: "Applications", icon: ClipboardCheck },
  { to: "/interview", label: "Interview Prep", icon: MessagesSquare },
];

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  [
    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
    "transition-all duration-200",
    isActive
      ? "bg-white/[0.1] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_4px_16px_-6px_rgb(37_99_235/0.5)]"
      : "text-muted hover:bg-white/[0.05] hover:text-slate-100",
  ].join(" ");

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.end} className={linkClasses}>
      {({ isActive }) => (
        <>
          {isActive ? (
            <>
              <span
                aria-hidden
                className="absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-kairo-sky to-kairo-violet"
              />
              <span
                aria-hidden
                className="absolute inset-0 rounded-xl bg-gradient-to-r from-kairo-blue/[0.14] to-kairo-violet/[0.08]"
              />
            </>
          ) : null}
          <item.icon
            className={[
              "relative shrink-0 transition-colors duration-200",
              isActive ? "text-kairo-sky" : "text-muted group-hover:text-muted/60",
            ].join(" ")}
          />
          <span className="relative">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const appVersion = useAppStore((s) => s.diagnostics?.appVersion);
  return (
    <aside className="relative flex w-60 shrink-0 flex-col overflow-hidden bg-sidebar">
      {/* Ambient brand glow — decoration only, keeps nav text on solid contrast. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(460px 240px at -20% -8%, rgba(37,99,235,0.28), transparent 65%), radial-gradient(420px 280px at 120% 112%, rgba(139,92,246,0.16), transparent 60%), radial-gradient(300px 160px at 50% 55%, rgba(246,193,119,0.05), transparent 70%)",
        }}
      />

      <div className="relative flex items-center gap-3 px-5 py-5">
        <BrandMark size={38} glow />
        <div className="min-w-0">
          <div className="text-[15px] leading-tight font-semibold tracking-tight text-white">
            Kairo
          </div>
          <div className="truncate text-[11px] leading-tight text-muted">
            Your career. A brighter next step.
          </div>
        </div>
      </div>

      <div className="relative px-5 pt-2 pb-1">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
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
          item={{ to: "/settings", label: "Settings", icon: Settings }}
        />
        <div className="px-3 pt-2.5 text-[11px] text-muted">
          {appVersion ? `v${appVersion}` : "Kairo"} · Local-first
        </div>
      </div>
    </aside>
  );
}
