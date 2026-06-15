# discord-mcp

**読み取り専用の Discord MCP サーバー**（Streamable HTTP）。各メンバーのAIエージェント
（Claude Code / Codex CLI / Gemini CLI）からリモート接続して、このDiscordサーバーの会話を
読み込み、要約・レポート化するためのものです。

- **読み取り専用。** ツールは「チャンネル一覧」「メッセージ取得」「画像添付の取得」のみ。
  送信・削除系のツールは意図的に作っていません。
- **リモート。** Streamable HTTP トランスポート（stdioではない）。Bearerトークン認証付き。
- **複数人。** 1人1トークンを配布（14個）。一致すれば通す方式。トークンの追加・削除は
  環境変数1つを編集するだけ。

---

## まずはここだけ — 変えるのは3つだけ

| 何を | どこで | どうやって |
| --- | --- | --- |
| **イメージ名** | `k8s/kustomization.yaml`（`images:`） | `cd k8s && kustomize edit set image REGISTRY_PLACEHOLDER/discord-mcp=<自分のレジストリ>/discord-mcp:<タグ>` |
| **ホスト名** | `k8s/patches/host-patch.yaml` | `value:` を自分のドメインに編集 |
| **トークン類** | k8s Secret | `kubectl create secret …`（手順4） |

それ以外は動くデフォルトが入っています。

---

## しくみ・構成（要点）

- **Node.js + TypeScript。** `@discordjs/rest`（RESTのみ）+ 公式 MCP TypeScript SDK
  （`@modelcontextprotocol/sdk`）+ Express。
- **Discord Gateway への常時接続なし。** 履歴はオンデマンドで Discord REST API から取得。
  Bot が Developer Portal で **MESSAGE CONTENT** 特権インテントを有効にしていれば、REST
  でも本文が返るため、常時 WebSocket セッションは不要。これによりサーバーはステートレスで
  軽く、`replicas: 1` で安定。
- **ステートレスな MCP トランスポート。** リクエストごとに server + transport を生成
  （`sessionIdGenerator: undefined`, `enableJsonResponse: true`）。14人がサーバー側の
  セッション管理なしで独立して接続できる。

### Discord Bot の前提

1. **Developer Portal → Bot → Privileged Gateway Intents** で **MESSAGE CONTENT INTENT**
   を有効化する。
2. 要約したいチャンネルに対し、最低でも **View Channel** + **Read Message History** 権限を
   持たせて Bot を招待する。
3. 必要なもの: **Botトークン**、**ギルド（サーバー）ID**、（任意で）チャンネルID。
   チャンネルはエージェントが `list_channels` で発見することもできる。

---

## エージェントに見えるツール

| ツール | 入力 | 返り値 |
| --- | --- | --- |
| `list_channels` | `guild_id?`（省略時は設定済みサーバー） | `[{ id, name, type, parent_id, topic }]` |
| `read_messages` | `channel_id`, `limit?`（1〜`MAX_MESSAGE_LIMIT`、既定50）, `before?`, `after?` | 新しい順のメッセージ: `{ id, author{id,username,display_name,bot}, timestamp, content, attachments[], reply_to_id, edited_timestamp }`。REST を自動ページング（100件/回）。 |
| `get_attachment_image` | `channel_id`, `message_id`, `attachment_id` | 画像を base64 の MCP image コンテンツで返す。メッセージを再取得して**新しい署名付きURL**を得るため、`read_messages` が返したURLが期限切れでも読める。 |

`read_messages` の画像添付には署名付き `url`（`filename`, `content_type`, `is_image`）が
含まれます。エージェントが確実にバイト列を読む必要があるときは `get_attachment_image` を
使ってください。

---

## デプロイ（イメージをビルドする人＝適用する人）

### 1. clone

```bash
git clone <このリポジトリ> discord-mcp
cd discord-mcp
```

### 2. マルチアーキのイメージをビルドして自分のレジストリにpush

OCI Ampere A1 ノードは **arm64**、x86 ノードは **amd64** です。スケジュールされる先がどちらでも
動くよう、`buildx` で両対応イメージを作ります:

```bash
# 初回のみ: マルチプラットフォーム対応のビルダーを用意
docker buildx create --use --name multi || docker buildx use multi

# linux/amd64 と linux/arm64 を1つのマニフェストにまとめてビルド＆push
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t <自分のレジストリ>/discord-mcp:<タグ> \
  --push .
```

> マルチプラットフォームビルドには `--push` が必須です（ローカルの `--load` はマルチアーキ
> マニフェストを保持できない）。OCIR の場合、レジストリは
> `<region-key>.ocir.io/<tenancy-namespace>/discord-mcp` の形になります。

### 3. kustomize に自分のイメージを指定

```bash
cd k8s
kustomize edit set image REGISTRY_PLACEHOLDER/discord-mcp=<自分のレジストリ>/discord-mcp:<タグ>
cd ..
```

`images:` の項目が書き換わります。Deployment 側は `REGISTRY_PLACEHOLDER/...` のプレース
ホルダのままで、kustomize が値を差し替えます。

### 4. namespace と Secret（Botトークン + 接続トークン）を作成

マニフェストは `discord-mcp-secrets` という名前の Secret からすべて読み込みます。秘密の値は
git に入りません。

まず接続トークンを生成します（下の[トークン](#接続トークン)参照）:

```bash
npm install        # 初回のみ。生成スクリプトの依存を取得
npm run gen-tokens # tokens-env.txt と tokens-map.csv を出力（git-ignored）
```

次に namespace と Secret を作成します:

```bash
kubectl create namespace discord-mcp

kubectl -n discord-mcp create secret generic discord-mcp-secrets \
  --from-literal=DISCORD_BOT_TOKEN='<Botトークン>' \
  --from-literal=DISCORD_GUILD_ID='<ギルドID>' \
  --from-literal=MCP_AUTH_TOKENS='<tok1,tok2,...,tok14>'
```

> `MCP_AUTH_TOKENS` には `tokens-env.txt` の `MCP_AUTH_TOKENS=` 以降のカンマ区切り値を入れ
> ます。後でメンバーを追加・削除するときはこの Secret を更新して Pod を再起動:
> `kubectl -n discord-mcp rollout restart deploy/discord-mcp`。

#### private レジストリの pull secret（OCIR は通常 private）

pull に認証が必要なレジストリなら、docker-registry secret を作って紐づけます:

```bash
kubectl -n discord-mcp create secret docker-registry ocir-pull-secret \
  --docker-server='<region-key>.ocir.io' \
  --docker-username='<tenancy-namespace>/<oci-username>' \
  --docker-password='<auth-token>' \
  --docker-email='<任意のメール>'
```

その後、`k8s/serviceaccount.yaml` か `k8s/deployment.yaml` の `imagePullSecrets` の
コメントを外して参照します（名前 `ocir-pull-secret` はコメント内に記入済み）。

### 5. 適用

```bash
kustomize build k8s | kubectl apply -f -
```

### 6. ホスト名を設定

`k8s/patches/host-patch.yaml` の `value:` を自分のドメイン（例:
`discord-mcp.example.org`）に編集して、手順5を再適用します。ホスト名はこのパッチ1箇所
だけにあります。

**TLS**（どちらか選び、`k8s/ingress.yaml` 内にコメントで示した `tls:` ブロックを追加）:

- **cert-manager + Let's Encrypt:** `ingress.yaml` の
  `cert-manager.io/cluster-issuer` アノテーションのコメントを外し、`secretName:
  discord-mcp-tls` の `tls:` ブロックを追加して再適用。cert-manager が secret を
  埋めます。（TLSを有効にする場合は `host-patch.yaml` に
  `/spec/tls/0/hosts/0` を置換する op も追加してください。）
- **既存のワイルドカード証明書を持っている場合:** 証明書/鍵から TLS secret を作り、その
  名前で `tls:` ブロックを追加:
  ```bash
  kubectl -n discord-mcp create secret tls wildcard-tls \
    --cert=fullchain.pem --key=privkey.pem
  ```

### 7. 接続確認

```bash
# ヘルスチェック（認証不要）
curl https://<自分のホスト>/healthz
# -> {"status":"ok"}

# MCP tools/list（認証必須）。正しいトークンなら JSON-RPC の結果、誤りなら 401
curl -sS https://<自分のホスト>/mcp \
  -H 'Authorization: Bearer <配ったトークンのどれか>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

正しいトークンならツール一覧が返り、無し/不正なら HTTP 401 が返ります。

---

## 各エージェントからの接続

`<HOST>` を自分のドメイン、`<TOKEN>` をその人のトークンに置き換えてください。

### Claude Code

```bash
claude mcp add --transport http discord https://<HOST>/mcp \
  --header "Authorization: Bearer <TOKEN>"
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.discord]
url = "https://<HOST>/mcp"
http_headers = { Authorization = "Bearer <TOKEN>" }
```

### Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "discord": {
      "httpUrl": "https://<HOST>/mcp",
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```

> フラグ名・フィールド名は CLI のバージョンで変わることがあります。ヘッダ指定の書式で弾か
> れる場合は、その CLI の「リモート/HTTP MCP サーバー」の最新ドキュメントを確認してくださ
> い。サーバー側が必要とするのは `POST /mcp` への `Authorization: Bearer <token>` だけです。

---

## 接続トークン

1人1トークンを生成して配ります。

```bash
npm run gen-tokens            # 14トークン、名前は person01..person14
npm run gen-tokens -- 20      # 個数を変える
npm run gen-tokens -- alice bob carol   # 名前を明示
```

git-ignored の2ファイルが出力されます（秘密として扱い、配り終えたら削除）:

- **`tokens-env.txt`** — Secret に貼る用の1行 `MCP_AUTH_TOKENS=tok1,tok2,...`（手順4）。
- **`tokens-map.csv`** — `name,token` の対応表。誰にどれを配ったか管理する用。

**配布の流れ:** 生成 → env行を Secret に貼る → 各自に *その人のトークンだけ* をプライベートな
経路で送る → 失効・ローテーションに備えて `tokens-map.csv` を安全に保管（または削除）。
誰か1人を失効させたいときは、その人のトークンを `MCP_AUTH_TOKENS` から外して Secret を更新し、
`rollout restart` します。

---

## ローカル開発

```bash
npm install
cp .env.example .env   # DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, MCP_AUTH_TOKENS を記入
npm run dev            # tsx watch、http://localhost:3000
# または
npm run build && npm start
```

## 環境変数

[`.env.example`](./.env.example) を参照。必須: `DISCORD_BOT_TOKEN`,
`DISCORD_GUILD_ID`, `MCP_AUTH_TOKENS`。任意: `PORT`（3000）,
`MAX_MESSAGE_LIMIT`（500）。
