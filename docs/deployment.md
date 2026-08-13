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

```bash
deno task check
deno task test
deno task build
```
