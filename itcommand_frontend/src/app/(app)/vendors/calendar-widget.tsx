"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isToday } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ContractCalendarWidget({ contracts = [] }: { contracts: any[] }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const daysInMonth = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const contractsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    contracts.forEach(c => {
      if (!c.end_date) return;
      const dateStr = c.end_date.split('T')[0];
      if (!map.has(dateStr)) map.set(dateStr, []);
      map.get(dateStr)!.push(c);
    });
    return map;
  }, [contracts]);

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const selectedContracts = selectedDate 
    ? contractsByDate.get(format(selectedDate, 'yyyy-MM-dd')) || []
    : [];

  return (
    <Card className="flex flex-col md:flex-row overflow-hidden border-violet-100 dark:border-violet-900/50 shadow-sm h-full">
      <div className="w-full md:w-1/2 p-4 border-b md:border-b-0 md:border-r border-neutral-100 dark:border-neutral-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{format(currentDate, 'MMMM yyyy')}</h3>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
            <div key={day} className="text-xs font-medium text-neutral-500">{day}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 text-sm">
          {/* Pad empty days at start */}
          {Array.from({ length: startOfMonth(currentDate).getDay() }).map((_, i) => (
            <div key={`empty-${i}`} className="h-8" />
          ))}

          {daysInMonth.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayContracts = contractsByDate.get(dateStr);
            const hasContracts = dayContracts && dayContracts.length > 0;
            const isSelected = selectedDate && isSameDay(day, selectedDate);
            const today = isToday(day);

            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDate(day)}
                className={`
                  h-8 rounded-md flex items-center justify-center relative transition-colors
                  ${hasContracts ? 'font-bold' : ''}
                  ${isSelected ? 'bg-violet-600 text-white' : hasContracts ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-100' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'}
                  ${today && !isSelected ? 'border border-violet-500' : ''}
                `}
              >
                {format(day, 'd')}
                {hasContracts && !isSelected && (
                  <span className="absolute bottom-1 w-1 h-1 rounded-full bg-amber-500"></span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="w-full md:w-1/2 p-4 bg-neutral-50/50 dark:bg-neutral-900/20 flex flex-col min-h-[200px]">
        {selectedDate ? (
          <>
            <h4 className="font-medium text-sm text-neutral-500 mb-3 flex justify-between items-center">
              <span>{format(selectedDate, 'MMMM d, yyyy')}</span>
              {selectedContracts.length > 0 && (
                <Badge variant="outline" className="bg-amber-100 text-amber-800 border-0">{selectedContracts.length} Expiring</Badge>
              )}
            </h4>
            
            {selectedContracts.length > 0 ? (
              <div className="space-y-2 overflow-y-auto pr-2 max-h-[160px]">
                {selectedContracts.map(c => (
                  <div key={c.id} className="p-3 bg-white dark:bg-neutral-900 border border-amber-200 dark:border-amber-800/50 rounded-lg shadow-sm">
                    <div className="flex justify-between items-start">
                      <div className="font-semibold text-sm">{c.title}</div>
                      <Badge variant="outline" className="text-[10px] uppercase font-normal">{c.status}</Badge>
                    </div>
                    <div className="text-xs text-neutral-500 mt-1 flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {c.vendor?.name || 'Vendor Contract'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-neutral-400">
                <FileText className="w-8 h-8 mb-2 opacity-20" />
                <p className="text-sm">No contracts expiring on this date.</p>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-neutral-400">
            <p className="text-sm">Select a date to view expiring contracts.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
