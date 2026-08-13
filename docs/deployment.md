# デプロイ

## 事前準備

- AWS CLI、Docker、Terraform 1.6以降、Deno 2.9以降
- 使用するAWSアカウントへの権限
- Terraform stateを保管するS3バケット
- `jq`

認証情報を設定します。`.env`はバージョン管理対象外です。

```bash
cp .env.example .env
```

`.env`の`APP_USER`と`APP_PASSWORD_HASH`を設定してください。パスワードの平文は保存せず、
PBKDF2-SHA256ハッシュだけを管理します。
`AWS_REGION`と`SHOE_DATA_BUCKET`は通常、例の値をそのまま利用できます。

## インフラ作成

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
```

値を編集した後、バックエンド設定を指定して初期化します。

```bash
set -a
source .env
set +a
export TF_VAR_app_user="$APP_USER"
export TF_VAR_app_password_hash="$APP_PASSWORD_HASH"
terraform -chdir=terraform init \
  -backend-config="bucket=YOUR_STATE_BUCKET" \
  -backend-config="key=excel-transformer/terraform.tfstate" \
  -backend-config="region=ap-northeast-1"
terraform -chdir=terraform plan
terraform -chdir=terraform apply
```

TerraformはECSタスクロールへ、指定バケットの商品CSVと店舗在庫CSVだけを読み取れる
`s3:GetObject`権限を設定します。ログインユーザー名とパスワードハッシュはSecrets Managerへ
保存し、ECS実行ロールで取得します。アクセスキーやパスワードの平文はコンテナへ渡しません。

## アプリケーション更新

ルートの`Makefile`から実行します。イメージタグは現在のコミットIDが既定値です。
AWSアカウントIDは指定したプロファイルから自動取得します。

```bash
make deploy
```

プロファイル、リージョン、イメージタグを変更する場合はMake変数で指定します。

```bash
make deploy \
  AWS_PROFILE=your-profile \
  AWS_REGION=ap-northeast-1 \
  IMAGE_TAG=$(git rev-parse --short HEAD)
```

`make deploy`はDockerイメージを`linux/amd64`向けにビルドしてECRへ送信し、Secrets Managerの
認証情報を参照するECSタスク定義を登録します。その後、ECSサービスを更新して安定化まで待機します。

## ローカル開発

```bash
cp .env.example .env
deno install
deno task dev
```

画面は `http://localhost:5173`、APIは `http://localhost:8000`
で起動します。確認コマンドは次のとおりです。

ローカルではAWS SDKが`.env`の`AWS_PROFILE`を使用して`~/.aws/config`と
`~/.aws/credentials`から認証情報を読み取ります。初期値は`xebio`です。別のプロファイルを使う場合は
`.env`だけを変更してください。特定キーで確認する場合だけ`.env`の`SHOE_DATA_KEY`を設定します。
在庫キーを切り替えるローカル確認では`SHOE_INVENTORY_KEY`を設定できます。本番では
`AWS_PROFILE`、`SHOE_DATA_KEY`、`SHOE_INVENTORY_KEY`を設定せず、ECSタスクロールと既定キーを
使用します。

```bash
deno task check
deno task test
deno task build
```
