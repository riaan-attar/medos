export default function Setup() {
  return (
    <div className="center-screen">
      <div className="card narrow">
        <h1>MedOS setup needed</h1>
        <p>Supabase credentials are missing. To finish setup:</p>
        <ol>
          <li>Create a project at <b>supabase.com</b>.</li>
          <li>Run <code>supabase/migrations/20261004000000_init.sql</code> in the SQL Editor.</li>
          <li>Copy <code>.env.example</code> to <code>.env</code> and fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.</li>
          <li>Restart <code>npm run dev</code>.</li>
        </ol>
        <p className="muted">Full instructions are in README.md and PROGRESS.md.</p>
      </div>
    </div>
  )
}
