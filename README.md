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

// 第2引数: 種類（"je" = Java版 / "be" = Bedrock版）
// 第3引数: debugログ（trueでログ出力）
// 第1引数: serverId（サーバーID）
const xserver = new XServerClient("サーバーIDをここに", "je", true);

async function run() {
  // ログイン
  const loggedIn = await xserver.login("メールアドレス", "パスワード");
  if (!loggedIn) return console.log("Login failed");

  // プラン延長（48時間）
  await xserver.refresh(48);

  // トークン取得
  const tokenOk = await xserver.fetchLoginToken();
  if (!tokenOk) return console.log("Token fetch failed");

  // コマンド送信
  await xserver.sendCommand("say Hello from API!");

  // 再起動
  await xserver.restart();
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
