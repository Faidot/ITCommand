"use client";

import { Box, Mail, Building2, Calendar, Briefcase, ChevronRight } from "lucide-react";

export interface SeatAssignmentForTooltip {
  user_name?: string | null;
  user_designation?: string | null;
  user_department?: string | null;
  user_email?: string | null;
  assigned_date?: string | null;
  user_assets?: Array<{
    id: number;
    asset_tag: string;
    name: string;
    category: string | null;
    serial_number: string | null;
    status?: string | null;
  }>;
}

export function SeatTooltip({
  assignment,
  seatCode,
  onOpenAsset,
  onOpenAllAssets,
  onPointerEnter,
  onPointerLeave,
}: {
  assignment: SeatAssignmentForTooltip;
  seatCode?: string | null;
  /** Click on an asset row → navigate. */
  onOpenAsset?: (assetId: number) => void;
  /** Click on "View all" → navigate to the assets list. */
  onOpenAllAssets?: () => void;
  /** Hover-stick: keep visible while hovering the tooltip body. */
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const a = assignment;
  const assets = a.user_assets || [];

  return (
    <div
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="bg-neutral-900 text-white rounded-lg shadow-2xl text-xs w-64 ring-1 ring-black/40"
    >
      <div className="px-3 py-2">
        <div className="font-semibold text-sm">{a.user_name || "—"}</div>
        {a.user_designation && (
          <div className="text-neutral-300 text-[11px]">{a.user_designation}</div>
        )}
        <div className="mt-1 space-y-0.5 text-neutral-300">
          {a.user_department && (
            <div className="flex items-center gap-1.5"><Building2 className="w-3 h-3 text-neutral-400" /> {a.user_department}</div>
          )}
          {a.user_email && (
            <div className="flex items-center gap-1.5 truncate"><Mail className="w-3 h-3 text-neutral-400" /> <span className="truncate">{a.user_email}</span></div>
          )}
          {seatCode && (
            <div className="flex items-center gap-1.5"><Briefcase className="w-3 h-3 text-neutral-400" /> <span className="font-mono">{seatCode}</span></div>
          )}
          {a.assigned_date && (
            <div className="flex items-center gap-1.5"><Calendar className="w-3 h-3 text-neutral-400" /> Since {new Date(a.assigned_date).toLocaleDateString()}</div>
          )}
        </div>
      </div>

      {assets.length > 0 && (
        <div className="border-t border-neutral-700 px-3 py-2">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wide text-neutral-400 flex items-center gap-1">
              <Box className="w-3 h-3" /> Assigned Assets
              <span className="text-neutral-500">({assets.length})</span>
            </div>
            {onOpenAllAssets && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenAllAssets(); }}
                className="text-[10px] text-blue-300 hover:underline"
              >
                View all →
              </button>
            )}
          </div>
          <ul className="space-y-0.5 max-h-40 overflow-y-auto">
            {assets.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenAsset?.(asset.id); }}
                  className="w-full text-left px-1.5 py-1 rounded hover:bg-neutral-800 active:bg-neutral-700 flex items-center gap-1.5 text-[11px] transition-colors"
                >
                  <span className="font-mono text-blue-300 shrink-0">{asset.asset_tag}</span>
                  <span className="truncate flex-1">{asset.name}</span>
                  {asset.category && (
                    <span className="text-[9px] text-neutral-400 shrink-0">{asset.category}</span>
                  )}
                  <ChevronRight className="w-3 h-3 text-neutral-500 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {assets.length === 0 && a.user_name && (
        <div className="border-t border-neutral-700 px-3 py-1.5 text-[10px] text-neutral-500 italic">
          No assets assigned to this user.
        </div>
      )}
    </div>
  );
}
