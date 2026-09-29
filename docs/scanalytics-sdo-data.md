# Scanalytics ETLからのSDO入力データ

SDOで利用するシューズ商品データと店舗在庫データは、 `scanalytics_report_etl`
のLambdaがRedshiftから抽出し、S3へ1時間ごとに出力する。

## 商品CSV

```text
s3://scanalytics-report/sdo/shoe_products/kiukkn=<第1期>_<第2期>/shoe_products.csv
```

例:

```text
s3://scanalytics-report/sdo/shoe_products/kiukkn=202609_202703/shoe_products.csv
```

- CSVは従来の13列に`EC-ID`・`EC-URL`を追加した15列を持つ。
- 列順は
  `部門, 部門名, 品種, 品種名, 品目, 品目名, 自社品番, ブランド,
  スキャンコード(JAN), メーカー品番, 商品名(EN), Size, SizeSys, EC-ID, EC-URL`。
- 移行中は旧13列CSVも受け入れ、EC-ID・EC-URLを空文字として扱う。
- ECのLEFT JOINが未成立の場合やURLの対象ショップでない場合、該当EC項目は空欄を許容する。
- EC-IDは文字列として保持し、数値変換や先頭ゼロの除去は行わない。
- 商品一覧・APIに両項目を含め、ExcelのV列・W列にそれぞれ出力する。
- SQLの対象期はLambdaが渡す`{first_kiukkn}`・`{second_kiukkn}`で置換する。固定値にすると、
  期の切り替え後にS3の保存先と抽出内容が一致しなくなる。
- 期区分はJSTの実行月から決まる。
  - 1〜3月: 当年3月、当年9月
  - 4〜9月: 当年9月、翌年3月
  - 10〜12月: 翌年3月、翌年9月
- 同じ期区分の間は同じS3キーが上書きされ、期区分が変わると別フォルダになる。

## 店舗在庫CSV

```text
s3://scanalytics-report/sdo/shoe_store_inventory/shoe_store_inventory.csv
```

- 店舗`10309`と`10319`を対象とした最新の在庫スナップショット。
- 毎回同じS3キーへ上書きされる。

## 共通仕様と更新

- バケット: `scanalytics-report`
- 形式: ヘッダー付きCSV
- 文字コード: UTF-8 BOM付き
- 更新: 毎時15分 (JST)
- 出力Lambda: `scanalytics-report-redshift-report-downloader`
- Lambdaイベント: `{"job":"sdo"}`

旧キー `sdo/shoe_products.csv` と `sdo/shoe_store_inventory.csv` は移行前の出力なので、
新規実装では利用しない。

出力側の詳細仕様は次を参照する。

```text
/Users/rororo/projects/xebio/scanalytics_report_etl/docs/sdo.md
```

## 強化品番ピックアップの入力

強化品番ピックアップは、利用者がアップロードした自社品番リストを上記の店舗在庫CSVの
`自社品番`へ直接照合する。通常商品CSVも強化品番CSVも、この画面では使用しない。
対象品番の変更はアップロードリストの変更で行い、ETLのSQL変更やデータ再生成は不要。

以前追加した`sdo/shoe_products_kyoka/shoe_products_kyoka.csv`はSDOから参照しない。
`SHOE_KYOKA_DATA_KEY`と、このオブジェクト専用のSDOタスクロール権限は廃止した。
ETL側の既存エクスポート自体は今回のSDO変更では削除していない。
