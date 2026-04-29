import "./App.css";
import { useState, useEffect, useRef } from "react";

function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(false);

  const [logs, setLogs] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [activeLogId, setActiveLogId] = useState(null);

  const logRef = useRef(null);

  // 🚀 Deploy
  const handleDeploy = async () => {
    if (!repoUrl) return alert("Enter repo URL");

    setLoading(true);

    await fetch("http://localhost:5000/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl }),
    });

    setRepoUrl("");
    setLoading(false);
    fetchDeployments();
  };

  // 📦 Fetch deployments
  const fetchDeployments = async () => {
    const res = await fetch("http://localhost:5000/deployments");
    const data = await res.json();
    setDeployments(data.reverse());
  };

  // 📜 Open logs
const handleLogs = (id) => {
  console.log("CLICKED LOGS:", id);  // 👈 add this
  setShowLogs(true);
  setLogs("");
  setLogsLoading(true);
  setActiveLogId(id);
};
  // 🔁 Poll logs (auto refresh)
  useEffect(() => {
    if (!showLogs || !activeLogId) return;

    const fetchLogs = async () => {
      try {
        const res = await fetch(`http://localhost:5000/logs/${activeLogId}`);
        const data = await res.json();

        const logText =
          !data.logs || data.logs === "No logs found"
            ? ""
            : Array.isArray(data.logs)
            ? data.logs.join("\n")
            : data.logs;

        setLogs(logText);
        setLogsLoading(false);
      } catch {
        setLogs("Error fetching logs...");
        setLogsLoading(false);
      }
    };

    fetchLogs(); // initial
    const interval = setInterval(fetchLogs, 2000);

    return () => clearInterval(interval);
  }, [showLogs, activeLogId]);

  // ⏬ Auto scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // ⛔ Stop
  const handleStop = async (id) => {
    await fetch(`http://localhost:5000/deploy/${id}/stop`, {
      method: "POST",
    });
    fetchDeployments();
  };

  // 🗑 Delete
  const handleDelete = async (id) => {
    await fetch(`http://localhost:5000/deploy/${id}`, {
      method: "DELETE",
    });
    fetchDeployments();
  };

  // 🔄 Initial load
  useEffect(() => {
    fetchDeployments();
    const interval = setInterval(fetchDeployments, 3000);
    return () => clearInterval(interval);
  }, []);

  // 📊 Stats
  const stats = {
    total: deployments.length,
    running: deployments.filter(d => d.status === "running").length,
    success: deployments.filter(d => d.status === "success").length,
    failed: deployments.filter(d => d.status === "failed").length,
  };

  return (
    <div className="container">

      {/* Sidebar */}
      <div className="sidebar">
        <h2>🚀 DeployNow</h2>
        <p>Dashboard</p>
      </div>

      {/* Main */}
      <div className="main">

        <div className="header">
          <h1>Deploy Dashboard</h1>
          <p>Deploy and manage your applications</p>
        </div>

        {/* Input */}
        <div className="deploy-box">
          <input
            type="text"
            placeholder="https://github.com/user/project"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <button onClick={handleDeploy} disabled={loading}>
            {loading ? "Deploying..." : "Deploy"}
          </button>
        </div>

        {/* Stats */}
        <div className="stats">
          <div className="card"><h3>Total</h3><h2>{stats.total}</h2></div>
          <div className="card"><h3>Running</h3><h2>{stats.running}</h2></div>
          <div className="card"><h3>Success</h3><h2>{stats.success}</h2></div>
          <div className="card"><h3>Failed</h3><h2>{stats.failed}</h2></div>
        </div>

        {/* Deployments */}
        <div className="deployments">
          <h2>Recent Deployments</h2>

          {deployments.slice(0, 10).map((d) => (
            <div key={d.id} className="deploy-card">

              <div>
                <p className="repo">{d.repoUrl}</p>
                <p className={`status status-${d.status}`}>{d.status}</p>

                {d.url && (
                  <a href={d.url} target="_blank" rel="noreferrer">
                    🌐 Visit
                  </a>
                )}
              </div>

              <div className="actions">
                <button onClick={() => handleLogs(d.id)}>Logs</button>
                <button className="btn-stop" onClick={() => handleStop(d.id)}>Stop</button>
                <button className="btn-delete" onClick={() => handleDelete(d.id)}>Delete</button>
              </div>

            </div>
          ))}
        </div>
      </div>

      {/* Logs Modal */}
      {showLogs && (
        <div className="modal">
          <div className="modal-box">

            <div className="modal-header">
              <h3>Logs</h3>
              <button onClick={() => setShowLogs(false)}>✖</button>
            </div>

            <div className="log-content" ref={logRef}>
              {logsLoading ? (
                <p className="no-logs">⏳ Fetching logs...</p>
              ) : (
                <pre>{logs || "No logs yet..."}</pre>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default App;