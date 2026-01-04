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

interface Project {
  id: string;
  name: string;
  agency: string | null;
  bid_due_at: string;
  job_walk_at: string | null;
}

interface CalendarEvent {
  id: string;
  projectId: string;
  projectName: string;
  agency: string | null;
  type: 'bid_due' | 'job_walk';
  datetime: string;
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
    
    if (project.bid_due_at) {
      events.push({
        id: `${project.id}-bid`,
        projectId: project.id,
        projectName: project.name,
        agency: project.agency,
        type: 'bid_due',
        datetime: project.bid_due_at,
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

  return (
    <div className="calendar-print-wrapper">
      <div className="w-full max-w-7xl mx-auto print-calendar-container">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-6">
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
              const originalTitle = document.title;
              document.title = `Bid_Calendar_${format(currentMonth, "yyyy-MM")}`;
              window.print();
              document.title = originalTitle;
            }} 
            className="print:hidden ml-4"
          >
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      {/* Day Headers (Mon-Fri) */}
      <div className="grid grid-cols-5 gap-1 mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
          <div
            key={day}
            className="text-center text-sm font-medium text-muted-foreground py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="border border-border rounded-lg overflow-hidden print-calendar-grid">
        {weeks.map((week, weekIndex) => (
          <div
            key={weekIndex}
            className="grid grid-cols-5 divide-x divide-border border-b last:border-b-0 border-border"
          >
            {week.map((day) => {
              const dayEvents = eventsForDay(day);
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isTodayDate = isToday(day);

              return (
                <div
                  key={day.toISOString()}
                  className={`min-h-[160px] p-3 ${
                    isCurrentMonth ? "bg-background" : "bg-muted/30"
                  }`}
                >
                  {/* Date Number */}
                  <div
                    className={`text-sm font-medium mb-1 w-7 h-7 flex items-center justify-center rounded-full ${
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
                  <div className="space-y-1.5">
                    {dayEvents.map((event) => {
                      const isBidDue = event.type === 'bid_due';
                      const label = isBidDue ? 'Bid Due' : 'Job Walk';
                      
                      return (
                        <button
                          key={event.id}
                          onClick={() => handleEventClick(event.projectId)}
                          className={`w-full text-left rounded px-2.5 py-2 text-sm transition-colors cursor-pointer ${
                            isBidDue
                              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                              : 'bg-gray-600 text-white hover:bg-gray-700'
                          }`}
                        >
                          <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded mb-1 ${
                            isBidDue
                              ? 'bg-destructive-foreground/20'
                              : 'bg-white/20'
                          }`}>
                            {label}
                          </span>
                          <div className="font-medium truncate leading-snug">
                            {event.projectName}
                          </div>
                          <div className={`text-xs ${isBidDue ? 'text-destructive-foreground/80' : 'text-white/80'}`}>
                            {format(new Date(event.datetime), "MM/dd @ h:mm a")}
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
  );
};

export default CalendarGrid;
