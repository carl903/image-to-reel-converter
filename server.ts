import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");

// Set ffmpeg path from ffmpeg-static
if (ffmpegPath) {
  console.log("FFmpeg found at:", ffmpegPath);
  try {
    fs.chmodSync(ffmpegPath, 0o755);
    console.log("FFmpeg permissions set to 755.");
  } catch (err) {
    console.error("Failed to set FFmpeg permissions:", err);
  }
  ffmpeg.setFfmpegPath(ffmpegPath);
} else {
  console.error("FFmpeg path not found from ffmpeg-static!");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Ensure temp and outputs directories exist
  const tempDir = path.join(process.cwd(), "temp");
  const outputsDir = path.join(process.cwd(), "outputs");
  [tempDir, outputsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Serve outputs directory statically
  app.use("/outputs", express.static(outputsDir));

  // Shared video generation function
  async function generateVideo(imageUrl: string, inputPath: string, outputPath: string) {
    // Download image
    const response = await axios({
      url: imageUrl,
      method: "GET",
      responseType: "stream",
    });

    const writer = fs.createWriteStream(inputPath);
    response.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on("finish", () => resolve());
      writer.on("error", reject);
    });

    // Convert image to 5s video
    console.log("Starting FFmpeg conversion...");
    if (ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath);
    }
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .inputOptions(["-loop 1"])
        .duration(5)
        .fps(25)
        .videoCodec("libx264")
        .videoFilters([
          "scale=1080:1920:force_original_aspect_ratio=decrease",
          "pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
          "format=yuv420p"
        ])
        .outputOptions([
          "-pix_fmt yuv420p",
          "-movflags +faststart",
          "-profile:v high",
          "-level 4.0",
          "-colorspace bt709",
          "-color_trc bt709",
          "-color_primaries bt709"
        ])
        .on("start", (commandLine) => {
          console.log("Spawned FFmpeg with command: " + commandLine);
        })
        .on("end", () => {
          // Validate output file
          if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            if (stats.size > 0) {
              resolve();
            } else {
              reject(new Error("Generated video file is empty"));
            }
          } else {
            reject(new Error("Video file was not created"));
          }
        })
        .on("error", (err, stdout, stderr) => {
          console.error("FFmpeg error:", err);
          console.error("FFmpeg stderr:", stderr);
          reject(err);
        })
        .save(outputPath);
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

      // Construct public URL dynamically based on the request host
      const protocol = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.get("host");
      const videoUrl = `${protocol}://${host}/outputs/${outputFilename}`;

      res.json({
        success: true,
        video_url: videoUrl,
        duration: 5,
        width: 1080,
        height: 1920
      });

      // Cleanup input file
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    } catch (error) {
      console.error("Webhook conversion error:", error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to convert image to video" 
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
    const outputPath = path.join(tempDir, `${id}_output.mp4`);

    try {
      await generateVideo(imageUrl, inputPath, outputPath);

      // Send the file with explicit MIME type
      res.setHeader("Content-Type", "video/mp4");
      res.download(outputPath, "reel.mp4", (err) => {
        // Cleanup files after download
        try {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (cleanupErr) {
          console.error("Cleanup error:", cleanupErr);
        }
      });
    } catch (error) {
      console.error("Manual conversion error:", error);
      res.status(500).json({ error: "Failed to convert image to video" });

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
