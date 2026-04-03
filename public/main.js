import { AudioPlayer } from "/lib/AudioPlayer.js";

const socket = io();

const pillStatus = document.getElementById("pill-status");
const pillOutput = document.getElementById("pill-output");
const btnStart = document.getElementById("btn-start");
const btnPause = document.getElementById("btn-pause");
const btnEnd = document.getElementById("btn-end");
const drawer = document.getElementById("drawer");
const chatEl = document.getElementById("chat");
const toolsEl = document.getElementById("tools");
const filesEl = document.getElementById("files");
const modelIdEl = document.getElementById("model-id");
const modelCostEl = document.getElementById("model-cost");
const modelMetaEl = document.getElementById("model-meta");

const STATUS_COLORS = {
  neutral: "var(--muted)",
  good: "var(--good)",
  bad: "var(--bad)",
};

function setStatus(text, tone="neutral"){
  if (!pillStatus) return;
  pillStatus.textContent = text || "";
  const c = STATUS_COLORS[tone] || STATUS_COLORS.neutral;
  try { pillStatus.style.color = c; } catch {}
}

function roleLabel(role){
  if (role === "assistant") return "Sonic";
  if (role === "user") return "You";
  return "System";
}

function addMsg(role, text){
  if (!chatEl) return;
  const msg = document.createElement("div");
  const cls = (role === "assistant" || role === "user" || role === "system") ? role : "system";
  msg.className = `msg ${cls}`;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = roleLabel(cls);
  msg.appendChild(meta);

  const body = document.createElement("div");
  body.className = "body";
  body.textContent = String(text ?? "");
  msg.appendChild(body);

  chatEl.appendChild(msg);
  chatEl.scrollTop = chatEl.scrollHeight;
}

let audioContext;
let audioStream;
let processor;
let sourceNode;
let isStreaming = false;
let isPaused = false;
let sessionInitialized = false;
let samplingRatio = 1;
const TARGET_SAMPLE_RATE = 16000;
const isFirefox = navigator.userAgent.toLowerCase().includes("firefox");
const audioPlayer = new AudioPlayer();

// When the user speaks, we barge-in (flush) any queued assistant audio and temporarily duck playback.
let userSpeakingUntil = 0;
let userWasSpeaking = false;
function rms(samples){
  let sum = 0;
  for (let i=0; i<samples.length; i++) sum += samples[i]*samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}


let role = null;
let displayAssistantText = true;

// --- Text de-duplication (Option A): buffer per contentName, render once on contentEnd ---
let activeTextContentName = null;
let activeTextRole = null;
let activeTextStage = "FINAL"; // SPECULATIVE | FINAL
const textBuffers = new Map(); // contentName -> { role, stage, text }

function safeParseAdditionalModelFields(s){
  if (!s || typeof s !== "string") return null;
  try { return JSON.parse(s); } catch { return null; }
}

function maybeHandleControlJson(text){
  const t = (text || "").trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return false;
  try {
    const obj = JSON.parse(t);
    if (obj && obj.interrupted === true) {
      // Client-side barge-in to stop any queued assistant audio
      try { audioPlayer.bargeIn(); } catch {}
      return true;
    }
  } catch {}
  return false;
}

const SYSTEM_PROMPT = `You are "Sonic": an expert staff-level software engineer and system architect embedded with the user in a greenfield project kickoff.

You are conducting a *spoken* requirements conversation and translating it into **Kiro steering files**.

## What steering is (Kiro context)
Steering gives Kiro persistent knowledge about a workspace through Markdown files, so it can consistently follow established patterns, libraries, and standards without repeating context each chat.
Workspace steering files live under ".kiro/steering/" at the repo root (Kiro also supports global steering in "~/.kiro/steering/").

Steering files are plain Markdown and can optionally include YAML front matter at the very top to control inclusion:
- inclusion: always (default) — loaded into every interaction
- inclusion: fileMatch — auto-load only for matching paths
- inclusion: manual — included only when referenced

## Foundational steering files (exactly 3)
In this project we maintain exactly three foundational files in ".kiro/steering/":
1) "product.md" — product purpose, users, scope, constraints, non-goals, success metrics, glossary.
2) "tech.md" — stack decisions and engineering guidance (frontend/backend/auth/data/ops/testing/security).
3) "structure.md" — repo organization, naming/import conventions, architectural patterns, testing approach.

Update these incrementally as the conversation progresses. Do not create extra steering files.

## Conversation style (voice-first)
- Speak naturally and briefly: 1–2 short sentences, then ask ONE targeted question.
- Never ask a “question-barrage”. Go one-by-one.
- If the user changes their mind, acknowledge briefly and update only the relevant section(s) of the steering file(s).
- When confirming, use short terms like “Got it.” / “Sounds good.” / “Noted.” / “Let’s go with that.”

## Expert expansion (be prescriptive and useful)
If the user says something brief, you MUST expand it into practical engineering guidance - but ONLY that area (eg. frontend), and not pre-fill other unrelated areas (eg. auth) in the steering file:
- what it is and why it fits,
- key conventions (project layout, styling/theming, routing patterns, state mgmt),
- what to avoid / common pitfalls,
- AWS-friendly considerations (deployment, auth, storage, observability),
- and what you will record in the steering file.

If the user doesn’t specify versions, recommend sensible defaults (e.g., “current LTS” for runtimes, “latest stable” for libraries), then ask the user to confirm, and record them in the appropriate steering file. Besides recommending things back to the user, also expand on them in the steering files, where you will record these.

## State + open questions (internal)
Maintain an internal question bank of unresolved decisions. Do NOT write open/resolved question lists into steering files.
Ask one precise follow-up at a time. If a decision remains open, keep it internally and revisit it at the end.

When the user updates a prior decision (e.g., switching frameworks), make a targeted change to the relevant section(s) of the steering file(s) without rewriting unrelated content.

## Tools you can use
You have tools that can:
- update "product.md", "tech.md", and "structure.md" (merge/patch sections),
- track unresolved questions in internal state,
- compute diffs for the UI.

Only explain tools if the user explicitly asks “what can you do?” or “what tools do you have?”

## Output quality (aim for ‘auto-generated by Kiro’ level of detail)
Write steering content with:
- clear headings,
- concise bullets,
- concrete recommendations and conventions,
- enough detail that an autonomous AI agent can implement features without asking basic questions.

### Mini examples (few-shot shape; adapt, don’t copy blindly)
product.md:
- One-liner
- Target users
- MVP journeys
- Scope / non-goals
- Success metrics
- Glossary

tech.md:
- Frontend: framework + UI system (Tailwind + shadcn/ui), patterns
- Backend: framework, API style, validation, error handling
- Auth: approach, sessions/tokens, RBAC
- Data/storage: DB + object storage + migrations
- Observability: logs/metrics/traces, structured logging
- Security: secrets management, least privilege
- Style: layout structure, component hierarchy, navigation patterns, content organization

structure.md:
- Repo layout
- Naming conventions
- Import conventions
- Architecture patterns (feature folders, boundaries)
- Testing approach (unit/integration/e2e)

Start by asking: What are we building (one sentence), and who is it for?`;
 

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToFloat32Array(base64String) {
  const binaryString = window.atob(base64String);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) float32Array[i] = int16Array[i] / 32768.0;
  return float32Array;
}

async function initMic(){
  setStatus("Requesting mic…");
  audioStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }
  });
  audioContext = isFirefox ? new AudioContext() : new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  samplingRatio = audioContext.sampleRate / TARGET_SAMPLE_RATE;
  await audioPlayer.start();
  setStatus("Ready", "good");
}

async function initializeSession(){
  if (sessionInitialized) return;
  setStatus("Initializing…");
  await new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error("Connection timeout")), 8000);
    socket.emit("initializeConnection", (ack)=>{
      clearTimeout(t);
      if (ack?.success) resolve();
      else reject(new Error(ack?.error || "init failed"));
    });
  });
  socket.emit("promptStart");
  socket.emit("systemPrompt", SYSTEM_PROMPT);
  socket.emit("audioStart");
  sessionInitialized = true;
  setStatus("Live", "good");
}

async function startStreaming(){
  if (isStreaming) return;
  if (!audioContext || !audioStream) await initMic();
  await initializeSession();

  // If Sonic is speaking, stop playback as soon as we go live.
  try { audioPlayer.bargeIn(); } catch {}

  sourceNode = audioContext.createMediaStreamSource(audioStream);
  processor = audioContext.createScriptProcessor(512, 1, 1);
  processor.onaudioprocess = (e) => {
    if (!isStreaming) return;
    if (isPaused) return;

    const inputData = e.inputBuffer.getChannelData(0);

    // Simple VAD: if the mic is hot, stop assistant playback and duck audio.
    const level = rms(inputData);
    const speakingNow = level > 0.02;
    if (speakingNow) {
      userSpeakingUntil = Date.now() + 700;
      if (!userWasSpeaking) {
        userWasSpeaking = true;
        try { audioPlayer.bargeIn(); } catch {}
      }
    } else {
      if (Date.now() > userSpeakingUntil) userWasSpeaking = false;
    }
    const numSamples = Math.round(inputData.length / samplingRatio);
    const pcmData = isFirefox ? new Int16Array(numSamples) : new Int16Array(inputData.length);

    if (isFirefox) {
      for (let i=0; i<numSamples; i++){
        pcmData[i] = Math.max(-1, Math.min(1, inputData[i * samplingRatio])) * 0x7FFF;
      }
    } else {
      for (let i=0; i<inputData.length; i++){
        pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
      }
    }

    const base64Data = arrayBufferToBase64(pcmData.buffer);
    socket.emit("audioInput", base64Data);
  };

  sourceNode.connect(processor);
  processor.connect(audioContext.destination);

  isStreaming = true;
  btnStart.disabled = true;
  btnEnd.disabled = false;
  btnPause.disabled = false;

  addMsg("system", "🎙️ Listening… (Pause mutes the mic)");
}

function stopStreaming(){
  if (!isStreaming) return;
  isStreaming = false;

  try { processor?.disconnect(); } catch {}
  try { sourceNode?.disconnect(); } catch {}

  socket.emit("stopAudio");

  btnStart.disabled = false;
  btnEnd.disabled = true;
  btnPause.disabled = true;
  btnPause.textContent = "Pause";
  isPaused = false;
  sessionInitialized = false;

  audioPlayer.bargeIn();
  setStatus("Ended");
  addMsg("system", "🛑 Session ended.");
}

function togglePause(){
  if (!isStreaming) return;
  isPaused = !isPaused;
  try { socket.emit('pauseState', { paused: isPaused }); } catch (e) { /* ignore */ }

  btnPause.textContent = isPaused ? "Resume" : "Pause";
  setStatus(isPaused ? "Paused (muted)" : "Live", isPaused ? "neutral" : "good");
  addMsg("system", isPaused ? "⏸️ Paused (mic muted)" : "▶️ Resumed");
}

btnStart.addEventListener("click", () => {
  btnStart.disabled = true;
  startStreaming().catch((e)=> {
    console.error("Start failed:", e);
    setStatus("Error starting", "bad");
    const msg = (e && (e.message || e.details)) ? (e.message || e.details) : String(e || "Unknown error");
    addMsg("system", `⚠️ Could not start. ${msg}. Check AWS credentials / Bedrock access, region, and MODEL_ID.`);
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnEnd.disabled = true;
  });
});
btnEnd.addEventListener("click", stopStreaming);
btnPause.addEventListener("click", togglePause);

socket.on("connect", ()=> setStatus("Connected", "good"));
socket.on("disconnect", ()=> { setStatus("Disconnected"); sessionInitialized = false; });


socket.on("serverConfig", (cfg)=> {
  pillOutput.textContent = `Writing: ${cfg.steeringDir}`;
  if (modelIdEl && cfg.modelId) modelIdEl.textContent = cfg.modelId;
  if (modelMetaEl) {
    const parts = [];
    if (cfg.region) parts.push(`Region: ${cfg.region}`);
    modelMetaEl.textContent = parts.join(" · ");
  }
});
// Pricing rates (USD per 1,000 tokens) — estimates based on public references.
// Verify against AWS Bedrock pricing for your region/account.
const RATES = {
  // Amazon Nova 2 Sonic pricing (USD per 1,000 tokens)
  // Speech
  speechIn: 0.003,
  speechOut: 0.012,
  // Text
  textIn: 0.00033,
  textOut: 0.00275,
};

const usageTotals = { speechIn: 0, speechOut: 0, textIn: 0, textOut: 0 };

function extractUsageNumbers(obj){
  if (!obj || typeof obj !== "object") return {};
  // Some implementations may wrap the payload
  const ev = obj.usageEvent || obj;

  // Nova 2 Sonic docs: usageEvent.details.delta.{input,output}.{speechTokens,textTokens}
  const delta = ev?.details?.delta;
  if (delta && typeof delta === "object") {
    const num = (v) => {
      if (typeof v === "number" && !Number.isNaN(v)) return v;
      if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
      return 0;
    };
    return {
      speechIn: num(delta?.input?.speechTokens),
      textIn: num(delta?.input?.textTokens),
      speechOut: num(delta?.output?.speechTokens),
      textOut: num(delta?.output?.textTokens),
    };
  }

  // Fallback: try common flat key variants
  const u = ev.usage || ev;
  const out = {};
  const pickNum = (...keys) => {
    for (const k of keys){
      const v = u?.[k];
      if (typeof v === "number" && !Number.isNaN(v)) return v;
      if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
    }
    return 0;
  };
  out.textIn = pickNum("inputTokens", "inputTextTokens", "textInputTokens", "inputTokenCount", "input_text_tokens");
  out.textOut = pickNum("outputTokens", "outputTextTokens", "textOutputTokens", "outputTokenCount", "output_text_tokens");
  out.speechIn = pickNum("inputAudioTokens", "inputSpeechTokens", "speechInputTokens", "audioInputTokens", "input_speech_tokens");
  out.speechOut = pickNum("outputAudioTokens", "outputSpeechTokens", "speechOutputTokens", "audioOutputTokens", "output_speech_tokens");
  return out;
}

function computeCostUSD(t){
  return (t.speechIn/1000)*RATES.speechIn + (t.speechOut/1000)*RATES.speechOut + (t.textIn/1000)*RATES.textIn + (t.textOut/1000)*RATES.textOut;
}

function renderCost(){
  if (!modelCostEl || !modelMetaEl) return;
  const cost = computeCostUSD(usageTotals);
  modelCostEl.textContent = `$${cost.toFixed(4)}`;
  modelMetaEl.textContent = `Tokens — speech in/out: ${usageTotals.speechIn}/${usageTotals.speechOut} · text in/out: ${usageTotals.textIn}/${usageTotals.textOut}`;
}

socket.on("usageEvent", (data)=> {
  const n = extractUsageNumbers(data);
  usageTotals.speechIn += n.speechIn || 0;
  usageTotals.speechOut += n.speechOut || 0;
  usageTotals.textIn += n.textIn || 0;
  usageTotals.textOut += n.textOut || 0;
  renderCost();
});


socket.on("contentStart", (data)=> {
  if (data.type !== "TEXT") return;

  role = data.role;
  activeTextContentName = data.contentName || null;
  activeTextRole = data.role || null;

  // generationStage is present on assistant text (speculative vs final)
  const extra = safeParseAdditionalModelFields(data.additionalModelFields);
  activeTextStage = (extra && extra.generationStage) ? String(extra.generationStage).toUpperCase() : "FINAL";

  if (activeTextContentName) {
    textBuffers.set(activeTextContentName, { role: activeTextRole, stage: activeTextStage, text: "" });
  }
});

socket.on("textOutput", (data)=> {
  // Buffer text; do not render per-chunk (prevents duplicate bubbles)
  const key = activeTextContentName || "__no_content__";
  const buf = textBuffers.get(key) || { role: activeTextRole || role, stage: activeTextStage, text: "" };
  buf.text += (data.content || "");
  textBuffers.set(key, buf);
});

socket.on("contentEnd", (data)=> {
  if (data.type !== "TEXT") return;

  const key = data.contentName || activeTextContentName || "__no_content__";
  const buf = textBuffers.get(key);
  if (!buf) return;

  // Ignore speculative assistant text; only render FINAL at contentEnd (Option A)
  if ((buf.role || role) === "ASSISTANT" && (buf.stage || "").toUpperCase() === "SPECULATIVE") {
    textBuffers.delete(key);
    return;
  }

  const text = (buf.text || "").trim();
  textBuffers.delete(key);

  if (!text) return;

  // Control messages like {"interrupted": true} should not show in chat.
  if (maybeHandleControlJson(text)) return;

  if ((buf.role || role) === "USER") addMsg("user", text);
  else if ((buf.role || role) === "ASSISTANT") addMsg("assistant", text);
});socket.on("audioOutput", (data)=> {
  if (!data.content) return;
  // If the user is speaking, skip assistant playback to avoid talking over them.
  if (Date.now() < userSpeakingUntil) return;
  try {
    audioPlayer.playAudio(base64ToFloat32Array(data.content));
  } catch {}
});
// --- Tool call UI helpers ---
const toolRuns = []; // {id,name,summary,status,ts}
const toolIdToIdx = new Map();

function toolSummary(name, input){
  const n = String(name || "").toLowerCase();

  const s = (v, max=42) => {
    const t = String(v ?? "").trim();
    if (!t) return "";
    return t.length > max ? (t.slice(0, max) + "…") : t;
  };

  const has = (k) => input && Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined && input[k] !== null;

  try{
    if (n === "checkpoint_steering_files") return "Saved steering files to disk";
    if (n === "set_product_steering") {
      if (has("appOneLiner")) return `Updated one-liner: ${s(input.appOneLiner, 70)}`;
      if (has("targetUsers")) return `Updated target users: ${s(input.targetUsers, 70)}`;
      if (has("mvpFeatures")) return `Updated MVP features (${(input.mvpFeatures || []).length})`;
      return "Updated product steering";
    }
    if (n === "set_tech_steering") {
      const parts = [];
      if (has("frontend")) parts.push(`Front-end: ${s(input.frontend)}`);
      if (has("backend")) parts.push(`Back-end: ${s(input.backend)}`);
      if (has("auth")) parts.push(`Auth: ${s(input.auth)}`);
      if (has("data")) parts.push(`Data: ${s(input.data)}`);
      if (has("iac")) parts.push(`IaC: ${s(input.iac)}`);
      if (has("observability")) parts.push(`Obs: ${s(input.observability)}`);
      if (has("style")) parts.push(`Style: ${s(input.style)}`);
      if (parts.length) return "Updated tech stack — " + parts.join(" · ");
      return "Updated tech steering";
    }
    if (n === "set_structure_steering") {
      const parts = [];
      if (has("repoLayout")) parts.push("Repo layout");
      if (has("codeConventions")) parts.push("Coding conventions");
      if (has("testing")) parts.push("Testing");
      if (has("ci")) parts.push("CI");
      return parts.length ? ("Updated structure — " + parts.join(", ")) : "Updated structure steering";
    }
    if (n === "add_open_question") {
      const q = input?.question || input?.title;
      return q ? ("Added open question: " + s(q, 80)) : "Added open question";
    }
    if (n === "resolve_open_question") {
      const qid = input?.id ? s(input.id, 18) : "";
      return qid ? ("Resolved open question: " + qid) : "Resolved open question";
    }
    if (n === "get_steering_summary") return "Checked what’s missing";
  } catch {}
  return `Ran ${String(name || "tool")}`;
}

function renderTools(){
  if (!toolsEl) return;
  toolsEl.innerHTML = "";
  const last = toolRuns.slice(-25);
  for (const t of last){
    const row = document.createElement("div");
    row.className = "tool-row";
    const left = document.createElement("div");
    left.className = "tool-left";
    left.textContent = t.summary;
    const right = document.createElement("div");
    right.className = "tool-right";
    right.textContent = t.status === "done" ? "✓" : "…";
    row.appendChild(left);
    row.appendChild(right);
    toolsEl.appendChild(row);
  }
}
socket.on("toolUse", (data)=> {
  const toolName = data.toolName || data.name || "tool";
  const toolUseId = data.toolUseId || data.id || `${Date.now()}`;
  let input = null;
  // Some toolUse events include JSON input in `content`
  if (typeof data.content === "string") { try { input = JSON.parse(data.content); } catch {} }
  const summary = toolSummary(toolName, input);
  const entry = { id: toolUseId, name: toolName, summary, status: "running", ts: Date.now() };
  toolIdToIdx.set(toolUseId, toolRuns.length);
  toolRuns.push(entry);
  renderTools();
});

socket.on("toolResult", (data)=> {
  const toolUseId = data.toolUseId || data.id;
  if (toolUseId && toolIdToIdx.has(toolUseId)) {
    toolRuns[toolIdToIdx.get(toolUseId)].status = "done";
  } else {
    toolRuns.push({ id: toolUseId || `${Date.now()}`, name: "toolResult", summary: "Tool finished", status: "done", ts: Date.now() });
  }
  renderTools();
});// Track file update elements for highlighting
const fileUpdateEls = new Map(); // filename -> { el, timeoutId }

socket.on("steeringUpdated", (evt)=> {
  let filename = '';
  
  if (evt.file) {
    filename = evt.file;
  } else if (evt.tool && evt.fields) {
    // Map tool name to filename
    const toolToFile = {
      'set_product_steering': 'product.md',
      'set_tech_steering': 'tech.md',
      'set_structure_steering': 'structure.md'
    };
    filename = toolToFile[evt.tool] || evt.tool;
  }
  
  if (!filename) return;
  
  // Check if we already have an element for this file
  let fileInfo = fileUpdateEls.get(filename);
  
  if (!fileInfo) {
    // Create new file row
    const row = document.createElement("div");
    row.className = "file-row";
    row.textContent = filename;
    filesEl.appendChild(row);
    fileInfo = { el: row, timeoutId: null };
    fileUpdateEls.set(filename, fileInfo);
  }
  
  // Clear any existing timeout
  if (fileInfo.timeoutId) {
    clearTimeout(fileInfo.timeoutId);
  }
  
  // Add highlight class
  fileInfo.el.classList.add("file-updated");
  
  // Remove highlight after 2 seconds
  fileInfo.timeoutId = setTimeout(() => {
    fileInfo.el.classList.remove("file-updated");
    fileInfo.timeoutId = null;
  }, 2000);
});

socket.on("error", (err)=> {
  setStatus("Error", "bad");
  addMsg("system", `⚠️ ${err?.message || err?.details || "Unknown error"}`);
});

btnEnd.disabled = true;
btnPause.disabled = true;
addMsg("system", "Click Start to begin. Nova Sonic will listen and respond with voice.");
