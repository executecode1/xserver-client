const XServerClient = require('./index');
const axiosRaw = require('axios');
const axios = axiosRaw.default || axiosRaw;
const FormData = require('form-data');

class XServerFileManager extends XServerClient {
  constructor(serverId, type = 'je', debug = false) {
    super(serverId, type, debug);
    this.fmBaseUrl = null;
    this.fmCookies = {};
    this.xsrfToken = null;
  }

  _encodePath(p) {
    if (!p || p === '/' || p === '.') return '/';
    const normalized = p.replace(/^\.\//, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    const parts = normalized.split('/').filter(part => part.length > 0);
    return '/' + parts.map(part => Buffer.from(part).toString('base64')).join('/');
  }

  async _prepareFileManager() {
    const { chromium } = require('playwright');
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
        if (c.name === 'XSRF-TOKEN') {
          this.xsrfToken = decodeURIComponent(c.value);
        }
      });
      return true;
    } catch (e) {
      this._debugLog('File Manager preparation error:', e.message);
      return false;
    } finally {
      await browser.close();
    }
  }

  _getFmCookieHeader() {
    return Object.entries(this.fmCookies).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async getFileContent(remoteFilePath) {
    if (!this.fmBaseUrl) await this._prepareFileManager();
    const encodedPath = this._encodePath(remoteFilePath);
    try {
      const res = await axios.get(`${this.fmBaseUrl}/api/resources/resource`, {
        params: { path: encodedPath },
        headers: { 
          'Cookie': this._getFmCookieHeader(), 
          'X-XSRF-TOKEN': this.xsrfToken, 
          'Accept': 'application/json' 
        }
      });
      return res.data.results?.contents || null;
    } catch (error) {
      return null;
    }
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
          'Cookie': this._getFmCookieHeader(), 
          'X-XSRF-TOKEN': this.xsrfToken, 
          'Content-Type': 'application/json' 
        }
      });
      return res.data;
    } catch (error) {
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
        headers: { 
          ...form.getHeaders(), 
          'Cookie': this._getFmCookieHeader(), 
          'X-XSRF-TOKEN': this.xsrfToken 
        }
      });
      return res.data;
    } catch (error) {
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
        headers: { 
          'Cookie': this._getFmCookieHeader(), 
          'X-XSRF-TOKEN': this.xsrfToken, 
          'Content-Type': 'application/json' 
        },
        data: { resources: [{ path: encodedPath, type: "file" }] }
      });
      return res.data;
    } catch (error) {
      return null;
    }
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
        headers: { 
          'Cookie': this._getFmCookieHeader(), 
          'X-XSRF-TOKEN': this.xsrfToken, 
          'Content-Type': 'application/json' 
        }
      });
      return res.data;
    } catch (error) {
      return null;
    }
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
        headers: { 
          'Cookie': this._getFmCookieHeader(), 
          'X-XSRF-TOKEN': this.xsrfToken, 
          'Content-Type': 'application/json' 
        }
      });
      return res.data;
    } catch (error) {
      return null;
    }
  }
}

module.exports = XServerFileManager;
