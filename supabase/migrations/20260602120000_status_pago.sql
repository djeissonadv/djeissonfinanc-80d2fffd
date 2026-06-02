-- Mobills-style: status pago/pendente em cada transação.
--
-- Default TRUE pra retrocompat: todas as transações existentes assumem que
-- já aconteceram (importadas de extrato ou lançadas como fato consumado).
-- Pode ser editado depois individualmente.
--
-- Regras semânticas:
--   pago = true  → afeta saldo da conta, conta nos totais do mês
--   pago = false → projetada/pendente, NÃO afeta saldo, aparece em
--                  "Próximos vencimentos" e em projeções

ALTER TABLE public.transacoes
  ADD COLUMN IF NOT EXISTS pago BOOLEAN NOT NULL DEFAULT true;

-- Índice pra acelerar queries de "Próximos vencimentos" e saldo
CREATE INDEX IF NOT EXISTS idx_transacoes_pago
  ON public.transacoes (user_id, pago, data)
  WHERE pago = false;
