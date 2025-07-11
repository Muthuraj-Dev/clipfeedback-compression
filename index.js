// // index.js
// require("dotenv").config();
// const express = require("express");
// const cors = require("cors");
// const { createClient } = require("@supabase/supabase-js");
// const ffmpeg = require("fluent-ffmpeg");
// const fs = require("fs");
// const path = require("path");

// // ✅ Setup
// const app = express();

// app.use(cors({ origin: "*" }));

// app.use(express.json({ limit: "50mb" }));

// // ✅ Supabase client with service role key
// const supabase = createClient(
//   process.env.SUPABASE_URL,
//   process.env.SUPABASE_SERVICE_ROLE_KEY
// );

// // ✅ Compress route
// app.post("/compress", async (req, res) => {
//   const { user_id, project_id, version, original_path, preview_path } = req.body;

//   console.log("➡️ /compress called with:", req.body);

//   try {
//     const tempOriginal = `/tmp/original-${Date.now()}.mp4`;
//     const tempPreview = `/tmp/preview-${Date.now()}.mp4`;

//     console.log("📥 Downloading original from Supabase:", original_path);

//     // ⬇️ Download original video from Supabase
//     const { data, error } = await supabase.storage
//       .from("videos")
//       .download(original_path);

//     if (error) {
//       console.error("Download error:", error.message);
//       return res.status(500).json({ error: "Failed to download original video" });
//     }

//     if (!data || !data.body) {
//       console.error("No data returned from Supabase download");
//       return res.status(500).json({ error: "No video data returned" });
//     }

//     const fileStream = fs.createWriteStream(tempOriginal);
//     await new Promise((resolve, reject) => {
//       data.body.pipe(fileStream);
//       data.body.on("error", reject);
//       fileStream.on("finish", resolve);
//     });

//     console.log("🎬 Compressing with FFmpeg...");

//     // 🔄 Compress with FFmpeg
//     await new Promise((resolve, reject) => {
//       ffmpeg(tempOriginal)
//         .videoBitrate(800)
//         .size("1280x720")
//         .outputOptions("-preset veryfast")
//         .on("end", () => {
//           console.log("✅ FFmpeg compression done.");
//           resolve();
//         })
//         .on("error", (ffmpegErr) => {
//           console.error("❌ FFmpeg error:", ffmpegErr);
//           reject(ffmpegErr);
//         })
//         .save(tempPreview);
//     });

//     console.log("📤 Uploading preview to Supabase:", preview_path);

//     // ⬆️ Upload compressed preview to Supabase
//     const previewBuffer = fs.readFileSync(tempPreview);
//     const upload = await supabase.storage
//       .from("videos")
//       .upload(preview_path, previewBuffer, {
//         upsert: true,
//         contentType: "video/mp4",
//       });


//     if (upload.error) {
//       console.error("❌ Upload error:", upload.error);
//       throw upload.error;
//     }

//     console.log("✅ Compression and upload complete.");

//     // ✅ Success
//     res.json({ message: "Compression complete and uploaded." });
//   } catch (err) {

//     console.error("❌ Compression error:", err);
//     res.status(500).json({ error: "Compression failed." });
//   }
// });

// // ✅ Start server
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => console.log(`FFmpeg server running on port ${PORT}`));


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
app.use(express.json({ limit: "100mb" }));

// ✅ Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Reusable compression function
async function compressAndUpload({ original_path, preview_path }) {
  const tempOriginal = `/tmp/original-${Date.now()}.mp4`;
  const tempPreview = `/tmp/preview-${Date.now()}.mp4`;

  // Retry logic to wait until file is ready
  async function waitForFile(path, retries = 5, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      const { data, error } = await supabase.storage.from("videos").download(path);
      if (data?.body) return data;
      console.log(`⏳ Retry ${i + 1}/${retries}: File not ready yet`);
      await new Promise((res) => setTimeout(res, delay));
    }
    throw new Error("File not available after multiple retries");
  }

  console.log("📥 Waiting for Supabase file:", original_path);
  const data = await waitForFile(original_path);

  const fileStream = fs.createWriteStream(tempOriginal);
  await new Promise((resolve, reject) => {
    data.body.pipe(fileStream);
    data.body.on("error", reject);
    fileStream.on("finish", resolve);
  });

  console.log("🎬 Compressing with FFmpeg...");
  await new Promise((resolve, reject) => {
    ffmpeg(tempOriginal)
      .videoBitrate(800)
      .size("1280x720")
      .outputOptions("-preset veryfast")
      .on("end", () => {
        console.log("✅ FFmpeg compression done.");
        resolve();
      })
      .on("error", reject)
      .save(tempPreview);
  });

  const previewBuffer = fs.readFileSync(tempPreview);
  const upload = await supabase.storage.from("videos").upload(preview_path, previewBuffer, {
    upsert: true,
    contentType: "video/mp4",
  });

  if (upload.error) throw upload.error;
  console.log("✅ Preview uploaded to:", preview_path);
}

// ✅ Webhook endpoint
app.post("/webhook", async (req, res) => {
  try {
    const { name, bucket_id } = req.body;
    if (!name || bucket_id !== "videos") {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    console.log("📩 Webhook received for file:", name);

    const parts = name.split("/");
    if (parts.length !== 3) throw new Error("Invalid path structure");

    const [user_id, project_id, file_name] = parts;
    const version = file_name.replace(".mp4", "");
    const preview_path = `${user_id}/${project_id}/${version}-preview.mp4`;

    await compressAndUpload({ original_path: name, preview_path });
    res.json({ message: "Compression complete" });
  } catch (err) {
    console.error("❌ Webhook processing failed:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// Optional: Keep manual /compress route for debugging
app.post("/compress", async (req, res) => {
  try {
    const { original_path, preview_path } = req.body;
    await compressAndUpload({ original_path, preview_path });
    res.json({ message: "Compression complete" });
  } catch (err) {
    console.error("❌ Compression error:", err);
    res.status(500).json({ error: "Compression failed" });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎥 FFmpeg microservice running on port ${PORT}`));

