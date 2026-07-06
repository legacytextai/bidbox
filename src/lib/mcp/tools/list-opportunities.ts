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
  name: "list_opportunities",
  title: "List opportunities",
  description: "List public-works bid opportunities discovered by BidBox, filterable by county and search term.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 25)."),
    county: z.string().optional().describe("Filter by county name, e.g. 'Los Angeles'."),
    search: z.string().optional().describe("Free-text match against title/agency."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, county, search }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let q = sb(ctx)
      .from("opportunities")
      .select("id,title,agency,county,bid_due_at,estimated_value,source_url,status")
      .order("bid_due_at", { ascending: true, nullsFirst: false })
      .limit(limit ?? 25);
    if (county) q = q.eq("county", county);
    if (search) q = q.or(`title.ilike.%${search}%,agency.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { opportunities: data ?? [] },
    };
  },
});
