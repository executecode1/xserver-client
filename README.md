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
const xserver = new XServerClient("SESSIDをここに", "je", true);

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

### SESSIDについて

* `X2%2Fxmgame_SESSID` を手動で取得する必要があります
* 有効期限が短く、すぐ無効になります
* 実行時は毎回最新のSESSIDを使用してください

---

### 仕様変更について

* 非公式のため、Xserver側の変更に影響を受けます
* パネルの構造変更などで動作しなくなる可能性があります

---

## 補足

* フリープランの延長や簡単な操作の自動化を想定しています
* 安定性は保証されません
