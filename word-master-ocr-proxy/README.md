# WORD MASTER Glass Recall OCR Proxy

Small Vercel Function that accepts the app's cropped handwriting image and returns only recognized text from Google Cloud Vision.

## Vercel settings

- Root Directory: `word-master-ocr-proxy`
- Framework Preset: Other
- Environment variable: `GOOGLE_SERVICE_ACCOUNT_JSON` (paste the complete service-account JSON only in Vercel's encrypted Environment Variables screen)
- Optional environment variable: `OCR_ALLOWED_ORIGIN` (defaults to `https://doetoeri.github.io`)

Never commit the service-account JSON or paste it into client-side code.

## Contract

- `GET /api/ocr?health=1` returns connection status.
- `POST /api/ocr` accepts `{ "image": "data:image/jpeg;base64,..." }`.
- Successful response: `{ "text": "..." }`.
