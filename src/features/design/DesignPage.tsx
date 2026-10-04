import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field, Input, Select, Textarea } from "../../components/ui/inputs";
import { Row, Section, SectionDivider, StatusLine, StepNav, BrandGlyph } from "../../components/ui/ds";
import type { DocState } from "../../components/ui/ds";
import { Badge } from "../../components/ui/Badge";
import { Skeleton, Spinner } from "../../components/ui/Feedback";
import { PageHeader } from "../../components/ui/PageHeader";
import { EmptyState } from "../../components/ui/EmptyState";

/**
 * Stage-2 design gallery: every shared primitive in the states the review's
 * §12 inventory requires (first use, loading, save failed, PDF out of date,
 * …). Reachable at /design so screens can be composed and checked before
 * they are rebuilt — the clickable prototype for the visual system.
 */

type DemoStepKey = "role" | "evidence" | "resume" | "review" | "applied";

export default function DesignPage() {
  const [step, setStep] = useState<DemoStepKey>("resume");
  const [docState, setDocState] = useState<DocState>("needs-update");

  return (
    <div className="mx-auto max-w-4xl space-y-10 p-8">
      <PageHeader
        title="Design system"
        description="Shared primitives and the state inventory (§12) — every state a screen can be in, at a glance."
      />
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <BrandGlyph size={18} /> Kairo design system
      </div>

      <Section title="Brand" description="Simplified glyph for small sizes; full logo for splash and about.">
        <div className="flex flex-wrap items-center gap-6">
          <BrandGlyph size={16} />
          <BrandGlyph size={20} />
          <BrandGlyph size={24} />
          <span className="text-sm text-muted">color · 16 / 20 / 24 px</span>
          <BrandGlyph size={24} variant="on-light" />
          <span className="text-sm text-muted">on-light</span>
          <BrandGlyph size={20} variant="mono" className="text-ink" />
          <span className="text-sm text-muted">one-color (currentColor)</span>
        </div>
      </Section>

      <Section title="Type scale" description="Page 28–32 · Section 18–20 · Body 15–16 · Secondary 13–14. Never 10–11px for actions.">
        <p className="text-3xl font-semibold tracking-tight text-ink">Page title — 30px</p>
        <p className="mt-2 text-[19px] font-semibold text-ink">Section title — 19px</p>
        <p className="mt-2 text-[15px] text-ink">
          Body and form text — 15px. Kairo extracts the requirements and you confirm which ones
          matter before anything is matched.
        </p>
        <p className="mt-1 text-[13px] text-muted">Secondary information — 13px.</p>
      </Section>

      <Section title="Buttons" description="One primary action per task area; 40px primary height; ≥24px targets everywhere.">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger-outline">Danger</Button>
          <Button size="sm" variant="secondary">Small (toolbars)</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Fields" description="Borders for inputs; consistent focus; labels always visible.">
        <div className="grid max-w-xl grid-cols-2 gap-4">
          <Field label="Company">
            <Input placeholder="Acme Corp" />
          </Field>
          <Field label="Role">
            <Input placeholder="Backend Engineer" />
          </Field>
          <Field label="Status">
            <Select>
              <option>Applied</option>
              <option>Interview</option>
            </Select>
          </Field>
          <Field label="Notes">
            <Input placeholder="—" />
          </Field>
          <div className="col-span-2">
            <Field label="Job description">
              <Textarea rows={3} placeholder="Paste the exact posting…" />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Status line" description="The four persistent document states, shared by Home and the editor.">
        <div className="space-y-2">
          {(["draft", "needs-update", "current", "export-failed"] as DocState[]).map((state) => (
            <div key={state} className="flex items-center gap-3">
              <StatusLine
                state={state}
                className="flex-1"
                actions={
                  state === "needs-update" || state === "draft" || state === "export-failed" ? (
                    <Button size="sm">Export PDF</Button>
                  ) : (
                    <Button size="sm" variant="secondary">Save version</Button>
                  )
                }
              />
              <code className="w-28 shrink-0 text-xs text-muted">{state}</code>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-kairo-blue hover:underline"
            onClick={() =>
              setDocState(
                docState === "current"
                  ? "needs-update"
                  : docState === "needs-update"
                    ? "export-failed"
                    : docState === "export-failed"
                      ? "draft"
                      : "current",
              )
            }
          >
            Cycle interactive state (currently: {docState})
          </button>
          <StatusLine state={docState} detail="Product Engineer · Acme" />
        </div>
      </Section>

      <Section title="Step navigation" description="Guided sequence, backward-free; reached stages stay reachable.">
        <Card className="p-5">
          <StepNav
            steps={[
              { key: "role", label: "Role", status: "complete" as const },
              { key: "evidence", label: "Evidence", status: "needs-attention" as const, action: "Requirements or facts changed — re-run the match" },
              { key: "resume", label: "Resume", status: "complete" as const },
              { key: "review", label: "Review", status: "in-progress" as const, action: "Look through the PDF, then mark it reviewed" },
              { key: "applied", label: "Applied", status: "not-started" as const },
            ]}
            active={step}
            onChange={setStep}
            hint={"Next: Look through the PDF, then mark it reviewed"}
          />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Statuses come from saved state — visiting a stage never completes it (§ stage progress).
          </p>
          <p className="mt-3 text-[13px] text-muted">
            Active: <strong>{step}</strong> — done stages keep their checkmark; later stages stay
            clickable but muted.
          </p>
        </Card>
      </Section>

      <Section title="Rows" description="Home recent jobs, Jobs list, My Story, Applications all use this row.">
        <Card className="divide-y divide-line p-2">
          <Row
            onClick={() => undefined}
            leading={<span aria-hidden>📄</span>}
            title="Product Engineer · Acme"
            subtitle="PDF needs review after your latest edit"
            meta="2h ago"
            trailing={<Button size="sm" variant="secondary">Review PDF</Button>}
          />
          <Row
            onClick={() => undefined}
            leading={<span aria-hidden>📄</span>}
            title="Frontend Developer · Northstar"
            subtitle="Draft in progress"
            meta="yesterday"
            trailing={<Badge tone="amber">Draft</Badge>}
          />
          <Row
            title="README-only row (no action)"
            subtitle="Same layout, no hover"
            meta="—"
          />
        </Card>
      </Section>

      <SectionDivider label="State inventory (§12)" />

      <Section title="First use / no data">
        <EmptyState
          icon={<span aria-hidden className="text-2xl">📄</span>}
          title="Create your first resume"
          description="Import an existing resume or start from your confirmed history — Kairo assembles the draft, you stay in control."
        >
          <Button>Create my first resume</Button>
        </EmptyState>
      </Section>

      <Section title="Loading">
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full" />
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="size-4" /> Compiling PDF…
          </p>
        </div>
      </Section>

      <Section title="Save failed / import failed / no recommendation">
        <div className="space-y-3">
          <StatusLine state="export-failed" detail="Tectonic reported an error; your previous PDF is untouched" />
          <Card className="p-5">
            <p className="text-sm font-medium text-ink">Import failed halfway</p>
            <p className="mt-1 text-[13px] text-muted">
              The database is unchanged — nothing was saved. Retry the import or paste the text
              instead.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm">Retry import</Button>
              <Button size="sm" variant="ghost">Paste text instead</Button>
            </div>
          </Card>
          <Card className="p-5">
            <p className="text-sm font-medium text-ink">Performance improvement — no confirmed result</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              This role asks for performance work. Your history has no confirmed result for it —
              add a real example if you have one, or leave the requirement unsupported. Kairo will
              not invent one.
            </p>
          </Card>
        </div>
      </Section>

      <Section title="PDF out of date / completed review">
        <div className="space-y-2">
          <StatusLine state="needs-update" detail="Product Engineer · Acme" actions={<Button size="sm">Recompile</Button>} />
          <StatusLine state="current" detail="Reviewed · version 1 saved" actions={<Badge tone="green">✓ reviewed</Badge>} />
        </div>
      </Section>
    </div>
  );
}
