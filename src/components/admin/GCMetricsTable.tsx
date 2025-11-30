import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { GCMetric } from "@/hooks/useAdminKPIs";

interface GCMetricsTableProps {
  data: GCMetric[] | null | undefined;
  isLoading: boolean;
}

export function GCMetricsTable({ data, isLoading }: GCMetricsTableProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="text-muted-foreground">Email</TableHead>
              <TableHead className="text-muted-foreground">Company</TableHead>
              <TableHead className="text-muted-foreground text-center">Projects</TableHead>
              <TableHead className="text-muted-foreground text-center">Bids Received</TableHead>
              <TableHead className="text-muted-foreground">Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i} className="border-border">
                <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-md border border-border p-8 text-center">
        <p className="text-muted-foreground">No GC data available yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground font-semibold">Email</TableHead>
            <TableHead className="text-muted-foreground font-semibold">Company</TableHead>
            <TableHead className="text-muted-foreground font-semibold text-center">Projects</TableHead>
            <TableHead className="text-muted-foreground font-semibold text-center">Bids Received</TableHead>
            <TableHead className="text-muted-foreground font-semibold">Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((gc) => (
            <TableRow key={gc.id} className="border-border">
              <TableCell className="font-medium text-foreground">{gc.email}</TableCell>
              <TableCell className="text-muted-foreground">{gc.company_name || "—"}</TableCell>
              <TableCell className="text-center text-foreground">{gc.project_count}</TableCell>
              <TableCell className="text-center text-foreground">{gc.bid_count}</TableCell>
              <TableCell className="text-muted-foreground">
                {format(new Date(gc.created_at), "MMM d, yyyy")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
