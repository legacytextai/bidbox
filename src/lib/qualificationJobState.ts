export interface QualificationProfileIdentity {
  id: string;
  profile_version: number;
}

export interface QualificationJobIdentity {
  bid_profile_id: string;
  profile_version: number;
  status: string;
}

export function isJobForCurrentProfileVersion(
  profile: QualificationProfileIdentity | null | undefined,
  job: QualificationJobIdentity | null | undefined,
): boolean {
  return Boolean(
    profile && job
    && job.bid_profile_id === profile.id
    && job.profile_version === profile.profile_version,
  );
}

export function isQualificationUpdating(status: string | null | undefined): boolean {
  return status === "queued" || status === "running";
}
