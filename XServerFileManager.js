const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const axiosRaw = require('axios');
const axios = axiosRaw.default || axiosRaw;
const iconv = require('iconv-lite');
const FormData = require('form-data');

class XServerFileManager {
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
      args: ['--disable-extensions', '--disable-component-update', '--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--blink-settings=imagesEnabled=false']
    });
    const context = await browser.newContext({ viewport: { width: 20, height: 20 }, javaScriptEnabled: true });
    const page = await context.newPage();
    await page.route('**/*', (r) => ['image', 'stylesheet', 'font', 'media', 'other'].includes(r.request().resourceType()) ? r.abort() : r.continue());

    try {
      this._debugLog('Logging in...');
      await page.goto('https://secure.xserver.ne.jp/xapanel/login/xmgame/', { waitUntil: 'commit' });
      await page.fill('input[name="memberid"]', memberid);
      await page.fill('input[name="user_password"]', password);
      await Promise.all([page.waitForURL('**/xmgame/index', { waitUntil: 'commit' }), page.click('input[name="action_user_login"]')]);
      
      await page.goto(`https://secure.xserver.ne.jp/xapanel/xmgame/jumpvps/?id=${this.serverId}`, { waitUntil: 'commit' });
      await page.waitForURL('**/xmgame/game/index', { waitUntil: 'commit' });

      const cookies = await context.cookies();
      cookies.forEach(c => { this.cookies[c.name] = c.value; });
      return true;
    } catch (e) {
      this._debugLog('Login error:', e.message);
      return false;
    } finally {
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
        headers: { 'Cookie': this._getCookieHeader(), 'X-XSRF-TOKEN': this.xsrfToken, 'Accept': 'application/json' }
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
        headers: { 'Cookie': this._getCookieHeader(), 'X-XSRF-TOKEN': this.xsrfToken, 'Content-Type': 'application/json' }
      });
      return res.data;
    } catch (error) { return null; }
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
        headers: { ...form.getHeaders(), 'Cookie': this._getCookieHeader(), 'X-XSRF-TOKEN': this.xsrfToken }
      });
      return res.data;
    } catch (error) { return null; }
  }

  async deleteFile(remoteFilePath) {
    if (!this.fmBaseUrl) await this._prepareFileManager();
    const encodedPath = this._encodePath(remoteFilePath);
    try {
      const res = await axios.request({
        method: 'DELETE',
        url: `${this.fmBaseUrl}/api/resources`,
        headers: { 'Cookie': this._getCookieHeader(), 'X-XSRF-TOKEN': this.xsrfToken, 'Content-Type': 'application/json' },
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
        headers: { 'Cookie': this._getCookieHeader(), 'X-XSRF-TOKEN': this.xsrfToken, 'Content-Type': 'application/json' }
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
        headers: { 'Cookie': this._getCookieHeader(), 'X-XSRF-TOKEN': this.xsrfToken, 'Content-Type': 'application/json' }
      });
      return res.data;
    } catch (error) { return null; }
  }

  async fetchLoginToken() {
    try {
      const res = await this.client.get(`/xmgame/game/${this.type}/console/index`, { headers: { 'Cookie': this._getCookieHeader(this.cookies) } });
      const tokenMatch = res.data.match(/let clientLoginToken = "([a-f0-9]+)";/);
      if (tokenMatch) { this.loginToken = tokenMatch[1]; return true; }
      return false;
    } catch (e) { return false; }
  }

  async _postAction(actionPath, extraParams = {}) {
    if (!this.loginToken) await this.fetchLoginToken();
    try {
      const params = new URLSearchParams({ login_token: this.loginToken, ...extraParams });
      await this.client.post(actionPath, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': this._getCookieHeader(this.cookies) }
      });
      return true;
    } catch (e) { return false; }
  }

  async start() { return await this._postAction('/xmgame/game/apipanel/gameserver/start'); }
  async stop() { return await this._postAction('/xmgame/game/apipanel/gameserver/stop'); }
}

module.exports = XServerFileManager;
