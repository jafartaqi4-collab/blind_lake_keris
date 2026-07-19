const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '30mb' })); // raised so admin can attach photos/videos as base64
app.use(express.static(path.join(__dirname, 'public')));

// Folder where admin-uploaded photos/videos are stored (served automatically
// since it's inside /public). Created on first run if missing.
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// The public URL of this site — used to build full links for WhatsApp media
// messages (Meta needs a real https:// link, not a relative path).
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://keris-production.up.railway.app';

const REVIEWS_FILE = path.join(__dirname, 'reviews.json');
function loadReviews(){
  try {
    return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}
function saveReviews(reviews){
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
}

// ---------------------------------------------------------------
// Unanswered questions — now stores FULL lifecycle of each question:
// created -> (optional contact info added) -> answered -> notified
// Nothing is deleted anymore; "answered" flag controls visibility.
// ---------------------------------------------------------------
const QUESTIONS_FILE = path.join(__dirname, 'unanswered.json');

function loadQuestions(){
  try { return JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8')); } catch(e) { return []; }
}
function saveQuestions(list){
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(list.slice(0, 1000), null, 2));
}

// Create a new unanswered-question record. Returns the id.
function logUnanswered(question, sessionId){
  const list = loadQuestions();
  const id = crypto.randomUUID();
  list.unshift({
    id,
    question,
    sessionId: sessionId || null,
    date: new Date().toISOString(),
    answered: false,
    answer: null,
    mediaUrl: null,    // relative path like /uploads/xxxx.jpg, filled in if admin attaches a photo/video
    mediaType: null,   // 'image' or 'video'
    contactMethod: null,   // 'whatsapp' | 'email' | null
    contactValue: null,
    notified: false
  });
  saveQuestions(list);
  return id;
}

// ---- Owner-provided knowledge additions: answers get added to the assistant's brain ----
const KNOWLEDGE_FILE = path.join(__dirname, 'knowledge.json');
function loadKnowledge(){
  try { return JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf-8')); } catch(e) { return []; }
}
function saveKnowledge(list){
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(list, null, 2));
}

// ---- Simple admin protection ----
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme123';
function checkAdmin(req, res, next){
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: wrong or missing admin key' });
  }
  next();
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (RESEND_API_KEY) {
  console.log('Resend alert email is configured — RESEND_API_KEY found.');
} else {
  console.log('RESEND_API_KEY is NOT set — owner email alerts are disabled, only logging will happen.');
}

// ---------------------------------------------------------------
// WhatsApp sender — used to notify a VISITOR back with their answer,
// if they left a WhatsApp number. Two options, tried in this order:
//   1) N8N_WHATSAPP_WEBHOOK — reuses your existing n8n WhatsApp setup
//      (recommended, since Blue Lake Resort's agent already sends
//      WhatsApp messages through n8n with working credentials).
//   2) WHATSAPP_TOKEN + WHATSAPP_PHONE_ID — direct Meta Cloud API,
//      only if you set up your own Meta Business app for this project.
// If neither is configured, sending is skipped (logged only).
// ---------------------------------------------------------------
const N8N_WHATSAPP_WEBHOOK = process.env.N8N_WHATSAPP_WEBHOOK;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

async function sendWhatsAppMessage(phoneNumber, message){
  const cleanNumber = String(phoneNumber).replace(/[^\d]/g, '');

  if (N8N_WHATSAPP_WEBHOOK) {
    try {
      const response = await fetch(N8N_WHATSAPP_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanNumber, message })
      });
      if (!response.ok) {
        console.error('n8n WhatsApp webhook returned an error:', response.status);
      } else {
        console.log('WhatsApp notification sent to visitor via n8n.');
      }
    } catch (err) {
      console.error('Failed to send WhatsApp via n8n:', err.message);
    }
    return;
  }

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.log('WhatsApp not configured (no N8N_WHATSAPP_WEBHOOK or WHATSAPP_TOKEN/WHATSAPP_PHONE_ID) — skipping visitor notification.');
    return;
  }
  try {
    const response = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'text',
        text: { body: message }
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error('WhatsApp send failed:', errText);
    } else {
      console.log('WhatsApp notification sent to visitor.');
    }
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
  }
}

// Send a photo or video to a visitor's WhatsApp, with an optional caption.
// mediaUrl must be a full public https:// link (we build this from PUBLIC_BASE_URL).
async function sendWhatsAppMedia(phoneNumber, mediaUrl, mediaType, caption){
  const cleanNumber = String(phoneNumber).replace(/[^\d]/g, '');
  const kind = mediaType === 'video' ? 'video' : 'image'; // default to image

  if (N8N_WHATSAPP_WEBHOOK) {
    try {
      const response = await fetch(N8N_WHATSAPP_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanNumber, message: caption, mediaUrl, mediaType: kind })
      });
      if (!response.ok) console.error('n8n WhatsApp webhook (media) returned an error:', response.status);
      else console.log('WhatsApp media notification sent to visitor via n8n.');
    } catch (err) {
      console.error('Failed to send WhatsApp media via n8n:', err.message);
    }
    return;
  }

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.log('WhatsApp not configured — skipping visitor media notification.');
    return;
  }
  try {
    const response = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: kind,
        [kind]: { link: mediaUrl, caption: caption || '' }
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error('WhatsApp media send failed:', errText);
    } else {
      console.log('WhatsApp media notification sent to visitor.');
    }
  } catch (err) {
    console.error('WhatsApp media send error:', err.message);
  }
}

// Notify the owner by email that a new question needs an answer (unchanged behavior)
async function alertOwner(question){
  if (!RESEND_API_KEY) {
    console.log('Skipped sending email (no Resend key configured). Question logged:', question);
    return;
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Blind Lake Keris Assistant <onboarding@resend.dev>',
        to: 'blindlakekeris@gmail.com',
        subject: '🔔 Blind Lake Keris Assistant — new question needs an answer',
        html: `<p>A visitor asked something the assistant couldn't answer:</p><p>"${question}"</p><p>Please open the admin panel to add this info so the assistant can answer next time:</p><p>${process.env.ADMIN_PANEL_URL || '(open /admin.html on your site)'}</p>`
      })
    });
    const rawText = await response.text();
    try {
      const result = JSON.parse(rawText);
      console.log('Owner alert email result:', result.id ? 'sent successfully' : result.message);
    } catch (parseErr) {
      console.error('Resend did not return JSON. Raw response:', rawText.slice(0, 300));
    }
  } catch (err) {
    console.error('Failed to send owner alert email:', err.message);
  }
}

// Notify the VISITOR back once their question is answered
async function notifyVisitor(record){
  const message = `السلام علیکم!\n\nآپ نے بلائنڈ لیک کیرس اسسٹنٹ سے پوچھا تھا:\n"${record.question}"\n\nجواب:\n${record.answer}\n\nشکریہ - بلائنڈ لیک کیرس`;

  if (record.contactMethod === 'whatsapp' && record.contactValue) {
    if (record.mediaUrl) {
      const fullMediaUrl = record.mediaUrl.startsWith('http') ? record.mediaUrl : `${PUBLIC_BASE_URL}${record.mediaUrl}`;
      await sendWhatsAppMedia(record.contactValue, fullMediaUrl, record.mediaType, message);
    } else {
      await sendWhatsAppMessage(record.contactValue, message);
    }
  }

  if (record.contactMethod === 'email' && record.contactValue && RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'Blind Lake Keris <onboarding@resend.dev>',
          to: record.contactValue,
          subject: 'آپ کے سوال کا جواب - بلائنڈ لیک کیرس',
          html: `<p>${message.replace(/\n/g, '<br>')}</p>`
        })
      });
    } catch (err) {
      console.error('Visitor email notification failed:', err.message);
    }
  }
}

// ---- Admin: upload a photo/video to attach to an answer ----
// Accepts { filename, dataBase64, mimeType } and returns the saved relative URL.
app.post('/api/upload', checkAdmin, (req, res) => {
  try {
    const { filename, dataBase64, mimeType } = req.body;
    if (!dataBase64 || !mimeType) {
      return res.status(400).json({ error: 'dataBase64 and mimeType are required' });
    }
    const isImage = mimeType.startsWith('image/');
    const isVideo = mimeType.startsWith('video/');
    if (!isImage && !isVideo) {
      return res.status(400).json({ error: 'Only image or video files are allowed' });
    }
    const ext = (filename && filename.includes('.')) ? filename.split('.').pop().slice(0, 5) : (isImage ? 'jpg' : 'mp4');
    const safeName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(filePath, Buffer.from(dataBase64, 'base64'));
    res.json({ success: true, url: `/uploads/${safeName}`, mediaType: isImage ? 'image' : 'video' });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ---- Admin API: view + answer unanswered questions ----
app.get('/api/unanswered', checkAdmin, (req, res) => {
  const list = loadQuestions().filter(q => !q.answered);
  res.json({ questions: list });
});

app.get('/api/knowledge', checkAdmin, (req, res) => {
  res.json({ knowledge: loadKnowledge() });
});

// Answer a specific question BY ID: adds it to knowledge, marks it answered,
// and notifies the visitor back (WhatsApp/email) if they left contact info.
app.post('/api/answer-question', checkAdmin, async (req, res) => {
  const { id, question, answer, mediaUrl, mediaType } = req.body;
  if (!answer || (!id && !question)) {
    return res.status(400).json({ error: 'answer and (id or question) are required' });
  }

  // Always add to knowledge so the assistant learns it
  const knowledge = loadKnowledge();
  knowledge.unshift({ question: question || '', answer, date: new Date().toISOString() });
  saveKnowledge(knowledge);

  // Find and update the matching record
  const list = loadQuestions();
  const record = id
    ? list.find(q => q.id === id)
    : list.find(q => q.question === question && !q.answered);

  if (record) {
    record.answer = answer;
    record.answered = true;
    if (mediaUrl) {
      record.mediaUrl = mediaUrl;
      record.mediaType = mediaType || 'image';
    }
    saveQuestions(list);
    // Fire and forget — don't block the admin response on notification delivery
    notifyVisitor(record).catch(e => console.error('notifyVisitor error:', e));
  }

  res.json({ success: true });
});

// Dismiss an unanswered question without adding knowledge (by id now, index kept as fallback)
app.delete('/api/unanswered/:id', checkAdmin, (req, res) => {
  const { id } = req.params;
  const list = loadQuestions();
  const idx = list.findIndex(q => q.id === id);
  if (idx !== -1) {
    list[idx].answered = true; // hide from admin list without sending a notification
    saveQuestions(list);
  }
  res.json({ success: true });
});

// Remove a piece of knowledge (in case of a mistake)
app.delete('/api/knowledge/:index', checkAdmin, (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const list = loadKnowledge();
  if (idx >= 0 && idx < list.length) {
    list.splice(idx, 1);
    saveKnowledge(list);
  }
  res.json({ success: true });
});

// ---------------------------------------------------------------
// Visitor-facing endpoints for the two-way notification flow
// ---------------------------------------------------------------

// A visitor optionally leaves contact info for a specific unanswered question
app.post('/api/unanswered/:id/contact', (req, res) => {
  const { id } = req.params;
  const { contactMethod, contactValue } = req.body;
  const list = loadQuestions();
  const record = list.find(q => q.id === id);
  if (!record) {
    return res.status(404).json({ error: 'Question not found' });
  }
  record.contactMethod = contactMethod || null;
  record.contactValue = contactValue || null;
  saveQuestions(list);
  res.json({ success: true });
});

// Polling endpoint — the chat widget calls this every ~15s to see if any
// of ITS OWN questions (matched by sessionId) have been answered since.
app.get('/api/check/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const list = loadQuestions();
  const newAnswers = list.filter(q => q.sessionId === sessionId && q.answered && !q.notified);

  if (newAnswers.length > 0) {
    newAnswers.forEach(q => { q.notified = true; });
    saveQuestions(list);
  }

  res.json({ newAnswers: newAnswers.map(q => ({ id: q.id, question: q.question, answer: q.answer, mediaUrl: q.mediaUrl, mediaType: q.mediaType })) });
});

// Get all visitor reviews
app.get('/api/reviews', (req, res) => {
  res.json({ reviews: loadReviews() });
});

// Submit a new visitor review
app.post('/api/reviews', (req, res) => {
  const { name, rating, comment } = req.body;
  if (!comment || !rating) {
    return res.status(400).json({ error: 'rating and comment are required' });
  }
  const reviews = loadReviews();
  reviews.unshift({
    name: (name || 'Anonymous').slice(0, 60),
    rating: Math.max(1, Math.min(5, Number(rating))),
    comment: String(comment).slice(0, 500),
    date: new Date().toISOString()
  });
  saveReviews(reviews.slice(0, 200)); // keep the most recent 200 reviews
  res.json({ success: true });
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash'; // free-tier model, no credit card required
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

if (!GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY is not set. The assistant will not work until you set it.');
}

const SYSTEM_PROMPT = `You are the official assistant for BLIND LAKE KERIS (also known as Jarba-Tso Keris), a lake destination in the Keris Valley, District Ghanche, Baltistan Division, Gilgit-Baltistan, Pakistan.

Your job: answer visitor questions helpfully, warmly, and ONLY using the facts below. If someone asks something not covered by this information (e.g. hotel bookings you don't have data on, weather forecasts, prices not listed, unrelated topics), respond politely that you don't have that information — do not guess or invent details.

Detect the language the visitor is writing in (English, Urdu, or Balti — the local language of Baltistan, usually written using Urdu/Perso-Arabic script locally) and reply in that same language. If they write in Urdu script, reply in Urdu script. If their message uses Balti words or phrasing (even though written in a similar script to Urdu), reply in Balti using the same script. If you are not fully confident in Balti vocabulary for a specific detail, it is better to keep numbers, prices, and place names accurate and simple rather than guessing elaborate Balti phrasing. Keep answers concise and friendly, suited for a chat conversation (short lines and simple lists, avoid long essays).

CRITICAL — script consistency for voice output: your replies are read aloud by a text-to-speech engine, so never mix English/Latin letters into an Urdu or Balti reply — switching scripts mid-sentence causes the voice to mispronounce words badly. When responding in Urdu or Balti, always write place names fully in Urdu script, consistently, using these exact transliterations:
- "Blind Lake Keris" → بلائنڈ لیک کیرس
- "Jarba-Tso Keris" → جربا تسو کیرس
- "Chhomdo Bridge" → چھومڈو بل
- "Wooden Suspension Bridge Keris" → کیرس کا لکڑی کا معلق پل
- "Skardu" → سکردو , "Kharmang" → خرمنگ , "Ghanche" → غانچی
- "Keris-Gone Road" → کیرس گونے روڈ , "Skardu-Saichen Road" → سکردو سائچن روڈ

Never leave these names in English letters inside an Urdu/Balti reply.

=== ABOUT BLIND LAKE KERIS ===
Blind Lake (Jarba-Tso Keris) is a hidden gem in the Keris Valley of District Ghanche, Baltistan Division, Gilgit-Baltistan, Pakistan. It sits about 10 minutes from the meeting point of three districts (Skardu, Kharmang, and Ghanche) and two rivers (the Indus and the Shyok River). It is close to the well-known tourist landmark and gateway of District Ghanche: Chhomdo Bridge and checkpoint (map: https://maps.app.goo.gl/z1VCot5hsWT9UAr59).

It is also about 5 minutes from the famous Wooden Suspension Bridge Keris, which is connected to the Skardu-Saichen Road. After crossing the wooden bridge, it is located on the right side of the Keris-Gone Road, 3 minutes further ahead.

The lake is known for crystal-clear turquoise waters, stunning mountain scenery, and views of the Shyok River.

Location (Google Maps): https://maps.google.com/?cid=13215773951354627006&entry=gps

Blind Lake is a popular destination especially in summer, when visitors enjoy swimming, boating, fishing, hiking, camping, and photography. In the winter the lake is often snow- and ice-covered but remains accessible for ice skating, snowshoeing, and cross-country skiing. It suits both an adventurous summer getaway and a peaceful winter retreat.

=== SERVICES ===
1. Swimming
2. Boating
3. Fishing
4. Camping
5. Bridal / Special Wedding Photography

=== TICKET CATEGORIES ===
There are four main ticketing categories: Swimming, Boating, Fishing, and Visiting/Photography.

--- Swimming Tickets ---
- Swimmers (normal ticket): Rs. 100
- Non-swimmers who still want to swim: normal fee PLUS Rs. 50 extra for a swimming jacket (life jacket)

--- Boating Tickets (3 types) ---
- Family boat (large boat, holds 6-8 people): Rs. 1200
- Normal pedal boat (holds up to 3 people): Rs. 500
- Kayak (for adventure activity, 1 person): Rs. 500

--- Fishing Tickets (3 methods) ---
- At the designated fishing point, billed hourly (customer sets the duration): Rs. 2000 per hour
- Fishing anywhere else in the lake outside the fishing point (per angling session): Rs. 3000
- Boating + fishing combined (fishing done from a boat): Rs. 5000 per hour

--- Visiting / Photography Tickets ---
- Normal visitor ticket: Rs. 150 (a small discount is available for families and young children)
- Note: visitor ticket holders must pay additional charges if they also want to do swimming or any other activity — the visiting ticket alone does not cover other activities.

=== FOOD & BEVERAGES ===
- Fresh fruit juices
- Chai with Samosa / chips / Zarchung
- Namkin Chai with Azoq
- Fish fry
- Chicken Karahi / Qorma
- Special Biryani
- Prapu

=== CONTACT INFORMATION ===
Phone numbers:
- 0312-9906261
- 0312-8112401
- 0355-5772573
- 0355-4226326
Email: blindlakekeris@gmail.com

Opening Hours:
- Saturday to Thursday: 9:00 AM to 7:00 PM
- Friday: 2:00 PM to 8:00 PM

=== TICKETING STAFF ===
The following young men handle ticketing at Blind Lake Keris after school:
- Hasnain Ali
- Zain Ali
- Javed Naqvi
If a visitor asks who issues tickets or who is at the ticket counter, you can mention these names.

=== RULES FOR YOU ===
- Never invent prices, timings, hotel info, contact numbers, or any detail not listed above.
- If asked something outside this knowledge (e.g. exact opening hours, phone numbers, accommodation, weather, transport fares to reach the valley from a city), say clearly that this information is not available and, where sensible, suggest they can ask a local host or check on arrival.
- Be warm, welcoming, and proud of the destination, like a local guide — but always factually accurate to the data above.
- LOCATION / DIRECTIONS QUESTIONS: if a visitor asks how to reach Blind Lake Keris, a specific landmark, or any exact route/directions that you cannot answer clearly and confidently from the facts above, do NOT just say the information is unavailable. Instead, warmly offer them three ways to get real help finding the place: (1) you can send them the exact Google Maps location, (2) they can contact us on WhatsApp for live directions, (3) someone can guide them online/by phone step by step as they travel. Ask which option they would prefer. Keep this offer short and natural, in the same language as their question.
- Keep replies concise only; never use markdown formatting. Do not use asterisks (*), hashes (#), or underscores for emphasis or bullets. For lists, start each line with the bullet character "•" followed by a space (not an asterisk).
- IMPORTANT — plain text only: never use markdown formatting. Do not use asterisks (*), hashes (#), or underscores for emphasis or bullets. For lists, start each line with the bullet character "•" followed by a space (not an asterisk).
- FLAGGING UNANSWERED QUESTIONS: if the visitor asks something specifically about Blind Lake Keris itself (its facilities, prices, policies, accommodation, staff, rules, etc.) that is NOT covered in the facts above, after your honest visible answer, add one extra line at the very end in this exact hidden format: ||UNANSWERED: <the visitor's question in a few words>|| — this line is for internal system use only, and will never be seen by the visitor. It flags that information is unavailable about Blind Lake Keris specifically. Do NOT add this marker for general knowledge questions unrelated to Blind Lake Keris (e.g. "what is the capital of Pakistan"), only for Blind-Lake-Keris-specific gaps.`;

// Convert our simple {role: 'user'|'assistant', content: text} history below
// into the format Gemini's API expects: {role: 'user'|'model', parts:[{text}]}
function toGeminiContents(messages) {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
}

// Build the final system prompt, including any owner-added knowledge
function buildFullSystemPrompt() {
  const extra = loadKnowledge();
  if (!extra.length) return SYSTEM_PROMPT;
  const extraText = extra.map(k => `Q: ${k.question}\nA: ${k.answer}`).join('\n\n');
  return `${SYSTEM_PROMPT}\n\n=== ADDITIONAL INFO ADDED BY THE OWNER (treat this as equally trustworthy fact) ===\n${extraText}`;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, sessionId } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildFullSystemPrompt() }] },
        contents: toGeminiContents(messages),
        generationConfig: { maxOutputTokens: 800 }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', data);
      return res.status(500).json({ error: 'Failed to get a response from the assistant.' });
    }

    let reply = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '';

    // Detect the hidden "unanswered question" marker, log it, alert the owner,
    // and hand back an id so the frontend can offer a "notify me back" prompt.
    let unansweredId = null;
    const unansweredMatch = reply.match(/\|\|UNANSWERED:\s*(.+?)\|\|/);
    if (unansweredMatch) {
      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
      const questionText = lastUserMessage ? lastUserMessage.content : unansweredMatch[1];
      unansweredId = logUnanswered(questionText, sessionId || null);
      await alertOwner(questionText);
      reply = reply.replace(/\|\|UNANSWERED:.*?\|\|/g, '').trim();
    }

    // Safety cleanup: strip markdown even if the model slips into it anyway
    reply = reply
      .replace(/\*\*(.*?)\*\*/g, '$1')      // remove bold **text**
      .replace(/^\s*\*\s*/gm, '• ')          // turn * item bullets into • item
      .replace(/(?<!\*)\*(?!\*)\s*/g, ' ')   // remove any stray asterisks used as bullets mid-text

    res.json({ reply, unanswered: !!unansweredId, unansweredId });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Failed to get a response from the assistant.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Blind Lake Keris assistant (Gemini, free tier) running at http://localhost:${PORT}`);
});
