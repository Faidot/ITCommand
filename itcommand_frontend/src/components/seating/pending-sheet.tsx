"use client";

import {
  ArrowRight, CheckCircle2, Clock, MoveRight, Repeat, UserPlus, UserMinus, XCircle,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface PendingAssignment {
  id: number;
  status: string;
  change_type: "NEW" | "REPLACE" | "MOVE" | "VACATE";
  user: number | null;
  user_name: string | null;
  user_email: string | null;
  user_department: string | null;
  user_designation: string | null;
  seat: number;
  seat_code: string;
  seat_floor_name: string | null;
  seat_floor_id: number | null;
  seat_office_id: number | null;
  from_seat: number | null;
  from_seat_code: string | null;
  current_occupant_name: string | null;
  proposed_by_name: string | null;
  proposed_at: string | null;
  effective_date: string | null;
  notes: string;
}

const TYPE_META: Record<
  PendingAssignment["change_type"],
  { icon: React.ReactNode; label: string; color: string }
> = {
  NEW:     { icon: <UserPlus className="w-3.5 h-3.5" />,  label: "New",     color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  REPLACE: { icon: <Repeat   className="w-3.5 h-3.5" />,  label: "Replace", color: "bg-amber-100 text-amber-800 border-amber-200" },
  MOVE:    { icon: <MoveRight className="w-3.5 h-3.5" />, label: "Move",    color: "bg-blue-100 text-blue-800 border-blue-200" },
  VACATE:  { icon: <UserMinus className="w-3.5 h-3.5" />, label: "Vacate",  color: "bg-rose-100 text-rose-800 border-rose-200" },
};

export function PendingSheet({
  open, onOpenChange, items, onApprove, onReject, onJump,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: PendingAssignment[];
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  /** Open the floor that contains a particular pending change */
  onJump?: (item: PendingAssignment) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md w-[95vw] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" />
            Pending Seating Changes
            <Badge variant="outline" className="ml-1 text-[10px]">{items.length}</Badge>
          </SheetTitle>
          <SheetDescription>
            Proposed by HR/admins. Approve to apply or reject to discard. Live assignments
            are not affected until you approve.
          </SheetDescription>
        </SheetHeader>

        <div className="p-4 space-y-3">
          {items.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-neutral-500">
              No pending changes.
            </div>
          ) : (
            items.map((p) => {
              const t = TYPE_META[p.change_type];
              return (
                <div key={p.id} className="rounded-md border bg-white dark:bg-neutral-900 p-3 text-sm">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${t.color}`}>
                      {t.icon} {t.label}
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono">{p.seat_code}</Badge>
                    {p.seat_floor_name && (
                      <span className="text-[10px] text-neutral-400">{p.seat_floor_name}</span>
                    )}
                  </div>

                  {p.change_type === "VACATE" ? (
                    <div className="mt-2 flex items-center gap-1.5 text-[13px]">
                      <span className="font-medium">{p.user_name}</span>
                      <ArrowRight className="w-3 h-3 text-neutral-400" />
                      <span className="text-rose-600 font-medium">vacate</span>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-1.5 text-[13px]">
                        <span className="font-medium">{p.user_name}</span>
                        {p.user_designation && (
                          <span className="text-neutral-400 text-[11px]">({p.user_designation})</span>
                        )}
                      </div>
                      {p.change_type === "MOVE" && p.from_seat_code && (
                        <div className="text-[11px] text-neutral-500">
                          Move from <span className="font-mono">{p.from_seat_code}</span>
                          {" → "}
                          <span className="font-mono">{p.seat_code}</span>
                        </div>
                      )}
                      {p.change_type === "REPLACE" && p.current_occupant_name && (
                        <div className="text-[11px] text-neutral-500">
                          Will replace{" "}
                          <span className="font-medium text-neutral-700 dark:text-neutral-200">
                            {p.current_occupant_name}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-2 text-[11px] text-neutral-400 flex flex-wrap gap-x-3 gap-y-0.5">
                    {p.proposed_by_name && <span>Proposed by {p.proposed_by_name}</span>}
                    {p.proposed_at && (
                      <span>{new Date(p.proposed_at).toLocaleDateString()}</span>
                    )}
                    {p.effective_date && (
                      <span className="text-emerald-600">Effective {p.effective_date}</span>
                    )}
                  </div>
                  {p.notes && (
                    <p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-400 italic">
                      “{p.notes}”
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-1.5">
                    {onJump && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onJump(p)}>
                        Jump to seat
                      </Button>
                    )}
                    <div className="ml-auto flex gap-1.5">
                      <Button
                        size="sm" variant="outline"
                        className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => onReject(p.id)}
                      >
                        <XCircle className="w-3 h-3 mr-1" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => onApprove(p.id)}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
