"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SubscriptionSettings } from "./subscription-types";

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

function errText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || fallback;
}

const DEFAULTS: SubscriptionSettings = {
  notifications_enabled: true,
  notify_owners: true,
  default_renewal_reminder_days: 30,
  default_cancellation_reminder_days: 7,
  monthly_budget_threshold: null,
  yearly_budget_threshold: null,
  budget_currency: "USD",
  create_expense_on_renewal: false,
};

interface CategoryBudget {
  category: string;
  category_label: string;
  monthly_threshold: string | null;
  yearly_threshold: string | null;
}

/**
 * Company-wide subscription alert defaults and spend-budget thresholds.
 * Self-loading so it can be opened from anywhere (Finance → Budget).
 */
export function SubscriptionSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<SubscriptionSettings>(DEFAULTS);
  const [catBudgets, setCatBudgets] = useState<CategoryBudget[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    Promise.all([
      api.get("/subscriptions/settings/").then((r) => setDraft({ ...DEFAULTS, ...r.data })),
      api.get("/subscriptions/category-budgets/").then((r) => setCatBudgets(r.data.budgets || [])),
    ])
      .catch(() => toast.error("Could not load alert settings."))
      .finally(() => setLoaded(true));
  }, [open]);

  const setCat = (category: string, field: "monthly_threshold" | "yearly_threshold", value: string) =>
    setCatBudgets((prev) => prev.map((b) => (b.category === category ? { ...b, [field]: value === "" ? null : value } : b)));

  const save = async () => {
    if (
      !Number.isInteger(draft.default_renewal_reminder_days) || draft.default_renewal_reminder_days < 0
      || !Number.isInteger(draft.default_cancellation_reminder_days) || draft.default_cancellation_reminder_days < 0
    ) {
      toast.error("Reminder days must be whole numbers of zero or greater.");
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(draft.budget_currency.trim())) {
      toast.error("Budget currency must be a 3-letter currency code.");
      return;
    }
    if (
      (draft.monthly_budget_threshold !== null && draft.monthly_budget_threshold <= 0)
      || (draft.yearly_budget_threshold !== null && draft.yearly_budget_threshold <= 0)
    ) {
      toast.error("Budget thresholds must be greater than zero, or left blank to disable.");
      return;
    }
    setSaving(true);
    try {
      await api.patch("/subscriptions/settings/", { ...draft, budget_currency: draft.budget_currency.toUpperCase() });
      await api.put("/subscriptions/category-budgets/", { budgets: catBudgets });
      toast.success("Alerts and budget thresholds updated.");
      onSaved?.();
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(errText(error, "Could not save settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Alerts &amp; budget thresholds</DialogTitle>
          <DialogDescription>
            Set defaults for new subscriptions and company-wide spend alerts. Existing records keep their own reminder timing.
          </DialogDescription>
        </DialogHeader>
        <div className={`space-y-5 py-2 overflow-y-auto pr-1 ${loaded ? "" : "opacity-60 pointer-events-none"}`}>
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="settings-notifications">In-app notifications</Label>
                <p className="text-xs text-muted-foreground">Create in-app alerts when reminders or budgets are due.</p>
              </div>
              <Switch id="settings-notifications" checked={draft.notifications_enabled} onCheckedChange={(checked) => setDraft((c) => ({ ...c, notifications_enabled: checked }))} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="settings-notify-owner">Notify owners</Label>
                <p className="text-xs text-muted-foreground">Include owners who have permission to view the Subscriptions module.</p>
              </div>
              <Switch id="settings-notify-owner" checked={draft.notify_owners} onCheckedChange={(checked) => setDraft((c) => ({ ...c, notify_owners: checked }))} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="settings-renewal-days">Default renewal reminder</Label>
              <div className="relative">
                <Input id="settings-renewal-days" type="number" min="0" step="1" value={draft.default_renewal_reminder_days} onChange={(e) => setDraft((c) => ({ ...c, default_renewal_reminder_days: num(e.target.value) }))} className="pr-14" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">days</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settings-cancellation-days">Default cancellation reminder</Label>
              <div className="relative">
                <Input id="settings-cancellation-days" type="number" min="0" step="1" value={draft.default_cancellation_reminder_days} onChange={(e) => setDraft((c) => ({ ...c, default_cancellation_reminder_days: num(e.target.value) }))} className="pr-14" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">days</span>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border p-4">
            <div>
              <p className="font-medium">Budget threshold alerts</p>
              <p className="text-xs text-muted-foreground">Leave a threshold blank to disable that alert.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[110px_1fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="settings-budget-currency">Currency</Label>
                <Input id="settings-budget-currency" maxLength={3} value={draft.budget_currency} onChange={(e) => setDraft((c) => ({ ...c, budget_currency: e.target.value.toUpperCase() }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-monthly-budget">Monthly threshold</Label>
                <Input id="settings-monthly-budget" type="number" min="0.01" step="0.01" value={draft.monthly_budget_threshold ?? ""} onChange={(e) => setDraft((c) => ({ ...c, monthly_budget_threshold: e.target.value === "" ? null : num(e.target.value) }))} placeholder="No limit" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-yearly-budget">Yearly threshold</Label>
                <Input id="settings-yearly-budget" type="number" min="0.01" step="0.01" value={draft.yearly_budget_threshold ?? ""} onChange={(e) => setDraft((c) => ({ ...c, yearly_budget_threshold: e.target.value === "" ? null : num(e.target.value) }))} placeholder="No limit" />
              </div>
            </div>
          </div>

          {/* Finance linkage. Deliberately its own block with a warning tone:
              this is the only switch in the app that lets one module write into
              the finance ledger. */}
          <div className="space-y-3 rounded-xl border border-amber-300 p-4 dark:border-amber-900">
            <div>
              <p className="font-medium">Finance</p>
              <p className="text-xs text-muted-foreground">
                Whether renewals reach the ledger on their own.
              </p>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="settings-expense-on-renewal" className="text-sm">
                  Raise a pending expense when a renewal is recorded
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Books against the subscription&apos;s budget category and the active
                  financial year. Created as <strong>pending</strong>, so it does not
                  consume budget until somebody approves it. Skipped — with a reason —
                  when there is no category, no active financial year, or no exchange
                  rate for the subscription&apos;s currency.
                </p>
              </div>
              <Switch
                id="settings-expense-on-renewal"
                checked={draft.create_expense_on_renewal}
                onCheckedChange={(checked) =>
                  setDraft((c) => ({ ...c, create_expense_on_renewal: checked }))
                }
              />
            </div>
          </div>

          {/* Per-category budgets */}
          <div className="space-y-3 rounded-xl border p-4">
            <div>
              <p className="font-medium">Category budgets</p>
              <p className="text-xs text-muted-foreground">
                Allocate a monthly / yearly limit per category, in {draft.budget_currency}. Blank = no limit.
              </p>
            </div>
            <div className="grid grid-cols-[1fr_100px_100px] gap-2 text-[11px] uppercase tracking-wider text-muted-foreground px-1">
              <span>Category</span><span>Monthly</span><span>Yearly</span>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {catBudgets.map((b) => (
                <div key={b.category} className="grid grid-cols-[1fr_100px_100px] gap-2 items-center">
                  <span className="text-sm truncate">{b.category_label}</span>
                  <Input
                    type="number" min="0.01" step="0.01" className="h-8"
                    value={b.monthly_threshold ?? ""} placeholder="—"
                    onChange={(e) => setCat(b.category, "monthly_threshold", e.target.value)}
                  />
                  <Input
                    type="number" min="0.01" step="0.01" className="h-8"
                    value={b.yearly_threshold ?? ""} placeholder="—"
                    onChange={(e) => setCat(b.category, "yearly_threshold", e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !loaded}>{saving ? "Saving…" : "Save alert settings"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
