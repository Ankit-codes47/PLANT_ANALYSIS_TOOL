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
// TEMPORARY UPLOAD DIRECTORY
// Vercel allows temporary writes in /tmp
// ==========================================

const uploadDir = "/tmp/upload";

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ==========================================
// MULTER
// ==========================================

const upload = multer({
    dest: uploadDir,
});

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json({ limit: "10mb" }));

// ==========================================
// GEMINI AI
// ==========================================

if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not configured.");
}

const genAI = new GoogleGenerativeAI(
    process.env.GEMINI_API_KEY
);

// ==========================================
// HOME ROUTE
// ==========================================

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "PlantScan API is running successfully.",
    });
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Server is healthy",
    });
});

// ==========================================
// ANALYZE PLANT
// ==========================================

app.post("/analyze", upload.single("image"), async (req, res) => {
    let imagePath = null;

    try {
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

        // Gemini model
        const model = genAI.getGenerativeModel({
            model: "gemini-3.6-flash",
        });

        // Analyze image
        const result = await model.generateContent([
            `Analyze this plant image.

Provide:
1. Plant species/name
2. Plant identification confidence
3. Current health condition
4. Possible diseases or problems
5. Symptoms visible in the image
6. Causes of the problem
7. Treatment recommendations
8. Watering requirements
9. Sunlight requirements
10. Soil requirements
11. Fertilizer requirements
12. General care instructions
13. Interesting facts

If the image does not contain a plant, clearly say that.

Return the response as plain text without Markdown formatting.`,

            {
                inlineData: {
                    mimeType: req.file.mimetype,
                    data: imageData,
                },
            },
        ]);

        const plantInfo = result.response.text();

        // Delete temporary upload
        try {
            await fsPromises.unlink(imagePath);
        } catch (deleteError) {
            console.error(
                "Could not delete temporary image:",
                deleteError
            );
        }

        imagePath = null;

        // Return analysis + image
        res.status(200).json({
            success: true,
            result: plantInfo,
            image: `data:${req.file.mimetype};base64,${imageData}`,
        });

    } catch (error) {
        console.error("Error analyzing image:", error);

        // Cleanup uploaded file if it still exists
        if (imagePath) {
            try {
                await fsPromises.unlink(imagePath);
            } catch (_) {}
        }

        res.status(500).json({
            success: false,
            error: "An error occurred while analyzing the image.",
            details:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
});

// ==========================================
// GENERATE PDF
// ==========================================

app.post("/download", async (req, res) => {
    try {
        const { result, image } = req.body;

        // Validate analysis
        if (!result) {
            return res.status(400).json({
                error: "No analysis result available",
            });
        }

        // ==========================================
        // IMPORTANT:
        // Use /tmp on Vercel, NOT /reports
        // ==========================================

        const reportsDir = "/tmp/reports";

        await fsPromises.mkdir(reportsDir, {
            recursive: true,
        });

        const filename = `plant_analysis_report_${Date.now()}.pdf`;

        const filePath = path.join(
            reportsDir,
            filename
        );

        // ==========================================
        // CREATE PDF
        // ==========================================

        const doc = new PDFDocument({
            margin: 50,
        });

        const writeStream = fs.createWriteStream(filePath);

        doc.pipe(writeStream);

        // ==========================================
        // TITLE
        // ==========================================

        doc
            .fontSize(24)
            .text("Plant Analysis Report", {
                align: "center",
            });

        doc.moveDown();

        // ==========================================
        // DATE
        // ==========================================

        doc
            .fontSize(12)
            .text(
                `Date: ${new Date().toLocaleDateString()}`
            );

        doc.moveDown(2);

        // ==========================================
        // ANALYSIS
        // ==========================================

        doc
            .fontSize(14)
            .text(result, {
                align: "left",
                lineGap: 5,
            });

        // ==========================================
        // PLANT IMAGE
        // ==========================================

        if (image) {
            try {
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
                const pngBuffer = await sharp(
                    imageBuffer
                )
                    .png()
                    .toBuffer();

                // New page
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

        // ==========================================
        // FINISH PDF
        // ==========================================

        doc.end();

        // Wait until PDF is completely written
        await new Promise((resolve, reject) => {
            writeStream.on("finish", resolve);
            writeStream.on("error", reject);
        });

        // Check PDF exists
        await fsPromises.access(filePath);

        console.log(
            "PDF created successfully:",
            filePath
        );

        // ==========================================
        // SEND PDF
        // ==========================================

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

// ==========================================
// 404 HANDLER
// ==========================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "Route not found",
        path: req.path,
    });
});

// ==========================================
// ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);

    if (!res.headersSent) {
        res.status(500).json({
            success: false,
            error: "Internal server error",
        });
    }
});

// ==========================================
// VERCEL / LOCAL SERVER
// ==========================================

// Vercel can detect an Express app directly.
// Keep listen for local development.
if (process.env.NODE_ENV !== "production") {
    app.listen(port, () => {
        console.log(
            `PlantScan server running on port ${port}`
        );
    });
}

// Export Express app for Vercel
module.exports = app;