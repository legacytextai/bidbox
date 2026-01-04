import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();

    if (!token) {
      console.error('No token provided');
      return new Response(
        JSON.stringify({ error: 'Token is required' }), 
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log('Fetching project with token:', token);

    // Fetch project by public token with GC profile info
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select(`
        *,
        profiles!projects_gc_id_fkey(company_name, estimating_email, email)
      `)
      .eq('public_token', token)
      .eq('status', 'LIVE')
      .single();

    if (projectError || !projectData) {
      console.error('Project not found:', projectError);
      return new Response(
        JSON.stringify({ error: 'Project not found' }), 
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Project found:', projectData.id);

    // Increment view count (anonymous tracking - no PII collected)
    const { error: viewError } = await supabase.rpc('increment_view_count', {
      p_project_id: projectData.id
    });
    
    if (viewError) {
      console.error('Error incrementing view count:', viewError);
      // Don't fail the request, just log the error
    } else {
      console.log('View count incremented for project:', projectData.id);
    }

    // Fetch associated files
    const { data: filesData, error: filesError } = await supabase
      .from('project_files')
      .select('*')
      .eq('project_id', projectData.id);

    if (filesError) {
      console.error('Error fetching files:', filesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch project files' }), 
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Files found:', filesData?.length || 0);

    // Extract GC profile info from joined data
    const gcCompanyName = projectData.profiles?.company_name || null;
    const gcEstimatingEmail = projectData.profiles?.estimating_email || null;
    const gcEmail = projectData.profiles?.email || null;
    
    // Remove the nested profiles object from projectData
    const { profiles, ...project } = projectData;

    return new Response(
      JSON.stringify({
        project: {
          ...project,
          gc_company_name: gcCompanyName,
          gc_estimating_email: gcEstimatingEmail,
          gc_email: gcEmail
        },
        files: filesData || []
      }), 
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }), 
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
