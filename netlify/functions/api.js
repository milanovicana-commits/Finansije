const { google } = require('googleapis');

const T = 'Transakcije';
const B = 'Budzet';
const HEAD = ['ID', 'Datum', 'Osoba', 'Tip', 'Kategorija', 'Iznos', 'Napomena'];

const PERSONS = (process.env.PERSONS || 'Ja,Muž').split(',').map(s => s.trim()).filter(Boolean);
const CATEGORIES = {
  expense: ['Hrana', 'Račun i komunalije', 'Kirija / Kredit', 'Prevoz / Gorivo', 'Zdravlje', 'Deca', 'Odeća', 'Zabava', 'Restorani', 'Putovanja', 'Pokloni', 'Ostalo'],
  income: ['Plata', 'Dodatni posao', 'Dečiji dodatak', 'Poklon', 'Ostalo']
};

const json = (code, body) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

function sheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth });
}

// Pravi listove i zaglavlja ako ne postoje; vraća sheetId lista Transakcije
async function ensure(s, id) {
  const meta = await s.spreadsheets.get({ spreadsheetId: id });
  const names = meta.data.sheets.map(x => x.properties.title);
  const missing = [T, B].filter(n => !names.includes(n));
  if (missing.length) {
    await s.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: missing.map(title => ({ addSheet: { properties: { title } } })) }
    });
    if (missing.includes(T)) {
      await s.spreadsheets.values.update({
        spreadsheetId: id, range: `${T}!A1`, valueInputOption: 'RAW', requestBody: { values: [HEAD] }
      });
    }
    if (missing.includes(B)) {
      await s.spreadsheets.values.update({
        spreadsheetId: id, range: `${B}!A1`, valueInputOption: 'RAW', requestBody: { values: [['Kategorija', 'Iznos']] }
      });
    }
  }
  const meta2 = await s.spreadsheets.get({ spreadsheetId: id });
  return meta2.data.sheets.find(x => x.properties.title === T).properties.sheetId;
}


const R = 'Izvestaji';
const sumBy = (arr, key) => arr.reduce((o, t) => { o[t[key]] = (o[t[key]] || 0) + t.amount; return o; }, {});
const prevM = k => { let [y, m] = k.split('-').map(Number); m--; if (m < 1) { m = 12; y--; } return y + '-' + String(m).padStart(2, '0'); };

async function getTx(s, id) {
  const tx = await s.spreadsheets.values.get({ spreadsheetId: id, range: `${T}!A2:G`, valueRenderOption: 'UNFORMATTED_VALUE' });
  return (tx.data.values || []).filter(r => r[0]).map(r => ({
    date: String(r[1] || ''), person: r[2] || '', type: r[3] || '', category: r[4] || '', amount: Number(r[5]) || 0, note: r[6] || ''
  }));
}

async function report(s, id, month, force) {
  // keš: izveštaj se čuva u listu "Izvestaji" da ne plaćaš API dvaput
  const meta = await s.spreadsheets.get({ spreadsheetId: id });
  if (!meta.data.sheets.some(x => x.properties.title === R)) {
    await s.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: R } } }] } });
    await s.spreadsheets.values.update({ spreadsheetId: id, range: `${R}!A1`, valueInputOption: 'RAW', requestBody: { values: [['Mesec', 'Izvestaj', 'Napravljen']] } });
  }
  const cached = await s.spreadsheets.values.get({ spreadsheetId: id, range: `${R}!A:C` });
  const rows = cached.data.values || [];
  const idx = rows.findIndex((r, i) => i > 0 && r[0] === month);
  if (idx > 0 && !force) return { text: rows[idx][1], created: rows[idx][2], cached: true };

  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Nedostaje ANTHROPIC_API_KEY u Netlify podešavanjima');

  const all = await getTx(s, id);
  const bd = await s.spreadsheets.values.get({ spreadsheetId: id, range: `${B}!A2:B`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const budgets = {}; (bd.data.values || []).forEach(r => { if (r[0]) budgets[r[0]] = Number(r[1]) || 0; });

  const months = [month, prevM(month), prevM(prevM(month)), prevM(prevM(prevM(month)))];
  const summary = {};
  months.forEach(m => {
    const t = all.filter(x => x.date.startsWith(m));
    const inc = t.filter(x => x.type === 'income'), exp = t.filter(x => x.type === 'expense');
    summary[m] = {
      prihodi: inc.reduce((a, x) => a + x.amount, 0),
      troskovi: exp.reduce((a, x) => a + x.amount, 0),
      troskovi_po_kategoriji: sumBy(exp, 'category'),
      prihodi_po_kategoriji: sumBy(inc, 'category'),
      troskovi_po_osobi: sumBy(exp, 'person')
    };
  });
  const biggest = all.filter(x => x.date.startsWith(month) && x.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 5)
    .map(x => ({ kategorija: x.category, iznos: x.amount, napomena: x.note, osoba: x.person }));
  if (!summary[month].prihodi && !summary[month].troskovi) throw new Error('Nema unosa za izabrani mesec');

  const prompt = `Ti si iskusan, praktičan porodični finansijski savetnik. Porodica vodi budžet u RSD (srpski dinari). Analiziraj mesec ${month} i uporedi ga sa prethodna tri meseca (ako imaju podatke).

PODACI (JSON):
${JSON.stringify({ mesec: month, pregled_po_mesecima: summary, najveci_troskovi_meseca: biggest, mesecni_budzeti_po_kategoriji: budgets }, null, 1)}

Napiši izveštaj na srpskom (latinica), jasno i toplo, do 280 reči, u ovim delovima, sa kratkim naslovima u **bold**:
**Sažetak meseca** (prihodi, troškovi, ušteda i procenat uštede, poređenje sa prošlim mesecom)
**Šta je dobro**
**Na šta obratiti pažnju** (kategorije koje rastu, prekoračeni budžeti, neuobičajeno veliki troškovi)
**3 konkretne preporuke** (sa procenjenim iznosima u RSD gde ima smisla)
**Predlog za sledeći mesec** (jedan do dva limita ili cilj štednje)

Koristi samo date podatke, ne izmišljaj brojeve. Ako nešto nedostaje (npr. nema budžeta ili prethodnih meseci), to kratko pomeni. Iznose piši kao 45.000 RSD. Liste piši sa "- ". Bez uvoda i bez završne fraze.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 900, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error && j.error.message ? j.error.message : 'Greška AI servisa');
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();

  const now = new Date().toISOString().slice(0, 10);
  if (idx > 0) {
    await s.spreadsheets.values.update({ spreadsheetId: id, range: `${R}!A${idx + 1}:C${idx + 1}`, valueInputOption: 'RAW', requestBody: { values: [[month, text, now]] } });
  } else {
    await s.spreadsheets.values.append({ spreadsheetId: id, range: `${R}!A:C`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[month, text, now]] } });
  }
  return { text, created: now, cached: false };
}

exports.handler = async (event) => {
  try {
    const pin = process.env.APP_PIN;
    if (pin && event.headers['x-pin'] !== pin) return json(401, { error: 'Pogrešan PIN' });

    const id = process.env.SHEET_ID;
    if (!id || !process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      return json(500, { error: 'Nedostaju podešavanja (SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY)' });
    }
    const s = sheetsClient();
    const tSheetId = await ensure(s, id);

    if (event.httpMethod === 'GET') {
      const [tx, bd] = await Promise.all([
        s.spreadsheets.values.get({ spreadsheetId: id, range: `${T}!A2:G`, valueRenderOption: 'UNFORMATTED_VALUE' }),
        s.spreadsheets.values.get({ spreadsheetId: id, range: `${B}!A2:B`, valueRenderOption: 'UNFORMATTED_VALUE' })
      ]);
      const transactions = (tx.data.values || []).filter(r => r[0]).map(r => ({
        id: String(r[0]), date: String(r[1] || ''), person: r[2] || '', type: r[3] || '',
        category: r[4] || '', amount: Number(r[5]) || 0, note: r[6] || ''
      }));
      const budgets = {};
      (bd.data.values || []).forEach(r => { if (r[0]) budgets[r[0]] = Number(r[1]) || 0; });
      return json(200, { persons: PERSONS, categories: CATEGORIES, transactions, budgets });
    }

    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');

      if (b.action === 'add') {
        const amount = Number(b.amount);
        if (!amount || amount <= 0 || !b.date || !b.person || !['income', 'expense'].includes(b.type) || !b.category) {
          return json(400, { error: 'Neispravan unos' });
        }
        const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        await s.spreadsheets.values.append({
          spreadsheetId: id, range: `${T}!A:G`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [[newId, b.date, b.person, b.type, b.category, amount, b.note || '']] }
        });
        return json(200, { ok: true, id: newId });
      }

      if (b.action === 'delete') {
        const col = await s.spreadsheets.values.get({ spreadsheetId: id, range: `${T}!A:A` });
        const idx = (col.data.values || []).findIndex(r => r[0] === b.id);
        if (idx < 1) return json(404, { error: 'Nije pronađeno' });
        await s.spreadsheets.batchUpdate({
          spreadsheetId: id,
          requestBody: { requests: [{ deleteDimension: { range: { sheetId: tSheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } } }] }
        });
        return json(200, { ok: true });
      }

      if (b.action === 'report') {
        if (!/^\d{4}-\d{2}$/.test(b.month || '')) return json(400, { error: 'Neispravan mesec' });
        return json(200, await report(s, id, b.month, !!b.force));
      }

      if (b.action === 'budget') {
        const amount = Number(b.amount) || 0;
        const col = await s.spreadsheets.values.get({ spreadsheetId: id, range: `${B}!A:A` });
        const idx = (col.data.values || []).findIndex(r => r[0] === b.category);
        if (idx >= 1) {
          await s.spreadsheets.values.update({
            spreadsheetId: id, range: `${B}!B${idx + 1}`, valueInputOption: 'RAW', requestBody: { values: [[amount]] }
          });
        } else {
          await s.spreadsheets.values.append({
            spreadsheetId: id, range: `${B}!A:B`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [[b.category, amount]] }
          });
        }
        return json(200, { ok: true });
      }
      return json(400, { error: 'Nepoznata akcija' });
    }
    return json(405, { error: 'Metoda nije dozvoljena' });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message || 'Greška na serveru' });
  }
};
