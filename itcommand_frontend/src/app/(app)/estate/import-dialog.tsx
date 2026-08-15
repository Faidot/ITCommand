"use client";

/**
 * Bulk import: download a template, fill it, check it, import it.
 *
 * The check step is shown as its own stage rather than folded into the upload,
 * because the thing people need is confidence *before* anything is written.
 * The report lists every bad row at once — fixing a spreadsheet one error per
 * upload would be miserable — and the Import button stays disabled until the
 * sheet is clean, so a partial import is not a state anyone can reach.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface ColumnInfo {
  name: string;
  help: string;
  required: boolean;
  choices: string[];
}

interface Resource {
  key: string;
  label: string;
  notes: string;
  /** Record types this sheet may bring into existence as a side effect. */
  creates: string[];
  columns: ColumnInfo[];
}

interface RowReport {
  row: number;
  action: "create" | "update";
  errors: string[];
  summary: string;
}

interface Report {
  sheet_errors: string[];
  /** Exactly what a master sheet will create, deduplicated across rows. */
  will_create: string[];
  rows: RowReport[];
  total: number;
  valid: number;
  invalid: number;
  to_create: number;
  to_update: number;
  can_commit: boolean;
  created?: number;
  updated?: number;
}

function errorText(reason: unknown, fallback: string): string {
  const detail = (reason as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || fallback;
}

export function EstateImportDialog({
  open,
  onOpenChange,
  onImported,
  defaultResource = "master",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
  defaultResource?: string;
}) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [resource, setResource] = useState(defaultResource);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<"" | "template" | "validate" | "commit">("");
  const fileInput = useRef<HTMLInputElement>(null);

  const active = resources.find((r) => r.key === resource);

  useEffect(() => {
    if (!open) return;
    api.get<{ resources: Resource[] }>("/estate/import/options/")
      .then((r) => setResources(r.data.resources))
      .catch(() => toast.error("Only an admin can bulk import."));
  }, [open]);

  // Changing the resource invalidates a report built from the previous sheet.
  const pick = useCallback((next: string) => {
    setResource(next);
    setFile(null);
    setReport(null);
    if (fileInput.current) fileInput.current.value = "";
  }, []);

  const downloadTemplate = async () => {
    setBusy("template");
    try {
      const res = await api.get(`/estate/import/template/?resource=${resource}`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `estate-${resource}-template.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      toast.error(errorText(reason, "Could not build that template."));
    } finally {
      setBusy("");
    }
  };

  const send = async (step: "validate" | "commit") => {
    if (!file) return;
    setBusy(step);
    try {
      const body = new FormData();
      body.append("resource", resource);
      body.append("file", file);
      const res = await api.post<Report>(`/estate/import/${step}/`, body);
      setReport(res.data);
      if (step === "commit") {
        toast.success(
          `Imported ${res.data.created ?? 0} new and updated ${res.data.updated ?? 0}.`,
        );
        onImported?.();
        onOpenChange(false);
      }
    } catch (reason) {
      const data = (reason as { response?: { data?: Report } })?.response?.data;
      // A rejected commit still carries the row report — showing it beats a
      // toast that says "it failed" and nothing about which row.
      if (data?.rows) setReport(data);
      toast.error(errorText(reason, "That sheet could not be imported."));
    } finally {
      setBusy("");
    }
  };

  const reset = () => {
    setFile(null);
    setReport(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Bulk import
          </DialogTitle>
          <DialogDescription>
            Download the template, fill it in, then upload it. Nothing is saved
            until the whole sheet passes — one bad row stops all of it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          {/* 1 — what */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              1 · What are you importing?
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={resource} onValueChange={pick}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {resources.map((r) => (
                    <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={downloadTemplate} disabled={busy !== ""}>
                {busy === "template"
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Download className="mr-2 h-4 w-4" />}
                Download template
              </Button>
            </div>
            {active?.notes && (
              <p className="text-xs text-muted-foreground">{active.notes}</p>
            )}
            {active?.creates?.length ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Creates missing {active.creates.join(", ").toLowerCase()} as it goes.
                Check the list before importing — a misspelled name makes a new
                record rather than matching the existing one.
              </p>
            ) : null}
            {active && (
              <div className="flex flex-wrap gap-1 pt-1">
                {active.columns.map((c) => (
                  <Badge
                    key={c.name}
                    variant="outline"
                    title={c.help}
                    className={c.required ? "border-primary/50 text-primary" : "text-muted-foreground"}
                  >
                    {c.name}{c.required ? " *" : ""}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* 2 — upload */}
          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              2 · Upload the filled sheet
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setReport(null);
                }}
                className="block w-full max-w-sm text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
              />
              {file && (
                <Button variant="ghost" size="sm" onClick={reset}>
                  <X className="mr-1 h-4 w-4" /> Clear
                </Button>
              )}
            </div>
            <Button onClick={() => void send("validate")} disabled={!file || busy !== ""}>
              {busy === "validate"
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Check the sheet
            </Button>
          </div>

          {/* 3 — report */}
          {report && (
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                3 · Result
              </p>

              {report.sheet_errors.length > 0 && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
                  {report.sheet_errors.map((e, i) => (
                    <p key={i} className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {e}
                    </p>
                  ))}
                </div>
              )}

              {report.total > 0 && (
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="outline">{report.total} rows</Badge>
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                    {report.to_create} new
                  </Badge>
                  <Badge variant="outline" className="border-sky-300 text-sky-700">
                    {report.to_update} updated
                  </Badge>
                  {report.invalid > 0 && (
                    <Badge variant="destructive">{report.invalid} with problems</Badge>
                  )}
                </div>
              )}

              {report.invalid > 0 && (
                <ScrollArea className="h-56 rounded-lg border">
                  <div className="divide-y">
                    {report.rows.filter((r) => r.errors.length).map((r) => (
                      <div key={r.row} className="p-2.5">
                        <p className="text-xs font-semibold">
                          Row {r.row}
                          {r.summary && <span className="font-normal text-muted-foreground"> · {r.summary}</span>}
                        </p>
                        {r.errors.map((e, i) => (
                          <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {report.will_create.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="mb-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
                    Will also create {report.will_create.length} new record
                    {report.will_create.length === 1 ? "" : "s"}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {report.will_create.map((item) => (
                      <Badge key={item} variant="outline" className="font-normal">
                        {item}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {report.can_commit ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <p className="flex-1 text-sm">
                    Every row is valid. {report.to_create} will be created and{" "}
                    {report.to_update} updated.
                  </p>
                  <Button onClick={() => void send("commit")} disabled={busy !== ""}>
                    {busy === "commit"
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Upload className="mr-2 h-4 w-4" />}
                    Import
                  </Button>
                </div>
              ) : (
                report.total > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nothing has been imported. Fix the rows above in your sheet and
                    upload it again.
                  </p>
                )
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
