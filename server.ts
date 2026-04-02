import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import axios from "axios";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { spawn, execSync } from "child_process";
import { Storage } from "@google-cloud/storage";

const storage = new Storage();
const BUCKET_NAME = "ukbb-reels-temp-storage-2026";

let ffmpegPath = "ffmpeg";

// Startup diagnostics
console.log("--- FFmpeg Startup Diagnostics ---");
try {
  const whichFfmpeg = execSync("which ffmpeg").toString().trim();
  console.log("FFmpeg found at (which ffmpeg):", whichFfmpeg);
  ffmpegPath = whichFfmpeg;
} catch (e) {
  console.error("FFmpeg NOT found in PATH via 'which ffmpeg'");
  // Try common absolute paths as fallback
  const commonPaths = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      console.log(`FFmpeg found at absolute path: ${p}`);
      ffmpegPath = p;
      break;
    }
  }
}

try {
  const version = execSync(`${ffmpegPath} -version`).toString().split("\n")[0];
  console.log("FFmpeg version check successful:", version);
} catch (e: any) {
  console.error("FFmpeg version check failed:", e.message);
}
console.log("Using FFmpeg binary path:", ffmpegPath);
console.log("----------------------------------");

// Helper to upload to GCS and get signed URL
async function uploadToGCS(localFilePath: string, destinationName: string) {
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    await bucket.upload(localFilePath, {
      destination: destinationName,
      metadata: {
        contentType: "video/mp4",
      },
    });

    const file = bucket.file(destinationName);
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
    });

    return signedUrl;
  } catch (error: any) {
    console.error("GCS Upload Error:", error.message);
    throw new Error(`Failed to upload to GCS: ${error.message}`);
  }
}

// Process-level event logging for debugging service restarts
process.on("SIGTERM", () => {
  console.log("Received SIGTERM signal. Service is shutting down...");
});

process.on("SIGINT", () => {
  console.log("Received SIGINT signal. Service is shutting down...");
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message);
  console.error(err.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;

  app.use(cors());
  app.use(express.json());

  // Ensure temp and outputs directories exist
  const tempDir = path.join(process.cwd(), "temp");
  const outputsDir = path.join(process.cwd(), "outputs");
  [tempDir, outputsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      console.log(`Creating directory: ${dir}`);
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Serve outputs directory statically
  app.use("/outputs", express.static(outputsDir));

  // Ensure requests to /outputs/ that don't match a file return 404, not the SPA index.html
  app.get("/outputs/*", (req, res) => {
    res.status(404).send("Video not found or has been cleaned up.");
  });

  // robots.txt route for Meta/Facebook crawler access
  app.get("/robots.txt", (req, res) => {
    res.type("text/plain");
    res.send("User-agent: *\nAllow: /");
  });

  // Shared video generation function
  async function generateVideo(imageUrl: string, inputPath: string, outputPath: string) {
    if (!ffmpegPath) {
      throw new Error("FFmpeg binary path is not set");
    }

    console.log(`Downloading image from: ${imageUrl}`);
    // Download image
    try {
      const response = await axios({
        url: imageUrl,
        method: "GET",
        responseType: "stream",
      });

      const writer = fs.createWriteStream(inputPath);
      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on("finish", () => {
          console.log(`Image downloaded successfully to: ${inputPath}`);
          resolve();
        });
        writer.on("error", (err) => {
          console.error(`Error writing image to disk: ${err.message}`);
          reject(err);
        });
      });
    } catch (err: any) {
      console.error(`Failed to download image: ${err.message}`);
      throw new Error(`Failed to download image: ${err.message}`);
    }

    // Convert image to 5s video using spawn with the system binary
    console.log("Starting FFmpeg conversion via spawn...");
    console.log("Using FFmpeg binary:", ffmpegPath);

    const args = [
      "-loop", "1",
      "-t", "5",
      "-i", inputPath,
      "-r", "25",
      "-vcodec", "libx264",
      "-preset", "ultrafast",
      "-tune", "stillimage",
      "-crf", "32",
      "-threads", "1",
      "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-shortest",
      "-y", // Overwrite output file if it exists
      outputPath
    ];

    console.log(`FFmpeg args: ${args.join(" ")}`);

    await new Promise<void>((resolve, reject) => {
      const ffmpegProcess = spawn(ffmpegPath, args);
      console.log(`FFmpeg process started with PID: ${ffmpegProcess.pid}`);

      let stderr = "";

      ffmpegProcess.stderr.on("data", (data) => {
        const chunk = data.toString();
        stderr += chunk;
      });

      ffmpegProcess.on("close", (code, signal) => {
        console.log(`FFmpeg process closed with code: ${code}, signal: ${signal}`);
        if (code === 0) {
          console.log("FFmpeg process closed with success code 0.");
          // Validate output file
          if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            console.log(`Output file created at: ${outputPath}, size: ${stats.size} bytes`);
            if (stats.size > 0) {
              console.log("FFmpeg conversion successful.");
              resolve();
            } else {
              reject(new Error("Generated video file is empty"));
            }
          } else {
            reject(new Error("Video file was not created on disk"));
          }
        } else {
          console.error("FFmpeg process failed.");
          console.error("Full FFmpeg stderr output:\n", stderr);
          reject(new Error(`FFmpeg process failed with code ${code} and signal ${signal}. Stderr: ${stderr}`));
        }
      });

      ffmpegProcess.on("error", (err) => {
        console.error("Failed to start FFmpeg process:", err.message);
        reject(new Error(`Failed to start FFmpeg process: ${err.message}`));
      });
    });
  }

  // Webhook Endpoint (API Mode)
  app.post("/api/webhook", async (req, res) => {
    const { image_url } = req.body;

    if (!image_url) {
      return res.status(400).json({ 
        success: false, 
        error: "image_url is required in the JSON payload" 
      });
    }

    const id = uuidv4();
    const inputPath = path.join(tempDir, `${id}_input.jpg`);
    const outputFilename = `${id}_reel.mp4`;
    const outputPath = path.join(outputsDir, outputFilename);

    try {
      await generateVideo(image_url, inputPath, outputPath);

      // Upload to GCS and get signed URL
      const videoUrl = await uploadToGCS(outputPath, outputFilename);

      res.json({
        success: true,
        video_url: videoUrl,
        filename: outputFilename,
        duration: 5,
        width: 1080,
        height: 1920
      });

      // Cleanup local files
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      // We keep the local output file for the local /outputs/ route if needed, 
      // but the user asked for GCS signed URL in the response.
    } catch (error: any) {
      console.error("Webhook conversion error:", error.message);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to convert image to video" 
      });

      // Cleanup on failure
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (cleanupErr) {}
    }
  });

  // API Route for manual conversion (UI Mode)
  app.post("/api/convert", async (req, res) => {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: "Image URL is required" });
    }

    const id = uuidv4();
    const inputPath = path.join(tempDir, `${id}_input.jpg`);
    const outputFilename = `${id}_reel.mp4`;
    const outputPath = path.join(outputsDir, outputFilename);

    try {
      await generateVideo(imageUrl, inputPath, outputPath);

      // Upload to GCS and get signed URL
      const videoUrl = await uploadToGCS(outputPath, outputFilename);

      res.json({
        success: true,
        video_url: videoUrl,
        filename: outputFilename
      });

      // Cleanup local files
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    } catch (error: any) {
      console.error("Manual conversion error:", error.message);
      res.status(500).json({ error: error.message || "Failed to convert image to video" });

      // Cleanup on failure
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (cleanupErr) {}
    }
  });

  // Simple cleanup task for outputs (every 1 hour, delete files older than 24 hours)
  setInterval(() => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    fs.readdir(outputsDir, (err, files) => {
      if (err) return;
      files.forEach(file => {
        const filePath = path.join(outputsDir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;
          if (now - stats.mtimeMs > maxAge) {
            fs.unlink(filePath, () => {});
          }
        });
      });
    });
  }, 60 * 60 * 1000);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
