require("dotenv").config();

const express = require("express");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const sharp = require("sharp");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 5000;

// ==========================================
// CONFIGURE MULTER
// Vercel allows temporary files inside /tmp
// ==========================================

const uploadDir = "/tmp/upload";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
});

app.use(express.json({ limit: "10mb" }));

// ==========================================
// INITIALIZE GOOGLE GENERATIVE AI
// ==========================================

const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY
);

// ==========================================
// SERVE FRONTEND
// ==========================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// ==========================================
// ANALYZE PLANT
// ==========================================

app.post(
  "/analyze",
  upload.single("image"),
  async (req, res) => {
    let imagePath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No image file uploaded",
        });
      }

      imagePath = req.file.path;

      // Read image
      const imageData = await fsPromises.readFile(
        imagePath,
        {
          encoding: "base64",
        }
      );

      // Gemini model
      const model = genAI.getGenerativeModel({
        model: "gemini-3.8-flash",
      });

      // Analyze image
      const result = await model.generateContent([
        "Analyze this plant image and provide detailed analysis of its species, health, and care recommendations, its characteristics, care instructions, and any interesting facts. Please provide the response in plain text without using any markdown formatting.",

        {
          inlineData: {
            mimeType: req.file.mimetype,
            data: imageData,
          },
        },
      ]);

      const plantInfo = result.response.text();

      // Delete temporary uploaded image
      try {
        await fsPromises.unlink(imagePath);
        imagePath = null;
      } catch (deleteError) {
        console.error(
          "Error deleting uploaded image:",
          deleteError
        );
      }

      // Send result
      res.json({
        result: plantInfo,
        image: `data:${req.file.mimetype};base64,${imageData}`,
      });

    } catch (error) {
      console.error(
        "Error analyzing image:",
        error
      );

      // Cleanup image if it still exists
      if (imagePath) {
        try {
          await fsPromises.unlink(imagePath);
        } catch (deleteError) {
          console.error(
            "Error deleting temporary image:",
            deleteError
          );
        }
      }

      res.status(500).json({
        error:
          "An error occurred while analyzing the image",
      });
    }
  }
);

// ==========================================
// DOWNLOAD PDF
// ==========================================

app.post("/download", async (req, res) => {
  const { result, image } = req.body;

  try {
    if (!result) {
      return res.status(400).json({
        error: "No analysis result available",
      });
    }

    const reportsDir = "/tmp/reports";

    await fsPromises.mkdir(reportsDir, {
      recursive: true,
    });

    const filename = `plant_analysis_report_${Date.now()}.pdf`;
    const filePath = path.join(reportsDir, filename);

    const writeStream = fs.createWriteStream(filePath);

    const doc = new PDFDocument({
      margin: 50,
    });

    doc.pipe(writeStream);

    // =========================
    // TITLE
    // =========================

    doc.fontSize(24).text("Plant Analysis Report", {
      align: "center",
    });

    doc.moveDown();

    doc.fontSize(12).text(
      `Date: ${new Date().toLocaleDateString()}`
    );

    doc.moveDown(2);

    // =========================
    // ANALYSIS
    // =========================

    doc.fontSize(14).text(result, {
      align: "left",
      lineGap: 5,
    });

    // =========================
    // PLANT IMAGE
    // =========================

    if (image) {
      try {
        console.log("Processing plant image...");

        // Check data URL
        if (!image.startsWith("data:image/")) {
          throw new Error("Invalid image data URL");
        }

        // Extract base64 image
        const base64Data = image.split(",")[1];

        if (!base64Data) {
          throw new Error("Base64 image data is missing");
        }

        const imageBuffer = Buffer.from(
          base64Data,
          "base64"
        );

        console.log(
          "Original image size:",
          imageBuffer.length,
          "bytes"
        );

        // Convert ANY supported image format to PNG
        const pngBuffer = await sharp(imageBuffer)
          .rotate()
          .png()
          .toBuffer();

        console.log(
          "PNG conversion successful:",
          pngBuffer.length,
          "bytes"
        );

        // New page for image
        doc.addPage();

        doc.fontSize(20).text("Plant Image", {
          align: "center",
        });

        doc.moveDown(2);

        // Add image
        doc.image(pngBuffer, {
          fit: [450, 500],
          align: "center",
          valign: "center",
        });

        console.log(
          "Plant image successfully added to PDF"
        );

      } catch (imageError) {
        console.error(
          "PLANT IMAGE ERROR:",
          imageError
        );

        doc.addPage();

        doc.fontSize(16).text(
          "Plant Image",
          {
            align: "center",
          }
        );

        doc.moveDown(2);

        doc.fontSize(12).text(
          "Unable to add the plant image to this report.",
          {
            align: "center",
          }
        );
      }
    }

    // Finish PDF
    doc.end();

    // Wait for PDF creation
    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    console.log(
      "PDF created successfully:",
      filePath
    );

    // Download PDF
    res.download(
      filePath,
      "Plant_Analysis_Report.pdf",
      async (err) => {
        if (err) {
          console.error(
            "PDF download error:",
            err
          );

          if (!res.headersSent) {
            res.status(500).json({
              error: "Error downloading PDF",
            });
          }

          return;
        }

        console.log(
          "PDF downloaded successfully"
        );

        // Delete temporary PDF
        try {
          await fsPromises.unlink(filePath);

          console.log(
            "Temporary PDF deleted"
          );
        } catch (deleteError) {
          console.error(
            "Error deleting PDF:",
            deleteError
          );
        }
      }
    );

  } catch (error) {
    console.error(
      "PDF generation error:",
      error
    );

    if (!res.headersSent) {
      res.status(500).json({
        error:
          "An error occurred while generating the PDF",
      });
    }
  }
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "PlantScan API is running successfully.",
  });
});

// ==========================================
// 404 ROUTE
// ==========================================

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

// ==========================================
// LOCAL SERVER
// ==========================================

// Only start server when running locally
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(
      `Listening on port ${port}`
    );
  });
}

// ==========================================
// EXPORT APP FOR VERCEL
// ==========================================

module.exports = app;