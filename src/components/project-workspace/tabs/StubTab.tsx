// StubTab — placeholder for tabs planned in later phases.

export type StubTabKey = "addenda" | "activity" | "estimate" | "proposal";

const STUB_LABELS: Record<StubTabKey, string> = {
  addenda: "Addenda",
  activity: "Activity",
  estimate: "Estimate",
  proposal: "Proposal",
};

const STUB_DESCRIPTIONS: Record<StubTabKey, string> = {
  addenda: "Addenda monitoring, acknowledgment tracking, and deadline impact review.",
  activity: "Status changes, notes, and project timeline history.",
  estimate: "Bid item schedule, quantity review, and estimate preparation.",
  proposal: "Bid forms, submission instructions, and final package review.",
};

export interface StubTabProps {
  tab: StubTabKey;
}

export function StubTab({ tab }: StubTabProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-8 text-center">
      <h2 className="text-base font-semibold text-foreground mb-2">{STUB_LABELS[tab]}</h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">{STUB_DESCRIPTIONS[tab]}</p>
    </div>
  );
}
