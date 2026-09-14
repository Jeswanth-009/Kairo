import { useState, useEffect } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ipc } from "../../lib/ipc";
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
        if (a) {
          setArtifact(a);
        }
      })
      .catch(console.error);
  }, [jobId]);

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
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Template
              </label>
              <div className="flex flex-col gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      templateId === t.id
                        ? "border-kairo-blue bg-kairo-blue/5 ring-1 ring-kairo-blue"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`h-3 w-3 shrink-0 rounded-full border-2 transition-colors ${
                        templateId === t.id
                          ? "border-kairo-blue bg-kairo-blue"
                          : "border-slate-300"
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
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Compiling PDF…
                </span>
              ) : (
                "Generate Resume"
              )}
            </Button>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap font-mono">
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
                  {artifact.compiledAt
                    ? new Date(artifact.compiledAt + "Z").toLocaleString()
                    : "Unknown"}
                </span>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Button size="sm" variant="secondary" onClick={openPdf} className="w-full justify-center">
                Open in external viewer ↗
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
                  className="flex-1 rounded border border-slate-200 bg-slate-50 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                >
                  💾 Downloads
                </button>
                <button
                  type="button"
                  onClick={() => void ipc.revealFile(artifact.pdfPath).catch((e) => toast.error(String(e)))}
                  className="flex-1 rounded border border-slate-200 bg-slate-50 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                >
                  📂 Folder
                </button>
              </div>
            </div>
            <p className="mt-2 truncate text-[10px] text-slate-400 font-mono select-all" title={artifact.pdfPath}>
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
          <Card className="flex min-h-[600px] items-center justify-center overflow-hidden bg-slate-50 p-0 shadow-inner">
            <div className="flex flex-col items-center gap-3 text-center p-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                <svg className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600">No PDF generated yet</p>
                <p className="mt-1 text-xs text-slate-400">
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
