import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatProjectDateTime } from "@/lib/timezoneUtils";
import type { CalendarEvent } from "@/components/CalendarGrid";

interface DayDetailDialogProps {
  day: Date | null;
  events: CalendarEvent[];
  onClose: () => void;
}

const DayDetailDialog = ({ day, events, onClose }: DayDetailDialogProps) => {
  const navigate = useNavigate();

  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
  );

  const handleEventClick = (projectId: string) => {
    onClose();
    navigate(`/projects/${projectId}`);
  };

  return (
    <Dialog open={day !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="print:hidden max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {day ? format(day, "EEEE, MMMM d, yyyy") : ""}
          </DialogTitle>
        </DialogHeader>

        {sortedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No bids or job walks scheduled for this day.
          </p>
        ) : (
          <div className="space-y-2">
            {sortedEvents.map((event) => {
              const isBidDue = event.type === "bid_due";
              const label = isBidDue ? "Bid Due" : "Job Walk";

              let eventColor = "bg-gray-600 text-white hover:bg-gray-700";
              if (isBidDue) {
                if (event.pursuitStatus === "pursuing") {
                  eventColor = "bg-green-600 text-white hover:bg-green-700";
                } else if (event.pursuitStatus === "submitted") {
                  eventColor = "bg-blue-600 text-white hover:bg-blue-700";
                }
              }

              return (
                <button
                  key={event.id}
                  onClick={() => handleEventClick(event.projectId)}
                  className={`w-full text-left rounded-md px-3 py-2.5 text-sm transition-colors cursor-pointer ${eventColor}`}
                >
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className="inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/20">
                      {label}
                    </span>
                    {isBidDue && (
                      <span className="inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/20">
                        {event.isReadyToBid ? "Ready" : "Not Ready"}
                      </span>
                    )}
                  </div>
                  <div className="font-medium leading-tight">{event.projectName}</div>
                  {event.agency && (
                    <div className="text-xs text-white/80 mt-0.5">{event.agency}</div>
                  )}
                  <div className="text-xs text-white/80 mt-0.5">
                    {formatProjectDateTime(event.datetime, { fallback: "Time unavailable" })}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DayDetailDialog;
