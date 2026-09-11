# PlantScan

PlantScan is an AI-powered plant analysis web application. A user uploads a plant image, the server sends the image to Google's Gemini model, and the browser displays an analysis covering likely species, health, characteristics, care instructions, and interesting facts. The result and the uploaded image can then be exported as a PDF report.

The application is a small Node.js/Express service with a single-page frontend. It does not use a database: temporary images and generated reports are stored on the local filesystem.

## Features

- Upload an image by selecting a file or dragging it into the analyzer.
- Preview the selected image in the browser.
- Analyze the image with Google Gemini.
- Display natural-language plant identification and care guidance.
- Generate and download a PDF report containing the analysis and image.
- Responsive PlantScan interface with sections for the workflow, features, and about information.

## How It Works

1. The browser submits the selected image as `multipart/form-data` to `POST /analyze`.
2. Multer writes the upload temporarily to `upload/`.
3. The server reads the file as base64 and sends it to the configured Gemini model.
4. The server removes the temporary upload after a successful analysis.
5. The browser renders the returned analysis and retains the returned data URL for the report.
6. When the user selects **Download PDF Report**, the browser sends the analysis and image to `POST /download`.
7. PDFKit creates a report in `reports/`, Sharp converts the image to PNG for PDFKit, and Express streams the report to the browser.
8. The generated PDF is removed after a successful download.

## Technology Stack

- Node.js and Express 5
- Multer for multipart image uploads
- Google Generative AI SDK for Gemini image analysis
- Sharp for image conversion
- PDFKit for PDF generation
- dotenv for environment configuration
- HTML, CSS, and browser JavaScript for the frontend
- Font Awesome and Google Fonts loaded from CDNs by the frontend

## Project Structure

```text
.
├── app.js                 # Express server and API routes
├── package.json           # Project metadata, scripts, and dependencies
├── package-lock.json      # Locked dependency versions
├── public/
│   └── index.html         # PlantScan frontend and browser-side API logic
├── reports/               # Generated PDF reports (runtime output)
└── upload/               # Temporary uploaded images (runtime storage)
```

The `reports/` and `upload/` directories must be writable by the process. They may contain files left behind if a request fails or the process stops while a file is being handled.

## Requirements

- Node.js 20.9 or newer is recommended for the current locked Sharp dependency.
- npm
- A Google Gemini API key with access to the model configured in `app.js`.
- Internet access for Gemini requests and the frontend's CDN-hosted fonts/icons.

## Installation

Clone or copy the project, then install its dependencies:

```bash
npm install
```

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key
PORT=5000
```

`GEMINI_API_KEY` is required. `PORT` is optional and defaults to `5000`.

Never commit a real API key. Use a local `.env` file or your deployment platform's secret manager, and add `.env` to `.gitignore` before publishing the repository.

## Running the Application

Start the server with:

```bash
npm start
```

Open [http://localhost:5000](http://localhost:5000) in a browser. If `PORT` is set, use that port instead.

The only npm script currently defined is:

```text
npm start    Start the Express server with Node.js
```

There is currently no automated test or build script.

## API Reference

### `GET /`

Serves the static PlantScan interface from `public/index.html`.

### `POST /analyze`

Analyzes one uploaded plant image.

Request:

- Content type: `multipart/form-data`
- File field: `image`

Example:

```bash
curl -X POST http://localhost:5000/analyze \
  -F "image=@/path/to/plant.jpg"
```

Successful response:

```json
{
  "result": "AI-generated plant analysis...",
  "image": "data:image/jpeg;base64,..."
}
```

Error responses:

- `400` when no image file is supplied.
- `500` when image processing or the Gemini request fails.

The current backend accepts the MIME type reported by the client and does not configure a Multer file-size limit or server-side image allowlist. The UI advertises JPG, JPEG, PNG, and WEBP, while Sharp may support additional formats such as AVIF depending on the installed platform binaries.

### `POST /download`

Creates and downloads a PDF report.

Request body:

```json
{
  "result": "Plant analysis text",
  "image": "data:image/jpeg;base64,..."
}
```

Example:

```bash
curl -X POST http://localhost:5000/download \
  -H "Content-Type: application/json" \
  -d '{"result":"Plant analysis text"}' \
  -o Plant_Analysis_Report.pdf
```

The image is optional. When supplied, it must be a base64 data URL in the form `data:image/<type>;base64,<data>`. The server converts it to PNG before embedding it in the PDF.

Responses:

- `200`: PDF download with the filename `Plant_Analysis_Report.pdf`.
- `400`: no analysis result was supplied.
- `500`: report generation or download failed.

## Configuration

The server reads configuration through `dotenv`:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Yes | None | Credential used by the Google Generative AI SDK. |
| `PORT` | No | `5000` | Port used by the Express server. |

The Gemini model is currently hard-coded in `app.js` as `gemini-3.6-flash`. Make sure that model is available to the Gemini account associated with the API key.

## Storage and Cleanup

- Uploaded images are written to `upload/` using generated, extensionless filenames.
- Successful analysis requests remove their temporary upload.
- An upload can remain in `upload/` after a failed request or process interruption.
- Reports are written to `reports/` with timestamp-based filenames.
- Reports are removed after a successful response download.
- A report can remain after a failed download or process interruption.
- No user records, history, or application state are persisted in a database.

For local cleanup, stop the server first and remove only generated files from `upload/` and `reports/` as appropriate. Do not remove the directories themselves unless the application can recreate them or you create them again.

## Security and Reliability Notes

This project is suitable as a local or prototype application in its current form. Before exposing it to untrusted users or the public internet, address the following:

- Keep `GEMINI_API_KEY` server-side and rotate any key that has been exposed.
- Add `.env`, generated uploads, and generated reports to `.gitignore`.
- Validate file type and file size on the server; do not rely only on the browser's `accept` attribute.
- Consider image dimension limits and processing timeouts to control resource usage.
- Add authentication, authorization, rate limiting, and request logging for multi-user deployments.
- Add CSRF protection if the service is used with cookie-based authentication.
- Validate the JSON and data URL received by `/download` instead of trusting client-supplied content.
- Render model output as text or sanitize it before inserting it into the page. The current frontend uses `innerHTML` for the analysis response.
- Add cleanup for files left after failed requests and process crashes.
- Confirm that the configured Gemini model and API quota are available in the deployment environment.
- Treat the model's identification and care guidance as advisory. Image-based AI results can be incorrect and are not a substitute for expert botanical, agricultural, or medical advice.

## Troubleshooting

### The server does not start

Confirm that dependencies are installed and that the selected Node.js version is compatible with the locked Sharp dependency:

```bash
node --version
npm install
npm start
```

### Analysis requests fail

Check that:

- `.env` exists in the project root.
- `GEMINI_API_KEY` is set and valid.
- The API key can access `gemini-3.6-flash`.
- The machine has network access to the Gemini API.
- The `upload/` directory is writable.

The server logs the underlying error to its terminal while returning a generic error response to the browser.

### PDF generation fails

Check that:

- The request contains a non-empty `result`.
- The `reports/` directory is writable.
- The supplied image is a valid base64 data URL.
- Sharp installed its platform-specific binaries correctly.

## License

The project metadata currently declares the `ISC` license in `package.json`. Review and update that declaration if the project is distributed under different terms.
