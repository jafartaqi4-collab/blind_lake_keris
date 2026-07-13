/**
 * ---------------------------------------------------------
 * یہ کوڈ آپ کی موجودہ چیٹ ویجٹ کی JS فائل میں شامل کریں
 * (وہ فائل جو /api/chat کو کال کرتی ہے — عام طور پر public فولڈر میں)
 * ---------------------------------------------------------
 * تین کام کرتا ہے:
 *  1) ہر صارف کے لیے sessionId بناتا ہے (localStorage میں محفوظ)
 *  2) /api/chat کے ساتھ sessionId بھیجتا ہے، اور اگر جواب "unansweredId"
 *     کے ساتھ آئے تو صارف سے واٹس ایپ نمبر مانگتا ہے
 *  3) ہر 15 سیکنڈ بعد چیک کرتا ہے کہ پرانے سوال کا جواب آ گیا یا نہیں
 * ---------------------------------------------------------
 */

// -----------------------------------------------------------
// 1) Session ID
// -----------------------------------------------------------
function getSessionId() {
  let sessionId = localStorage.getItem('blindlake_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem('blindlake_session_id', sessionId);
  }
  return sessionId;
}

// -----------------------------------------------------------
// 2) اپنے موجودہ fetch('/api/chat', ...) کال میں یہ تبدیلیاں کریں:
// -----------------------------------------------------------
//
// پہلے شاید آپ کا کوڈ کچھ اس طرح ہے:
//
//   const res = await fetch('/api/chat', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ messages })
//   });
//   const data = await res.json();
//   showAssistantReply(data.reply);
//
// اسے یوں تبدیل کریں (صرف sessionId شامل کریں اور unansweredId چیک کریں):
//
async function sendChatMessage(messages) {
  const sessionId = getSessionId();

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, sessionId })
  });
  const data = await res.json();

  showAssistantReply(data.reply); // آپ کا موجودہ فنکشن، جیسا پہلے تھا

  // اگر یہ سوال "غیر جواب شدہ" کے طور پر فلیگ ہوا ہے تو صارف سے پوچھیں
  if (data.unansweredId) {
    showContactPrompt(data.unansweredId);
  }

  return data;
}

// -----------------------------------------------------------
// 3) واٹس ایپ نمبر مانگنے کا سادہ UI
// -----------------------------------------------------------
function showContactPrompt(unansweredId) {
  const promptDiv = document.createElement('div');
  promptDiv.className = 'contact-prompt';
  promptDiv.style.cssText = 'background:#fff; border:1px solid #ddd; border-radius:8px; padding:12px; margin:10px 0;';
  promptDiv.innerHTML = `
    <p style="font-size:13px; margin-bottom:8px; color:#444;">
      یہ سوال ہماری ٹیم تک بھیج دیا گیا ہے۔ جواب واٹس ایپ پر چاہیے تو نمبر لکھیں:
    </p>
    <input type="tel" placeholder="مثلاً 03xxxxxxxxx" class="contact-input"
      style="width:100%; padding:8px; margin-bottom:8px; border-radius:6px; border:1px solid #ccc; box-sizing:border-box;" />
    <div>
      <button class="contact-submit-btn" style="padding:8px 16px; background:#0d6b5f; color:white; border:none; border-radius:6px;">
        محفوظ کریں
      </button>
      <button class="contact-skip-btn" style="padding:8px 16px; margin-right:6px; background:transparent; border:1px solid #ccc; border-radius:6px;">
        نہیں شکریہ
      </button>
    </div>
  `;

  const container = document.querySelector('.chat-messages') || document.body;
  container.appendChild(promptDiv);

  promptDiv.querySelector('.contact-submit-btn').addEventListener('click', async () => {
    const phone = promptDiv.querySelector('.contact-input').value.trim();
    if (phone) {
      await fetch(`/api/unanswered/${unansweredId}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactMethod: 'whatsapp', contactValue: phone })
      });
    }
    promptDiv.remove();
  });

  promptDiv.querySelector('.contact-skip-btn').addEventListener('click', () => {
    promptDiv.remove();
  });
}

// -----------------------------------------------------------
// 4) Polling — ہر 15 سیکنڈ بعد چیک کریں کہ پرانے سوالات کا جواب آیا یا نہیں
//    (یہ اسی ٹیب میں کام کرتا ہے؛ واٹس ایپ نمبر دینے پر تو ٹیب بند
//     کرنے کے بعد بھی جواب واٹس ایپ پر خودکار پہنچے گا)
// -----------------------------------------------------------
function startPolling() {
  const sessionId = getSessionId();

  setInterval(async () => {
    try {
      const res = await fetch(`/api/check/${sessionId}`);
      const data = await res.json();

      if (data.newAnswers && data.newAnswers.length > 0) {
        data.newAnswers.forEach(item => displayNewAnswer(item.question, item.answer));
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 15000);
}

function displayNewAnswer(question, answer) {
  const container = document.querySelector('.chat-messages') || document.body;

  const notifDiv = document.createElement('div');
  notifDiv.style.cssText = 'background:#e8f5e9; border-right:4px solid #2e7d32; padding:12px; border-radius:8px; margin:10px 0;';
  notifDiv.innerHTML = `
    <p style="font-size:12px; color:#2e7d32; margin-bottom:6px;">✅ آپ کے سابقہ سوال کا جواب آ گیا</p>
    <p style="font-size:14px; color:#555; margin-bottom:4px;"><em>"${question}"</em></p>
    <p style="font-size:15px;">${answer}</p>
  `;

  container.appendChild(notifDiv);
  notifDiv.scrollIntoView({ behavior: 'smooth' });
}

// شروع کریں
document.addEventListener('DOMContentLoaded', startPolling);
