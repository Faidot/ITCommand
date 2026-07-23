"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import QRCode from "react-qr-code";
import { useSettingsStore } from "@/store/settingsStore";

export interface LabelAsset {
  id: number;
  asset_tag: string;
  name: string;
  category_name?: string;
}

/**
 * Printable asset-tag labels — one or many. Each label carries a QR code of the
 * asset tag (scannable by any phone), the tag in large monospace, the asset
 * name and category. Printing uses a scoped @media print rule so only the label
 * grid reaches the page, not the app chrome or the dialog backdrop.
 */
export function AssetLabelSheet({
  open,
  onOpenChange,
  assets,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assets: LabelAsset[];
}) {
  const companyName = useSettingsStore((s) => s.company_name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Print {assets.length} asset {assets.length === 1 ? "tag" : "tags"}</DialogTitle>
        </DialogHeader>

        {/* Print-scoping rules: hide everything except the label sheet. */}
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            #asset-label-print, #asset-label-print * { visibility: visible !important; }
            #asset-label-print {
              position: fixed; inset: 0; margin: 0; padding: 8mm;
              background: #fff; z-index: 9999;
            }
            .asset-label { break-inside: avoid; page-break-inside: avoid; }
          }
        `}</style>

        <div className="flex-1 overflow-auto">
          <div
            id="asset-label-print"
            className="grid grid-cols-2 sm:grid-cols-3 gap-3"
          >
            {assets.map((a) => (
              <div
                key={a.id}
                className="asset-label border border-neutral-300 rounded-md p-3 flex items-center gap-3 bg-white text-black"
              >
                <div className="shrink-0 bg-white p-1 rounded">
                  <QRCode value={a.asset_tag || String(a.id)} size={64} style={{ height: 64, width: 64 }} />
                </div>
                <div className="min-w-0">
                  {companyName && (
                    <div className="text-[9px] uppercase tracking-wider text-neutral-500 truncate">{companyName}</div>
                  )}
                  <div className="font-mono font-bold text-sm leading-tight truncate">{a.asset_tag}</div>
                  <div className="text-[11px] leading-tight truncate">{a.name}</div>
                  {a.category_name && (
                    <div className="text-[10px] text-neutral-500 truncate">{a.category_name}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
