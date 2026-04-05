const fs = require('fs');
const axiosRaw = require('axios');
const axios = axiosRaw.default || axiosRaw;
const FormData = require('form-data');
const XServerClient = require('./index');

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
    if (this.fmBaseUrl && this.xsrfToken) return true;

    try {
      const res = await this.client.get('/xmgame/game/jumpfilemanager/index', {
        headers: { 'Cookie': this._getCookieHeader() },
        maxRedirects: 0,
        validateStatus: (status) => status === 302
      });

      const jumpUrl = res.headers.location;
      const url = new URL(jumpUrl);
      this.fmBaseUrl = `${url.protocol}//${url.hostname}`;

      const fmRes = await axios.get(jumpUrl, {
        headers: { 'Cookie': this._getCookieHeader() },
        withCredentials: true
      });

      const setCookies = fmRes.headers['set-cookie'];
      if (setCookies) {
        setCookies.forEach(c => {
          const [pair] = c.split(';');
          const [key, value] = pair.split('=');
          this.fmCookies[key.trim()] = value.trim();
          if (key.trim() === 'XSRF-TOKEN') {
            this.xsrfToken = decodeURIComponent(value.trim());
          }
        });
      }
      return true;
    } catch (e) {
      this._debugLog('FM Prepare Error:', e.message);
      return false;
    }
  }

  async getFileContent(remoteFilePath) {
    await this._prepareFileManager();
    const encodedPath = this._encodePath(remoteFilePath);
    try {
      const res = await axios.get(`${this.fmBaseUrl}/api/resources/resource`, {
        params: { path: encodedPath },
        headers: { 
          'Cookie': this._getCookieHeader(this.fmCookies), 
          'X-XSRF-TOKEN': this.xsrfToken, 
          'Accept': 'application/json' 
        }
      });
      return res.data.results?.contents || null;
    } catch (error) { return null; }
  }

  async saveFileContent(remoteFilePath, newContents) {
    await this._prepareFileManager();
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
      return res.data;
    } catch (error) { return null; }
  }

  async uploadFile(remoteDirPath, fileContent, fileName) {
    await this._prepareFileManager();
    const encodedPath = this._encodePath(remoteDirPath);
    const form = new FormData();
    form.append('path', encodedPath);
    form.append('encoding', 'UTF-8');
    form.append('files[]', fileContent, { filename: fileName });
    try {
      const res = await axios.post(`${this.fmBaseUrl}/api/resources/upload`, form, {
        headers: { 
          ...form.getHeaders(), 
          'Cookie': this._getCookieHeader(this.fmCookies), 
          'X-XSRF-TOKEN': this.xsrfToken 
        }
      });
      return res.data;
    } catch (error) { return null; }
  }

  async deleteFile(remoteFilePath) {
    await this._prepareFileManager();
    const encodedPath = this._encodePath(remoteFilePath);
    try {
      const res = await axios.request({
        method: 'DELETE',
        url: `${this.fmBaseUrl}/api/resources`,
        headers: { 
          'Cookie': this._getCookieHeader(this.fmCookies), 
          'X-XSRF-TOKEN': this.xsrfToken, 
          'Content-Type': 'application/json' 
        },
        data: { resources: [{ path: encodedPath, type: "file" }] }
      });
      return res.data;
    } catch (error) { return null; }
  }

  async decompressFile(remoteZipPath) {
    await this._prepareFileManager();
    const parentDir = remoteZipPath.substring(0, remoteZipPath.lastIndexOf('/')) || '/';
    const encodedParentPath = this._encodePath(parentDir);
    const encodedZipPath = this._encodePath(remoteZipPath);
    try {
      const res = await axios.post(`${this.fmBaseUrl}/api/resources/decompress`, {
        path: encodedParentPath,
        decompressFile: encodedZipPath
      }, {
        headers: { 
          'Cookie': this._getCookieHeader(this.fmCookies), 
          'X-XSRF-TOKEN': this.xsrfToken, 
          'Content-Type': 'application/json' 
        }
      });
      return res.data;
    } catch (error) { return null; }
  }

  async renameFile(remoteOldPath, newName) {
    await this._prepareFileManager();
    const encodedOldPath = this._encodePath(remoteOldPath);
    try {
      const res = await axios.post(`${this.fmBaseUrl}/api/resources/rename`, {
        path: encodedOldPath,
        renamedName: newName,
        encoding: "UTF-8"
      }, {
        headers: { 
          'Cookie': this._getCookieHeader(this.fmCookies), 
          'X-XSRF-TOKEN': this.xsrfToken, 
          'Content-Type': 'application/json' 
        }
      });
      return res.data;
    } catch (error) { return null; }
  }
}

module.exports = XServerFileManager;
