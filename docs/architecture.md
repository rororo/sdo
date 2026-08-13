# アーキテクチャ

## アプリケーション

ブラウザは `POST /api/transform` に `.xlsx` を送信します。Hono
APIは拡張子、空ファイル、20MBの上限を検証し、ワークブックをメモリ上で変換してダウンロード応答を返します。アップロード内容は永続化しません。

変換ロジックは `server/transformer.ts`
に集約しています。業務ルール追加時はこの関数と対応するDenoテストを変更します。ブラウザ画面はReactとVite、APIはHonoで構成し、どちらも同じDenoプロジェクトで管理します。

ログイン前は認証画面だけを表示します。ユーザー名とパスワードは実行環境の環境変数から読み込み、認証後は署名と有効期限を持つHttpOnly
Cookieを発行します。変換APIとセッションAPIはこのCookieがないリクエストを拒否します。ヘルスチェックだけはロードバランサーから利用できるよう公開します。

## AWS

通信経路は次のとおりです。

```text
Browser -> CloudFront -> Application Load Balancer -> ECS Fargate
                                                        |
                                                        +-> CloudWatch Logs

Deployment -> ECR -> ECS Fargate
```

- CloudFront: HTTPS終端、動的リクエスト転送、キャッシュ無効化
- Application Load Balancer: ヘルスチェックとECSへの負荷分散
- ECS Fargate: Dockerコンテナの実行
- ECR: Dockerイメージの保管
- CloudWatch Logs: アプリケーションログの保管

ALBのセキュリティグループはAWS管理のCloudFrontオリジン向けプレフィックスリストだけを許可します。加えて、CloudFrontが付与するランダムなヘッダー値をALBリスナールールで検証します。
