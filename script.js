"use strict";
/* -- STATE ------------------------------------------ */
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

/* -- GUARD FLAGS ------------------------------------ */
let _uploadListenersAttached = false;

/* -- SESSION PERSISTENCE ---------------------------- */
const SESSION_KEY = "jobfit_session_v2";

/**
 * Persists the current application state to sessionStorage so the user's
 * CV text, analysis results, and UI preferences (active tab, outreach edits,
 * checklist progress) survive a page reload within the same browser tab.
 *
 * `_rawText` is stripped before serialising - it duplicates `state.cvText`
 * and would otherwise double the storage cost on every call.
 *
 * Silently swallows errors so storage-quota limits or private-browsing
 * restrictions never crash the app.
 */
function saveSession() {
  try {
    // Strip _rawText (already in state.cvText) before serialising to avoid
    // writing the full CV text twice into sessionStorage on every interaction.
    const { _rawText: _dropped, ...resultWithoutRaw } = state.result || {};
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
      result: state.result ? resultWithoutRaw : null,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snap));
  } catch (_) {}
}
/**
 * Attempts to rehydrate `state` from a previously saved sessionStorage
 * snapshot (written by `saveSession`).
 *
 * @returns {boolean} `true` if a valid snapshot was found and merged into
 *   `state`; `false` if sessionStorage is empty, unparseable, or unavailable.
 */
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
/**
 * Removes the JobFit session snapshot from sessionStorage, effectively
 * resetting the app to a clean state on the next page load.
 * Called when the user clicks "New Analysis" or the back button.
 */
function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

/* -- DEBOUNCED SESSION SAVE -------------------------- */
let _saveSessionTimer = null;
/**
 * Debounced wrapper around `saveSession`.
 * Defers the actual write by 300 ms so rapid keystrokes in the CV or JD
 * textareas don't trigger a sessionStorage write on every single character.
 * Any pending timer is cancelled and restarted on each call.
 */
function saveSessionDebounced() {
  clearTimeout(_saveSessionTimer);
  _saveSessionTimer = setTimeout(saveSession, 300);
}
/**
 * Applies a lightweight subset of the Porter stemming algorithm to reduce
 * English words to approximate root forms, enabling fuzzy keyword matching.
 *
 * For example:
 *   "engineering" → "engineer"
 *   "managed"     → "manag"
 *   "organizational" → "organiz"
 *
 * Steps implemented:
 *   1a - plural/suffix removal (sses, ies, s)
 *   1b - verb ending removal (ing, ed, eed)
 *   Step 2 - common suffix substitutions (ational→ate, tional→tion, etc.)
 *   Step 3 - final suffix cleanup (icate, alize, ful, ness, al, er, ic …)
 *
 * Words of 3 characters or fewer are returned unchanged to avoid
 * over-stemming short tokens like "css" or "api".
 *
 * @param {string} word - A single lowercase token to stem.
 * @returns {string} The stemmed form, or the original lowercased word if
 *   the result would be shorter than 3 characters.
 */
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
    const root = w.slice(0, -3);
    if (root.length > 2) w = root;
  } else if (w.endsWith("ed")) {
    const root = w.slice(0, -2);
    if (root.length > 2) w = root;
  }
  // Step 2 (deduplicated)
  const step2 = [
    ["ational", "ate"],
    ["tional", "tion"],
    ["enci", "ence"],
    ["anci", "ance"],
    ["ization", "ize"],
    ["isation", "ise"],
    ["izer", "ize"],
    ["iser", "ise"],
    ["alism", "al"],
    ["aliti", "al"],
    ["ation", "ate"],
    ["ator", "ate"],
    ["ousli", "ous"],
    ["entli", "ent"],
    ["eli", "e"],
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

/* -- SHARED STOP WORDS ------------------------------ */
const STOP_WORDS = new Set([
  // JD boilerplate
  "with",
  "this",
  "that",
  "they",
  "from",
  "your",
  "their",
  "work",
  "have",
  "about",
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
  // common CV filler
  "experience",
  "education",
  "management",
  "project",
  "development",
  "software",
  "skills",
  "systems",
  "managed",
  "team",
  "company",
  "business",
]);
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

/**
 * Converts a raw byte count into a human-readable file-size string.
 *
 * @param {number} b - File size in bytes.
 * @returns {string} Formatted string, e.g. "245.3 KB" or "1.2 MB".
 *   Returns "0 B" for falsy inputs.
 */
function formatBytes(b) {
  if (!b) return "0 B";
  const k = 1024,
    s = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}

/* -- CONTEXT SCORER --------------------------------- */
/**
 * Identifies the most likely professional department/industry for a CV
 * using a TF-IDF-inspired weighted keyword scoring approach.
 *
 * Each industry in `INDUSTRIES` has a set of keywords with importance
 * weights (v). For each keyword found in the text, its contribution is:
 *   min(occurrenceCount, 3) × weight
 * Capping at 3 occurrences prevents a CV that repeats one buzzword from
 * dominating the score (keyword stuffing resistance).
 *
 * A department is only considered a valid match if at least 3 unique
 * keyword *types* from its list are present, ensuring a minimum breadth
 * of signal before making a classification.
 *
 * Confidence is calculated as the percentage gap between the top scorer
 * and second-best scorer - a tight gap means ambiguous classification.
 *
 * @param {string} text - The full raw CV text.
 * @returns {{ dept: string, confidence: number }} The detected department
 *   name and a 0–100 confidence score. Defaults to "General Career Path"
 *   when no industry reaches the minimum keyword threshold.
 */
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

/**
 * Calculates the adaptive keyword-stuffing detection threshold for a
 * given document length. Longer CVs naturally repeat words more often,
 * so a fixed threshold would unfairly penalise them.
 *
 * Formula: max(8, min(30, round(wordCount × 0.025)))
 *   - Minimum: 8 occurrences  (prevents false positives on short CVs)
 *   - Maximum: 30 occurrences (prevents the threshold from growing
 *     so large that stuffing goes undetected on very long documents)
 *
 * @param {number} wordCount - Total word count of the CV.
 * @returns {number} The maximum times a single non-stopword may appear
 *   before it is flagged as potentially stuffed.
 */
function stuffingThreshold(wordCount) {
  // Base: ~2.5% of word count, minimum 8, maximum 30
  return Math.max(8, Math.min(30, Math.round(wordCount * 0.025)));
}

/**
 * Validates whether a string is a well-formed LinkedIn profile URL.
 *
 * Accepted formats (all produce a `true` result):
 *   - linkedin.com/in/username
 *   - www.linkedin.com/in/username
 *   - https://linkedin.com/in/username
 *   - https://www.linkedin.com/in/username (with optional trailing slash)
 *
 * The username portion must be 3–100 characters using only letters,
 * digits, hyphens, and underscores - matching LinkedIn's own rules.
 *
 * @param {string} url - The URL or partial URL to validate.
 * @returns {boolean} `true` if the URL matches the standard LinkedIn
 *   profile pattern; `false` otherwise.
 */
function validateLinkedIn(url) {
  // Must be: linkedin.com/in/username (3-100 chars, no spaces, valid chars)
  const pattern =
    /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_]{3,100}\/?$/;
  return pattern.test(url.trim());
}

/**
 * Heuristically extracts the candidate's name from the top of a CV.
 *
 * Strategy: scan the first 5 non-empty lines and return the first line
 * that looks like a person's name - defined as:
 *   - 2–4 space-separated tokens (first + last, or first + middle + last)
 *   - Each token starts with a letter (supports accented characters and
 *     hyphenated/apostrophe surnames like "O'Brien" or "Muller-Schmidt")
 *   - No digits in the line (rules out phone numbers, years, etc.)
 *   - No contact-info markers (@, http, .com, colon)
 *   - Line length ≤ 50 characters (rules out job titles on the same line)
 *
 * Used to personalise the outreach templates with the candidate's real name
 * instead of the placeholder "[Your Name]".
 *
 * @param {string} text - The full raw CV text.
 * @returns {string|null} The detected name string, or `null` if no
 *   confident match is found in the opening lines.
 */
function extractCandidateName(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // First non-empty line ≤30 chars, 2–4 tokens, no digits, looks like a name
  for (const line of lines.slice(0, 5)) {
    if (line.length > 50) continue; // skip long lines
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (/\d/.test(line)) continue; // skip lines with numbers
    if (/@|http|\.com|:/.test(line)) continue; // skip contact lines
    // Each word: starts with letter, may contain apostrophe/hyphen (O'Brien, van)
    if (
      words.every((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ''\-]*$/.test(w))
    ) {
      return line;
    }
  }
  return null;
}

/**
 * Picks the top `limit` skill keywords from the analysis result to
 * personalise outreach template copy.
 *
 * Primary source: `result.keywords.matched` - the JD keywords that were
 * found in the CV, ordered by frequency (most prominent first).
 *
 * Fallback (no JD was provided): searches the detected department's
 * keyword list against the raw CV text and returns any that appear.
 *
 * @param {object} result - The analysis result object produced by `analyzeCV`.
 * @param {number} [limit=3] - Maximum number of skill terms to return.
 * @returns {string[]} An array of skill keyword strings, up to `limit` entries.
 */
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

/* -- MAIN ANALYSIS ENGINE --------------------------- */
// Broken into named sub-functions for clarity and future Web Worker migration.

/**
 * Evaluates the physical file's ATS-friendliness independent of its text
 * content. Checks three criteria and deducts from a base score of 100:
 *
 *   1. **Filename** (−20 if has spaces, special chars, or is generic like "CV.pdf")
 *      ATS databases associate documents with candidates by filename;
 *      spaces and symbols can be stripped or garbled.
 *
 *   2. **File type** (−30 for unsupported format, −10 for .txt)
 *      .pdf and .docx have the broadest ATS compatibility; .txt loses
 *      all formatting metadata.
 *
 *   3. **File size** (−10 if > 5 MB)
 *      Portals commonly reject oversized files silently; embedded images
 *      or fonts are the usual culprits.
 *
 * Side effects: appends detected issues and suggestions to the shared
 * `issues` and `suggestions` arrays, and sets boolean flags used by the
 * dynamic checklist generator.
 *
 * @param {string}   fileName       - Original filename as reported by the browser.
 * @param {number}   fileSizeInBytes - File size in bytes.
 * @param {object[]} issues         - Shared issues array to append warnings to.
 * @param {object[]} suggestions    - Shared suggestions array to append tips to.
 * @param {object}   flags          - Shared flags object; sets `badFileName` and `largeFile`.
 * @returns {{ fnScore: number, fileQualityCategories: object[] }}
 */
function scoreFileQuality(
  fileName,
  fileSizeInBytes,
  issues,
  suggestions,
  flags
) {
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
  const reasons = [];
  if (hasSpaces || hasSpecialChars || isGeneric) {
    nameStatus = "warning";
    fnScore -= 20;
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
    description:
      nameStatus === "pass"
        ? `"${escapeHtml(
            fileName
          )}" - professionally named and easy for ATS to associate with your application.`
        : `"${escapeHtml(fileName)}" - ${reasons.join(
            ", "
          )}. Rename to FirstName_LastName_CV.${
            extension || "pdf"
          } for best results.`,
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
        ? `.${extension} is one of the two formats with the broadest ATS compatibility.`
        : typeStatus === "warning"
        ? ".txt files lose all formatting metadata - headings, bold text, and layout signals are stripped."
        : `".${extension}" is not a recognised CV format. Use .pdf (preferred) or .docx.`,
    status: typeStatus,
    impact: "high",
  });
  const isTooLarge = fileSizeInBytes > 5 * 1024 * 1024;
  fileQualityCategories.push({
    id: "filesize",
    title: "File Size",
    description: isTooLarge
      ? `File is ${formatBytes(
          fileSizeInBytes
        )} - exceeds the 5 MB limit. Likely caused by embedded images or fonts. Some portals will silently reject this upload.`
      : `File is ${formatBytes(
          fileSizeInBytes
        )} - well within the acceptable range for all major ATS portals.`,
    status: isTooLarge ? "warning" : "pass",
    impact: "low",
  });
  if (isTooLarge) {
    fnScore -= 10;
    flags.largeFile = true;
  }
  return { fnScore, fileQualityCategories };
}

/**
 * Analyses the extracted text for ATS-hostile formatting patterns that
 * survive PDF/DOCX extraction as text artefacts. Checks four patterns
 * and deducts from a base score of 100:
 *
 *   1. **Multi-column layout** (−15) - detected by many lines containing
 *      multiple large whitespace gaps, which indicates side-by-side columns.
 *      ATS parsers read left-to-right linearly and will merge column text.
 *
 *   2. **Table/grid structures** (−10) - detected by pipe character density
 *      or lines with multiple large tab/space alignments. Table cells are
 *      read in unpredictable order by many parsers.
 *
 *   3. **Floating text boxes** (−10) - detected by textbox/frame keywords
 *      left behind by Word's extraction. Content inside text boxes is
 *      invisible to most ATS engines.
 *
 *   4. **Graphic/image elements** (−10) - detected by image-format keywords
 *      (svg, png, icon, etc.). Visual skill bars and icons are stripped,
 *      leaving skill sections empty in the parsed output.
 *
 * @param {string}   text       - Original (case-preserved) CV text.
 * @param {string}   lowerText  - Lowercase version for case-insensitive matching.
 * @param {object[]} issues     - Shared issues array.
 * @param {object[]} suggestions - Shared suggestions array.
 * @param {object}   flags      - Shared flags; sets `multiColumn`, `hasTables`,
 *                                `textBoxes`, `hasGraphics`.
 * @returns {{ fmtScore: number, formattingCategories: object[] }}
 */
function scoreFormatting(text, lowerText, issues, suggestions, flags) {
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
      ? `Multi-column layout detected (${columnIndicatorCount} column-aligned lines found) - ATS parsers read left-to-right linearly and will merge your columns into garbled text.`
      : "Single-column layout confirmed - optimal for ATS linear parsing.",
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
      ? `Dense grid structures detected (${
          pipeCount > 8
            ? pipeCount + " pipe characters"
            : tabularLines + " tabular lines"
        }) - ATS engines often read table cells in unpredictable order, mixing job titles with dates.`
      : "No problematic table or grid structures detected.",
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
        ? `${textObjectSignals} text frame indicators found - content inside floating text boxes is completely invisible to most ATS parsers.`
        : "No floating text box indicators found - content is in the main document flow.",
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
      ? "Skill rating bars, icons, or image elements detected - these are stripped entirely by ATS parsers, meaning your visual skill ratings contribute zero parseable content."
      : "No visual decorations or graphic elements detected - all content is text-readable.",
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
  return { fmtScore, formattingCategories };
}

/**
 * Scores how easily an ATS can parse the structure and contact data of
 * the CV. Deducts from a base score of 100 across four checks:
 *
 *   1. **Standard section headers** (−20 for missing, −10 for creative names)
 *      ATS maps employment history and qualifications by scanning for known
 *      section labels like "Experience" and "Education".
 *
 *   2. **Date format consistency** (−10 if > 2 different date styles found)
 *      Mixed formats (e.g. "Jan 2022" alongside "01/2022") confuse tenure
 *      calculation algorithms.
 *
 *   3. **Bullet point density** (−15 if ≤ 3 bullets total)
 *      ATS keyword extraction is optimised for bulleted lines; prose
 *      paragraphs reduce keyword surface area.
 *
 *   4. **Contact information** (−6 per missing field: Email, Phone, LinkedIn)
 *      Recruiters and ATS cannot route applications without contact details;
 *      a malformed LinkedIn URL incurs a smaller −5 penalty.
 *
 * @param {string}   text       - Original CV text.
 * @param {string}   lowerText  - Lowercase CV text.
 * @param {object[]} issues     - Shared issues array.
 * @param {object[]} suggestions - Shared suggestions array.
 * @param {object}   flags      - Shared flags; sets `missingHeaders`, `weakHeaders`,
 *                                `mixedDates`, `fewBullets`, `missingContact`, `badLinkedIn`.
 * @returns {{ readScore: number, readabilityCategories: object[] }}
 */
function scoreReadability(text, lowerText, issues, suggestions, flags) {
  let readScore = 100;
  const readabilityCategories = [];
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Section headers
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
    description:
      hdStatus === "pass"
        ? `Both "Experience" and "Education" headings detected - ATS can correctly map your career history.`
        : hdStatus === "warning"
        ? `Non-standard section title "${escapeHtml(
            weakHeaders[0]
          )}" detected - may not be recognised by ATS parsing engines.`
        : `Missing standard section heading${
            !hasExpHeader && !hasEduHeader ? "s" : ""
          }: ${!hasExpHeader ? '"Experience"' : ""}${
            !hasExpHeader && !hasEduHeader ? " and " : ""
          }${!hasEduHeader ? '"Education"' : ""}.`,
    status: hdStatus,
    impact: "high",
  });

  // Date consistency
  const dateFormats = [
    {
      pattern:
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{4}\b/i,
      label: "Mon YYYY",
    },
    { pattern: /\b\d{2}\/\d{4}\b/, label: "MM/YYYY" },
    { pattern: /\b\d{4}\s*[-–]\s*\d{4}\b/, label: "YYYY-YYYY" },
    { pattern: /\b(19|20)\d{2}\b/, label: "YYYY" },
  ];
  const foundFormats = dateFormats.filter((f) => f.pattern.test(lowerText));
  const mixedDates = foundFormats.length > 2;
  const noDates = foundFormats.length === 0;
  readabilityCategories.push({
    id: "dates",
    title: "Consistent Date Formatting",
    description: mixedDates
      ? `${foundFormats.length} different date styles detected (${foundFormats
          .map((f) => f.label)
          .join(", ")}) - inconsistent formatting confuses timeline parsers.`
      : noDates
      ? "No date patterns detected - ATS cannot calculate your employment tenure or verify your timeline."
      : `Consistent date format (${foundFormats[0]?.label}) used throughout.`,
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
        ? `${bulletCount} bullet points found - strong keyword extraction surface.`
        : bulletCount === 0
        ? "No bullet points detected. Entire CV is written in prose - ATS keyword extraction will be poor."
        : `Only ${bulletCount} bullet point${
            bulletCount === 1 ? "" : "s"
          } found. Dense paragraphs reduce keyword visibility.`,
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
          ? "Email, phone, and valid LinkedIn URL all detected in the header."
          : linkedinUrl
          ? "Email and phone found. LinkedIn URL present but format may be non-standard - verify it links correctly."
          : "Email and phone found. Consider adding a LinkedIn URL to improve recruiter reach."
        : `Missing contact fields: ${missingContacts.join(
            ", "
          )}. Recruiters cannot follow up without these details.`,
    status: contactStatus,
    impact: "high",
  });
  return { readScore, readabilityCategories };
}

/**
 * Evaluates the quality and substance of the CV's written content.
 * Deducts from a base score of 100 across five checks:
 *
 *   1. **Professional summary** (−10 if absent)
 *      Many ATS systems surface the opening summary as the recruiter preview.
 *
 *   2. **Quantified achievements** (−15 if no metrics found)
 *      Numbers (percentages, currency, team sizes) make accomplishments
 *      concrete and are weighted higher by ATS ranking algorithms.
 *
 *   3. **Certifications & credentials** - advisory only, no score deduction.
 *      Department-specific note shown when none are detected.
 *
 *   4. **Projects / Portfolio** - advisory only.
 *      Especially flagged for Software Development roles.
 *
 *   5. **Keyword stuffing** (−10) - uses `stuffingThreshold` to detect
 *      any non-stopword that exceeds the adaptive repetition limit for
 *      this document length. Identifies the worst offending word.
 *
 *   6. **Excessive all-caps text** (−5 if > 12 all-caps words, excluding
 *      known tech acronyms like REACT, SQL, etc.) - disrupts tokenisation.
 *
 * @param {string}   text         - Original CV text.
 * @param {string}   lowerText    - Lowercase CV text.
 * @param {number}   wordCount    - Total word count of the CV.
 * @param {string}   detectedDept - Department name from `detectDepartment`.
 * @param {object[]} issues       - Shared issues array.
 * @param {object[]} suggestions  - Shared suggestions array.
 * @param {object}   flags        - Shared flags; sets `noSummary`, `noMetrics`,
 *                                  `stuffedKeyword`.
 * @returns {{ cntScore: number, contentCategories: object[] }}
 */
function scoreContent(
  text,
  lowerText,
  wordCount,
  detectedDept,
  issues,
  suggestions,
  flags
) {
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
      ? "A dedicated summary or profile section found - good first impression for recruiters."
      : wordCount < 200
      ? `CV is very short (${wordCount} words). A professional summary would significantly improve both ATS scoring and recruiter engagement.`
      : "No summary or profile section detected. Add a 3–4 sentence opener summarising your key experience and value.",
    status: hasSummary ? "pass" : "warning",
    impact: "high",
  });
  if (!hasSummary) {
    cntScore -= 10;
    flags.noSummary = true;
  }

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
      ? `${metricsCount} quantified outcome${
          metricsCount === 1 ? "" : "s"
        } found (${
          impactPhrases > 0
            ? impactPhrases +
              " impact verb" +
              (impactPhrases !== 1 ? "s" : "") +
              " + "
            : ""
        }numbers, percentages, or team sizes).`
      : hasImpactVerbs
      ? `${impactPhrases} impact verb${
          impactPhrases === 1 ? "" : "s"
        } found but no concrete numbers - add percentages, budget figures, or team sizes.`
      : "No quantified achievements or impact verbs detected - recruiters cannot gauge your impact.",
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
    title: "Certifications & Credentials",
    description: hasCerts
      ? `Certification or credential signals found - these strengthen your profile for roles requiring verified qualifications.`
      : `No certifications detected. ${
          detectedDept && detectedDept !== "General Career Path"
            ? `For ${detectedDept} roles, relevant certifications can be a key differentiator.`
            : "For many roles, certifications can improve your ranking."
        }`,
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
      ? `Projects or portfolio section detected - this strengthens your application${
          detectedDept === "Software Development & IT"
            ? " and is particularly valuable for technical roles"
            : ""
        }.`
      : `No projects section found. ${
          detectedDept === "Software Development & IT"
            ? "For tech roles, a projects section or GitHub link is highly expected."
            : "A portfolio or case studies section can significantly differentiate you."
        }`,
    status: hasProjects ? "pass" : "warning",
    impact: "low",
  });

  // Keyword stuffing - adaptive threshold based on doc length
  const threshold = stuffingThreshold(wordCount);
  const wordFreqMap = {};
  lowerText
    .replace(/[^a-z\s]/gi, "")
    .split(/\s+/)
    .forEach((w) => {
      if (w.length > 4 && !STOP_WORDS.has(w))
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
  return { cntScore, contentCategories };
}

/**
 * Computes a JD keyword match score by stem-matching the top 25 keywords
 * from the job description against the CV text. Only runs when a
 * job description of meaningful length (> 10 characters) is provided.
 *
 * Algorithm:
 *   1. Tokenise and stem the JD; count frequency per stem (capped at 3
 *      per term to neutralise stuffed JDs).
 *   2. Take the top 25 stems by frequency as the target keyword set.
 *   3. Stem every word in the CV and count occurrences.
 *   4. For each target keyword: mark as "matched" (in CV) or "missing".
 *   5. Compute `matchPercentage = matched / total × 100`.
 *   6. Build a density heatmap: classify each matched word as "good"
 *      (≤ 3% of document) or "stuffed" (> 3%).
 *
 * Stemming means "engineer" in the CV satisfies "engineering" in the JD,
 * so matches are semantic rather than purely literal.
 *
 * @param {string}   lowerText      - Lowercase CV text.
 * @param {number}   wordCount      - CV word count (for density calculation).
 * @param {string}   jobDescription - Raw job description text.
 * @param {object[]} issues         - Shared issues array.
 * @param {object[]} suggestions    - Shared suggestions array.
 * @param {object}   flags          - Shared flags; sets `hasJD`.
 * @returns {{ keywordsResult: object|null, jdKwScore: number }}
 *   `keywordsResult` is `null` when no JD is provided; otherwise contains
 *   `matchPercentage`, `matched`, `missing`, and `density` arrays.
 *   `jdKwScore` is the numeric match percentage (0 when no JD).
 */
function scoreKeywords(
  lowerText,
  wordCount,
  jobDescription,
  issues,
  suggestions,
  flags
) {
  if (!jobDescription || jobDescription.trim().length <= 10)
    return { keywordsResult: null, jdKwScore: 0 };
  const jdClean = jobDescription.toLowerCase().replace(/[^a-z0-9#+\s]/g, " ");
  const wordFreq = {};
  const stemToOriginal = {};
  jdClean.split(/\s+/).forEach((w) => {
    if (w.length > 3 && !STOP_WORDS.has(w) && isNaN(Number(w))) {
      const s = stem(w);
      if (!stemToOriginal[s]) stemToOriginal[s] = w;
      // Cap JD term frequency at 3 to prevent inflated match scores from stuffed JDs
      wordFreq[s] = Math.min((wordFreq[s] || 0) + 1, 3);
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
    const displayWord = stemToOriginal[kw] || kw;
    const count = cvStemmed[kw] || 0;
    const pct =
      wordCount > 0 ? parseFloat(((count / wordCount) * 100).toFixed(2)) : 0;
    const status = count === 0 ? "low" : pct > 3 ? "stuffed" : "good";
    if (count > 0) {
      matched.push({ word: displayWord, count });
      density.push({ word: displayWord, count, density: pct, status });
    } else missing.push(displayWord);
  });
  const matchPct =
    topKW.length > 0 ? Math.round((matched.length / topKW.length) * 100) : 0;
  const keywordsResult = {
    matchPercentage: matchPct,
    matched,
    missing,
    density,
  };
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
  return { keywordsResult, jdKwScore: matchPct };
}

/**
 * Main CV analysis orchestrator. Runs all five sub-scorers in sequence,
 * then combines their outputs into a single weighted final score.
 *
 * Scoring pipeline:
 *   1. `detectDepartment`  - identifies industry for contextual feedback
 *   2. `scoreFileQuality`  - filename, format, file size
 *   3. `scoreFormatting`   - columns, tables, text boxes, graphics
 *   4. `scoreReadability`  - headers, dates, bullets, contact info
 *   5. `scoreContent`      - summary, metrics, stuffing, all-caps
 *   6. `scoreKeywords`     - JD keyword match (only if JD provided)
 *
 * Adaptive weight system:
 *   - With JD: keywords 35%, readability 25%, content 20%, formatting 15%,
 *              file 5%
 *   - Text/paste mode (no file): readability 40%, content 35%, formatting 20%,
 *                                 file 5%
 *   - Standard (file, no JD): readability 35%, content 30%, formatting 20%,
 *                              file 15%
 *
 * The returned result object is self-contained - it includes all category
 * arrays, the raw issues/suggestions lists, flags, score breakdown rows,
 * and the candidate name for outreach personalisation.
 *
 * @param {string} rawText        - Extracted CV text.
 * @param {string} fileName       - Original file name (used for file quality scoring).
 * @param {number} fileSizeInBytes - File size in bytes.
 * @param {string} fileType       - Lowercase file extension ("pdf", "docx", "txt", "rtf").
 * @param {string} jobDescription - Optional job description text; pass "" to skip JD scoring.
 * @returns {object} Full analysis result object stored in `state.result`.
 */
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

  // -- 1. DEPARTMENT (weighted + confidence) ----------
  const { dept: detectedDept, confidence: deptConfidence } =
    detectDepartment(text);

  // -- 2–6. SUB-SCORED SECTIONS -----------------------
  const { fnScore, fileQualityCategories } = scoreFileQuality(
    fileName,
    fileSizeInBytes,
    issues,
    suggestions,
    flags
  );
  const { fmtScore, formattingCategories } = scoreFormatting(
    text,
    lowerText,
    issues,
    suggestions,
    flags
  );
  const { readScore, readabilityCategories } = scoreReadability(
    text,
    lowerText,
    issues,
    suggestions,
    flags
  );
  const { cntScore, contentCategories } = scoreContent(
    text,
    lowerText,
    wordCount,
    detectedDept,
    issues,
    suggestions,
    flags
  );
  const { keywordsResult, jdKwScore } = scoreKeywords(
    lowerText,
    wordCount,
    jobDescription,
    issues,
    suggestions,
    flags
  );
  // -- 7. ADAPTIVE SCORE WEIGHTS ----------------------
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
    id: Math.random().toString(36).substring(2, 11),
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

/**
 * Escapes HTML special characters in a string so user-supplied content
 * (filenames, CV text snippets, keyword names) can be safely injected
 * into innerHTML without creating XSS vectors.
 *
 * Replaces: & → &amp;  < → &lt;  > → &gt;  " → &quot;  ' → &#39;
 *
 * @param {string} str - The raw string to escape.
 * @returns {string} The HTML-safe escaped string, or "" for falsy input.
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* -- SVG ICONS -------------------------------------- */
const Icons = {
  check: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
  warn: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
  fail: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
  alert: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
  back: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>`,
  refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>`,
  book: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>`,
  trophy: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg>`,
  copy: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`,
  square: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
  checksq: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 11l3 3L22 4m-4 8v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h8"/></svg>`,
  building: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>`,
  pencil: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  scan: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>`,
  info: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 16v-4m0-4h.01"/></svg>`,
  flag: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18m0-13s2-2 5-2 5 2 8 2 5-2 5-2V3s-2 2-5 2-5-2-8-2-5 2-5 2z"/></svg>`,
  print: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  star: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
};

/**
 * Returns the appropriate coloured icon wrapper HTML for a check status.
 * Used in the Pattern Rules tab to prefix each check-row.
 *
 * @param {"pass"|"warning"|"fail"} status
 * @returns {string} HTML string containing a coloured SVG icon div.
 */
function statusIcon(status) {
  if (status === "pass")
    return `<div class="check-icon-wrap pass" aria-label="Passed">${Icons.check}</div>`;
  if (status === "warning")
    return `<div class="check-icon-wrap warn" aria-label="Warning">${Icons.warn}</div>`;
  return `<div class="check-icon-wrap fail" aria-label="Critical">${Icons.fail}</div>`;
}
/**
 * Returns a coloured pill badge HTML element for a check status.
 * Displayed inline next to the check title in the Pattern Rules tab.
 *
 * @param {"pass"|"warning"|"fail"} status
 * @returns {string} HTML string for the badge span.
 */
function statusBadge(status) {
  if (status === "pass") return `<span class="status-badge pass">Passed</span>`;
  if (status === "warning")
    return `<span class="status-badge warn">Warning</span>`;
  return `<span class="status-badge fail">Critical</span>`;
}
/**
 * Counts how many items in a category-check array have a "pass" status.
 * Used to compute the pass/total fraction shown in the Category Matrix
 * bars and the Pattern Rules header.
 *
 * @param {object[]} arr - Array of category check objects with a `status` property.
 * @returns {number} Count of items whose `status` equals "pass".
 */
function passCount(arr) {
  return arr.filter((c) => c.status === "pass").length;
}

/**
 * Generates the SVG score ring HTML for the dashboard's left panel.
 *
 * The ring is a standard SVG circle with a stroke-dashoffset technique:
 *   - Full circumference = full circle
 *   - offset = circumference − (score/100 × circumference)
 * A lower offset means more of the arc is visible.
 *
 * Ring colour:
 *   - score < 50  → red
 *   - score < 75  → orange
 *   - score ≥ 75  → green
 *
 * If `state.scoreAnimated` is true (e.g. after a tab switch re-render),
 * the arc is drawn at its final position immediately - no CSS transition -
 * to avoid a flash of the empty ring on every re-render. The animation
 * itself (`animateScore`) should only run once per fresh analysis.
 *
 * @param {number} score - The final ATS score (0–100).
 * @returns {string} HTML string containing the SVG ring and score label.
 */
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
<svg width="${size}" height="${size}" style="transform:rotate(-90deg);"
  role="img" aria-label="ATS Score: ${score} out of 100">
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
<div class="ring-label-wrap" style="color:${col}" aria-hidden="true">
  <span class="ring-score-num" id="score-num">${
    state.scoreAnimated ? score : 0
  }</span>
  <span class="ring-ats-label">ATS Score</span>
</div>
</div>`;
}

/**
 * Animates the score ring arc and the numeric counter from 0 to `target`.
 *
 * Two concurrent animations are kicked off:
 *   1. **Arc** - a CSS transition on `stroke-dashoffset` is triggered by
 *      setting the property to its final value inside a rAF callback,
 *      giving the browser one paint tick to register the starting value.
 *   2. **Counter** - a `setInterval` increments the displayed number
 *      roughly every 16 ms (≈ 60 fps) in steps of `ceil(target/60)`,
 *      so the counter always reaches `target` in about 60 frames (~1 s).
 *
 * Sets `state.scoreAnimated = true` on first call so subsequent
 * re-renders (tab switches, re-runs) skip the animation.
 *
 * @param {number} target - The final score value to animate to.
 */
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

/**
 * Converts a plain-text outreach template string to safe HTML suitable
 * for injection into a `contenteditable` div.
 *
 * Transformation rules:
 *   - HTML special chars (&, <, >) are escaped to prevent XSS.
 *   - Double newlines (\n\n) → `<br><br>` (paragraph spacing).
 *   - Single newlines (\n)   → `<br>` (line breaks within a paragraph).
 *
 * The `contenteditable` div uses innerHTML, so raw newlines would be
 * collapsed by the browser; `<br>` tags are required to preserve spacing.
 *
 * @param {string} text - Plain-text outreach template.
 * @returns {string} HTML-escaped string with `<br>` line break markup.
 */
function textToOutreachHtml(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Double newline = paragraph gap (extra spacing), single = line break
  return escaped.replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>");
}

/**
 * Generates a personalised outreach message template for the given
 * department and channel using the candidate's detected name and top skills.
 *
 * Two channel variants:
 *   - **"linkedin"** - a short, casual DM (< 100 words) appropriate for
 *     LinkedIn's character limits and conversational tone.
 *   - **"email"**    - a longer cold email with a suggested subject line,
 *     professional salutation, and a phone/email/LinkedIn sign-off block.
 *
 * Placeholders `[Hiring Manager]`, `[Company]`, `[Phone]`, etc. are left
 * in the template for the user to fill in before sending.
 *
 * @param {string} dept    - Detected department name (e.g. "Software Development & IT").
 * @param {string} channel - Output channel: "linkedin" or "email".
 * @param {object} result  - The analysis result object (used for name + skills extraction).
 * @returns {string} HTML-escaped outreach template ready for `contenteditable` injection.
 */
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

/**
 * Builds the personalised CV readiness checklist for the Playbook tab.
 *
 * Each task in `ALL_TASKS` is associated with a `flag` key. Only tasks
 * whose flag was set to `true` by the analysis (or whose `alwaysShow`
 * property is true) are included in the returned list - so the checklist
 * contains only items that are actually relevant to this specific CV.
 *
 * Tasks include context-aware labels (e.g. the actual stuffed keyword,
 * the actual bad filename) for a precise, actionable experience.
 *
 * @param {object} flags  - The `flags` object from the analysis result.
 * @param {object} result - The full analysis result (used for filename, dept, etc.).
 * @returns {object[]} Filtered array of task objects, each with:
 *   `id`, `flag`, `label`, `impact`, `desc`, and optionally `alwaysShow`.
 */
function getDynamicTasks(flags, result) {
  const ext = result && result.fileType ? result.fileType : "pdf";
  const stuffed = flags.stuffedKeyword || "a keyword";
  const missingContactIssue =
    result && result.issues
      ? result.issues.find(
          (i) =>
            i.id === "missing-contact" ||
            i.title.toLowerCase().includes("contact")
        )
      : null;
  const missingContacts = missingContactIssue
    ? missingContactIssue.title
        .replace("Missing Contact Info (", "")
        .replace(")", "")
    : "contact info";

  const ALL_TASKS = [
    {
      id: "single-col",
      flag: "multiColumn",
      label:
        "Restructure to single-column layout - multi-column blocks detected",
      impact: "High - ATS Reading",
      desc: "Multi-column layouts cause text to merge horizontally during parsing, making job titles and dates unreadable.",
    },
    {
      id: "add-metrics",
      flag: "noMetrics",
      label:
        "Add quantified achievements: include %, rand values, or team sizes",
      impact: "High - Content Score",
      desc: "No measurable outcomes found. ATS and recruiters prioritise CVs with concrete impact numbers (e.g. 'Reduced costs by 25%').",
    },
    {
      id: "fix-file-name",
      flag: "badFileName",
      label: `Rename "${escapeHtml(
        result && result.fileName ? result.fileName : "your file"
      )}" → FirstName_LastName_CV.${ext}`,
      impact: "Medium - File Registry",
      desc: "Spaces and special characters are stripped or garbled by older ATS databases, breaking document association.",
    },
    {
      id: "fix-headers",
      flag: "missingHeaders",
      label: 'Add "Professional Experience" and "Education" section headings',
      impact: "High - Readability",
      desc: "ATS maps your employment history and qualifications using these exact header labels. Without them, your career history won't be parsed.",
    },
    {
      id: "weak-headers",
      flag: "weakHeaders",
      label: "Replace non-standard section names with ATS-recognised labels",
      impact: "High - Readability",
      desc: "Creative headers like 'My Journey' or 'What I've Done' are not in ATS vocabulary - use 'Work Experience', 'Skills', 'Education'.",
    },
    {
      id: "add-bullets",
      flag: "fewBullets",
      label:
        "Rewrite job descriptions as bullet points starting with action verbs",
      impact: "High - Keyword Extraction",
      desc: "Dense paragraphs reduce keyword visibility. ATS extracts role-specific keywords from bullet-point sentences, not prose.",
    },
    {
      id: "fix-contact",
      flag: "missingContact",
      label: `Add missing contact details at the top: ${missingContacts}`,
      impact: "Critical - Recruiter Access",
      desc: "Recruiters cannot advance your application without a way to reach you. Missing contact info is the most common automatic disqualifier.",
    },
    {
      id: "fix-linkedin",
      flag: "badLinkedIn",
      label: "Fix LinkedIn URL to exact format: linkedin.com/in/yourname",
      impact: "Medium - Contact Quality",
      desc: "Malformed LinkedIn URLs prevent recruiters from verifying your profile and may trigger invalid-URL flags in some ATS systems.",
    },
    {
      id: "add-summary",
      flag: "noSummary",
      label: "Write a 3–4 sentence professional summary at the top",
      impact: "Medium - First Impression",
      desc: "Many ATS systems extract the opening summary as the candidate profile shown to recruiters before they read the full CV.",
    },
    {
      id: "fix-dates",
      flag: "mixedDates",
      label: "Standardise all employment dates to one format (e.g. MM/YYYY)",
      impact: "Medium - Timeline Parsing",
      desc: "Mixed formats like 'Jan 2022' and '01/2022' confuse tenure calculation algorithms and can produce incorrect experience duration.",
    },
    {
      id: "reduce-stuffing",
      flag: "stuffedKeyword",
      label: `Reduce overuse of "${escapeHtml(stuffed)}" - substitute synonyms`,
      impact: "Medium - Quality Score",
      desc: `"${escapeHtml(
        stuffed
      )}" exceeds the adaptive density threshold for a CV of this length. High repetition can trigger spam filters in ATS engines.`,
    },
    {
      id: "remove-tables",
      flag: "hasTables",
      label: "Replace table/grid structures with plain bullet-point sections",
      impact: "High - Parser Compatibility",
      desc: "Grid cells are often read out of order or skipped entirely by ATS engines - your skills and dates may end up on the wrong rows.",
    },
    {
      id: "remove-graphics",
      flag: "hasGraphics",
      label:
        'Replace graphic skill bars with text descriptors ("Advanced", "Intermediate")',
      impact: "Medium - Content Loss",
      desc: "Visual rating elements (stars, bars, dots) are images to the parser - every ATS strips them, leaving skill sections empty.",
    },
    {
      id: "large-file",
      flag: "largeFile",
      label:
        "Reduce file size below 5 MB - some portals silently reject larger files",
      impact: "Low - Upload Compatibility",
      desc: "File size exceeds 5 MB. Embedded images or fonts are the usual cause - remove them and save as a plain PDF.",
    },
    {
      id: "linkedin-profile",
      flag: null,
      label: "Verify your LinkedIn timeline matches this CV exactly",
      impact: "Essential - Consistency",
      desc: "Discrepant job titles, dates, or employer names between your CV and LinkedIn profile trigger integrity flags in background-check systems.",
      alwaysShow: true,
    },
  ];

  return ALL_TASKS.filter((t) => t.alwaysShow || (t.flag && flags[t.flag]));
}

/**
 * The main dashboard renderer. Builds the full dashboard HTML from the
 * analysis result and injects it into `#dashboard-section`.
 *
 * Structure rendered:
 *   - Header bar (title, filename, department, Re-run / New Analysis buttons)
 *   - Left panel: score ring, score breakdown panel, category matrix bars
 *   - Right panel: tab bar + active tab content
 *
 * Contains five inner tab-builder functions (called lazily - only the
 * active tab's function runs on each render):
 *   - `tabOverview()`   - department banner, top suggestions, privacy note
 *   - `tabBoost()`      - dynamic checklist + personalised outreach templates
 *   - `tabFormatting()` - pattern rules / ATS check grid
 *   - `tabIssues()`     - detected warnings and fix instructions
 *   - `tabKeywords()`   - JD keyword match rate, missing chips, density heatmap
 *
 * Also contains `buildScorePanel()` which renders the collapsible score
 * breakdown panel explaining how the weighted final score was calculated.
 *
 * After injecting HTML, schedules `animateScore` via rAF + setTimeout(50)
 * to ensure the DOM is painted before the animation starts.
 *
 * @param {object} result - The full analysis result object from `analyzeCV`.
 */
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

  // -- Score breakdown panel --------------------------
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

  // -- Tab: Overview ----------------------------------
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
        : `<div class="empty-state">No major structural issues found. Your CV scored ${
            result.score
          }/100 - ${
            result.score >= 85
              ? "excellent ATS compatibility."
              : "consider minor refinements to push it higher."
          }</div>`;

    const deptNote = result.deptConfidence
      ? `<span class="dept-confidence">${result.deptConfidence}% confidence</span>`
      : "";

    return `
<div class="dept-banner">
  ${Icons.building}
  <span>Detected as <strong>${escapeHtml(
    result.department
  )}</strong> ${deptNote}</span>
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

  // -- Tab: Boost / Playbook --------------------------
  function tabBoost() {
    const dynamicTasks = getDynamicTasks(result.flags || {}, result);
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

    const remainingTasks = total - done;
    const playbookDesc =
      done === total
        ? `All ${total} action items completed - your CV is structurally optimised for ATS scanning.`
        : `${remainingTasks} action item${
            remainingTasks !== 1 ? "s" : ""
          } remaining, personalised to what your analysis actually flagged for <strong>${escapeHtml(
            result.fileName
          )}</strong>.`;
    return `
<div class="playbook-hero">
  <div class="playbook-title">${Icons.trophy} Hiring Playbook</div>
  <div class="playbook-desc">${playbookDesc}</div>
</div>
<div class="checklist-card">
  <div class="checklist-title">CV Readiness Checklist - ${escapeHtml(
    result.department
  )}
    <span class="task-progress-badge">${done}/${total} complete</span>
  </div>
  <div class="checklist-subtitle">${
    done === total
      ? "All items resolved - well done."
      : `${done} auto-passed based on your scan results. Complete the remaining ${
          total - done
        } item${total - done !== 1 ? "s" : ""} to maximise ATS compatibility.`
  }</div>
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
  <div class="outreach-text" id="outreach-text" contenteditable="true" spellcheck="true" aria-label="Outreach template - click to edit" aria-multiline="true">${activeText}</div>
  <button class="copy-btn" data-action="copy-outreach" aria-label="Copy template to clipboard">
    ${Icons.copy} <span id="copy-label">Copy Template</span>
  </button>
</div>`;
  }

  // -- Tab: Pattern Rules -----------------------------
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
    const totalChecks =
      result.readability.length +
      result.formatting.length +
      result.content.length +
      result.fileQuality.length;
    const passedChecks =
      result.readability.filter((c) => c.status === "pass").length +
      result.formatting.filter((c) => c.status === "pass").length +
      result.content.filter((c) => c.status === "pass").length +
      result.fileQuality.filter((c) => c.status === "pass").length;
    return `
<h4 class="panel-heading">ATS Pattern Checklists <span style="font-size:11px;font-weight:400;color:var(--dim);margin-left:8px;">${passedChecks}/${totalChecks} checks passed</span></h4>
<div class="pattern-grid">
  ${section(result.readability, "Readability")}
  ${section(result.formatting, "Formatting")}
  ${section(result.content, "Content Quality")}
  ${section(result.fileQuality, "File Quality")}
</div>`;
  }

  // -- Tab: Warnings ----------------------------------
  function tabIssues() {
    const n = result.issues.length;
    const cards =
      n > 0
        ? result.issues
            .map(
              (i) => `
<div class="issue-card ${escapeHtml(i.severity)}" role="listitem">
  ${i.severity === "error" ? Icons.fail : Icons.alert}
  <div>
    <div class="issue-title">${escapeHtml(i.title)}</div>
    <div class="issue-desc">${escapeHtml(i.description)}</div>
    <div class="issue-fix"><strong>Fix:</strong> ${escapeHtml(
      i.fixMessage
    )}</div>
  </div>
</div>`
            )
            .join("")
        : `<div class="no-issues" role="status">${Icons.check}<strong>Zero Critical Issues</strong><p>Your CV passes all structural ATS heuristics cleanly.</p></div>`;
    const errorCount = result.issues.filter(
      (i) => i.severity === "error"
    ).length;
    const warnCount = result.issues.filter(
      (i) => i.severity === "warning"
    ).length;
    const introText =
      n === 0
        ? "All structural checks passed - no ATS compatibility issues detected."
        : `${
            errorCount > 0
              ? errorCount + " critical issue" + (errorCount !== 1 ? "s" : "")
              : "No critical issues"
          }${errorCount > 0 && warnCount > 0 ? " and " : ""}${
            warnCount > 0
              ? warnCount + " warning" + (warnCount !== 1 ? "s" : "")
              : ""
          } found. Fixing critical items first will have the most impact on your ATS pass rate.`;
    return `
<div class="issues-intro">
  <h4 class="panel-heading" style="margin-bottom:6px;">Detected ATS Warnings</h4>
  <p style="font-size:12px;color:var(--dim);margin-bottom:16px;line-height:1.5;">${introText}</p>
</div>
<div role="list">${cards}</div>`;
  }

  // -- Tab: Keywords ----------------------------------
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

  const panelBuilders = {
    overview: tabOverview,
    boost: tabBoost,
    formatting: tabFormatting,
    issues: tabIssues,
    keywords: tabKeywords,
  };
  const issueCount = result.issues.length;
  const issueLabel =
    issueCount === 0 ? "All Clear ✓" : `Warnings (${issueCount})`;
  const hasKw = !!result.keywords;
  const kwLabel = hasKw
    ? `Keywords (${result.keywords.matchPercentage}%)`
    : null; // null = hide tab

  // If keywords tab was active but JD was removed, fall back to overview
  const activeTab =
    !hasKw && state.activeTab === "keywords" ? "overview" : state.activeTab;
  if (activeTab !== state.activeTab) state.activeTab = activeTab;

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
        <strong>${escapeHtml(result.fileName)}</strong>
        <span class="dot" aria-hidden="true">•</span>
        <span class="dash-dept">${Icons.building} <strong>${escapeHtml(
    result.department
  )}</strong></span>
      </div>
    </div>
  </div>
  <div class="dash-header-actions">
    <button class="rerun-btn" data-action="rerun" title="Re-analyse with current CV and JD" aria-label="Re-run analysis">${
      Icons.scan
    } Re-run</button>
    <button class="new-cv-btn" data-action="reset" aria-label="Analyze a new CV">${
      Icons.refresh
    } New Analysis</button>
  </div>
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
      ${
        kwLabel
          ? `<button class="tab-btn${
              state.activeTab === "keywords" ? " active" : ""
            }" data-action="switch-tab" data-tab="keywords" role="tab" aria-selected="${
              state.activeTab === "keywords"
            }" tabindex="${
              state.activeTab === "keywords" ? 0 : -1
            }">${kwLabel}</button>`
          : ""
      }
    </div>
    <div class="tab-panel" id="tab-panel" role="tabpanel" aria-live="off" tabindex="-1">
      ${(panelBuilders[state.activeTab] || panelBuilders.overview)()}
    </div>
  </div>
</div>`;

  requestAnimationFrame(() => setTimeout(() => animateScore(result.score), 50));
  saveSession();
}

/**
 * Reads the current content of the `contenteditable` outreach template
 * div and persists it into `state.outreachEdits[channel]`.
 *
 * Uses `innerHTML` (not `innerText`) so that `<br>` line breaks are
 * preserved when the user switches between LinkedIn and email channels.
 * Plain `innerText` is used separately when copying to the clipboard.
 *
 * Called before every tab switch and channel switch to ensure the user's
 * edits are not lost when the dashboard re-renders.
 */
function saveOutreachEdit() {
  const el = document.getElementById("outreach-text");
  if (!el) return;
  // Store innerHTML so <br> line breaks are preserved across channel switches.
  // innerText is used only when copying to clipboard (handled separately).
  state.outreachEdits[state.outreachChannel] = el.innerHTML || null;
}

/**
 * Central event delegation handler attached to `document`.
 *
 * Instead of attaching individual listeners to every button (many of which
 * are created dynamically by `renderDashboard`), this single listener
 * captures all clicks via event bubbling and routes them by the
 * `data-action` attribute of the closest ancestor element.
 *
 * Actions handled:
 *   - "reset"            → `resetDashboard()` - show upload view
 *   - "rerun"            → re-run `analyzeCV` with current state data
 *   - "switch-tab"       → change active tab, re-render, move focus for a11y
 *   - "set-channel"      → switch outreach template (linkedin / email)
 *   - "toggle-task"      → check/uncheck a checklist item, persist to state
 *   - "copy-outreach"    → copy template text to clipboard
 *   - "toggle-breakdown" → expand/collapse the score breakdown panel
 *   - "clear-jd"         → clear the job description field
 *   - "report-feedback"  → open feedback email in mail client
 *
 * Also closes the score breakdown panel when clicking anywhere outside it.
 */
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
  } else if (action === "rerun") {
    if (!state.cvText.trim()) return;
    state.scoreAnimated = false;
    const result = analyzeCV(
      state.cvText,
      state.cvFileName || "Pasted_CV.txt",
      state.cvFileSize || state.cvText.length,
      state.cvFileType || "txt",
      state.jobDescription
    );
    showDashboard(result);
  } else if (action === "switch-tab") {
    saveOutreachEdit();
    state.activeTab = t.dataset.tab;
    renderDashboard(state.result);
    saveSession();
    // Move focus into the new panel so screen readers announce the heading
    requestAnimationFrame(() => {
      const panel = document.getElementById("tab-panel");
      if (panel) {
        const heading = panel.querySelector(
          "h4, h3, h2, [class*='panel-heading']"
        );
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: true });
        } else {
          panel.focus({ preventScroll: true });
        }
      }
    });
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
    const writePromise = navigator.clipboard?.writeText(text);
    if (writePromise) {
      writePromise
        .catch(() => fallbackCopy(text))
        .finally(() => flashLabel(label));
    } else {
      fallbackCopy(text);
      flashLabel(label);
    }
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
      "mailto:tujar.developer@gmail.com?subject=JobFit%20Feedback",
      "_blank"
    );
  }
});

/**
 * Keyboard accessibility handler for interactive components.
 *
 * - **Enter / Space** on task items (`[data-action="toggle-task"]`):
 *   Triggers a click so keyboard users can check/uncheck checklist items
 *   without a mouse. Default behaviour (page scroll on Space) is suppressed.
 *
 * - **Enter / Space** on tab buttons (`[data-action="switch-tab"]`):
 *   Ensures tab buttons are keyboard-activatable consistent with ARIA
 *   tab role expectations.
 *
 * - **ArrowLeft / ArrowRight** within the tab bar:
 *   Implements the ARIA Tabs pattern - arrow keys cycle focus between tabs
 *   and activate them, making the tab bar fully operable without a mouse.
 */
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

/**
 * Clipboard copy fallback for browsers where `navigator.clipboard.writeText`
 * is unavailable (e.g. non-HTTPS contexts or older browsers).
 *
 * Creates an off-screen textarea, sets its value, selects all its text,
 * and executes the legacy `document.execCommand('copy')` command.
 * The textarea is removed from the DOM immediately after.
 *
 * @param {string} text - The plain text to copy to the clipboard.
 */
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
/**
 * Provides transient visual copy confirmation by temporarily replacing
 * the copy button label with "Copied!" then restoring the original text
 * after 2.2 seconds.
 *
 * @param {HTMLElement} label - The `<span>` element inside the copy button
 *   whose text content is changed.
 */
function flashLabel(label) {
  label.textContent = "Copied!";
  setTimeout(() => {
    label.textContent = "Copy Template";
  }, 2200);
}

/**
 * Switches the view from the upload screen to the analysis dashboard.
 *
 * Stores the result in `state.result`, resets the score animation flag
 * so the ring animates fresh on this new result, then hides the hero/
 * upload/explainer sections and reveals `#dashboard-section` before
 * calling `renderDashboard` to build its content.
 *
 * @param {object} result - The analysis result object from `analyzeCV`.
 */
function showDashboard(result) {
  state.result = result;
  state.scoreAnimated = false; // Reset so animation plays fresh
  document.getElementById("upload-section").classList.add("hidden");
  document.getElementById("hero").classList.add("hidden");
  document.getElementById("explainer-block").classList.add("hidden");
  document.getElementById("dashboard-section").classList.remove("hidden");
  renderDashboard(result);
}

/**
 * Resets the entire application back to the initial upload state.
 *
 * Clears analysis result, active tab, score animation flag, and any
 * outreach edits from `state`, removes the session snapshot from
 * sessionStorage, empties `#dashboard-section` innerHTML, then shows
 * the hero/upload/explainer sections again.
 *
 * Also calls `attachUploadListeners()` to ensure the upload form is
 * interactive - it may have been skipped by `DOMContentLoaded` when
 * the app restored from a session and jumped straight to the dashboard.
 */
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
  // Re-attach listeners that DOMContentLoaded may have skipped on session restore
  attachUploadListeners();
}

/**
 * Switches the CV input method between "File Drop" and "Direct Editor" modes.
 *
 * Updates `state.inputMode`, toggles the `active` class and `aria-checked`
 * attribute on the mode toggle buttons, and shows/hides the dropzone or
 * textarea wrapper accordingly. Also re-evaluates the analyze button state
 * since switching modes may change whether there is usable CV text.
 *
 * @param {"upload"|"text"} mode - The target input mode to activate.
 */
function setMode(mode) {
  state.inputMode = mode;
  const uploadBtn = document.getElementById("mode-upload");
  const textBtn = document.getElementById("mode-text");
  uploadBtn.classList.toggle("active", mode === "upload");
  textBtn.classList.toggle("active", mode === "text");
  uploadBtn.setAttribute("aria-checked", String(mode === "upload"));
  textBtn.setAttribute("aria-checked", String(mode === "text"));
  document
    .getElementById("dropzone-wrap")
    .classList.toggle("hidden", mode !== "upload");
  document
    .getElementById("textarea-wrap")
    .classList.toggle("hidden", mode !== "text");
  updateAnalyzeBtn();
}

/**
 * Renders a styled feedback banner inside `#feedback-wrap`.
 *
 * @param {"success"|"error"} type - Controls the banner colour and icon.
 * @param {string} msg - The message text to display inside the banner.
 */
function showFeedback(type, msg) {
  const icon =
    type === "error"
      ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="15" height="15" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  document.getElementById(
    "feedback-wrap"
  ).innerHTML = `<div class="feedback-banner ${type}" role="alert">${icon}<span>${escapeHtml(msg)}</span></div>`;
}
/**
 * Replaces the feedback area with an animated progress spinner and
 * a status message. Used during file reading to show which parsing
 * step is in progress (e.g. "Extracting page 2 of 5…").
 *
 * Uses `aria-live="polite"` so screen readers announce progress updates.
 *
 * @param {string} msg - The progress step message to display.
 */
function showProgress(msg) {
  document.getElementById(
    "feedback-wrap"
  ).innerHTML = `<div class="feedback-banner progress" role="status" aria-live="polite"><div class="progress-spinner"></div><span>${escapeHtml(msg)}</span></div>`;
}
/**
 * Clears any visible feedback or progress banner from `#feedback-wrap`.
 * Called at the start of a new file processing operation to remove stale messages.
 */
function clearFeedback() {
  document.getElementById("feedback-wrap").innerHTML = "";
}

/**
 * Enables or disables the "Perform ATS Check" button based on whether
 * `state.cvText` contains any non-whitespace content.
 *
 * Also toggles the CSS class between "ready" (green, clickable) and
 * "disabled" (muted, not clickable) so styling stays in sync with the
 * button's disabled state.
 *
 * Called whenever CV text changes - on file upload, textarea input, or
 * after a mode switch.
 */
function updateAnalyzeBtn() {
  const btn = document.getElementById("analyze-btn");
  const has = state.cvText.trim().length > 0;
  btn.disabled = !has;
  btn.className = "cta-btn " + (has ? "ready" : "disabled");
}

/**
 * Handles file ingestion for all supported CV formats. Reads the file
 * entirely in the browser - no server upload occurs.
 *
 * Format-specific extraction strategies:
 *
 *   - **TXT** - `file.text()` reads UTF-8 plain text directly.
 *
 *   - **RTF** - `file.text()` reads raw RTF markup, then regex-based
 *     stripping removes control words (`\par`, `\pard`, `\word`),
 *     curly braces, and excess whitespace. Warns the user that RTF
 *     extraction is approximate and PDF/DOCX is preferred.
 *
 *   - **DOCX** - Delegates to Mammoth.js (`mammoth.extractRawText`),
 *     which converts the OOXML document to plain text in-browser.
 *
 *   - **PDF** - Delegates to PDF.js (`pdfjsLib.getDocument`).
 *     Each page's text items are sorted by Y-position (top→bottom) then
 *     X-position (left→right) before joining, restoring natural reading
 *     order that PDF.js sometimes returns out of sequence.
 *     Throws a user-friendly error for image-only/scanned PDFs with < 10
 *     characters of selectable text.
 *
 * Progress banners are shown during long operations (multi-page PDFs).
 * On success, `state.cvText` is updated and the analyze button enabled.
 * On failure, an error banner is shown and the dropzone is reset.
 *
 * @param {File} file - The File object from the input change or drop event.
 */
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
      // Strip RTF control codes if RTF - preserve line breaks for section detection
      if (ext === "rtf") {
        // Replace RTF paragraph marks (\par, \pard) with newlines before stripping
        text = text
          .replace(/\\par[d ]?/gi, "\n")
          .replace(/\{\\[^{}]*\}/g, "")
          .replace(/\\[a-z]+\d* ?/g, "")
          .replace(/[{}]/g, "")
          .replace(/\r\n/g, "\n")
          .replace(/[ \t]+/g, " ")
          .trim();
        if (text.length < 20)
          throw new Error(
            "Could not extract readable text from RTF. Try saving as .docx or .pdf first."
          );
        showFeedback(
          "success",
          `Read ${file.name} (${formatBytes(
            file.size
          )}) - RTF extraction is approximate; PDF or DOCX gives more accurate scores.`
        );
      }
      state.cvText = text;
      dzSub.textContent = "File loaded. Drop another to replace.";
      if (ext !== "rtf") {
        showFeedback(
          "success",
          `Read ${file.name} (${formatBytes(file.size)})`
        );
      }
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
      lib.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.js", document.baseURI).href;
      const ab = await file.arrayBuffer();
      showProgress("Loading PDF pages…");
      const pdf = await lib.getDocument({ data: ab }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        showProgress(`Extracting page ${i} of ${pdf.numPages}…`);
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        // Sort items by Y-position descending (top→bottom), then X ascending (left→right)
        // tc.items[].transform is a 6-element matrix; [4]=x, [5]=y
        const sorted = [...tc.items].sort((a, b) => {
          const dy = b.transform[5] - a.transform[5];
          if (Math.abs(dy) > 2) return dy; // different lines
          return a.transform[4] - b.transform[4]; // same line: left→right
        });
        text += sorted.map((it) => it.str).join(" ") + "\n";
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

/**
 * Attaches all event listeners for the upload section UI. Uses a guard flag
 * (`_uploadListenersAttached`) to ensure listeners are only attached once -
 * the function may be called from both `DOMContentLoaded` and `resetDashboard`,
 * and double-attaching would cause every event to fire twice.
 *
 * Listeners registered:
 *   - Mode toggle buttons ("File Drop" / "Direct Editor") → `setMode()`
 *   - File input `change` → `processFile()` on selected file
 *   - Dropzone `dragenter` / `dragover` → adds `.drag-over` highlight class
 *   - Dropzone `dragleave` / `drop` → removes `.drag-over` highlight class
 *   - Dropzone `drop` → `processFile()` on dropped file
 *   - Document `dragend` → clears stuck `.drag-over` if cursor leaves window
 *   - CV textarea `input` → syncs `state.cvText`, updates char/word counters,
 *     calls `updateAnalyzeBtn`, debounce-saves session
 *   - JD textarea `input` → syncs `state.jobDescription`, updates char counter,
 *     shows/hides the JD clear button, debounce-saves session
 *   - JD clear button `click` → clears JD state, field, and counter
 *   - Analyze button `click` → shows spinner, runs `analyzeCV` via setTimeout(0)
 *     so the browser can paint the spinner before the synchronous analysis
 *     blocks the main thread, then calls `showDashboard` with the result.
 *     Also pings the anonymous Cloudflare counter worker once per page session.
 */
function attachUploadListeners() {
  if (_uploadListenersAttached) return;
  _uploadListenersAttached = true;

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
  // Clear stuck drag-over if cursor leaves browser window
  document.addEventListener("dragend", () => dz.classList.remove("drag-over"));

  // CV textarea
  document.getElementById("cv-textarea").addEventListener("input", (e) => {
    state.cvText = e.target.value;
    document.getElementById("cv-chars").textContent =
      "Characters: " + state.cvText.length;
    document.getElementById("cv-words").textContent =
      "Words: " + state.cvText.split(/\s+/).filter(Boolean).length;
    updateAnalyzeBtn();
    saveSessionDebounced();
  });

  // JD textarea
  document.getElementById("jd-textarea").addEventListener("input", (e) => {
    state.jobDescription = e.target.value;
    document.getElementById("jd-chars").textContent =
      "Characters: " + state.jobDescription.length;
    document
      .getElementById("jd-clear")
      .classList.toggle("hidden", !state.jobDescription);
    saveSessionDebounced();
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
    // Use setTimeout(0) to allow the spinner to paint before the sync analysis runs
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
        // Ping counter once per page session (persisted in sessionStorage)
        if (!sessionStorage.getItem("jobfit_pinged")) {
          sessionStorage.setItem("jobfit_pinged", "1");
          fetch("https://jobfit-counter.tumelo-segale.workers.dev/ping", {
            method: "POST",
          })
            .then(() =>
              fetch("https://jobfit-counter.tumelo-segale.workers.dev/")
            )
            .then((r) => r.json())
            .then((data) => {
              const el = document.getElementById("cv-counter-value");
              if (el && data.count != null)
                el.textContent = Number(data.count).toLocaleString();
            })
            .catch(() => {});
        }
      } catch (err) {
        console.error(err);
        showFeedback("error", "Analysis failed. Please try again.");
      } finally {
        state.isLoading = false;
        btn.innerHTML = `${Icons.scan} Perform ATS Check`;
        updateAnalyzeBtn();
      }
    }, 0);
  });
}

/**
 * Application bootstrap - runs once when the DOM is fully parsed.
 *
 * Two paths:
 *
 *   1. **Session restore** - if `loadSession()` finds a saved snapshot in
 *      sessionStorage and it contains a completed analysis result, the
 *      dashboard is shown immediately (the user is returned to where they
 *      left off before the reload). Form fields are also restored:
 *        - Textarea mode: CV text and counters are re-populated.
 *        - JD field: text and character count are restored; clear button shown.
 *        - Dropzone: filename label is restored to reflect the uploaded file.
 *      Upload listeners are still attached so "New Analysis" works correctly.
 *
 *   2. **Fresh start** - no session (or session has no result): attach upload
 *      listeners and present the default upload view to the user.
 */
document.addEventListener("DOMContentLoaded", function () {
  // Restore session if available
  if (loadSession() && state.result) {
    showDashboard(state.result);
    // Restore form fields (upload section is hidden but keep state consistent)
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
    // Restore dropzone display to reflect the previously uploaded file
    if (state.cvFileName && state.inputMode === "upload") {
      const dzTitle = document.getElementById("dz-title");
      const dzSub = document.getElementById("dz-sub");
      const dzBadges = document.getElementById("dz-badges");
      if (dzTitle) dzTitle.textContent = state.cvFileName;
      if (dzSub) dzSub.textContent = "File loaded. Drop another to replace.";
      if (dzBadges) dzBadges.style.display = "none";
    }
    // Still attach upload listeners so "New Analysis" returns to a working form
    attachUploadListeners();
    return;
  }

  attachUploadListeners();
});