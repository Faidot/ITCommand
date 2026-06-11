"use client";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export type DetailField = {
  label: string;
  value: React.ReactNode;
  /** Render value across the full width (e.g. long text). */
  full?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  fields: DetailField[];
  footer?: React.ReactNode;
};

export function DetailDialog({ open, onOpenChange, title, subtitle, fields, footer }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle && <p className="text-sm text-neutral-500">{subtitle}</p>}
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 py-2">
          {fields.map((f, i) => (
            <div key={i} className={f.full ? "col-span-2" : ""}>
              <div className="text-xs uppercase tracking-wide text-neutral-400">{f.label}</div>
              <div className="text-sm font-medium break-words">{f.value ?? "—"}</div>
            </div>
          ))}
        </div>
        {footer && <div className="pt-2 border-t">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
