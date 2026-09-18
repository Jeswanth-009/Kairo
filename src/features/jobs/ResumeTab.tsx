import { useState, useEffect } from "react";
import { ExternalLink, FileText, FolderOpen, HardDriveDownload } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Feedback";
import { cn } from "../../lib/cn";
import { ipc } from "../../lib/ipc";
import { fmtAgo } from "../../lib/dateFmt";
import { toast } from "../../stores/toastStore";
import type { PdfArtifact } from "../../lib/types";
import { PdfViewer } from "../resume-studio/PdfViewer";

const TEMPLATES = [
  { id: "jake", name: "Jake", desc: "Clean ATS-friendly column layout" },
  { id: "expressive", name: "Expressive", desc: "Narrative style with headline & objective" },
  { id: "plushcv", name: "PlushCV", desc: "Two-column — skills/education on sidebar" },
];

export function ResumeTab({ jobId }: { jobId: number }) {
  const [templateId, setTemplateId] = useState<string>("jake");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<PdfArtifact | null>(null);

  useEffect(() => {
    ipc
      .getPdfArtifact(jobId)
      .then((a) => {
        if (a) setArtifact(a);
      })
      .catch(console.error);
    // The Studio persists the template on the plan config; honor it here.
    ipc
      .getPlan(jobId)
      .then((stored) => {
        const persisted = stored?.plan.config.templateId;
        if (persisted) setTemplateId(persisted);
      })
      .catch(console.error);
  }, [jobId]);

  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    if (jobId > 0) {
      void ipc
        .getPlan(jobId)
        .then((stored) => {
          if (!stored) return;
          const next = structuredClone(stored.plan);
          next.config.templateId = id;
          return ipc.savePlan(jobId, next);
        })
        .catch((e) => toast.error(String(e)));
    }
  };

  const compile = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await ipc.exportPdf(jobId, templateId);
      setArtifact(res.artifact);
      toast.ok("Resume compiled successfully");
    } catch (e) {
      setError(String(e));
      toast.error("Compilation failed");
    } finally {
      setBusy(false);
    }
  };

  const openPdf = () => {
    if (!artifact) return;
    void ipc.openFile(artifact.pdfPath).catch((e: unknown) => toast.error(String(e)));
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Left column — settings */}
      <div className="flex w-full flex-col gap-4 lg:w-1/3">
        <Card className="p-6">
          <h3 className="mb-4 text-sm font-semibold text-ink">Generate Resume</h3>
          <div className="space-y-4">
            {/* Template picker */}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
                Template
              </label>
              <div className="flex flex-col gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => chooseTemplate(t.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      templateId === t.id
                        ? "border-kairo-blue bg-kairo-blue/5 ring-1 ring-kairo-blue dark:bg-kairo-blue/10"
                        : "border-line hover:border-line-strong hover:bg-accent-soft",
                    )}
                  >
                    <span
                      className={`h-3 w-3 shrink-0 rounded-full border-2 transition-colors ${
                        templateId === t.id
                          ? "border-kairo-blue bg-kairo-blue"
                          : "border-line-strong"
                      }`}
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">{t.name}</span>
                      <span className="block text-xs text-muted">{t.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <Button className="w-full justify-center" onClick={compile} disabled={busy}>
              {busy ? (
                <>
                  <Spinner className="size-4" /> Compiling PDF…
                </>
              ) : (
                "Generate Resume"
              )}
            </Button>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap font-mono dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}
          </div>
        </Card>

        {artifact && (
          <Card className="p-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Last Compiled PDF</h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted">Pages</span>
                <span className="font-medium text-ink">{artifact.pageCount ?? "Unknown"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Compiled</span>
                <span className="font-medium text-ink">
                  {artifact.compiledAt ? fmtAgo(artifact.compiledAt) : "Unknown"}
                </span>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Button size="sm" variant="secondary" onClick={openPdf} className="w-full justify-center">
                <ExternalLink className="size-3.5" /> Open in external viewer
              </Button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void ipc
                      .savePdfToDownloads(artifact.pdfPath)
                      .then((p) => toast.ok(`Saved to Downloads: ${p}`))
                      .catch((e) => toast.error(String(e)))
                  }
                  className="flex flex-1 items-center justify-center gap-1 rounded border border-line bg-accent-soft py-1 text-[11px] font-medium text-ink hover:bg-accent-soft/80"
                >
                  <HardDriveDownload className="size-3.5" /> Downloads
                </button>
                <button
                  type="button"
                  onClick={() => void ipc.revealFile(artifact.pdfPath).catch((e) => toast.error(String(e)))}
                  className="flex flex-1 items-center justify-center gap-1 rounded border border-line bg-accent-soft py-1 text-[11px] font-medium text-ink hover:bg-accent-soft/80"
                >
                  <FolderOpen className="size-3.5" /> Folder
                </button>
              </div>
            </div>
            <p className="mt-2 truncate font-mono text-[10px] text-muted/80 select-all" title={artifact.pdfPath}>
              {artifact.pdfPath}
            </p>
          </Card>
        )}
      </div>

      {/* Right column — PDF preview */}
      <div className="w-full lg:w-2/3">
        {artifact ? (
          <PdfViewer pdfPath={artifact.pdfPath} className="w-full" />
        ) : (
          <Card className="flex min-h-[600px] items-center justify-center overflow-hidden bg-accent-soft p-0">
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card shadow-sm">
                <FileText className="size-7 text-muted/60" />
              </div>
              <div>
                <p className="text-sm font-medium text-ink">No PDF generated yet</p>
                <p className="mt-1 text-xs text-muted">
                  Select a template and click <span className="font-medium">Generate Resume</span>
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
