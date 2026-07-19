@AGENTS.md

# Claude Code-specific instructions

All shared UsefulDesk product and engineering guidance is canonical in `AGENTS.md`. Do not copy shared rules into this file; update `AGENTS.md` or its routed documentation instead.

When applying a Supabase migration from Claude Code, use the Supabase MCP `apply_migration` tool against project `UsefulDesk` (`fwqthstqrkrwtaehefks`), then verify the resulting schema and policies with a database query. Do not use `supabase db push`; the remote history includes MCP-applied timestamped migrations and does not match the CLI history.
