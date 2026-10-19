// Public config. The anon key is safe to publish: every table is locked by Row Level Security
// to the single owner account, and the anon role has no table grants at all.
window.JT_CONFIG = {
  url: 'https://xxpqwatmdtkvaxtljxae.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4cHF3YXRtZHRrdmF4dGxqeGFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNjYxNDMsImV4cCI6MjEwNzk0MjE0M30.vqSAc4emno5kEZX-q58RqFyk8CQoEMcJ2qppNUUKZzc',
  schema: 'jobs',
  goalDate: '2026-12-31',
  weeklyTarget: [10, 15],
  warmTarget: 0.7,
};
