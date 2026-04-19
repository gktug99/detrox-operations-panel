# Basit Node.js REST API

Bu proje, Express kullanilarak yazilmis bir REST API ornegidir. API hem ornek `products` verisini hem de Excel tabanli personel-operasyon analizlerini sunar.

## Baslatma

```bash
npm start
```

Sunucu varsayilan olarak `127.0.0.1:3000` adresinde calisir.

Veriler `data/products.json` dosyasina yazilir. Sunucu yeniden baslasa bile `products` verisi korunur.

Excel analizi icin proje kokundeki `CİHAZ ÜRETİM YETKİNLİK MATRİSİ_20261901.xlsx` dosyasi okunur.
Tarayicidan paneli acmak icin sunucu calisirken `http://127.0.0.1:3001` adresine gidin.

## Endpoint'ler

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
- `POST /ai/analyze`

## Ornek Istekler

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/products
curl http://127.0.0.1:3000/analytics/overview
curl "http://127.0.0.1:3000/analytics/employees/EMİR%20KODAŞ"
curl "http://127.0.0.1:3000/analytics/operations/AER-1%20MONTAJ%20HATTI%201"
curl -X POST http://127.0.0.1:3000/ai/analyze \
  -H "Content-Type: application/json" \
  -d '{"question":"En kritik riskleri ozetle"}'
curl -X POST http://127.0.0.1:3000/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Klavye","price":1200,"inStock":true}'
```

## Analiz Mantigi

- `Tüm Operasyonlar` sayfasindan operasyon zorlugu, personel hedef puani ve gerceklesen puani okunur.
- `Personel Görev Dağılım` sayfasindan personelin ana gorevi ve yan gorevi eslestirilir.
- Basari durumu `gerceklesen > 3` kuralina gore hesaplanir. Yalnizca `4` ve `5` alanlar basarili; `1`, `2` ve `3` alanlar basarisiz sayilir.
- Ozet endpoint'leri personel bazli ve operasyon bazli basari/fail sayilarini, oranlari ve hedef-gerceklesen farklarini dondurur.
- Excel dosyasi degistiginde `analytics` ve `ai` istekleri sirasinda otomatik yeniden yuklenir.

## AI Analizi

- `POST /ai/analyze` endpoint'i Excel ozetini OpenAI Responses API uzerinden yorumlatir.
- Kullanmak icin ortam degiskeni tanimlayin:

```bash
export OPENAI_API_KEY="your_api_key"
export OPENAI_MODEL="gpt-5"
```

- API anahtari tanimli degilse endpoint `503` doner.
