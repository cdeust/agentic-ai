// T-45 (docs/design/platform-v3-srt.md §4.5) : budgets sur un Postgres 17 REEL. Le SQL du document est extrait tel quel (jamais recopie) et joue
// avec des transactions concurrentes. L'ancien SQL (sql/budget.old.sql, copie verbatim de 727097d) sert de TEMOIN : le document dit que le defaut
// n'a ete etabli que par lecture ; si le temoin ne montre rien, le test ne prouve rien (resultat `fail`).
// T-20 est rejoue sur le nouveau SQL (et sur l'ancien, pour comparaison). Les helpers observe/mark_unknown sont des UPDATE gardes ecrits par le banc,
// pas du SQL du document. La migration (contraintes d'etat, settled_cost = 0 pour not_sent, settled_by obligatoire) n'est PAS ecrite ici.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { benchRoot, record, type Result } from '../lib/common.ts';
import { findPgBin, startCluster } from '../lib/pg-cluster.ts';

const bin = findPgBin();
if (!bin) {
  record('T-45', 'Postgres 17 introuvable (PG_BIN)', 'findPgBin', 'fail', 'ni PG_BIN ni emplacement connu ; sur le poste, PG_BIN=/opt/homebrew/opt/postgresql@17/bin');
  process.exit(0);
}
const cluster = await startCluster(bin);
const pool = new pg.Pool({ host: cluster.host, port: cluster.port, user: 'bench', database: 'postgres', max: 100 });
pool.on('error', () => undefined);

// ---- SQL ----
const doc = readFileSync(path.join(benchRoot, '../docs/design/platform-v3-srt.md'), 'utf8');
const sec = doc.slice(doc.indexOf('### 4.5 Budgets'), doc.indexOf('### 4.6'));
const block = /```sql\n([\s\S]*?)```/.exec(sec)?.[1] ?? '';
const statements = (text: string): string[] =>
  text.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
const [newReserveText = '', newSettleText = ''] = block.split('-- budget.settle(');
const NEW = { reserve: statements(newReserveText).filter((s) => !/^(BEGIN|COMMIT)$/i.test(s)), settle: statements(newSettleText.slice(newSettleText.indexOf('\n'))).filter((s) => !/^(BEGIN|COMMIT)$/i.test(s)) };
const oldText = readFileSync(path.join(benchRoot, 'sql/budget.old.sql'), 'utf8');
const [oldReserveText = '', oldSettleText = ''] = oldText.split('-- budget.settle :');
const OLD = { reserve: statements(oldReserveText), settle: statements(oldSettleText.slice(oldSettleText.indexOf('\n'))) };

const lit = (v: string | number | null): string => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : pg.escapeLiteral(v));
const bind = (sql: string, p: Array<string | number | null>): string => {
  let out = sql;
  for (let i = p.length; i >= 1; i--) out = out.split(`$${i}`).join(lit(p[i - 1] as string | number | null));
  return out;
};
type Row = Record<string, unknown>;
async function exec(stmts: string[], params: Array<string | number | null>, tx: boolean): Promise<{ rows: Row[]; err?: string }> {
  const c = await pool.connect();
  try {
    if (tx) await c.query('BEGIN');
    let rows: Row[] = [];
    for (const s of stmts) rows = (await c.query(bind(s, params))).rows;
    if (tx) await c.query('COMMIT');
    return { rows };
  } catch (e) {
    if (tx) await c.query('ROLLBACK').catch(() => undefined);
    return { rows: [], err: (e as { code?: string }).code ?? (e as Error).message };
  } finally {
    c.release();
  }
}
const reserveNew = (task: string, id: string, amt: number) => exec(NEW.reserve, [task, id, amt], true);
const settleNew = (id: string, source: string, cost: number, by: string | null = null, why: string | null = null) => exec(NEW.settle, [id, source, cost, by, why], true);
const reserveOld = (task: string, id: string, amt: number) => exec(OLD.reserve, [task, id, amt], false);
const settleOld = (task: string, amt: number, cost: number) => exec(OLD.settle, [task, amt, cost], false);
const q = async (sql: string, p: unknown[] = []): Promise<Row[]> => (await pool.query(sql, p)).rows;
const observe = (id: string) => q("UPDATE platform.budget_reservations SET state = 'observed' WHERE id = $1 AND state = 'reserved'", [id]);
const markUnknown = (id: string) => q("UPDATE platform.budget_reservations SET state = 'unknown' WHERE id = $1 AND state = 'reserved'", [id]);

async function reset(tasks: Array<[string, number]>): Promise<void> {
  await q('DROP SCHEMA IF EXISTS platform CASCADE');
  await q('CREATE SCHEMA platform');
  await q('CREATE TABLE platform.budgets (task text PRIMARY KEY, cap bigint NOT NULL, reserved bigint NOT NULL DEFAULT 0, spent bigint NOT NULL DEFAULT 0, overdrawn boolean NOT NULL DEFAULT false)');
  await q('CREATE TABLE platform.budget_reservations (id text PRIMARY KEY, task text NOT NULL REFERENCES platform.budgets(task), amount bigint NOT NULL, state text NOT NULL, settled_source text, settled_cost bigint, settled_by text, settled_reason text)');
  await q('CREATE TABLE platform.budget_transitions (from_state text NOT NULL, source text NOT NULL, PRIMARY KEY (from_state, source))');
  for (const [f, s] of [['reserved', 'not_sent'], ['observed', 'usage'], ['observed', 'invoice'], ['unknown', 'usage'], ['unknown', 'invoice'], ['observed', 'admin'], ['unknown', 'admin']]) await q('INSERT INTO platform.budget_transitions VALUES ($1, $2)', [f, s]);
  for (const [t, cap] of tasks) await q('INSERT INTO platform.budgets (task, cap) VALUES ($1, $2)', [t, cap]);
}
const budget = async (task: string): Promise<{ reserved: number; spent: number; overdrawn: boolean }> => {
  const r = (await q('SELECT reserved, spent, overdrawn FROM platform.budgets WHERE task = $1', [task]))[0] as { reserved: string; spent: string; overdrawn: boolean };
  return { reserved: Number(r.reserved), spent: Number(r.spent), overdrawn: r.overdrawn };
};
/** Invariant : reserved = somme des montants non regles ; spent = somme des couts regles. */
async function invariant(): Promise<{ ok: boolean; detail: string }> {
  const rows = await q(`SELECT b.task, b.reserved, b.spent,
      COALESCE(SUM(r.amount) FILTER (WHERE r.state IN ('reserved','observed','unknown')), 0) AS held,
      COALESCE(SUM(r.settled_cost) FILTER (WHERE r.state IN ('settled','settled_admin')), 0) AS paid
    FROM platform.budgets b LEFT JOIN platform.budget_reservations r ON r.task = b.task GROUP BY b.task, b.reserved, b.spent`);
  const bad = rows.filter((r) => Number(r['reserved']) !== Number(r['held']) || Number(r['spent']) !== Number(r['paid']));
  return { ok: bad.length === 0, detail: bad.length ? `INVARIANT VIOLE ${JSON.stringify(bad.slice(0, 3))}` : `invariant tenu (${rows.length} budget(s))` };
}
const count = async (id: string): Promise<number> => Number((await q('SELECT count(*) AS n FROM platform.budget_reservations WHERE id = $1', [id]))[0]?.['n']);
const cmd = (s: string): string => `${cluster.version} ; ${s}`;
const verdict = (ok: boolean): Result => (ok ? 'pass' : 'fail');
const tally = (rs: Array<{ rows: Row[]; err?: string }>): { rows: number; none: number; errs: Record<string, number> } => {
  const errs: Record<string, number> = {};
  for (const r of rs) if (r.err) errs[r.err] = (errs[r.err] ?? 0) + 1;
  return { rows: rs.filter((r) => r.rows.length > 0).length, none: rs.filter((r) => r.rows.length === 0 && !r.err).length, errs };
};

try {
  record('T-45-sync', 'le SQL joue est celui du document (extrait de §4.5, jamais recopie) : 3 instructions de reserve, 1 de settle', cmd('lecture de docs/design/platform-v3-srt.md'),
    verdict(NEW.reserve.length === 3 && NEW.settle.length === 1 && OLD.reserve.length === 2 && OLD.settle.length === 1),
    `nouveau: reserve=${NEW.reserve.length} (BEGIN/COMMIT retires, pilotes par le banc) settle=${NEW.settle.length} ; ancien: reserve=${OLD.reserve.length} settle=${OLD.settle.length} ; parametres substitues en litteraux par le banc (le SQL n'est pas modifie)`);

  // T-45a : N reserve simultanes au meme identifiant. Plusieurs manches, une task par manche.
  {
    const N = 50, R = 6;
    const oneRound = async (v: 'new' | 'old', r: number) => {
      const t = `ta${r}`;
      const res = await Promise.all(Array.from({ length: N }, () => (v === 'new' ? reserveNew(t, `res-${t}`, 10) : reserveOld(t, `res-${t}`, 10))));
      return { res, b: await budget(t), n: await count(`res-${t}`) };
    };
    await reset(Array.from({ length: R }, (_, r) => [`ta${r}`, 1000]));
    const outs = [];
    for (let r = 0; r < R; r++) outs.push(await oneRound('new', r));
    const inv = await invariant();
    const same = outs.every((o) => o.res.every((x) => x.rows.length === 1 && x.rows[0]?.['state'] === 'reserved' && Number(x.rows[0]?.['amount']) === 10));
    const held = outs.map((o) => o.b.reserved);
    record('T-45a', `${N} reserve simultanes du meme reservation_id (x${R} manches) : le budget n'est retenu qu'une fois, une seule ligne, toutes les reponses = la ligne persistee`, cmd('pool de 100 connexions, READ COMMITTED'),
      verdict(held.every((h) => h === 10) && outs.every((o) => o.n === 1) && same && inv.ok && outs.every((o) => !Object.keys(tally(o.res).errs).length)),
      `reserved_par_manche=${JSON.stringify(held)} (attendu 10 chacune) lignes=${JSON.stringify(outs.map((o) => o.n))} reponses_identiques=${same} erreurs=${JSON.stringify(outs.map((o) => tally(o.res).errs))} ; ${inv.detail}`);

    await reset(Array.from({ length: R }, (_, r) => [`ta${r}`, 1000]));
    const old = [];
    for (let r = 0; r < R; r++) old.push(await oneRound('old', r));
    const over = old.filter((o) => o.b.reserved > 10).length;
    record('T-45a-temoin', `TEMOIN, ancien SQL, memes ${N} appels simultanes : le defaut de §1.3 existe-t-il ?`, cmd('sql/budget.old.sql, autocommit comme ecrit'),
      verdict(over > 0), // le temoin DOIT echouer sur le defaut ; sinon le test ne prouve rien
      `manches_avec_budget_sur_retenu=${over}/${R} reserved_par_manche=${JSON.stringify(old.map((o) => o.b.reserved))} (attendu 10 si correct) lignes=${JSON.stringify(old.map((o) => o.n))} ; ` +
      (over > 0 ? 'DEFAUT ETABLI PAR L\'EXECUTION : l\'ancien SQL retient le montant plusieurs fois pour une seule reservation' : 'LE TEMOIN N\'A RIEN MONTRE : le defaut n\'est pas reproduit, T-45a ne prouve rien contre lui'));
  }

  // T-45b : N reglements simultanes de la meme reservation.
  {
    const N = 50, R = 6;
    await reset(Array.from({ length: R }, (_, r) => [`tb${r}`, 1000]));
    const outs = [];
    for (let r = 0; r < R; r++) {
      const id = `res-tb${r}`;
      await reserveNew(`tb${r}`, id, 10);
      await observe(id);
      const res = await Promise.all(Array.from({ length: N }, () => settleNew(id, 'usage', 7)));
      outs.push({ res, b: await budget(`tb${r}`) });
    }
    const inv = await invariant();
    record('T-45b', `${N} settle simultanes de la meme reservation (x${R} manches) : un seul debit (spent 7, reserved 0), une seule transition`, cmd('pool de 100 connexions'),
      verdict(outs.every((o) => o.b.spent === 7 && o.b.reserved === 0 && tally(o.res).rows === 1 && tally(o.res).none === N - 1 && !Object.keys(tally(o.res).errs).length) && inv.ok),
      `budgets=${JSON.stringify(outs.map((o) => [o.b.reserved, o.b.spent]))} lignes_rendues_par_manche=${JSON.stringify(outs.map((o) => tally(o.res).rows))} (attendu 1) erreurs=${JSON.stringify(outs.map((o) => tally(o.res).errs))} ; ${inv.detail}`);

    await reset([['tb0', 100000]]);
    await reserveOld('tb0', 'res-old', 10);
    const res = await Promise.all(Array.from({ length: N }, () => settleOld('tb0', 10, 7)));
    const b = await budget('tb0');
    record('T-45b-temoin', `TEMOIN, ancien SQL, ${N} settle du meme montant : double debit ?`, cmd('sql/budget.old.sql'), verdict(b.spent > 7),
      `spent=${b.spent} reserved=${b.reserved} (attendu 7 et 0 si le reglement etait unique) ; ` + (b.spent > 7 ? 'DEFAUT ETABLI PAR L\'EXECUTION : l\'ancien reglement est rejouable (aucun identifiant ni garde d\'etat) ; reserved devient negatif' : 'TEMOIN SANS EFFET') + ` reponses=${res.length}`);
  }

  // T-45c : rejeu sequentiel, parametres de reconciliation sans effet sur task et montant, isolation entre taches.
  {
    await reset([['tc-a', 1000], ['tc-b', 1000]]);
    await reserveNew('tc-a', 'res-a', 10);
    await reserveNew('tc-b', 'res-b', 30);
    await observe('res-a');
    const first = await settleNew('res-a', 'usage', 7);
    const replay = await settleNew('res-a', 'usage', 7);
    const replayOtherCost = await settleNew('res-a', 'usage', 900);
    const admin = await settleNew('res-a', 'admin', 1, 'alice', 'x');
    const a = await budget('tc-a'), b = await budget('tc-b');
    const notSentOnObserved = await settleNew('res-b', 'not_sent', 0); // reserved -> not_sent : permis
    const b2 = await budget('tc-b');
    const inv = await invariant();
    record('T-45c', 'rejeu du reglement : zero ligne, rien de plus debite, meme avec un autre cout ou une source admin ; la task et le montant retenu viennent de la ligne persistee', cmd('sequentiel'),
      verdict(first.rows.length === 1 && replay.rows.length === 0 && replayOtherCost.rows.length === 0 && admin.rows.length === 0 && a.spent === 7 && a.reserved === 0 && b.reserved === 30 && b.spent === 0 && notSentOnObserved.rows.length === 1 && b2.reserved === 0 && b2.spent === 0 && inv.ok),
      `premier=${JSON.stringify(first.rows)} rejeu=${replay.rows.length} rejeu_autre_cout=${replayOtherCost.rows.length} admin_apres_regle=${admin.rows.length} ; A=${JSON.stringify(a)} B(non touchee)=${JSON.stringify(b)} ; B not_sent depuis reserved: ${notSentOnObserved.rows.length} ligne, B=${JSON.stringify(b2)} (montant 30 libere, pris de la ligne) ; ${inv.detail}`);

    await reset([['tc-a', 1000], ['tc-b', 1000]]);
    await reserveOld('tc-a', 'res-a', 10);
    await reserveOld('tc-b', 'res-b', 30);
    await settleOld('tc-b', 999, 0); // appelant qui fournit task et montant : l'ancien SQL les croit
    const bb = await budget('tc-b');
    record('T-45c-temoin', 'TEMOIN, ancien SQL : task et montant pris des parametres de reconciliation', cmd('sql/budget.old.sql'), verdict(bb.reserved !== 30),
      `reserved de B apres settle(B, 999, 0) = ${bb.reserved} (la ligne persistee de B retient 30) ; ` + (bb.reserved !== 30 ? 'DEFAUT ETABLI : un parametre faux deforme le budget' : 'TEMOIN SANS EFFET'));
  }

  // T-45d : plafond tenu en parallele (T-20 rejoue).
  for (const v of ['new', 'old'] as const) {
    await reset([['td', 1000]]);
    const reserve = (i: number | string) => (v === 'new' ? reserveNew('td', `r-${i}`, 10) : reserveOld('td', `r-${i}`, 10));
    const res = await Promise.all(Array.from({ length: 300 }, (_, i) => reserve(i)));
    const accepted = res.map((r, i) => (r.rows.length ? i : -1)).filter((i) => i >= 0);
    const b1 = await budget('td');
    for (const i of accepted) {
      if (v === 'new') { await observe(`r-${i}`); await settleNew(`r-${i}`, 'usage', 7); } else await settleOld('td', 10, 7);
    }
    const b2 = await budget('td');
    const res2 = await Promise.all(Array.from({ length: 100 }, (_, i) => reserve(`b-${i}`)));
    const acc2 = res2.filter((r) => r.rows.length).length;
    const inv = v === 'new' ? await invariant() : { ok: true, detail: 'invariant non evalue (l\'ancien SQL ne reglait pas par identifiant)' };
    const ok = accepted.length === 100 && b1.reserved === 1000 && b2.reserved === 0 && b2.spent === 700 && acc2 === 30 && inv.ok;
    record(v === 'new' ? 'T-45d' : 'T-45d-ancien', v === 'new' ? 'T-20 rejoue sur le SQL de §4.5 : 300 reservations de 10, plafond 1000 en parallele : exactement 100 ; reglement a 7 : 30 de plus passent' : 'T-20 sur l\'ancien SQL (comparaison, valeur historique : 100 puis 30)', cmd(v === 'new' ? 'pool de 100 connexions' : 'sql/budget.old.sql'),
      verdict(ok), `acceptees=${accepted.length} (attendu 100) apres: ${JSON.stringify(b1)} ; apres reglement: ${JSON.stringify(b2)} (attendu reserved 0 spent 700) ; nouvelles acceptees=${acc2} (attendu 30) ; erreurs=${JSON.stringify(tally(res).errs)} ; ${inv.detail}`);
  }

  // T-45e : etats. unknown garde le montant ; not_sent refuse hors reserved ; usage exige observed ou unknown ; admin exige observed ou unknown ; terminaux.
  {
    await reset([['te', 1000]]);
    const ids = ['u1', 'u2', 'u3', 'r1', 'o1', 'o2'];
    for (const id of ids) await reserveNew('te', id, 10);
    for (const id of ['u1', 'u2', 'u3']) await markUnknown(id);
    for (const id of ['o1', 'o2']) await observe(id);
    const held = await budget('te');
    const unknownNotSent = await settleNew('u1', 'not_sent', 0);
    const reservedUsage = await settleNew('r1', 'usage', 7);
    const reservedAdmin = await settleNew('r1', 'admin', 5, 'alice', 'x');
    const unknownUsage = await settleNew('u2', 'usage', 4);
    const unknownAdmin = await settleNew('u3', 'admin', 9, 'alice', 'facture Console');
    const observedNotSent = await settleNew('o1', 'not_sent', 0);
    const observedInvoice = await settleNew('o2', 'invoice', 6);
    const states = Object.fromEntries((await q('SELECT id, state FROM platform.budget_reservations ORDER BY id')).map((r) => [r['id'], r['state']]));
    const b = await budget('te');
    const inv = await invariant();
    record('T-45e', 'etats : unknown garde le montant retenu ; not_sent refuse hors reserved ; usage/invoice/admin seulement depuis observed/unknown ; settled_admin vs settled', cmd('transitions de budget_transitions'),
      verdict(held.reserved === 60 && unknownNotSent.rows.length === 0 && reservedUsage.rows.length === 0 && reservedAdmin.rows.length === 0 && unknownUsage.rows.length === 1 && unknownAdmin.rows.length === 1 && observedNotSent.rows.length === 0 && observedInvoice.rows.length === 1 &&
        states['u2'] === 'settled' && states['u3'] === 'settled_admin' && states['o2'] === 'settled' && states['u1'] === 'unknown' && states['r1'] === 'reserved' && states['o1'] === 'observed' && b.reserved === 30 && b.spent === 19 && inv.ok),
      `retenu_avec_unknown=${held.reserved} (attendu 60) refus: unknown+not_sent=${unknownNotSent.rows.length} reserved+usage=${reservedUsage.rows.length} reserved+admin=${reservedAdmin.rows.length} observed+not_sent=${observedNotSent.rows.length} (attendus 0) ; etats=${JSON.stringify(states)} ; budget=${JSON.stringify(b)} (attendu reserved 30, spent 19) ; ${inv.detail}`);
  }

  // T-45f : facture superieure au plafond : overdrawn, spent enregistre le reel, toute nouvelle reservation refusee.
  {
    await reset([['tf', 100]]);
    await reserveNew('tf', 'f1', 50);
    await observe('f1');
    const s = await settleNew('f1', 'usage', 150);
    const b = await budget('tf');
    const next = await reserveNew('tf', 'f2', 1);
    const inv = await invariant();
    record('T-45f', 'facture reelle (150) superieure au plafond (100) : spent=150 enregistre, overdrawn, nouvelle reservation refusee', cmd('un budget'),
      verdict(s.rows.length === 1 && b.spent === 150 && b.reserved === 0 && b.overdrawn && next.rows.length === 0 && inv.ok), `budget=${JSON.stringify(b)} reserve_suivante=${next.rows.length} ligne(s) (attendu 0) ; ${inv.detail}. BUDGET_OVERRUN au registre : hors perimetre du banc (T-46, Gherkin)`);
  }

  // T-45g : reserve et settle melanges en parallele : pas d'interblocage, invariant tenu.
  {
    const R = 4;
    let deadlocks = 0, otherErrors: Record<string, number> = {};
    let allInv = true, detail = '';
    for (let r = 0; r < R; r++) {
      await reset([['tg1', 1_000_000], ['tg2', 1_000_000]]);
      const pre: string[] = [];
      for (let i = 0; i < 100; i++) { const t = i % 2 ? 'tg1' : 'tg2'; await reserveNew(t, `p-${i}`, 10); await observe(`p-${i}`); pre.push(`p-${i}`); }
      const ops: Array<Promise<{ rows: Row[]; err?: string }>> = [];
      for (let i = 0; i < 300; i++) ops.push(reserveNew(i % 2 ? 'tg1' : 'tg2', `n-${i}`, 10));
      for (const id of pre) { ops.push(settleNew(id, 'usage', 7)); ops.push(settleNew(id, 'usage', 7)); }
      for (let i = 0; i < 100; i++) ops.push(reserveNew('tg1', `n-${i * 2 + 1}`, 10)); // rejeux de reserve
      const res = await Promise.all(ops);
      const t = tally(res);
      deadlocks += t.errs['40P01'] ?? 0;
      for (const [k, v] of Object.entries(t.errs)) if (k !== '40P01') otherErrors[k] = (otherErrors[k] ?? 0) + v;
      const inv = await invariant();
      allInv &&= inv.ok;
      detail = inv.detail;
    }
    record('T-45g', `reserve distincts, rejeux de reserve et settle (rejoues) melanges, 600 operations x${R} manches : aucun interblocage (40P01), invariant tenu`, cmd('pool de 100 connexions'),
      verdict(deadlocks === 0 && Object.keys(otherErrors).length === 0 && allInv), `interblocages=${deadlocks} autres_erreurs=${JSON.stringify(otherErrors)} ; ${detail}`);
  }

  // T-45h : task inconnue, reservation_id deja present avec un autre montant (RESERVATION_CONFLICT cote appelant).
  {
    await reset([['th', 1000]]);
    const unknownTask = await reserveNew('absente', 'x', 10);
    await reserveNew('th', 'h1', 10);
    const conflict = await reserveNew('th', 'h1', 99);
    const b = await budget('th');
    record('T-45h', 'task inconnue : zero ligne (refus) ; meme id avec un autre montant : la ligne persistee est rendue (amount 10), rien de plus retenu', cmd('un budget'),
      verdict(unknownTask.rows.length === 0 && conflict.rows.length === 1 && Number(conflict.rows[0]?.['amount']) === 10 && b.reserved === 10),
      `task_inconnue=${unknownTask.rows.length} ligne conflit=${JSON.stringify(conflict.rows)} budget=${JSON.stringify(b)} ; la comparaison task/montant et RESERVATION_CONFLICT reviennent a l'appelant (non joues ici)`);
  }

  // ---- Ordre des verrous (revue externe) : trois variantes, ordre statique puis interblocage provoque. ----
  // Variante corrigee (ecrite par le banc, pas dans le document) : settle retrouve la task, verrouille budgets, puis le SQL du document verrouille et modifie la reservation.
  const FIXED_SETTLE = ["SELECT b.task FROM platform.budgets b WHERE b.task = (SELECT task FROM platform.budget_reservations WHERE id = $1) FOR UPDATE", ...NEW.settle];
  const settleFixed = (id: string, source: string, cost: number) => exec(FIXED_SETTLE, [id, source, cost, null, null], true);
  const lockOrder = (stmts: string[]): string[] => {
    const seq: string[] = [];
    for (const st of stmts) {
      const flat = st.replace(/\s+/g, ' ');
      const ev: Array<[number, string]> = [];
      for (const m of flat.matchAll(/FROM platform\.(\w+)[^;]*? FOR UPDATE/g)) ev.push([m.index ?? 0, `${m[1]}:FOR UPDATE`]);
      for (const m of flat.matchAll(/INSERT INTO platform\.(\w+)/g)) ev.push([m.index ?? 0, `${m[1]}:INSERT`]);
      for (const m of flat.matchAll(/(?<!FOR )UPDATE platform\.(\w+)/g)) ev.push([m.index ?? 0, `${m[1]}:UPDATE`]);
      seq.push(...ev.sort((a, b) => a[0] - b[0]).map((e) => e[1]));
    }
    return seq;
  };
  const orders = { reserve: lockOrder(NEW.reserve), settleNew: lockOrder(NEW.settle), settleFixed: lockOrder(FIXED_SETTLE), settleOld: lockOrder(OLD.settle) };
  const firstTable = (o: string[]): string | undefined => o[0]?.split(':')[0];
  record('T-45i', 'ordre de verrouillage lu dans le SQL lui-meme : reserve vs settle (document) vs settle corrige', cmd('analyse statique du texte SQL'), 'finding',
    `reserve(doc)=${JSON.stringify(orders.reserve)} ; settle(doc)=${JSON.stringify(orders.settleNew)} ; settle(corrige)=${JSON.stringify(orders.settleFixed)} ; settle(ancien)=${JSON.stringify(orders.settleOld)}. ` +
    (firstTable(orders.reserve) !== firstTable(orders.settleNew) ? 'CONFIRME : le SQL du document n\'a PAS un ordre uniforme (reserve : budgets puis budget_reservations ; settle : budget_reservations puis budgets).' : 'ordre uniforme dans le document') +
    (firstTable(orders.reserve) === firstTable(orders.settleFixed) ? ' La variante corrigee a l\'ordre uniforme budgets -> budget_reservations.' : ' La variante corrigee n\'a pas l\'ordre uniforme.'));

  // Entrelacement force : A (reserve) tient le verrou de budgets au milieu de sa transaction ; B (settle) demarre alors, sur la meme task.
  // Aucune instruction de reserve ne demande une ligne de budget_reservations deja existante : on attend donc une simple attente, pas un cycle.
  for (const [name, settleFn] of [['document', settleNew], ['corrige', settleFixed]] as const) {
    await reset([['ti', 1000]]);
    await reserveNew('ti', 'i-pre', 10);
    await observe('i-pre');
    const A = await pool.connect();
    let deadlock = 0, errs: string[] = [];
    try {
      await A.query('BEGIN');
      await A.query(bind(NEW.reserve[0] as string, ['ti', 'i-new', 10])); // verrou de budgets pris
      let settleDone = false;
      const B = settleFn('i-pre', 'usage', 7).then((r) => { settleDone = true; return r; });
      await new Promise((r) => setTimeout(r, 400)); // B a eu le temps de se bloquer (ou de finir s'il ne se bloque pas)
      const blocked = !settleDone;
      await A.query(bind(NEW.reserve[1] as string, ['ti', 'i-new', 10]));
      await A.query(bind(NEW.reserve[2] as string, ['ti', 'i-new', 10]));
      await A.query('COMMIT');
      const rb = await B;
      if (rb.err) errs.push(rb.err);
      if (rb.err === '40P01') deadlock++;
      const b = await budget('ti');
      const inv = await invariant();
      record(`T-45j-${name}`, `entrelacement force (reserve tient budgets, settle de la meme task arrive) sur le SQL ${name}`, cmd('deux connexions, une attente de 400 ms'),
        verdict(deadlock === 0 && errs.length === 0 && b.reserved === 10 && b.spent === 7 && inv.ok),
        `settle_bloque_pendant_le_verrou=${blocked} interblocage=${deadlock} erreurs=${JSON.stringify(errs)} budget=${JSON.stringify(b)} (attendu reserved 10 = i-new, spent 7) ; ${inv.detail}`);
    } finally {
      A.release();
    }
  }

  // Stress : reserve (neufs et rejoues) et settle (neufs et rejoues) sur les MEMES tasks, en parallele, pour provoquer 40P01 s'il est atteignable.
  for (const [name, settleFn] of [['document', settleNew], ['corrige', settleFixed]] as const) {
    const R = 6;
    let dl = 0;
    const others: Record<string, number> = {};
    let okInv = true, detail = '';
    for (let r = 0; r < R; r++) {
      await reset([['tk1', 10_000_000], ['tk2', 10_000_000]]);
      const pre: string[] = [];
      for (let i = 0; i < 150; i++) { await reserveNew(i % 2 ? 'tk1' : 'tk2', `p-${i}`, 10); await observe(`p-${i}`); pre.push(`p-${i}`); }
      const ops: Array<Promise<{ rows: Row[]; err?: string }>> = [];
      for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 20; j++) ops.push(reserveNew(j % 2 ? 'tk1' : 'tk2', `n-${i}-${j}`, 10), reserveNew(j % 2 ? 'tk1' : 'tk2', `n-${i}-${j}`, 10));
        for (let j = 0; j < 12; j++) { const id = pre[(i * 12 + j) % pre.length] as string; ops.push(settleFn(id, 'usage', 7), settleFn(id, 'usage', 7)); }
      }
      const t = tally(await Promise.all(ops));
      dl += t.errs['40P01'] ?? 0;
      for (const [k, v] of Object.entries(t.errs)) if (k !== '40P01') others[k] = (others[k] ?? 0) + v;
      const inv = await invariant();
      okInv &&= inv.ok; detail = inv.detail;
    }
    record(`T-45k-${name}`, `stress ${R} manches (~1400 operations sur 2 tasks : reserve neufs/rejoues + settle neufs/rejoues) sur le SQL ${name} : SQLSTATE 40P01 relevés`, cmd('pool de 100 connexions'),
      verdict(dl === 0 && Object.keys(others).length === 0 && okInv), `40P01=${dl} autres_SQLSTATE=${JSON.stringify(others)} ; ${detail}`);
  }
  // Temoin ancien SQL : autocommit, aucune transaction multi-instruction ; l'interblocage n'y est pas possible, le defaut est ailleurs (T-45a/b).
  record('T-45k-ancien', 'ancien SQL : interblocage sans objet (instructions autocommit, une seule table verrouillee a la fois) ; son defaut est la perte de coherence (T-45a, T-45b, T-45c)', cmd('sql/budget.old.sql'), 'finding', 'non rejoue sous stress : aucune transaction multi-instruction, donc aucun ordre de verrous a comparer');
} catch (e) {
  record('T-45', 'exception du banc Postgres', cmd('t45'), 'fail', String((e as Error).stack ?? e).slice(0, 1500));
} finally {
  await pool.end().catch(() => undefined);
  await cluster.stop();
}
process.exit(0);
