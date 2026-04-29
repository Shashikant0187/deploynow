const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const simpleGit = require("simple-git");
const os = require("os");
const path = require("path");
const fs = require("fs");
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
    createdAt: new Date().toISOString(),
  };

  db.data.deployments.push(deployment);
  await db.write();

  res.json(deployment);

  runDeployment(id, repoUrl, projectPath);
});

app.post("/deploy/:id/stop", async (req, res) => {
  const id = req.params.id;

  exec(`pm2 stop "${id}"`, async (err, stdout, stderr) => {
    console.log("PM2 STOP:", stdout, stderr);

    if (err) {
      return res.status(500).json({ error: "Failed to stop process" });
    }

    // update status in DB
    await db.read();
    const item = db.data.deployments.find(d => d.id === id);

    if (item) {
      item.status = "stopped";
      await db.write();
    }

    res.json({ success: true });
  });
});

// ===== LOGS =====
app.get("/logs/:id", async (req, res) => {
  const id = req.params.id;

  let logs = "";

  try {
    // ===== 1. READ DEPLOY LOG =====
    const deployLogPath = path.join(__dirname, "apps", id, "deploy.log");

    if (fs.existsSync(deployLogPath)) {
      const deployLogs = fs.readFileSync(deployLogPath, "utf-8");
      logs += deployLogs;
    }

    logs += "\n\n--- APP LOGS ---\n";

    // ===== 2. READ PM2 LOGS =====
    const logDir = path.join(os.homedir(), ".pm2/logs");

    const outLog = path.join(logDir, `${id}-out.log`);
    const errLog = path.join(logDir, `${id}-error.log`);

    if (fs.existsSync(outLog)) {
      const outData = fs.readFileSync(outLog, "utf-8");
      const MAX_LINES = 20;

      const lines = outData.split("\n");

      // remove empty + duplicates
      const filtered = [...new Set(lines.filter(line => line.trim()))];

      logs += filtered.slice(-MAX_LINES).join("\n");
    }

    if (fs.existsSync(errLog)) {
      const errData = fs.readFileSync(errLog, "utf-8");
      logs += "\n\n--- ERRORS ---\n";
      logs += errData.split("\n").slice(-50).join("\n");
    }

    // ===== 3. CHECK STATUS =====
    await db.read();
    const deployment = db.data.deployments.find(d => d.id === id);

    if (deployment?.status === "stopped") {
      logs += "\n\n[INFO] App is currently stopped";
    }

    // ===== 4. FALLBACK =====
    if (!logs.trim()) {
      logs = "No logs available yet...";
    }

    res.json({ logs });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read logs" });
  }
});
// ===== DELETE =====
app.delete("/deploy/:id", async (req, res) => {
  const id = req.params.id;

  exec(`pm2 delete "${id}"`, async (err, stdout, stderr) => {
    console.log("PM2 DELETE:", stdout, stderr);

    // don't fail hard if pm2 fails
    // because process may already be gone

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
    appendLog(id, "[CLONE] Cloning repository...");

    // Clean old folder
    fs.rmSync(projectPath, { recursive: true, force: true });

    const git = simpleGit();

    try {
      await git.clone(repoUrl, projectPath);
      appendLog(id, "[CLONE] Repository cloned");
    } catch (err) {
      appendLog(id, "[ERROR] Clone failed");
      appendLog(id, err.message);
      return failDeployment(id);
    }

    console.log("PROJECT PATH:", projectPath);

    // ===== INSTALL =====
    appendLog(id, "[INSTALL] Installing dependencies...");

    exec(`cd ${projectPath} && npm install`, async (err, stdout, stderr) => {
      console.log("INSTALL STDOUT:", stdout);
      console.log("INSTALL STDERR:", stderr);

      if (err) {
        appendLog(id, "[ERROR] Install failed");
        appendLog(id, stderr || err.message);
        return failDeployment(id);
      }

      appendLog(id, "[INSTALL] Dependencies installed");

      // ===== READ package.json =====
      const packageJsonPath = path.join(projectPath, "package.json");

      if (!fs.existsSync(packageJsonPath)) {
        appendLog(id, "[ERROR] package.json not found");
        return failDeployment(id);
      }

      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const hasBuild = pkg.scripts && pkg.scripts.build;

      // ===== BUILD =====
      if (hasBuild) {
        appendLog(id, "[BUILD] Running build...");
        await updateStatus(id, "building");

        exec(`cd ${projectPath} && npm run build`, async (err) => {
          if (err) {
            appendLog(id, "[ERROR] Build failed");
            return failDeployment(id);
          }

          appendLog(id, "[BUILD] Build completed");
          startApp(id, projectPath);
        });

      } else {
        appendLog(id, "[BUILD] No build step, skipping");
        startApp(id, projectPath);
      }
    });

  } catch (err) {
    appendLog(id, "[ERROR] Deployment crashed");
    appendLog(id, err.message);
    await failDeployment(id);
  }
}
// ===== START APP =====

function startApp(id, projectPath) {
  const port = getFreePort();

  appendLog(id, "[START] Starting application...");
  console.log("🚀 Starting app on port:", port);

  const buildPath = path.join(projectPath, "build");
  const distPath = path.join(projectPath, "dist");

  // ===== REACT =====
  if (fs.existsSync(buildPath)) {
    exec(
      `cd ${projectPath} && pm2 start "npx serve -s build -l ${port}" --name "${id}"`,
      async (err) => {
        if (err) {
          appendLog(id, "[ERROR] Failed to start React app");
          return failDeployment(id);
        }

        appendLog(id, "[START] Application running");
        await updateStatus(id, "success", `http://localhost:${port}`);
      }
    );

    // ===== VITE =====
  } else if (fs.existsSync(distPath)) {
    exec(
      `cd ${projectPath} && pm2 start "npx serve -s dist -l ${port}" --name "${id}"`,
      async (err) => {
        if (err) {
          appendLog(id, "[ERROR] Failed to start Vite app");
          return failDeployment(id);
        }

        appendLog(id, "[START] Application running");
        await updateStatus(id, "success", `http://localhost:${port}`);
      }
    );

    // ===== NODE =====
  } else {
    exec(
      `cd ${projectPath} && PORT=${port} pm2 start npm --name "${id}" -- start`,
      async (err) => {
        if (err) {
          appendLog(id, "[ERROR] Failed to start Node app");
          return failDeployment(id);
        }

        appendLog(id, "[START] Application running");
        await updateStatus(id, "success", `http://localhost:${port}`);
      }
    );
  }
}

//===========log writer function================
function appendLog(id, message) {
  const logFile = path.join(__dirname, "apps", id, "deploy.log");

  // ensure folder exists
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  const time = new Date().toLocaleTimeString();

  fs.appendFileSync(logFile, `[${time}] ${message}\n`);
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

// ===== START SERVER =====

initDB().then(() => {
  app.listen(5000, () => {
    console.log("✅ Server running on port 5000");
  });
});
