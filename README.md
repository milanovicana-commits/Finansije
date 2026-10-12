# Porodične finansije (Netlify + Google Sheets)

## 1. Google Sheet i servisni nalog
1. https://console.cloud.google.com → novi projekat → "APIs & Services" → uključi **Google Sheets API**.
2. "Credentials" → Create credentials → **Service account** → završi → otvori nalog → Keys → Add key → JSON. Skini fajl.
3. Napravi prazan Google Sheet. Klikni Share i podeli ga sa **client_email** iz JSON fajla (uloga Editor).
4. ID tabele je u linku: docs.google.com/spreadsheets/d/**OVO_JE_ID**/edit

## 2. Netlify
1. Okači folder na GitHub i na Netlify: Add new site → Import from Git (ili Netlify CLI: `netlify deploy --prod`).
2. Site configuration → Environment variables:
   - SHEET_ID = ID tabele
   - GOOGLE_CLIENT_EMAIL = client_email iz JSON-a
   - GOOGLE_PRIVATE_KEY = private_key iz JSON-a (cela vrednost, sa -----BEGIN...)
   - PERSONS = Ana,Marko   (vaša imena, odvojena zarezom)
   - ANTHROPIC_API_KEY = ključ sa console.anthropic.com (za AI izveštaj; naplaćuje se po upotrebi, otprilike nekoliko dinara po izveštaju)
   - APP_PIN = 4321   (nije obavezno, ali preporučeno)
3. Deploy. Listovi "Transakcije" i "Budzet" se prave sami.

## AI izveštaj
Dashboard → Finansijski savetnik → Napravi izveštaj. Izveštaj se čuva u listu "Izvestaji", pa se pri ponovnom otvaranju ne plaća ponovo.
Ako izveštaj pukne zbog vremena, u Netlify: Site configuration → Functions → povećaj timeout na 26s.

U kartici Finansijski savetnik postoje dve opcije: ✅ besplatno (kopira upit koji nalepiš u Claude aplikaciju) i 💳 plaćeno (izveštaj u aplikaciji preko API ključa). Ako ne podesiš ANTHROPIC_API_KEY, koristi samo besplatnu.

Prikaz: na telefonu je donja navigacija i jedna kolona, na računaru (od 900px) gornji meni i raspored u dve kolone.
