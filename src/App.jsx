import React, { useState, useEffect, useCallback, useRef } from "react";

/* ============================================================================
   CLASSIC CV BUILDER
   A classic, elegant, professional CV & cover letter builder.
   Design tokens:
     paper   #FAF9F5   ink    #1C2430   navy   #1F2E45
     charcoal#3A3F44   hair   #DCD6C6   gold   #96772E
     steel   #4C6482   muted  #74716A   surface#FFFFFF
   Display type: Georgia/serif (classic, trustworthy)
   Body type: system sans (Inter stack)
   ========================================================================= */

const LIGHT_THEME = {
  paper: "#FBF7EE",
  ink: "#16332C",
  navy: "#0E4B3F",
  navyDeep: "#082A22",
  charcoal: "#2E4A42",
  hair: "#E3D5B6",
  hair2: "#F1E7D2",
  gold: "#C1852E",
  goldSoft: "#DDA857",
  steel: "#8A5A2E",
  muted: "#77705F",
  surface: "#FFFFFF",
  danger: "#9C3B2A",
};

const DARK_THEME = {
  paper: "#0E1F1A",
  ink: "#F1EAD9",
  navy: "#2FA382",
  navyDeep: "#0A2A20",
  charcoal: "#C9D6CF",
  hair: "#2C4A41",
  hair2: "#1F3A32",
  gold: "#D69A46",
  goldSoft: "#E7BD7B",
  steel: "#C08A52",
  muted: "#93A69D",
  surface: "#16302A",
  danger: "#D9584A",
};

// T is intentionally mutable (not reassigned, just its properties updated) —
// every component reads T.xxx at render time via closure, so mutating it in
// place and re-rendering the tree is enough to re-theme the whole app
// without threading a theme prop/context through every component.
let T = { ...LIGHT_THEME };
function applyThemeMode(mode) {
  Object.assign(T, mode === "dark" ? DARK_THEME : LIGHT_THEME);
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", T.navy);
  } catch (e) { /* non-browser context */ }
}

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();

const TEMPLATES = [
  { id: "classic", name: "Classic", blurb: "Traditional single-column layout with a centered header." },
  { id: "executive", name: "Executive", blurb: "Dark sidebar for contact & skills; built for leadership roles." },
  { id: "academic", name: "Academic", blurb: "Dense, numbered sections for researchers & lecturers." },
  { id: "graduate", name: "Graduate", blurb: "Leads with education, skills & projects for early careers." },
  { id: "minimal", name: "Minimal", blurb: "Quiet, understated, all business — no color, no noise." },
];

const COVER_STYLES = ["Classic", "Professional", "Executive", "Modern", "Entry-Level", "Academic"];

const emptyPersonal = () => ({
  fullName: "",
  title: "",
  phone: "",
  email: "",
  location: "",
  linkedin: "",
  website: "",
});

const ADDITIONAL_META = {
  projects: { label: "Projects", a: "Project name", b: "Role / Tech", c: "Description" },
  awards: { label: "Awards", a: "Award name", b: "Issuer", c: "Description" },
  publications: { label: "Publications", a: "Title", b: "Venue / Year", c: "Description" },
  languages: { label: "Languages", a: "Language", b: "Proficiency", c: "" },
  volunteer: { label: "Volunteer Experience", a: "Role", b: "Organization", c: "Description" },
  memberships: { label: "Professional Memberships", a: "Organization", b: "Role / Since", c: "" },
  references: { label: "References", a: "Name", b: "Contact", c: "Relationship" },
  interests: { label: "Interests", a: "Interest", b: "", c: "" },
};

const newCV = () => ({
  id: uid(),
  kind: "cv",
  name: "Untitled CV",
  templateId: "classic",
  accent: T.gold,
  personal: emptyPersonal(),
  summary: "",
  experience: [],
  education: [],
  skills: [],
  certifications: [],
  additional: Object.fromEntries(Object.keys(ADDITIONAL_META).map((k) => [k, { enabled: false, items: [] }])),
  createdAt: now(),
  lastEdited: now(),
});

const newCoverLetter = () => ({
  id: uid(),
  kind: "letter",
  name: "Untitled Cover Letter",
  style: "Professional",
  fullName: "",
  jobTitle: "",
  company: "",
  hiringManager: "",
  jobDescription: "",
  experience: "",
  skills: "",
  education: "",
  additionalInfo: "",
  content: "",
  createdAt: now(),
  lastEdited: now(),
});

/* ---------------------------------- Local storage --------------------------------- */
// Standalone deploy: persistence is plain browser localStorage (per-device,
// per-browser). Signing in switches documents over to the backend instead —
// see BACKEND CLIENT below.

async function loadData() {
  try {
    const raw = window.localStorage.getItem("app-data");
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* nothing saved yet */
  }
  return { cvs: [], letters: [], onboarded: false };
}
async function saveData(data) {
  try {
    window.localStorage.setItem("app-data", JSON.stringify(data));
  } catch (e) {
    console.error("storage failed", e);
  }
}

/* ============================================================================
   BACKEND CLIENT
   Talks to the FastAPI service (auth, documents, AI proxy, billing).
   Guests can create and edit documents locally (localStorage) without an
   account, but AI features require signing in — the app has no Anthropic
   key of its own, by design, so there's no client-side AI fallback here.
   ========================================================================= */

async function getStoredValue(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
async function setStoredValue(key, value) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch (e) {
    /* best-effort */
  }
}

function normalizeBase(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function apiFetch(apiBase, token, path, opts = {}) {
  const base = normalizeBase(apiBase);
  if (!base) throw new ApiError("No backend server URL is set.", 0);
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiError("Couldn't reach the server. Check the server URL and try again.", 0);
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    throw new ApiError(typeof detail === "string" ? detail : JSON.stringify(detail), res.status);
  }
  return data;
}

// Maps a backend DocumentOut {id, kind, name, data, created_at, updated_at}
// back into the flat shape the rest of the app already works with.
function mapServerDoc(res) {
  return {
    ...res.data,
    id: res.id,
    _serverId: res.id,
    kind: res.kind,
    name: res.name,
    lastEdited: new Date(res.updated_at).getTime(),
  };
}

async function serverUpsertDocument(apiBase, token, doc) {
  const body = { kind: doc.kind, name: doc.name, data: doc };
  const res = doc._serverId
    ? await apiFetch(apiBase, token, `/documents/${doc._serverId}`, { method: "PUT", body })
    : await apiFetch(apiBase, token, "/documents", { method: "POST", body });
  return mapServerDoc(res);
}

async function serverDeleteDocument(apiBase, token, doc) {
  if (!doc._serverId) return;
  await apiFetch(apiBase, token, `/documents/${doc._serverId}`, { method: "DELETE" });
}

async function serverListDocuments(apiBase, token) {
  const res = await apiFetch(apiBase, token, "/documents");
  return (res || []).map(mapServerDoc);
}

// Routes every AI action through the backend. Requires sign-in — there is
// intentionally no direct-from-browser Anthropic fallback in this build,
// since that would mean shipping an API key to every visitor.
async function runAI(session, kind, payload) {
  const endpoints = {
    improveSummary: "/ai/improve-summary",
    improveExperience: "/ai/improve-experience",
    reviewCv: "/ai/review-cv",
    generateCoverLetter: "/ai/generate-cover-letter",
    transformLetter: "/ai/transform-letter",
  };
  if (!session?.isAuthed) {
    throw new ApiError("Sign in to use AI-assisted writing features.", 401);
  }
  const res = await apiFetch(session.apiBase, session.token, endpoints[kind], { method: "POST", body: payload });
  return res.text;
}

const SessionContext = React.createContext({ isAuthed: false, apiBase: "", token: null, user: null });
const useSession = () => React.useContext(SessionContext);

/* ============================================================================
   SMALL UI PRIMITIVES
   ========================================================================= */

function Icon({ name, size = 18, color = T.ink, style }) {
  const s = { width: size, height: size, display: "block", ...style };
  const stroke = color;
  switch (name) {
    case "home":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M5.5 10v9a1 1 0 0 0 1 1H9v-6h6v6h2.5a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "plus-circle":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" strokeLinecap="round" /></svg>;
    case "folder":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" strokeLinejoin="round" /></svg>;
    case "user":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><circle cx="12" cy="8" r="3.3" /><path d="M5 20c1-3.6 4-5.5 7-5.5s6 1.9 7 5.5" strokeLinecap="round" /></svg>;
    case "chevron-left":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.8"><path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "chevron-right":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.8"><path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "edit":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 15v5Z" strokeLinejoin="round" /></svg>;
    case "copy":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><rect x="9" y="9" width="11" height="11" rx="1.5" /><path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5" /></svg>;
    case "trash":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.7 12a1.5 1.5 0 0 0 1.5 1.4h6.6a1.5 1.5 0 0 0 1.5-1.4L18 7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "download":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><path d="M12 4v11m0 0-4-4m4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 18.5h14" strokeLinecap="round" /></svg>;
    case "share":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><circle cx="18" cy="6" r="2.3" /><circle cx="6" cy="12" r="2.3" /><circle cx="18" cy="18" r="2.3" /><path d="M8 10.8 16 7M8 13.2l8 3.8" strokeLinecap="round" /></svg>;
    case "sparkle":
      return <svg viewBox="0 0 24 24" style={s} fill={stroke} stroke="none"><path d="M12 3c.5 3.6 1.9 5 5.5 5.5-3.6.5-5 1.9-5.5 5.5-.5-3.6-1.9-5-5.5-5.5C10.1 8 11.5 6.6 12 3Z" /><path d="M19 14c.25 1.8.95 2.5 2.75 2.75C19.95 17 19.25 17.7 19 19.5c-.25-1.8-.95-2.5-2.75-2.75C18.05 16.5 18.75 15.8 19 14Z" /></svg>;
    case "check":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="2"><path d="M4.5 12.5 9 17l10.5-11" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "x":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.8"><path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" /></svg>;
    case "grip":
      return <svg viewBox="0 0 24 24" style={s} fill={stroke} stroke="none"><circle cx="9" cy="6" r="1.3" /><circle cx="15" cy="6" r="1.3" /><circle cx="9" cy="12" r="1.3" /><circle cx="15" cy="12" r="1.3" /><circle cx="9" cy="18" r="1.3" /><circle cx="15" cy="18" r="1.3" /></svg>;
    case "search":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.5-4.5" strokeLinecap="round" /></svg>;
    case "lock":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><rect x="5" y="10.5" width="14" height="9.5" rx="1.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" strokeLinecap="round" /></svg>;
    case "bell":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><path d="M6 10a6 6 0 0 1 12 0c0 4.5 1.5 5.5 1.5 5.5h-15S6 14.5 6 10Z" strokeLinejoin="round" /><path d="M10 18.5a2 2 0 0 0 4 0" strokeLinecap="round" /></svg>;
    case "moon":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" strokeLinejoin="round" /></svg>;
    case "globe":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.3 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.3-3.8-8.5S9.5 5.8 12 3.5Z" /></svg>;
    case "crown":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round"><path d="M4 17.5h16M4.5 17.5 3 8l4.7 3L12 6l4.3 5 4.7-3-1.5 9.5" /></svg>;
    case "help":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.3a2.4 2.4 0 1 1 3.4 2.2c-.9.5-1 .9-1 1.9" strokeLinecap="round" /><circle cx="12" cy="16.6" r="0.4" fill={stroke} /></svg>;
    case "info":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" strokeLinecap="round" /><circle cx="12" cy="8" r="0.4" fill={stroke} /></svg>;
    case "logout":
      return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={stroke} strokeWidth="1.6"><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H9" strokeLinecap="round" /><path d="M14.5 16 19 12l-4.5-4M19 12H9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    default:
      return null;
  }
}

function TopBar({ title, onBack, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: `1px solid ${T.hair}`, background: T.paper, position: "sticky", top: 0, zIndex: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 36 }}>
        {onBack && (
          <button onClick={onBack} style={iconBtnStyle}>
            <Icon name="chevron-left" color={T.ink} />
          </button>
        )}
      </div>
      <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 17, letterSpacing: 0.2, color: T.ink, fontWeight: 600, textAlign: "center", flex: 1 }}>{title}</div>
      <div style={{ minWidth: 36, display: "flex", justifyContent: "flex-end" }}>{right}</div>
    </div>
  );
}

const iconBtnStyle = {
  width: 34, height: 34, borderRadius: 999, border: `1px solid ${T.hair}`, background: T.surface,
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

function Button({ children, onClick, variant = "primary", size = "md", disabled, style, full }) {
  const base = {
    fontFamily: "inherit", fontWeight: 600, borderRadius: 10, cursor: disabled ? "default" : "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, border: "none",
    transition: "opacity .15s, transform .1s", opacity: disabled ? 0.5 : 1, width: full ? "100%" : "auto",
    letterSpacing: 0.2,
  };
  const sizes = { sm: { padding: "8px 14px", fontSize: 13 }, md: { padding: "12px 18px", fontSize: 14.5 }, lg: { padding: "15px 22px", fontSize: 15.5 } };
  const variants = {
    primary: { background: T.navy, color: "#fff" },
    gold: { background: T.gold, color: "#fff" },
    outline: { background: "transparent", color: T.navy, border: `1.4px solid ${T.navy}` },
    subtle: { background: T.hair2, color: T.ink },
    ghost: { background: "transparent", color: T.steel },
    danger: { background: "transparent", color: T.danger, border: `1.4px solid ${T.danger}55` },
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: T.charcoal, marginBottom: 6, letterSpacing: 0.2 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputBase = {
  width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 9,
  border: `1.3px solid ${T.hair}`, background: T.surface, fontSize: 14.5, color: T.ink,
  fontFamily: "inherit", outline: "none",
};

function Input(props) {
  return <input {...props} style={{ ...inputBase, ...(props.style || {}) }} />;
}
function TextArea(props) {
  return <textarea {...props} style={{ ...inputBase, resize: "vertical", minHeight: 90, lineHeight: 1.5, ...(props.style || {}) }} />;
}

function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{ width: 42, height: 24, borderRadius: 999, background: checked ? T.navy : T.hair, position: "relative", cursor: "pointer", transition: "background .15s", flexShrink: 0 }}
    >
      <div style={{ width: 18, height: 18, borderRadius: 999, background: "#fff", position: "absolute", top: 3, left: checked ? 21 : 3, transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.25)" }} />
    </div>
  );
}

function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{ background: T.surface, border: `1px solid ${T.hair}`, borderRadius: 14, ...style }}>
      {children}
    </div>
  );
}

function EmptyState({ icon, title, text, action }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px", color: T.muted }}>
      <div style={{ width: 52, height: 52, borderRadius: 999, background: T.hair2, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
        <Icon name={icon} color={T.steel} size={22} />
      </div>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 16.5, color: T.ink, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 18 }}>{text}</div>
      {action}
    </div>
  );
}

function ConfirmDialog({ open, title, text, onCancel, onConfirm, confirmLabel = "Delete" }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,20,20,.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, width: "100%", maxWidth: 480, borderRadius: "18px 18px 0 0", padding: "22px 20px 26px" }}>
        <div style={{ width: 36, height: 4, background: T.hair, borderRadius: 999, margin: "0 auto 18px" }} />
        <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: T.ink, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: T.muted, lineHeight: 1.5, marginBottom: 20 }}>{text}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="subtle" onClick={onCancel} style={{ flex: 1 }}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} style={{ flex: 1, background: T.danger, color: "#fff", border: "none" }}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

function Toast({ text }) {
  if (!text) return null;
  return (
    <div style={{ position: "fixed", bottom: 92, left: "50%", transform: "translateX(-50%)", background: T.ink, color: "#fff", padding: "10px 18px", borderRadius: 999, fontSize: 13, zIndex: 200, boxShadow: "0 6px 20px rgba(0,0,0,.25)" }}>
      {text}
    </div>
  );
}

function Stepper({ steps, current }) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "12px 18px 4px", overflowX: "auto" }}>
      {steps.map((s, i) => (
        <div key={s} style={{ flex: 1, minWidth: 20 }}>
          <div style={{ height: 3, borderRadius: 999, background: i <= current ? T.gold : T.hair, transition: "background .2s" }} />
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   CV TEMPLATE RENDERERS (each renders full-size; wrap in scale() for thumbs)
   ========================================================================= */

function initials(name) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "CV";
}

function sectionsFor(cv) {
  const out = [];
  if (cv.experience.length) out.push("experience");
  if (cv.education.length) out.push("education");
  if (cv.skills.length) out.push("skills");
  if (cv.certifications.length) out.push("certifications");
  Object.keys(ADDITIONAL_META).forEach((k) => {
    if (cv.additional[k]?.enabled && cv.additional[k]?.items?.length) out.push(k);
  });
  return out;
}

// Drives the completion checklist/progress bar shown in the CV wizard.
function cvCompleteness(cv) {
  const checklist = [
    { key: "personal", label: "Personal Information", done: !!(cv.personal.fullName && cv.personal.email) },
    { key: "summary", label: "Professional Summary", done: !!cv.summary.trim() },
    { key: "experience", label: "Work Experience", done: cv.experience.length > 0 },
    { key: "education", label: "Education", done: cv.education.length > 0 },
    { key: "skills", label: "Skills", done: cv.skills.length > 0 },
    { key: "certifications", label: "Certifications", done: cv.certifications.length > 0 },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  return { checklist, percent: Math.round((doneCount / checklist.length) * 100) };
}

function CompletionBar({ cv }) {
  const [expanded, setExpanded] = useState(false);
  const { checklist, percent } = cvCompleteness(cv);
  return (
    <div style={{ marginBottom: 18 }}>
      <button onClick={() => setExpanded((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.charcoal }}>Your CV is {percent}% complete</span>
          <Icon name="chevron-right" size={13} color={T.muted} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
        </div>
        <div style={{ height: 6, borderRadius: 999, background: T.hair2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${percent}%`, background: percent === 100 ? T.gold : T.steel, transition: "width .3s" }} />
        </div>
      </button>
      {expanded && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
          {checklist.map((c) => (
            <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: c.done ? T.ink : T.muted }}>
              <div style={{ width: 15, height: 15, borderRadius: 999, border: `1.4px solid ${c.done ? T.gold : T.hair}`, background: c.done ? T.gold : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {c.done && <Icon name="check" size={9} color="#fff" />}
              </div>
              {c.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SaveIndicator({ status }) {
  if (status === "idle") return <div style={{ height: 16 }} />;
  return (
    <div style={{ fontSize: 11.5, color: status === "saving" ? T.muted : T.gold, display: "flex", alignItems: "center", gap: 5, height: 16, marginBottom: 2 }}>
      {status === "saving" ? "Saving…" : (<><Icon name="check" size={11} color={T.gold} /> Saved just now</>)}
    </div>
  );
}

function fmtRange(a, b, cur) {
  if (!a && !b) return "";
  return `${a || ""} — ${cur ? "Present" : b || ""}`;
}

const pageBase = { width: 794, minHeight: 1123, background: "#fff", boxSizing: "border-box", fontFamily: "Georgia, 'Times New Roman', serif", color: "#22262b" };

function BlockHeading({ text, accent, style }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: accent, borderBottom: `1.4px solid ${accent}55`, paddingBottom: 6, marginBottom: 10, fontFamily: "Georgia, serif", ...style }}>
      {text}
    </div>
  );
}

function GenericAdditional({ cv, keys, accent }) {
  return keys.map((k) => {
    const meta = ADDITIONAL_META[k];
    const sec = cv.additional[k];
    if (!sec?.enabled || !sec.items.length) return null;
    return (
      <div key={k} style={{ marginBottom: 18 }}>
        <BlockHeading text={meta.label} accent={accent} />
        {sec.items.map((it, i) => (
          <div key={i} style={{ marginBottom: 8, fontSize: 12.5, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700 }}>
              {it.a}
              {it.b ? <span style={{ fontWeight: 400, color: "#555" }}> — {it.b}</span> : null}
            </div>
            {it.c && <div style={{ color: "#444" }}>{it.c}</div>}
          </div>
        ))}
      </div>
    );
  });
}

function TemplateClassic({ cv }) {
  const p = cv.personal;
  const accent = cv.accent;
  const extraKeys = Object.keys(ADDITIONAL_META).filter((k) => !["projects"].includes(k) || true);
  return (
    <div style={{ ...pageBase, padding: "52px 58px" }}>
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 0.5 }}>{p.fullName || "Your Name"}</div>
        {p.title && <div style={{ fontSize: 14, color: accent, marginTop: 4, fontStyle: "italic" }}>{p.title}</div>}
        <div style={{ fontSize: 11.5, color: "#555", marginTop: 8, fontFamily: "Arial, sans-serif" }}>
          {[p.email, p.phone, p.location, p.linkedin, p.website].filter(Boolean).join("   |   ")}
        </div>
      </div>
      <div style={{ height: 1.4, background: accent, marginBottom: 20 }} />
      {cv.summary && (
        <div style={{ marginBottom: 18 }}>
          <BlockHeading text="Professional Summary" accent={accent} />
          <div style={{ fontSize: 12.8, lineHeight: 1.6 }}>{cv.summary}</div>
        </div>
      )}
      {!!cv.experience.length && (
        <div style={{ marginBottom: 18 }}>
          <BlockHeading text="Experience" accent={accent} />
          {cv.experience.map((e) => (
            <div key={e.id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 700 }}>
                <span>{e.jobTitle}{e.company ? ` · ${e.company}` : ""}</span>
                <span style={{ fontWeight: 400, fontSize: 11.5, color: "#555", fontFamily: "Arial, sans-serif" }}>{fmtRange(e.startDate, e.endDate, e.current)}</span>
              </div>
              {e.location && <div style={{ fontSize: 11.5, color: "#666", fontStyle: "italic" }}>{e.location}</div>}
              {e.description && <div style={{ fontSize: 12.4, marginTop: 3, lineHeight: 1.55, whiteSpace: "pre-line" }}>{e.description}</div>}
            </div>
          ))}
        </div>
      )}
      {!!cv.education.length && (
        <div style={{ marginBottom: 18 }}>
          <BlockHeading text="Education" accent={accent} />
          {cv.education.map((e) => (
            <div key={e.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                <span>{e.degree}{e.field ? `, ${e.field}` : ""}</span>
                <span style={{ fontWeight: 400, fontSize: 11.5, color: "#555", fontFamily: "Arial, sans-serif" }}>{fmtRange(e.startDate, e.gradDate, false)}</span>
              </div>
              <div style={{ fontSize: 12, color: "#555" }}>{e.institution}{e.gpa ? ` · GPA ${e.gpa}` : ""}</div>
            </div>
          ))}
        </div>
      )}
      {!!cv.skills.length && (
        <div style={{ marginBottom: 18 }}>
          <BlockHeading text="Skills" accent={accent} />
          <div style={{ fontSize: 12.5 }}>{cv.skills.map((s) => s.name).join("   ·   ")}</div>
        </div>
      )}
      {!!cv.certifications.length && (
        <div style={{ marginBottom: 18 }}>
          <BlockHeading text="Certifications" accent={accent} />
          {cv.certifications.map((c) => (
            <div key={c.id} style={{ fontSize: 12.5, marginBottom: 4 }}>
              <b>{c.name}</b>{c.org ? ` — ${c.org}` : ""}{c.date ? `, ${c.date}` : ""}
            </div>
          ))}
        </div>
      )}
      <GenericAdditional cv={cv} keys={Object.keys(ADDITIONAL_META)} accent={accent} />
    </div>
  );
}

function TemplateExecutive({ cv }) {
  const p = cv.personal;
  const accent = cv.accent;
  return (
    <div style={{ ...pageBase, display: "flex" }}>
      <div style={{ width: 260, background: T.navyDeep, color: "#EDEFF3", padding: "44px 26px", flexShrink: 0 }}>
        <div style={{ width: 64, height: 64, borderRadius: 999, background: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
          {initials(p.fullName)}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25 }}>{p.fullName || "Your Name"}</div>
        <div style={{ fontSize: 12, color: accent, marginTop: 4, marginBottom: 20 }}>{p.title}</div>
        <div style={{ fontSize: 10.8, lineHeight: 2, color: "#C7CCD6", fontFamily: "Arial, sans-serif", wordBreak: "break-word" }}>
          {p.email && <div>{p.email}</div>}
          {p.phone && <div>{p.phone}</div>}
          {p.location && <div>{p.location}</div>}
          {p.linkedin && <div>{p.linkedin}</div>}
          {p.website && <div>{p.website}</div>}
        </div>
        {!!cv.skills.length && (
          <div style={{ marginTop: 26 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", color: accent, marginBottom: 10 }}>Core Skills</div>
            {cv.skills.map((s) => (
              <div key={s.id} style={{ fontSize: 11, marginBottom: 6, color: "#DADEE5" }}>{s.name}</div>
            ))}
          </div>
        )}
        {!!cv.education.length && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", color: accent, marginBottom: 10 }}>Education</div>
            {cv.education.map((e) => (
              <div key={e.id} style={{ fontSize: 10.8, marginBottom: 10, color: "#DADEE5", lineHeight: 1.4 }}>
                <div style={{ fontWeight: 700, color: "#fff" }}>{e.degree}</div>
                <div>{e.institution}</div>
                <div style={{ color: "#9AA1AE" }}>{fmtRange(e.startDate, e.gradDate, false)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ flex: 1, padding: "44px 34px" }}>
        {cv.summary && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: T.navy, marginBottom: 8 }}>Executive Summary</div>
            <div style={{ fontSize: 12.8, lineHeight: 1.65 }}>{cv.summary}</div>
          </div>
        )}
        {!!cv.experience.length && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: T.navy, marginBottom: 10 }}>Career Achievements</div>
            {cv.experience.map((e) => (
              <div key={e.id} style={{ marginBottom: 14, paddingLeft: 14, borderLeft: `2.5px solid ${accent}` }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{e.jobTitle}</div>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 3 }}>{e.company}{e.location ? ` · ${e.location}` : ""} &nbsp;—&nbsp; {fmtRange(e.startDate, e.endDate, e.current)}</div>
                {e.description && <div style={{ fontSize: 12.4, lineHeight: 1.55, whiteSpace: "pre-line" }}>{e.description}</div>}
              </div>
            ))}
          </div>
        )}
        {!!cv.certifications.length && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: T.navy, marginBottom: 8 }}>Certifications</div>
            {cv.certifications.map((c) => (
              <div key={c.id} style={{ fontSize: 12.5, marginBottom: 4 }}><b>{c.name}</b>{c.org ? ` — ${c.org}` : ""}</div>
            ))}
          </div>
        )}
        <GenericAdditional cv={cv} keys={Object.keys(ADDITIONAL_META).filter((k) => k !== "languages")} accent={T.navy} />
      </div>
    </div>
  );
}

function TemplateAcademic({ cv }) {
  const p = cv.personal;
  const accent = cv.accent;
  let n = 0;
  const order = ["education", "publications", "experience", "certifications", "skills", "awards", "memberships", "projects", "languages", "volunteer", "references", "interests"];
  return (
    <div style={{ ...pageBase, padding: "48px 54px", fontSize: 12 }}>
      <div style={{ borderBottom: `2px solid ${T.ink}`, paddingBottom: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>{p.fullName || "Your Name"}</div>
        <div style={{ fontSize: 12.5, color: "#444", marginTop: 3 }}>{p.title}</div>
        <div style={{ fontSize: 10.8, color: "#555", marginTop: 6, fontFamily: "Arial, sans-serif" }}>{[p.email, p.phone, p.location, p.linkedin].filter(Boolean).join("  ·  ")}</div>
      </div>
      {cv.summary && <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 18, fontStyle: "italic", color: "#333" }}>{cv.summary}</div>}
      {order.map((key) => {
        if (key === "education" && cv.education.length) {
          n++;
          return (
            <div key={key} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{n}. Education</div>
              {cv.education.map((e) => (
                <div key={e.id} style={{ marginBottom: 8, paddingLeft: 14 }}>
                  <div style={{ fontWeight: 700 }}>{e.degree}, {e.field}</div>
                  <div style={{ color: "#555" }}>{e.institution} — {fmtRange(e.startDate, e.gradDate, false)}{e.gpa ? `, GPA ${e.gpa}` : ""}</div>
                  {e.description && <div style={{ color: "#444" }}>{e.description}</div>}
                </div>
              ))}
            </div>
          );
        }
        if (key === "experience" && cv.experience.length) {
          n++;
          return (
            <div key={key} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{n}. Appointments &amp; Experience</div>
              {cv.experience.map((e) => (
                <div key={e.id} style={{ marginBottom: 8, paddingLeft: 14 }}>
                  <div style={{ fontWeight: 700 }}>{e.jobTitle}, {e.company}</div>
                  <div style={{ color: "#555" }}>{e.location} — {fmtRange(e.startDate, e.endDate, e.current)}</div>
                  {e.description && <div style={{ color: "#444", whiteSpace: "pre-line" }}>{e.description}</div>}
                </div>
              ))}
            </div>
          );
        }
        if (key === "skills" && cv.skills.length) {
          n++;
          return (
            <div key={key} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{n}. Skills</div>
              <div style={{ paddingLeft: 14 }}>{cv.skills.map((s) => s.name).join(", ")}</div>
            </div>
          );
        }
        if (key === "certifications" && cv.certifications.length) {
          n++;
          return (
            <div key={key} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{n}. Certifications</div>
              {cv.certifications.map((c) => <div key={c.id} style={{ paddingLeft: 14 }}>{c.name} — {c.org}, {c.date}</div>)}
            </div>
          );
        }
        const meta = ADDITIONAL_META[key];
        const sec = cv.additional[key];
        if (meta && sec?.enabled && sec.items.length) {
          n++;
          return (
            <div key={key} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{n}. {meta.label}</div>
              {sec.items.map((it, i) => (
                <div key={i} style={{ paddingLeft: 14, marginBottom: 5 }}>
                  <b>{it.a}</b>{it.b ? `, ${it.b}` : ""}{it.c ? ` — ${it.c}` : ""}
                </div>
              ))}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function TemplateGraduate({ cv }) {
  const p = cv.personal;
  const accent = cv.accent;
  return (
    <div style={{ ...pageBase, padding: "48px 52px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <div style={{ width: 58, height: 58, borderRadius: 12, background: `${accent}22`, color: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, flexShrink: 0 }}>{initials(p.fullName)}</div>
        <div>
          <div style={{ fontSize: 25, fontWeight: 700 }}>{p.fullName || "Your Name"}</div>
          <div style={{ fontSize: 13, color: accent }}>{p.title}</div>
          <div style={{ fontSize: 10.6, color: "#555", marginTop: 3, fontFamily: "Arial, sans-serif" }}>{[p.email, p.phone, p.location].filter(Boolean).join("  ·  ")}</div>
        </div>
      </div>
      {cv.summary && <div style={{ fontSize: 12.6, lineHeight: 1.6, marginBottom: 20, background: "#FAF7EF", padding: "12px 14px", borderRadius: 10, borderLeft: `3px solid ${accent}` }}>{cv.summary}</div>}
      {!!cv.education.length && (
        <div style={{ marginBottom: 18 }}>
          <BlockHeading text="Education" accent={accent} />
          {cv.education.map((e) => (
            <div key={e.id} style={{ marginBottom: 9 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{e.degree}{e.field ? `, ${e.field}` : ""}</div>
              <div style={{ fontSize: 11.6, color: "#555" }}>{e.institution} · {fmtRange(e.startDate, e.gradDate, false)}{e.gpa ? ` · GPA ${e.gpa}` : ""}</div>
            </div>
          ))}
        </div>
      )}
      {!!cv.skills.length && (
        <div style={{ marginBottom: 18 }}>
          <BlockHeading text="Skills" accent={accent} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {cv.skills.map((s) => (
              <span key={s.id} style={{ fontSize: 11, background: `${accent}18`, color: accent, padding: "4px 10px", borderRadius: 999, fontWeight: 600 }}>{s.name}</span>
            ))}
          </div>
        </div>
      )}
      {cv.additional.projects?.enabled && !!cv.additional.projects.items.length && (
        <div style={{ marginBottom: 18 }}>
          <BlockHeading text="Projects" accent={accent} />
          {cv.additional.projects.items.map((it, i) => (
            <div key={i} style={{ marginBottom: 8, fontSize: 12.3 }}><b>{it.a}</b>{it.b ? ` — ${it.b}` : ""}{it.c ? <div style={{ color: "#444" }}>{it.c}</div> : null}</div>
          ))}
        </div>
      )}
      {!!cv.certifications.length && (
        <div style={{ marginBottom: 18 }}>
          <BlockHeading text="Certifications" accent={accent} />
          {cv.certifications.map((c) => <div key={c.id} style={{ fontSize: 12.2, marginBottom: 3 }}>{c.name} — {c.org}</div>)}
        </div>
      )}
      {!!cv.experience.length && (
        <div style={{ marginBottom: 18 }}>
          <BlockHeading text="Experience &amp; Internships" accent={accent} />
          {cv.experience.map((e) => (
            <div key={e.id} style={{ marginBottom: 9 }}>
              <div style={{ fontWeight: 700, fontSize: 12.6 }}>{e.jobTitle} · {e.company}</div>
              <div style={{ fontSize: 11.3, color: "#555" }}>{fmtRange(e.startDate, e.endDate, e.current)}</div>
              {e.description && <div style={{ fontSize: 12, whiteSpace: "pre-line" }}>{e.description}</div>}
            </div>
          ))}
        </div>
      )}
      <GenericAdditional cv={cv} keys={Object.keys(ADDITIONAL_META).filter((k) => k !== "projects")} accent={accent} />
    </div>
  );
}

function TemplateMinimal({ cv }) {
  const p = cv.personal;
  return (
    <div style={{ ...pageBase, padding: "56px 60px", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div style={{ marginBottom: 26 }}>
        <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: 1 }}>{p.fullName || "Your Name"}</div>
        <div style={{ fontSize: 12.5, color: "#666", marginTop: 4 }}>{p.title}</div>
        <div style={{ fontSize: 10.6, color: "#888", marginTop: 8 }}>{[p.email, p.phone, p.location, p.linkedin, p.website].filter(Boolean).join("   ")}</div>
      </div>
      {cv.summary && <div style={{ fontSize: 12.4, lineHeight: 1.65, marginBottom: 22, color: "#333" }}>{cv.summary}</div>}
      {!!cv.experience.length && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#999", marginBottom: 12 }}>Experience</div>
          {cv.experience.map((e) => (
            <div key={e.id} style={{ marginBottom: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{e.jobTitle}</span>
                <span style={{ color: "#999", fontSize: 11 }}>{fmtRange(e.startDate, e.endDate, e.current)}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "#777" }}>{e.company}{e.location ? `, ${e.location}` : ""}</div>
              {e.description && <div style={{ fontSize: 12, marginTop: 4, color: "#333", whiteSpace: "pre-line" }}>{e.description}</div>}
            </div>
          ))}
        </div>
      )}
      {!!cv.education.length && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#999", marginBottom: 12 }}>Education</div>
          {cv.education.map((e) => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12.5 }}>
              <span>{e.degree}{e.field ? `, ${e.field}` : ""} — {e.institution}</span>
              <span style={{ color: "#999", fontSize: 11 }}>{fmtRange(e.startDate, e.gradDate, false)}</span>
            </div>
          ))}
        </div>
      )}
      {!!cv.skills.length && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#999", marginBottom: 12 }}>Skills</div>
          <div style={{ fontSize: 12.4, color: "#333" }}>{cv.skills.map((s) => s.name).join("  ·  ")}</div>
        </div>
      )}
      {!!cv.certifications.length && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#999", marginBottom: 12 }}>Certifications</div>
          {cv.certifications.map((c) => <div key={c.id} style={{ fontSize: 12.3, marginBottom: 4 }}>{c.name} — {c.org}</div>)}
        </div>
      )}
      <GenericAdditional cv={cv} keys={Object.keys(ADDITIONAL_META)} accent="#999" />
    </div>
  );
}

const TEMPLATE_RENDER = {
  classic: TemplateClassic,
  executive: TemplateExecutive,
  academic: TemplateAcademic,
  graduate: TemplateGraduate,
  minimal: TemplateMinimal,
};

function CVRenderer({ cv }) {
  const Comp = TEMPLATE_RENDER[cv.templateId] || TemplateClassic;
  return <Comp cv={cv} />;
}

function CVThumb({ cv, width = 160 }) {
  const scale = width / 794;
  const height = 1123 * scale;
  return (
    <div style={{ width, height, overflow: "hidden", borderRadius: 8, border: `1px solid ${T.hair}`, background: "#fff", position: "relative", flexShrink: 0 }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: 794, height: 1123, pointerEvents: "none" }}>
        <CVRenderer cv={cv} />
      </div>
    </div>
  );
}

/* ============================================================================
   ONBOARDING
   ========================================================================= */

function Onboarding({ onDone }) {
  const [i, setI] = useState(0);
  const screens = [
    { h: "Build a Better CV", t: "Create a professional CV in minutes." },
    { h: "Choose Your Style", t: "Select from professionally designed templates." },
    { h: "Write Better", t: "Use AI assistance to improve your CV and create personalized cover letters." },
    { h: "Apply With Confidence", t: "Export your documents and start applying." },
  ];
  const s = screens[i];
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: T.navy, color: "#fff" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
        <div style={{ width: 84, height: 84, borderRadius: 20, background: "rgba(255,255,255,.08)", border: `1px solid ${T.goldSoft}55`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 28 }}>
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke={T.goldSoft} strokeWidth="1.4"><rect x="5" y="3" width="14" height="18" rx="1.4" /><path d="M8 8h8M8 11.5h8M8 15h5" strokeLinecap="round" /></svg>
        </div>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 25, marginBottom: 12, letterSpacing: 0.3 }}>{s.h}</div>
        <div style={{ fontSize: 14.5, color: "#C6CBD6", lineHeight: 1.6, maxWidth: 280 }}>{s.t}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 7, marginBottom: 26 }}>
        {screens.map((_, idx) => (
          <div key={idx} style={{ width: idx === i ? 20 : 7, height: 7, borderRadius: 999, background: idx === i ? T.goldSoft : "rgba(255,255,255,.25)", transition: "all .2s" }} />
        ))}
      </div>
      <div style={{ padding: "0 28px 40px" }}>
        <Button
          full
          variant="gold"
          size="lg"
          onClick={() => (i < screens.length - 1 ? setI(i + 1) : onDone())}
        >
          {i < screens.length - 1 ? "Continue" : "Get Started"}
          <Icon name="chevron-right" color="#fff" size={16} />
        </Button>
        {i < screens.length - 1 && (
          <button onClick={onDone} style={{ display: "block", margin: "14px auto 0", background: "none", border: "none", color: "#9FA6B3", fontSize: 12.5, cursor: "pointer" }}>Skip</button>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   HOME
   ========================================================================= */

function DocCard({ doc, onEdit, onDuplicate, onDelete, onExport }) {
  const isCV = doc.kind === "cv";
  return (
    <Card style={{ padding: 12, display: "flex", gap: 12, marginBottom: 10 }}>
      {isCV ? (
        <CVThumb cv={doc} width={64} />
      ) : (
        <div style={{ width: 64, height: 90, borderRadius: 8, border: `1px solid ${T.hair}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={T.steel} strokeWidth="1.4"><rect x="4" y="3" width="16" height="18" rx="1.4" /><path d="M7.5 8h9M7.5 11.5h9M7.5 15h6" strokeLinecap="round" /></svg>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.name}</div>
        <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>
          {isCV ? TEMPLATES.find((t) => t.id === doc.templateId)?.name : `${doc.style} style`} · {new Date(doc.lastEdited).toLocaleDateString()}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button onClick={() => onEdit(doc)} style={miniBtn}><Icon name="edit" size={13} color={T.navy} />Edit</button>
          <button onClick={() => onDuplicate(doc)} style={miniBtn}><Icon name="copy" size={13} color={T.navy} />Duplicate</button>
          <button onClick={() => onDelete(doc)} style={{ ...miniBtn, color: T.danger }}><Icon name="trash" size={13} color={T.danger} /></button>
        </div>
      </div>
    </Card>
  );
}
const miniBtn = { display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: T.navy, background: T.paper, border: `1px solid ${T.hair}`, borderRadius: 7, padding: "5px 9px", cursor: "pointer" };

function Home({ data, go, onEdit, onDuplicate, onDelete }) {
  const recent = [...data.cvs, ...data.letters].sort((a, b) => b.lastEdited - a.lastEdited).slice(0, 4);
  return (
    <div style={{ paddingBottom: 100 }}>
      <div style={{ padding: "22px 20px 6px" }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 24, color: T.ink, fontWeight: 700 }}>Classic CV Builder</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>Create a CV that gets you noticed.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "18px 20px 6px" }}>
        <ActionTile icon="plus-circle" label="Create New CV" onClick={() => go("templates")} primary />
        <ActionTile icon="sparkle" label="Create Cover Letter" onClick={() => go("letterForm", { letter: newCoverLetter() })} />
        <ActionTile icon="folder" label="My CVs" onClick={() => go("documents", { tab: "cv" })} />
        <ActionTile icon="folder" label="My Cover Letters" onClick={() => go("documents", { tab: "letter" })} />
      </div>

      <div style={{ padding: "20px 20px 0" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Recent Documents</div>
        {recent.length === 0 ? (
          <EmptyState icon="folder" title="Nothing here yet" text="Your recent CVs and cover letters will show up here once you create one." />
        ) : (
          recent.map((d) => (
            <DocCard key={d.id} doc={d} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} />
          ))
        )}
      </div>
    </div>
  );
}

function ActionTile({ icon, label, onClick, primary }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 20, textAlign: "left",
        padding: "18px 16px", borderRadius: 14, cursor: "pointer",
        background: primary ? T.navy : T.surface, border: `1px solid ${primary ? T.navy : T.hair}`,
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 9, background: primary ? "rgba(255,255,255,.12)" : T.paper, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} color={primary ? T.goldSoft : T.navy} size={18} />
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: primary ? "#fff" : T.ink, lineHeight: 1.3 }}>{label}</div>
    </button>
  );
}

/* ============================================================================
   TEMPLATE PICKER
   ========================================================================= */

function TemplatePicker({ onPick, onBack }) {
  return (
    <div>
      <TopBar title="Choose a Template" onBack={onBack} />
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 13, color: T.muted, marginBottom: 16, lineHeight: 1.5 }}>
          Every template is a genuinely different layout — pick the one that fits how you want to be read.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {TEMPLATES.map((t) => {
            const sample = { ...newCV(), templateId: t.id, personal: { ...emptyPersonal(), fullName: "Jordan Blake", title: "Product Manager", email: "jordan@email.com" }, summary: "Results-driven professional with a track record of delivery.", experience: [{ id: "x", jobTitle: "Senior PM", company: "Acme Co", startDate: "2021", endDate: "", current: true, description: "Led cross-functional teams." }], skills: [{ id: "s1", name: "Strategy" }, { id: "s2", name: "Analytics" }] };
            return (
              <button key={t.id} onClick={() => onPick(t.id)} style={{ background: T.surface, border: `1.4px solid ${T.hair}`, borderRadius: 14, padding: 12, cursor: "pointer", textAlign: "left" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                  <CVThumb cv={sample} width={132} />
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{t.name}</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 3, lineHeight: 1.4 }}>{t.blurb}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   CV WIZARD
   ========================================================================= */

const STEP_LABELS = ["Personal", "Summary", "Experience", "Education", "Skills", "Certifications", "Additional"];

function useCVDraft(initial) {
  const [cv, setCV] = useState(initial);
  const patch = useCallback((fn) => setCV((prev) => { const next = typeof fn === "function" ? fn(prev) : { ...prev, ...fn }; return { ...next, lastEdited: now() }; }), []);
  return [cv, patch, setCV];
}

function StepPersonal({ cv, patch }) {
  const p = cv.personal;
  const set = (k, v) => patch((c) => ({ ...c, personal: { ...c.personal, [k]: v } }));
  return (
    <div>
      <Field label="Full Name"><Input value={p.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="Jordan Blake" /></Field>
      <Field label="Professional Title"><Input value={p.title} onChange={(e) => set("title", e.target.value)} placeholder="Senior Product Manager" /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Phone Number"><Input value={p.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+1 555 123 4567" /></Field>
        <Field label="Email Address"><Input value={p.email} onChange={(e) => set("email", e.target.value)} placeholder="jordan@email.com" /></Field>
      </div>
      <Field label="Location"><Input value={p.location} onChange={(e) => set("location", e.target.value)} placeholder="City, Country" /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="LinkedIn URL"><Input value={p.linkedin} onChange={(e) => set("linkedin", e.target.value)} placeholder="linkedin.com/in/..." /></Field>
        <Field label="Portfolio Website"><Input value={p.website} onChange={(e) => set("website", e.target.value)} placeholder="yoursite.com" /></Field>
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="info" size={13} color={T.muted} /> A profile photograph is optional and can be added later from Preview.
      </div>
    </div>
  );
}

function AIButton({ label, onClick, loading }) {
  return (
    <button onClick={onClick} disabled={loading} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: T.gold, background: `${T.gold}14`, border: `1px solid ${T.gold}55`, borderRadius: 999, padding: "6px 12px", cursor: loading ? "default" : "pointer" }}>
      <Icon name="sparkle" size={13} color={T.gold} /> {loading ? "Working…" : label}
    </button>
  );
}

function StepSummary({ cv, patch, toast }) {
  const session = useSession();
  const [loading, setLoading] = useState(false);
  const improve = async () => {
    if (!cv.summary.trim()) { toast("Write a draft summary first."); return; }
    setLoading(true);
    try {
      const out = await runAI(session, "improveSummary", {
        full_name: cv.personal.fullName,
        title: cv.personal.title,
        draft_summary: cv.summary,
        experience_context: cv.experience.map((e) => `${e.jobTitle} at ${e.company}`).join("; ") || "none listed",
      });
      if (out) patch({ summary: out });
    } catch (e) {
      toast(e.message || "Couldn't reach the AI assistant. Try again.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: T.charcoal }}>Professional Summary</div>
        <AIButton label="Improve with AI" onClick={improve} loading={loading} />
      </div>
      <TextArea rows={7} value={cv.summary} onChange={(e) => patch({ summary: e.target.value })} placeholder="A short paragraph introducing who you are professionally and what you bring." />
      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 6 }}>AI rewrites your words — it never adds qualifications you haven't mentioned.</div>
    </div>
  );
}

function RepeatingSection({ items, onChange, renderItem, emptyLabel, addLabel, newItem }) {
  const add = () => onChange([...items, newItem()]);
  const update = (id, patch) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id) => onChange(items.filter((it) => it.id !== id));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div>
      {items.length === 0 && <div style={{ fontSize: 13, color: T.muted, marginBottom: 14 }}>{emptyLabel}</div>}
      {items.map((it, i) => (
        <Card key={it.id} style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => move(i, -1)} style={{ ...iconBtnStyle, width: 26, height: 26 }} title="Move up"><Icon name="chevron-left" size={13} style={{ transform: "rotate(90deg)" }} /></button>
              <button onClick={() => move(i, 1)} style={{ ...iconBtnStyle, width: 26, height: 26 }} title="Move down"><Icon name="chevron-left" size={13} style={{ transform: "rotate(-90deg)" }} /></button>
            </div>
            <button onClick={() => remove(it.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.danger, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <Icon name="trash" size={13} color={T.danger} /> Remove
            </button>
          </div>
          {renderItem(it, (patch) => update(it.id, patch))}
        </Card>
      ))}
      <Button variant="outline" onClick={add} full><Icon name="plus-circle" size={16} color={T.navy} /> {addLabel}</Button>
    </div>
  );
}

function StepExperience({ cv, patch, toast }) {
  const session = useSession();
  const [loadingId, setLoadingId] = useState(null);
  const improve = async (item, update) => {
    if (!item.description?.trim()) { toast("Add a description first."); return; }
    setLoadingId(item.id);
    try {
      const out = await runAI(session, "improveExperience", {
        job_title: item.jobTitle, company: item.company, draft_description: item.description,
      });
      if (out) update({ description: out });
    } catch (e) {
      toast(e.message || "Couldn't reach the AI assistant. Try again.");
    } finally {
      setLoadingId(null);
    }
  };
  return (
    <RepeatingSection
      items={cv.experience}
      onChange={(items) => patch({ experience: items })}
      emptyLabel="No experience added yet."
      addLabel="Add Another Experience"
      newItem={() => ({ id: uid(), jobTitle: "", company: "", location: "", startDate: "", endDate: "", current: false, description: "" })}
      renderItem={(it, update) => (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Job Title"><Input value={it.jobTitle} onChange={(e) => update({ jobTitle: e.target.value })} /></Field>
            <Field label="Company"><Input value={it.company} onChange={(e) => update({ company: e.target.value })} /></Field>
          </div>
          <Field label="Location"><Input value={it.location} onChange={(e) => update({ location: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Start Date"><Input value={it.startDate} onChange={(e) => update({ startDate: e.target.value })} placeholder="Jan 2021" /></Field>
            <Field label="End Date"><Input disabled={it.current} value={it.current ? "" : it.endDate} onChange={(e) => update({ endDate: e.target.value })} placeholder="Mar 2024" /></Field>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <Toggle checked={it.current} onChange={(v) => update({ current: v })} />
            <span style={{ fontSize: 13, color: T.charcoal }}>I currently work here</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: T.charcoal }}>Description, Responsibilities &amp; Achievements</div>
            <AIButton label="Improve with AI" onClick={() => improve(it, update)} loading={loadingId === it.id} />
          </div>
          <TextArea rows={5} value={it.description} onChange={(e) => update({ description: e.target.value })} placeholder="What did you do, and what did you achieve?" />
        </div>
      )}
    />
  );
}

function StepEducation({ cv, patch }) {
  return (
    <RepeatingSection
      items={cv.education}
      onChange={(items) => patch({ education: items })}
      emptyLabel="No education added yet."
      addLabel="Add Education"
      newItem={() => ({ id: uid(), institution: "", degree: "", field: "", location: "", startDate: "", gradDate: "", gpa: "", description: "" })}
      renderItem={(it, update) => (
        <div>
          <Field label="Institution"><Input value={it.institution} onChange={(e) => update({ institution: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Degree"><Input value={it.degree} onChange={(e) => update({ degree: e.target.value })} placeholder="B.Sc." /></Field>
            <Field label="Field of Study"><Input value={it.field} onChange={(e) => update({ field: e.target.value })} /></Field>
          </div>
          <Field label="Location"><Input value={it.location} onChange={(e) => update({ location: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Start Date"><Input value={it.startDate} onChange={(e) => update({ startDate: e.target.value })} /></Field>
            <Field label="Graduation Date"><Input value={it.gradDate} onChange={(e) => update({ gradDate: e.target.value })} /></Field>
          </div>
          <Field label="Grade / GPA (optional)"><Input value={it.gpa} onChange={(e) => update({ gpa: e.target.value })} /></Field>
          <Field label="Description (optional)"><TextArea rows={3} value={it.description} onChange={(e) => update({ description: e.target.value })} /></Field>
        </div>
      )}
    />
  );
}

function StepSkills({ cv, patch }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    if (!draft.trim()) return;
    patch({ skills: [...cv.skills, { id: uid(), name: draft.trim(), level: "Proficient" }] });
    setDraft("");
  };
  const remove = (id) => patch({ skills: cv.skills.filter((s) => s.id !== id) });
  const setLevel = (id, level) => patch({ skills: cv.skills.map((s) => (s.id === id ? { ...s, level } : s)) });
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. Data Analysis" />
        <Button onClick={add} variant="outline" style={{ flexShrink: 0 }}>Add</Button>
      </div>
      {cv.skills.length === 0 && <div style={{ fontSize: 13, color: T.muted }}>No skills added yet.</div>}
      {cv.skills.map((s) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: `1px solid ${T.hair2}` }}>
          <div style={{ flex: 1, fontSize: 13.5, color: T.ink }}>{s.name}</div>
          <select value={s.level} onChange={(e) => setLevel(s.id, e.target.value)} style={{ fontSize: 12, padding: "5px 8px", borderRadius: 7, border: `1px solid ${T.hair}`, background: T.surface, color: T.muted }}>
            {["Beginner", "Proficient", "Advanced", "Expert"].map((l) => <option key={l}>{l}</option>)}
          </select>
          <button onClick={() => remove(s.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Icon name="x" size={15} color={T.muted} /></button>
        </div>
      ))}
    </div>
  );
}

function StepCertifications({ cv, patch }) {
  return (
    <RepeatingSection
      items={cv.certifications}
      onChange={(items) => patch({ certifications: items })}
      emptyLabel="No certifications added yet."
      addLabel="Add Certification"
      newItem={() => ({ id: uid(), name: "", org: "", date: "", credId: "", credUrl: "" })}
      renderItem={(it, update) => (
        <div>
          <Field label="Certification Name"><Input value={it.name} onChange={(e) => update({ name: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Issuing Organization"><Input value={it.org} onChange={(e) => update({ org: e.target.value })} /></Field>
            <Field label="Date"><Input value={it.date} onChange={(e) => update({ date: e.target.value })} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Credential ID"><Input value={it.credId} onChange={(e) => update({ credId: e.target.value })} /></Field>
            <Field label="Credential URL"><Input value={it.credUrl} onChange={(e) => update({ credUrl: e.target.value })} /></Field>
          </div>
        </div>
      )}
    />
  );
}

function StepAdditional({ cv, patch }) {
  const setSection = (key, fn) => patch((c) => ({ ...c, additional: { ...c.additional, [key]: fn(c.additional[key]) } }));
  return (
    <div>
      <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 14 }}>Turn on the sections you want to include, then add entries.</div>
      {Object.entries(ADDITIONAL_META).map(([key, meta]) => {
        const sec = cv.additional[key];
        return (
          <Card key={key} style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{meta.label}</div>
              <Toggle checked={sec.enabled} onChange={(v) => setSection(key, (s) => ({ ...s, enabled: v }))} />
            </div>
            {sec.enabled && (
              <div style={{ marginTop: 12 }}>
                {sec.items.map((it, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
                    <Input placeholder={meta.a} value={it.a} onChange={(e) => setSection(key, (s) => ({ ...s, items: s.items.map((x, i) => (i === idx ? { ...x, a: e.target.value } : x)) }))} style={{ flex: 1 }} />
                    {meta.b && <Input placeholder={meta.b} value={it.b} onChange={(e) => setSection(key, (s) => ({ ...s, items: s.items.map((x, i) => (i === idx ? { ...x, b: e.target.value } : x)) }))} style={{ flex: 1 }} />}
                    <button onClick={() => setSection(key, (s) => ({ ...s, items: s.items.filter((_, i) => i !== idx) }))} style={{ background: "none", border: "none", cursor: "pointer" }}><Icon name="x" size={15} color={T.muted} /></button>
                  </div>
                ))}
                {meta.c && sec.items.length > 0 && (
                  <TextArea rows={2} placeholder={meta.c} value={sec.items[sec.items.length - 1]?.c || ""} onChange={(e) => setSection(key, (s) => { const items = [...s.items]; items[items.length - 1] = { ...items[items.length - 1], c: e.target.value }; return { ...s, items }; })} style={{ marginBottom: 8 }} />
                )}
                <Button size="sm" variant="outline" onClick={() => setSection(key, (s) => ({ ...s, items: [...s.items, { a: "", b: "", c: "" }] }))}>+ Add entry</Button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function CVWizard({ initial, onExit, onSave, onPreview, toast }) {
  const [cv, patch, setCV] = useCVDraft(initial);
  const [step, setStep] = useState(0);
  const [nameEditing, setNameEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved
  const saveTimer = useRef(null);
  const statusTimer = useRef(null);
  const cvRef = useRef(cv);
  cvRef.current = cv;

  // onSave persists the document (locally or to the backend, decided by the
  // caller) and returns the saved doc — which may carry a new server-assigned
  // id the first time a document is created. Debounced so typing doesn't
  // fire a network call on every keystroke.
  const doSave = useCallback(async () => {
    const current = cvRef.current;
    setSaveStatus("saving");
    try {
      const saved = await onSave(current);
      setSaveStatus("saved");
      clearTimeout(statusTimer.current);
      statusTimer.current = setTimeout(() => setSaveStatus("idle"), 2500);
      if (saved && (saved.id !== current.id || saved._serverId !== current._serverId)) {
        const merged = { ...current, id: saved.id, _serverId: saved._serverId };
        cvRef.current = merged;
        setCV(merged);
        return merged;
      }
      return current;
    } catch (e) {
      setSaveStatus("idle");
      toast(e?.message || "Couldn't save your changes.");
      return current;
    }
  }, [onSave, toast, setCV]);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, 900);
    return () => clearTimeout(saveTimer.current);
  }, [cv, doSave]);

  const flushAndGo = async (go) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const finalCv = await doSave();
    go(finalCv);
  };

  const StepComp = [StepPersonal, StepSummary, StepExperience, StepEducation, StepSkills, StepCertifications, StepAdditional][step];

  return (
    <div style={{ paddingBottom: 100 }}>
      <TopBar
        title={STEP_LABELS[step]}
        onBack={() => (step === 0 ? flushAndGo(onExit) : setStep(step - 1))}
        right={
          <button onClick={() => flushAndGo(onPreview)} style={{ ...miniBtn, background: "transparent" }}>Preview</button>
        }
      />
      <Stepper steps={STEP_LABELS} current={step} />
      <div style={{ padding: "16px 18px" }}>
        {nameEditing ? (
          <Input autoFocus value={cv.name} onBlur={() => setNameEditing(false)} onKeyDown={(e) => e.key === "Enter" && setNameEditing(false)} onChange={(e) => patch({ name: e.target.value })} style={{ marginBottom: 16, fontWeight: 700 }} />
        ) : (
          <button onClick={() => setNameEditing(true)} style={{ background: "none", border: "none", padding: 0, marginBottom: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "Georgia, serif", fontSize: 17, color: T.ink }}>{cv.name}</span>
            <Icon name="edit" size={13} color={T.muted} />
          </button>
        )}
        <SaveIndicator status={saveStatus} />
        <CompletionBar cv={cv} />
        <StepComp cv={cv} patch={patch} toast={toast} />
      </div>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 480, margin: "0 auto", padding: "12px 18px 18px", background: `linear-gradient(${T.paper}00, ${T.paper} 22%)`, display: "flex", gap: 10 }}>
        {step > 0 && <Button variant="subtle" onClick={() => setStep(step - 1)} style={{ flex: 1 }}>Back</Button>}
        {step < STEP_LABELS.length - 1 ? (
          <Button onClick={() => setStep(step + 1)} style={{ flex: 2 }}>Continue<Icon name="chevron-right" color="#fff" size={15} /></Button>
        ) : (
          <Button onClick={() => flushAndGo(onPreview)} style={{ flex: 2 }} variant="gold">Preview &amp; Finish</Button>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   CV PREVIEW / EXPORT
   ========================================================================= */

function ReviewPanel({ cv, onClose, toast }) {
  const session = useSession();
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState(null);
  const run = async () => {
    setLoading(true);
    try {
      const summaryOfCV = {
        personal: cv.personal, summary: cv.summary,
        experience: cv.experience.map((e) => ({ jobTitle: e.jobTitle, company: e.company, hasDates: !!(e.startDate), hasDescription: !!e.description })),
        education: cv.education.length, skills: cv.skills.map((s) => s.name), certifications: cv.certifications.length,
        sectionsIncluded: sectionsFor(cv),
      };
      const out = await runAI(session, "reviewCv", { cv_summary_json: summaryOfCV });
      setNotes(out);
    } catch (e) {
      toast(e.message || "Couldn't reach the AI assistant.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,20,20,.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, width: "100%", maxWidth: 480, maxHeight: "78vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "22px 20px 30px" }}>
        <div style={{ width: 36, height: 4, background: T.hair, borderRadius: 999, margin: "0 auto 18px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Icon name="sparkle" color={T.gold} size={17} />
          <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: T.ink }}>CV Assistant — Review</div>
        </div>
        <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 16 }}>Suggestions only — based strictly on what you've entered.</div>
        {!notes && !loading && <Button onClick={run} full variant="gold"><Icon name="sparkle" color="#fff" size={15} /> Run CV Review</Button>}
        {loading && <div style={{ fontSize: 13, color: T.muted, textAlign: "center", padding: 20 }}>Reviewing your CV…</div>}
        {notes && (
          <div style={{ fontSize: 13.3, lineHeight: 1.8, color: T.ink, whiteSpace: "pre-line" }}>{notes}</div>
        )}
      </div>
    </div>
  );
}

function CVPreview({ cv, onBack, onEdit, onChangeTemplate, toast }) {
  const [zoom, setZoom] = useState(0.42);
  const [reviewOpen, setReviewOpen] = useState(false);
  const doExport = () => window.print();

  return (
    <div>
      <div className="no-print">
        <TopBar title="Preview" onBack={onBack} right={<button onClick={() => setReviewOpen(true)} style={{ ...miniBtn, background: "transparent" }}><Icon name="sparkle" size={13} color={T.gold} />Review</button>} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "12px 18px" }}>
          <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.08))} style={iconBtnStyle}>−</button>
          <div style={{ fontSize: 12.5, color: T.muted, width: 44, textAlign: "center" }}>{Math.round(zoom * 100)}%</div>
          <button onClick={() => setZoom((z) => Math.min(0.9, z + 0.08))} style={iconBtnStyle}>+</button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", padding: "0 12px 18px", overflow: "auto" }} className="preview-scroll">
        <div className="print-area" style={{ width: 794 * zoom, height: 1123 * zoom, boxShadow: "0 10px 30px rgba(20,20,25,.15)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: 794, height: 1123 }}>
            <CVRenderer cv={cv} />
          </div>
        </div>
      </div>

      <div className="no-print" style={{ padding: "0 18px 30px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="subtle" onClick={onEdit} style={{ flex: 1 }}><Icon name="edit" size={14} color={T.ink} /> Edit</Button>
          <Button variant="subtle" onClick={onChangeTemplate} style={{ flex: 1 }}>Change Template</Button>
        </div>
        <Button variant="gold" onClick={doExport} full><Icon name="download" size={16} color="#fff" /> Download PDF</Button>
        <Button variant="outline" onClick={() => { if (navigator.share) navigator.share({ title: cv.name, text: `My CV — ${cv.name}` }).catch(() => {}); else toast("Use your browser's share option after downloading."); }} full>
          <Icon name="share" size={15} color={T.navy} /> Share
        </Button>
        <div style={{ fontSize: 11.5, color: T.muted, textAlign: "center", marginTop: 2 }}>Download opens your browser's print dialog — choose "Save as PDF."</div>
      </div>
      {reviewOpen && <ReviewPanel cv={cv} onClose={() => setReviewOpen(false)} toast={toast} />}
    </div>
  );
}

/* ============================================================================
   COVER LETTER
   ========================================================================= */

function LetterForm({ initial, onExit, onGenerate, onSave, toast }) {
  const session = useSession();
  const [letter, setLetter] = useState(initial);
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setLetter((l) => ({ ...l, [k]: v, lastEdited: now() }));

  const generate = async () => {
    if (!letter.fullName || !letter.jobTitle || !letter.company) { toast("Add your name, the role, and the company first."); return; }
    setLoading(true);
    try {
      const out = await runAI(session, "generateCoverLetter", {
        style: letter.style, full_name: letter.fullName, job_title: letter.jobTitle, company: letter.company,
        hiring_manager: letter.hiringManager, job_description: letter.jobDescription,
        experience: letter.experience, skills: letter.skills, education: letter.education,
        additional_info: letter.additionalInfo,
      });
      const next = { ...letter, content: out, lastEdited: now() };
      setLetter(next);
      const saved = await onSave(next, { silent: true }); // wait for the save so we navigate with a real id, not a duplicate
      onGenerate(saved || next);
    } catch (e) {
      toast(e.message || "Couldn't reach the AI assistant. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ paddingBottom: 110 }}>
      <TopBar title="Cover Letter" onBack={() => onExit(letter)} />
      <div style={{ padding: "16px 18px" }}>
        <Field label="Document Name"><Input value={letter.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Style">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {COVER_STYLES.map((s) => (
              <button key={s} onClick={() => set("style", s)} style={{ fontSize: 12, fontWeight: 600, padding: "7px 13px", borderRadius: 999, cursor: "pointer", border: `1.3px solid ${letter.style === s ? T.navy : T.hair}`, background: letter.style === s ? T.navy : T.surface, color: letter.style === s ? "#fff" : T.ink }}>
                {s}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Full Name"><Input value={letter.fullName} onChange={(e) => set("fullName", e.target.value)} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Job Title"><Input value={letter.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} /></Field>
          <Field label="Company Name"><Input value={letter.company} onChange={(e) => set("company", e.target.value)} /></Field>
        </div>
        <Field label="Hiring Manager Name (optional)"><Input value={letter.hiringManager} onChange={(e) => set("hiringManager", e.target.value)} /></Field>
        <Field label="Job Description"><TextArea rows={4} value={letter.jobDescription} onChange={(e) => set("jobDescription", e.target.value)} placeholder="Paste the job posting or a summary." /></Field>
        <Field label="Relevant Experience"><TextArea rows={3} value={letter.experience} onChange={(e) => set("experience", e.target.value)} /></Field>
        <Field label="Relevant Skills"><TextArea rows={2} value={letter.skills} onChange={(e) => set("skills", e.target.value)} /></Field>
        <Field label="Education"><Input value={letter.education} onChange={(e) => set("education", e.target.value)} /></Field>
        <Field label="Additional Information"><TextArea rows={2} value={letter.additionalInfo} onChange={(e) => set("additionalInfo", e.target.value)} /></Field>
      </div>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 480, margin: "0 auto", padding: "12px 18px 18px", background: `linear-gradient(${T.paper}00, ${T.paper} 22%)` }}>
        <Button full variant="gold" size="lg" onClick={generate} disabled={loading}>
          <Icon name="sparkle" size={16} color="#fff" /> {loading ? "Generating…" : "Generate Cover Letter"}
        </Button>
      </div>
    </div>
  );
}

function LetterPreview({ letter, onBack, onEdit, onRegenerate, toast, onSave }) {
  const session = useSession();
  const [content, setContent] = useState(letter.content);
  const [busy, setBusy] = useState(null);
  useEffect(() => setContent(letter.content), [letter.id]);

  const transform = async (kind) => {
    setBusy(kind);
    try {
      const out = await runAI(session, "transformLetter", { content, transform: kind });
      setContent(out);
      onSave({ ...letter, content: out, lastEdited: now() }, { silent: true });
    } catch (e) {
      toast(e.message || "Couldn't reach the AI assistant.");
    } finally {
      setBusy(null);
    }
  };

  const save = () => { onSave({ ...letter, content, lastEdited: now() }); toast("Saved."); };
  const doExport = () => window.print();

  return (
    <div style={{ paddingBottom: 110 }}>
      <div className="no-print">
        <TopBar title={letter.name} onBack={onBack} right={<button onClick={onEdit} style={{ ...miniBtn, background: "transparent" }}>Edit Info</button>} />
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 0" }}>
          <AIButton label="Regenerate" onClick={onRegenerate} />
          <AIButton label="Shorter" onClick={() => transform("shorter")} loading={busy === "shorter"} />
          <AIButton label="More Professional" onClick={() => transform("professional")} loading={busy === "professional"} />
          <AIButton label="Change Tone" onClick={() => transform("tone")} loading={busy === "tone"} />
        </div>
      </div>
      <div style={{ padding: "16px 18px" }}>
        <div className="print-area" style={{ background: "#fff", border: `1px solid ${T.hair}`, borderRadius: 10, padding: 26 }}>
          <TextArea rows={18} value={content} onChange={(e) => setContent(e.target.value)} style={{ border: "none", fontFamily: "Georgia, serif", fontSize: 13.5, lineHeight: 1.75, padding: 0 }} />
        </div>
      </div>
      <div className="no-print" style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 480, margin: "0 auto", padding: "12px 18px 18px", background: `linear-gradient(${T.paper}00, ${T.paper} 22%)`, display: "flex", gap: 10 }}>
        <Button variant="subtle" onClick={save} style={{ flex: 1 }}>Save</Button>
        <Button variant="gold" onClick={doExport} style={{ flex: 1 }}><Icon name="download" size={15} color="#fff" /> Export PDF</Button>
      </div>
    </div>
  );
}

/* ============================================================================
   DOCUMENTS
   ========================================================================= */

function Documents({ data, initialTab, onEdit, onDuplicate, onDelete }) {
  const [tab, setTab] = useState(initialTab || "cv");
  const list = tab === "cv" ? data.cvs : data.letters;
  return (
    <div style={{ paddingBottom: 100 }}>
      <TopBar title="My Documents" />
      <div style={{ display: "flex", padding: "14px 18px 0", gap: 8 }}>
        {["cv", "letter"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.3px solid ${tab === t ? T.navy : T.hair}`, background: tab === t ? T.navy : T.surface, color: tab === t ? "#fff" : T.ink }}>
            {t === "cv" ? "CVs" : "Cover Letters"}
          </button>
        ))}
      </div>
      <div style={{ padding: "16px 18px" }}>
        {list.length === 0 ? (
          <EmptyState icon="folder" title={tab === "cv" ? "No CVs yet" : "No cover letters yet"} text="Create one from the Home or Create tab." />
        ) : (
          [...list].sort((a, b) => b.lastEdited - a.lastEdited).map((d) => (
            <DocCard key={d.id} doc={d} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} />
          ))
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   CREATE TAB
   ========================================================================= */

function CreateTab({ go }) {
  return (
    <div style={{ paddingBottom: 100 }}>
      <TopBar title="Create" />
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <Card style={{ padding: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, fontFamily: "Georgia, serif", marginBottom: 6 }}>New CV</div>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, lineHeight: 1.5 }}>Pick a template, then fill in your details step by step.</div>
          <Button variant="primary" onClick={() => go("templates")}><Icon name="plus-circle" size={15} color="#fff" /> Start a CV</Button>
        </Card>
        <Card style={{ padding: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, fontFamily: "Georgia, serif", marginBottom: 6 }}>New Cover Letter</div>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, lineHeight: 1.5 }}>Answer a few questions and let the AI draft it for you.</div>
          <Button variant="gold" onClick={() => go("letterForm", { letter: newCoverLetter() })}><Icon name="sparkle" size={15} color="#fff" /> Start a Cover Letter</Button>
        </Card>
      </div>
    </div>
  );
}

/* ============================================================================
   PROFILE
   ========================================================================= */

function Row({ icon, label, right, onClick }) {
  return (
    <button onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 4px", background: "none", border: "none", borderBottom: `1px solid ${T.hair2}`, cursor: onClick ? "pointer" : "default", textAlign: "left" }}>
      <Icon name={icon} size={17} color={T.steel} />
      <div style={{ flex: 1, fontSize: 13.8, color: T.ink }}>{label}</div>
      {right || <Icon name="chevron-right" size={15} color={T.muted} />}
    </button>
  );
}

function InfoModal({ open, title, icon, onClose, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,20,20,.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, width: "100%", maxWidth: 480, maxHeight: "78vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "22px 20px 30px" }}>
        <div style={{ width: 36, height: 4, background: T.hair, borderRadius: 999, margin: "0 auto 18px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          {icon && <Icon name={icon} size={17} color={T.steel} />}
          <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: T.ink }}>{title}</div>
        </div>
        <div style={{ fontSize: 13, color: T.charcoal, lineHeight: 1.65 }}>{children}</div>
        <Button full variant="subtle" onClick={onClose} style={{ marginTop: 20 }}>Close</Button>
      </div>
    </div>
  );
}

function ServerSettingsModal({ open, apiBase, onClose, onSave }) {
  const [value, setValue] = useState(apiBase);
  useEffect(() => { if (open) setValue(apiBase); }, [open, apiBase]);
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,20,20,.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, width: "100%", maxWidth: 480, borderRadius: "18px 18px 0 0", padding: "22px 20px 30px" }}>
        <div style={{ width: 36, height: 4, background: T.hair, borderRadius: 999, margin: "0 auto 18px" }} />
        <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: T.ink, marginBottom: 6 }}>Backend Server</div>
        <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 16, lineHeight: 1.5 }}>
          The URL of your deployed Classic CV Builder API (FastAPI). Needed for account sign-in, cloud sync, and premium.
        </div>
        <Field label="Server URL"><Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://your-api.onrender.com" /></Field>
        <Button full variant="primary" onClick={() => onSave(value.trim())}>Save</Button>
      </div>
    </div>
  );
}

function AuthModal({ open, onClose, session, onAuthed, toast }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  if (!open) return null;

  const submit = async () => {
    if (!session.apiBase) { toast("Set your backend server URL first."); return; }
    if (!email || !password) { toast("Enter your email and password."); return; }
    setLoading(true);
    try {
      const res = await apiFetch(session.apiBase, null, mode === "login" ? "/auth/login" : "/auth/register", {
        method: "POST", body: { email, password },
      });
      await onAuthed(res.access_token);
      onClose();
    } catch (e) {
      toast(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,20,20,.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, width: "100%", maxWidth: 480, borderRadius: "18px 18px 0 0", padding: "22px 20px 30px" }}>
        <div style={{ width: 36, height: 4, background: T.hair, borderRadius: 999, margin: "0 auto 18px" }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {["login", "register"].map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: "9px 0", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.3px solid ${mode === m ? T.navy : T.hair}`, background: mode === m ? T.navy : T.surface, color: mode === m ? "#fff" : T.ink }}>
              {m === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></Field>
        {!session.apiBase && (
          <div style={{ fontSize: 11.5, color: T.danger, marginBottom: 12 }}>No backend server URL set — add one in Profile → Server Connection first.</div>
        )}
        <Button full variant="primary" onClick={submit} disabled={loading}>{loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}</Button>
      </div>
    </div>
  );
}

function Profile({ toast, session, onSignOut, onOpenAuth, onOpenServerSettings, onUpgrade, themeMode, onToggleTheme }) {
  const { isAuthed, user, apiBase } = session;
  const [modal, setModal] = useState(null); // "notifications" | "language" | "privacy" | "help" | null
  const isDark = themeMode === "dark";

  return (
    <div style={{ paddingBottom: 100 }}>
      <TopBar title="Profile" />
      <div style={{ padding: 20 }}>
        <Card style={{ padding: 18, display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div style={{ width: 50, height: 50, borderRadius: 999, background: T.hair2, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="user" size={22} color={T.steel} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{isAuthed ? user?.email : "Guest"}</div>
            <div style={{ fontSize: 12, color: T.muted }}>
              {isAuthed ? (user?.is_premium ? "Premium" : "Free plan") : "Not signed in — working locally on this device"}
            </div>
          </div>
          {isAuthed ? (
            <Button size="sm" variant="outline" onClick={onSignOut}><Icon name="logout" size={13} color={T.navy} /> Sign Out</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onOpenAuth}>Sign In</Button>
          )}
        </Card>

        {!(isAuthed && user?.is_premium) && (
          <Card style={{ padding: 18, marginBottom: 18, background: T.navy, border: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Icon name="crown" size={17} color={T.goldSoft} />
              <div style={{ fontFamily: "Georgia, serif", fontSize: 15.5, color: "#fff" }}>Go Premium</div>
            </div>
            <div style={{ fontSize: 12.5, color: "#C6CBD6", lineHeight: 1.5, marginBottom: 14 }}>Unlimited CVs, every template, and full AI assistance.</div>
            <Button variant="gold" size="sm" onClick={onUpgrade}>See Plans</Button>
          </Card>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Account</div>
        <Row icon="globe" label="Server Connection" right={<span style={{ fontSize: 11.5, color: T.muted, maxWidth: 140, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{apiBase || "Not set"}</span>} onClick={onOpenServerSettings} />
        <Row icon="bell" label="Notification Settings" onClick={() => setModal("notifications")} />
        <Row icon="moon" label="Appearance" right={<Toggle checked={isDark} onChange={onToggleTheme} />} />
        <Row icon="globe" label="Language" onClick={() => setModal("language")} />
        <div style={{ height: 18 }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Support &amp; Legal</div>
        <Row icon="crown" label="Subscription" onClick={onUpgrade} />
        <Row icon="lock" label="Privacy" onClick={() => setModal("privacy")} />
        <Row icon="help" label="Help & Support" onClick={() => setModal("help")} />
        <Row icon="info" label="About" onClick={() => toast("Classic CV Builder.")} />
        <Row icon="home" label="Back to Homepage" onClick={() => { window.location.hash = ""; }} />
      </div>

      <InfoModal open={modal === "notifications"} title="Notification Settings" icon="bell" onClose={() => setModal(null)}>
        Email and push notifications (like reminders to finish a CV, or AI results ready) aren't set up yet — this app doesn't send any notifications today. When they're added, you'll be able to turn each type on or off here.
      </InfoModal>

      <InfoModal open={modal === "language"} title="Language" icon="globe" onClose={() => setModal(null)}>
        Classic CV Builder is currently available in <b>English only</b>. Additional languages may be added in a future update — there's no timeline for this yet.
      </InfoModal>

      <InfoModal open={modal === "privacy"} title="Privacy" icon="lock" onClose={() => setModal(null)}>
        <p style={{ marginTop: 0 }}>Your CV and cover letter content is stored either locally on your device (guest mode) or, if you sign in, on the app's own server — it is never sold or shared with third parties.</p>
        <p>Signing in sends your email and password (hashed, never stored in plain text) to the app's backend. AI writing features send only the specific text you're working on to Anthropic's API to generate suggestions.</p>
        <p>You can delete any saved document at any time from the Documents tab. To delete your account entirely, contact support using the Help &amp; Support option below.</p>
        <a href="/privacy.html" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: T.gold, textDecoration: "none" }}>
          Read the full Privacy Policy <Icon name="chevron-right" size={12} color={T.gold} />
        </a>
      </InfoModal>

      <InfoModal open={modal === "help"} title="Help & Support" icon="help" onClose={() => setModal(null)}>
        <p style={{ marginTop: 0 }}><b>My AI features aren't working.</b> This usually means either you're not signed in (AI requires an account) or the day's free-plan AI limit has been reached — try again tomorrow or upgrade to Premium.</p>
        <p><b>I can't sign in / it says my account doesn't exist.</b> Make sure Server Connection (above) points to the right backend URL, and that you're using the same email you registered with.</p>
        <p><b>My PDF export looks off.</b> Use the "Download PDF" button on the Preview screen, then choose "Save as PDF" in your browser's print dialog rather than a screenshot.</p>
        <p style={{ marginBottom: 0 }}>For anything else, reach out to whoever gave you access to this app.</p>
      </InfoModal>
    </div>
  );
}

/* ============================================================================
   BOTTOM NAV
   ========================================================================= */

function BottomNav({ tab, setTab }) {
  const items = [
    { id: "home", icon: "home", label: "Home" },
    { id: "create", icon: "plus-circle", label: "Create" },
    { id: "documents", icon: "folder", label: "Documents" },
    { id: "profile", icon: "user", label: "Profile" },
  ];
  return (
    <div className="no-print" style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: T.surface, borderTop: `1px solid ${T.hair}`, display: "flex", zIndex: 50 }}>
      {items.map((it) => {
        const active = tab === it.id;
        return (
          <button key={it.id} onClick={() => setTab(it.id)} style={{ flex: 1, padding: "10px 0 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer" }}>
            <Icon name={it.icon} size={20} color={active ? T.navy : T.muted} />
            <div style={{ fontSize: 10.5, fontWeight: active ? 700 : 500, color: active ? T.navy : T.muted }}>{it.label}</div>
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================================
   ROOT APP
   ========================================================================= */

/* ============================================================================
   LANDING / DOWNLOAD PAGE
   The public-facing marketing page — separate from the web app itself.
   Fill in each DOWNLOAD_LINKS.*.url once that store listing (or your
   hosted APK) actually exists; until then the button shows the note
   instead of a dead link.
   ========================================================================= */

const DOWNLOAD_LINKS = {
  apk: {
    label: "Direct APK Download",
    url: "", // e.g. a GitHub Releases asset URL, once you've built and uploaded the .apk
    note: "Coming soon — upload a release APK (e.g. to GitHub Releases) and paste the link here.",
  },
  amazon: {
    label: "Amazon Appstore",
    url: "", // your Amazon Appstore listing URL once approved
    note: "Coming soon — submit at developer.amazon.com/apps-and-games (free).",
  },
  samsung: {
    label: "Samsung Galaxy Store",
    url: "", // your Galaxy Store listing URL once approved
    note: "Coming soon — submit at seller.samsungapps.com (free).",
  },
  huawei: {
    label: "Huawei AppGallery",
    url: "", // your AppGallery listing URL once approved
    note: "Coming soon — submit at developer.huawei.com/consumer/en/appgallery.",
  },
};

function DownloadButton({ item }) {
  const ready = !!item.url;
  const body = (
    <>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: ready ? `${T.gold}18` : T.hair2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name="download" size={17} color={ready ? T.gold : T.muted} />
      </div>
      <div style={{ flex: 1, textAlign: "left" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{item.label}</div>
        <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2, lineHeight: 1.4 }}>{ready ? "Tap to download" : item.note}</div>
      </div>
    </>
  );
  const sharedStyle = {
    display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
    padding: "12px 14px", borderRadius: 12, border: `1.3px solid ${T.hair}`, background: T.surface,
    marginBottom: 10, textDecoration: "none", cursor: ready ? "pointer" : "default", opacity: ready ? 1 : 0.75,
  };
  return ready ? (
    <a href={item.url} target="_blank" rel="noreferrer" style={sharedStyle}>{body}</a>
  ) : (
    <div style={sharedStyle}>{body}</div>
  );
}

function Logo({ size = 64 }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="60" height="60" rx="15" fill={T.navy} />
      <path d="M20 15 H38 L46 23 V49 A2 2 0 0 1 44 51 H20 A2 2 0 0 1 18 49 V17 A2 2 0 0 1 20 15 Z" fill={T.paper} stroke={T.gold} strokeWidth="1.2" />
      <path d="M38 15 V21 A2 2 0 0 0 40 23 H46 Z" fill={T.hair2} />
      <line x1="23" y1="29" x2="41" y2="29" stroke={T.navy} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="23" y1="34" x2="41" y2="34" stroke={T.navy} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="23" y1="39" x2="34" y2="39" stroke={T.navy} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M40 42 L46 48 L44 58 L40 54 L36 58 L34 48 Z" fill={T.gold} />
      <circle cx="40" cy="46" r="6.5" fill={T.goldSoft} stroke={T.navy} strokeWidth="1.2" />
      <path d="M37.2 46 L39.2 48 L43 43.8" fill="none" stroke={T.navy} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Section({ children, style }) {
  return <div style={{ marginTop: 40, ...style }}>{children}</div>;
}
function SectionTitle({ children }) {
  return <div style={{ fontFamily: "Georgia, serif", fontSize: 19, fontWeight: 700, color: T.ink, marginBottom: 14, textAlign: "center" }}>{children}</div>;
}

function TrustIndicators() {
  const items = ["ATS-Friendly Templates", "Professional Designs", "Easy PDF Export", "No Design Skills Required"];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginBottom: 8 }}>
      {items.map((t) => (
        <span key={t} style={{ fontSize: 11, fontWeight: 600, color: T.steel, background: `${T.steel}12`, border: `1px solid ${T.steel}30`, borderRadius: 999, padding: "5px 11px", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="check" size={11} color={T.steel} /> {t}
        </span>
      ))}
    </div>
  );
}

const LANDING_FEATURES = [
  { icon: "folder", title: "Professional Templates", text: "Five genuinely different layouts — pick the one that fits how you want to be read." },
  { icon: "check", title: "ATS-Friendly", text: "Single-column templates parse cleanly through applicant tracking systems." },
  { icon: "edit", title: "Live Preview", text: "See exactly what you'll export, updated as you type." },
  { icon: "download", title: "Easy Export", text: "Download a print-ready PDF in one tap, no formatting fuss." },
  { icon: "globe", title: "Works Anywhere", text: "Build and edit your CV from your phone, tablet, or computer." },
  { icon: "copy", title: "Multiple CVs", text: "Keep separate versions tailored to different roles or industries." },
];

function FeatureGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {LANDING_FEATURES.map((f) => (
        <Card key={f.title} style={{ padding: 14 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: `${T.gold}18`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
            <Icon name={f.icon} size={15} color={T.gold} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 4 }}>{f.title}</div>
          <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.45 }}>{f.text}</div>
        </Card>
      ))}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", title: "Choose a Template", text: "Pick a professional layout that fits your field." },
    { n: "02", title: "Add Your Information", text: "Enter your experience, education, skills, and achievements." },
    { n: "03", title: "Download & Apply", text: "Export a polished PDF and start sending applications." },
  ];
  return (
    <div>
      {steps.map((s) => (
        <div key={s.n} style={{ display: "flex", gap: 14, marginBottom: 18, alignItems: "flex-start" }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 700, color: `${T.gold}90`, width: 34, flexShrink: 0 }}>{s.n}</div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, marginBottom: 3 }}>{s.title}</div>
            <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>{s.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Sample/placeholder copy for the landing page — not real customer quotes.
// Replace with genuine testimonials once the app has real users.
const DEMO_TESTIMONIALS = [
  { quote: "Having every template render as a live preview instead of a static image made picking one so much easier.", name: "Demo quote — replace with a real user testimonial", role: "" },
  { quote: "The step-by-step builder meant I never felt like I was staring at one giant form.", name: "Demo quote — replace with a real user testimonial", role: "" },
];

function Testimonials() {
  return (
    <div>
      {DEMO_TESTIMONIALS.map((t, i) => (
        <Card key={i} style={{ padding: 16, marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.55, fontStyle: "italic", marginBottom: 8 }}>&ldquo;{t.quote}&rdquo;</div>
          <div style={{ fontSize: 11.5, color: T.muted }}>{t.name}</div>
        </Card>
      ))}
    </div>
  );
}

const FAQ_ITEMS = [
  { q: "How does Classic CV Builder work?", a: "Pick a template, fill in your details step by step, and preview updates live as you go. Export to PDF whenever you're ready." },
  { q: "Can I create multiple CVs?", a: "Yes — save as many as you need, e.g. tailored to different roles or industries." },
  { q: "Can I create a cover letter too?", a: "Yes, a separate builder generates a cover letter from your details in a style you choose." },
  { q: "Can I download my CV as a PDF?", a: "Yes — the preview screen has a Download PDF option that opens your browser's print dialog; choose \"Save as PDF.\"" },
  { q: "Can I use this on my phone?", a: "Yes, the web app works on any device with a browser. A native Android app is also planned." },
];

function FAQAccordion() {
  const [open, setOpen] = useState(null);
  return (
    <div>
      {FAQ_ITEMS.map((item, i) => (
        <div key={i} style={{ borderBottom: `1px solid ${T.hair2}` }}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 2px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{item.q}</span>
            <Icon name="chevron-right" size={14} color={T.muted} style={{ transform: open === i ? "rotate(90deg)" : "none", transition: "transform .15s", flexShrink: 0, marginLeft: 10 }} />
          </button>
          {open === i && <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.55, paddingBottom: 14 }}>{item.a}</div>}
        </div>
      ))}
    </div>
  );
}

function Landing({ onLaunch }) {
  const sample = {
    ...newCV(), templateId: "classic",
    personal: { ...emptyPersonal(), fullName: "Jordan Blake", title: "Product Manager", email: "jordan@email.com" },
    summary: "Results-driven professional with a track record of delivery.",
    experience: [{ id: "x", jobTitle: "Senior PM", company: "Acme Co", startDate: "2021", endDate: "", current: true, description: "Led cross-functional teams." }],
    skills: [{ id: "s1", name: "Strategy" }, { id: "s2", name: "Analytics" }],
  };
  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Arial, sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 24px 60px" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <Logo size={64} />
          </div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 700, color: T.ink, marginBottom: 8 }}>Classic CV Builder</div>
          <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.5 }}>Create a professional CV and personalized cover letter in minutes.</div>
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <div style={{ boxShadow: "0 14px 34px rgba(20,20,25,.14)", borderRadius: 6, overflow: "hidden" }}>
            <CVThumb cv={sample} width={190} />
          </div>
        </div>

        <Button full size="lg" variant="primary" onClick={onLaunch} style={{ marginBottom: 16 }}>
          Open Web App <Icon name="chevron-right" color="#fff" size={16} />
        </Button>
        <TrustIndicators />

        <Section>
          <SectionTitle>Why Classic CV Builder</SectionTitle>
          <FeatureGrid />
        </Section>

        <Section>
          <SectionTitle>How It Works</SectionTitle>
          <HowItWorks />
        </Section>

        <Section>
          <SectionTitle>What People Say</SectionTitle>
          <Testimonials />
        </Section>

        <Section>
          <SectionTitle>Frequently Asked Questions</SectionTitle>
          <FAQAccordion />
        </Section>

        <Section style={{ marginTop: 44 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12, textAlign: "center" }}>
            Or Download for Android
          </div>
          <DownloadButton item={DOWNLOAD_LINKS.apk} />
          <DownloadButton item={DOWNLOAD_LINKS.amazon} />
          <DownloadButton item={DOWNLOAD_LINKS.samsung} />
          <DownloadButton item={DOWNLOAD_LINKS.huawei} />
        </Section>

        <div style={{ fontSize: 11.5, color: T.muted, textAlign: "center", marginTop: 26, lineHeight: 1.5 }}>
          No Google Play account needed for any of the options above.
        </div>

        <div style={{ marginTop: 46, paddingTop: 22, borderTop: `1px solid ${T.hair2}`, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: T.muted }}>&copy; {new Date().getFullYear()} Classic CV Builder</div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => (window.location.hash === "#/app" ? "app" : "landing"));
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash === "#/app" ? "app" : "landing");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState({ cvs: [], letters: [], onboarded: false });
  const [tab, setTab] = useState("home");
  const [view, setView] = useState({ name: "home" });
  const [toastMsg, setToastMsg] = useState("");
  const [confirmTarget, setConfirmTarget] = useState(null);

  // --- Session (backend auth) ---
  const [apiBase, setApiBase] = useState("");
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const isAuthed = !!(token && user);

  // --- Theme (light/dark) ---
  const [themeMode, setThemeMode] = useState("light");
  const handleToggleTheme = useCallback(() => {
    setThemeMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyThemeMode(next);
      setStoredValue("theme-pref", next);
      return next;
    });
  }, []);

  const toast = useCallback((msg) => { setToastMsg(msg); clearTimeout(window.__cvToastTimer); window.__cvToastTimer = setTimeout(() => setToastMsg(""), 2400); }, []);

  // Boot sequence: load local data first (guest fallback is always ready
  // instantly), then check for a saved server URL + token and try to
  // resume a session — if that succeeds, pull documents from the backend
  // instead and treat that as the source of truth.
  useEffect(() => {
    (async () => {
      const [localData, savedBase, savedToken, savedTheme] = await Promise.all([
        loadData(), getStoredValue("api-base-url"), getStoredValue("auth-token"), getStoredValue("theme-pref"),
      ]);
      setData(localData);
      if (savedTheme === "dark") {
        setThemeMode("dark");
        applyThemeMode("dark");
      }
      const base = savedBase || "";
      setApiBase(base);
      if (base && savedToken) {
        try {
          const me = await apiFetch(base, savedToken, "/auth/me");
          const docs = await serverListDocuments(base, savedToken);
          setToken(savedToken);
          setUser(me);
          setData((prev) => ({
            ...prev,
            cvs: docs.filter((d) => d.kind === "cv"),
            letters: docs.filter((d) => d.kind === "letter"),
          }));
        } catch (e) {
          await setStoredValue("auth-token", null); // token expired/invalid — fall back to guest
        }
      }
      setReady(true);
    })();
  }, []);

  const session = { isAuthed, apiBase, token, user };

  const handleAuthed = useCallback(async (newToken) => {
    await setStoredValue("auth-token", newToken);
    setToken(newToken);
    const me = await apiFetch(apiBase, newToken, "/auth/me");
    setUser(me);
    try {
      const docs = await serverListDocuments(apiBase, newToken);
      setData((prev) => ({ ...prev, cvs: docs.filter((d) => d.kind === "cv"), letters: docs.filter((d) => d.kind === "letter") }));
      toast(`Signed in as ${me.email}`);
    } catch (e) {
      toast("Signed in, but couldn't load your documents.");
    }
  }, [apiBase, toast]);

  const handleSignOut = useCallback(async () => {
    await setStoredValue("auth-token", null);
    setToken(null);
    setUser(null);
    const localData = await loadData();
    setData(localData);
    toast("Signed out. Back to local mode.");
  }, [toast]);

  const handleSaveServerUrl = useCallback(async (url) => {
    await setStoredValue("api-base-url", url);
    setApiBase(url);
    setServerModalOpen(false);
    toast(url ? "Server URL saved." : "Server URL cleared.");
  }, [toast]);

  const handleUpgrade = useCallback(async () => {
    if (!isAuthed) { setAuthModalOpen(true); toast("Sign in first, then choose a plan."); return; }
    try {
      const res = await apiFetch(apiBase, token, "/billing/stripe/create-checkout-session", { method: "POST" });
      if (res?.checkout_url) window.open(res.checkout_url, "_blank");
    } catch (e) {
      toast(e.message || "Couldn't start checkout.");
    }
  }, [isAuthed, apiBase, token, toast]);

  // persistUpsert / persistDelete branch on session: authenticated users
  // read/write the backend (source of truth, synced across devices);
  // guests keep the original local localStorage behavior unchanged.
  const persistUpsert = useCallback(async (doc) => {
    if (isAuthed) {
      const saved = await serverUpsertDocument(apiBase, token, doc);
      setData((prev) => {
        const key = saved.kind === "cv" ? "cvs" : "letters";
        const withoutOld = prev[key].filter((d) => d.id !== doc.id && d.id !== saved.id);
        return { ...prev, [key]: [...withoutOld, saved] };
      });
      return saved;
    }
    setData((prev) => {
      const key = doc.kind === "cv" ? "cvs" : "letters";
      const exists = prev[key].some((d) => d.id === doc.id);
      const list = exists ? prev[key].map((d) => (d.id === doc.id ? doc : d)) : [...prev[key], doc];
      const next = { ...prev, [key]: list };
      saveData(next);
      return next;
    });
    return doc;
  }, [isAuthed, apiBase, token]);

  const persistDelete = useCallback(async (doc) => {
    try {
      if (isAuthed) await serverDeleteDocument(apiBase, token, doc);
      setData((prev) => {
        const key = doc.kind === "cv" ? "cvs" : "letters";
        const next = { ...prev, [key]: prev[key].filter((d) => d.id !== doc.id) };
        if (!isAuthed) saveData(next);
        return next;
      });
      toast("Deleted.");
    } catch (e) {
      toast(e.message || "Couldn't delete that document.");
    } finally {
      setConfirmTarget(null);
    }
  }, [isAuthed, apiBase, token, toast]);

  const go = (name, params = {}) => setView({ name, ...params });

  const handleEdit = (doc) => {
    if (doc.kind === "cv") go("wizard", { cv: doc });
    else go("letterPreview", { letter: doc });
  };
  const handleDuplicate = async (doc) => {
    const copy = { ...doc, id: uid(), _serverId: undefined, name: doc.name + " (Copy)", createdAt: now(), lastEdited: now() };
    try {
      await persistUpsert(copy);
      toast("Duplicated.");
    } catch (e) {
      toast(e.message || "Couldn't duplicate that document.");
    }
  };
  const handleDeleteRequest = (doc) => setConfirmTarget(doc);

  const finishOnboarding = () => {
    const next = { ...data, onboarded: true };
    setData(next);
    if (!isAuthed) saveData(next);
  };

  if (route === "landing") {
    return <Landing onLaunch={() => { window.location.hash = "#/app"; setRoute("app"); }} />;
  }

  if (!ready) {
    return (
      <div style={shellStyle}>
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.muted, fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  if (!data.onboarded) {
    return (
      <div style={shellStyle}>
        <Onboarding onDone={finishOnboarding} />
      </div>
    );
  }

  let content;
  if (view.name === "templates") {
    content = <TemplatePicker onBack={() => go("home")} onPick={(templateId) => { const cv = newCV(); cv.templateId = templateId; go("wizard", { cv }); }} />;
  } else if (view.name === "wizard") {
    content = (
      <CVWizard
        initial={view.cv}
        toast={toast}
        onExit={async (cv) => { go("home"); setTab("home"); }}
        onSave={(cv) => persistUpsert(cv)}
        onPreview={(cv) => go("preview", { cv })}
      />
    );
  } else if (view.name === "preview") {
    content = (
      <CVPreview
        cv={view.cv}
        toast={toast}
        onBack={() => { go("home"); setTab("home"); }}
        onEdit={() => go("wizard", { cv: view.cv })}
        onChangeTemplate={() => go("templates")}
      />
    );
  } else if (view.name === "letterForm") {
    content = (
      <LetterForm
        initial={view.letter}
        toast={toast}
        onExit={async (letter) => { try { await persistUpsert(letter); } catch (e) { toast(e.message || "Couldn't save."); } go("home"); setTab("home"); }}
        onSave={(letter) => persistUpsert(letter)}
        onGenerate={(letter) => go("letterPreview", { letter })}
      />
    );
  } else if (view.name === "letterPreview") {
    content = (
      <LetterPreview
        letter={view.letter}
        toast={toast}
        onBack={() => { go("home"); setTab("home"); }}
        onEdit={() => go("letterForm", { letter: view.letter })}
        onRegenerate={() => go("letterForm", { letter: view.letter })}
        onSave={async (letter) => { try { const saved = await persistUpsert(letter); setView({ name: "letterPreview", letter: saved }); } catch (e) { toast(e.message || "Couldn't save."); } }}
      />
    );
  } else if (tab === "home") {
    content = <Home data={data} go={go} onEdit={handleEdit} onDuplicate={handleDuplicate} onDelete={handleDeleteRequest} />;
  } else if (tab === "create") {
    content = <CreateTab go={go} />;
  } else if (tab === "documents") {
    content = <Documents data={data} initialTab={view.tab} onEdit={handleEdit} onDuplicate={handleDuplicate} onDelete={handleDeleteRequest} />;
  } else if (tab === "profile") {
    content = (
      <Profile
        toast={toast}
        session={session}
        onSignOut={handleSignOut}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenServerSettings={() => setServerModalOpen(true)}
        onUpgrade={handleUpgrade}
        themeMode={themeMode}
        onToggleTheme={handleToggleTheme}
      />
    );
  }

  const showNav = ["home", "create", "documents", "profile"].includes(tab) && !["templates", "wizard", "preview", "letterForm", "letterPreview"].includes(view.name);

  return (
    <SessionContext.Provider value={session}>
      <div style={shellStyle}>
        <style>{`
          * { box-sizing: border-box; }
          input::placeholder, textarea::placeholder { color: #A6A199; }
          select { -webkit-appearance: none; appearance: none; }
          ::-webkit-scrollbar { width: 0px; height: 0px; }
          @media print {
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area { position: absolute; top: 0; left: 0; width: auto !important; height: auto !important; box-shadow: none !important; }
            .print-area > div { transform: none !important; }
            .no-print { display: none !important; }
          }
        `}</style>
        <div style={{ height: "100%", overflowY: "auto" }}>
          {content}
        </div>
        {showNav && <BottomNav tab={tab} setTab={(t) => { setTab(t); setView({ name: t }); }} />}
        <Toast text={toastMsg} />
        <ConfirmDialog
          open={!!confirmTarget}
          title={`Delete "${confirmTarget?.name}"?`}
          text="This will permanently remove the document. This can't be undone."
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => confirmTarget && persistDelete(confirmTarget)}
        />
        <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} session={session} onAuthed={handleAuthed} toast={toast} />
        <ServerSettingsModal open={serverModalOpen} apiBase={apiBase} onClose={() => setServerModalOpen(false)} onSave={handleSaveServerUrl} />
      </div>
    </SessionContext.Provider>
  );
}

const shellStyle = {
  width: "100%", maxWidth: 480, height: "100vh", margin: "0 auto", background: T.paper,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Arial, sans-serif",
  position: "relative", overflow: "hidden", color: T.ink,
};
