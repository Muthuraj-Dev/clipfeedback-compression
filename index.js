// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

// ✅ Setup
const app = express();

app.use(cors({ origin: "*" }));

app.use(express.json({ limit: "50mb" }));

// ✅ Supabase client with service role key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Compress route
app.post("/compress", async (req, res) => {
  const { user_id, project_id, version, original_path, preview_path } = req.body;

  console.log("➡️ /compress called with:", req.body);

  try {
    const tempOriginal = `/tmp/original-${Date.now()}.mp4`;
    const tempPreview = `/tmp/preview-${Date.now()}.mp4`;

    console.log("📥 Downloading original from Supabase:", original_path);

    // ⬇️ Download original video from Supabase
    const { data, error } = await supabase.storage
      .from("videos")
      .download(original_path);

    if (error) {
      console.error("❌ Download error:", error);
      throw error;
    }

    const fileStream = fs.createWriteStream(tempOriginal);
    await new Promise((resolve, reject) => {
      data.body.pipe(fileStream);
      data.body.on("error", reject);
      fileStream.on("finish", resolve);
    });

    console.log("🎬 Compressing with FFmpeg...");

    // 🔄 Compress with FFmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(tempOriginal)
        .videoBitrate(800)
        .size("1280x720")
        .outputOptions("-preset veryfast")
        .on("end", () => {
          console.log("✅ FFmpeg compression done.");
          resolve();
        })
        .on("error", (ffmpegErr) => {
          console.error("❌ FFmpeg error:", ffmpegErr);
          reject(ffmpegErr);
        })
        .save(tempPreview);
    });

    console.log("📤 Uploading preview to Supabase:", preview_path);

    // ⬆️ Upload compressed preview to Supabase
    const previewBuffer = fs.readFileSync(tempPreview);
    const upload = await supabase.storage
      .from("videos")
      .upload(preview_path, previewBuffer, {
        upsert: true,
        contentType: "video/mp4",
      });


    if (upload.error) {
      console.error("❌ Upload error:", upload.error);
      throw upload.error;
    }

    console.log("✅ Compression and upload complete.");

    // ✅ Success
    res.json({ message: "Compression complete and uploaded." });
  } catch (err) {

    console.error("❌ Compression error:", err);
    res.status(500).json({ error: "Compression failed." });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FFmpeg server running on port ${PORT}`));
