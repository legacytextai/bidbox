-- Additive geography-resolution shadow model. Nothing here changes active
-- opportunity visibility or overwrites portal-owned county/location fields.

CREATE TABLE IF NOT EXISTS public.california_counties (
  fips text PRIMARY KEY CHECK (fips ~ '^06[0-9]{3}$'),
  name text NOT NULL UNIQUE
);

INSERT INTO public.california_counties (fips, name) VALUES
('06001','Alameda'),('06003','Alpine'),('06005','Amador'),('06007','Butte'),('06009','Calaveras'),('06011','Colusa'),
('06013','Contra Costa'),('06015','Del Norte'),('06017','El Dorado'),('06019','Fresno'),('06021','Glenn'),('06023','Humboldt'),
('06025','Imperial'),('06027','Inyo'),('06029','Kern'),('06031','Kings'),('06033','Lake'),('06035','Lassen'),
('06037','Los Angeles'),('06039','Madera'),('06041','Marin'),('06043','Mariposa'),('06045','Mendocino'),('06047','Merced'),
('06049','Modoc'),('06051','Mono'),('06053','Monterey'),('06055','Napa'),('06057','Nevada'),('06059','Orange'),
('06061','Placer'),('06063','Plumas'),('06065','Riverside'),('06067','Sacramento'),('06069','San Benito'),('06071','San Bernardino'),
('06073','San Diego'),('06075','San Francisco'),('06077','San Joaquin'),('06079','San Luis Obispo'),('06081','San Mateo'),
('06083','Santa Barbara'),('06085','Santa Clara'),('06087','Santa Cruz'),('06089','Shasta'),('06091','Sierra'),
('06093','Siskiyou'),('06095','Solano'),('06097','Sonoma'),('06099','Stanislaus'),('06101','Sutter'),('06103','Tehama'),
('06105','Trinity'),('06107','Tulare'),('06109','Tuolumne'),('06111','Ventura'),('06113','Yolo'),('06115','Yuba')
ON CONFLICT (fips) DO UPDATE SET name=EXCLUDED.name;

CREATE TABLE IF NOT EXISTS public.california_city_counties (
  normalized_city text PRIMARY KEY,
  display_city text NOT NULL,
  county_fips text NOT NULL REFERENCES public.california_counties(fips) ON DELETE RESTRICT,
  reference_version text NOT NULL DEFAULT 'ca-incorporated-places-v1',
  aliases text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.california_city_counties (normalized_city, display_city, county_fips) VALUES
('los angeles','Los Angeles','06037'),('long beach','Long Beach','06037'),('norwalk','Norwalk','06037'),
('pasadena','Pasadena','06037'),('pomona','Pomona','06037'),('torrance','Torrance','06037'),('santa monica','Santa Monica','06037'),
('riverside','Riverside','06065'),('corona','Corona','06065'),('murrieta','Murrieta','06065'),('temecula','Temecula','06065'),
('moreno valley','Moreno Valley','06065'),('hemet','Hemet','06065'),('indio','Indio','06065'),('palm springs','Palm Springs','06065'),
('san bernardino','San Bernardino','06071'),('fontana','Fontana','06071'),('ontario','Ontario','06071'),('victorville','Victorville','06071'),
('anaheim','Anaheim','06059'),('irvine','Irvine','06059'),('santa ana','Santa Ana','06059'),('huntington beach','Huntington Beach','06059'),
('san diego','San Diego','06073'),('carlsbad','Carlsbad','06073'),('oceanside','Oceanside','06073'),('escondido','Escondido','06073'),
('sacramento','Sacramento','06067'),('san francisco','San Francisco','06075'),('san jose','San Jose','06085'),
('fresno','Fresno','06019'),('bakersfield','Bakersfield','06029'),('oakland','Oakland','06001'),('stockton','Stockton','06077')
ON CONFLICT (normalized_city) DO UPDATE SET display_city=EXCLUDED.display_city, county_fips=EXCLUDED.county_fips;

CREATE TABLE IF NOT EXISTS public.agency_jurisdictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_agency_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  county_fips text[] NOT NULL DEFAULT '{}',
  jurisdiction_scope text NOT NULL CHECK (jurisdiction_scope IN ('fixed','regional','statewide','variable')),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  aliases text[] NOT NULL DEFAULT '{}',
  source_url text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.agency_jurisdictions
  (normalized_agency_name, display_name, county_fips, jurisdiction_scope, confidence, aliases, notes) VALUES
('los angeles county','Los Angeles County',ARRAY['06037'],'fixed',0.999,ARRAY['la county','lacounty'],'County government'),
('los angeles county metropolitan transportation authority','LA Metro',ARRAY['06037'],'regional',0.980,ARRAY['la metro','lacmta'],'Project evidence may override the service-area default'),
('port of long beach','Port of Long Beach',ARRAY['06037'],'fixed',0.999,ARRAY[]::text[],'Fixed-jurisdiction source'),
('port of los angeles','Port of Los Angeles',ARRAY['06037'],'fixed',0.999,ARRAY[]::text[],'Fixed-jurisdiction source'),
('city of norwalk','City of Norwalk',ARRAY['06037'],'fixed',0.999,ARRAY[]::text[],'Municipal jurisdiction'),
('city of riverside','City of Riverside',ARRAY['06065'],'fixed',0.999,ARRAY[]::text[],'Municipal jurisdiction'),
('california department of transportation','Caltrans',ARRAY[]::text[],'statewide',1.000,ARRAY['caltrans'],'Requires district/project location evidence')
ON CONFLICT (normalized_agency_name) DO UPDATE SET
  county_fips=EXCLUDED.county_fips, jurisdiction_scope=EXCLUDED.jurisdiction_scope,
  confidence=EXCLUDED.confidence, aliases=EXCLUDED.aliases, notes=EXCLUDED.notes;

ALTER TABLE public.opportunity_candidates
  ADD COLUMN IF NOT EXISTS resolved_county_fips text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS geography_resolution_status text NOT NULL DEFAULT 'unresolved',
  ADD COLUMN IF NOT EXISTS geography_confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS geography_primary_source text,
  ADD COLUMN IF NOT EXISTS geography_resolution_version text,
  ADD COLUMN IF NOT EXISTS geography_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS geography_shadow boolean NOT NULL DEFAULT true;

ALTER TABLE public.opportunity_candidates DROP CONSTRAINT IF EXISTS opportunity_candidates_geography_resolution_status_check;
ALTER TABLE public.opportunity_candidates ADD CONSTRAINT opportunity_candidates_geography_resolution_status_check
  CHECK (geography_resolution_status IN ('confirmed','probable','conflict','unresolved'));

CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_resolved_counties
  ON public.opportunity_candidates USING gin (resolved_county_fips);
CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_geography_shadow
  ON public.opportunity_candidates (geography_resolution_status, portal_type) WHERE geography_shadow;

CREATE TABLE IF NOT EXISTS public.opportunity_geography_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  resolver_version text NOT NULL,
  evidence_source text NOT NULL CHECK (evidence_source IN
    ('portal_county','project_address','raw_metadata','project_text','agency_jurisdiction','document','geocode')),
  source_priority integer NOT NULL CHECK (source_priority BETWEEN 1 AND 7),
  county_fips text[] NOT NULL DEFAULT '{}',
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  authoritative boolean NOT NULL DEFAULT false,
  project_specific boolean NOT NULL DEFAULT true,
  raw_value jsonb,
  diagnostics jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_candidate_id, resolver_version, evidence_source, source_priority, county_fips)
);
CREATE INDEX IF NOT EXISTS idx_opportunity_geography_evidence_candidate
  ON public.opportunity_geography_evidence (opportunity_candidate_id, resolver_version);

CREATE TABLE IF NOT EXISTS public.user_opportunity_geography_shadow (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  profile_version integer NOT NULL,
  resolver_version text NOT NULL,
  geography_status text NOT NULL CHECK (geography_status IN
    ('confirmed_match','probable_match','confirmed_outside','probable_outside','conflict','unresolved')),
  resolved_county_fips text[] NOT NULL DEFAULT '{}',
  confidence numeric(4,3),
  shadow boolean NOT NULL DEFAULT true CHECK (shadow),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, opportunity_candidate_id, profile_version, resolver_version)
);
CREATE INDEX IF NOT EXISTS idx_user_opportunity_geography_shadow_summary
  ON public.user_opportunity_geography_shadow (user_id, profile_version, geography_status);

ALTER TABLE public.california_counties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.california_city_counties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_jurisdictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_geography_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_opportunity_geography_shadow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read California counties" ON public.california_counties FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read California cities" ON public.california_city_counties FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read agency jurisdictions" ON public.agency_jurisdictions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can read own geography shadow" ON public.user_opportunity_geography_shadow FOR SELECT TO authenticated USING (user_id=auth.uid());
GRANT SELECT ON public.california_counties, public.california_city_counties, public.agency_jurisdictions TO authenticated;
GRANT SELECT ON public.user_opportunity_geography_shadow TO authenticated;
GRANT ALL ON public.california_counties, public.california_city_counties, public.agency_jurisdictions,
  public.opportunity_geography_evidence, public.user_opportunity_geography_shadow TO service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('geography_visibility_v1_enabled', '{"enabled":false,"resolver_version":"ca-geography-v1"}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;
