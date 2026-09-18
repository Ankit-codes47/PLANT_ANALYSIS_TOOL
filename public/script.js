(function () {
  "use strict";

  const GITHUB_URL = "https://github.com/Ankit-codes47";
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

  let selectedFile = null;
  let analysisResult = "";
  let analysisImage = "";
  let isAnalyzing = false;
  let hasError = false;
  let isGeneratingPDF = false;
  let previewObjectUrl = null;

  const SECTION_LABELS = [
    { pattern: /^species\s*:??\s*$/i, title: "Species", icon: "icon-leaf" },
    { pattern: /^health(\s*assessment)?\s*:??\s*$/i, title: "Health", icon: "icon-health" },
    { pattern: /^characteristics?\s*:??\s*$/i, title: "Characteristics", icon: "icon-sun" },
    { pattern: /^care(\s*instructions?|\s*recommendations?)?\s*:??\s*$/i, title: "Care", icon: "icon-care" },
    { pattern: /^recommendations?\s*:??\s*$/i, title: "Recommendations", icon: "icon-water" },
    { pattern: /^interesting\s*facts?\s*:??\s*$/i, title: "Interesting Facts", icon: "icon-facts" },
    { pattern: /^plant\s*overview\s*:??\s*$/i, title: "Plant Overview", icon: "icon-leaf" },
    { pattern: /^analysis\s*:??\s*$/i, title: "Analysis", icon: "icon-scan" },
  ];

  const navbar = document.getElementById("navbar");
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("navMenu");

  const uploadPanel = document.getElementById("uploadPanel");
  const dropZone = document.getElementById("dropZone");
  const dropDefault = document.getElementById("dropDefault");
  const dropDragging = document.getElementById("dropDragging");
  const imageInput = document.getElementById("imageInput");
  const previewPanel = document.getElementById("previewPanel");
  const imagePreview = document.getElementById("imagePreview");
  const previewFilename = document.getElementById("previewFilename");
  const previewFilesize = document.getElementById("previewFilesize");
  const changeImageBtn = document.getElementById("changeImageBtn");
  const removeImageBtn = document.getElementById("removeImageBtn");
  const analyzeBtn = document.getElementById("analyzeBtn");

  const loadingPanel = document.getElementById("loadingScreen");
  const errorPanel = document.getElementById("errorScreen");
  const errorTitle = document.getElementById("errorTitle");
  const errorMessage = document.getElementById("errorMessage");
  const tryAgainBtn = document.getElementById("tryAgainBtn");

  const resultPanel = document.getElementById("resultSection");
  const resultImage = document.getElementById("resultImage");
  const resultContent = document.getElementById("resultContent");
  const downloadBtn = document.getElementById("downloadBtn");
  const downloadBtnText = document.getElementById("downloadBtnText");
  const analyzeAnotherBtn = document.getElementById("analyzeAnotherBtn");

  const githubLinks = document.querySelectorAll('a[href*="github.com"]');
  githubLinks.forEach((link) => {
    link.href = GITHUB_URL;
  });

  initializeState();
  initNavbar();
  initMobileMenu();
  initUpload();
  initAnalyzer();
  initDownload();
  initReset();
  initScrollReveal();

  function initNavbar() {
    const onScroll = () => {
      navbar.classList.toggle("scrolled", window.scrollY > 20);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function initMobileMenu() {
    navToggle.addEventListener("click", () => {
      const isOpen = navMenu.classList.toggle("open");
      navToggle.classList.toggle("active", isOpen);
      navToggle.setAttribute("aria-expanded", String(isOpen));
      navToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    });

    navMenu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navMenu.classList.remove("open");
        navToggle.classList.remove("active");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && navMenu.classList.contains("open")) {
        navMenu.classList.remove("open");
        navToggle.classList.remove("active");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  function initializeState() {
    isAnalyzing = false;
    hasError = false;
    selectedFile = null;
    analysisResult = "";
    analysisImage = "";
    imageInput.value = "";
    revokePreviewUrl();
    resultContent.replaceChildren();
    dropZone.classList.remove("dragging");
    dropDefault.hidden = false;
    dropDragging.hidden = true;
    previewPanel.hidden = true;
    uploadPanel.style.display = "block";
    loadingPanel.style.display = "none";
    errorPanel.style.display = "none";
    resultPanel.style.display = "none";
    analyzeBtn.disabled = false;
    downloadBtn.disabled = false;
    downloadBtnText.textContent = "Download PDF Report";
  }

  function initScrollReveal() {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
  }

  function initUpload() {
    dropZone.addEventListener("click", () => {
      if (!isAnalyzing) imageInput.click();
    });

    dropZone.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !isAnalyzing) {
        event.preventDefault();
        imageInput.click();
      }
    });

    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (isAnalyzing) return;
      dropZone.classList.add("dragging");
      dropDefault.hidden = true;
      dropDragging.hidden = false;
    });

    dropZone.addEventListener("dragleave", (event) => {
      event.preventDefault();
      resetDragState();
    });

    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      resetDragState();
      if (isAnalyzing) return;
      const file = event.dataTransfer.files[0];
      if (file) handleFileSelection(file);
    });

    imageInput.addEventListener("change", () => {
      const file = imageInput.files[0];
      if (file) handleFileSelection(file);
    });

    changeImageBtn.addEventListener("click", () => imageInput.click());
    removeImageBtn.addEventListener("click", clearSelectedFile);
  }

  function resetDragState() {
    dropZone.classList.remove("dragging");
    dropDefault.hidden = false;
    dropDragging.hidden = true;
  }

  function handleFileSelection(file) {
    const validation = validateFile(file);
    if (!validation.valid) {
      showError("Invalid file", validation.message);
      return;
    }

    selectedFile = file;
    hasError = false;
    revokePreviewUrl();

    previewObjectUrl = URL.createObjectURL(file);
    imagePreview.src = previewObjectUrl;
    previewFilename.textContent = file.name;
    previewFilesize.textContent = formatFileSize(file.size);

    uploadPanel.style.display = "block";
    previewPanel.hidden = false;
    dropZone.style.display = "none";
    hideError();
    hideLoadingState();
    hideResult();
  }

  function validateFile(file) {
    if (!file) {
      return { valid: false, message: "Please select an image file to analyze." };
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return { valid: false, message: "Please upload a JPG, PNG, or WEBP image file." };
    }
    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, message: "Image is too large. Please use a file under 10 MB." };
    }
    if (file.size === 0) {
      return { valid: false, message: "The selected file appears to be empty." };
    }
    return { valid: true };
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function revokePreviewUrl() {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
  }

  function clearSelectedFile() {
    selectedFile = null;
    imageInput.value = "";
    revokePreviewUrl();
    imagePreview.removeAttribute("src");
    previewPanel.hidden = true;
    dropZone.style.display = "grid";
    uploadPanel.style.display = "block";
    resetDragState();
    hideError();
    hideResult();
    hideLoadingState();
  }

  function initAnalyzer() {
    analyzeBtn.addEventListener("click", runAnalysis);
    tryAgainBtn.addEventListener("click", () => {
      hasError = false;
      hideError();
      if (selectedFile) {
        uploadPanel.style.display = "block";
        previewPanel.hidden = false;
        dropZone.style.display = "none";
      } else {
        uploadPanel.style.display = "block";
        previewPanel.hidden = true;
        dropZone.style.display = "grid";
      }
    });
  }

  async function runAnalysis() {
    if (isAnalyzing) return;

    if (!selectedFile) {
      showError("No image selected", "Please upload a plant image before analyzing.");
      return;
    }

    const validation = validateFile(selectedFile);
    if (!validation.valid) {
      showError("Invalid file", validation.message);
      return;
    }

    isAnalyzing = true;
    hasError = false;
    analyzeBtn.disabled = true;
    hideError();
    hideResult();
    showLoadingState();

    const formData = new FormData();
    formData.append("image", selectedFile);

    try {
      const response = await fetch("/analyze", {
        method: "POST",
        body: formData,
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      if (!response.ok) {
        console.error("ANALYZE API ERROR:", data);
        throw new Error(
          data.details ||
          data.error ||
          `Analysis failed with HTTP ${response.status}`
        );
      }

      if (!data.result) {
        throw new Error("Analysis response did not include a result.");
      }

      console.log("ANALYZE SUCCESS:", data);
      analysisResult = data.result;
      analysisImage = data.image || "";
      showResultState();
    } catch (error) {
      console.error("FULL ANALYZE ERROR:", error);
      showError("Something went wrong", error.message || "Unknown analysis error");
    } finally {
      isAnalyzing = false;
      analyzeBtn.disabled = false;
      hideLoadingState();
    }
  }

  function showUploadState() {
    uploadPanel.style.display = "block";
    previewPanel.hidden = !selectedFile;
    dropZone.style.display = selectedFile ? "none" : "grid";
    loadingPanel.style.display = "none";
    errorPanel.style.display = "none";
    resultPanel.style.display = "none";
  }

  function showLoadingState() {
    uploadPanel.style.display = "none";
    loadingPanel.style.display = "block";
    errorPanel.style.display = "none";
    resultPanel.style.display = "none";
  }

  function hideLoadingState() {
    loadingPanel.style.display = "none";
  }

  function showError(title, message) {
    hasError = true;
    errorTitle.textContent = title;
    errorMessage.textContent = message;
    uploadPanel.style.display = "none";
    loadingPanel.style.display = "none";
    errorPanel.style.display = "block";
    resultPanel.style.display = "none";
  }

  function hideError() {
    hasError = false;
    errorPanel.style.display = "none";
  }

  function hideResult() {
    resultPanel.style.display = "none";
    resultContent.replaceChildren();
  }

  function showResultState() {
    isAnalyzing = false;
    hasError = false;
    uploadPanel.style.display = "none";
    loadingPanel.style.display = "none";
    errorPanel.style.display = "none";
    resultPanel.style.display = "block";

    if (analysisImage) {
      resultImage.src = analysisImage;
      resultImage.alt = "Analyzed plant image";
    } else if (previewObjectUrl) {
      resultImage.src = previewObjectUrl;
    }

    renderAnalysisResult(analysisResult, resultContent);
    resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderAnalysisResult(text, container) {
    container.replaceChildren();
    const sections = parseSections(text);

    if (sections.length > 1) {
      sections.forEach((section) => {
        const card = document.createElement("div");
        card.className = "result-section-card";

        const heading = document.createElement("h5");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("width", "16");
        icon.setAttribute("height", "16");
        icon.setAttribute("aria-hidden", "true");

        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#" + findIconForSection(section.title));
        icon.appendChild(use);

        heading.appendChild(icon);
        heading.appendChild(document.createTextNode(section.title));

        const body = document.createElement("p");
        body.textContent = section.content;

        card.appendChild(heading);
        card.appendChild(body);
        container.appendChild(card);
      });
      return;
    }

    const paragraphs = text.split(/\n+/).filter((p) => p.trim());
    if (paragraphs.length <= 1) {
      const p = document.createElement("p");
      p.className = "result-paragraph";
      p.textContent = text.trim();
      container.appendChild(p);
      return;
    }

    paragraphs.forEach((para) => {
      const p = document.createElement("p");
      p.className = "result-paragraph";
      p.textContent = para.trim();
      container.appendChild(p);
    });
  }

  function findIconForSection(title) {
    const match = SECTION_LABELS.find((s) => s.title.toLowerCase() === title.toLowerCase());
    return match ? match.icon : "icon-leaf";
  }

  function parseSections(text) {
    const lines = text.split("\n");
    const sections = [];
    let current = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const labelMatch = SECTION_LABELS.find((s) => {
        const colonMatch = trimmed.match(/^(.+?)\s*:+\s*(.*)$/);
        if (!colonMatch) return s.pattern.test(trimmed);
        return s.pattern.test(colonMatch[1].trim());
      });

      if (labelMatch) {
        const colonMatch = trimmed.match(/^(.+?)\s*:+\s*(.*)$/);
        const inlineContent = colonMatch ? colonMatch[2].trim() : "";

        if (current) sections.push(current);

        current = {
          title: labelMatch.title,
          content: inlineContent,
        };
      } else if (current) {
        current.content += (current.content ? "\n" : "") + trimmed;
      } else {
        const genericMatch = trimmed.match(/^([A-Z][A-Za-z\s]{2,30})\s*:+\s*(.+)$/);
        if (genericMatch) {
          if (current) sections.push(current);
          current = {
            title: genericMatch[1].trim(),
            content: genericMatch[2].trim(),
          };
        } else if (!current) {
          current = { title: "Overview", content: trimmed };
        } else {
          current.content += "\n" + trimmed;
        }
      }
    }

    if (current) sections.push(current);
    const meaningful = sections.filter((section) => section.content && section.content.trim());
    if (meaningful.length <= 1 && sections.length === 1 && sections[0].title === "Overview") {
      return [];
    }
    return meaningful.length > 0 ? meaningful : sections;
  }

  function initDownload() {
    downloadBtn.addEventListener("click", downloadPDF);
  }

  async function downloadPDF() {
    if (isGeneratingPDF || !analysisResult) return;

    isGeneratingPDF = true;
    downloadBtn.disabled = true;
    downloadBtnText.textContent = "Generating PDF...";

    try {
      const response = await fetch("/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result: analysisResult,
          image: analysisImage,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "Plant_Analysis_Report.pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      } else {
        showDownloadError();
      }
    } catch {
      showDownloadError();
    } finally {
      isGeneratingPDF = false;
      downloadBtn.disabled = false;
      downloadBtnText.textContent = "Download PDF Report";
    }
  }

  function showDownloadError() {
    downloadBtnText.textContent = "Download failed — try again";
    setTimeout(() => {
      downloadBtnText.textContent = "Download PDF Report";
    }, 4000);
  }

  function initReset() {
    analyzeAnotherBtn.addEventListener("click", resetAll);
  }

  function resetAll() {
    selectedFile = null;
    analysisResult = "";
    analysisImage = "";
    isAnalyzing = false;
    hasError = false;
    isGeneratingPDF = false;

    imageInput.value = "";
    revokePreviewUrl();
    imagePreview.removeAttribute("src");
    resultImage.removeAttribute("src");
    resultContent.replaceChildren();

    downloadBtn.disabled = false;
    downloadBtnText.textContent = "Download PDF Report";
    analyzeBtn.disabled = false;

    uploadPanel.style.display = "block";
    previewPanel.hidden = true;
    dropZone.style.display = "grid";
    resetDragState();
    hideError();
    hideResult();
    showUploadState();
    document.getElementById("analyze").scrollIntoView({ behavior: "smooth", block: "start" });
  }
})();
