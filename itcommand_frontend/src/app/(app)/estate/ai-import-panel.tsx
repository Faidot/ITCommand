"use client";

/**
 * Paste rough notes; Gemini reads them into rows you review before importing.
 *
 * The flow is deliberately three stops rather than one button: **read →
 * answer → review**. The model is allowed to be unsure, and when it is, it
 * asks instead of inventing a value — because a wrong renewal date imported
 * silently is far worse than a question on screen.
 *
 * Nothing is written until Import. The rows go through the same validator an
 * uploaded spreadsheet does, so what you see here is what the importer already
 * agreed to accept.
 */

import { useState } from "react";
import {
  AlertTriangle, CheckCircle2, HelpCircle, Loader2, Sparkles, Upload,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

interface Question {
  id: string;
  ask: string;
  why: string;
}

interface RowReport {
  row: number;
  action: "create" | "update";
  errors: string[];
  summary: string;
}

interface ParseResult {
  rows: RowReport[];
  records: Record<string, string>[];
  questions: Question[];
  assumptions: string[];
  will_create: string[];
  sheet_errors: string[];
  total: number;
  invalid: number;
  to_create: number;
  to_update: number;
  can_commit: boolean;
  created?: number;
  updated?: number;
}

function errorText(reason: unknown, fallback: string) {
  const detail = (reason as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || fallback;
}

export function AiImportPanel({ onImported }: { onImported?: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "parse" | "commit">("");

  const parse = async () => {
    setBusy("parse");
    try {
      // Answers are keyed by the question text rather than its id, because the
      // model is re-reading the notes with them appended — it never sees ids.
      const asked = Object.fromEntries(
        (result?.questions ?? [])
          .map((q) => [q.ask, answers[q.id] ?? ""])
          .filter(([, value]) => value),
      );
      const res = await api.post<ParseResult>("/estate/import/ai/parse/", {
        text,
        answers: asked,
      });
      setResult(res.data);
      if (res.data.questions.length) {
        toast.info(`${res.data.questions.length} question(s) before this can be imported.`);
      }
    } catch (reason) {
      toast.error(errorText(reason, "Could not read those notes."));
    } finally {
      setBusy("");
    }
  };

  const commit = async () => {
    if (!result) return;
    setBusy("commit");
    try {
      const res = await api.post<ParseResult>("/estate/import/ai/commit/", {
        records: result.records,
      });
      toast.success(`Imported ${res.data.created ?? 0} new, updated ${res.data.updated ?? 0}.`);
      setText("");
      setResult(null);
      setAnswers({});
      onImported?.();
    } catch (reason) {
      const data = (reason as { response?: { data?: ParseResult } })?.response?.data;
      if (data?.rows) setResult({ ...result, ...data });
      toast.error(errorText(reason, "Nothing was imported."));
    } finally {
      setBusy("");
    }
  };

  const unanswered = (result?.questions ?? []).filter((q) => !answers[q.id]?.trim());

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          1 · Paste whatever you have
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={
            "Anything goes — an invoice, a renewals email, handover notes:\n\n" +
            "envato elements $33/mo on design@company.com\n" +
            "cloudflare pro for terafort.com, £20 a month, renews 3 Jan\n" +
            "figma org 8 seats — ask Sam who owns it"
          }
          className="font-mono text-xs"
        />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          This text is sent to Google Gemini to be read. Do not paste passwords
          or API keys — nothing else from this system is sent, and no vault
          entry ever leaves it.
        </p>
        <Button onClick={() => void parse()} disabled={busy !== "" || !text.trim()}>
          {busy === "parse"
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <Sparkles className="mr-2 h-4 w-4" />}
          {result ? "Read again" : "Read the notes"}
        </Button>
      </div>

      {result && (
        <>
          {result.questions.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                2 · It needs to ask
              </p>
              <p className="text-xs text-muted-foreground">
                It stopped rather than guessing. Answer these and read again — a
                wrong value imported quietly is worse than a question here.
              </p>
              {result.questions.map((q) => (
                <div key={q.id} className="rounded-lg border bg-muted/30 p-2.5">
                  <p className="flex items-start gap-1.5 text-sm font-medium">
                    <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {q.ask}
                  </p>
                  {q.why && <p className="mb-1.5 pl-5.5 text-xs text-muted-foreground">{q.why}</p>}
                  <Input
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    placeholder="Your answer"
                    className="mt-1 h-8 text-sm"
                    onKeyDown={(e) => e.key === "Enter" && !unanswered.length && void parse()}
                  />
                </div>
              ))}
            </div>
          )}

          {result.assumptions.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="mb-1 text-xs font-semibold text-amber-900 dark:text-amber-200">
                It inferred these — worth checking
              </p>
              <ul className="list-inside list-disc text-xs text-amber-900 dark:text-amber-200">
                {result.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              3 · Review
            </p>

            {result.total === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing it could turn into a row yet.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="outline">{result.total} rows</Badge>
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                    {result.to_create} new
                  </Badge>
                  {result.to_update > 0 && (
                    <Badge variant="outline" className="border-sky-300 text-sky-700">
                      {result.to_update} updated
                    </Badge>
                  )}
                  {result.invalid > 0 && (
                    <Badge variant="destructive">{result.invalid} with problems</Badge>
                  )}
                </div>

                <ScrollArea className="h-52 rounded-lg border">
                  <div className="divide-y">
                    {result.rows.map((r) => (
                      <div key={r.row} className="p-2.5">
                        <p className="text-xs">
                          <span className="font-semibold">Row {r.row}</span>
                          {r.summary && <span className="text-muted-foreground"> · {r.summary}</span>}
                        </p>
                        {r.errors.map((e, i) => (
                          <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {result.will_create.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                    <p className="mb-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
                      Will also create {result.will_create.length} new record
                      {result.will_create.length === 1 ? "" : "s"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {result.will_create.map((item) => (
                        <Badge key={item} variant="outline" className="font-normal">{item}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {result.can_commit ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    <p className="flex-1 text-sm">
                      {unanswered.length > 0
                        ? `Every row is valid, but ${unanswered.length} question is unanswered. Answering it may change the result.`
                        : "Every row is valid."}
                    </p>
                    <Button onClick={() => void commit()} disabled={busy !== ""}>
                      {busy === "commit"
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <Upload className="mr-2 h-4 w-4" />}
                      Import
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nothing has been imported. Answer the questions above, or fix
                    the notes and read them again.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
