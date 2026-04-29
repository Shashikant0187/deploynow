const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const simpleGit = require("simple-git");
const path = require("path");
const { exec } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json());

// ===== DB =====
const adapter = new JSONFile("db.json");
const db = new Low(adapter, { deployments: [] });

async function initDB() {
  await db.read();
  db.data ||= { deployments: [] };
  await db.write();
}

// ===== ROUTES =====

app.get("/", (req, res) => {
  res.send("DeployNow Backend Running 🚀");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/deployments", async (req, res) => {
  await db.read();
  res.json(db.data.deployments);
});

app.post("/deploy", async (req, res) => {
  const { repoUrl } = req.body;

  if (!repoUrl) {
    return res.status(400).json({ error: "repoUrl required" });
  }

  await db.read();

  const id = uuidv4();
  const projectPath = path.join(__dirname, "apps", id);

  const deployment = {
    id,
    repoUrl,
    status: "cloning",
    url: null,
    createdAt: new Date().toISOString()
  };

  db.data.deployments.push(deployment);
  await db.write();

  res.json(deployment);

  runDeployment(id, repoUrl, projectPath);
});

app.get("/logs/:id", (req, res) => {
  const id = req.params.id;

  exec(`pm2 logs ${id} --lines 50 --nostream`, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: "Failed to get logs" });
    }

    res.json({ logs: stdout });
  });
});

app.post("/deploy/:id/stop", (req, res) => {
  const id = req.params.id;

  exec(`pm2 stop ${id}`, async (err) => {
    if (err) return res.status(500).json({ error: "Failed to stop" });

    await updateStatus(id, "stopped");
    res.json({ success: true });
  });
});

app.delete("/deploy/:id", async (req, res) => {
  const id = req.params.id;

  exec(`pm2 delete ${id}`, async (err) => {
    if (err) return res.status(500).json({ error: "Failed to delete" });

    await db.read();
    db.data.deployments = db.data.deployments.filter(d => d.id !== id);
    await db.write();

    res.json({ success: true });
  });
});
// ===== DEPLOY ENGINE =====

async function runDeployment(id, repoUrl, projectPath) {
  console.log("🚀 Starting deployment:", repoUrl);

  try {
    const git = simpleGit();

    // CLONE
    await git.clone(repoUrl, projectPath);
    console.log("✅ Repo cloned");

    await updateStatus(id, "installing");

    // INSTALL
    exec(`cd ${projectPath} && npm install`, async (err, stdout, stderr) => {
      if (err) {
        console.log("❌ Install failed:");
        console.log(stderr);
        return failDeployment(id);
      }

      console.log("✅ Dependencies installed");

      await updateStatus(id, "running");

      const port = getFreePort();

      // START
exec(
  `cd ${projectPath} && PORT=${port} pm2 start npm --name ${id} -- start`,
  (err) => {
    if (err) {
      console.log("❌ PM2 start failed:", err);
      return failDeployment(id);
    }
  }
);
      console.log("🔥 App running on port:", port);

      await updateStatus(id, "success", `http://localhost:${port}`);
    });

  } catch (err) {
    console.log("❌ Clone failed:", err.message);
    await failDeployment(id);
  }
}

// ===== HELPERS =====

async function updateStatus(id, status, url = null) {
  await db.read();
  const item = db.data.deployments.find(d => d.id === id);
  if (!item) return;

  item.status = status;
  if (url) item.url = url;

  await db.write();
}

async function failDeployment(id) {
  await updateStatus(id, "failed");
}

function getFreePort() {
  return Math.floor(3000 + Math.random() * 1000);
}

// ===== START =====

initDB().then(() => {
  app.listen(5000, () => {
    console.log("✅ Server running on port 5000");
  });
});
