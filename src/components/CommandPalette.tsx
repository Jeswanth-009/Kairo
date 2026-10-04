import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  Award,
  Briefcase,
  Building2,
  ClipboardCheck,
  FolderGit2,
  GraduationCap,
  LayoutDashboard,
  MessagesSquare,
  Search,
  Settings,
  Sparkles,
  Upload,
  Wrench,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { cn } from "../lib/cn";
import { useVaultStore } from "../stores/vaultStore";
import { useJobsStore } from "../stores/jobsStore";
import { useUiStore } from "../stores/uiStore";

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  keywords: string;
  run: () => void;
}

const NAV_ACTIONS: { to: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/story", label: "My story", icon: Archive },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/applications", label: "Applications", icon: ClipboardCheck },
  { to: "/interview", label: "Interview Prep", icon: MessagesSquare },
  { to: "/settings", label: "Settings", icon: Settings },
];

/**
 * Global quick-finder (Ctrl/Cmd+K). Searches everything already in memory —
 * vault records, jobs, plus navigation and quick actions — entirely on the
 * frontend, so it works identically in the desktop app and the browser demo.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const projects = useVaultStore((s) => s.projects);
  const experiences = useVaultStore((s) => s.experiences);
  const education = useVaultStore((s) => s.education);
  const certifications = useVaultStore((s) => s.certifications);
  const achievements = useVaultStore((s) => s.achievements);
  const skills = useVaultStore((s) => s.skills);
  const jobs = useJobsStore((s) => s.jobs);
  const focusVaultRecord = useUiStore((s) => s.focusVaultRecord);
  const requestVaultAction = useUiStore((s) => s.requestVaultAction);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const all: PaletteItem[] = [];

    for (const nav of NAV_ACTIONS) {
      all.push({
        id: `go:${nav.to}`,
        group: "Go to",
        label: nav.label,
        icon: nav.icon,
        keywords: `open navigate page ${nav.label} ${nav.to}`,
        run: () => navigate(nav.to),
      });
    }
    all.push({
      id: "action:import",
      group: "Actions",
      label: "Import resume text",
      sublabel: "Paste a resume and Kairo extracts the records",
      icon: Upload,
      keywords: "import resume paste analyze cv",
      run: () => {
        navigate("/story");
        requestVaultAction({ type: "import" });
      },
    });
    all.push({
      id: "action:new-job",
      group: "Actions",
      label: "New job workspace",
      sublabel: "Paste a job description to start matching",
      icon: Sparkles,
      keywords: "new job workspace add posting",
      run: () => navigate("/jobs"),
    });

    const record = (key: "projects" | "experiences" | "education" | "certifications" | "achievements", id: string, group: string, icon: ComponentType<SVGProps<SVGSVGElement>>, label: string, sublabel: string | undefined, keywords: string) =>
      all.push({
        id,
        group,
        label,
        sublabel,
        icon,
        keywords,
        run: () => {
          navigate("/story");
          focusVaultRecord(key, Number(id.split(":")[1]));
        },
      });

    for (const p of projects) {
      record(
        "projects",
        `project:${p.id}`,
        "Projects",
        FolderGit2,
        p.title,
        p.description || undefined,
        `project ${p.title} ${p.description} ${p.skills.map((s) => s.canonicalName).join(" ")}`,
      );
    }
    for (const e of experiences) {
      record(
        "experiences",
        `experience:${e.id}`,
        "Experience",
        Building2,
        [e.role, e.organization].filter(Boolean).join(" — "),
        e.description || undefined,
        `experience work ${e.role} ${e.organization} ${e.description}`,
      );
    }
    for (const ed of education) {
      record(
        "education",
        `education:${ed.id}`,
        "Education",
        GraduationCap,
        [ed.degree, ed.fieldOfStudy, ed.institution].filter(Boolean).join(" — "),
        ed.institution,
        `education degree ${ed.degree} ${ed.fieldOfStudy} ${ed.institution}`,
      );
    }
    for (const c of certifications) {
      record(
        "certifications",
        `certification:${c.id}`,
        "Certifications",
        Award,
        c.title,
        c.issuer || undefined,
        `certification ${c.title} ${c.issuer}`,
      );
    }
    for (const a of achievements) {
      record(
        "achievements",
        `achievement:${a.id}`,
        "Achievements",
        Award,
        a.title,
        a.issuer || undefined,
        `achievement award ${a.title} ${a.issuer}`,
      );
    }
    for (const s of skills) {
      all.push({
        id: `skill:${s.id}`,
        group: "Skills",
        label: s.canonicalName,
        sublabel: s.category,
        icon: Wrench,
        keywords: `skill ${s.canonicalName} ${s.aliases.map((a) => a.alias).join(" ")} ${s.category}`,
        run: () => {
          navigate("/story");
          focusVaultRecord("skills", s.id);
        },
      });
    }
    for (const j of jobs) {
      all.push({
        id: `job:${j.id}`,
        group: "Jobs",
        label: j.roleTitle || "Untitled role",
        sublabel: j.company || undefined,
        icon: Briefcase,
        keywords: `job ${j.roleTitle} ${j.company} ${j.domain ?? ""}`,
        run: () => navigate(`/jobs/${j.id}`),
      });
    }

    return all;
  }, [projects, experiences, education, certifications, achievements, skills, jobs, navigate, focusVaultRecord, requestVaultAction]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return items.filter((i) => i.group === "Go to" || i.group === "Actions");
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.keywords.toLowerCase().includes(q),
    );
  }, [items, q]);

  const grouped = useMemo(() => {
    const map = new Map<string, PaletteItem[]>();
    for (const item of filtered) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [filtered]);

  // Flatten for keyboard navigation (group headers are not focusable).
  const flat = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);

  useEffect(() => {
    setActiveIndex((prev) => Math.min(prev, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    // Optional call — jsdom and some embedded webviews lack scrollIntoView.
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) {
        item.run();
        onClose();
      }
    }
  };

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-enter"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog-enter w-full max-w-xl overflow-hidden rounded-xl border border-line bg-card shadow-float"
        role="dialog"
        aria-modal="true"
        aria-label="Quick search"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search vault, jobs, actions…"
            className="h-12 w-full bg-transparent text-sm text-ink placeholder:text-muted/70 focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-line bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-muted">
            esc
          </kbd>
        </div>

        {flat.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            Nothing matches “{query.trim()}”.
          </p>
        ) : (
          <ul ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
            {grouped.map(([group, list]) => (
              <li key={group}>
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {group}
                </p>
                <ul>
                  {list.map((item) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const Icon = item.icon;
                    const active = idx === activeIndex;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          data-index={idx}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => {
                            item.run();
                            onClose();
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                            active ? "bg-accent-soft" : "hover:bg-accent-soft/60",
                          )}
                        >
                          <Icon className="size-4 shrink-0 text-muted" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-ink">{item.label}</span>
                            {item.sublabel ? (
                              <span className="block truncate text-xs text-muted">
                                {item.sublabel}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Global Ctrl/Cmd+K handler plus the TopBar search button state. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, openPalette: () => setOpen(true), closePalette: () => setOpen(false) };
}
