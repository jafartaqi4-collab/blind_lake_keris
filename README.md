# Blind Lake Resort Keris — AI Assistant

A tourist-information chat assistant that answers questions about Blind Lake
Keris (tickets, activities, food, directions) in English or Urdu, using only
the facts you've provided.

## Why a server is needed
Anthropic's API key must stay private. If it were placed inside the HTML/JS
that runs in a visitor's browser, anyone could open "view source" and steal
it. This project keeps the key on a small server (`server.js`) and has the
webpage talk to *that* server instead of Anthropic directly.

## 1. Get an API key
1. Go to https://console.anthropic.com and create an account (or sign in).
2. Under **API Keys**, create a new key.
3. Note: this is billed separately from any Claude.ai subscription — you pay
   per message based on usage. Set a spending limit in the console if you
   want a safety cap.

## 2. Run it on your own computer (to test)
Requires [Node.js](https://nodejs.org) installed.

```bash
cd blind-lake-keris
npm install
export ANTHROPIC_API_KEY=your-key-here      # on Windows: set ANTHROPIC_API_KEY=your-key-here
npm start
```

Open **http://localhost:3000** in your browser — the assistant will work
fully, including the "ticket prices" and Urdu quick-questions.

## 3. Put it online for the public (free options)
Any Node-hosting service works. Two easy free-tier options:

**Render.com**
1. Push this folder to a GitHub repository.
2. On Render, choose **New → Web Service**, connect the repo.
3. Build command: `npm install` — Start command: `npm start`
4. Add an environment variable: `ANTHROPIC_API_KEY` = your key.
5. Deploy — Render gives you a public URL like `blind-lake-keris.onrender.com`.

**Railway.app** works the same way and is just as simple.

Once deployed, that URL *is* your public assistant — anyone with the link
can open it on their phone browser and chat with it, no app install needed.

## 4. How tourists will actually use it
- **As a website link**: share the URL via a Facebook/Instagram page, a
  Google Maps listing, or a printed QR code at the lake entrance/checkpoint.
  Tourists tap the link, and it opens as a simple chat page — works on any
  phone browser.
- **As an actual WhatsApp bot** (closer to your original request): this same
  backend can be connected to the WhatsApp Business API (via Meta directly,
  or a provider like Twilio or 360dialog). Instead of a webpage sending
  messages to `/api/chat`, WhatsApp's servers would send incoming visitor
  messages to your backend, and your backend replies through WhatsApp. The
  knowledge base and logic in `server.js` stay exactly the same — only the
  "front door" changes from a webpage to WhatsApp. I can help build that
  integration next if you'd like — it just requires picking a WhatsApp API
  provider first (Twilio is the easiest to start with).

## 5. Updating information later
All the facts (prices, services, directions) live in `SYSTEM_PROMPT` inside
`server.js`. Edit that text and restart/redeploy the server — no other code
needs to change.
