import { NavLink } from "react-router-dom";
import { Archive, Briefcase, ClipboardCheck, Home, Settings } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { BrandMark } from "../../components/BrandMark";
import { useAppStore } from "../../stores/appStore";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
}

/** Navigation is organized around user goals, not internal concepts. */
const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/story", label: "My story", icon: Archive },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/applications", label: "Applications", icon: ClipboardCheck },
];

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  [
    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
    "transition-colors duration-150",
    isActive
      ? "bg-white/[0.12] text-white"
      : "text-muted hover:bg-white/[0.06] hover:text-slate-100",
  ].join(" ");

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.end} className={linkClasses} aria-current="page">
      {({ isActive }) => (
        <>
          {isActive ? (
            <span
              aria-hidden
              className="absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full bg-kairo-sky"
            />
          ) : null}
          <item.icon
            className={[
              "relative shrink-0 transition-colors duration-150",
              isActive ? "text-kairo-sky" : "text-muted group-hover:text-muted/60",
            ].join(" ")}
            aria-hidden
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
      <div className="relative flex items-center gap-3 px-5 py-5">
        <BrandMark size={38} />
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
      <nav className="relative flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {NAV_ITEMS.map((item) => (
          <NavItemLink key={item.to} item={item} />
        ))}
      </nav>

      <div className="relative border-t border-white/[0.06] px-3 py-3">
        <NavItemLink item={{ to: "/settings", label: "Settings", icon: Settings }} />
        <div className="px-3 pt-2.5 text-[11px] text-muted">
          {appVersion ? `v${appVersion}` : "Kairo"} · Local-first
        </div>
      </div>
    </aside>
  );
}
