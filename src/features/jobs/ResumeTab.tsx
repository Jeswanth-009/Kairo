import { useState, useEffect } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ipc } from "../../lib/ipc";
import { toast } from "../../stores/toastStore";
import type { PdfArtifact } from "../../lib/types";
import { convertFileSrc } from "@tauri-apps/api/core";

export function ResumeTab({ jobId }: { jobId: number }) {
  const [templateId, setTemplateId] = useState<string>("classic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<PdfArtifact | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    // Load existing artifact on mount if available
    ipc
      .getPdfArtifact(jobId)
      .then((a) => {
        if (a) {
          setArtifact(a);
          setPdfUrl(convertFileSrc(a.pdfPath));
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
      setPdfUrl(convertFileSrc(res.artifact.pdfPath));
      toast.ok("Resume compiled successfully");
    } catch (e) {
      setError(String(e));
      toast.error("Compilation failed");
    } finally {
      setBusy(false);
    }
  };

  const templates = [
    { id: "classic", name: "Classic", desc: "Traditional ATS-friendly layout" },
    { id: "minimal", name: "Minimal", desc: "Clean and modern sans-serif" },
    { id: "modern", name: "Modern", desc: "Elegant serif with accented headers" },
  ];

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex w-full flex-col gap-4 lg:w-1/3">
        <Card className="p-6">
          <h3 className="mb-4 text-sm font-semibold text-ink">Resume Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-700">Template</label>
              <div className="flex flex-col gap-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
                      templateId === t.id
                        ? "border-kairo-blue bg-blue-50/50 ring-1 ring-kairo-blue"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-sm font-medium text-ink">{t.name}</span>
                    <span className="text-xs text-muted">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <Button className="w-full justify-center" onClick={compile} disabled={busy}>
              {busy ? "Compiling PDF..." : "Generate Resume"}
            </Button>

            {error && (
              <div className="rounded bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap font-mono">
                {error}
              </div>
            )}
          </div>
        </Card>

        {artifact && (
          <Card className="p-6">
            <h3 className="mb-2 text-sm font-semibold text-ink">Artifact Details</h3>
            <div className="space-y-1 text-xs text-muted">
              <p>Pages: {artifact.pageCount ?? "Unknown"}</p>
              <p>Compiled: {artifact.compiledAt ? new Date(artifact.compiledAt + "Z").toLocaleString() : "Unknown"}</p>
              <p className="mt-4 truncate" title={artifact.pdfPath}>
                Path: {artifact.pdfPath}
              </p>
            </div>
          </Card>
        )}
      </div>

      <div className="w-full lg:w-2/3">
        <Card className="flex min-h-[800px] items-center justify-center overflow-hidden bg-slate-100 p-0 shadow-inner">
          {pdfUrl ? (
            <iframe src={`${pdfUrl}#toolbar=0`} className="h-[800px] w-full border-0" title="Resume PDF Preview" />
          ) : (
            <div className="text-center text-slate-400">
              <p className="mb-2 text-sm">No PDF generated yet</p>
              <p className="text-xs">Select a template and click Generate Resume</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
