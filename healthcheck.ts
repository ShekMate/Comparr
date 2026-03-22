const host = (Deno.env.get("HOST") ?? "0.0.0.0").trim() || "0.0.0.0";
const probeHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const port = (Deno.env.get("PORT") ?? "8000").trim() || "8000";
const r = await fetch(`http://${probeHost}:${port}/api/health`);
if (!r.ok) Deno.exit(1);
