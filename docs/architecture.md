# アーキテクチャ

## アプリケーション

ログイン後、ブラウザは`GET /api/shoes`を呼び出します。Hono APIはJSTの現在月から対象期を
計算し、該当するS3の商品CSVを取得・検証して50件単位で返します。画面表示時に自動取得し、
表示中も1時間ごとに再取得します。同一ECSタスク内では商品データを1時間メモリキャッシュし、
画面表示やページ移動のたびに約12MBのCSVを読み直すことを防ぎます。キャッシュ期限後の最初の
リクエストでS3から最新データを取得します。

「Excelをダウンロード」は`GET /api/shoes.xlsx`を呼び出し、現在の全商品を固定マスタと照合して
21列の登録用ワークブックを生成します。商品CSVと生成ファイルは永続化せず、メモリ上で処理します。

```text
Browser -- GET /api/shoes ------> Hono API -- GetObject --> S3 product CSV
        -- GET /api/shoes.xlsx ->          -- lookup ----> fixed master CSV
                                              |
                                              +----------> generated Excel
```

画面はReactとVite、APIはHono、S3取得と変換はDeno/TypeScriptで構成し、1つのDockerコンテナで
実行します。商品CSVの解析とExcel生成は`server/transformer.ts`、S3の対象期計算・取得・キャッシュは
`server/shoe_data_source.ts`に集約しています。

ログイン前は認証画面だけを表示します。ユーザー名とパスワードは実行環境の環境変数から読み込み、
認証後は署名と有効期限を持つHttpOnly Cookieを発行します。商品API、Excel API、セッションAPIは
このCookieがないリクエストを拒否します。ヘルスチェックだけはロードバランサーから利用できるよう
公開します。

## AWS

通信とデータ取得の経路は次のとおりです。

```text
Browser -> CloudFront -> Application Load Balancer -> ECS Fargate -> S3
                                                        |
                                                        +-> CloudWatch Logs

Deployment -> ECR -> ECS Fargate
```

- CloudFront: HTTPS終端、動的リクエスト転送、キャッシュ無効化
- Application Load Balancer: ヘルスチェックとECSへの負荷分散
- ECS Fargate: Dockerコンテナの実行
- ECSタスクロール: `sdo/shoe_products/*`に限定した`GetObject`権限
- S3: 日次更新される商品CSVの保管
- ECR: Dockerイメージの保管
- CloudWatch Logs: アプリケーションログの保管

ALBのセキュリティグループはAWS管理のCloudFrontオリジン向けプレフィックスリストだけを許可します。
加えて、CloudFrontが付与するランダムなヘッダー値をALBリスナールールで検証します。
