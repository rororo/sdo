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

- CSVはSDOのシューズマスタ変換に必要な13列を持つ。
- 列順は
  `部門, 部門名, 品種, 品種名, 品目, 品目名, 自社品番, ブランド,
  スキャンコード(JAN), メーカー品番, 商品名(EN), Size, SizeSys`。
- `EC商品コード`は現行CSVに含まれない。
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
