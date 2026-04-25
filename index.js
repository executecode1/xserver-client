const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const axiosRaw = require('axios');
const axios = axiosRaw.default || axiosRaw;
const iconv = require('iconv-lite');
const FormData = require('form-data');

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
    this.lastLine = '';
    this.fmBaseUrl = null;
    this.fmCookies = {};
    this.xsrfToken = null;
  }

  _debugLog(...args) {
    if (this.debug) console.log(...args);
  }

  _encodePath(p) {
    if (!p || p === '/' || p === '.') return '/';
    const normalized = p.replace(/^\.\//, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    const parts = normalized.split('/').filter(part => part.length > 0);
    return '/' + parts.map(part => Buffer.from(part).toString('base64')).join('/');
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
      cookies.forEach(c => { this.cookies[c.name] = c.value; });
      const sessid = cookies.find(c => c.name.includes('xmgame_SESSID'));
      if (sessid) {
        this.cookies['X2%2Fxmgame_SESSID'] = sessid.value;
        this._debugLog('SESSID obtained:', sessid.value);
      }
      return true;
    } catch (e) {
      this._debugLog('Login error:', e.message);
      return false;
    } finally {
      await context.close();
      await browser.close();
    }
  }

  _getCookieHeader(cookieObj = this.fmCookies || this.cookies) {
    return Object.entries(cookieObj).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async _prepareFileManager() {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await context.addCookies(Object.entries(this.cookies).map(([name, value]) => ({
        name, value, domain: 'secure.xserver.ne.jp', path: '/'
      })));
      await page.goto('https://secure.xserver.ne.jp/xmgame/game/jumpfilemanager/index', { waitUntil: 'networkidle' });
      const url = new URL(page.url());
      this.fmBaseUrl = `${url.protocol}//${url.hostname}`;
      const fmCookies = await context.cookies(this.fmBaseUrl);
      this.fmCookies = {};
      fmCookies.forEach(c => {
        this.fmCookies[c.name] = c.value;
        if (c.name === 'XSRF-TOKEN') { this.xsrfToken = decodeURIComponent(c.value); }
      });
      return true;
    } catch (e) { return false; } finally { await browser.close(); }
  }

  async getFileContent(remoteFilePath) {
    if (!this.fmBaseUrl) await this._prepareFileManager();
    const encodedPath = this._encodePath(remoteFilePath);
    try {
      const res = await axios.get(`${this.fmBaseUrl}/api/resources/resource`, {
        params: { path: encodedPath },
        headers: { 'Cookie': this._getCookieHeader(this.fmCookies), 'X-XSRF-TOKEN': this.xsrfToken, 'Accept': 'application/json' }
      });
      return res.data.results?.contents || null;
    } catch (error) { return null; }
  }

  async saveFileContent(remoteFilePath, newContents) {
    if (!this.fmBaseUrl) await this._prepareFileManager();
    const encodedPath = this._encodePath(remoteFilePath);
    try {
      const res = await axios.post(`${this.fmBaseUrl}/api/resources/resource`, {
        path: encodedPath,
        contents: newContents,
        encoding: "UTF-8"
      }, {
        headers: { 
          'Cookie': this._getCookieHeader(this.fmCookies), 
          'X-XSRF-TOKEN': this.xsrfToken, 
          'Content-Type': 'application/json' 
        }
      });
      this._debugLog('Save Success:', remoteFilePath);
      return res.data;
    } catch (error) {
      this._debugLog('Save Error:', error.response?.data || error.message);
      return null;
    }
  }

  async uploadFile(remoteDirPath, fileContent, fileName) {
    if (!this.fmBaseUrl) await this._prepareFileManager();
    const encodedPath = this._encodePath(remoteDirPath);
    const form = new FormData();
    form.append('path', encodedPath);
    form.append('encoding', 'UTF-8');
    form.append('files[]', fileContent, { filename: fileName });
    try {
      const res = await axios.post(`${this.fmBaseUrl}/api/resources/upload`, form, {
        headers: { ...form.getHeaders(), 'Cookie': this._getCookieHeader(this.fmCookies), 'X-XSRF-TOKEN': this.xsrfToken }
      });
      return res.data;
    } catch (error) { return null; }
  }

  async downloadResource(remotePath, type = 'file') {
    if (!this.fmBaseUrl) await this._prepareFileManager();
    const name = remotePath.split('/').pop() || 'download';
    const encodedName = Buffer.from(name).toString('base64');
    const encodedPath = this._encodePath(remotePath);
    try {
      const res = await axios.get(`${this.fmBaseUrl}/api/resources/download`, {
        params: { name: encodedName, path: encodedPath, type: type },
        headers: { 'Cookie': this._getCookieHeader(this.fmCookies), 'X-XSRF-TOKEN': this.xsrfToken },
        responseType: 'arraybuffer'
      });
      return res.data;
    } catch (error) {
      this._debugLog('Download Error:', error.message);
      return null;
    }
  }

  async deleteFile(remoteFilePath) {
    if (!this.fmBaseUrl) await this._prepareFileManager();
    const encodedPath = this._encodePath(remoteFilePath);
    try {
      const res = await axios.request({
        method: 'DELETE',
        url: `${this.fmBaseUrl}/api/resources`,
        headers: { 'Cookie': this._getCookieHeader(this.fmCookies), 'X-XSRF-TOKEN': this.xsrfToken, 'Content-Type': 'application/json' },
        data: { resources: [{ path: encodedPath, type: "file" }] }
      });
      return res.data;
    } catch (error) { return null; }
  }

  async decompressFile(remoteZipPath) {
    if (!this.fmBaseUrl) await this._prepareFileManager();
    const parentDir = remoteZipPath.substring(0, remoteZipPath.lastIndexOf('/')) || '/';
    const encodedParentPath = this._encodePath(parentDir);
    const encodedZipPath = this._encodePath(remoteZipPath);
    try {
      const res = await axios.post(`${this.fmBaseUrl}/api/resources/decompress`, {
        path: encodedParentPath,
        decompressFile: encodedZipPath
      }, {
        headers: { 'Cookie': this._getCookieHeader(this.fmCookies), 'X-XSRF-TOKEN': this.xsrfToken, 'Content-Type': 'application/json' }
      });
      return res.data;
    } catch (error) { return null; }
  }

  async renameFile(remoteOldPath, newName) {
    if (!this.fmBaseUrl) await this._prepareFileManager();
    const encodedOldPath = this._encodePath(remoteOldPath);
    try {
      const res = await axios.post(`${this.fmBaseUrl}/api/resources/rename`, {
        path: encodedOldPath,
        renamedName: newName,
        encoding: "UTF-8"
      }, {
        headers: { 'Cookie': this._getCookieHeader(this.fmCookies), 'X-XSRF-TOKEN': this.xsrfToken, 'Content-Type': 'application/json' }
      });
      return res.data;
    } catch (error) { return null; }
  }

  async fetchLoginToken() {
    try {
      const res = await this.client.get(`/xmgame/game/${this.type}/console/index`, {
        headers: { 'Cookie': this._getCookieHeader(this.cookies) }
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
    if (!this.loginToken) await this.fetchLoginToken();
    try {
      const params = new URLSearchParams({ login_token: this.loginToken, ...extraParams });
      const res = await this.client.post(actionPath, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this._getCookieHeader(this.cookies),
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
        headers: { 'Cookie': this._getCookieHeader(this.cookies) }
      });
      const uniqidMatch = confRes.data.match(/let clientLoginToken = "([a-f0-9]+)";/);
      const csrfMatch = confRes.data.match(/name="ethna_csrf" value="([a-f0-9]+)"/);
      if (!uniqidMatch) throw new Error('Refresh token fail');
      const params = new URLSearchParams({ uniqid: uniqidMatch[1], ethna_csrf: csrfMatch ? csrfMatch[1] : '', period: period.toString() });
      const res = await this.client.post('/xmgame/game/freeplan/extend/do', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this._getCookieHeader(this.cookies),
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
        headers: { 'Cookie': this._getCookieHeader(this.cookies) },
        responseType: 'arraybuffer'
      });
      const html = iconv.decode(Buffer.from(res.data), 'euc-jp');
      const timeMatches = html.match(/<span class="numberTxt">(\d+)<\/span>/g);
      const dateMatch = html.match(/<span class="dateLimit">\s*\((.*?)\)\s*<\/span>/);
      if (timeMatches && timeMatches.length >= 2 && dateMatch) {
        const hours = timeMatches[0].match(/(\d+)/)[1];
        const minutes = timeMatches[1].match(/(\d+)/)[1];
        return {
          hours: parseInt(hours, 10),
          minutes: parseInt(minutes, 10),
          limitDate: dateMatch[1].replace('まで', '').trim()
        };
      }
      return null;
    } catch (error) {
      this._debugLog('Fetch limit status error:', error.message);
      return null;
    }
  }

  async getLog() {
    if (!this.loginToken) await this.fetchLoginToken();
    try {
      const params = new URLSearchParams({ login_token: this.loginToken });
      const res = await this.client.post(`/xmgame/game/apipanel/${this.type}/console/getlog`, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this._getCookieHeader(this.cookies),
          'Referer': `https://secure.xserver.ne.jp/xmgame/game/${this.type}/console/index`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      const currentLog = res.data?.data?.log || res.data?.log || '';
      if (!currentLog) return '';
      const lines = currentLog.trim().split('\n');
      if (lines.length === 0) return '';
      let newLines = [];
      if (!this.lastLine) {
        newLines = lines;
      } else {
        const lastIndex = lines.lastIndexOf(this.lastLine);
        if (lastIndex !== -1) {
          newLines = lines.slice(lastIndex + 1);
        } else {
          newLines = lines.slice(-5);
        }
      }
      if (lines.length > 0) this.lastLine = lines[lines.length - 1];
      return newLines.join('\n');
    } catch (e) { return ''; }
  }
}

class XserverMgrScanner {
  constructor(xserver) {
    this.client = xserver;
  }

  _encodePath(path) {
    const parts = path.split('/').filter(p => p.length > 0);
    return '/' + parts.map(p => Buffer.from(p).toString('base64')).join('/');
  }

  async getFiles(remoteDirPath, options = {}) {
    if (!this.client.fmBaseUrl) await this.client._prepareFileManager();
    try {
      const { data } = await axios({
        method: 'get',
        url: `${this.client.fmBaseUrl}/api/resources`,
        params: { path: this._encodePath(remoteDirPath), is_check_path_encoding: 'true' },
        headers: {
          'Cookie': this.client._getCookieHeader(this.client.fmCookies),
          'X-XSRF-TOKEN': this.client.xsrfToken,
          'Accept': 'application/json'
        }
      });
      const items = Array.isArray(data) ? data : (data.results || []);
      return items.map(item => {
        const name = item.nameDisplay || Buffer.from(item.name, 'base64').toString('utf-8');
        let fullPath = `${remoteDirPath}/${name}`.replace(/\/+/g, '/');
        if (options.suffix) fullPath += `/${options.suffix}`;
        return {
          name,
          type: item.resourceType,
          fullPath,
          size: item.size,
          lastModified: item.lastModified
        };
      });
    } catch (error) { return []; }
  }
}

module.exports = {
  XServerClient,
  XserverMgrScanner
};
