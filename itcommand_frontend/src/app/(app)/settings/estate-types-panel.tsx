"use client";

/**
 * Add service types and property kinds without a deploy.
 *
 * These already lived under Settings → List of Values, but nobody looking for
 * "how do I add a service type?" finds them there. This is the same data
 * through the estate's own settings, where the question is actually asked.
 *
 * The built-in codes are shown but not editable. Seven of the service types
 * are stack roles that gap analysis, the stack diagram and the dashboard all
 * branch on; letting somebody delete DNS would break those silently. Anything
 * added here is a category — billed and reported, never counted as a gap —
 * and the panel says so rather than leaving people to discover it.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Value {
  id: number;
  code: string;
  label: string;
  is_active: boolean;
  is_system: boolean;
}

const GROUPS = [
  {
    key: "subscription_category",
    title: "Service types",
    blurb:
      "What a service is. The seven stack roles are built in and count toward a property's gaps; anything you add is a category — tracked and billed, never counted as missing.",
  },
  {
    key: "estate_property_kind",
    title: "Property kinds",
    blurb: "What a digital property is — a game, an app, a marketing site.",
  },
] as const;

function errorText(reason: unknown, fallback: string) {
  const detail = (reason as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || fallback;
}

function GroupEditor({ group }: { group: (typeof GROUPS)[number] }) {
  const [values, setValues] = useState<Value[]>([]);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ values: Value[] }>(`/lov/?group=${group.key}&manage=1`);
      setValues(res.data.values ?? []);
    } catch {
      toast.error(`Could not load ${group.title.toLowerCase()}.`);
    }
  }, [group.key, group.title]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!code.trim() || !label.trim()) return;
    setBusy(true);
    try {
      // Uppercased with underscores because the code is stored on every row
      // and compared exactly; a stray space or case difference would read as
      // a different type forever.
      await api.post("/lov/", {
        group: group.key,
        code: code.trim().toUpperCase().replace(/\s+/g, "_"),
        label: label.trim(),
      });
      setCode("");
      setLabel("");
      await load();
      toast.success(`${label.trim()} added.`);
    } catch (reason) {
      toast.error(errorText(reason, "Could not add that value."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (value: Value) => {
    setBusy(true);
    try {
      await api.delete(`/lov/values/${value.id}/`);
      await load();
      toast.success(`${value.label} removed.`);
    } catch (reason) {
      toast.error(errorText(reason, "Could not remove that value."));
    } finally {
      setBusy(false);
    }
  };

  const custom = values.filter((v) => !v.is_system);
  const builtIn = values.filter((v) => v.is_system);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Tag className="h-4 w-4" /> {group.title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{group.blurb}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[150px] flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Code</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="PODCAST"
              className="font-mono uppercase"
            />
          </div>
          <div className="min-w-[180px] flex-[2] space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Label</label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Podcast hosting"
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
          </div>
          <Button onClick={() => void add()} disabled={busy || !code.trim() || !label.trim()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add
          </Button>
        </div>

        {custom.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Added by you
            </p>
            <div className="flex flex-wrap gap-1.5">
              {custom.map((v) => (
                <span
                  key={v.id}
                  className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 py-1 pl-2.5 pr-1 text-sm"
                >
                  <span className="font-medium">{v.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{v.code}</span>
                  <button
                    type="button"
                    onClick={() => void remove(v)}
                    disabled={busy}
                    title={`Remove ${v.label}`}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Built in
          </p>
          <div className="flex flex-wrap gap-1.5">
            {builtIn.map((v) => (
              <Badge key={v.id} variant="outline" className="font-normal text-muted-foreground">
                {v.label}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Built-in values cannot be deleted — the dashboard, gap analysis and
            spend totals branch on these codes. Rename or hide them under
            Settings → List of Values instead.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function EstateTypesPanel() {
  return (
    <div className="space-y-4">
      {GROUPS.map((g) => (
        <GroupEditor key={g.key} group={g} />
      ))}
    </div>
  );
}
