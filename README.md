# Detrox Operations Panel

Detrox montaj personel operasyonel degerlendirme paneli. Proje, Excel tabanli personel ve operasyon verilerini okuyup web paneli uzerinden ozet, personel detayi, operasyon detayi ve personel gelisimi ekranlari sunar.

## Kurulum

```bash
npm install
```

Excel dosyasini proje kokune kopyalayin. Repo icinde `.xlsx` dosyasi tutulmaz; uygulama calisirken yerelde okunur.

Beklenen dosya adina ornek:

```text
CİHAZ ÜRETİM YETKİNLİK MATRİSİ_20261901.xlsx
```

## Calistirma

Varsayilan port:

```bash
npm start
```

Farkli port:

```bash
PORT=3001 npm start
```

Tarayicidan panel:

```text
http://127.0.0.1:3001
```

## Temel Endpointler

- `GET /health`
- `GET /products`
- `GET /products/:id`
- `POST /products`
- `PUT /products/:id`
- `DELETE /products/:id`
- `GET /analytics/overview`
- `GET /analytics/employees`
- `GET /analytics/employees/:name`
- `GET /analytics/operations`
- `GET /analytics/operations/:operationName`
- `POST /analytics/reload`

## Analiz Kurallari

- Operasyon verileri Excel icindeki ilgili sayfalardan okunur.
- Personel ana gorev ve yan gorev bilgileri ayri sayfalardan eslestirilir.
- Basari kurali `gerceklesen > 3` seklindedir.
- Yalnizca `4` ve `5` alanlar basarili kabul edilir.
- `1`, `2` ve `3` alanlar basarisiz kabul edilir.
- Hedef puani olmayan kayitlar basari oranlarina dahil edilmez.
- Gunluk gelisim kayitlari `data/personnel-growth-history.json` icinde tutulur.

## Gelistirme Notlari

- `node_modules/`, yerel Excel dosyalari ve gecici Git pointer dosyalari repoya dahil edilmez.
- Proje Windows klasorunde calissa bile Git verisi WSL tarafinda tutulabilir.
