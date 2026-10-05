import { useEffect } from "react";
import { Sparkles } from "lucide-react";
import { Skeleton } from "../../components/ui/Feedback";
import { useVaultStore } from "../../stores/vaultStore";
import { SkillsTab } from "./SkillsTab";

/** Skills are a reusable library, with their own destination and vocabulary. */
export default function SkillsPage() {
  const load = useVaultStore((s) => s.load);
  const loaded = useVaultStore((s) => s.loaded);
  const loading = useVaultStore((s) => s.loading);
  const error = useVaultStore((s) => s.error);
  const skillCount = useVaultStore((s) => s.skills.length);

  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl space-y-7 px-6 py-7 lg:px-10 lg:py-9">
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#211B52] via-[#171B47] to-[#0B1020] px-7 py-8 text-white sm:px-9">
        <div aria-hidden className="absolute -right-12 -top-28 size-80 rounded-full border border-white/10 bg-kairo-violet/20" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <span className="mb-4 inline-flex size-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-kairo-sky"><Sparkles className="size-5" /></span>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-kairo-sky">Reusable vocabulary</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Skills</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">Keep one clean library. Aliases help Kairo recognize job wording; each resume still uses only the skills you choose.</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-right backdrop-blur"><span className="block text-3xl font-semibold">{skillCount}</span><span className="text-xs text-slate-300">skills in your library</span></div>
        </div>
      </section>
      {error ? <p role="alert" className="rounded-xl border border-bad/30 bg-bad-soft p-4 text-sm text-bad">Could not load skills: {error}</p> : null}
      {loading && !loaded ? <Skeleton className="h-48" /> : <SkillsTab />}
    </div>
  );
}
