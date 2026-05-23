# Detrox Operations Panel

Detrox montaj personel operasyonel degerlendirme paneli. Uygulama Excel tabanli personel ve operasyon verilerini okuyup panel uzerinde anlik analiz, personel detayi, operasyon detayi ve gunluk gelisim kayitlari sunar.

## Calistirma

```bash
npm install
npm start
```

Farkli port icin:

```bash
PORT=3001 npm start
```

## Excel ve Veri Konumu

Canli kullanimda Excel dosyasini repo icine koymak yerine sabit bir storage klasorunde tutun.

## Veritabani (SQLite) + Export Excel (Yeni)

Bu projede artik **veri kaynagi veritabanidir (SQLite)**. Paneldeki analytics ekranlari icin uygulama, veritabanindaki veriyi otomatik olarak **ayri bir "data workbook" Excel dosyasina export eder** ve analytics bu Excel uzerinden calisir.

Varsayilanlar:

- DB dosyasi: `STORAGE_DIR/detrox.sqlite`
- Data workbook: `STORAGE_DIR/detrox-data-workbook.xlsx`
- Admin sifre: `detrox2024` (Veri Gunceleme sekmesi)

Ilk calistirmada DB bos ise, uygulama proje kokundeki Excel dosyasindan otomatik import etmeyi dener. Farkli bir Excel dosyasindan import icin:

```bash
export IMPORT_WORKBOOK_PATH="/opt/detrox/storage/eski-matrix.xlsx"
```

Desteklenen ortam degiskenleri:

```bash
export STORAGE_DIR="/opt/detrox/storage"
export DATA_WORKBOOK_PATH="/opt/detrox/storage/detrox-data-workbook.xlsx"
export DB_PATH="/opt/detrox/storage/detrox.sqlite"
export ADMIN_PASSWORD="detrox2024"
export PERSONNEL_GROWTH_FILE="/opt/detrox/storage/personnel-growth-history.json"
export SNAPSHOT_SCHEDULER_ENABLED="false"
```

Notlar:

- `WORKBOOK_PATH` verilirse analytics dogrudan o Excel dosyasini okur (legacy mod).
- `WORKBOOK_PATH` verilmezse `DATA_WORKBOOK_PATH` kullanilir (DB -> Excel export mod).
- Gunluk gelisim kayitlari `PERSONNEL_GROWTH_FILE` dosyasinda tutulur.

## Gunluk Snapshot Mantigi

Uygulama her gun tek bir kayit uretmelidir. Siz Excel dosyasini gun icinde degistirseniz bile yeni gelisim verisi bir sonraki planli snapshot aninda kayda girer.

Elle snapshot almak icin:

```bash
npm run snapshot:daily
```

Bu komut:

- Excel dosyasini okur
- bugunun tarihi icin kayit var mi kontrol eder
- yoksa yeni gunluk snapshot ekler
- varsa ikinci kaydi acmaz

## Canli Ortam Onerisi

Uretimde dahili `setTimeout` zamanlayicisi yerine sistem zamanlayicisi kullanmaniz daha saglam olur.

Ornek cron:

```cron
0 0 * * * cd /opt/detrox/app && /usr/bin/npm run snapshot:daily >> /opt/detrox/logs/snapshot.log 2>&1
```

Bu modelde:

- Excel dosyasi sabit bir yerde durur
- siz dosyanin icerigini guncellersiniz
- saat 00:00 oldugunda yeni gunluk snapshot olusur
- frontend tum gelisim ekranlarini bu kayitlardan uretir

## Saglik Kontrolu

`/health` endpoint'i sunucunun hangi Excel dosyasini ve hangi growth history dosyasini kullandigini gosterir.

## Temel Endpointler

- `GET /health`
- `GET /analytics/overview`
- `GET /analytics/employees`
- `GET /analytics/operations`
- `GET /analytics/personnel-growth`
- `POST /analytics/reload`
- `POST /analytics/personnel-growth/snapshot`

## Basari Kurali

- Basari kurali `gerceklesen > 3` seklindedir.
- Yalnizca `4` ve `5` alanlar basarili kabul edilir.
- `1`, `2` ve `3` alanlar basarisiz kabul edilir.
- Hedef puani olmayan kayitlar basari oranlarina dahil edilmez.
