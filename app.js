require("dotenv").config();

const express = require("express");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const fsPromises = require("fs").promises;
const os = require("os");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const port = process.env.PORT || 5000;

// ==========================================
// CONFIGURATION
// ==========================================

const upload = multer({
  dest: os.tmpdir(),
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

app.post("/analyze", upload.single("image"), async (req, res) => {
  let imagePath = null;

  try {
    // Check image
    if (!req.file) {
      return res.status(400).json({
        error: "No image file uploaded",
      });
    }

    imagePath = req.file.path;

    if (!process.env.GEMINI_API_KEY) {
      console.error("ERROR ANALYZING PLANT: GEMINI_API_KEY is not configured.");
      await fsPromises.unlink(imagePath).catch((cleanupError) => {
        console.error("Could not remove temporary upload:", cleanupError);
      });
      imagePath = null;
      return res.status(500).json({
        error: "The analysis service is not configured on the server.",
      });
    }

    // Read uploaded image
    const imageData = await fsPromises.readFile(imagePath, {
      encoding: "base64",
    });

    // ==========================================
    // GEMINI ANALYSIS
    // ==========================================

    const genAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const result = await genAI.models.generateContent({
      model: "gemini-3.8-flash",

      config: {
        thinkingConfig: {
          thinkingLevel: "low",
        },
      },

      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
Analyze this plant image carefully.

Provide a detailed plant analysis containing:

1. Plant Species / Identification
2. Plant Health
3. Physical Characteristics
4. Care Instructions
5. Watering Requirements
6. Sunlight Requirements
7. Soil Requirements
8. Temperature and Humidity
9. Common Problems or Diseases
10. Recommendations
11. Interesting Facts

Important instructions:

- Base the analysis only on what can reasonably be observed or inferred from the image.
- If exact species identification is uncertain, clearly mention that it is an identification estimate.
- Do not claim 100% identification accuracy.
- Do not invent visible symptoms.
- Give practical and understandable care recommendations.
- Mention uncertainty when appropriate.
- Return plain text only.
- Do not use Markdown.
- Do not use emojis.
      `,
            },

            {
              inlineData: {
                mimeType: req.file.mimetype,
                data: imageData,
              },
            },
          ],
        },
      ],
    });

    // Get AI response
    const plantInfo = result.text;

    if (!plantInfo || !plantInfo.trim()) {
      throw new Error("Gemini returned an empty response.");
    }

    // ==========================================
    // DELETE TEMPORARY UPLOAD
    // ==========================================

    await fsPromises.unlink(imagePath);
    imagePath = null;

    // ==========================================
    // SEND RESPONSE TO FRONTEND
    // ==========================================

    res.json({
      result: plantInfo,
      image: `data:${req.file.mimetype};base64,${imageData}`,
    });
  } catch (error) {
    console.error("=================================");
    console.error("ERROR ANALYZING PLANT");
    console.error("=================================");
    console.error(error);
    console.error("=================================");

    // Try to remove temporary uploaded file
    if (imagePath) {
      try {
        await fsPromises.unlink(imagePath);
      } catch (cleanupError) {
        console.error("Could not remove temporary file:", cleanupError);
      }
    }

    res.status(500).json({
      error: "An error occurred while analyzing the image.",
    });
  }
});

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