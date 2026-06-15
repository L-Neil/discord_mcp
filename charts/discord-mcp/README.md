# discord-mcp Helm chart

読み取り専用 Discord MCP サーバー（Streamable HTTP）を Kubernetes にデプロイする Helm
チャートです。リポジトリ直下の `k8s/`（kustomize）と同じ構成を、values で調整できる形に
したものです。

## 前提

- Kubernetes 1.21+ / Helm 3.x
- マルチアーキ（amd64/arm64）のイメージが push 済みであること（同梱の GitHub Actions が
  `ghcr.io/<owner>/discord-mcp` に push します）。`image.repository` を自分のレジストリに
  合わせてください。

## Secret を先に作る（推奨）

チャートはデフォルトで既存 Secret `discord-mcp-secrets` を参照します（トークンを Helm の
release 履歴に残さないため）。先に作成してください:

```bash
kubectl create namespace discord-mcp

kubectl -n discord-mcp create secret generic discord-mcp-secrets \
  --from-literal=DISCORD_BOT_TOKEN='<Botトークン>' \
  --from-literal=DISCORD_GUILD_ID='<ギルドID>' \
  --from-literal=MCP_AUTH_TOKENS='<tok1,tok2,...>'
```

> トークン一覧は `npm run gen-tokens` で生成できます（リポジトリ README 参照）。

## インストール

```bash
helm install discord-mcp ./charts/discord-mcp \
  --namespace discord-mcp --create-namespace \
  --set image.repository=ghcr.io/<owner>/discord-mcp \
  --set image.tag=latest \
  --set 'ingress.hosts[0].host=discord-mcp.your-domain.example'
```

### Helm に Secret も作らせる場合

git に値を残さないよう `--set` で渡します:

```bash
helm install discord-mcp ./charts/discord-mcp \
  --namespace discord-mcp --create-namespace \
  --set secret.create=true \
  --set secret.botToken='<Botトークン>' \
  --set secret.guildId='<ギルドID>' \
  --set secret.authTokens='<tok1,tok2,...>'
```

## 主な values

| キー | 既定 | 説明 |
| --- | --- | --- |
| `image.repository` | `ghcr.io/l-neil/discord-mcp` | イメージのリポジトリ |
| `image.tag` | `""`（= `Chart.appVersion`） | イメージタグ |
| `replicaCount` | `1` | ステートレスなので通常 1 で十分 |
| `secret.create` | `false` | true で Secret をチャートが作成 |
| `secret.existingSecret` | `discord-mcp-secrets` | 参照する既存 Secret 名 |
| `config.port` | `3000` | コンテナの待受ポート（`PORT`） |
| `config.maxMessageLimit` | `500` | `read_messages` の上限（`MAX_MESSAGE_LIMIT`） |
| `service.type` / `service.port` | `ClusterIP` / `80` | Service 設定 |
| `ingress.enabled` | `true` | Ingress を作成するか |
| `ingress.className` | `traefik` | IngressClass（k3s 既定） |
| `ingress.hosts[0].host` | `discord-mcp.example.com` | 公開ホスト名 |
| `ingress.tls` | `[]` | TLS 設定（cert-manager もしくは手動 secret） |
| `resources` | requests 50m/128Mi, limits 250m/256Mi | リソース |
| `imagePullSecrets` | `[]` | private レジストリの pull secret |

すべての値は [`values.yaml`](./values.yaml) を参照してください。

## TLS

`ingress.annotations` に `cert-manager.io/cluster-issuer` を足し、`ingress.tls` を設定します:

```yaml
ingress:
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  tls:
    - secretName: discord-mcp-tls
      hosts:
        - discord-mcp.your-domain.example
```

## 動作確認

```bash
helm test discord-mcp -n discord-mcp   # /healthz を叩くテスト Pod を実行
```

## アンインストール

```bash
helm uninstall discord-mcp -n discord-mcp
```

> `secret.create=false`（既定）の場合、`discord-mcp-secrets` はチャート管理外なので
> アンインストールしても削除されません。
