# Google Classroom Notification System

Google Classroom クラスで過去24時間以内に更新された「お知らせ」「課題」「資料」を毎日指定した時刻にまとめてメール通知する、Google Apps Script (GAS) 製のWebアプリケーションです。

---

## 🌟 主な機能

- **更新情報の集約**: 参加している複数の Classroom クラスの更新を一度に確認できます。
- **通知時刻の自由設定**: ユーザーごとに毎日指定した時刻（分単位）でリマインドメールを受信できます。
- **安全なメール認証**: 転送先メールアドレスの登録時にワンタイムトークンによる確認メールを送信し、なりすましを防止します。
- **OAuth 2.0 連携**: 各ユーザー自身の Google Classroom 閲覧権限を利用して更新データを安全に取得します。

---

## 🏗️ システム構成 & 前提条件

- **ランタイム**: Google Apps Script (V8)
- **データベース**: Google スプレッドシート
- **外部ライブラリ**: [apps-script-oauth2](https://github.com/googleworkspace/apps-script-oauth2) (`1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF`)
- **API**: Google Classroom API v1

---

## 🚀 セットアップ手順

### 1. リポジトリのクローン & 依存ツールの準備

```bash
git clone https://github.com/your-username/GoogleClassroomNotification.git
cd GoogleClassroomNotification

# clasp (Google Apps Script CLI) のインストール（未導入の場合）
npm install -g @google/clasp
clasp login
```

### 2. データベース用 Google スプレッドシートの作成

新規スプレッドシートを作成し、シート名を `Sheet1` に設定します。
1行目（ヘッダー行）に以下の列名を定義してください：

| 列番号 | カラム名 | 説明 | 例 |
|---|---|---|---|
| A (1) | `id` | 連番ID | `1` |
| B (2) | `accountEmail` | ログイン中Googleアカウント | `student@example.com` |
| C (3) | `receiverEmail` | 受信先メールアドレス | `parent@example.com` |
| D (4) | `time` | 通知希望時刻 | `07:30` |
| E (5) | `isVerified` | メール認証フラグ | `TRUE` / `FALSE` |
| F (6) | `token` | メール確認用ワンタイムUUID | `d8a7...` |
| G (7) | `expiredTime` | トークン有効期限 | `2026/04/01 10:00` |

> [!IMPORTANT]
> スプレッドシートのアクセス権限は、システムの管理者アカウントのみに限定してください（一般公開しないでください）。
> URL中のスプレッドシートID（`https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`）を控えておきます。

### 3. Google Cloud Console での OAuth 2.0 クライアント設定

1. [Google Cloud Console](https://console.cloud.google.com/) で新規プロジェクトを作成します。
2. **APIとサービス** > **ライブラリ** から **Google Classroom API** を有効化します。
3. **OAuth 同意画面** を設定します（組織内利用の場合は「内部」、一般利用の場合は「外部」）。
4. **認証情報** > **認証情報を作成** > **OAuth クライアント ID** を選択します：
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 承認済みのリダイレクト URI:
     `https://script.google.com/macros/d/{YOUR_GAS_SCRIPT_ID}/usercallback`
5. 作成された **クライアント ID** と **クライアント シークレット** を控えておきます。

### 4. clasp を使用したデプロイ

```bash
# 新規GASプロジェクトの作成または既存プロジェクトへの接続
clasp create --title "ClassroomNotification" --type webapp
# または clasp clone {SCRIPT_ID}

# ソースコードをプッシュ
clasp push
```

### 5. スクリプト プロパティの設定

Google Apps Script エディタ（ブラウザ）を開き、**プロジェクトの設定**（歯車アイコン）> **スクリプト プロパティ** に以下のキーと値を登録します（詳細は `.env.example` を参照）：

| プロパティ名 | 必須 | 説明 | 例 |
|---|---|---|---|
| `SPREADSHEET_ID` | **必須** | 手順2で作成したスプレッドシートID | `1ii2MBtS...` |
| `CLIENT_ID` | **必須** | 手順3で作成したOAuth クライアントID | `xxxx.apps.googleusercontent.com` |
| `CLIENT_SECRET` | **必須** | 手順3で作成したOAuth クライアントシークレット | `GOCSPX-xxxx` |
| `SENDER_EMAIL` | 推奨 | メールの送信元・案内用アドレス | `noreply@example.com` |
| `USE_CACHE` | 任意 | APIレスポンスキャッシュ有効化 (`True` / `False`) | `True` |
| `RESTRICTED_DOMAIN`| 任意 | 受信をブロックしたい特定ドメイン | `school.ed.jp` |
| `INQUIRY_FORM_URL` | 任意 | お問い合わせ・配信停止フォームURL | `https://forms.gle/...` |

### 6. 自動送信用トリガーの設定

GASエディタの **トリガー**（時計アイコン）から新規トリガーを追加します：
- **実行する関数**: `triggerEveryMinute`
- **イベントのソース**: `時間主導型`
- **時間ベースのトリガーのタイプ**: `分ベースのタイマー`
- **時間の間隔**: `1分ごと`

---

## 🔒 セキュリティ & プライバシーに関する注意点

- **最小権限**: Google Apps Script は Classroom の読み取りおよびメール送信に必要な権限のみを要求します。不要な Google Drive 権限は要求しません。
- **XSS / HTMLインジェクション対策**: Classroom のお知らせや添付ファイル情報のレンダリングには HTML エスケープ処理が施されています。
- **シークレットの管理**: スプレッドシートIDや OAuth クライアント情報はすべてスクリプトプロパティ（環境変数）に分離し、ソースコード内への直接記述は禁止されています。

---

## 📜 ライセンス & 免責事項

- 本ソフトウェアは [MIT License](LICENSE) のもとで公開されています。
- **商標免責**: Google Classroom は Google LLC の商標です。本プロジェクトは Google LLC と提携、後援、または承認されたものではありません。
