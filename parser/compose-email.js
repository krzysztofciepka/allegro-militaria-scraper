// Body of the Compose Email n8n Code node.
// Pure module — `composeEmail(inputAll)` returns an n8n item array
// (empty array => Send Email node is skipped via n8n's empty-input semantics).

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function offerRow(o) {
  const img = o.img
    ? '<img src="' + esc(o.img) + '" width="120" alt="" style="display:block;border-radius:6px;border:1px solid #eee">'
    : '';
  const badge = o.source === 'lokalnie'
    ? ' <span style="background:#0a7;padding:1px 6px;border-radius:8px;color:#fff;font-size:11px">Lokalnie</span>'
    : o.source === 'allegro-via-lokalnie'
      ? ' <span style="background:#06a;padding:1px 6px;border-radius:8px;color:#fff;font-size:11px">Lokalnie→Allegro</span>'
      : '';
  return '<table style="margin:0 0 14px;border-collapse:collapse">'
    + '<tr>'
    + '<td style="vertical-align:top;width:120px"><a href="' + esc(o.url) + '">' + img + '</a></td>'
    + '<td style="vertical-align:top;padding-left:12px">'
    + '<a href="' + esc(o.url) + '" style="font-weight:bold;color:#0b5;text-decoration:none">' + esc(o.title || 'No title') + badge + '</a><br>'
    + '<span style="font-size:16px;color:#111">' + esc(o.price != null ? o.price : 'N/A') + ' PLN</span>'
    + '</td></tr></table>';
}

function warningRow(o) {
  return '<p style="color:#a55;font-style:italic;margin:0 0 10px">' + esc(o.title || '⚠ warning') + '</p>';
}

function composeEmail(inputAll) {
  const all = Array.isArray(inputAll) ? inputAll.map(i => (i && i.json) || i).filter(Boolean) : [];

  const allegroOffers = all.filter(o => !o.warning && (o.source === 'allegro'));
  const lokalnieOffers = all.filter(o => !o.warning && (o.source === 'lokalnie' || o.source === 'allegro-via-lokalnie'));
  const warnings = all.filter(o => o.warning);

  const hasAnything = allegroOffers.length > 0 || lokalnieOffers.length > 0 || warnings.length > 0;
  if (!hasAnything) return [];

  const totalNew = allegroOffers.length + lokalnieOffers.length;
  let body = '<div style="font-family:Arial,Helvetica,sans-serif;color:#222">';
  body += '<h2 style="margin:0 0 4px">Allegro Militaria Monitor</h2>';
  body += '<p style="margin:0 0 16px;color:#666">Found ' + totalNew + ' new offer(s)</p>';

  body += '<h3 style="margin:16px 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">Allegro.pl</h3>';
  if (allegroOffers.length === 0) {
    const w = warnings.filter(o => /^allegro:/.test(o.id));
    if (w.length) w.forEach(o => { body += warningRow(o); });
    else body += '<p><em>No new offers on Allegro.pl.</em></p>';
  } else {
    allegroOffers.forEach(o => { body += offerRow(o); });
    warnings.filter(o => /^allegro:/.test(o.id)).forEach(o => { body += warningRow(o); });
  }

  body += '<h3 style="margin:16px 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">Allegro Lokalnie</h3>';
  if (lokalnieOffers.length === 0) {
    const w = warnings.filter(o => /^lokalnie:/.test(o.id));
    if (w.length) w.forEach(o => { body += warningRow(o); });
    else body += '<p><em>No new offers on Allegro Lokalnie.</em></p>';
  } else {
    lokalnieOffers.forEach(o => { body += offerRow(o); });
    warnings.filter(o => /^lokalnie:/.test(o.id)).forEach(o => { body += warningRow(o); });
  }

  body += '<p style="color:#999;font-size:12px;margin-top:20px">Run time: ' + new Date().toISOString() + '</p>';
  body += '</div>';

  const to = 'krzysztof.ciepka@gmail.com';
  const subject = '[Allegro Militaria] ' + totalNew + ' new offer(s) found';
  const mime = 'To: ' + to + '\r\n'
    + 'Subject: =?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=\r\n'
    + 'MIME-Version: 1.0\r\n'
    + 'Content-Type: text/html; charset=UTF-8\r\n'
    + 'Content-Transfer-Encoding: base64\r\n\r\n'
    + Buffer.from(body, 'utf8').toString('base64');
  const raw = Buffer.from(mime, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return [{ json: { to, subject, body, raw } }];
}

module.exports = { composeEmail };