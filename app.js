require("dotenv").config();

const express = require("express");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const fsPromises = require("fs").promises;
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { GoogleGenAI, ThinkingLevel } = require("@google/genai");

const app = express();
const port = process.env.PORT || 5000;
const temporaryUploadDirectory = path.join(os.tmpdir(), "plant-scans");
const geminiTimeoutMs = 25_000;

// ==========================================
// CONFIGURATION
// ==========================================

fs.mkdirSync(temporaryUploadDirectory, { recursive: true });

const upload = multer({
  dest: temporaryUploadDirectory,
});

app.use(express.json({ limit: "10mb" }));

// ==========================================
// GEMINI AI
// ==========================================

// ==========================================
// STATIC FRONTEND
// ==========================================

app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// ANALYZE PLANT
// ==========================================

app.post(
  "/analyze",
  (req, res, next) => {
    console.log("Request received");
    next();
  },
  (req, res, next) => {
    upload.single("image")(req, res, (error) => {
      if (error) {
        console.error("PLANTSCAN ANALYZE ERROR:", error);
        return res.status(500).json({
          error: "Plant analysis failed",
          details: error.message || "Upload failed",
        });
      }
      next();
    });
  },
  async (req, res) => {
    let imagePath = null;

    try {
      console.log("ANALYZE START");

      if (!req.file) {
        return res.status(400).json({
          error: "No image file uploaded",
        });
      }

      imagePath = req.file.path;
      console.log("Image:", req.file.originalname);
      console.log("Image size:", req.file.size);
      console.log("Image MIME:", req.file.mimetype);
      console.log("File uploaded");

      if (!/^image\/(jpeg|png|webp)$/.test(req.file.mimetype)) {
        throw new Error(`Unsupported image MIME type: ${req.file.mimetype}`);
      }

      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing");
      }

      await fsPromises.access(imagePath, fs.constants.R_OK);
      console.log("Reading image...");
      const originalImageBuffer = await fsPromises.readFile(imagePath);
      const imageData = originalImageBuffer.toString("base64");

      const imageMetadata = await sharp(originalImageBuffer).metadata();
      const needsOptimization =
        (imageMetadata.width && imageMetadata.width > 1200) ||
        (imageMetadata.height && imageMetadata.height > 1200) ||
        originalImageBuffer.length > 1_500_000;
      const geminiImageBuffer = needsOptimization
        ? await sharp(originalImageBuffer)
            .resize({
              width: 1200,
              height: 1200,
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 82 })
            .toBuffer()
        : originalImageBuffer;
      const geminiImageData = geminiImageBuffer.toString("base64");
      const geminiMimeType = needsOptimization
        ? "image/jpeg"
        : req.file.mimetype;

      const genAI = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
      });

      console.log("Sending request to Gemini...");
      let timeoutHandle;
      const result = await Promise.race([
        genAI.models.generateContent({
          model: "gemini-3.8-flash",
          config: {
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW,
            },
            maxOutputTokens: 1200,
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: "Analyze this plant image. Identify the likely plant species, visible health condition, important characteristics, care instructions, and interesting facts. Give a concise practical response in plain text. If the species cannot be identified confidently, clearly say so.",
                },
                {
                  inlineData: {
                    mimeType: geminiMimeType,
                    data: geminiImageData,
                  },
                },
              ],
            },
          ],
        }),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Gemini request timed out after ${geminiTimeoutMs}ms`));
          }, geminiTimeoutMs);
        }),
      ]).finally(() => clearTimeout(timeoutHandle));
      console.log("Gemini response received");

      const plantInfo = result.text;

      if (!plantInfo || !plantInfo.trim()) {
        throw new Error("Gemini returned an empty response.");
      }

      console.log("Sending response to frontend");
      res.json({
        result: plantInfo,
        image: `data:${req.file.mimetype};base64,${imageData}`,
      });
      console.log("ANALYZE COMPLETE");
    } catch (error) {
      console.error("GEMINI ERROR:", error);
      console.error(error?.message);
      console.error(error?.stack);
      console.error("=================================");
      console.error("PLANTSCAN ANALYZE ERROR");
      console.error("=================================");
      console.error(error);
      console.error(error?.message);
      console.error(error?.stack);
      res.status(500).json({
        error: "Plant analysis failed",
        details: error.message || "Unknown server error",
      });
    } finally {
      if (imagePath) {
        try {
          await fsPromises.unlink(imagePath);
        } catch (cleanupError) {
          console.error("Could not remove temporary upload:", cleanupError);
        }
      }
    }
  }
);

// ==========================================
// DOWNLOAD PDF REPORT
// ==========================================

app.post("/download", async (req, res) => {
  const { result, image } = req.body;

  try {
    if (!result) {
      return res.status(400).json({
        error: "Analysis result is missing.",
      });
    }

    // ==========================================
    // PDF FILE
    // ==========================================

    const doc = new PDFDocument({
      margin: 50,
    });

    const pdfChunks = [];
    const pdfBufferPromise = new Promise((resolve, reject) => {
      doc.on("data", (chunk) => pdfChunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(pdfChunks)));
      doc.on("error", reject);
    });

    // ==========================================
    // PDF HEADER
    // ==========================================

    doc
      .fontSize(24)
      .font("Helvetica-Bold")
      .text("Plant Analysis Report", {
        align: "center",
      });

    doc.moveDown();

    doc
      .fontSize(11)
      .font("Helvetica")
      .text(`Date: ${new Date().toLocaleDateString()}`, {
        align: "center",
      });

    doc.moveDown(2);

    // ==========================================
    // PLANT IMAGE
    // ==========================================

    if (image) {
      try {
        const base64Data = image.replace(
          /^data:image\/\w+;base64,/,
          ""
        );

        const buffer = Buffer.from(base64Data, "base64");

        doc.image(buffer, {
          fit: [450, 280],
          align: "center",
          valign: "center",
        });

        doc.moveDown(2);
      } catch (imageError) {
        console.error("Could not insert image into PDF:", imageError);
      }
    }

    // ==========================================
    // ANALYSIS
    // ==========================================

    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .text("Plant Analysis");

    doc.moveDown();

    doc
      .fontSize(11)
      .font("Helvetica")
      .text(result, {
        align: "left",
        lineGap: 4,
      });

    // ==========================================
    // FOOTER
    // ==========================================

    doc.moveDown(3);

    doc
      .fontSize(9)
      .fillColor("#666666")
      .text(
        "Generated by PlantScan AI",
        {
          align: "center",
        }
      );

    // Finish PDF
    doc.end();

    // ==========================================
    // WAIT FOR PDF
    // ==========================================

    const pdfBuffer = await pdfBufferPromise;

    // ==========================================
    // DOWNLOAD PDF
    // ==========================================

    const filename = `plant_analysis_report_${Date.now()}.pdf`;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (error) {
    console.error("=================================");
    console.error("ERROR GENERATING PDF");
    console.error("=================================");
    console.error(error);
    console.error("=================================");

    res.status(500).json({
      error: "An error occurred while generating the PDF report.",
    });
  }
});

// ==========================================
// START SERVER LOCALLY
// ==========================================

if (require.main === module) {
  app.listen(port, () => {
    console.log("=================================");
    console.log(`PlantScan server running on port ${port}`);
    console.log(`http://localhost:${port}`);
    console.log("Gemini model: gemini-3.8-flash");
    console.log("=================================");
  });
}

module.exports = app;