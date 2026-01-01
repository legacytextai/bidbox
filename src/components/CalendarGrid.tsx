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
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Project {
  id: string;
  name: string;
  agency: string | null;
  bid_due_at: string;
}

interface CalendarGridProps {
  projects: Project[];
}

const CalendarGrid = ({ projects }: CalendarGridProps) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const navigate = useNavigate();

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

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
    projects.filter((p) => isSameDay(new Date(p.bid_due_at), day));

  const handleEventClick = (projectId: string) => {
    navigate(`/projects/${projectId}`);
  };

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-6">
        <Button variant="outline" size="icon" onClick={handlePrevMonth}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-2xl font-semibold text-foreground">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <Button variant="outline" size="icon" onClick={handleNextMonth}>
          <ChevronRight className="h-5 w-5" />
        </Button>
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
      <div className="border border-border rounded-lg overflow-hidden">
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
                  className={`min-h-[120px] p-2 ${
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
                  <div className="space-y-1">
                    {dayEvents.map((event) => (
                      <button
                        key={event.id}
                        onClick={() => handleEventClick(event.id)}
                        className="w-full text-left bg-destructive text-destructive-foreground rounded px-2 py-1 text-xs hover:bg-destructive/90 transition-colors cursor-pointer"
                      >
                        <div className="font-medium truncate">
                          {event.agency ? `${event.agency} – ` : ""}
                          {event.name}
                        </div>
                        <div className="text-destructive-foreground/80 text-[10px]">
                          Bid Due: {format(new Date(event.bid_due_at), "MM/dd @ h:mm a")}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CalendarGrid;
