import { useState, useEffect } from "react";

function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState("");
  const [showLogs, setShowLogs] = useState(false);

  const handleDeploy = async () => {
    if (!repoUrl) return alert("Enter repo URL");

    setLoading(true);

    await fetch("http://localhost:5000/deploy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repoUrl }),
    });

    setRepoUrl("");
    setLoading(false);
    fetchDeployments();
  };

  const fetchDeployments = async () => {
    const res = await fetch("http://localhost:5000/deployments");
    const data = await res.json();
    setDeployments(data.reverse());
  };

  const handleLogs = async (id) => {
    const res = await fetch(`http://localhost:5000/logs/${id}`);
    const data = await res.json();
    setLogs(data.logs);
    setShowLogs(true);
  };

  const handleStop = async (id) => {
    await fetch(`http://localhost:5000/deploy/${id}/stop`, {
      method: "POST",
    });
    fetchDeployments();
  };

  const handleDelete = async (id) => {
    await fetch(`http://localhost:5000/deploy/${id}`, {
      method: "DELETE",
    });
    fetchDeployments();
  };

  useEffect(() => {
    fetchDeployments();
    const interval = setInterval(fetchDeployments, 3000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status) => {
    switch (status) {
      case "success":
        return "green";
      case "failed":
        return "red";
      case "running":
        return "blue";
      case "installing":
        return "orange";
      default:
        return "gray";
    }
  };

  return (
    <div style={{ fontFamily: "Arial", padding: "30px", background: "#f5f7fa", minHeight: "100vh" }}>
      <h1>🚀 DeployNow</h1>
      <p>Deploy your GitHub projects instantly</p>

      {/* INPUT */}
      <div style={{ marginBottom: "20px" }}>
        <input
          type="text"
          placeholder="https://github.com/user/project"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          style={{
            width: "400px",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            marginRight: "10px"
          }}
        />

        <button
          onClick={handleDeploy}
          disabled={loading}
          style={{
            padding: "10px 20px",
            background: loading ? "#999" : "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer"
          }}
        >
          {loading ? "Deploying..." : "Deploy"}
        </button>
      </div>

      <h2>Your Deployments</h2>

      {/* DEPLOYMENTS */}
      {deployments.map((d) => (
        <div
          key={d.id}
          style={{
            background: "white",
            padding: "15px",
            marginBottom: "10px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
          }}
        >
          <p><strong>Repo:</strong> {d.repoUrl}</p>

          <p>
            <strong>Status:</strong>{" "}
            <span style={{ color: getStatusColor(d.status), fontWeight: "bold" }}>
              {d.status}
            </span>
          </p>

          {d.url && (
            <a href={d.url} target="_blank">
              🌐 Visit Deployment
            </a>
          )}

          {/* ACTION BUTTONS */}
          <div style={{ marginTop: "10px" }}>
            <button onClick={() => handleLogs(d.id)}>Logs</button>

            <button
              onClick={() => handleStop(d.id)}
              style={{ marginLeft: "10px" }}
            >
              Stop
            </button>

            <button
              onClick={() => handleDelete(d.id)}
              style={{ marginLeft: "10px", color: "red" }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {/* LOG MODAL */}
      {showLogs && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        }}>
          <div style={{
            background: "white",
            padding: "20px",
            width: "70%",
            maxHeight: "80%",
            overflow: "auto",
            borderRadius: "8px"
          }}>
            <h3>Logs</h3>
            <pre style={{ fontSize: "12px" }}>{logs}</pre>

            <button onClick={() => setShowLogs(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
