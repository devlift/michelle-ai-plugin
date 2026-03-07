-- Migration 005: Enable Realtime for live updates
-- Admin inbox and visitor widget subscribe to these tables.

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;
