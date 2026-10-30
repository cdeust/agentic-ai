-- TEMOIN : SQL de §4.5 avant la revision 9ab10ae, copie verbatim de docs/design/platform-v3-srt.md @727097d.
-- Sert uniquement a etablir si le defaut decrit en §1.3 existait (T-45, tests/t45.ts). Ne pas utiliser.
-- budget.reserve : ne retient le montant qu'une fois, une ligne si et seulement si la réservation existe
WITH held AS (
  UPDATE platform.budgets SET reserved = reserved + $3
   WHERE task = $1 AND NOT overdrawn AND reserved + spent + $3 <= cap
     AND NOT EXISTS (SELECT 1 FROM platform.budget_reservations WHERE id = $2)
   RETURNING 1)
INSERT INTO platform.budget_reservations (id, task, amount, state)
SELECT $2, $1, $3, 'reserved' FROM held ON CONFLICT (id) DO NOTHING;
SELECT state FROM platform.budget_reservations WHERE id = $2;
-- budget.settle : amount retiré de reserved, coût réel ajouté à spent, overdrawn si spent dépasse cap
UPDATE platform.budgets SET reserved = reserved - $2, spent = spent + $3, overdrawn = spent + $3 > cap WHERE task = $1;
