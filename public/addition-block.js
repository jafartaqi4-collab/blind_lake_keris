// ================================================================
// addition-block.js
// یہ فائل خودکار طور پر پرانے چیٹ سسٹم میں notification فیچر شامل کرتی ہے۔
// اسے public فولڈر میں index.html کے ساتھ اپلوڈ کریں۔
// ================================================================

// Session ID — ہر صارف کے لیے مستقل، تاکہ بعد میں جواب پہنچایا جا سکے
function getSessionId(){
  let sid = localStorage.getItem('blk_session_id');
  if (!sid) {
    sid = (crypto.randomUUID ? crypto.randomUUID() : 'sid-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem('blk_session_id', sid);
  }
  return sid;
}
const sessionId = getSessionId();

// صارف سے آپشنل واٹس ایپ نمبر مانگنے کا باکس
function showContactPrompt(unansweredId){
  const wrap = document.createElement('div');
  wrap.className = 'bubble bot';
  wrap.style.cssText = 'background:#fff8ea;border:1px dashed #B9793A;';
  wrap.innerHTML = `
    <p style="font-size:13.5px;margin:0 0 8px;">
      یہ سوال ہماری ٹیم تک بھیج دیا گیا ہے۔ اگر آپ چاہیں تو جواب آنے پر واٹس ایپ پیغام کے ذریعے مطلع کیا جا سکتا ہے۔
    </p>
    <input type="tel" placeholder="واٹس ایپ نمبر (اختیاری)" class="blk-contact-input"
      style="width:100%;padding:8px;margin-bottom:8px;border-radius:6px;border:1px solid #ccc;box-sizing:border-box;font-size:14px;" />
    <div style="display:flex;gap:8px;">
      <button class="blk-contact-save" style="flex:1;padding:8px;background:#0E7A73;color:#fff;border:none;border-radius:6px;">محفوظ کریں</button>
      <button class="blk-contact-skip" style="flex:1;padding:8px;background:transparent;border:1px solid #ccc;border-radius:6px;">نہیں شکریہ</button>
    </div>
  `;
  document.getElementById('chat').appendChild(wrap);
  document.getElementById('chat').scrollTop = document.getElementById('chat').scrollHeight;

  wrap.querySelector('.blk-contact-save').addEventListener('click', async () => {
    const phone = wrap.querySelector('.blk-contact-input').value.trim();
    if (phone) {
      try {
        await fetch(`/api/unanswered/${unansweredId}/contact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactValue: phone })
        });
      } catch(e) {}
    }
    wrap.remove();
  });
  wrap.querySelector('.blk-contact-skip').addEventListener('click', () => wrap.remove());
}

// ہر 15 سیکنڈ بعد چیک کریں کہ کوئی پرانا سوال جواب پا گیا یا نہیں
async function checkForAnswers(){
  try {
    const res = await fetch(`/api/check/${sessionId}`);
    const data = await res.json();
    if (data.newAnswers && data.newAnswers.length > 0) {
      const chatEl = document.getElementById('chat');
      data.newAnswers.forEach(item => {
        const box = document.createElement('div');
        box.className = 'bubble bot';
        box.style.cssText = 'background:#e8f5e9;border-right:4px solid #2e7d32;';
        if (/[\u0600-\u06FF]/.test(item.answer)) box.classList.add('rtl');
        box.innerHTML = `
          <p style="font-size:11.5px;color:#2e7d32;margin:0 0 6px;">✅ آپ کے سابقہ سوال کا جواب آ گیا</p>
          <p style="font-size:13px;color:#555;margin:0 0 4px;"><em>${item.question}</em></p>
          <p style="margin:0;">${item.answer}</p>
        `;
        chatEl.appendChild(box);
        if (typeof speak === 'function') speak(item.answer);
      });
      chatEl.scrollTop = chatEl.scrollHeight;
    }
  } catch(e) {}
}
setInterval(checkForAnswers, 15000);

// ---- پرانے sendMessage کو یہاں دوبارہ تعریف کر رہے ہیں تاکہ sessionId بھیجے
// اور جواب نہ ملنے کی صورت میں contact prompt دکھائے ----
async function sendMessage(text){
  if(!text.trim()) return;
  addBubble(text, 'user');
  history.push({role:'user', content:text});
  inputEl.value='';
  sendBtn.disabled = true;
  quickEl.style.display = 'none';
  addTyping();

  try{
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, sessionId: sessionId })
    });
    const data = await response.json();
    removeTyping();
    const reply = data.reply?.trim() || "Sorry, I couldn't fetch a response just now.";
    addBubble(reply, 'bot');
    speak(reply);
    history.push({role:'assistant', content:reply});

    if (data.unanswered && data.unansweredId) {
      showContactPrompt(data.unansweredId);
    }
  }catch(err){
    removeTyping();
    addBubble("Connection error — please try again.", 'bot');
  }
  sendBtn.disabled = false;
}
