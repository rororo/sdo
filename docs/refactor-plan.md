# リファクタ計画

## 目的

現行の変換結果を実データintegrationテストで固定したうえで、サーバーとクライアントの責務を読み順に沿って整理する。
業務ロジック、API契約、画面の動作、Excelの出力形式、1時間キャッシュ、単一コンテナ構成は変更しない。

## 実施状況

Phase 0〜7は完了済み。format、lint、type check、単体テスト32件、実データintegrationテスト2件、
production build、Docker build、コンテナのhealth・静的client・未認証APIのsmoke testが成功している。

## 先行して固定した回帰基準

実データとテストは`integration/`へ集約した。

```text
integration/
├── pickup-list-integration.test.ts
├── pickup-list.xlsx
├── shoes-master-integration.test.ts
├── shoes-master.xlsx
└── workbook-test-utils.ts
```

### シューズマスター

- 入力: `shoes-master.xlsx`の`（作業用）抽出データ貼り付け＆加工!A2:M61765`
- 期待値: 同じブックの`Master Data2026FW②!A5:U61767`
- 対象: 61,763件、21列
- 比較: 生成ブックのシート名、ヘッダー、全データセル
- Excel上の空文字と空セルは同値とする
- 文字項目は表示文字列で比較し、`Size`だけは数値型も含めて比較する

### ピックアップリスト

- 在庫入力: `pickup-list.xlsx`の`base1_在庫抽出データ!A1:M19523`
- エラー入力: 同じブックの`base2_error List(from SafeSize)!A1:N4619`
- 期待値: 同じブックの`step2_結合データ商品重複削除(ピックアップリスト)!A2:K32`
- 対象: エラー4,618件、結合263件、重複削除後31件
- 比較: 生成された31件の全11列、行順、提出ブックの連番と集計件数
- 提出ブックの書式、数式、条件付き書式は既存の単体テストで引き続き全体比較する

実行タスクは次の3つに分ける。

```text
deno task test:unit
deno task test:integration
deno task test
```

2026-08-13時点の基準は、単体テスト32件成功、実データintegrationテスト2件成功である。
このintegrationテストはローカルの実データfixtureから変換とExcel生成までを結合して検証する。
S3接続とrepositoryは対象に含めない。

## 設計原則

1. 先にファイル移動とimport更新だけを行い、ロジック変更と同じ差分に混ぜない。
2. サーバーの唯一の実行入口を`server/app.ts`にする。
3. routeはHTTP method単位では分けず、`health`、`auth`、`shoes`、`pickup-list`の機能単位でまとめる。
4. 各routeファイルではendpointを並べ、各handlerを入力、repository取得、変換、レスポンスの順に上から下へ読める形にする。
5. 2つの主要変換は実作業の順番を`step1`、`step2`の関数名で表す。
6. 1箇所だけで使う短い処理は無理に切り出さない。2箇所以上で共有する処理だけ`utils/`へ置く。
7. クライアントはページ単位で状態と表示を所有し、2ページ以上で使うUIだけ共通componentにする。
8. アプリケーションのソース、テスト、fixture、運用リソースはkebab-caseに統一する。
9. `Dockerfile`、`README.md`、`deno.json`など、ツールや慣例が名前を前提にするファイルは例外とする。

## 目標構成

```text
server/
├── app.ts
├── app.test.ts
├── data/
│   ├── department-item-master.csv
│   └── pickup-list-template.xlsx
├── middleware/
│   └── require-auth.ts
├── repositories/
│   ├── department-item-master-repository.ts
│   ├── department-item-master-repository.test.ts
│   ├── shoe-products-repository.ts
│   ├── shoe-products-repository.test.ts
│   ├── store-inventory-repository.ts
│   └── store-inventory-repository.test.ts
├── routes/
│   ├── auth-routes.ts
│   ├── health-routes.ts
│   ├── pickup-list-routes.ts
│   └── shoes-routes.ts
├── transforms/
│   ├── pickup-list-transform.ts
│   ├── pickup-list-transform.test.ts
│   ├── shoes-master-transform.ts
│   └── shoes-master-transform.test.ts
└── utils/
    ├── auth-session.ts
    ├── csv.ts
    ├── pickup-upload.ts
    └── xlsx-response.ts

client/
├── index.html
├── vite-config.ts
└── src/
    ├── app.tsx
    ├── main.tsx
    ├── components/
    │   ├── app-shell.tsx
    │   └── brand-mark.tsx
    ├── pages/
    │   ├── login-page.tsx
    │   ├── pickup-list-page.tsx
    │   └── products-page.tsx
    ├── styles/
    │   ├── app-shell.css
    │   ├── base.css
    │   ├── login-page.css
    │   ├── pickup-list-page.css
    │   └── products-page.css
    └── utils/
        ├── api.ts
        ├── download-file.ts
        ├── routing.ts
        └── routing.test.ts
```

主要な移動対応は次のとおり。

| 現在                                         | 移動後                                                          |
| -------------------------------------------- | --------------------------------------------------------------- |
| `server/transformer.ts`                      | `server/transforms/shoes-master-transform.ts`                   |
| `server/transformer_test.ts`                 | `server/transforms/shoes-master-transform.test.ts`              |
| `server/pickup_list.ts`                      | `server/transforms/pickup-list-transform.ts`                    |
| `server/pickup_list_test.ts`                 | `server/transforms/pickup-list-transform.test.ts`               |
| `server/department_item_master.ts`           | `server/repositories/department-item-master-repository.ts`      |
| `server/department_item_master_test.ts`      | `server/repositories/department-item-master-repository.test.ts` |
| `server/shoe_data_source.ts`                 | `server/repositories/shoe-products-repository.ts`               |
| `server/shoe_data_source_test.ts`            | `server/repositories/shoe-products-repository.test.ts`          |
| `server/store_inventory_data_source.ts`      | `server/repositories/store-inventory-repository.ts`             |
| `server/store_inventory_data_source_test.ts` | `server/repositories/store-inventory-repository.test.ts`        |
| `server/auth.ts`                             | `server/utils/auth-session.ts`                                  |
| `server/csv.ts`                              | `server/utils/csv.ts`                                           |
| `server/app_test.ts`                         | `server/app.test.ts`                                            |
| `server/data/department_item_master.csv`     | `server/data/department-item-master.csv`                        |
| `docs/pickup_list_output.xlsx`               | `server/data/pickup-list-template.xlsx`                         |
| `client/src/App.tsx`                         | `client/src/app.tsx`                                            |
| `client/src/routing.ts`                      | `client/src/utils/routing.ts`                                   |
| `client/src/routing_test.ts`                 | `client/src/utils/routing.test.ts`                              |
| `client/vite.config.ts`                      | `client/vite-config.ts`                                         |

`server/main.ts`、`server/dev.ts`、`server/docker.ts`は`server/app.ts`への統合後に削除する。

型と生成関数も配置に合わせて変更する。

| 現在                             | 変更後                           |
| -------------------------------- | -------------------------------- |
| `ShoeDataSource`                 | `ShoeProductsRepository`         |
| `createShoeDataSource`           | `createShoeProductsRepository`   |
| `ShoeDataSourceError`            | `ShoeProductsRepositoryError`    |
| `StoreInventoryDataSource`       | `StoreInventoryRepository`       |
| `createStoreInventoryDataSource` | `createStoreInventoryRepository` |
| `StoreInventoryDataSourceError`  | `StoreInventoryRepositoryError`  |

## 主要変換の読み順

### シューズマスター

```ts
const rows = step1ConvertSourceRows(products);
const bytes = await step2CreateMasterWorkbook(rows);
```

- `step1ConvertSourceRows`は固定マスタ参照、EAN整形、属性変換をまとめて担当する。
- `step2CreateMasterWorkbook`は21列の出力ブック生成を担当する。
- CSV構文解析、文字列正規化、XML生成の小さな処理までstep関数へ分割しない。

### ピックアップリスト

```ts
const joined = step1JoinInventoryWithErrors(inventory, errorEans);
const records = step2RemoveDuplicateProducts(joined);
const bytes = await step3CreateSubmissionWorkbook(records);
```

- `step1JoinInventoryWithErrors`は対象2店舗、EAN一致、在庫順の維持を担当する。
- `step2RemoveDuplicateProducts`は自社品番ごとに最初の行を残す。
- `step3CreateSubmissionWorkbook`は提出テンプレートへの値、連番、集計結果の反映を担当する。
- `matchedRows`は`step1`の件数、`outputRows`は`step2`の件数として意味を固定する。

## routeのgroupingと読み順

routeは次の4ファイルにまとめる。

| ファイル                | endpoint                                                                 |
| ----------------------- | ------------------------------------------------------------------------ |
| `health-routes.ts`      | `GET /health`                                                            |
| `auth-routes.ts`        | `POST /api/auth/login`、`GET /api/auth/session`、`POST /api/auth/logout` |
| `shoes-routes.ts`       | `GET /api/shoes`、`GET /api/shoes.xlsx`                                  |
| `pickup-list-routes.ts` | `POST /api/pickup-list`、`POST /api/pickup-list.xlsx`                    |

各ファイルはroute groupを1つ公開する。共有repositoryは`app.ts`で一度だけ生成して注入する。
group内では基本レスポンスを返すendpoint、Excelを返すendpointの順に並べる。

```ts
export function createPickupListRoutes(inventoryRepository: StoreInventoryRepository) {
  const routes = new Hono();
  routes.use('*', requireAuth);

  routes.post('/pickup-list', async (context) => {
    const result = await createPickupListResult(context, inventoryRepository);
    return context.json(toPickupListResponse(result));
  });

  routes.post('/pickup-list.xlsx', async (context) => {
    const result = await createPickupListResult(context, inventoryRepository);
    return createXlsxResponse(result);
  });

  return routes;
}

async function createPickupListResult(
  context: Context,
  inventoryRepository: StoreInventoryRepository,
) {
  const upload = await readPickupUpload(context);
  const inventory = await inventoryRepository.getDataset();
  return await transformPickupList(inventory.records, upload);
}
```

`auth-routes.ts`ではloginを先頭に置き、その後に認証middleware、session、logoutを並べる。
`shoes-routes.ts`と`pickup-list-routes.ts`はgroup先頭で認証middlewareを適用する。
2つのendpointで重なる入力取得と変換だけはrouteファイル末尾のローカル関数で共有し、それ以外はhandler内に残す。

repositoryをroute内で生成せず、`app.ts`で生成した同じinstanceを注入する。これにより1時間のメモリキャッシュを全リクエストで共有する。

## クライアントの責務

- `app.tsx`: セッション確認、ログイン済みユーザー、URL同期、ページ選択、ページをまたぐD&Dの受け渡し
- `login-page.tsx`: 認証フォームとログインAPI
- `products-page.tsx`: 商品取得、1時間更新、ページング、商品Excelダウンロード、一覧と小さいフッター
- `pickup-list-page.tsx`: ファイル検証、確定、18列プレビュー、生成Excelダウンロード
- `app-shell.tsx`: 認証後の共通ヘッダー、ナビゲーション、ログアウト、全画面D&Dオーバーレイ
- `brand-mark.tsx`: ログインと共通シェルで使う表示

商品テーブル、ピックアップ結果テーブル、ページネーションなど単一ページ専用のUIはページファイル内に残す。
CSSはDOMを変えずにページ境界で分け、グローバルなtable指定を各ページ配下へ限定する。

## 実施フェーズと合格条件

### Phase 0: 実データintegrationテスト

完了済み。`integration/`の2テストと単体テストを通し、現行の変換結果を固定する。

### Phase 1: kebab-caseへの機械的な移動

- ソース、テスト、CSV、テンプレートを目標名へ移動する
- import、build、Docker、Deno task、仕様書の参照だけを更新する
- 関数本体は変更しない

合格条件: format、lint、type check、単体テスト32件、実データintegrationテスト2件、buildが成功する。

### Phase 2: transform整理

- `transformer.ts`を`shoes-master-transform.ts`へ移す
- `pickup-list.ts`を`pickup-list-transform.ts`へ移す
- 上記のstep関数へ業務処理をまとめる
- ピックアップの照合と重複削除だけは別stepとして明示する
- SafeSizeの行数取得をループ前に保持し、実データ解析の不要な反復を減らす

合格条件: integrationテストの全セル比較と件数が変更前と一致する。

### Phase 3: repositoriesとutils整理

- 外部データと固定マスタへのアクセスを`repositories/`へ移し、interfaceと生成関数も`Repository`命名へ揃える
- 認証、CSV、アップロード、XLSXレスポンスの共有処理を`utils/`へ移す
- 単一route専用のページングやファイル名生成はroute内に残す

合格条件: repository instanceが保持する1時間キャッシュ、ローカルAWS
profile、固定S3キー、エラー応答が変わらない。

### Phase 4: route grouping

- 8 endpointを機能単位の4ファイルへ移す
- `app.ts`はrepository生成と4つのroute group登録だけを上から下に並べる
- 各group内で認証middlewareとendpointの順番が読めるようにする
- route横断の結合テストは`app.test.ts`へ残し、endpointごとの小さいテストファイルへ分割しない

合格条件:
公開health、未認証拒否、ログイン、ログアウト、商品JSON、商品Excel、ピックアップ確定、ピックアップExcelの契約が維持される。

### Phase 5: `app.ts`への入口統合

- `main.ts`、`dev.ts`、`docker.ts`の責務を`app.ts`へ統合する
- `createApp()`はテスト用にexportする
- `if (import.meta.main)`のときだけ`Deno.serve()`を開始する
- API、health、静的client、SPA fallbackを同じhandlerで配信する
- build出力を`dist/app.js`の1本にし、Dockerの起動先も合わせる

合格条件: ローカル開発、build後の起動、単一コンテナのいずれでも同じrouteが動作する。

### Phase 6: クライアントのページ分割

- 先にファイル名とimportだけを変更する
- 共通component、ログイン、商品、ピックアップの順で移す
- 最後にCSSをページごとに分ける
- APIのpayloadとDOM上の文言は変更しない

合格条件:
未ログイン時の保護、戻る・進む、1時間更新、全画面D&D、ファイル検証、確定、18列表示、2種類のExcelダウンロード、ログアウト後の状態破棄が維持される。

### Phase 7: 最終検証

次を順番に実行する。

```text
deno fmt --check
deno lint
deno check client/src/main.tsx server/app.ts
deno task test
deno task build
docker build
```

build済みコンテナでは、health、ログイン、認証なしのAPI拒否、商品表示、ピックアップ確定、Excelダウンロードをsmoke
testする。

## 変更しない外部契約

- APIのpath、method、status、JSON形状、レスポンスヘッダー
- ダウンロードされるファイル名
- S3のbucket、key、対象期間の決定方法
- 対象店舗コード
- `.env`のログイン情報
- CloudFront、LB、ECSの経路と単一Docker構成
- UIにインフラ実装情報を表示しない方針
