import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { runPipeline, widenPipeline } from "./run-pipeline.js";
import { exportBuyers } from "./export.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "output");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let runInProgress = false;

// Single-slot in-memory state storage — keyed by targetUrl
let lastRunState = null; // { targetUrl, state: _internalState }

app.post("/run", async (req, res) => {
  if (runInProgress) {
    return res.status(409).json({
      success: false,
      error: "A pipeline run is already in progress. Please wait for it to finish.",
    });
  }

  const { targetUrl } = req.body;
  if (!targetUrl) {
    return res.status(400).json({ success: false, error: "targetUrl is required" });
  }

  runInProgress = true;
  try {
    const result = await runPipeline(targetUrl, {
      maxQueries: 3,
      maxUrls: 12,
      maxRounds: 2,
      targetCount: 10,
    });

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    // Store state for potential widen, then strip from browser response
    lastRunState = { targetUrl, state: result._internalState };

    const { csvPath, xlsxPath } = await exportBuyers(
      result.buyers,
      result.targetProfile.companyName
    );

    return res.json({
      success: true,
      targetProfile: result.targetProfile,
      buyers: result.buyers,
      stats: result.stats,
      csvPath,
      xlsxPath,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    runInProgress = false;
  }
});

app.post("/widen", async (req, res) => {
  if (runInProgress) {
    return res.status(409).json({
      success: false,
      error: "A pipeline run is already in progress. Please wait for it to finish.",
    });
  }

  const { targetUrl, additionalUrls } = req.body;
  if (!targetUrl || !additionalUrls) {
    return res.status(400).json({
      success: false,
      error: "targetUrl and additionalUrls are required",
    });
  }

  if (!lastRunState || lastRunState.targetUrl !== targetUrl) {
    return res.status(404).json({
      success: false,
      error:
        "No stored state found for this URL. Please run a fresh search first, then widen.",
    });
  }

  runInProgress = true;
  try {
    const result = await widenPipeline(lastRunState.state, additionalUrls);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    // Update stored state with widen result
    lastRunState = { targetUrl, state: result._internalState };

    const { csvPath, xlsxPath } = await exportBuyers(
      result.buyers,
      result.targetProfile.companyName
    );

    return res.json({
      success: true,
      targetProfile: result.targetProfile,
      buyers: result.buyers,
      stats: result.stats,
      csvPath,
      xlsxPath,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    runInProgress = false;
  }
});

app.get("/download/:filename", (req, res) => {
  const filename = req.params.filename;

  // Reject any path traversal attempts
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  const filePath = path.join(OUTPUT_DIR, filename);

  // Confirm resolved path stays inside OUTPUT_DIR
  if (!filePath.startsWith(OUTPUT_DIR + path.sep) && filePath !== OUTPUT_DIR) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(filePath);
});

app.listen(3000, () => {
  console.log("Buyer Finder Agent running at http://localhost:3000");
});
