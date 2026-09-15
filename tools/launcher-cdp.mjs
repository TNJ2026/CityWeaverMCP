const mode = process.argv[2] ?? 'inspect';
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find(item => item.type === 'page');
if (!target) throw new Error('Launcher page was not found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
function evaluate(expression) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  return new Promise((resolve, reject) => {
    const handler = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener('message', handler);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result?.result?.value);
    };
    socket.addEventListener('message', handler);
  });
}

let expression;
if (mode === 'inspect') {
  expression = `JSON.stringify({text: document.body.innerText, buttons: [...document.querySelectorAll('button')].map((b,i)=>({i,text:b.innerText,aria:b.getAttribute('aria-label'),testid:b.getAttribute('data-testid'),disabled:b.disabled}))})`;
} else if (mode === 'resume') {
  expression = `(() => { const button=document.querySelector('[data-testid="gameButton-resume"]'); if(!button || button.disabled) return JSON.stringify({clicked:false,reason:'resume unavailable'}); button.click(); return JSON.stringify({clicked:true,text:button.innerText}); })()`;
} else if (mode === 'play') {
  expression = `(() => { const buttons=[...document.querySelectorAll('button')]; const button=buttons.find(b => !b.disabled && /^(PLAY|RESUME|开始游戏|继续游戏|游玩)$/i.test(b.innerText.trim())) || buttons.find(b => !b.disabled && /(play|resume|开始|继续|游玩)/i.test((b.innerText+' '+(b.getAttribute('aria-label')||'')).trim())); if(!button) return JSON.stringify({clicked:false,buttons:buttons.map(b=>b.innerText)}); button.click(); return JSON.stringify({clicked:true,text:button.innerText}); })()`;
} else if (mode === 'ignore-warning') {
  expression = `(() => { const button=document.querySelector('[data-testid="cancelButton"]'); if(!button || button.disabled) return JSON.stringify({clicked:false,reason:'ignore unavailable'}); button.click(); return JSON.stringify({clicked:true,text:button.innerText}); })()`;
} else {
  throw new Error(`Unknown mode: ${mode}`);
}

const value = await evaluate(expression);
socket.close();
console.log(value);
