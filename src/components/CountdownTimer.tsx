import { useEffect, useState } from 'react';

interface CountdownTimerProps {
  bidDueAt: string;
}

export function CountdownTimer({ bidDueAt }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const dueDate = new Date(bidDueAt).getTime();
      const diff = dueDate - now;

      if (diff <= 0) {
        setTimeLeft('Bid deadline has passed');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      setTimeLeft(`${days}d ${hours}h ${minutes}m`);
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [bidDueAt]);

  return (
    <div className="text-center p-6 bg-muted/50 rounded-lg border border-border">
      <h3 className="text-sm uppercase tracking-wide text-muted-foreground mb-2">
        Time Remaining
      </h3>
      <p className="text-3xl font-bold text-destructive">{timeLeft}</p>
    </div>
  );
}
