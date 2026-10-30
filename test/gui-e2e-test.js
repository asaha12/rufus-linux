const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new globalThis.WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result ? res.result.value : undefined;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runGuiE2eTests() {
  console.log('====================================================');
  console.log('  RUFUS GUI LIVE END-TO-END AUTOMATION SUITE        ');
  console.log('====================================================\n');

  console.log('Spawning Rufus Electron instance on debug port 9222...');
  const appProc = spawn('npx', ['electron', '.', '--remote-debugging-port=9222', '--no-sandbox'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }
  });

  let targetPage = null;
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    try {
      const targets = await fetchJson('http://127.0.0.1:9222/json');
      targetPage = targets.find(t => t.type === 'page' && t.url.includes('index.html'));
      if (targetPage) break;
    } catch (e) {
      // Waiting for port
    }
  }

  if (!targetPage) {
    appProc.kill('SIGKILL');
    throw new Error('Timeout waiting for Electron CDP target');
  }

  console.log('Connected to Rufus GUI target:', targetPage.url);
  const cdp = new CdpClient(targetPage.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  let passed = 0;
  let failed = 0;

  async function check(desc, fn) {
    try {
      await fn();
      console.log(`[PASS] ${desc}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${desc}:`, err.message);
      failed++;
    }
  }

  // GUI TEST 1: Page Title
  await check('Document Title matches Rufus specifications', async () => {
    const title = await cdp.eval('document.title');
    assert.strictEqual(title, 'Rufus 4.15 for Linux');
  });

  // GUI TEST 2: Device Dropdown Populated
  await check('Device select dropdown contains detected/virtual drives', async () => {
    for (let i = 0; i < 30; i++) {
      const len = await cdp.eval('document.getElementById("select-device").options.length');
      if (len >= 1) break;
      await sleep(150);
    }
    const count = await cdp.eval('document.getElementById("select-device").options.length');
    assert(count >= 1, `Device dropdown must contain at least 1 option (found: ${count})`);
  });

  // GUI TEST 3: Boot Selection default
  await check('Boot selection dropdown contains standard options', async () => {
    const val = await cdp.eval('document.getElementById("select-boot").value');
    assert.strictEqual(val, 'iso');
    const options = await cdp.eval('Array.from(document.getElementById("select-boot").options).map(o => o.value)');
    assert(options.includes('freedos'), 'Must have FreeDOS option');
    assert(options.includes('nonbootable'), 'Must have Non-bootable option');
  });

  // GUI TEST 4: Advanced Drive Properties Expander
  await check('Toggle advanced drive properties expander', async () => {
    const initialOpen = await cdp.eval('document.getElementById("adv-drive-panel").classList.contains("open")');
    await cdp.eval('document.getElementById("btn-toggle-adv-drive").click()');
    const afterClick = await cdp.eval('document.getElementById("adv-drive-panel").classList.contains("open")');
    assert.notStrictEqual(initialOpen, afterClick, 'Expander must toggle state on click');
    // Toggle back
    await cdp.eval('document.getElementById("btn-toggle-adv-drive").click()');
  });

  // GUI TEST 5: Activity Log Modal
  await check('Activity Log drawer/modal open, content display, and close', async () => {
    await cdp.eval('document.getElementById("btn-toggle-log").click()');
    const isVisible = await cdp.eval('!document.getElementById("modal-log").classList.contains("hidden")');
    assert.strictEqual(isVisible, true, 'Log modal should be visible');
    
    const logContent = await cdp.eval('document.getElementById("log-textarea").value');
    assert(logContent.includes('Rufus 4.15'), 'Log must contain startup entry');

    // Close log
    await cdp.eval('document.getElementById("btn-close-log").click()');
    const isHidden = await cdp.eval('document.getElementById("modal-log").classList.contains("hidden")');
    assert.strictEqual(isHidden, true, 'Log modal should be hidden');
  });

  // GUI TEST 6: About Dialog
  await check('About Dialog displays version, author info, and closes', async () => {
    await cdp.eval('document.getElementById("btn-about-tool").click()');
    const isVisible = await cdp.eval('!document.getElementById("modal-about").classList.contains("hidden")');
    assert.strictEqual(isVisible, true, 'About modal should be visible');

    const desc = await cdp.eval('document.querySelector(".about-desc").textContent');
    assert.strictEqual(desc, 'The Reliable USB Formatting Utility');

    await cdp.eval('document.getElementById("btn-close-about").click()');
    const isHidden = await cdp.eval('document.getElementById("modal-about").classList.contains("hidden")');
    assert.strictEqual(isHidden, true, 'About modal should be hidden');
  });

  // GUI TEST 7: ISO Downloader Modal
  await check('ISO Downloader modal loads distribution catalog', async () => {
    await cdp.eval('document.getElementById("btn-download-iso").click()');
    await sleep(250);
    const isVisible = await cdp.eval('!document.getElementById("modal-downloader").classList.contains("hidden")');
    assert.strictEqual(isVisible, true, 'Downloader modal should be visible');

    const itemCount = await cdp.eval('document.querySelectorAll(".download-item").length');
    assert(itemCount >= 5, `Expected at least 5 OS download choices (found: ${itemCount})`);

    await cdp.eval('document.getElementById("btn-close-downloader").click()');
    const isHidden = await cdp.eval('document.getElementById("modal-downloader").classList.contains("hidden")');
    assert.strictEqual(isHidden, true, 'Downloader modal should be hidden');
  });

  // GUI TEST 8: Keyboard Escape dismisses open modals
  await check('Escape key dismisses active modal overlay', async () => {
    await cdp.eval('document.getElementById("btn-toggle-log").click()');
    assert.strictEqual(await cdp.eval('!document.getElementById("modal-log").classList.contains("hidden")'), true);
    
    // Simulate Escape keydown
    await cdp.eval('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    assert.strictEqual(await cdp.eval('document.getElementById("modal-log").classList.contains("hidden")'), true);
  });

  // GUI TEST 9: In-App Notice Dialog (Replaces broken window.alert)
  await check('In-App Notice Dialog appears upon clicking START without ISO', async () => {
    await cdp.eval('document.getElementById("btn-start").click()');
    const noticeOpen = await cdp.eval('!document.getElementById("modal-notice").classList.contains("hidden")');
    assert.strictEqual(noticeOpen, true, 'Notice dialog should open');
    const msg = await cdp.eval('document.getElementById("notice-message").textContent');
    assert(msg.includes('Please select an ISO'), 'Notice must guide user');
    await cdp.eval('document.getElementById("btn-notice-ok").click()');
    const noticeClosed = await cdp.eval('document.getElementById("modal-notice").classList.contains("hidden")');
    assert.strictEqual(noticeClosed, true, 'Notice dialog should close on OK');
  });

  // GUI TEST 10: Screenshot Verification
  await check('Capture pixel-perfect rendering screenshot of Rufus window', async () => {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    assert(shot.data && shot.data.length > 1000, 'Screenshot data must be received');
    const shotPath = '/tmp/rufus_live_screenshot.png';
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    assert(fs.existsSync(shotPath), 'Screenshot file must exist on disk');
    console.log(`       Saved live screenshot to ${shotPath} (${(fs.statSync(shotPath).size / 1024).toFixed(1)} KB)`);
  });

  cdp.close();
  appProc.kill('SIGKILL');

  console.log('\n====================================================');
  console.log(`RUFUS GUI E2E SUITE: ${passed + failed} Tests | ${passed} Passed | ${failed} Failed`);
  console.log('====================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runGuiE2eTests().catch(err => {
  console.error('Fatal GUI Test Error:', err);
  process.exit(1);
});
