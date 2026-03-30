const axios = require('axios');

class XServerClient {
  constructor(xmgameSessid, type = 'je', debug = false) {
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
    
    this.cookies = { 'X2%2Fxmgame_SESSID': xmgameSessid };
    this.loginToken = null;
  }

  _debugLog(...args) {
    if (this.debug) console.log(...args);
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

  async login(memberid, password) {
    try {
      const initialRes = await this.client.get('/xapanel/login/xmgame');
      this._updateCookies(initialRes.headers['set-cookie']);

      const uniqidMatch = initialRes.data.match(/name="uniqid" value="([a-f0-9]+)"/);
      if (!uniqidMatch) throw new Error('uniqid fail');

      const params = new URLSearchParams({
        request_page: 'site', uniqid: uniqidMatch[1], memberid,
        user_password: password, service_login: 'xmgame', action_user_login: 'ログイン'
      });

      const loginRes = await this.client.post('/xapanel/myaccount/login', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': this._getCookieHeader() }
      });
      this._updateCookies(loginRes.headers['set-cookie']);
      return true;
    } catch (error) {
      if (error.response && error.response.status === 302) {
        this._updateCookies(error.response.headers['set-cookie']);
        return true;
      }
      return false;
    }
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
      return null;
    }
  }

  async start() {
    await this._postAction('/xmgame/game/apipanel/gameserver/start', {}, 'Server Started');
  }

  async stop() {
    await this._postAction('/xmgame/game/apipanel/gameserver/stop', {}, 'Server Stopped');
  }

  async restart() {
    await this._postAction('/xmgame/game/apipanel/gameserver/restart', {}, 'Server Restarted');
  }

  async sendCommand(command) {
    await this._postAction(`/xmgame/game/apipanel/${this.type}/console/sendcommand`, { command }, `Command Sent [${command}]`);
  }

  async refresh(period = 48) {
    try {
      const confRes = await this.client.get('/xmgame/game/freeplan/extend/conf', {
        headers: { 'Cookie': this._getCookieHeader() }
      });
      
      const uniqidMatch = confRes.data.match(/let clientLoginToken = "([a-f0-9]+)";/);
      const csrfMatch = confRes.data.match(/name="ethna_csrf" value="([a-f0-9]+)"/);
      
      if (!uniqidMatch) throw new Error('Refresh token fail');

      const params = new URLSearchParams({
        uniqid: uniqidMatch[1],
        ethna_csrf: csrfMatch ? csrfMatch[1] : '',
        period: period.toString()
      });

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
}

module.exports = XServerClient;