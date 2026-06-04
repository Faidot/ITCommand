"use client";

import { ArrowRight, Building2, Clock, Layers, Plus, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface OfficeWithCounts {
  id: number;
  name: string;
  address?: string;
  floor_count: number;
  seat_count: number;
  occupied_count: number;
  pending_count: number;
}

export function OfficeGallery({
  offices,
  editable,
  onSelect,
  onAddOffice,
}: {
  offices: OfficeWithCounts[];
  editable: boolean;
  onSelect: (o: OfficeWithCounts) => void;
  onAddOffice: () => void;
}) {
  return (
    <div className="p-6 max-w-6xl mx-auto w-full">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Choose an office location</h2>
          <p className="text-sm text-neutral-500">
            Pick an office to open its floor plan, design layouts and assign seats.
          </p>
        </div>
        {offices.length === 0 && (
          <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
            No offices yet — {editable ? "create one to start." : "ask an admin to set one up."}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {offices.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onSelect(o)}
            className="text-left group"
          >
            <Card className="hover:shadow-lg hover:border-violet-300 transition-all cursor-pointer h-full">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-lg bg-violet-100 dark:bg-violet-950/40 text-violet-600 dark:text-violet-300 shrink-0">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-base truncate">{o.name}</div>
                    {o.address && (
                      <div className="text-xs text-neutral-500 truncate">{o.address}</div>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all" />
                </div>

                <div className="grid grid-cols-4 gap-2 mt-5 text-center">
                  <Stat icon={<Layers className="w-3 h-3" />} value={o.floor_count} label="Floors" />
                  <Stat value={o.seat_count} label="Seats" />
                  <Stat
                    icon={<Users className="w-3 h-3 text-blue-500" />}
                    value={o.occupied_count}
                    label="Occupied"
                    tone="blue"
                  />
                  <Stat
                    icon={<Clock className="w-3 h-3 text-amber-500" />}
                    value={o.pending_count}
                    label="Pending"
                    tone={o.pending_count > 0 ? "amber" : undefined}
                  />
                </div>
              </CardContent>
            </Card>
          </button>
        ))}

        {editable && (
          <button type="button" onClick={onAddOffice} className="text-left">
            <Card className="border-dashed hover:border-violet-400 hover:shadow-md transition-all cursor-pointer h-full flex items-center justify-center min-h-[170px]">
              <CardContent className="text-center p-6">
                <div className="mx-auto w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-neutral-500" />
                </div>
                <div className="mt-2 text-sm font-medium">Add office</div>
                <div className="text-xs text-neutral-500">Set up a new office location</div>
              </CardContent>
            </Card>
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon, value, label, tone,
}: {
  icon?: React.ReactNode;
  value: number;
  label: string;
  tone?: "blue" | "amber";
}) {
  const c = tone === "blue" ? "text-blue-600" : tone === "amber" ? "text-amber-600" : "";
  return (
    <div>
      <div className={`text-lg font-bold tabular-nums ${c}`}>{value}</div>
      <div className="text-[10px] uppercase text-neutral-400 flex items-center gap-0.5 justify-center">
        {icon}
        <span>{label}</span>
      </div>
    </div>
  );
}
