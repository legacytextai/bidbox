import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  format,
  addMonths,
  subMonths,
  isToday,
  getDay,
} from "date-fns";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printCalendarViaIframe } from "@/lib/calendarPrint";
import { formatProjectDateTime } from "@/lib/timezoneUtils";

interface Project {
  id: string;
  name: string;
  agency: string | null;
  bid_due_at: string;
  job_walk_at: string | null;
  is_ready_to_bid: boolean;
  pursuit_status?: string | null;
}

interface CalendarEvent {
  id: string;
  projectId: string;
  projectName: string;
  agency: string | null;
  type: 'bid_due' | 'job_walk';
  datetime: string;
  isReadyToBid: boolean;
  pursuitStatus: string;
}

interface CalendarGridProps {
  projects: Project[];
}

const CalendarGrid = ({ projects }: CalendarGridProps) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const navigate = useNavigate();

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  // Transform projects into calendar events
  const calendarEvents: CalendarEvent[] = projects.flatMap((project) => {
    const events: CalendarEvent[] = [];
    const pursuitStatus = (project.pursuit_status || "reviewing").toLowerCase();

    // Hide passed projects from the calendar entirely
    if (pursuitStatus === "passed") return events;

    if (project.bid_due_at) {
      events.push({
        id: `${project.id}-bid`,
        projectId: project.id,
        projectName: project.name,
        agency: project.agency,
        type: 'bid_due',
        datetime: project.bid_due_at,
        isReadyToBid: project.is_ready_to_bid,
        pursuitStatus,
      });
    }

    if (project.job_walk_at) {
      events.push({
        id: `${project.id}-walk`,
        projectId: project.id,
        projectName: project.name,
        agency: project.agency,
        type: 'job_walk',
        datetime: project.job_walk_at,
        isReadyToBid: project.is_ready_to_bid,
        pursuitStatus,
      });
    }

    return events;
  });

  // Get all days for the calendar grid (Mon-Fri only)
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  
  // Start from Monday (weekStartsOn: 1)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  
  const allDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  
  // Filter out weekends (Saturday = 6, Sunday = 0)
  const weekdays = allDays.filter((day) => {
    const dayOfWeek = getDay(day);
    return dayOfWeek !== 0 && dayOfWeek !== 6;
  });

  // Group days into weeks (5 days per row)
  const weeks: Date[][] = [];
  for (let i = 0; i < weekdays.length; i += 5) {
    weeks.push(weekdays.slice(i, i + 5));
  }

  // Get events for a specific day
  const eventsForDay = (day: Date) =>
    calendarEvents.filter((e) => isSameDay(new Date(e.datetime), day));

  const handleEventClick = (projectId: string) => {
    navigate(`/projects/${projectId}`);
  };

  // Calculate dynamic row height based on number of weeks
  const weekCount = weeks.length;
  // Roughly: viewport height - header - metrics - nav - day headers - padding
  // Use flex-1 to distribute remaining space evenly among rows

  return (
    <div className="calendar-print-root h-full flex flex-col">
      <div className="calendar-print-wrapper flex-1 flex flex-col min-h-0">
        <div className="w-full max-w-7xl mx-auto print-calendar-container flex-1 flex flex-col min-h-0">
          {/* Month Navigation */}
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <Button variant="outline" size="icon" onClick={handlePrevMonth} className="print:hidden">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h2 className="text-2xl font-semibold text-foreground">
              {format(currentMonth, "MMMM yyyy")}
            </h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={handleNextMonth} className="print:hidden">
                <ChevronRight className="h-5 w-5" />
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  // Build print data from current calendar state
                  const printData = {
                    monthTitle: format(currentMonth, "MMMM yyyy"),
                    monthKey: format(currentMonth, "yyyy-MM"),
                    weeks: weeks.map(week => ({
                      days: week.map(day => ({
                        date: day,
                        isCurrentMonth: isSameMonth(day, currentMonth),
                        isToday: isToday(day),
                        events: eventsForDay(day),
                      })),
                    })),
                  };
                  printCalendarViaIframe(printData);
                }}
                className="print:hidden ml-4"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </div>
          </div>

          {/* Day Headers (Mon-Fri) */}
          <div className="grid grid-cols-5 gap-1 mb-1 flex-shrink-0">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
              <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid - fills remaining space */}
          <div className="border border-border rounded-lg overflow-hidden print-calendar-grid flex-1 flex flex-col min-h-0">
            {weeks.map((week, weekIndex) => (
              <div
                key={weekIndex}
                className="grid grid-cols-5 divide-x divide-border border-b last:border-b-0 border-border flex-1"
              >
                {week.map((day) => {
                  const dayEvents = eventsForDay(day);
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  const isTodayDate = isToday(day);

                  return (
                    <div
                      key={day.toISOString()}
                      className={`p-2 overflow-hidden ${isCurrentMonth ? "bg-background" : "bg-muted/30"}`}
                    >
                      {/* Date Number */}
                      <div
                        className={`text-sm font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                          isTodayDate
                            ? "bg-primary text-primary-foreground"
                            : isCurrentMonth
                              ? "text-foreground"
                              : "text-muted-foreground"
                        }`}
                      >
                        {format(day, "d")}
                      </div>

                      {/* Events */}
                      <div className="space-y-1 overflow-y-auto max-h-[calc(100%-32px)]">
                        {dayEvents.map((event) => {
                          const isBidDue = event.type === "bid_due";
                          const label = isBidDue ? "Bid Due" : "Job Walk";

                          // Bid Due color follows pursuit_status:
                          //   pursuing  -> green
                          //   submitted -> blue
                          //   reviewing -> gray (default)
                          // Job Walk remains gray.
                          let eventColor = "bg-gray-600 text-white hover:bg-gray-700";
                          if (isBidDue) {
                            if (event.pursuitStatus === "pursuing") {
                              eventColor = "bg-green-600 text-white hover:bg-green-700";
                            } else if (event.pursuitStatus === "submitted") {
                              eventColor = "bg-blue-600 text-white hover:bg-blue-700";
                            } else {
                              eventColor = "bg-gray-600 text-white hover:bg-gray-700";
                            }
                          }

                          const badgeBg = "bg-white/20";
                          const subtitleColor = "text-white/80";

                          return (
                            <button
                              key={event.id}
                              onClick={() => handleEventClick(event.projectId)}
                              title={isBidDue 
                                ? (event.isReadyToBid ? "Ready to bid" : "Not ready to bid - checklist incomplete")
                                : "Job Walk"}
                              className={`w-full text-left rounded px-2 py-1.5 text-xs transition-colors cursor-pointer ${eventColor}`}
                            >
                              <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                                <span className={`inline-block text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded ${badgeBg}`}>
                                  {label}
                                </span>
                                {isBidDue && (
                                  <span className={`inline-block text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded ${
                                    event.isReadyToBid ? "bg-white/30" : "bg-white/20"
                                  }`}>
                                    {event.isReadyToBid ? "Ready" : "Not Ready"}
                                  </span>
                                )}
                              </div>
                              <div className="font-medium truncate leading-tight">{event.projectName}</div>
                              <div className={`text-[10px] ${subtitleColor}`}>
                                {formatProjectDateTime(event.datetime, { fallback: "Time unavailable" })}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalendarGrid;
