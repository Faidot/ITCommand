"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tag, Search, ArrowLeft } from "lucide-react";
import api from "@/lib/api";
import { useMoney } from "@/lib/currency";
import type { Asset, AssetCategory, SpecField } from "./page";

/** A labelled attribute pulled from an asset for the comparison matrix. */
interface Row {
  label: string;
  get: (a: Asset) => string;
}

function fmtDate(v?: string | null) {
  return v ? new Date(v).toLocaleDateString() : "—";
}

/**
 * Pick assets from a list, then compare them side by side. Opens on the picker
 * so there's no "add one at a time" step — search, tick 2+, hit Compare. The
 * matrix fetches each asset's full detail (computed financials + specs) and
 * flags rows whose values differ across the selected assets.
 */
export function AssetCompareDialog({
  open,
  onOpenChange,
  allAssets,
  categories,
  initialIds = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allAssets: Asset[];
  categories: AssetCategory[];
  initialIds?: number[];
}) {
  const formatMoneyFor = useMoney();
  const [view, setView] = useState<"pick" | "compare">("pick");
  const [picked, setPicked] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  const money = (v?: string | null) => (v == null || v === "" ? "—" : formatMoneyFor(Number(v)));

  // Reset to the picker each time the dialog opens, seeded with any initial ids.
  useEffect(() => {
    if (open) {
      setPicked(initialIds);
      setView("pick");
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allAssets;
    return allAssets.filter((a) =>
      [a.asset_tag, a.name, a.brand, a.model, a.serial_number, a.category_name]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }, [allAssets, search]);

  const startCompare = () => {
    if (picked.length < 2) return;
    setView("compare");
    setLoading(true);
    Promise.all(picked.map((id) => api.get(`/assets/${id}/`).then((r) => r.data as Asset)))
      .then((rows) => setAssets(rows))
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  };

  const catName = (a: Asset) => a.category_name || categories.find((c) => c.id === a.category)?.name || "—";

  const overview: Row[] = [
    { label: "Asset tag", get: (a) => a.asset_tag || "—" },
    { label: "Type", get: (a) => a.asset_type || "—" },
    { label: "Category", get: catName },
    { label: "Status", get: (a) => a.status || "—" },
    { label: "Condition", get: (a) => a.condition || "—" },
    { label: "Brand", get: (a) => a.brand || "—" },
    { label: "Model", get: (a) => a.model || "—" },
    { label: "Serial number", get: (a) => a.serial_number || "—" },
    { label: "Location", get: (a) => a.location || "—" },
    { label: "Vendor", get: (a) => a.vendor_name || "—" },
    {
      label: "Assignment",
      get: (a) =>
        a.is_bulk
          ? `${a.quantity_assigned ?? 0}/${a.quantity_total ?? 1} assigned`
          : a.assigned_user_name || "Unassigned",
    },
  ];

  const financials: Row[] = [
    { label: "Purchase date", get: (a) => fmtDate(a.purchase_date) },
    { label: "Purchase price", get: (a) => money(a.purchase_price) },
    { label: "Unit price", get: (a) => money(a.unit_price) },
    { label: "Book value", get: (a) => money(a.current_book_value) },
    { label: "Depreciation / mo", get: (a) => money(a.monthly_depreciation) },
    { label: "Accumulated depr.", get: (a) => money(a.accumulated_depreciation) },
    { label: "Months in service", get: (a) => String(a.months_in_service ?? "—") },
    { label: "Maintenance cost", get: (a) => money(a.total_maintenance_cost) },
    { label: "Total cost of ownership", get: (a) => money(a.total_cost_of_ownership) },
  ];

  const warranty: Row[] = [
    { label: "Warranty expiry", get: (a) => fmtDate(a.warranty_expiry) },
    {
      label: "Warranty status",
      get: (a) =>
        a.warranty_status
          ? a.days_until_warranty_expiry != null && a.warranty_status !== "EXPIRED"
            ? `${a.warranty_status.replace("_", " ")} (${a.days_until_warranty_expiry}d)`
            : a.warranty_status.replace("_", " ")
          : "No warranty",
    },
  ];

  // Union of spec keys across the compared assets, labelled from category schemas.
  const specLabels: Record<string, string> = {};
  const specKeys: string[] = [];
  for (const a of assets) {
    const schema: SpecField[] = categories.find((c) => c.id === a.category)?.spec_schema || [];
    for (const f of schema) {
      if (!(f.key in specLabels)) { specLabels[f.key] = f.label; specKeys.push(f.key); }
    }
    const data = ((a as any).specs as Record<string, any>) || {};
    for (const k of Object.keys(data)) {
      if (!(k in specLabels)) { specLabels[k] = k; specKeys.push(k); }
    }
  }
  const specRows: Row[] = specKeys.map((k) => ({
    label: specLabels[k],
    get: (a) => {
      const v = ((a as any).specs as Record<string, any>)?.[k];
      return v == null || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
    },
  }));

  const differs = (row: Row) => {
    const first = assets[0] ? row.get(assets[0]) : "";
    return assets.some((a) => row.get(a) !== first);
  };

  const gridCols = { gridTemplateColumns: `minmax(150px, 1fr) repeat(${assets.length}, minmax(140px, 1fr))` };

  const renderGroup = (title: string, rows: Row[]) => {
    if (rows.length === 0) return null;
    return (
      <div className="mb-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{title}</div>
        <div className="rounded-lg border overflow-hidden">
          {rows.map((row, i) => {
            const diff = differs(row);
            return (
              <div key={row.label} className={`grid gap-0 text-sm ${i % 2 ? "bg-muted/30" : ""}`} style={gridCols}>
                <div className={`px-3 py-2 border-r flex items-center gap-1.5 ${diff ? "font-medium" : "text-muted-foreground"}`}>
                  {diff && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Differs" />}
                  {row.label}
                </div>
                {assets.map((a) => (
                  <div key={a.id} className={`px-3 py-2 border-r last:border-r-0 tabular-nums ${diff ? "font-medium" : ""}`}>
                    {row.get(a)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[min(96vw,1100px)] max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view === "compare" && (
              <button onClick={() => setView("pick")} className="text-muted-foreground hover:text-foreground" aria-label="Back to selection">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {view === "pick" ? "Select assets to compare" : `Comparing ${assets.length || picked.length} assets`}
          </DialogTitle>
        </DialogHeader>

        {view === "pick" ? (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tag, name, brand…" className="pl-9" />
            </div>
            <div className="flex-1 overflow-auto rounded-lg border divide-y min-h-[240px]">
              {filtered.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">No assets match.</p>
              ) : (
                filtered.map((a) => (
                  <label key={a.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                    <Checkbox checked={picked.includes(a.id)} onCheckedChange={() => toggle(a.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="flex items-center gap-1 text-[11px] text-blue-600 font-mono">
                        <Tag className="w-3 h-3" /> {a.asset_tag}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground truncate max-w-[120px]">{a.category_name || a.asset_type}</span>
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-muted-foreground">{picked.length} selected</span>
              <div className="flex gap-2">
                {picked.length > 0 && <Button variant="ghost" onClick={() => setPicked([])}>Clear</Button>}
                <Button className="bg-violet-600 hover:bg-violet-700" disabled={picked.length < 2} onClick={startCompare}>
                  Compare {picked.length >= 2 ? `(${picked.length})` : ""}
                </Button>
              </div>
            </div>
          </>
        ) : loading ? (
          <div className="py-16 text-center text-muted-foreground">Loading assets…</div>
        ) : assets.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">Nothing to compare.</div>
        ) : (
          <div className="flex-1 overflow-auto pr-1">
            {/* Asset header row */}
            <div className="grid gap-0 sticky top-0 z-10 bg-background pb-2 mb-3 border-b" style={gridCols}>
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground self-end">Attribute</div>
              {assets.map((a) => (
                <div key={a.id} className="px-3 py-2">
                  <div className="font-semibold leading-tight">{a.name}</div>
                  <div className="flex items-center gap-1 text-[11px] text-blue-600 font-mono mt-0.5">
                    <Tag className="w-3 h-3" /> {a.asset_tag}
                  </div>
                  <Badge variant="outline" className="mt-1 text-[10px]">{a.asset_type}</Badge>
                </div>
              ))}
            </div>

            {renderGroup("Overview", overview)}
            {renderGroup("Financials", financials)}
            {renderGroup("Warranty", warranty)}
            {renderGroup("Specifications", specRows)}

            <p className="text-[11px] text-muted-foreground mt-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle mr-1" />
              Rows marked with a dot differ between the selected assets.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
