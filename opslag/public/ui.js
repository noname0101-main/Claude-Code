/*
 * Opslag – chatvinduet.
 *
 * Bruges af både serverversionen (index.html, med websøgning) og den gratis
 * version (gratis.html, der kører på claude.ai). Forskellen ligger i "backend":
 *
 *   backend.send(tekst, paaHaendelse)  sender en besked; paaHaendelse får
 *       { type: 'tekst', id, tekst }        svaret, mens det bliver skrevet
 *       { type: 'aktivitet', slags, tekst } hvad AI'en er i gang med
 *       { type: 'spoerg', id, tekst }       AI'en vil have lov til noget
 *       { type: 'advarsel', tekst }         noget gik galt
 *   backend.godkend(id, ja)            svar på et 'spoerg'
 *   backend.stop()                     stop det, AI'en er i gang med
 *   backend.ny()                       start en ny samtale
 *   backend.noter()                    giver de gemte noter
 */
(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════
  //  Markdown → sikker HTML (kun det, svarene bruger)
  // ════════════════════════════════════════════════════════════

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  function kortUrl(url) {
    try {
      const u = new URL(url);
      const sti = u.pathname.length > 24 ? u.pathname.slice(0, 22) + '…' : u.pathname;
      return u.hostname.replace(/^www\./, '') + (sti === '/' ? '' : sti);
    } catch (e) {
      return url;
    }
  }

  function link(url, tekst) {
    // Kun https-links. Alt andet vises som almindelig tekst.
    if (!/^https:\/\//i.test(url)) return tekst;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${tekst}</a>`;
  }

  function inline(raw) {
    let out = '';
    for (const del of String(raw).split(/(`[^`\n]+`)/)) {
      if (/^`[^`\n]+`$/.test(del)) {
        out += `<code>${escapeHtml(del.slice(1, -1))}</code>`;
        continue;
      }
      const gemte = [];
      const gem = (html) => `\u0000${gemte.push(html) - 1}\u0000`;
      let t = escapeHtml(del);
      t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, tekst, url) => gem(link(url, tekst)));
      t = t.replace(/(^|[\s(])(https:\/\/[^\s<)\u0000]+[^\s<).,;:!?\u0000])/g, (m, foer, url) => foer + gem(link(url, escapeHtml(kortUrl(url.replace(/&amp;/g, '&'))))));
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![\w*])/g, '$1<em>$2</em>');
      t = t.replace(/\u0000(\d+)\u0000/g, (m, i) => gemte[Number(i)]);
      out += t;
    }
    return out;
  }

  const LISTE = /^\s*[-*•]\s+/;
  const NUMMER = /^\s*\d+[.)]\s+/;
  const TABEL = /^\s*\|.*\|\s*$/;
  const NY_BLOK = /^(```|#{1,6}\s|\s*[-*•]\s|\s*\d+[.)]\s|\s*>|\s*\|)/;

  function cellerAf(linje) {
    return linje.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  }

  function markdown(src) {
    const linjer = String(src).replace(/\r/g, '').split('\n');
    let html = '';
    let i = 0;
    while (i < linjer.length) {
      const linje = linjer[i];
      if (/^\s*```/.test(linje)) {
        const kode = [];
        i++;
        while (i < linjer.length && !/^\s*```/.test(linjer[i])) kode.push(linjer[i++]);
        i++;
        html += `<pre><code>${escapeHtml(kode.join('\n'))}</code></pre>`;
        continue;
      }
      const overskrift = linje.match(/^(#{1,6})\s+(.*)$/);
      if (overskrift) {
        const niveau = Math.min(6, overskrift[1].length + 2);
        html += `<h${niveau}>${inline(overskrift[2])}</h${niveau}>`;
        i++;
        continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(linje)) { html += '<hr>'; i++; continue; }
      if (LISTE.test(linje) || NUMMER.test(linje)) {
        const nummereret = NUMMER.test(linje) && !LISTE.test(linje);
        const moenster = nummereret ? NUMMER : LISTE;
        html += nummereret ? '<ol>' : '<ul>';
        while (i < linjer.length && moenster.test(linjer[i])) {
          html += `<li>${inline(linjer[i].replace(moenster, ''))}</li>`;
          i++;
        }
        html += nummereret ? '</ol>' : '</ul>';
        continue;
      }
      if (/^\s*>/.test(linje)) {
        const citat = [];
        while (i < linjer.length && /^\s*>/.test(linjer[i])) citat.push(linjer[i++].replace(/^\s*>\s?/, ''));
        html += `<blockquote>${citat.map(inline).join('<br>')}</blockquote>`;
        continue;
      }
      if (TABEL.test(linje) && i + 1 < linjer.length && /^\s*\|?\s*:?-{2,}/.test(linjer[i + 1])) {
        const hoved = cellerAf(linje);
        i += 2;
        let krop = '';
        while (i < linjer.length && TABEL.test(linjer[i])) {
          krop += '<tr>' + cellerAf(linjer[i]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
          i++;
        }
        html += `<div class="table-wrap"><table><thead><tr>${hoved.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${krop}</tbody></table></div>`;
        continue;
      }
      if (!linje.trim()) { i++; continue; }
      const afsnit = [linje];
      i++;
      while (i < linjer.length && linjer[i].trim() && !NY_BLOK.test(linjer[i])) afsnit.push(linjer[i++]);
      html += `<p>${afsnit.map(inline).join('<br>')}</p>`;
    }
    return html;
  }

  // ════════════════════════════════════════════════════════════
  //  Ikoner
  // ════════════════════════════════════════════════════════════

  const IKONER = {
    soeg: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
    laes: '<path d="M3 2.5h7l3 3v8H3z"/><path d="M5.5 8h5M5.5 10.5h5"/>',
    regn: '<rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 5h5M5.5 8.5h1M9.5 8.5h1M5.5 11h1M9.5 11h1"/>',
    tid: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
    note: '<path d="M4 2.5h8v11l-4-2.5-4 2.5z"/>',
    andet: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5.5v3M8 10.5v.5"/>',
  };
  const ikon = (navn) => `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${IKONER[navn] || IKONER.andet}</svg>`;

  // ════════════════════════════════════════════════════════════
  //  Chatvinduet
  // ════════════════════════════════════════════════════════════

  function el(tag, klasse, tekst) {
    const node = document.createElement(tag);
    if (klasse) node.className = klasse;
    if (tekst !== undefined) node.textContent = tekst;
    return node;
  }

  function start({ backend, eksempler = [], tilstand = '' }) {
    const $ = (id) => document.getElementById(id);
    const chat = $('chat');
    const form = $('form');
    const input = $('input');
    const sendKnap = $('send');
    const noterKnap = $('noter-knap');
    const noterPanel = $('noter');
    let arbejder = false;

    const naerBunden = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
    const rulNed = (tving) => { if (tving || naerBunden()) window.scrollTo({ top: document.documentElement.scrollHeight }); };

    function tilpasHoejde() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    }

    function saetArbejder(ja) {
      arbejder = ja;
      sendKnap.classList.toggle('stop', ja);
      sendKnap.innerHTML = ja
        ? '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg>Stop'
        : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h10M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Send';
      sendKnap.setAttribute('aria-label', ja ? 'Stop AI\'en' : 'Send besked');
    }

    function visVelkomst() {
      chat.replaceChildren();
      const velkomst = el('section', 'welcome');
      velkomst.innerHTML = '<h2>Hvad vil du <mark>finde</mark>?</h2>';
      velkomst.append(el('p', null, 'Spørg om hvad som helst: åbningstider, priser, fakta, ord, opskrifter eller ting, du har bedt den huske.'));
      const liste = el('div', 'examples');
      for (const eksempel of eksempler) {
        const knap = el('button', null, eksempel);
        knap.type = 'button';
        knap.addEventListener('click', () => { input.value = eksempel; tilpasHoejde(); sendBesked(); });
        liste.append(knap);
      }
      velkomst.append(liste);
      if (tilstand) velkomst.append(el('p', 'mode-note', tilstand));
      chat.append(velkomst);
    }

    function godkendKort(haendelse) {
      const kort = el('div', 'ask');
      kort.append(el('p', null, `AI'en vil gerne: ${haendelse.tekst}. Må den det?`));
      const raekke = el('div', 'row');
      const ja = el('button', 'btn-primary', 'Tillad');
      const nej = el('button', 'btn-secondary', 'Afvis');
      ja.type = 'button';
      nej.type = 'button';
      const svar = async (tilladt) => {
        kort.replaceChildren(el('p', 'done', tilladt ? 'Du tillod det.' : 'Du sagde nej.'));
        try { await backend.godkend(haendelse.id, tilladt); } catch (e) { kort.append(el('p', 'done', `Kunne ikke sende dit svar: ${e.message}`)); }
      };
      ja.addEventListener('click', () => svar(true));
      nej.addEventListener('click', () => svar(false));
      raekke.append(ja, nej);
      kort.append(raekke);
      return kort;
    }

    async function sendBesked() {
      const tekst = input.value.trim();
      if (!tekst || arbejder) return;
      input.value = '';
      tilpasHoejde();
      const velkomst = chat.querySelector('.welcome');
      if (velkomst) velkomst.remove();

      chat.append(el('div', 'msg user', tekst));
      const tur = el('div', 'msg ai');
      const venter = el('div', 'thinking');
      venter.innerHTML = 'Arbejder<span>.</span><span>.</span><span>.</span>';
      tur.append(venter);
      chat.append(tur);
      rulNed(true);
      saetArbejder(true);

      const blokke = new Map();
      let fikSvar = false;
      const tilfoej = (node) => { tur.insertBefore(node, venter); rulNed(); };

      try {
        await backend.send(tekst, (h) => {
          if (h.type === 'tekst') {
            let blok = blokke.get(h.id);
            if (!blok) {
              blok = el('div', 'md answer');
              blokke.set(h.id, blok);
              tilfoej(blok);
            }
            blok.innerHTML = markdown(h.tekst);
            if (h.tekst.trim()) fikSvar = true;
            rulNed();
          } else if (h.type === 'aktivitet') {
            const linje = el('div', 'activity');
            linje.dataset.slags = h.slags || 'andet';
            linje.innerHTML = ikon(h.slags);
            linje.append(document.createTextNode(h.tekst));
            tilfoej(linje);
          } else if (h.type === 'spoerg') {
            tilfoej(godkendKort(h));
          } else if (h.type === 'advarsel') {
            tilfoej(el('div', 'notice', h.tekst));
            fikSvar = true;
          }
        });
      } catch (e) {
        tilfoej(el('div', 'notice', e && e.message ? e.message : 'Der skete en fejl.'));
        fikSvar = true;
      } finally {
        venter.remove();
        if (!fikSvar) tur.append(el('div', 'notice', 'Der kom ikke noget svar. Prøv at spørge igen.'));
        saetArbejder(false);
        input.focus({ preventScroll: true });
      }
    }

    async function visNoter() {
      const aaben = !noterPanel.hidden;
      noterPanel.hidden = aaben;
      noterKnap.setAttribute('aria-expanded', String(!aaben));
      if (aaben) return;
      const liste = $('noter-liste');
      liste.replaceChildren(el('p', null, 'Henter noter …'));
      try {
        const noter = await backend.noter();
        if (!noter.length) {
          liste.replaceChildren(el('p', null, 'Ingen noter endnu. Skriv fx "Husk at reservenøglen ligger under urtepotten".'));
          return;
        }
        const ul = document.createElement('ul');
        for (const n of noter) {
          const li = el('li', null, n.tekst);
          const dato = n.gemt ? new Date(n.gemt).toLocaleDateString('da-DK') : '';
          li.append(el('small', null, [n.emne, dato].filter(Boolean).join(' · ')));
          ul.append(li);
        }
        liste.replaceChildren(ul);
      } catch (e) {
        liste.replaceChildren(el('p', null, `Kunne ikke hente noterne: ${e.message}`));
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (arbejder) backend.stop();
      else sendBesked();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!arbejder) sendBesked();
      }
    });
    input.addEventListener('input', tilpasHoejde);
    $('ny').addEventListener('click', () => {
      if (arbejder) backend.stop();
      backend.ny();
      visVelkomst();
      input.focus();
    });
    if (noterKnap) noterKnap.addEventListener('click', visNoter);

    saetArbejder(false);
    visVelkomst();
  }

  window.Opslag = { start, markdown };
})();
