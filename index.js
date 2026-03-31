const { chromium } = require('playwright');
const axios = require('axios');

class XServerClient {
  constructor(serverId, type = 'je', debug = false) {
    this.serverId = serverId;
    this.debug = debug;
    this.type = type.toLowerCase() === 'be' ? 'minecraftbedrock' : 'minecraftjava';
    this.client = axios.create({
      baseURL: 'https://secure.xserver.ne.jp',
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });
    this.cookies = {};
    this.loginToken = null;
  }

  _debugLog(...args) {
    if (this.debug) console.log(...args);
  }

  async login(memberid, password) {
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-extensions', '--disable-component-update', '--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--proxy-bypass-list=*', '--disable-features=TranslateUI,BlinkGenPropertyTrees,ServiceWorker', '--blink-settings=imagesEnabled=false']
    });
    const context = await browser.newContext({ viewport: { width: 20, height: 20 }, javaScriptEnabled: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('**/*', (r) => ['image', 'stylesheet', 'font', 'media', 'other'].includes(r.request().resourceType()) ? r.abort() : r.continue());

    try {
      this._debugLog('Starting login via browser...');
      await page.goto('https://secure.xserver.ne.jp/xapanel/login/xmgame/', { waitUntil: 'commit' });
      await page.fill('input[name="memberid"]', memberid);
      await page.fill('input[name="user_password"]', password);
      await Promise.all([page.waitForURL('**/xmgame/index', { waitUntil: 'commit' }), page.click('input[name="action_user_login"]')]);
      
      this._debugLog('Jumping to server:', this.serverId);
      await page.goto(`https://secure.xserver.ne.jp/xapanel/xmgame/jumpvps/?id=${this.serverId}`, { waitUntil: 'commit' });
      await page.waitForURL('**/xmgame/game/index', { waitUntil: 'commit' });

      const cookies = await context.cookies();
      const sessid = cookies.find(c => c.name.includes('xmgame_SESSID'));
      if (sessid) {
        this.cookies['X2%2Fxmgame_SESSID'] = sessid.value;
        this._debugLog('SESSID obtained:', sessid.value);
        return true;
      }
      return false;
    } catch (e) {
      this._debugLog('Login error:', e.message);
      return false;
    } finally {
      await context.close();
      await browser.close();
    }
  }

  _updateCookies(setCookieHeader) {
    if (!setCookieHeader) return;
    setCookieHeader.forEach(cookieStr => {
      const [pair] = cookieStr.split(';');
      const [key, value] = pair.split('=');
      if (key && value) this.cookies[key.trim()] = value.trim();
    });
  }

  _getCookieHeader() {
    return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async fetchLoginToken() {
    try {
      const res = await this.client.get(`/xmgame/game/${this.type}/console/index`, {
        headers: { 'Cookie': this._getCookieHeader() }
      });
      const tokenMatch = res.data.match(/let clientLoginToken = "([a-f0-9]+)";/);
      if (tokenMatch) {
        this.loginToken = tokenMatch[1];
        this._debugLog('Token fetched:', this.loginToken);
        return true;
      }
      return false;
    } catch (error) {
      this._debugLog('Fetch token error:', error.message);
      return false;
    }
  }

  async _postAction(actionPath, extraParams = {}, successMsg = 'Success') {
    if (!this.loginToken) return;
    try {
      const params = new URLSearchParams({ login_token: this.loginToken, ...extraParams });
      const res = await this.client.post(actionPath, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this._getCookieHeader(),
          'Referer': `https://secure.xserver.ne.jp/xmgame/game/${this.type}/console/index`
        }
      });
      if (res.data && res.data.result !== false) {
        console.log(`${successMsg}:`, res.data);
      }
      return res.data;
    } catch (error) {
      this._debugLog(`${successMsg} error:`, error.message);
      return null;
    }
  }

  async start() { await this._postAction('/xmgame/game/apipanel/gameserver/start', {}, 'Server Started'); }
  async stop() { await this._postAction('/xmgame/game/apipanel/gameserver/stop', {}, 'Server Stopped'); }
  async restart() { await this._postAction('/xmgame/game/apipanel/gameserver/restart', {}, 'Server Restarted'); }
  async sendCommand(command) { await this._postAction(`/xmgame/game/apipanel/${this.type}/console/sendcommand`, { command }, `Command Sent [${command}]`); }

  async refresh(period = 48) {
    try {
      const confRes = await this.client.get('/xmgame/game/freeplan/extend/conf', {
        headers: { 'Cookie': this._getCookieHeader() }
      });
      const uniqidMatch = confRes.data.match(/let clientLoginToken = "([a-f0-9]+)";/);
      const csrfMatch = confRes.data.match(/name="ethna_csrf" value="([a-f0-9]+)"/);
      if (!uniqidMatch) throw new Error('Refresh token fail');
      const params = new URLSearchParams({ uniqid: uniqidMatch[1], ethna_csrf: csrfMatch ? csrfMatch[1] : '', period: period.toString() });
      const res = await this.client.post('/xmgame/game/freeplan/extend/do', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this._getCookieHeader(),
          'Referer': 'https://secure.xserver.ne.jp/xmgame/game/freeplan/extend/conf'
        }
      });
      console.log(`Plan Refreshed (${period}h):`, res.status === 200 || res.status === 302 ? 'Success' : 'Fail');
      return res.data;
    } catch (error) {
      console.error('Refresh failed:', error.message);
      return null;
    }
  }

  async getLimitStatus() {
    try {
      const res = await this.client.get('/xmgame/game/index', {
        headers: { 'Cookie': this._getCookieHeader() }
      });
      const timeMatch = res.data.match(/残り<span class="numberTxt">(\d+)<\/span>時間<span class="numberTxt">(\d+)<\/span>分/);
      const dateMatch = res.data.match(/<span class="dateLimit">\((.*?)まで\)<\/span>/);
      if (timeMatch && dateMatch) {
        return {
          hours: parseInt(timeMatch[1], 10),
          minutes: parseInt(timeMatch[2], 10),
          limitDate: dateMatch[1]
        };
      }
      return null;
    } catch (error) {
      this._debugLog('Fetch limit status error:', error.message);
      return null;
    }
  }
}

module.exports = XServerClient;
