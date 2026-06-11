"use client";

import { useMemo, useState } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  format, isSameMonth, isSameDay, addMonths, subMonths, parseISO,
} from "date-fns";
import { ChevronLeft, ChevronRight, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CalEvent = { date: string; label: string; type: "paid" | "due" | "projected" };

const dotColor: Record<CalEvent["type"], string> = {
  paid: "bg-emerald-500",
  due: "bg-red-500",
  projected: "bg-amber-400",
};
const textColor: Record<CalEvent["type"], string> = {
  paid: "text-emerald-600",
  due: "text-red-600",
  projected: "text-amber-600",
};

function safeDate(s: string) {
  try { return parseISO(s); } catch { return new Date(s); }
}

export function PaymentCalendar({ events }: { events: CalEvent[] }) {
  const firstEvent = events.length ? safeDate(events[0].date) : new Date();
  const [cursor, setCursor] = useState<Date>(startOfMonth(firstEvent));

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    const end = endOfWeek(endOfMonth(cursor));
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    events.forEach((e) => { const k = format(safeDate(e.date), "yyyy-MM-dd"); (map[k] ||= []).push(e); });
    return map;
  }, [events]);

  const sortedTimeline = useMemo(
    () => [...events].sort((a, b) => (safeDate(a.date) > safeDate(b.date) ? 1 : -1)),
    [events]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between mb-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCursor(subMonths(cursor, 1))}><ChevronLeft className="w-4 h-4" /></Button>
          <div className="text-sm font-semibold">{format(cursor, "MMMM yyyy")}</div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <div className="grid grid-cols-7 text-center text-[10px] uppercase text-neutral-400 mb-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayEvents = eventsByDay[key] || [];
            const muted = !isSameMonth(day, cursor);
            const isToday = isSameDay(day, new Date());
            return (
              <div key={key} className={`min-h-[40px] rounded-md border p-1 text-xs ${muted ? "opacity-40" : ""} ${isToday ? "ring-1 ring-blue-400" : ""}`}>
                <div className="text-right text-[10px] text-neutral-400">{format(day, "d")}</div>
                <div className="flex flex-wrap gap-0.5 justify-center">
                  {dayEvents.map((e, i) => <span key={i} title={e.label} className={`w-1.5 h-1.5 rounded-full ${dotColor[e.type]}`} />)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-2 text-[10px] text-neutral-500">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Paid</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Due</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Projected</span>
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-400 mb-1">Timeline</div>
        <div className="relative pl-4 space-y-2 before:absolute before:left-1 before:top-1 before:bottom-1 before:w-px before:bg-neutral-200 dark:before:bg-neutral-700">
          {sortedTimeline.length === 0 && <div className="text-sm text-neutral-400">No events</div>}
          {sortedTimeline.map((e, i) => (
            <div key={i} className="relative flex items-center gap-2 text-sm">
              <CircleDot className={`w-3 h-3 absolute -left-[13px] ${textColor[e.type]}`} />
              <span className="text-neutral-500 w-24 shrink-0">{format(safeDate(e.date), "dd MMM yyyy")}</span>
              <span className={textColor[e.type]}>{e.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
