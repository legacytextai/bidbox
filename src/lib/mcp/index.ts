import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProjects from "./tools/list-projects";
import getProject from "./tools/get-project";
import listOpportunities from "./tools/list-opportunities";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "bidbox-mcp",
  title: "BidBox",
  version: "0.1.0",
  instructions:
    "Tools for BidBox — the bid room for general contractors. Use `list_projects` and `get_project` to inspect the signed-in user's bid projects, files, and subcontractor bid submissions. Use `list_opportunities` to browse discovered public-works bid opportunities.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProjects, getProject, listOpportunities],
});
