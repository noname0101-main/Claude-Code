'use strict';

/*
 * Værktøjer, som vores egen server udfører, når AI'en beder om det:
 * dato og tid, udregninger (med Hygge-sproget fra resten af repoet) og
 * noter, der bliver gemt i noter.json på din egen computer.
 */

const fs = require('fs');
const path = require('path');
const Hygge = require('../hygge');

const TIDSZONE = 'Europe/Copenhagen';

function ugenummer(dato) {
  // ISO-uge: ugen med årets første torsdag er uge 1
  const d = new Date(Date.UTC(dato.getFullYear(), dato.getMonth(), dato.getDate()));
  const dag = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dag);
  const aarStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - aarStart) / 86400000 + 1) / 7);
}

function datoOgTid(nu = new Date()) {
  const lokal = new Date(nu.toLocaleString('en-US', { timeZone: TIDSZONE }));
  const tekst = new Intl.DateTimeFormat('da-DK', {
    timeZone: TIDSZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(nu);
  return `${tekst} (uge ${ugenummer(lokal)}, tidszone ${TIDSZONE})`;
}

class Noter {
  constructor(fil) {
    this.fil = fil;
  }

  hent() {
    try {
      const data = JSON.parse(fs.readFileSync(this.fil, 'utf8'));
      return Array.isArray(data.noter) ? data : { naesteId: 1, noter: [] };
    } catch (e) {
      return { naesteId: 1, noter: [] };
    }
  }

  gem(data) {
    fs.writeFileSync(this.fil, JSON.stringify(data, null, 2) + '\n');
  }

  tilfoej(tekst, emne) {
    if (typeof tekst !== 'string' || !tekst.trim()) throw new Error('Noten er tom.');
    const data = this.hent();
    const note = { id: `n${data.naesteId}`, tekst: tekst.trim(), emne: (emne || '').trim(), gemt: new Date().toISOString() };
    data.naesteId += 1;
    data.noter.push(note);
    this.gem(data);
    return note;
  }

  find(ord) {
    const soeg = String(ord || '').trim().toLocaleLowerCase('da');
    const { noter } = this.hent();
    if (!soeg) return noter;
    const dele = soeg.split(/\s+/);
    return noter.filter((n) => {
      const hel = `${n.tekst} ${n.emne}`.toLocaleLowerCase('da');
      return dele.some((d) => hel.includes(d));
    });
  }

  slet(id) {
    const data = this.hent();
    const foer = data.noter.length;
    data.noter = data.noter.filter((n) => n.id !== id);
    if (data.noter.length === foer) throw new Error(`Der findes ingen note med id "${id}".`);
    this.gem(data);
  }
}

/** Regner et udtryk ud med Hygge, fx "(350 - 32) * 5 / 9". */
function regn(udtryk) {
  const tekst = String(udtryk ?? '').trim();
  if (!tekst) throw new Error('Der er ikke noget at regne ud.');
  if (tekst.includes('\n')) throw new Error('Skriv udtrykket på én linje.');
  const r = Hygge.run(`skriv ${tekst}`, { maxSteps: 100000 });
  if (r.error) throw new Error(r.error.message);
  return r.output.filter((o) => o.type === 'tekst').map((o) => o.text).join('\n');
}

function formatNoter(noter) {
  if (!noter.length) return 'Ingen noter fundet.';
  return noter
    .map((n) => {
      const dato = new Date(n.gemt).toLocaleDateString('da-DK', { timeZone: TIDSZONE });
      return `${n.id}: ${n.tekst}${n.emne ? ` [emne: ${n.emne}]` : ''} (gemt ${dato})`;
    })
    .join('\n');
}

/** Laver de værktøjer, AI'en kan bede serveren om at køre. */
function lavVaerktoejer({ noteFil }) {
  const noter = new Noter(noteFil || path.join(__dirname, 'noter.json'));
  return {
    noter,
    /** Kører et værktøj og giver teksten tilbage, som AI'en får at se. Kaster en fejl, hvis noget går galt. */
    koer(navn, input = {}) {
      switch (navn) {
        case 'dato_og_tid':
          return datoOgTid();
        case 'regn':
          return regn(input.udtryk);
        case 'gem_note': {
          const note = noter.tilfoej(input.tekst, input.emne);
          return `Gemt som ${note.id}: ${note.tekst}`;
        }
        case 'find_noter':
          return formatNoter(noter.find(input.ord));
        case 'slet_note':
          noter.slet(String(input.id || ''));
          return `Note ${input.id} er slettet.`;
        default:
          throw new Error(`Ukendt værktøj: ${navn}`);
      }
    },
  };
}

module.exports = { lavVaerktoejer, datoOgTid, ugenummer, regn, Noter };
