# Archon Ops

Dynatrace のマルチテナント環境を管理するための社内 UI：[Monaco CLI](https://github.com/Dynatrace/dynatrace-configuration-as-code) のコマンド（`deploy` / `download`）をキューイングして実行し、クライアント／環境ごとのローカル Git リポジトリにバックアップをバージョン管理して保存します。外部のサービスに依存することなく動作します。

機能の詳細やアーキテクチャについては、`specs/requirements.md`、`specs/design.md`、および `specs/tasks.md` を参照してください。

## ⚠️ 免責事項 (Disclaimer)

本ソフトウェアは **「現状有姿」 (AS IS)** で提供され、明示または黙示を問わず、いかなる保証もありません。使用を開始することで、以下の条件に同意したものとみなされます：

- **デプロイ（deploy）操作は、対象環境の実際の構成を上書きします。** 不適切なデプロイは設定の変更、不整合、または監視の破損を引き起こす可能性があります。本番デプロイの前にダブル確認が求められますが、**操作の実行に伴う責任はすべてオペレーターに帰属します**。
- 開発者および貢献者は、本ツールの使用から生じる構成の紛失、監視の停止、消費コスト、またはその他の直接的・間接的な損害について**一切の責任を負いません**。
- 本番デプロイを行う前に、必ず **ドライラン（dry-run）** を実行し、ログ全体を確認してください。対象環境の最新のバックアップを保持してください（本ツールはバックアップを容易にしますが、バックアップの検証責任はオペレーターにあります）。
- 本ツールは **Dynatrace の公式製品ではなく**、Dynatrace LLC との提携関係もありません。Monaco CLI および使用されている API はそれぞれの所有者に帰属します。使用許諾条件をご確認ください。

本番環境を操作する前に、まずテスト環境に対して検証を行い、ワークフローを確認してください。

## 必要要件

- Node.js 20.19+ / 22.12+ (推奨、下記の互換性に関する注意を参照)
- サーバー／マシンに Git がインストールされていること
- **Dynatrace Monaco CLI (v2)** のバイナリがインストールされ、`PATH` に追加されていること（または `.env` に `MONACO_BIN_PATH` として絶対パスを設定すること）。

### Monaco CLI のインストール

#### Windows の場合 (PowerShell):
1. [Dynatrace の Releases ページ](https://github.com/dynatrace/dynatrace-configuration-as-code/releases) から実行ファイルをダウンロードします：
   ```powershell
   # 最新の安定版をダウンロード（Windows amd64 用の例）
   Invoke-WebRequest -Uri "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-windows-amd64.exe" -OutFile "C:\dynatrace\monaco.exe"
   ```
2. `C:\dynatrace\` をシステムの環境変数（`PATH`）に追加するか、`.env` ファイルにその絶対パスを定義します：
   ```env
   MONACO_BIN_PATH="C:\\dynatrace\\monaco.exe"
   ```

#### Linux / macOS の場合 (Bash):
1. ダウンロードして実行権限を付与します：
   ```bash
   # Linux amd64 用のダウンロード
   sudo curl -L "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-linux-amd64" -o /usr/local/bin/monaco
   sudo chmod +x /usr/local/bin/monaco
   ```
2. ユーザーディレクトリ配下に配置したい場合は、`.env` ファイルにそのパスを設定してください：
   ```env
   MONACO_BIN_PATH="/home/user/bin/monaco"
   ```

> **互換性に関する注意：** 本プロジェクトは Node 20.16 環境で初期化され、検証されています。Node が 20.16 またはそれに近いバージョンの場合は、既にインストールされている `prisma@6`/`@prisma/client@6` を使用してください。Prisma 7+ は Node 20.19+ を要求します。

## インストール（ローカル開発、シングルユーザー用）

```bash
npm install
cp .env.example .env
# .env を編集：最低限 ENCRYPTION_KEY と SEED_ADMIN_PASSWORD を変更します。
# ENCRYPTION_KEY は以下のコマンドで生成できます：
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npx prisma migrate dev
npx prisma db seed   # 管理者ユーザーを作成 (SEED_ADMIN_EMAIL/PASSWORD)

# 開発用サーバーを起動（デフォルトポート 3000、またはカスタムポートを指定）
PORT=3080 npm run dev
```

http://localhost:3000 （または指定したポート番号）を開き、初期化された資格情報でログインし、最初のクライアントと環境を作成してください。

## サーバーでの利用（マルチクライアントおよび永続化実行）

1. `prisma/schema.prisma` 内の `datasource.provider` を `"postgresql"` に変更し、`.env` 内の `DATABASE_URL` を使用する PostgreSQL に変更します。
2. `DATA_DIR` にサーバー上の永続的なディレクトリ（例：専用ディスク）のパスを指定します。ここに各クライアント／環境の Git リポジトリが保存されます。
3. 本番用にアプリケーションをビルドします：
   ```bash
   npm run build
   ```
4. **PM2 を使用した実行**：
   プロジェクトのルートにすぐに使用できる `ecosystem.config.js` ファイルが含まれています。PM2 をグローバルにインストールして、アプリを簡単に起動できます：
   ```bash
   # PM2 がインストールされていない場合はインストール
   npm install -g pm2

   # アプリケーションを起動（設定ファイルや環境変数で指定したポートで起動します）
   pm2 start ecosystem.config.js

   # 起動時に動的にポートを変更したい場合：
   PORT=4000 pm2 restart archon-ops --update-env
   ```
   *注意: ジョブを実行する内部 Worker は Next.js の Node プロセス内で動作するため、Redis や外部キューサービスは必要ありません。*

## 仕組みについて

- **デプロイ／バックアップ** アクションは環境の UI からトリガーされ、データベースに `Job` レコードが作成されます（HTTP リクエスト内で即座にコマンドは実行されません）。
- 内部の Worker スレッド (`lib/server/worker.ts`) が `PENDING` 状態のジョブを取得し、トークンを環境変数として差し込んで `child_process.spawn` 経由で `monaco` を呼び出します（トークンはログに出力されません）。その後、Server-Sent Events (`/api/jobs/:id/stream`) を用いてリアルタイムログを UI にストリーミングします。
- バックアップ（またはデプロイ）が正常に完了すると、その環境のローカル Git リポジトリ（`DATA_DIR/<client>/<environment>`）へ自動コミットが実行されます。リモートは設定されておらず、ローカルでの履歴管理のみに使用されます。
- すべての Dynatrace トークンは暗号化（AES-256-GCM）されて保存され、ログが保存される前にトークン情報などはマスク処理されます。

## Dynatrace の権限 (トークンとスコープ)

各環境では最大で **3つの異なる資格情報** を使用し、各機能は必要なスコープのみを要求します。セクションが `403` を返す場合、該当する資格情報にこのテーブルのスコープが不足しています。環境の編集フォームから、保存前に資格情報を検証するための **Test（テスト）** ボタンを利用できます。

| 資格情報のタイプ | 用途 | 必要なスコープ／権限 |
|---|---|---|
| **クラシック API トークン** (`Api-Token`) | Monaco: `download` と `deploy` | `ReadConfig`, `settings.read` (バックアップ) · `WriteConfig`, `settings.write` (デプロイ) |
| **Platform トークン** (`dt0s16`) — ダッシュボード | ダッシュボード管理 (Document API) | `document:documents:read`, `document:documents:write`, `document:documents:admin` |
| **Platform トークン** (`dt0s16`) — Lookups | Grail ファイルのアップロード/一覧/ダウンロード/削除 (Grail Resource Store) | `storage:files:read`, `storage:files:write`, `storage:files:delete`, `storage:buckets:read`, `storage:system:read` |
| **アカウント OAuth クライアント** (`dt0s02`) | SSO ID → メールアドレスの解決 (Account API) | `account-idm-read` |

> 各環境における Platform トークンは**1つだけ**です。上記のダッシュボードと Lookups の両方のスコープセットを持っていれば、同じトークンで両方を管理できます。

### ⚠️ Platform トークンには「2重のロック」があります

Platform トークンは、作成時にスコープを選択するだけでは機能しません。**実効権限**は以下の積集合になります：

```
実効権限 = (トークンのスコープ)  ∩  (トークン所有者ユーザーの IAM ポリシー)
```

すなわち、トークン自体のスコープに加えて、**トークンを作成したユーザーのグループに対するグループポリシー**がそれらのアクセスを許可している必要があります。Grail ファイル（Lookups）を操作する場合、ポリシーに以下を含める必要があります（パスの boundary 制限は環境に合わせて調整してください）：

```
ALLOW storage:files:read, storage:files:write, storage:files:delete
WHERE storage:file-path startsWith "/lookups/";
ALLOW storage:buckets:read;
ALLOW storage:system:read;
```

トークンにスコープを設定したにもかかわらず `403` エラーが発生する主な原因：

- **Platform トークンは作成後にスコープを追加できません。** スコープを変更する場合は、新しくトークンを生成し直して環境に設定し直してください。
- トークンは**その作成者**の権限で動作します。ポリシーが構成されているグループに、トークンの作成者が属していない場合は適用されません。
- ポリシーの **boundary**（パスや環境による制限）が一致しないと暗黙的に拒否されます。対象環境と `/lookups/` パスがカバーされているか確認してください。

Lookups セクションの **Test** ボタンは、読み取りと書き込みのテスト（`read` / `write`）を個別に報告するため、不足している権限の特定に役立ちます。

## ディレクトリ構成

詳細なフォルダ構成（`app/`、`lib/`、`prisma/`）については、`specs/design.md` の第 7 節を参照してください。
