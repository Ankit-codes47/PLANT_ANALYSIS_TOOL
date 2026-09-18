require("dotenv").config();

const express = require("express");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const port = process.env.PORT || 5000;

// ==========================================
// CONFIGURATION
// ==========================================

const upload = multer({
  dest: "upload/",
});

app.use(express.json({ limit: "10mb" }));

// ==========================================
// GEMINI AI
// ==========================================

if (!process.env.GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY is not configured in .env");
}

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ==========================================
// STATIC FRONTEND
// ==========================================

app.use(express.static("public"));

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

    // Read uploaded image
    const imageData = await fsPromises.readFile(imagePath, {
      encoding: "base64",
    });

    // ==========================================
    // GEMINI ANALYSIS
    // ==========================================

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
    // REPORT DIRECTORY
    // ==========================================

    const reportsDir = path.join(__dirname, "reports");

    await fsPromises.mkdir(reportsDir, {
      recursive: true,
    });

    // ==========================================
    // PDF FILE
    // ==========================================

    const filename = `plant_analysis_report_${Date.now()}.pdf`;

    const filePath = path.join(reportsDir, filename);

    const writeStream = fs.createWriteStream(filePath);

    const doc = new PDFDocument({
      margin: 50,
    });

    doc.pipe(writeStream);

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

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    // ==========================================
    // DOWNLOAD PDF
    // ==========================================

    res.download(filePath, filename, async (err) => {
      if (err) {
        console.error("PDF download error:", err);

        if (!res.headersSent) {
          res.status(500).json({
            error: "Error downloading the PDF report",
          });
        }
      }

      // Delete temporary PDF
      try {
        await fsPromises.unlink(filePath);
      } catch (deleteError) {
        console.error(
          "Could not delete temporary PDF:",
          deleteError
        );
      }
    });
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
// START SERVER
// ==========================================

app.listen(port, () => {
  console.log("=================================");
  console.log(`PlantScan server running on port ${port}`);
  console.log(`http://localhost:${port}`);
  console.log("Gemini model: gemini-3.8-flash");
  console.log("=================================");
});