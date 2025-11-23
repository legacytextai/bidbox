-- Create profiles table for GC users
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  company_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Create projects table
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gc_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  agency TEXT NOT NULL,
  bid_due_at TIMESTAMPTZ NOT NULL,
  instructions TEXT,
  status TEXT NOT NULL DEFAULT 'LIVE' CHECK (status IN ('LIVE', 'DEAD')),
  public_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Projects policies
CREATE POLICY "GCs can view their own projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = gc_id);

CREATE POLICY "GCs can create projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = gc_id);

CREATE POLICY "GCs can update their own projects"
  ON public.projects FOR UPDATE
  USING (auth.uid() = gc_id);

CREATE POLICY "GCs can delete their own projects"
  ON public.projects FOR DELETE
  USING (auth.uid() = gc_id);

-- Public can view projects by token (for bid submission)
CREATE POLICY "Anyone can view projects by public token"
  ON public.projects FOR SELECT
  USING (true);

-- Create project_files table
CREATE TABLE public.project_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

-- Project files policies
CREATE POLICY "GCs can view files for their projects"
  ON public.project_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_files.project_id
      AND projects.gc_id = auth.uid()
    )
  );

CREATE POLICY "GCs can add files to their projects"
  ON public.project_files FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_files.project_id
      AND projects.gc_id = auth.uid()
    )
  );

CREATE POLICY "GCs can delete files from their projects"
  ON public.project_files FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_files.project_id
      AND projects.gc_id = auth.uid()
    )
  );

-- Public can view files for projects they have token for
CREATE POLICY "Anyone can view project files"
  ON public.project_files FOR SELECT
  USING (true);

-- Create bids table
CREATE TABLE public.bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  bidder_name TEXT,
  company_name TEXT,
  email TEXT,
  bid_item TEXT
);

-- Enable RLS
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

-- Bids policies
CREATE POLICY "GCs can view bids for their projects"
  ON public.bids FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = bids.project_id
      AND projects.gc_id = auth.uid()
    )
  );

-- Public can submit bids (insert only)
CREATE POLICY "Anyone can submit bids"
  ON public.bids FOR INSERT
  WITH CHECK (true);

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) 
VALUES ('project-files', 'project-files', false);

INSERT INTO storage.buckets (id, name, public) 
VALUES ('bid-submissions', 'bid-submissions', false);

-- Storage policies for project-files
CREATE POLICY "GCs can upload project files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'project-files' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "GCs can view their project files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'project-files' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "GCs can delete their project files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'project-files' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage policies for bid-submissions
CREATE POLICY "Anyone can upload bid submissions"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'bid-submissions');

CREATE POLICY "GCs can view bid submissions for their projects"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'bid-submissions');

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, company_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'company_name'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();