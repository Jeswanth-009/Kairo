import { NavLink } from "react-router-dom";
import { Archive, Briefcase, ClipboardCheck, Home, Settings, Sparkles } from "lucide-react";
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
  { to: "/skills", label: "Skills", icon: Sparkles },
  { to: "/jobs", label: "Workspaces", icon: Briefcase },
  { to: "/applications", label: "Applications", icon: ClipboardCheck },
];

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  [
    "group relative flex min-h-[67px] flex-col items-center justify-center gap-1.5 rounded-2xl px-1.5 py-2 text-[11px] font-medium leading-tight",
    "transition-all duration-150",
    isActive
      ? "bg-gradient-to-br from-kairo-blue/35 to-kairo-violet/20 text-white shadow-[inset_0_0_0_1px_rgba(147,197,253,.25)]"
      : "text-slate-400 hover:bg-white/[0.08] hover:text-white",
  ].join(" ");

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.end} className={linkClasses}>
      {({ isActive }) => (
        <>
          <item.icon
            className={[
              "relative size-5 shrink-0 transition-colors duration-150",
              isActive ? "text-kairo-sky" : "text-slate-400 group-hover:text-slate-200",
            ].join(" ")}
            aria-hidden
          />
          <span className="relative text-center">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const appVersion = useAppStore((s) => s.diagnostics?.appVersion);
  return (
    <aside className="relative flex w-[94px] shrink-0 flex-col overflow-hidden border-r border-white/10 bg-[#080E21]">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-kairo-blue/20 to-transparent" />
      <NavLink to="/" aria-label="Kairo home" className="relative flex flex-col items-center gap-1 border-b border-white/10 px-2 py-5 text-white">
        <BrandMark size={48} surface="dark" />
        <span className="text-xs font-semibold tracking-[0.08em]">Kairo</span>
      </NavLink>
      <nav className="relative flex-1 space-y-1 overflow-y-auto px-2 py-5" aria-label="Main">
        {NAV_ITEMS.map((item) => (
          <NavItemLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="relative border-t border-white/10 px-2 py-3">
        <NavItemLink item={{ to: "/settings", label: "Settings", icon: Settings }} />
        <div className="pt-2 text-center text-[10px] text-slate-500">
          {appVersion ? `v${appVersion}` : "Local"}
        </div>
      </div>
    </aside>
  );
}
