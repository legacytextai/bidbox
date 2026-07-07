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

    let sourceCandidateId = projectData.source_opportunity_candidate_id || null;
    if (!sourceCandidateId) {
      const { data: candidateLink, error: candidateLinkError } = await supabase
        .from('opportunity_candidates')
        .select('id')
        .eq('converted_project_id', projectData.id)
        .maybeSingle();
      if (candidateLinkError) {
        console.error('Error resolving source opportunity candidate:', candidateLinkError);
      } else {
        sourceCandidateId = candidateLink?.id || null;
      }
    }

    let sourceDocuments: any[] = [];
    if (sourceCandidateId) {
      const { data: sourceDocsData, error: sourceDocsError } = await supabase
        .from('opportunity_documents')
        .select('id, file_name, file_size, file_type, document_family, document_class, storage_bucket, storage_path, source_url, document_source_order, created_at')
        .eq('opportunity_candidate_id', sourceCandidateId)
        .eq('acquisition_status', 'acquired')
        .not('storage_path', 'is', null)
        .order('document_source_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });

      if (sourceDocsError) {
        console.error('Error fetching source opportunity documents:', sourceDocsError);
      } else {
        sourceDocuments = await Promise.all((sourceDocsData || []).map(async (doc: any) => {
          if (!doc.storage_path) {
            return { ...doc, signed_url: null };
          }

          const bucket = doc.storage_bucket || 'opportunity-documents';
          const { data: signedUrlData, error: signedUrlError } = await supabase.storage
            .from(bucket)
            .createSignedUrl(doc.storage_path, 60 * 60);

          if (signedUrlError) {
            console.error('Error creating source document signed URL:', {
              document_id: doc.id,
              bucket,
              error: signedUrlError.message,
            });
            return { ...doc, signed_url: null };
          }

          return { ...doc, signed_url: signedUrlData?.signedUrl ?? null };
        }));
      }
    }

    console.log('Source opportunity documents found:', sourceDocuments.length);

    // Fetch associated trades with trade type info
    const { data: tradesData, error: tradesError } = await supabase
      .from('project_trades')
      .select(`
        trade_type_id,
        trade_types!inner(
          id,
          code,
          name,
          category
        )
      `)
      .eq('project_id', projectData.id);

    if (tradesError) {
      console.error('Error fetching trades:', tradesError);
      // Don't fail the request, just log and continue with empty trades
    }

    // Transform trades data to a simple array
    const trades = (tradesData || []).map((t: any) => ({
      id: t.trade_types.id,
      code: t.trade_types.code,
      name: t.trade_types.name,
      category: t.trade_types.category
    }));

    console.log('Trades found:', trades.length);

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
        source_documents: sourceDocuments,
        trades
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
