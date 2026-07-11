const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// ---- Unanswered-question alerts: log + email the owner immediately ----
const UNANSWERED_FILE = path.join(__dirname, 'unanswered.json');
function logUnanswered(question){
  let list = [];
  try { list = JSON.parse(fs.readFileSync(UNANSWERED_FILE, 'utf-8')); } catch(e) {}
  list.unshift({ question, date: new Date().toISOString() });
  fs.writeFileSync(UNANSWERED_FILE, JSON.stringify(list.slice(0, 300), null, 2));
}

let mailTransporter = null;
if (process.env.GMAIL_APP_PASSWORD) {
  console.log('Gmail alert email is configured — GMAIL_APP_PASSWORD found.');
  mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'blindlakekeris@gmail.com',
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
} else {
  console.log('GMAIL_APP_PASSWORD is NOT set — owner email alerts are disabled, only logging will happen.');
}

async function alertOwner(question){
  logUnanswered(question);
  if (!mailTransporter) {
    console.log('Skipped sending email (no mail transporter configured). Question logged:', question);
    return;
  }
  try {
    const info = await mailTransporter.sendMail({
      from: 'blindlakekeris@gmail.com',
      to: 'blindlakekeris@gmail.com',
      subject: '🔔 Blind Lake Keris Assistant — new question needs an answer',
      text: `A visitor asked something the assistant couldn't answer:\n\n"${question}"\n\nPlease add this info to the assistant's knowledge so it can answer next time.`
    });
    console.log('Owner alert email sent successfully:', info.messageId);
  } catch (err) {
    console.error('Failed to send owner alert email:', err.message);
  }
}

app.get('/api/unanswered', (req, res) => {
  try {
    res.json({ questions: JSON.parse(fs.readFileSync(UNANSWERED_FILE, 'utf-8')) });
  } catch(e) {
    res.json({ questions: [] });
  }
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

Detect the language the visitor is writing in (English, Urdu, or Balti — the local language of Baltistan, usually written using Urdu/Perso-Arabic script locally) and reply in that same language. If they write in Urdu script, reply in Urdu script. If their message uses Balti words or phrasing (even though written in a similar script to Urdu), reply in Balti using the same script. If you are not fully confident in Balti vocabulary for a specific detail, it is better to keep numbers, prices, and place names accurate and simple rather than guessing elaborate Balti phrasing. Keep answers concise and friendly, suited for a chat conversation (short paragraphs, use line breaks and simple lists, avoid long essays).

CRITICAL — script consistency for voice output: your replies are read aloud by a text-to-speech engine, so never mix English/Latin letters into an Urdu or Balti reply — switching scripts mid-sentence causes the voice to mispronounce words badly. When responding in Urdu or Balti, always write place names fully in Urdu script, consistently, using these exact transliterations:
- "Blind Lake Keris" → بلائنڈ لیک کیرس
- "Jarba-Tso Keris" → جربا تسو کیرس
- "Chhomdo Bridge" → چھومڈو پل
- "Wooden Suspension Bridge Keris" → کیرس کا لکڑی کا معلق پل
- "Skardu" → سکردو , "Kharmang" → خرمنگ , "Ghanche" → غانچے
- "Keris-Gone Road" → کیرس گونے روڈ , "Skardu-Saichen Road" → سکردو سائچن روڈ
Never leave these names in English letters inside an Urdu/Balti reply.

=== ABOUT BLIND LAKE KERIS ===
Blind Lake (Jarba-Tso Keris) is a hidden gem in the Keris Valley of District Ghanche, Baltistan Division, Gilgit-Baltistan, Pakistan. It sits about 10 minutes from the meeting point of three districts (Skardu, Kharmang, Ghanche) and two rivers (the Indus River and the Shyok River). It is close to the well-known tourist landmark and gateway of District Ghanche: Chhomdo Bridge and checkpoint (map: https://maps.app.goo.gl/z1VCot5hsWT9UAr59).

It is also about 5 minutes from the famous Wooden Suspension Bridge Keris, which is connected to the Skardu-Saichen Road — after crossing the wooden bridge, it is located on the right side of the Keris-Gone Road, 3 minutes further ahead.

The lake is known for crystal-clear turquoise waters, stunning mountain scenery, and views of the Shyok River.

Location (Google Maps): https://maps.google.com/?cid=13215773951354627006&entry=gps

Blind Lake is a popular destination especially in summer, when visitors enjoy swimming, boating, fishing, hiking, camping, and photography. In winter the lake is often snow- and ice-covered but remains accessible for ice skating, snowshoeing, and cross-country skiing. It suits both an adventurous summer getaway and a peaceful winter retreat.

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
- Family boat (large boat, holds 6–8 people): Rs. 1200
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
- Keep replies concise, using short lines or simple bullet points for ticket lists.
- IMPORTANT — plain text only: never use markdown formatting. Do not use asterisks (*), hashes (#), or underscores for emphasis or bullets. For lists, start each line with the bullet character "•" followed by a space (not an asterisk).
- FLAGGING UNANSWERED QUESTIONS: if the visitor asks something specifically about Blind Lake Keris itself (its facilities, prices, policies, accommodation, staff, rules, etc.) that is NOT covered in the facts above, after your honest visible answer, add one extra line at the very end in this exact hidden format: ||UNANSWERED: <the visitor's question in a few words>|| — this line is for internal system use only, the visitor will never see it, so always include it whenever you say information is unavailable about Blind Lake Keris specifically. Do NOT add this marker for general knowledge questions unrelated to Blind Lake Keris (e.g. "what is the capital of Pakistan"), only for Blind-Lake-Keris-specific gaps.`;

// Convert our simple {role: 'user'|'assistant', content: text} history
// into the format Gemini's API expects: {role: 'user'|'model', parts:[{text}]}
function toGeminiContents(messages) {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
}

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
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

    // Detect the hidden "unanswered question" marker and alert the owner
    const unansweredMatch = reply.match(/\|\|UNANSWERED:\s*(.+?)\|\|/);
    if (unansweredMatch) {
      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
      await alertOwner(lastUserMessage ? lastUserMessage.content : unansweredMatch[1]);
      reply = reply.replace(/\|\|UNANSWERED:.*?\|\|/g, '').trim();
    }

    // Safety cleanup: strip markdown even if the model slips into it anyway
    reply = reply
      .replace(/\*\*(.*?)\*\*/g, '$1')      // remove bold **text**
      .replace(/^\s*\*\s+/gm, '• ')          // turn "* item" bullets into "• item"
      .replace(/(?<!^)\s\*\s/g, ' ');        // remove any stray asterisks used as bullets mid-text
    res.json({ reply });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Failed to get a response from the assistant.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Blind Lake Keris assistant (Gemini, free tier) running at http://localhost:${PORT}`);
});
