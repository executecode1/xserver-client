# xserver-client

Xserver for Gameを外部から操作する非公式APIラッパー。  
ブラウザパネルを開かずに操作したい人や、自動化したい人向け。

---

## インストール

```bash
npm install https://github.com/executecode1/xserver-client
```

---

## 使い方

```js
const XServerClient = require('xserver-client');

async function run() {
  // 1. サーバーID（数字8桁）
  // 2. エディション（"je" または "be"）
  // 3. デバッグ出力（true でログを表示）
  const xserver = new XServerClient("サーバーIDをここに", "je", true);

  // 1. ログイン（自動でSESSIDを取得します）
  const loggedIn = await xserver.login("メールアドレス", "パスワード");
  if (!loggedIn) return console.log("Login failed");

  // 2. 期限情報の取得（残り時間などを確認）
  const status = await xserver.getLimitStatus();
  if (status) {
    console.log(`残り時間: ${status.hours}時間${status.minutes}分`);
    console.log(`期限日: ${status.limitDate}`);
  }

  // 3. 操作用トークンの取得（操作前に必須）
  const tokenOk = await xserver.fetchLoginToken();
  if (!tokenOk) return console.log("Token fetch failed");

  // 4. 各種操作
  await xserver.refresh(48);           // プラン延長（48時間）
  await xserver.sendCommand("kill @e[type=item]"); // コマンド送信("/"不要)
  await xserver.restart();             // 再起動

  // 5. ログ取得の開始
  console.log("--- ログの監視を開始します ---");
  setInterval(async () => {
    const newLog = await xserver.getLog();
    if (newLog && newLog.length > 0) {
      console.log(newLog);
    }
  }, 2000);
}

run();
```

---

## パラメータ説明

* `je` : Java Edition（デフォルト）
* `be` : Bedrock Edition

---

## 注意点

### ログインについて

* メールアドレスとパスワードで自動ログインします
* 内部でブラウザ（Playwright）を使用してSESSIDを取得します
* 初回実行時はブラウザの起動に時間がかかる場合があります
* ログインセキュリティ設定から「不審なログイン時の認証」を無効にしてください（有効だとログインに失敗します）

---

### 仕様変更について

* 非公式のため、Xserver側の変更に影響を受けます
* パネルの構造変更などで動作しなくなる可能性があります

---

## 依存関係

* Playwright が必要です

```bash
npm install playwright
npx playwright install
```

---

## 補足

* フリープランの延長や簡単な操作の自動化を想定しています
* 安定性は保証されません
