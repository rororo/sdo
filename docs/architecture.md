# アーキテクチャ

## アプリケーション

ログイン後、ブラウザは`GET /api/shoes`を呼び出します。Hono APIはJSTの現在月から対象期を
計算し、該当するS3の商品CSVを取得・検証して50件単位で返します。画面表示時に自動取得し、
表示中も1時間ごとに再取得します。同一ECSタスク内では商品データを1時間メモリキャッシュし、
画面表示やページ移動のたびに約12MBのCSVを読み直すことを防ぎます。キャッシュ期限後の最初の
リクエストでS3から最新データを取得します。

「Excelをダウンロード」は`GET /api/shoes.xlsx`を呼び出し、現在の全商品を固定マスタと照合して
21列の登録用ワークブックを生成します。商品CSVと生成ファイルは永続化せず、メモリ上で処理します。

「ピックアップリスト」では、ファイル選択後の確定操作でSafeSizeエラーリストを
`POST /api/pickup-list`へ送信します。APIは3店舗の在庫CSVを取得し、指定された進捗管理・提出
フォーマットの18列データと、同じ処理で生成したワークブックを返します。ブラウザは18列データを
表として表示し、ワークブックはダウンロード操作までメモリ上に保持します。在庫CSVは商品CSVとは
別に1時間メモリキャッシュし、アップロードファイルと生成ファイルは永続化しません。

```text
Browser -- GET /api/shoes ------> Hono API -- GetObject --> S3 product CSV
        -- GET /api/shoes.xlsx ->          -- lookup ----> fixed master CSV
                                              |
                                              +----------> generated Excel
        -- POST /api/pickup-list ----------> GetObject --> S3 inventory CSV
                                              |
                 SafeSize error workbook -----+----------> 18-column preview + Excel
```

画面はReactとVite、APIはHono、S3取得と変換はDeno/TypeScriptで構成し、1つのDockerコンテナで
実行します。`server/app.ts`を唯一の入口とし、認証・商品・ピックアップリスト・ヘルスチェックを
機能単位のrouteへまとめます。商品CSVと在庫CSVのS3取得および1時間キャッシュは
`server/repositories/`、2つの変換とExcel生成は`server/transforms/`が担当します。

クライアントは`client/src/pages/`でログイン、商品一覧、ピックアップリストの状態と表示を分け、
複数ページで使う画面枠だけを`client/src/components/`で共有します。

ログイン前は認証画面だけを表示します。ユーザー名とPBKDF2-SHA256パスワードハッシュは Secrets
ManagerからECSの環境変数へ注入し、パスワードの平文は保存しません。認証後は署名と
有効期限を持つHttpOnly Cookieを発行します。商品API、Excel API、セッションAPIはこのCookieが
ないリクエストを拒否します。ヘルスチェックだけはロードバランサーから利用できるよう公開します。

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
- Secrets Manager: ログインユーザー名とパスワードハッシュの保管
- ECSタスクロール: 商品CSVと店舗在庫CSVに限定した`GetObject`権限
- S3: 定期更新される商品CSVと店舗在庫CSVの保管
- ECR: Dockerイメージの保管
- CloudWatch Logs: アプリケーションログの保管

ALBのセキュリティグループはAWS管理のCloudFrontオリジン向けプレフィックスリストだけを許可します。
加えて、CloudFrontが付与するランダムなヘッダー値をALBリスナールールで検証します。
CloudFrontにはWAFを関連付け、IP許可リストに含まれる接続元だけを許可します。
