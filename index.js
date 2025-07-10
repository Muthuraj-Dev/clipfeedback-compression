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

  try {
    const tempOriginal = `/tmp/original-${Date.now()}.mp4`;
    const tempPreview = `/tmp/preview-${Date.now()}.mp4`;

    // ⬇️ Download original video from Supabase
    const { data, error } = await supabase.storage
      .from("videos")
      .download(original_path);

    if (error) throw error;

    const fileStream = fs.createWriteStream(tempOriginal);
    await new Promise((resolve, reject) => {
      data.body.pipe(fileStream);
      data.body.on("error", reject);
      fileStream.on("finish", resolve);
    });

    // 🔄 Compress with FFmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(tempOriginal)
        .videoBitrate(800)
        .size("1280x720")
        .outputOptions("-preset veryfast")
        .on("end", resolve)
        .on("error", reject)
        .save(tempPreview);
    });

    // ⬆️ Upload compressed preview to Supabase
    const previewBuffer = fs.readFileSync(tempPreview);
    const upload = await supabase.storage
      .from("videos")
      .upload(preview_path, previewBuffer, {
        upsert: true,
        contentType: "video/mp4",
      });

    if (upload.error) throw upload.error;

    // ✅ Success
    res.json({ message: "Compression complete and uploaded." });
  } catch (err) {
    console.error("Compression error:", err);
    res.status(500).json({ error: "Compression failed." });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FFmpeg server running on port ${PORT}`));
