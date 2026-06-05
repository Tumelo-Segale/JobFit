"use strict";

/* ═══════════════════════════════════════════════════════
   JOBFIT v2.0 - CSP-COMPLIANT, FULLY OFFLINE
   ─────────────────────────────────────────────────────
   All improvements from v1 audit:
   • Contextual scoring with weighted confidence
   • Porter-style stemming for JD keyword matching
   • Adaptive department detection (TF-IDF-like scoring)
   • Dynamic adaptive threshold for keyword stuffing
   • Dynamic checklist tasks (only flags relevant items)
   • sessionStorage persistence across reloads
   • Score ring animates once - no replay on tab switch
   • Score breakdown tooltip/panel
   • Tab state preserved across re-runs
   • Progress feedback during file parsing
   • "All Clear" label when 0 warnings
   • Outreach template channels persisted (no reset on switch)
   • Report export: Markdown copy & print/PDF
   • LinkedIn URL format validation
   • Spell-check integration via browser spellcheck
   • RTF file support
   • Personalised outreach (name/skills from CV)
   • Full ARIA keyboard navigation
   • Version shown in UI
   • Feedback link
   • Methodology transparency disclaimer
   • System font fallback (no Google Fonts network dep)
   ═══════════════════════════════════════════════════════ */

const APP_VERSION = "2.0.0";

/* ── STATE ────────────────────────────────────────── */
let state = {
  cvText: "",
  cvFileName: "",
  cvFileSize: 0,
  cvFileType: "",
  jobDescription: "",
  result: null,
  isLoading: false,
  inputMode: "upload",
  completedTasks: [],
  outreachChannel: "linkedin",
  activeTab: "overview",
  outreachEdits: { linkedin: null, email: null }, // persists user edits across channel switches
  scoreAnimated: false, // animate ring only once
};

/* ── SESSION PERSISTENCE ──────────────────────────── */
const SESSION_KEY = "jobfit_session_v2";
function saveSession() {
  try {
    const snap = {
      cvText: state.cvText,
      cvFileName: state.cvFileName,
      cvFileSize: state.cvFileSize,
      cvFileType: state.cvFileType,
      jobDescription: state.jobDescription,
      completedTasks: state.completedTasks,
      outreachChannel: state.outreachChannel,
      outreachEdits: state.outreachEdits,
      activeTab: state.activeTab,
      result: state.result,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snap));
  } catch (_) {}
}
function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    Object.assign(state, snap);
    return true;
  } catch (_) {
    return false;
  }
}
function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

/* ── PORTER STEMMER (light) ───────────────────────── */
// Reduces words to approximate stems so "engineer" matches "engineering", etc.
function stem(word) {
  let w = word.toLowerCase().trim();
  if (w.length <= 3) return w;
  // Step 1a
  if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ies")) w = w.slice(0, -2);
  else if (!w.endsWith("ss") && w.endsWith("s")) w = w.slice(0, -1);
  // Step 1b
  if (w.endsWith("eed")) {
    if (w.length > 4) w = w.slice(0, -1);
  } else if (w.endsWith("ing")) {
    const stem = w.slice(0, -3);
    if (stem.length > 2) w = stem;
  } else if (w.endsWith("ed")) {
    const stem = w.slice(0, -2);
    if (stem.length > 2) w = stem;
  }
  // Step 2
  const step2 = [
    ["ational", "ate"],
    ["tional", "tion"],
    ["enci", "ence"],
    ["anci", "ance"],
    ["izer", "ize"],
    ["iser", "ise"],
    ["alism", "al"],
    ["ation", "ate"],
    ["ator", "ate"],
    ["alism", "al"],
    ["aliti", "al"],
    ["ousli", "ous"],
    ["entli", "ent"],
    ["eli", "e"],
    ["ousli", "ous"],
    ["ization", "ize"],
    ["isation", "ise"],
    ["ation", "ate"],
    ["alism", "al"],
  ];
  for (const [suf, rep] of step2) {
    if (w.endsWith(suf) && w.length - suf.length > 1) {
      w = w.slice(0, -suf.length) + rep;
      break;
    }
  }
  // Step 3 - remove trailing vowel-consonant patterns
  if (w.endsWith("icate") || w.endsWith("alize") || w.endsWith("icalise"))
    w = w.slice(0, -5);
  if (w.endsWith("ful") || w.endsWith("ness")) w = w.slice(0, -4);
  if (w.endsWith("al") || w.endsWith("ance") || w.endsWith("ence"))
    w = w.slice(0, -2);
  if (w.endsWith("er") || w.endsWith("ic")) w = w.slice(0, -2);
  return w.length > 2 ? w : word.toLowerCase();
}

/* ── INDUSTRIES (weighted keywords) ──────────────── */
// Each keyword has a weight. Niche/specific terms weight more than generic ones.
const INDUSTRIES = [
  {
    name: "Software Development & IT",
    keywords: [
      { w: "react", v: 3 },
      { w: "typescript", v: 3 },
      { w: "javascript", v: 3 },
      { w: "python", v: 3 },
      { w: "node", v: 2 },
      { w: "graphql", v: 3 },
      { w: "docker", v: 2 },
      { w: "kubernetes", v: 3 },
      { w: "aws", v: 2 },
      { w: "fullstack", v: 3 },
      { w: "backend", v: 2 },
      { w: "frontend", v: 2 },
      { w: "api", v: 2 },
      { w: "git", v: 2 },
      { w: "ci/cd", v: 3 },
      { w: "agile", v: 1 },
      { w: "scrum", v: 2 },
      { w: "sql", v: 2 },
      { w: "nosql", v: 3 },
      { w: "developer", v: 1 },
      { w: "engineer", v: 1 },
      { w: "software", v: 1 },
      { w: "cloud", v: 1 },
    ],
  },
  {
    name: "Technology & Cybersecurity",
    keywords: [
      { w: "cybersecurity", v: 4 },
      { w: "firewall", v: 4 },
      { w: "penetration", v: 4 },
      { w: "kubernetes", v: 3 },
      { w: "sysadmin", v: 4 },
      { w: "linux", v: 3 },
      { w: "threat", v: 3 },
      { w: "azure", v: 2 },
      { w: "monitoring", v: 2 },
      { w: "network", v: 2 },
      { w: "infrastructure", v: 2 },
      { w: "security", v: 2 },
      { w: "compliance", v: 1 },
      { w: "cloud", v: 1 },
    ],
  },
  {
    name: "Healthcare & Nursing",
    keywords: [
      { w: "nursing", v: 4 },
      { w: "nurse", v: 4 },
      { w: "patient", v: 3 },
      { w: "clinical", v: 3 },
      { w: "physician", v: 4 },
      { w: "dosage", v: 4 },
      { w: "sterile", v: 4 },
      { w: "vital signs", v: 4 },
      { w: "medical records", v: 3 },
      { w: "hospital", v: 2 },
      { w: "clinic", v: 2 },
      { w: "healthcare", v: 2 },
      { w: "medical", v: 2 },
      { w: "treatment", v: 2 },
      { w: "care", v: 1 },
    ],
  },
  {
    name: "Marketing & Public Relations",
    keywords: [
      { w: "seo", v: 4 },
      { w: "sem", v: 4 },
      { w: "adwords", v: 4 },
      { w: "copywriting", v: 3 },
      { w: "campaign", v: 3 },
      { w: "conversion", v: 3 },
      { w: "leads", v: 3 },
      { w: "brand", v: 2 },
      { w: "social media", v: 3 },
      { w: "public relations", v: 3 },
      { w: "growth", v: 2 },
      { w: "marketing", v: 2 },
      { w: "analytics", v: 2 },
      { w: "digital", v: 1 },
      { w: "content", v: 1 },
    ],
  },
  {
    name: "Finance & Accounting",
    keywords: [
      { w: "reconciliation", v: 4 },
      { w: "ledger", v: 4 },
      { w: "valuation", v: 4 },
      { w: "audit", v: 3 },
      { w: "forecasting", v: 3 },
      { w: "portfolio", v: 3 },
      { w: "banking", v: 3 },
      { w: "tax", v: 3 },
      { w: "capital", v: 2 },
      { w: "financial", v: 2 },
      { w: "accounting", v: 2 },
      { w: "budget", v: 2 },
      { w: "finance", v: 2 },
      { w: "excel", v: 1 },
    ],
  },
  {
    name: "Human Resources",
    keywords: [
      { w: "onboarding", v: 4 },
      { w: "payroll", v: 4 },
      { w: "sourcing", v: 3 },
      { w: "recruitment", v: 3 },
      { w: "talent", v: 3 },
      { w: "benefits", v: 3 },
      { w: "candidate", v: 2 },
      { w: "hiring", v: 2 },
      { w: "interview", v: 2 },
      { w: "performance", v: 2 },
      { w: "hr", v: 2 },
      { w: "compliance", v: 1 },
    ],
  },
  {
    name: "Sales & Business Development",
    keywords: [
      { w: "quota", v: 4 },
      { w: "b2b", v: 4 },
      { w: "cold call", v: 4 },
      { w: "account executive", v: 4 },
      { w: "client acquisition", v: 4 },
      { w: "crm", v: 3 },
      { w: "pipeline", v: 3 },
      { w: "negotiation", v: 3 },
      { w: "prospect", v: 3 },
      { w: "deal", v: 2 },
      { w: "revenue", v: 2 },
      { w: "sales", v: 2 },
    ],
  },
  {
    name: "Operations & Logistics",
    keywords: [
      { w: "supply chain", v: 4 },
      { w: "warehouse", v: 4 },
      { w: "procurement", v: 4 },
      { w: "process improvement", v: 4 },
      { w: "inventory", v: 3 },
      { w: "distribution", v: 3 },
      { w: "shipping", v: 3 },
      { w: "vendor", v: 3 },
      { w: "logistics", v: 3 },
      { w: "efficiency", v: 2 },
      { w: "operations", v: 2 },
      { w: "safety", v: 1 },
    ],
  },
  {
    name: "Legal & Compliance",
    keywords: [
      { w: "litigation", v: 4 },
      { w: "counsel", v: 4 },
      { w: "jurisdiction", v: 4 },
      { w: "lawyer", v: 4 },
      { w: "document review", v: 4 },
      { w: "contract", v: 3 },
      { w: "regulatory", v: 3 },
      { w: "court", v: 3 },
      { w: "agreement", v: 2 },
      { w: "policy", v: 2 },
      { w: "legal", v: 2 },
      { w: "compliance", v: 1 },
      { w: "ethics", v: 1 },
    ],
  },
  {
    name: "Education & Training",
    keywords: [
      { w: "pedagogy", v: 4 },
      { w: "curriculum", v: 4 },
      { w: "lesson plans", v: 4 },
      { w: "teacher", v: 3 },
      { w: "instructional", v: 3 },
      { w: "grading", v: 3 },
      { w: "special education", v: 4 },
      { w: "tutoring", v: 3 },
      { w: "classroom", v: 3 },
      { w: "mentoring", v: 2 },
      { w: "student", v: 2 },
      { w: "academic", v: 2 },
      { w: "education", v: 1 },
    ],
  },
  {
    name: "Administrative & Management",
    keywords: [
      { w: "office management", v: 4 },
      { w: "clerical", v: 4 },
      { w: "reception", v: 3 },
      { w: "appointments", v: 3 },
      { w: "filing", v: 3 },
      { w: "correspondence", v: 3 },
      { w: "billing", v: 3 },
      { w: "coordination", v: 2 },
      { w: "administrative", v: 2 },
      { w: "schedule", v: 2 },
      { w: "spreadsheets", v: 2 },
    ],
  },
  {
    name: "Engineering (Physical/Industrial)",
    keywords: [
      { w: "solidworks", v: 4 },
      { w: "cad", v: 4 },
      { w: "matlab", v: 4 },
      { w: "prototype", v: 3 },
      { w: "simulation", v: 3 },
      { w: "circuit", v: 3 },
      { w: "mechanical", v: 3 },
      { w: "electrical", v: 3 },
      { w: "hardware", v: 3 },
      { w: "automation", v: 3 },
      { w: "manufacturing", v: 2 },
      { w: "quality assurance", v: 2 },
      { w: "testing", v: 1 },
    ],
  },
];

function formatBytes(b) {
  if (!b) return "0 B";
  const k = 1024,
    s = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}

/* ── CONTEXT SCORER ───────────────────────────────── */
// Instead of raw keyword counting, score by weighted unique keyword presence.
// This prevents a 500-word repeat of "compliance" beating a genuine legal CV.
function detectDepartment(text) {
  const lower = text.toLowerCase();
  let bestDept = "General Career Path",
    bestScore = 0;
  const scores = {};
  INDUSTRIES.forEach((ind) => {
    let score = 0,
      uniqueHits = 0;
    ind.keywords.forEach(({ w, v }) => {
      const regex = new RegExp(
        "\\b" + w.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&") + "\\b",
        "gi"
      );
      const hits = (lower.match(regex) || []).length;
      if (hits > 0) {
        // Cap contribution at 3 occurrences to prevent stuffing dominating
        const contribution = Math.min(hits, 3) * v;
        score += contribution;
        uniqueHits++;
      }
    });
    // Require at least 3 unique keyword types to classify
    if (uniqueHits >= 3 && score > bestScore) {
      bestScore = score;
      bestDept = ind.name;
    }
    scores[ind.name] = { score, uniqueHits };
  });
  // Confidence: how much better is the winner vs 2nd place?
  const sorted = Object.values(scores).sort((a, b) => b.score - a.score);
  const confidence =
    sorted[0].score > 0
      ? Math.round(
          Math.min(
            100,
            ((sorted[0].score - (sorted[1]?.score || 0)) / sorted[0].score) *
              100
          )
        )
      : 0;
  return { dept: bestDept, confidence };
}

/* ── DYNAMIC STUFFING THRESHOLD ───────────────────── */
// Scale threshold to document length so a 1500-word CV isn't penalised for
// longer paragraphs the way a 300-word CV would be.
function stuffingThreshold(wordCount) {
  // Base: ~2.5% of word count, minimum 8, maximum 30
  return Math.max(8, Math.min(30, Math.round(wordCount * 0.025)));
}

/* ── LINKEDIN URL VALIDATOR ───────────────────────── */
function validateLinkedIn(url) {
  // Must be: linkedin.com/in/username (3-100 chars, no spaces, valid chars)
  const pattern =
    /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_]{3,100}\/?$/;
  return pattern.test(url.trim());
}

/* ── EXTRACT CANDIDATE NAME ───────────────────────── */
// Tries to find the candidate name from the first few lines of the CV
// to personalise the outreach template.
function extractCandidateName(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // First non-empty line that looks like a name (2-4 capitalised words, no numbers)
  for (const line of lines.slice(0, 5)) {
    const words = line.split(/\s+/);
    if (
      words.length >= 2 &&
      words.length <= 4 &&
      words.every((w) => /^[A-Z][a-z]+$/.test(w))
    ) {
      return line;
    }
  }
  return null;
}

/* ── EXTRACT TOP SKILLS ───────────────────────────── */
// Returns the best matched keywords from the CV to use in outreach.
function extractTopSkills(result, limit = 3) {
  if (result.keywords && result.keywords.matched.length > 0) {
    return result.keywords.matched.slice(0, limit).map((m) => m.word);
  }
  // Fallback: pick from department keywords that appear in CV
  const dept = INDUSTRIES.find((i) => i.name === result.department);
  if (!dept) return [];
  const lower = (result._rawText || "").toLowerCase();
  return dept.keywords
    .filter(({ w }) => lower.includes(w))
    .slice(0, limit)
    .map(({ w }) => w);
}

/* ── MAIN ANALYSIS ENGINE ─────────────────────────── */
function analyzeCV(
  rawText,
  fileName,
  fileSizeInBytes,
  fileType,
  jobDescription
) {
  const text = rawText.trim();
  const lowerText = text.toLowerCase();
  const length = text.length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const issues = [],
    suggestions = [],
    flags = {}; // flags drive dynamic checklist

  // ── 1. DEPARTMENT (weighted + confidence) ──────────
  const { dept: detectedDept, confidence: deptConfidence } =
    detectDepartment(text);

  // ── 2. FILE QUALITY ────────────────────────────────
  let fnScore = 100;
  const fileQualityCategories = [];
  const extension = fileName
    .slice(((fileName.lastIndexOf(".") - 1) >>> 0) + 2)
    .toLowerCase();
  const hasSpaces = /\s/.test(fileName);
  const hasSpecialChars = /[^a-zA-Z0-9.\-_]/.test(
    fileName.replace(/\.[^/.]+$/, "")
  );
  const isGeneric = /^(cv|resume|curriculum|vitae)\.?(pdf|docx|txt)?$/i.test(
    fileName
  );
  let nameStatus = "pass",
    nameDesc =
      "File named professionally - easy for ATS to associate with you.";
  if (hasSpaces || hasSpecialChars || isGeneric) {
    nameStatus = "warning";
    fnScore -= 20;
    const reasons = [];
    if (hasSpaces) reasons.push("contains spaces");
    if (hasSpecialChars) reasons.push("has special symbols");
    if (isGeneric) reasons.push("uses a generic name like 'CV' or 'Resume'");
    nameDesc = `File name ${reasons.join(", ")}. Use your real name.`;
    issues.push({
      category: "file",
      title: "Suboptimal File Name",
      description: nameDesc,
      severity: "warning",
      fixMessage: `Rename to e.g. "FirstName_LastName_Resume.${
        extension || "pdf"
      }"`,
    });
    suggestions.push({
      id: "s_file_name",
      category: "File Quality",
      title: "Rename File Professionally",
      description:
        "Older ATS databases strip spaces and symbols from filenames.",
      actionable: `Save as "${fileName
        .replace(/[^a-zA-Z0-9.]/g, "_")
        .replace(/_+/g, "_")}"`,
    });
    flags.badFileName = true;
  }
  fileQualityCategories.push({
    id: "filename",
    title: "Professional Filename",
    description: nameDesc,
    status: nameStatus,
    impact: "medium",
  });
  const typeStatus = ["pdf", "docx"].includes(extension)
    ? "pass"
    : extension === "txt"
    ? "warning"
    : "fail";
  if (typeStatus !== "pass") fnScore -= typeStatus === "fail" ? 30 : 10;
  fileQualityCategories.push({
    id: "filetype",
    title: "ATS-Friendly Format",
    description:
      typeStatus === "pass"
        ? `Using recommended .${extension} format.`
        : typeStatus === "warning"
        ? ".txt files lose all formatting metadata."
        : "Unrecognised format. Use .pdf or .docx.",
    status: typeStatus,
    impact: "high",
  });
  const isTooLarge = fileSizeInBytes > 5 * 1024 * 1024; // 5MB - more realistic threshold
  fileQualityCategories.push({
    id: "filesize",
    title: "File Size",
    description: isTooLarge
      ? "File exceeds 5MB. Some portals reject large uploads."
      : "File size is optimal.",
    status: isTooLarge ? "warning" : "pass",
    impact: "low",
  });
  if (isTooLarge) {
    fnScore -= 10;
    flags.largeFile = true;
  }

  // ── 3. FORMATTING ──────────────────────────────────
  let fmtScore = 100;
  const formattingCategories = [];
  const lines = text.split("\n");
  const columnIndicatorCount = lines.filter(
    (l) => l.includes("  ") && l.trim().length > 30
  ).length;
  const supportsColumns =
    columnIndicatorCount > 10 ||
    (text.includes("\t") && text.split("\t").length > 5);
  formattingCategories.push({
    id: "columns",
    title: "Single vs Multi-column",
    description: supportsColumns
      ? "Potential multi-column structure detected - can confuse parsers."
      : "Single-column orientation: good.",
    status: supportsColumns ? "warning" : "pass",
    impact: "high",
  });
  if (supportsColumns) {
    fmtScore -= 15;
    flags.multiColumn = true;
    issues.push({
      category: "formatting",
      title: "Potential Multi-Column Layout",
      description: "Multi-column layouts disrupt left-to-right ATS scanning.",
      severity: "warning",
      fixMessage:
        "Use a single-column layout where sections flow straight down.",
    });
    suggestions.push({
      id: "s_struct_columns",
      category: "Formatting",
      title: "Convert to Single Column",
      description:
        "Parsers scan line-by-line; split columns merge incorrectly.",
      actionable:
        "Refactor so all sections span full page width in one sequence.",
    });
  }
  const pipeCount = (text.match(/\|/g) || []).length;
  const tabularLines = lines.filter(
    (l) => (l.match(/\s{4,}/g) || []).length >= 2
  ).length;
  const hasTables = pipeCount > 8 || tabularLines > 6;
  formattingCategories.push({
    id: "tables",
    title: "Table / Grid Structures",
    description: hasTables
      ? "Dense grid blocks found - ATS may read cells out of order."
      : "No problematic table structures.",
    status: hasTables ? "warning" : "pass",
    impact: "high",
  });
  if (hasTables) {
    fmtScore -= 10;
    flags.hasTables = true;
    issues.push({
      category: "formatting",
      title: "Tabular Grid Cells",
      description: "Nested table structures are often misread by ATS parsers.",
      severity: "warning",
      fixMessage: "Use plain bullet lines and dividers instead of tables.",
    });
  }
  const textObjectSignals = (
    lowerText.match(/textbox|object|float|frame/gi) || []
  ).length;
  formattingCategories.push({
    id: "textboxes",
    title: "Text Box Containers",
    description:
      textObjectSignals >= 3
        ? "Possible text frames detected - text inside boxes is invisible to many parsers."
        : "No text box indicators found.",
    status: textObjectSignals >= 3 ? "warning" : "pass",
    impact: "medium",
  });
  if (textObjectSignals >= 3) {
    fmtScore -= 10;
    flags.textBoxes = true;
  }
  const hasGraphicsHints =
    (lowerText.match(/svg|png|jpg|jpeg|bitmap|pixel|icon|graphics/gi) || [])
      .length > 4;
  formattingCategories.push({
    id: "graphics",
    title: "Visual / Graphic Elements",
    description: hasGraphicsHints
      ? "Skill rating bars or visual icons detected - invisible to ATS."
      : "No visual decorations detected.",
    status: hasGraphicsHints ? "warning" : "pass",
    impact: "medium",
  });
  if (hasGraphicsHints) {
    fmtScore -= 10;
    flags.hasGraphics = true;
    issues.push({
      category: "formatting",
      title: "Stylistic Visual Indicators",
      description: "Rating bars and icons are stripped by parsers.",
      severity: "info",
      fixMessage:
        'Use text descriptors: "Advanced", "Intermediate", "Beginner".',
    });
  }

  // ── 4. READABILITY ─────────────────────────────────
  let readScore = 100;
  const readabilityCategories = [];
  const hasExpHeader =
    /(experience|work|employment|career|history|professional|position)/i.test(
      lowerText
    );
  const hasEduHeader = /(education|academic|college|university|degree)/i.test(
    lowerText
  );
  const weakHeaders =
    text.match(/(my journey|what i've done|things i do|skills overview)/gi) ||
    [];
  let hdStatus = "pass",
    hdDesc = "Standard section headings found.";
  if (!hasExpHeader || !hasEduHeader) {
    hdStatus = "fail";
    readScore -= 20;
    flags.missingHeaders = true;
    hdDesc = 'Missing "Experience" or "Education" headers.';
    issues.push({
      category: "readability",
      title: "Missing Standard Section Headers",
      description:
        "ATS maps your career from headers like 'Work Experience' and 'Education'.",
      severity: "error",
      fixMessage:
        'Add clearly labelled "Professional Experience" and "Education" sections.',
    });
  } else if (weakHeaders.length > 0) {
    hdStatus = "warning";
    readScore -= 10;
    flags.weakHeaders = true;
    hdDesc = `Non-standard section title: "${weakHeaders[0]}".`;
    issues.push({
      category: "readability",
      title: "Creative Section Headings",
      description: `"${weakHeaders[0]}" may not be recognised by parsing engines.`,
      severity: "warning",
      fixMessage:
        'Use standard labels: "Work Experience", "Education", "Skills".',
    });
    suggestions.push({
      id: "s_headers",
      category: "Formatting",
      title: "Standardise Section Labels",
      description: "ATS maps sections by exact header keywords.",
      actionable: `Rename "${weakHeaders[0]}" to a standard label.`,
    });
  }
  readabilityCategories.push({
    id: "headings",
    title: "Standard Section Headings",
    description: hdDesc,
    status: hdStatus,
    impact: "high",
  });

  // Date consistency
  const dateFormats = [
    {
      pattern:
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{4}\b/gi,
      label: "Mon YYYY",
    },
    { pattern: /\b\d{2}\/\d{4}\b/g, label: "MM/YYYY" },
    { pattern: /\b\d{4}\s*[-–]\s*\d{4}\b/g, label: "YYYY-YYYY" },
    { pattern: /\b(19|20)\d{2}\b/g, label: "YYYY" },
  ];
  const foundFormats = dateFormats.filter((f) => f.pattern.test(lowerText));
  const mixedDates = foundFormats.length > 2;
  const noDates = foundFormats.length === 0;
  readabilityCategories.push({
    id: "dates",
    title: "Consistent Date Formatting",
    description: mixedDates
      ? "Multiple date format styles detected - pick one and be consistent."
      : noDates
      ? "No date patterns found - ATS cannot verify employment timeline."
      : `Consistent dates found (${foundFormats[0]?.label} format).`,
    status: mixedDates ? "warning" : noDates ? "warning" : "pass",
    impact: "medium",
  });
  if (mixedDates) {
    readScore -= 10;
    flags.mixedDates = true;
    issues.push({
      category: "readability",
      title: "Inconsistent Date Formats",
      description:
        "Mixed formats (e.g. 'Jan 2022' vs '01/2022') confuse timeline parsers.",
      severity: "warning",
      fixMessage:
        'Pick one format ("MM/YYYY" recommended) and apply it throughout.',
    });
  }

  // Bullets
  const bulletCount =
    (text.match(/^[\s]*[•\-*\u2022\u2023\u25E6\u2043]/gm) || []).length +
    (text.match(/^\s*\d+\.\s/gm) || []).length;
  readabilityCategories.push({
    id: "bullets",
    title: "Bullet Point Density",
    description:
      bulletCount > 3
        ? `${bulletCount} bullet points found - good for keyword extraction.`
        : "Very few bullets. Dense paragraphs reduce keyword visibility.",
    status: bulletCount > 3 ? "pass" : "warning",
    impact: "medium",
  });
  if (bulletCount <= 3) {
    readScore -= 15;
    flags.fewBullets = true;
    issues.push({
      category: "readability",
      title: "Insufficient Bullet Usage",
      description:
        "ATS parses bullet-point sentences to extract role keywords.",
      severity: "warning",
      fixMessage: "Start each achievement with a bullet and an action verb.",
    });
    suggestions.push({
      id: "s_bullets",
      category: "Readability",
      title: "Bullet-Point Achievements",
      description: "Paragraphs reduce parser keyword extraction accuracy.",
      actionable:
        "Rewrite each accomplishment as a bullet starting with an action verb.",
    });
  }

  // Contact info
  const emailMatch = lowerText.match(
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,12}/i
  );
  const phoneMatch = lowerText.match(
    /(\+?\d{1,4}[-.\s]?)?(\(?\d{2,5}\)?[-.\s]?)?\d{3,5}[-.\s]?\d{3,6}/
  );
  const rawLinkedIn = lowerText.match(/linkedin\.com\/in\/[a-zA-Z0-9\-_\/]+/i);
  const linkedinUrl = rawLinkedIn ? rawLinkedIn[0] : null;
  const linkedinValid = linkedinUrl ? validateLinkedIn(linkedinUrl) : false;
  const missingContacts = [];
  if (!emailMatch) missingContacts.push("Email");
  if (!phoneMatch) missingContacts.push("Phone");
  if (!linkedinUrl) missingContacts.push("LinkedIn URL");
  let contactStatus = "pass";
  if (missingContacts.length > 0) {
    contactStatus = missingContacts.length >= 2 ? "fail" : "warning";
    readScore -= missingContacts.length * 6;
    flags.missingContact = true;
    issues.push({
      category: "readability",
      title: `Missing Contact Info (${missingContacts.join(", ")})`,
      description:
        "Recruiters and ATS extract contact details from the header.",
      severity: "error",
      fixMessage: `Add your ${missingContacts.join(
        " and "
      )} at the very top of your CV.`,
    });
  } else if (linkedinUrl && !linkedinValid) {
    contactStatus = "warning";
    readScore -= 5;
    flags.badLinkedIn = true;
    issues.push({
      category: "readability",
      title: "Malformed LinkedIn URL",
      description: `"${linkedinUrl}" doesn't match the standard linkedin.com/in/username format.`,
      severity: "warning",
      fixMessage: 'Use the exact format: "linkedin.com/in/yourname"',
    });
  }
  readabilityCategories.push({
    id: "contactinfo",
    title: "Contact Information",
    description:
      missingContacts.length === 0
        ? linkedinValid
          ? "Email, Phone, and valid LinkedIn URL found."
          : linkedinUrl
          ? "Email and Phone found. Check LinkedIn URL format."
          : "Email and Phone found - no LinkedIn URL."
        : `Missing: ${missingContacts.join(", ")}.`,
    status: contactStatus,
    impact: "high",
  });

  // ── 5. CONTENT QUALITY ─────────────────────────────
  let cntScore = 100;
  const contentCategories = [];
  const hasSummary =
    /(summary|profile|professional profile|background|objective|about)/i.test(
      lowerText
    ) || wordCount > 400;
  contentCategories.push({
    id: "summary",
    title: "Professional Summary",
    description: hasSummary
      ? "A dedicated profile/summary section found."
      : "No summary section detected.",
    status: hasSummary ? "pass" : "warning",
    impact: "high",
  });
  if (!hasSummary) {
    cntScore -= 10;
    flags.noSummary = true;
  }

  // Contextual metrics - look for impact verbs + numbers together
  const impactPhrases = (
    text.match(
      /\b(led|grew|reduced|increased|improved|managed|delivered|achieved|built|launched|saved|generated|drove|scaled|optimised|optimized)\b/gi
    ) || []
  ).length;
  const metricsCount = (
    text.match(
      /(\d+%|\$[\d,]+|\d+[\s]*(million|thousand|k\b)|\d+\s*(people|team|reports|clients|users|projects))/gi
    ) || []
  ).length;
  const hasMetrics = metricsCount >= 2;
  const hasImpactVerbs = impactPhrases >= 3;
  contentCategories.push({
    id: "metrics",
    title: "Quantified Achievements",
    description: hasMetrics
      ? `${metricsCount} quantified impacts found (numbers + outcomes).`
      : hasImpactVerbs
      ? "Impact verbs present but very few concrete numbers or percentages."
      : "No quantified achievements detected.",
    status: hasMetrics ? "pass" : "warning",
    impact: "medium",
  });
  if (!hasMetrics) {
    cntScore -= 15;
    flags.noMetrics = true;
    suggestions.push({
      id: "s_metrics",
      category: "Content Quality",
      title: "Add Quantified Achievements",
      description: "Numbers make accomplishments concrete and scannable.",
      actionable:
        'Add outcomes with numbers: "Reduced onboarding time by 30%" or "Managed R200k budget".',
    });
  }

  const hasCerts =
    /(certifications|certified|certificates|licensure|credentials|pmp|aws certified|cpa|cfa|cissp|scrum)/i.test(
      lowerText
    );
  contentCategories.push({
    id: "certifications",
    title: "Certifications",
    description: hasCerts
      ? "Certification signals found."
      : "No certifications found (optional for some roles).",
    status: hasCerts ? "pass" : "warning",
    impact: "low",
  });

  const hasProjects =
    /(projects|portfolio|accomplishments|case studies|open.?source)/i.test(
      lowerText
    );
  contentCategories.push({
    id: "projects",
    title: "Projects / Portfolio",
    description: hasProjects
      ? "Projects section found."
      : "No projects section (optional).",
    status: hasProjects ? "pass" : "warning",
    impact: "low",
  });

  // Keyword stuffing - adaptive threshold based on doc length
  const threshold = stuffingThreshold(wordCount);
  const stopTerms = new Set([
    "experience",
    "education",
    "management",
    "project",
    "development",
    "software",
    "skills",
    "including",
    "systems",
    "working",
    "managed",
    "responsibilities",
    "position",
    "company",
    "business",
    "team",
  ]);
  const wordFreqMap = {};
  lowerText
    .replace(/[^a-z\s]/gi, "")
    .split(/\s+/)
    .forEach((w) => {
      if (w.length > 4 && !stopTerms.has(w))
        wordFreqMap[w] = (wordFreqMap[w] || 0) + 1;
    });
  let stuffedWord = "",
    stuffedCount = 0;
  for (const [w, c] of Object.entries(wordFreqMap)) {
    if (c > threshold && c > stuffedCount) {
      stuffedWord = w;
      stuffedCount = c;
    }
  }
  if (stuffedWord) {
    cntScore -= 10;
    flags.stuffedKeyword = stuffedWord;
    const rate = ((stuffedCount / wordCount) * 100).toFixed(1);
    issues.push({
      category: "content",
      title: `Keyword Stuffing Risk ("${stuffedWord}")`,
      description: `"${stuffedWord}" appears ${stuffedCount}× (${rate}% of document - threshold: ${threshold}).`,
      severity: "warning",
      fixMessage: `Substitute synonyms for "${stuffedWord}" to improve diversity.`,
    });
    suggestions.push({
      id: "s_stuffing",
      category: "Optimization",
      title: "Reduce Term Repetition",
      description: `"${stuffedWord}" exceeds the adaptive density threshold for this document length.`,
      actionable: `Review each instance of "${stuffedWord}" and replace where possible with synonyms.`,
    });
  }

  // Caps overuse
  const capsWords = (text.match(/\b[A-Z]{6,}\b/g) || []).filter(
    (w) =>
      ![
        "GITHUB",
        "GITLAB",
        "DOCKER",
        "AMAZON",
        "GOOGLE",
        "PYTHON",
        "JAVASCRIPT",
        "TYPESCRIPT",
        "HTML",
        "CSS",
        "SASS",
        "REST",
        "AJAX",
        "JSON",
        "SQL",
        "API",
        "AWS",
        "GCP",
        "AZURE",
        "REACT",
        "REDUX",
        "LINUX",
        "NGINX",
      ].includes(w)
  );
  if (capsWords.length > 12) {
    cntScore -= 5;
    issues.push({
      category: "content",
      title: "Excessive All-Caps Text",
      description: "All-caps body text can disrupt parser tokenisation.",
      severity: "info",
      fixMessage: "Use Sentence Case for all body text except acronyms.",
    });
  }

  // ── 6. KEYWORD / JD MATCHING (with stemming) ───────
  let keywordsResult = null,
    jdKwScore = 0;
  if (jobDescription && jobDescription.trim().length > 10) {
    const jdClean = jobDescription.toLowerCase().replace(/[^a-z0-9#+\s]/g, " ");
    const stopWords = new Set([
      "with",
      "this",
      "that",
      "they",
      "from",
      "your",
      "their",
      "work",
      "have",
      "experience",
      "skills",
      "about",
      "team",
      "ideal",
      "candidate",
      "responsibilities",
      "requirements",
      "must",
      "should",
      "will",
      "highly",
      "ability",
      "looking",
      "needed",
      "role",
      "position",
      "other",
      "including",
      "years",
      "using",
      "working",
      "able",
      "also",
      "make",
      "well",
      "good",
      "great",
      "strong",
      "least",
      "plus",
      "nice",
      "into",
      "been",
      "more",
      "than",
      "some",
      "when",
      "what",
      "where",
      "which",
    ]);
    const wordFreq = {};
    jdClean.split(/\s+/).forEach((w) => {
      if (w.length > 3 && !stopWords.has(w) && isNaN(Number(w))) {
        const s = stem(w);
        wordFreq[s] = (wordFreq[s] || 0) + 1;
      }
    });
    const topKW = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map((e) => e[0]);

    const cvStemmed = {};
    lowerText
      .replace(/[^a-z\s]/gi, "")
      .split(/\s+/)
      .forEach((w) => {
        if (w.length > 3) {
          const s = stem(w);
          cvStemmed[s] = (cvStemmed[s] || 0) + 1;
        }
      });

    const matched = [],
      missing = [],
      density = [];
    topKW.forEach((kw) => {
      const count = cvStemmed[kw] || 0;
      const pct =
        wordCount > 0 ? parseFloat(((count / wordCount) * 100).toFixed(2)) : 0;
      const status = count === 0 ? "low" : pct > 3 ? "stuffed" : "good";
      if (count > 0) {
        matched.push({ word: kw, count });
        density.push({ word: kw, count, density: pct, status });
      } else missing.push(kw);
    });
    const matchPct =
      topKW.length > 0 ? Math.round((matched.length / topKW.length) * 100) : 0;
    keywordsResult = { matchPercentage: matchPct, matched, missing, density };
    jdKwScore = matchPct;
    flags.hasJD = true;
    if (missing.length > 0) {
      issues.push({
        category: "content",
        title: `${missing.length} Missing JD Keywords`,
        description: `Not found (stem-matched): ${missing
          .slice(0, 4)
          .map((w) => `"${w}"`)
          .join(", ")}.`,
        severity: "warning",
        fixMessage:
          "Weave missing keywords naturally into your experience bullets.",
      });
      suggestions.push({
        id: "s_keywords",
        category: "Keyword Match",
        title: "Add Missing JD Keywords",
        description:
          "Stem-matched keywords from the job description not found in your CV.",
        actionable: `Naturally incorporate: "${missing
          .slice(0, 3)
          .join('", "')}" into your experience.`,
      });
    }
  }

  // ── 7. ADAPTIVE SCORE WEIGHTS ──────────────────────
  // Weights shift based on what information is available and which CV type.
  // If JD present: keywords carry 40%; without JD: content carries more.
  // More lenient on content for file-only submissions (no paste = less text to analyze).
  const baseFmt = Math.max(0, Math.min(100, fmtScore));
  const baseRead = Math.max(0, Math.min(100, readScore));
  const baseCnt = Math.max(0, Math.min(100, cntScore));
  const baseFile = Math.max(0, Math.min(100, fnScore));

  let weights;
  if (keywordsResult) {
    // JD provided - keywords are the most important signal
    weights = { fmt: 0.15, read: 0.25, cnt: 0.2, file: 0.05, kw: 0.35 };
  } else if (fileType === "txt") {
    // Pasted text - file quality matters less, content matters more
    weights = { fmt: 0.2, read: 0.4, cnt: 0.35, file: 0.05, kw: 0 };
  } else {
    // Standard weighted
    weights = { fmt: 0.2, read: 0.35, cnt: 0.3, file: 0.15, kw: 0 };
  }

  const finalScore = Math.min(
    100,
    Math.max(
      1,
      Math.round(
        baseFmt * weights.fmt +
          baseRead * weights.read +
          baseCnt * weights.cnt +
          baseFile * weights.file +
          jdKwScore * weights.kw
      )
    )
  );

  // Score breakdown (for transparency panel)
  const scoreBreakdown = [
    {
      label: "Readability & Structure",
      value: baseRead,
      weight: Math.round(weights.read * 100),
      contribution: Math.round(baseRead * weights.read),
    },
    {
      label: "Content Quality",
      value: baseCnt,
      weight: Math.round(weights.cnt * 100),
      contribution: Math.round(baseCnt * weights.cnt),
    },
    {
      label: "Formatting",
      value: baseFmt,
      weight: Math.round(weights.fmt * 100),
      contribution: Math.round(baseFmt * weights.fmt),
    },
    {
      label: "File Quality",
      value: baseFile,
      weight: Math.round(weights.file * 100),
      contribution: Math.round(baseFile * weights.file),
    },
  ];
  if (keywordsResult) {
    scoreBreakdown.push({
      label: "JD Keyword Match",
      value: jdKwScore,
      weight: Math.round(weights.kw * 100),
      contribution: Math.round(jdKwScore * weights.kw),
    });
  }

  // Standard always-present suggestions
  const standardSugs = [
    {
      id: "s_verbs",
      category: "Content",
      title: "Use Strong Action Verbs",
      description:
        "Lead bullets with active verbs, not passive 'Responsible for'.",
      actionable: 'Replace "Responsible for X" with "Led X" or "Delivered X".',
    },
    {
      id: "s_dates",
      category: "Readability",
      title: "Standardise Date Formats",
      description: "Pick one date format and apply it everywhere.",
      actionable: 'Use "MM/YYYY – MM/YYYY" consistently throughout.',
    },
  ];

  // Extract candidate name for personalised outreach
  const candidateName = extractCandidateName(text);

  return {
    id: Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    score: finalScore,
    scoreBreakdown,
    scoreWeightNote: keywordsResult
      ? "Weights adjusted for JD-matched analysis."
      : "Standard weights (no JD provided).",
    fileName,
    fileSize: formatBytes(fileSizeInBytes),
    fileType,
    wordCount,
    characterCount: length,
    department: detectedDept,
    deptConfidence,
    hasJobDescription: keywordsResult !== null,
    formatting: formattingCategories,
    readability: readabilityCategories,
    content: contentCategories,
    fileQuality: fileQualityCategories,
    keywords: keywordsResult,
    issues,
    flags,
    candidateName,
    suggestions: [...suggestions, ...standardSugs].slice(0, 8),
    _rawText: text, // kept for skills extraction
  };
}

/* ── SVG ICONS ────────────────────────────────────── */
const Icons = {
  check: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
  warn: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
  fail: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
  alert: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
  back: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>`,
  refresh: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>`,
  book: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>`,
  trophy: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg>`,
  copy: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`,
  square: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
  checksq: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 11l3 3L22 4m-4 8v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h8"/></svg>`,
  building: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>`,
  pencil: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  scan: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>`,
  info: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 16v-4m0-4h.01"/></svg>`,
  flag: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18m0-13s2-2 5-2 5 2 8 2 5-2 5-2V3s-2 2-5 2-5-2-8-2-5 2-5 2z"/></svg>`,
  print: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  star: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
};

function statusIcon(status) {
  if (status === "pass")
    return `<div class="check-icon-wrap pass" aria-label="Passed">${Icons.check}</div>`;
  if (status === "warning")
    return `<div class="check-icon-wrap warn" aria-label="Warning">${Icons.warn}</div>`;
  return `<div class="check-icon-wrap fail" aria-label="Critical">${Icons.fail}</div>`;
}
function statusBadge(status) {
  if (status === "pass") return `<span class="status-badge pass">Passed</span>`;
  if (status === "warning")
    return `<span class="status-badge warn">Warning</span>`;
  return `<span class="status-badge fail">Critical</span>`;
}
function passCount(arr) {
  return arr.filter((c) => c.status === "pass").length;
}

/* ── SCORE RING ───────────────────────────────────── */
function buildRing(score) {
  const size = 150,
    sw = 10,
    r = (size - sw) / 2;
  const circ = r * 2 * Math.PI,
    offset = circ - (score / 100) * circ;
  const col =
    score < 50 ? "var(--red)" : score < 75 ? "var(--orange)" : "var(--green)";
  const track =
    score < 50
      ? "rgba(239,68,68,.1)"
      : score < 75
      ? "rgba(245,158,11,.1)"
      : "rgba(16,185,129,.1)";
  // If already animated (tab switch / re-render), render arc at its final
  // position immediately - no transition needed, no invisible flash.
  const initialOffset = state.scoreAnimated ? offset : circ;
  const transitionStyle = state.scoreAnimated
    ? "" // no transition - already at final position
    : "transition:stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1);";
  return `<div class="ring-wrap">
<svg width="${size}" height="${size}" style="transform:rotate(-90deg);" aria-hidden="true">
  <circle cx="${size / 2}" cy="${
    size / 2
  }" r="${r}" fill="transparent" stroke="${track}" stroke-width="${sw}"/>
  <circle id="score-ring-arc" cx="${size / 2}" cy="${
    size / 2
  }" r="${r}" fill="transparent"
    stroke="${col}" stroke-width="${sw}" stroke-linecap="round"
    stroke-dasharray="${circ}" stroke-dashoffset="${initialOffset}"
    style="${transitionStyle}"
    data-offset="${offset}"/>
</svg>
<div class="ring-label-wrap" style="color:${col}" aria-live="polite">
  <span class="ring-score-num" id="score-num" aria-label="ATS Score: ${score}">${
    state.scoreAnimated ? score : 0
  }</span>
  <span class="ring-ats-label">ATS Score</span>
</div>
</div>`;
}

function animateScore(target) {
  if (state.scoreAnimated) return; // animation already played - arc is already visible at final position
  const arc = document.getElementById("score-ring-arc");
  const numEl = document.getElementById("score-num");
  if (!arc || !numEl) return;
  state.scoreAnimated = true;
  requestAnimationFrame(() => {
    arc.style.strokeDashoffset = arc.dataset.offset;
  });
  let cur = 0;
  const step = Math.ceil(target / 60);
  const t = setInterval(() => {
    cur = Math.min(cur + step, target);
    numEl.textContent = cur;
    if (cur >= target) clearInterval(t);
  }, 16);
}

/* ── PERSONALISED OUTREACH ────────────────────────── */
/* Convert a plain-text outreach string to safe HTML for injection
   into a contenteditable div. Blank lines → paragraph breaks,
   single newlines → line breaks. HTML special chars are escaped. */
function textToOutreachHtml(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Double newline = paragraph gap (extra spacing), single = line break
  return escaped.replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>");
}

function getOutreachText(dept, channel, result) {
  const name = result?.candidateName || "[Your Name]";
  const skills = result ? extractTopSkills(result) : [];
  const skillLine = skills.length
    ? `my expertise in ${skills.join(", ")}`
    : "my background in this field";

  let plain;
  if (channel === "linkedin") {
    plain = `Hi [Hiring Manager],\n\nI noticed you are expanding the ${
      dept || "Product"
    } team at [Company]. With ${skillLine}, I've been focused on delivering measurable outcomes in exactly this space.\n\nI'd love a brief chat about how I could contribute to your current objectives.\n\nBest,\n${name}`;
  } else {
    plain = `Subject: ${
      dept || "Professional"
    } Role Inquiry - ${name}\n\nDear [Hiring Manager],\n\nMy name is ${name}, a specialist in ${
      dept || "this discipline"
    } with proven experience in ${skillLine}.\n\nI've been following [Company]'s work and would value the opportunity to explore how my background aligns with your current goals. I've attached my CV for your reference.\n\nWould you have 10 minutes this week for a brief call?\n\nThank you,\n${name}\n[Phone] | [Email] | [LinkedIn]`;
  }
  return textToOutreachHtml(plain);
}

/* ── DYNAMIC TASKS ────────────────────────────────── */
// Only show tasks that are relevant to what the analysis actually found.
const ALL_TASKS = [
  {
    id: "single-col",
    flag: "multiColumn",
    label: "Convert to single-column layout",
    impact: "High - ATS Reading",
    desc: "Multi-column layouts cause text to merge horizontally during parsing.",
  },
  {
    id: "add-metrics",
    flag: "noMetrics",
    label: "Add at least 3 quantified achievements (%, R, numbers)",
    impact: "High - Content Score",
    desc: "ATS and recruiters look for concrete impact numbers.",
  },
  {
    id: "fix-file-name",
    flag: "badFileName",
    label: "Rename file: FirstName_LastName_Resume.pdf",
    impact: "Medium - File Registry",
    desc: "Remove spaces and special characters from your filename.",
  },
  {
    id: "fix-headers",
    flag: "missingHeaders",
    label: "Add standard section headers (Experience, Education)",
    impact: "High - Readability",
    desc: "ATS maps your career from these exact header labels.",
  },
  {
    id: "weak-headers",
    flag: "weakHeaders",
    label: "Replace creative section names with standard labels",
    impact: "High - Readability",
    desc: "Non-standard headers like 'My Journey' are not recognised.",
  },
  {
    id: "add-bullets",
    flag: "fewBullets",
    label: "Rewrite achievements as bullet points with action verbs",
    impact: "High - Keyword Extraction",
    desc: "Bullets help parsers extract your role keywords.",
  },
  {
    id: "fix-contact",
    flag: "missingContact",
    label: "Add missing contact info at top of CV",
    impact: "Critical - Recruiter Access",
    desc: "Recruiters need email, phone, and LinkedIn to reach you.",
  },
  {
    id: "fix-linkedin",
    flag: "badLinkedIn",
    label: "Fix LinkedIn URL format (linkedin.com/in/yourname)",
    impact: "Medium - Contact Quality",
    desc: "Malformed LinkedIn URLs prevent profile verification.",
  },
  {
    id: "add-summary",
    flag: "noSummary",
    label: "Write a 3–4 sentence professional summary",
    impact: "Medium - First Impression",
    desc: "Many ATS systems extract the summary as the candidate profile.",
  },
  {
    id: "fix-dates",
    flag: "mixedDates",
    label: "Standardise all dates to one format (MM/YYYY)",
    impact: "Medium - Timeline Parsing",
    desc: "Mixed formats confuse tenure calculation algorithms.",
  },
  {
    id: "reduce-stuffing",
    flag: "stuffedKeyword",
    label: "Reduce repetition of overused keyword",
    impact: "Medium - Quality Score",
    desc: "Adaptive threshold exceeded - substitute synonyms.",
  },
  {
    id: "remove-tables",
    flag: "hasTables",
    label: "Replace tables with plain bullet sections",
    impact: "High - Parser Compatibility",
    desc: "Table cells are often read out of order or skipped entirely.",
  },
  {
    id: "remove-graphics",
    flag: "hasGraphics",
    label: "Replace graphic skill bars with text descriptors",
    impact: "Medium - Content Loss",
    desc: "Rating icons are stripped by every major ATS.",
  },
  {
    id: "large-file",
    flag: "largeFile",
    label: "Compress or simplify file to under 5MB",
    impact: "Low - Upload Compatibility",
    desc: "Some portals reject files over 5MB silently.",
  },
  {
    id: "linkedin-profile",
    flag: null,
    label: "Sync CV timeline with your LinkedIn profile",
    impact: "Essential - Consistency",
    desc: "Discrepant dates trigger integrity flags in hiring systems.",
    alwaysShow: true,
  },
];

function getDynamicTasks(flags) {
  return ALL_TASKS.filter((t) => t.alwaysShow || (t.flag && flags[t.flag]));
}

/* ── REPORT EXPORT ────────────────────────────────── */
/* ── DASHBOARD RENDERER ───────────────────────────── */
function renderDashboard(result) {
  const scoreClass =
    result.score < 50 ? "red" : result.score < 75 ? "orange" : "green";
  const scoreLabel =
    result.score < 50
      ? "Weak Compatibility"
      : result.score < 75
      ? "Average Match"
      : "Optimal Fit";

  const catBars = [
    { label: "File Quality", arr: result.fileQuality },
    { label: "Formatting", arr: result.formatting },
    { label: "Readability", arr: result.readability },
    { label: "Content Quality", arr: result.content },
  ]
    .map((c) => {
      const pct = ((passCount(c.arr) / c.arr.length) * 100).toFixed(0);
      return `<div class="matrix-row">
<div class="matrix-row-head"><span>${c.label}</span><span>${passCount(c.arr)}/${
        c.arr.length
      }</span></div>
<div class="bar-track"><div class="bar-fill ${
        parseInt(pct) >= 75 ? "green" : "orange"
      }" style="width:${pct}%"></div></div>
</div>`;
    })
    .join("");

  // ── Score breakdown panel ──────────────────────────
  function buildScorePanel() {
    return `
<div class="score-breakdown-panel" id="score-breakdown" aria-label="Score explanation">
  <div class="breakdown-title">${Icons.info} How this score is calculated</div>
  <p class="breakdown-note">${result.scoreWeightNote}</p>
  <div class="breakdown-rows">
    ${result.scoreBreakdown
      .map(
        (b) => `
    <div class="breakdown-row">
      <span class="br-label">${b.label}</span>
      <div class="br-bar-wrap">
        <div class="br-bar" style="width:${b.value}%"></div>
      </div>
      <span class="br-score">${b.value}<span class="br-wt">×${(
          b.weight / 100
        ).toFixed(2)}</span></span>
    </div>`
      )
      .join("")}
  </div>
  <div class="breakdown-disclaimer">
    <div class="breakdown-disclaimer-label"><strong>Methodology note</strong></div>
    <div class="breakdown-disclaimer-body">JobFit uses heuristic pattern-matching, not semantic AI. Scores reflect structural and keyword indicators only. A high score means your CV is ATS-readable; it does not guarantee interview selection. Treat scores as directional guidance, not absolute measures.</div>
  </div>
</div>`;
  }

  // ── Tab: Overview ──────────────────────────────────
  function tabOverview() {
    const sugs =
      result.suggestions.length > 0
        ? result.suggestions
            .map(
              (s) => `
<div class="suggestion-card" role="listitem">
  <div class="sug-cat" aria-label="Category: ${s.category}">${
                s.category || "Quality"
              }</div>
  <div class="sug-right">
    <div class="sug-title">${s.title}</div>
    <div class="sug-desc">${s.description}</div>
    <div class="sug-guide"><strong>Action:</strong> ${s.actionable}</div>
  </div>
</div>`
            )
            .join("")
        : `<div class="empty-state">No major issues found. Your CV matches structural standards well.</div>`;

    const deptNote = result.deptConfidence
      ? `<span class="dept-confidence">${result.deptConfidence}% confidence</span>`
      : "";

    return `
<div class="dept-banner">
  ${Icons.building}
  <span>Detected as <strong>${result.department}</strong> ${deptNote}</span>
  ${
    result.deptConfidence < 40
      ? `<span class="dept-warning">Low confidence - CV may span multiple fields or department keywords are sparse.</span>`
      : ""
  }
</div>
<div class="section-sub-heading">Top Improvement Recommendations</div>
<div role="list">${sugs}</div>
<div class="privacy-box">
  <span class="privacy-icon" aria-hidden="true">${Icons.shield}</span>
  <span><strong class="privacy-label">Local Privacy Mode:</strong> Your CV and job description data exist only in this browser window and are cleared on reload. <br/><em>JobFit uses heuristic analysis only - results are directional guidance, not professional career advice.</em></span>
</div>`;
  }

  // ── Tab: Boost / Playbook ──────────────────────────
  function tabBoost() {
    const dynamicTasks = getDynamicTasks(result.flags || {});
    // Pre-complete tasks that already pass
    const autoPassed = [];
    if (!result.flags?.multiColumn) autoPassed.push("single-col");
    if (!result.flags?.noMetrics) autoPassed.push("add-metrics");
    if (!result.flags?.badFileName) autoPassed.push("fix-file-name");
    if (!result.flags?.missingHeaders) autoPassed.push("fix-headers");
    if (!result.flags?.fewBullets) autoPassed.push("add-bullets");

    const effectiveDone = new Set([...state.completedTasks, ...autoPassed]);
    const total = dynamicTasks.length,
      done = dynamicTasks.filter((t) => effectiveDone.has(t.id)).length;

    const tasks = dynamicTasks.length
      ? dynamicTasks
          .map((t) => {
            const isDone = effectiveDone.has(t.id);
            const isAuto =
              autoPassed.includes(t.id) && !state.completedTasks.includes(t.id);
            return `
<div class="task-item${
              isDone ? " done" : ""
            }" data-action="toggle-task" data-task-id="${t.id}"
  role="checkbox" aria-checked="${isDone}" tabindex="0">
  <div class="task-cb">${
    isDone
      ? Icons.checksq.replace('class="', 'class="checked ')
      : Icons.square.replace('class="', 'class="unchecked ')
  }</div>
  <div class="task-main">
    <div class="task-label${isDone ? " done-text" : ""}">${t.label}
      <span class="task-impact">${t.impact}</span>
      ${isAuto ? `<span class="task-auto-badge">Auto-passed</span>` : ""}
    </div>
    <div class="task-desc">${t.desc}</div>
  </div>
</div>`;
          })
          .join("")
      : `<div class="empty-state">All actionable items are already addressed. Your CV is well-optimised.</div>`;

    const linkedinOutreach =
      state.outreachEdits.linkedin ??
      getOutreachText(result.department, "linkedin", result);
    const emailOutreach =
      state.outreachEdits.email ??
      getOutreachText(result.department, "email", result);
    const activeText =
      state.outreachChannel === "linkedin" ? linkedinOutreach : emailOutreach;

    return `
<div class="playbook-hero">
  <div class="playbook-title">${Icons.trophy} Hiring Playbook</div>
  <div class="playbook-desc">These tasks are personalised to what your analysis actually flagged - only relevant improvements are shown.</div>
</div>
<div class="checklist-card">
  <div class="checklist-title">CV Readiness Checklist
    <span class="task-progress-badge">${done}/${total} complete</span>
  </div>
  <div class="checklist-subtitle">Tailored to your specific ATS results - tasks you've already passed are marked automatically.</div>
  <div class="task-progress-bar"><div style="width:${
    total > 0 ? Math.round((done / total) * 100) : 0
  }%"></div></div>
  ${tasks}
</div>
<div class="outreach-card">
  <div class="outreach-head">${Icons.book} Personalised Outreach Templates</div>
  <div class="outreach-desc">Templates personalised with your detected name and top skills for <span class="outreach-dept">${
    result.department || "your field"
  }</span>:</div>
  <div class="channel-toggle" role="tablist">
    <button class="channel-btn${
      state.outreachChannel === "linkedin" ? " active" : ""
    }" data-action="set-channel" data-channel="linkedin" role="tab" aria-selected="${
      state.outreachChannel === "linkedin"
    }">LinkedIn DM</button>
    <button class="channel-btn${
      state.outreachChannel === "email" ? " active" : ""
    }" data-action="set-channel" data-channel="email" role="tab" aria-selected="${
      state.outreachChannel === "email"
    }">Cold Email</button>
  </div>
  <div class="outreach-editable-hint">${
    Icons.pencil
  } Edit before copying - your changes are saved when you switch channels</div>
  <div class="outreach-text" id="outreach-text" contenteditable="true" spellcheck="true" aria-label="Outreach template - click to edit">${activeText}</div>
  <button class="copy-btn" data-action="copy-outreach" aria-label="Copy template to clipboard">
    ${Icons.copy} <span id="copy-label">Copy Template</span>
  </button>
</div>`;
  }

  // ── Tab: Pattern Rules ─────────────────────────────
  function tabFormatting() {
    function section(arr, label) {
      const hasWarn = arr.some((c) => c.status !== "pass");
      return `
<div class="pattern-section">
  <div class="pattern-section-head ${
    hasWarn ? "orange" : "green"
  }" role="heading" aria-level="5">${label}</div>
  ${arr
    .map(
      (c) => `
  <div class="check-row">
    ${statusIcon(c.status)}
    <div>
      <div class="check-row-title">${c.title} ${statusBadge(c.status)}</div>
      <div class="check-row-desc">${c.description}</div>
    </div>
  </div>`
    )
    .join("")}
</div>`;
    }
    return `
<h4 class="panel-heading">ATS Pattern Checklists</h4>
<div class="pattern-grid">
  ${section(result.readability, "Readability")}
  ${section(result.formatting, "Formatting")}
  ${section(result.content, "Content")}
  ${section(result.fileQuality, "File Quality")}
</div>`;
  }

  // ── Tab: Warnings ──────────────────────────────────
  function tabIssues() {
    const n = result.issues.length;
    const cards =
      n > 0
        ? result.issues
            .map(
              (i) => `
<div class="issue-card ${i.severity}" role="listitem">
  ${i.severity === "error" ? Icons.fail : Icons.alert}
  <div>
    <div class="issue-title">${i.title}</div>
    <div class="issue-desc">${i.description}</div>
    <div class="issue-fix"><strong>Fix:</strong> ${i.fixMessage}</div>
  </div>
</div>`
            )
            .join("")
        : `<div class="no-issues" role="status">${Icons.check}<strong>Zero Critical Issues</strong><p>Your CV passes all structural ATS heuristics cleanly.</p></div>`;
    return `
<div class="issues-intro">
  <h4 class="panel-heading" style="margin-bottom:6px;">Detected ATS Warnings</h4>
  <p style="font-size:12px;color:var(--dim);margin-bottom:16px;line-height:1.5;">Fixing these will improve your CV's machine-readability. Items marked "Critical" have the highest impact.</p>
</div>
<div role="list">${cards}</div>`;
  }

  // ── Tab: Keywords ──────────────────────────────────
  function tabKeywords() {
    if (!result.keywords) {
      return `<div class="empty-state" style="padding:48px 0;text-align:center;">
        <div style="margin-bottom:12px;opacity:.4;">${Icons.scan}</div>
        <p style="font-size:13px;font-weight:700;margin-bottom:6px;">No Job Description Provided</p>
        <p style="font-size:12px;color:var(--dim);">Paste a job description in Step 2 and re-run to see keyword match analysis.</p>
      </div>`;
    }
    const kw = result.keywords;
    const densityRows = [...kw.density]
      .sort((a, b) => b.count - a.count)
      .map((d) => {
        const barPct = Math.min(
          100,
          (d.count / (result.wordCount || 1)) * 1000
        );
        const statusCol =
          d.status === "stuffed"
            ? "var(--red)"
            : d.status === "good"
            ? "var(--green)"
            : "var(--orange)";
        return `<div class="kw-density-row">
  <span class="kw-word">${d.word}</span>
  <div class="kw-bar-track"><div class="kw-bar-fill" style="width:${barPct}%;background:${statusCol}"></div></div>
  <span class="kw-count">${d.count}×</span>
  <span class="kw-pct" style="color:${statusCol}">${d.density}%</span>
</div>`;
      })
      .join("");
    const missingChips = kw.missing
      .map((w) => `<span class="kw-missing-chip">${w}</span>`)
      .join("");
    return `
<div class="kw-match-banner">
  <div class="kw-match-score" style="color:${
    kw.matchPercentage >= 70
      ? "var(--green)"
      : kw.matchPercentage >= 40
      ? "var(--orange)"
      : "var(--red)"
  }">
    ${kw.matchPercentage}%
  </div>
  <div>
    <div style="font-size:14px;font-weight:800;">JD Keyword Match Rate</div>
    <div style="font-size:11px;color:var(--dim);margin-top:3px;">${
      kw.matched.length
    } of ${
      kw.matched.length + kw.missing.length
    } top keywords found (stem-matched)</div>
  </div>
</div>
${
  kw.missing.length
    ? `
<div class="kw-section">
  <div class="kw-section-label missing">Missing Keywords - not found in your CV</div>
  <div class="kw-chips">${missingChips}</div>
</div>`
    : ""
}
${
  densityRows
    ? `
<div class="kw-section">
  <div class="kw-section-label">Keyword Density Heatmap</div>
  <div class="kw-density-legend">
    <span style="color:var(--green)">■ Good</span>
    <span style="color:var(--red)">■ Overstuffed (&gt;3%)</span>
  </div>
  <div class="kw-density-grid">${densityRows}</div>
</div>`
    : ""
}`;
  }

  const panelMap = {
    overview: tabOverview(),
    boost: tabBoost(),
    formatting: tabFormatting(),
    issues: tabIssues(),
    keywords: tabKeywords(),
  };
  const issueCount = result.issues.length;
  const issueLabel =
    issueCount === 0 ? "All Clear" : `Warnings (${issueCount})`;
  const kwLabel = result.keywords
    ? `Keywords (${result.keywords.matchPercentage}%)`
    : "Keywords";

  const dash = document.getElementById("dashboard-section");
  dash.innerHTML = `
<div class="dash-header">
  <div class="dash-header-left">
    <button class="dash-back-btn" data-action="reset" title="Analyze another CV" aria-label="Go back">${
      Icons.back
    }</button>
    <div>
      <div class="dash-title">ATS Diagnostic Report</div>
      <div class="dash-meta">
        <strong>${result.fileName}</strong>
        <span class="dot" aria-hidden="true">•</span>
        <span class="dash-dept">${Icons.building} <strong>${
    result.department
  }</strong></span>
        <span class="dot" aria-hidden="true">•</span>
        <span class="version-badge">v${APP_VERSION}</span>
      </div>
    </div>
  </div>
  <button class="new-cv-btn" data-action="reset" aria-label="Analyze a new CV">${
    Icons.refresh
  } New Analysis</button>
</div>

<div class="dash-grid">
  <div class="dash-left">
    <div class="score-card">
      <div class="score-label">A.T.S. Analysis Index</div>
      ${buildRing(result.score)}
      <div class="score-badge ${scoreClass}">${scoreLabel}</div>
      <button class="score-explain-btn" data-action="toggle-breakdown" aria-expanded="false" aria-controls="score-breakdown">
        ${Icons.info} How is this calculated?
      </button>
      ${buildScorePanel()}
      <div class="score-divider"></div>
      <div class="score-stats">
        <div class="score-stat"><span>${
          result.wordCount
        }</span><span>Words</span></div>
        <div class="score-stat"><span>${
          result.characterCount
        }</span><span>Chars</span></div>
      </div>
    </div>
    <div class="matrix-card">
      <div class="matrix-label">Category Matrix</div>
      ${catBars}
    </div>
  </div>
  <div class="dash-right">
    <div class="tab-bar" role="tablist" aria-label="Analysis sections">
      <button class="tab-btn${
        state.activeTab === "overview" ? " active" : ""
      }" data-action="switch-tab" data-tab="overview" role="tab" aria-selected="${
    state.activeTab === "overview"
  }" tabindex="${state.activeTab === "overview" ? 0 : -1}">Overview</button>
      <button class="tab-btn highlight${
        state.activeTab === "boost" ? " active" : ""
      }" data-action="switch-tab" data-tab="boost" role="tab" aria-selected="${
    state.activeTab === "boost"
  }" tabindex="${state.activeTab === "boost" ? 0 : -1}">Playbook</button>
      <button class="tab-btn${
        state.activeTab === "formatting" ? " active" : ""
      }" data-action="switch-tab" data-tab="formatting" role="tab" aria-selected="${
    state.activeTab === "formatting"
  }" tabindex="${
    state.activeTab === "formatting" ? 0 : -1
  }">Pattern Rules</button>
      <button class="tab-btn${
        state.activeTab === "issues" ? " active" : ""
      }" data-action="switch-tab" data-tab="issues" role="tab" aria-selected="${
    state.activeTab === "issues"
  }" tabindex="${state.activeTab === "issues" ? 0 : -1}">${issueLabel}</button>
      <button class="tab-btn${
        state.activeTab === "keywords" ? " active" : ""
      }" data-action="switch-tab" data-tab="keywords" role="tab" aria-selected="${
    state.activeTab === "keywords"
  }" tabindex="${state.activeTab === "keywords" ? 0 : -1}">${kwLabel}</button>
    </div>
    <div class="tab-panel" id="tab-panel" role="tabpanel" aria-live="polite">
      ${panelMap[state.activeTab]}
    </div>
  </div>
</div>`;

  requestAnimationFrame(() => setTimeout(() => animateScore(result.score), 50));
  saveSession();
}

/* ── SAVE OUTREACH EDIT ───────────────────────────── */
function saveOutreachEdit() {
  const el = document.getElementById("outreach-text");
  if (!el) return;
  // Store innerHTML so <br> line breaks are preserved across channel switches.
  // innerText is used only when copying to clipboard (handled separately).
  state.outreachEdits[state.outreachChannel] = el.innerHTML || null;
}

/* ── EVENT DELEGATION ─────────────────────────────── */
document.addEventListener("click", function (e) {
  const t = e.target.closest("[data-action]");
  if (!t) {
    // Close breakdown panel if clicking outside
    const bp = document.getElementById("score-breakdown");
    if (bp && bp.classList.contains("open") && !bp.contains(e.target)) {
      bp.classList.remove("open");
      const btn = document.querySelector(".score-explain-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
    return;
  }
  const action = t.dataset.action;

  if (action === "reset") {
    resetDashboard();
  } else if (action === "switch-tab") {
    saveOutreachEdit();
    state.activeTab = t.dataset.tab;
    renderDashboard(state.result);
    saveSession();
  } else if (action === "set-channel") {
    saveOutreachEdit();
    state.outreachChannel = t.dataset.channel;
    renderDashboard(state.result);
    saveSession();
  } else if (action === "toggle-task") {
    const id = t.dataset.taskId;
    if (state.completedTasks.includes(id))
      state.completedTasks = state.completedTasks.filter((x) => x !== id);
    else state.completedTasks.push(id);
    if (state.activeTab === "boost") renderDashboard(state.result);
    saveSession();
  } else if (action === "copy-outreach") {
    const el = document.getElementById("outreach-text");
    const label = document.getElementById("copy-label");
    if (!el || !label) return;
    const text = el.innerText || "";
    (navigator.clipboard?.writeText(text) || Promise.reject())
      .catch(() => fallbackCopy(text))
      .then?.(() => flashLabel(label)) || flashLabel(label);
  } else if (action === "toggle-breakdown") {
    const bp = document.getElementById("score-breakdown");
    if (!bp) return;
    const open = bp.classList.toggle("open");
    t.setAttribute("aria-expanded", open);
  } else if (action === "clear-jd") {
    state.jobDescription = "";
    document.getElementById("jd-textarea").value = "";
    document.getElementById("jd-chars").textContent = "Characters: 0";
    document.getElementById("jd-clear").classList.add("hidden");
    saveSession();
  } else if (action === "report-feedback") {
    window.open(
      "mailto:tujar.developer@gmail.com?subject=JobFit%20Feedback&body=Version%3A%20" +
        APP_VERSION,
      "_blank"
    );
  }
});

// Keyboard: Enter/Space on task items
document.addEventListener("keydown", function (e) {
  if (e.key === "Enter" || e.key === " ") {
    const t = e.target.closest("[data-action='toggle-task']");
    if (t) {
      e.preventDefault();
      t.click();
    }
    const tab = e.target.closest("[data-action='switch-tab']");
    if (tab) {
      e.preventDefault();
      tab.click();
    }
  }
  // Arrow keys for tab navigation
  if (
    (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
    e.target.closest(".tab-bar")
  ) {
    e.preventDefault();
    const tabs = [
      ...document.querySelectorAll(".tab-bar [data-action='switch-tab']"),
    ];
    const idx = tabs.indexOf(e.target);
    if (idx >= 0) {
      const next =
        e.key === "ArrowRight"
          ? tabs[(idx + 1) % tabs.length]
          : tabs[(idx - 1 + tabs.length) % tabs.length];
      next?.click();
      next?.focus();
    }
  }
});

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText =
    "position:fixed;opacity:0;top:0;left:0;pointer-events:none;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
  } catch (_) {}
  document.body.removeChild(ta);
}
function flashLabel(label) {
  label.textContent = "Copied!";
  setTimeout(() => {
    label.textContent = "Copy Template";
  }, 2200);
}

/* ── VIEW MANAGEMENT ──────────────────────────────── */
function showDashboard(result) {
  state.result = result;
  state.scoreAnimated = false; // Reset so animation plays fresh
  document.getElementById("upload-section").classList.add("hidden");
  document.getElementById("hero").classList.add("hidden");
  document.getElementById("explainer-block").classList.add("hidden");
  document.getElementById("dashboard-section").classList.remove("hidden");
  renderDashboard(result);
}

function resetDashboard() {
  state.result = null;
  state.activeTab = "overview";
  state.scoreAnimated = false;
  state.outreachEdits = { linkedin: null, email: null };
  clearSession();
  document.getElementById("dashboard-section").classList.add("hidden");
  document.getElementById("dashboard-section").innerHTML = "";
  document.getElementById("upload-section").classList.remove("hidden");
  document.getElementById("hero").classList.remove("hidden");
  document.getElementById("explainer-block").classList.remove("hidden");
}

/* ── MODE TOGGLE ──────────────────────────────────── */
function setMode(mode) {
  state.inputMode = mode;
  document
    .getElementById("mode-upload")
    .classList.toggle("active", mode === "upload");
  document
    .getElementById("mode-text")
    .classList.toggle("active", mode === "text");
  document
    .getElementById("dropzone-wrap")
    .classList.toggle("hidden", mode !== "upload");
  document
    .getElementById("textarea-wrap")
    .classList.toggle("hidden", mode !== "text");
  updateAnalyzeBtn();
}

/* ── FEEDBACK HELPERS ─────────────────────────────── */
function showFeedback(type, msg) {
  const icon =
    type === "error"
      ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="15" height="15" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  document.getElementById(
    "feedback-wrap"
  ).innerHTML = `<div class="feedback-banner ${type}" role="alert">${icon}<span>${msg}</span></div>`;
}
function showProgress(msg) {
  document.getElementById(
    "feedback-wrap"
  ).innerHTML = `<div class="feedback-banner progress" role="status" aria-live="polite"><div class="progress-spinner"></div><span>${msg}</span></div>`;
}
function clearFeedback() {
  document.getElementById("feedback-wrap").innerHTML = "";
}

function updateAnalyzeBtn() {
  const btn = document.getElementById("analyze-btn");
  const has = state.cvText.trim().length > 0;
  btn.disabled = !has;
  btn.className = "cta-btn " + (has ? "ready" : "disabled");
}

/* ── FILE PROCESSING ──────────────────────────────── */
async function processFile(file) {
  clearFeedback();
  state.cvFileName = file.name;
  state.cvFileSize = file.size;
  state.cvFileType = file.name
    .slice(((file.name.lastIndexOf(".") - 1) >>> 0) + 2)
    .toLowerCase();
  const ext = state.cvFileType;

  const dzTitle = document.getElementById("dz-title");
  const dzSub = document.getElementById("dz-sub");
  const dzBadges = document.getElementById("dz-badges");
  dzTitle.textContent = file.name;
  dzSub.textContent = "Processing...";
  if (dzBadges) dzBadges.style.display = "none";
  showProgress(`Reading ${file.name}…`);

  try {
    if (ext === "txt" || ext === "rtf") {
      showProgress("Extracting text…");
      let text = await file.text();
      // Strip RTF control codes if RTF
      if (ext === "rtf") {
        text = text
          .replace(/\{\\[^{}]*\}/g, "")
          .replace(/\\[a-z]+\d* ?/g, "")
          .replace(/[{}]/g, "")
          .replace(/\r\n|\n/g, " ")
          .trim();
        if (text.length < 20)
          throw new Error(
            "Could not extract readable text from RTF. Try saving as .docx or .pdf first."
          );
      }
      state.cvText = text;
      dzSub.textContent = "File loaded. Drop another to replace.";
      showFeedback("success", `Read ${file.name} (${formatBytes(file.size)})`);
      updateAnalyzeBtn();
      saveSession();
    } else if (ext === "docx") {
      const mammoth = window.mammoth;
      if (!mammoth)
        throw new Error(
          "Mammoth.js is still loading. Wait a moment then try again."
        );
      showProgress("Parsing DOCX structure…");
      const ab = await file.arrayBuffer();
      const res = await mammoth.extractRawText({ arrayBuffer: ab });
      if (!res?.value)
        throw new Error("Could not read text from this DOCX file.");
      state.cvText = res.value;
      dzSub.textContent = "DOCX parsed. Drop another to replace.";
      showFeedback(
        "success",
        `Parsed ${file.name} - ${
          res.value.split(/\s+/).filter(Boolean).length
        } words`
      );
      updateAnalyzeBtn();
      saveSession();
    } else if (ext === "pdf") {
      const lib = window.pdfjsLib;
      if (!lib)
        throw new Error(
          "PDF.js is still loading. Wait a moment or use Direct Editor."
        );
      lib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
      const ab = await file.arrayBuffer();
      showProgress("Loading PDF pages…");
      const pdf = await lib.getDocument({ data: ab }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        showProgress(`Extracting page ${i} of ${pdf.numPages}…`);
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        text += tc.items.map((it) => it.str).join(" ") + "\n";
      }
      if (text.trim().length < 10)
        throw new Error(
          "This PDF has no selectable text. It may be image-only/scanned. Try copying text from the PDF and using the Direct Editor instead."
        );
      state.cvText = text;
      dzSub.textContent = `${pdf.numPages}-page PDF loaded. Drop another to replace.`;
      showFeedback(
        "success",
        `Parsed ${file.name} - ${pdf.numPages} pages, ${
          text.split(/\s+/).filter(Boolean).length
        } words`
      );
      updateAnalyzeBtn();
      saveSession();
    } else {
      throw new Error(
        `Unsupported format ".${ext}". Please use PDF, DOCX, RTF, or TXT.`
      );
    }
  } catch (err) {
    dzSub.textContent = "Upload failed - try another file.";
    showFeedback("error", err.message || "Error reading file.");
  }
}

/* ── EVENT LISTENERS ──────────────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  // Restore session if available
  if (loadSession() && state.result) {
    showDashboard(state.result);
    // Restore form fields
    if (state.cvText && state.inputMode === "text") {
      setMode("text");
      document.getElementById("cv-textarea").value = state.cvText;
      document.getElementById("cv-chars").textContent =
        "Characters: " + state.cvText.length;
      document.getElementById("cv-words").textContent =
        "Words: " + state.cvText.split(/\s+/).filter(Boolean).length;
    }
    if (state.jobDescription) {
      document.getElementById("jd-textarea").value = state.jobDescription;
      document.getElementById("jd-chars").textContent =
        "Characters: " + state.jobDescription.length;
      document.getElementById("jd-clear").classList.remove("hidden");
    }
    return;
  }

  // Mode toggles
  document
    .getElementById("mode-upload")
    .addEventListener("click", () => setMode("upload"));
  document
    .getElementById("mode-text")
    .addEventListener("click", () => setMode("text"));

  // File input
  document.getElementById("file-input").addEventListener("change", (e) => {
    if (e.target.files?.[0]) processFile(e.target.files[0]);
  });

  // Accept RTF too
  document
    .getElementById("file-input")
    .setAttribute("accept", ".pdf,.docx,.txt,.rtf");

  // Drag-and-drop
  const dz = document.getElementById("dropzone");
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("drag-over");
    })
  );
  dz.addEventListener("drop", (e) => {
    if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
  });

  // CV textarea
  document.getElementById("cv-textarea").addEventListener("input", (e) => {
    state.cvText = e.target.value;
    document.getElementById("cv-chars").textContent =
      "Characters: " + state.cvText.length;
    document.getElementById("cv-words").textContent =
      "Words: " + state.cvText.split(/\s+/).filter(Boolean).length;
    updateAnalyzeBtn();
    saveSession();
  });

  // JD textarea
  document.getElementById("jd-textarea").addEventListener("input", (e) => {
    state.jobDescription = e.target.value;
    document.getElementById("jd-chars").textContent =
      "Characters: " + state.jobDescription.length;
    document
      .getElementById("jd-clear")
      .classList.toggle("hidden", !state.jobDescription);
    saveSession();
  });

  // JD clear
  document.getElementById("jd-clear").addEventListener("click", () => {
    state.jobDescription = "";
    document.getElementById("jd-textarea").value = "";
    document.getElementById("jd-chars").textContent = "Characters: 0";
    document.getElementById("jd-clear").classList.add("hidden");
    saveSession();
  });

  // Analyze
  document.getElementById("analyze-btn").addEventListener("click", () => {
    if (!state.cvText.trim()) {
      showFeedback("error", "Upload a file or paste your CV text first.");
      return;
    }
    const btn = document.getElementById("analyze-btn");
    btn.innerHTML = `<div class="spinner"></div><span>Analyzing…</span>`;
    btn.className = "cta-btn disabled";
    btn.disabled = true;
    state.isLoading = true;
    setTimeout(() => {
      try {
        const result = analyzeCV(
          state.cvText,
          state.cvFileName || "Pasted_CV.txt",
          state.cvFileSize || state.cvText.length,
          state.cvFileType || "txt",
          state.jobDescription
        );
        showDashboard(result);
      } catch (err) {
        console.error(err);
        showFeedback("error", "Analysis failed. Please try again.");
      } finally {
        state.isLoading = false;
        btn.innerHTML = `${Icons.scan} Perform ATS Check`;
        updateAnalyzeBtn();
      }
    }, 800);
  });
});
