alter table public.projects
  add column if not exists bid_due_override_at timestamptz,
  add column if not exists bid_due_override_source text,
  add column if not exists bid_due_override_reason text;

alter table public.projects
  drop constraint if exists projects_bid_due_override_source_check;

alter table public.projects
  add constraint projects_bid_due_override_source_check
  check (
    bid_due_override_source is null
    or bid_due_override_source in ('manual', 'deadline_candidate')
  );

create index if not exists idx_projects_bid_due_override_at
  on public.projects (bid_due_override_at)
  where bid_due_override_at is not null;