import { format } from "date-fns";

interface CalendarEvent {
  id: string;
  projectId: string;
  projectName: string;
  agency: string | null;
  type: 'bid_due' | 'job_walk';
  datetime: string;
}

interface WeekData {
  days: {
    date: Date;
    isCurrentMonth: boolean;
    isToday: boolean;
    events: CalendarEvent[];
  }[];
}

interface PrintCalendarData {
  monthTitle: string;
  monthKey: string;
  weeks: WeekData[];
}

/**
 * Generates a self-contained HTML document for printing the calendar.
 * Uses fixed dimensions for Letter landscape to guarantee single-page output.
 */
function generatePrintHTML(data: PrintCalendarData): string {
  const weekdayHeaders = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  
  // Calculate row height based on number of weeks (Letter landscape ~7.5in printable height)
  const numWeeks = data.weeks.length;
  const headerHeight = 60; // px for month title + weekday headers
  const availableHeight = 612 - headerHeight; // ~7.5in in px at 96dpi, minus header
  const rowHeight = Math.floor(availableHeight / numWeeks);

  const weekdayHeadersHTML = weekdayHeaders
    .map(day => `<div class="weekday-header">${day}</div>`)
    .join("");

  const weeksHTML = data.weeks.map(week => {
    const daysHTML = week.days.map(day => {
      const eventsHTML = day.events.map(event => {
        const isBidDue = event.type === "bid_due";
        const bgColor = isBidDue ? "#dc2626" : "#4b5563";
        const label = isBidDue ? "Bid Due" : "Job Walk";
        const time = format(new Date(event.datetime), "MM/dd @ h:mm a");
        
        return `
          <div class="event" style="background-color: ${bgColor};">
            <div class="event-label">${label}</div>
            <div class="event-name">${escapeHtml(event.projectName)}</div>
            <div class="event-time">${time}</div>
          </div>
        `;
      }).join("");

      const dateClass = day.isToday ? "date-number today" : day.isCurrentMonth ? "date-number" : "date-number outside";
      const cellBg = day.isCurrentMonth ? "#ffffff" : "#f5f5f5";
      
      return `
        <div class="day-cell" style="background-color: ${cellBg}; height: ${rowHeight}px;">
          <div class="${dateClass}">${format(day.date, "d")}</div>
          <div class="events-container">${eventsHTML}</div>
        </div>
      `;
    }).join("");

    return `<div class="week-row">${daysHTML}</div>`;
  }).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Bid_Calendar_${data.monthKey}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    
    @page {
      size: letter landscape;
      margin: 0.4in;
    }
    
    html, body {
      width: 100%;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      background: white;
    }
    
    .calendar-container {
      width: 100%;
      max-width: 936px; /* Letter width minus margins at 96dpi */
      margin: 0 auto;
    }
    
    .month-title {
      text-align: center;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #121212;
    }
    
    .weekday-headers {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 1px;
      margin-bottom: 4px;
    }
    
    .weekday-header {
      text-align: center;
      font-size: 10px;
      font-weight: 500;
      color: #666;
      padding: 4px 0;
    }
    
    .calendar-grid {
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
    }
    
    .week-row {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      border-bottom: 1px solid #e0e0e0;
    }
    
    .week-row:last-child {
      border-bottom: none;
    }
    
    .day-cell {
      border-right: 1px solid #e0e0e0;
      padding: 4px;
      overflow: hidden;
    }
    
    .day-cell:last-child {
      border-right: none;
    }
    
    .date-number {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 500;
      color: #121212;
      margin-bottom: 2px;
    }
    
    .date-number.today {
      background-color: #121212;
      color: white;
      border-radius: 50%;
    }
    
    .date-number.outside {
      color: #999;
    }
    
    .events-container {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    
    .event {
      padding: 3px 5px;
      border-radius: 3px;
      color: white;
      overflow: hidden;
    }
    
    .event-label {
      font-size: 7px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      opacity: 0.9;
      background-color: rgba(255, 255, 255, 0.15);
      display: inline-block;
      padding: 1px 4px;
      border-radius: 2px;
      margin-bottom: 1px;
    }
    
    .event-name {
      font-size: 9px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
    }
    
    .event-time {
      font-size: 8px;
      opacity: 0.85;
      line-height: 1.2;
    }
  </style>
</head>
<body>
  <div class="calendar-container">
    <div class="month-title">${escapeHtml(data.monthTitle)}</div>
    <div class="weekday-headers">${weekdayHeadersHTML}</div>
    <div class="calendar-grid">${weeksHTML}</div>
  </div>
</body>
</html>
  `.trim();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Prints the calendar using a hidden iframe for deterministic single-page output.
 */
export function printCalendarViaIframe(data: PrintCalendarData): void {
  const html = generatePrintHTML(data);
  
  // Create hidden iframe
  const iframe = document.createElement('iframe');
  iframe.style.position = 'absolute';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  iframe.style.left = '-9999px';
  
  document.body.appendChild(iframe);
  
  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) {
    console.error('Could not access iframe document');
    document.body.removeChild(iframe);
    return;
  }
  
  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();
  
  // Wait for content to render, then print
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.error('Print failed:', e);
    }
    
    // Clean up after a delay to allow print dialog to complete
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  };
  
  // Fallback: trigger load manually if already loaded
  if (iframeDoc.readyState === 'complete') {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.error('Print failed:', e);
      }
      
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    }, 100);
  }
}
