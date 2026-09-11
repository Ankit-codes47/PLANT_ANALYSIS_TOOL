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

//configure multer
const upload = multer({ dest: "upload/" });
app.use(express.json({ limit: "10mb" }));

//initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
app.use(express.static("public"));

//routes
//analyze
app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded" });
    }

    const imagePath = req.file.path;
    const imageData = await fsPromises.readFile(imagePath, {
      encoding: "base64",
    });

    // Use the Gemini model to analyze the image
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.6-flash" 
    });
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

    // Clean up: delete the uploaded file
    await fsPromises.unlink(imagePath);

    // Respond with the analysis result and the image data
    res.json({
      result: plantInfo,
      image: `data:${req.file.mimetype};base64,${imageData}`,
    });
  } catch (error) {
    console.error("Error analyzing image:", error);
    res
      .status(500)
      .json({ error: "An error occurred while analyzing the image" });
  }
});

// Download PDF
app.post("/download", async (req, res) => {
  const { result, image } = req.body;

  try {
    // Check analysis result
    if (!result) {
      return res.status(400).json({
        error: "No analysis result available",
      });
    }

    // Ensure reports directory exists
    const reportsDir = path.join(__dirname, "reports");

    await fsPromises.mkdir(reportsDir, {
      recursive: true,
    });

    // Generate PDF filename
    const filename = `plant_analysis_report_${Date.now()}.pdf`;

    const filePath = path.join(reportsDir, filename);

    // Create PDF
    const doc = new PDFDocument({
      margin: 50,
    });

    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);

    // ==============================
    // PDF TITLE
    // ==============================

    doc
      .fontSize(24)
      .text("Plant Analysis Report", {
        align: "center",
      });

    doc.moveDown();

    // ==============================
    // DATE
    // ==============================

    doc
      .fontSize(12)
      .text(
        `Date: ${new Date().toLocaleDateString()}`
      );

    doc.moveDown(2);

    // ==============================
    // ANALYSIS RESULT
    // ==============================

    doc
      .fontSize(14)
      .text(result, {
        align: "left",
        lineGap: 5,
      });

    // ==============================
    // PLANT IMAGE
    // ==============================

    if (image) {
      try {
        // Extract base64 data from data URL
        const match = image.match(
          /^data:image\/([^;]+);base64,(.+)$/
        );

        if (!match) {
          throw new Error(
            "Invalid image data format"
          );
        }

        const imageType = match[1];
        const base64Data = match[2];

        console.log(
          "Image format received:",
          imageType
        );

        const imageBuffer = Buffer.from(
          base64Data,
          "base64"
        );

        // Convert image to PNG
        // This allows JPG, JPEG, PNG, WEBP, etc.
        // to work with PDFKit.
        const pngBuffer = await sharp(imageBuffer)
          .png()
          .toBuffer();

        // Start image on a new page if needed
        doc.addPage();

        doc
          .fontSize(18)
          .text("Plant Image", {
            align: "center",
          });

        doc.moveDown();

        // Add image
        doc.image(pngBuffer, {
          fit: [500, 500],
          align: "center",
          valign: "center",
        });

        console.log(
          "Plant image added to PDF successfully"
        );

      } catch (imageError) {

        console.error(
          "Error processing plant image:",
          imageError
        );

        doc.addPage();

        doc
          .fontSize(14)
          .text(
            "Plant image could not be added to the report.",
            {
              align: "center",
            }
          );
      }
    }

    // ==============================
    // FINISH PDF
    // ==============================

    doc.end();

    // Wait for PDF to finish writing
    await new Promise((resolve, reject) => {

      writeStream.on("finish", resolve);

      writeStream.on("error", reject);

    });

    // Make sure PDF exists
    await fsPromises.access(filePath);

    console.log(
      "PDF created successfully:",
      filePath
    );

    // ==============================
    // DOWNLOAD PDF
    // ==============================

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
              error:
                "Error downloading the PDF report",
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
            "Error deleting temporary PDF:",
            deleteError
          );

        }

      }
    );

  } catch (error) {

    console.error(
      "Error generating PDF report:",
      error
    );

    if (!res.headersSent) {

      res.status(500).json({
        error:
          "An error occurred while generating the PDF report",
      });

    }

  }
});
//start the server
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});