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

`.env`の`APP_USER`と`APP_PASSWORD`を変更してください。十分に長いパスワードを使用します。
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
export TF_VAR_app_password="$APP_PASSWORD"
terraform -chdir=terraform init \
  -backend-config="bucket=YOUR_STATE_BUCKET" \
  -backend-config="key=excel-transformer/terraform.tfstate" \
  -backend-config="region=ap-northeast-1"
terraform -chdir=terraform plan
terraform -chdir=terraform apply
```

TerraformはECSタスクロールへ、指定バケットの`sdo/shoe_products/*`だけを読み取れる
`s3:GetObject`権限を設定します。アクセスキーはコンテナへ渡さず、ECSタスクロールを使用します。

## アプリケーション更新

環境変数を設定し、スクリプトを実行します。イメージタグには上書き可能な `latest`
ではなく、コミットIDなど一意の値を指定します。

```bash
set -a
source .env
set +a
export AWS_PROFILE=your-profile
export AWS_REGION=ap-northeast-1
export AWS_ACCOUNT_ID=123456789012
export SHOE_DATA_BUCKET=scanalytics-report
export IMAGE_TAG=$(git rev-parse --short HEAD)
./deploy/deploy.sh
```

スクリプトはDockerイメージを `linux/amd64`
向けにビルドしてECRへ送信し、ECSのタスク定義を更新してサービスの安定化まで待機します。

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
本番では`AWS_PROFILE`と`SHOE_DATA_KEY`を設定せず、ECSタスクロールとJSTの現在月から計算したキーを
使用します。

```bash
deno task check
deno task test
deno task build
```
