import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_project",
  title: "Get project",
  description: "Fetch a single BidBox project with its files and bid submissions.",
  inputSchema: {
    project_id: z.string().uuid().describe("Project UUID."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const client = sb(ctx);
    const [{ data: project, error: pErr }, { data: files }, { data: bids }] = await Promise.all([
      client.from("projects").select("*").eq("id", project_id).maybeSingle(),
      client.from("project_files").select("id,file_name,file_url,created_at").eq("project_id", project_id),
      client.from("bids").select("id,submitted_at,bidder_name,company_name,email,division,file_url").eq("project_id", project_id),
    ]);
    if (pErr) return { content: [{ type: "text", text: pErr.message }], isError: true };
    if (!project) return { content: [{ type: "text", text: "Project not found or not accessible" }], isError: true };
    const payload = { project, files: files ?? [], bids: bids ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
