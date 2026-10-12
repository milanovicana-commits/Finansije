// Tanak posrednik: prosleđuje zahteve aplikacije ka Google Apps Script-u.
// Adresa skripte je tajna u Netlify podešavanjima (APPS_SCRIPT_URL), ne u kodu stranice.
const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  try {
    const url = process.env.APPS_SCRIPT_URL;
    if (!url) return json(500, { error: 'Nedostaje APPS_SCRIPT_URL u Netlify podešavanjima' });

    let body;
    if (event.httpMethod === 'GET') body = { action: 'load' };
    else if (event.httpMethod === 'POST') body = JSON.parse(event.body || '{}');
    else return json(405, { error: 'Metoda nije dozvoljena' });
    body.pin = event.headers['x-pin'] || '';

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); }
    catch (e) { return json(502, { error: 'Skripta nije vratila podatke. Proveri da li je Deploy podešen na "Anyone" i da je URL tačan.' }); }
    if (j.error) return json(j.code || 500, { error: j.error });
    return json(200, j);
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message || 'Greška na serveru' });
  }
};
