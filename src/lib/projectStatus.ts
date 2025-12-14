export function getProjectDisplayStatus(project: {
  status: string;
  bid_due_at: string | null;
}): { label: string; color: 'green' | 'red' | 'gray' } {
  if (
    project.status === 'LIVE' &&
    project.bid_due_at &&
    new Date(project.bid_due_at) < new Date()
  ) {
    return { label: 'CLOSED', color: 'red' };
  }

  if (project.status === 'LIVE') {
    return { label: 'LIVE', color: 'green' };
  }

  return { label: project.status, color: 'gray' };
}
