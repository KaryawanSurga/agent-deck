export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Deck</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    background: #0a0a0b; color: #e6edf3;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  header {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 18px; border-bottom: 1px solid #1f2937;
  }
  h1 { font-size: 15px; margin: 0; letter-spacing: 0.4px; }
  .muted { color: #8b949e; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: #6e7681; }
  .dot.running { background: #3fb950; }
  .dot.idle { background: #d29922; }
  .dot.failed { background: #f85149; }
  .dot.exited, .dot.stopped { background: #6e7681; }
  main { flex: 1; display: grid; grid-template-columns: 320px 1fr; min-height: 0; }
  aside { border-right: 1px solid #1f2937; padding: 14px; overflow-y: auto; }
  section { min-height: 0; display: flex; flex-direction: column; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: #8b949e; margin: 16px 0 8px; }
  h2:first-child { margin-top: 0; }
  .agent, .session {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 8px 10px; border: 1px solid #1f2937; border-radius: 8px; margin-bottom: 6px;
    background: #0f1520; cursor: pointer;
  }
  .session.active { border-color: #58a6ff; }
  .session .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session .meta { color: #8b949e; font-size: 11px; }
  button {
    font: inherit; font-size: 11px; padding: 4px 10px; border-radius: 999px;
    border: 1px solid #30363d; background: #161b22; color: #e6edf3; cursor: pointer;
  }
  button:hover { background: #21262d; }
  button.primary { background: #e6edf3; color: #0a0a0b; border-color: #e6edf3; }
  #output-header { padding: 10px 18px; border-bottom: 1px solid #1f2937; display: flex; align-items: center; gap: 10px; }
  #output {
    flex: 1; margin: 0; padding: 14px 18px; overflow: auto; white-space: pre-wrap; word-break: break-word;
    background: #07090c; color: #c9d1d9;
  }
  footer { padding: 8px 18px; border-top: 1px solid #1f2937; color: #8b949e; font-size: 11px; }
  .empty { color: #8b949e; padding: 20px; }
</style>
</head>
<body>
<header>
  <h1>Agent Deck</h1>
  <span id="connection" class="dot"></span>
  <span id="connection-text" class="muted">connecting…</span>
  <span style="flex:1"></span>
  <span id="counts" class="muted"></span>
</header>
<main>
  <aside>
    <h2>Agents</h2>
    <div id="agents"></div>
    <h2>Sessions</h2>
    <div id="sessions"></div>
  </aside>
  <section>
    <div id="output-header">
      <span class="dot" id="selected-dot"></span>
      <strong id="selected-name">no session selected</strong>
      <span class="muted" id="selected-meta"></span>
      <span style="flex:1"></span>
      <button id="stop-button" hidden>Stop</button>
    </div>
    <pre id="output" class="empty">Start an agent or pick a session to watch its output.</pre>
  </section>
</main>
<footer>live via Server-Sent Events · local only · state in .agent-deck/</footer>
<script>
const $ = (id) => document.getElementById(id);
let agents = [];
let sessions = [];
let selectedId = null;

function statusDot(status) {
  const span = document.createElement("span");
  span.className = "dot " + status;
  return span;
}

function renderAgents() {
  const container = $("agents");
  container.textContent = "";
  for (const agent of agents) {
    const row = document.createElement("div");
    row.className = "agent";
    const info = document.createElement("span");
    info.className = "name";
    info.textContent = agent.name;
    if (agent.description) {
      info.title = agent.description;
    }
    const button = document.createElement("button");
    button.className = "primary";
    button.textContent = "Start";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await fetch("/api/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agent: agent.name }),
        });
      } finally {
        button.disabled = false;
      }
    });
    row.append(info, button);
    container.append(row);
  }
}

function renderSessions() {
  const container = $("sessions");
  container.textContent = "";
  $("counts").textContent = sessions.length + " session(s)";
  for (const session of sessions) {
    const row = document.createElement("div");
    row.className = "session" + (session.id === selectedId ? " active" : "");
    row.addEventListener("click", () => selectSession(session.id));

    const left = document.createElement("span");
    left.className = "name";
    left.append(statusDot(session.liveStatus), document.createTextNode(" " + session.agent));
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = (session.transport === "pty" ? "pty · " : "") + session.liveStatus + " · " + new Date(session.startedAt).toLocaleTimeString();
    left.append(document.createElement("br"), meta);

    const stop = document.createElement("button");
    stop.textContent = "Stop";
    stop.hidden = session.liveStatus !== "running" && session.liveStatus !== "idle";
    stop.addEventListener("click", async (event) => {
      event.stopPropagation();
      stop.disabled = true;
      await fetch("/api/sessions/" + encodeURIComponent(session.id) + "/stop", { method: "POST" });
    });

    row.append(left, stop);
    container.append(row);
  }
  renderSelectedHeader();
}

function renderSelectedHeader() {
  const session = sessions.find((entry) => entry.id === selectedId);
  $("selected-dot").className = "dot" + (session ? " " + session.liveStatus : "");
  $("selected-name").textContent = session ? session.agent + " · " + session.id : "no session selected";
  $("selected-meta").textContent = session ? (session.transport === "pty" ? "pty · " : "") + session.command.join(" ") : "";
  $("stop-button").hidden = !session || (session.liveStatus !== "running" && session.liveStatus !== "idle");
}

async function selectSession(id) {
  selectedId = id;
  renderSessions();
  const output = $("output");
  output.classList.remove("empty");
  output.textContent = "loading…\\n";
  const response = await fetch("/api/sessions/" + encodeURIComponent(id) + "/log?tail=300");
  const payload = await response.json();
  output.textContent = payload.log + "\\n";
  output.scrollTop = output.scrollHeight;
}

function appendOutput(sessionId, chunk) {
  if (sessionId !== selectedId) {
    return;
  }
  const output = $("output");
  if (output.classList.contains("empty")) {
    output.classList.remove("empty");
    output.textContent = "";
  }
  output.textContent += chunk;
  output.scrollTop = output.scrollHeight;
}

function connect() {
  const source = new EventSource("/api/events");
  source.addEventListener("open", () => {
    $("connection").className = "dot running";
    $("connection-text").textContent = "live";
  });
  source.addEventListener("snapshot", (event) => {
    const payload = JSON.parse(event.data);
    sessions = payload.sessions;
    renderSessions();
  });
  source.addEventListener("session", (event) => {
    const session = JSON.parse(event.data);
    const index = sessions.findIndex((entry) => entry.id === session.id);
    if (index === -1) {
      sessions.unshift(session);
    } else {
      sessions[index] = session;
    }
    renderSessions();
  });
  source.addEventListener("output", (event) => {
    const payload = JSON.parse(event.data);
    appendOutput(payload.sessionId, payload.chunk);
  });
  source.addEventListener("error", () => {
    $("connection").className = "dot failed";
    $("connection-text").textContent = "reconnecting…";
  });
}

$("stop-button").addEventListener("click", async () => {
  if (selectedId) {
    await fetch("/api/sessions/" + encodeURIComponent(selectedId) + "/stop", { method: "POST" });
  }
});

async function bootstrap() {
  agents = (await (await fetch("/api/agents")).json()).agents;
  renderAgents();
  sessions = (await (await fetch("/api/sessions")).json()).sessions;
  renderSessions();
  connect();
}

bootstrap();
</script>
</body>
</html>`;
}
