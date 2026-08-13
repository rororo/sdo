# シューズデータ管理

S3へ定期連携されるシューズ商品CSVを、ログイン後の画面に常時表示する業務アプリケーションです。
対象期はJSTの現在月から自動判定します。

- ユーザー名とパスワードによるログイン
- S3の商品CSVを50件単位で一覧表示
- 画面表示時の自動取得と1時間のサーバーメモリキャッシュ
- CSVで管理する固定の部門・品種・品目マスタによる変換
- 登録形式21列のExcelダウンロード
- SafeSizeエラーリストと2店舗の最新在庫からピックアップリストを作成
- アップロード確定後に提出フォーマットを画面表示し、同じ内容のExcelをダウンロード
- Reactの画面とHono APIを1つのDeno/Dockerコンテナで実行

データの参照先は [`docs/scanalytics-sdo-data.md`](docs/scanalytics-sdo-data.md)、変換規則と
エラー条件は [`docs/shoes-master-spec.md`](docs/shoes-master-spec.md) と
[`docs/pickup-list-spec.md`](docs/pickup-list-spec.md) を参照してください。

固定マスタは `server/data/department_item_master.csv` で管理します。CSVを変更した場合も
アプリケーションコードの変更は不要です。

## ローカル起動

```bash
cp .env.example .env
deno install
deno task dev
```

`.env`の`APP_USER`、`APP_PASSWORD_HASH`と、S3を読み取れるローカルの`AWS_PROFILE`を設定します。
パスワードの平文は保存せず、PBKDF2-SHA256ハッシュだけを管理します。
このリポジトリの初期値は`xebio`です。画面は
商品一覧は`http://localhost:5173/products`、ピックアップリストは
`http://localhost:5173/pickup-list`、APIは`http://localhost:8000`で起動します。

```bash
deno task check
deno task test
deno task build
```
