-- Dia de vencimento da fatura do cartão (1-31), detectado na importação.
-- Aditivo e nullable — não afeta contas existentes.
ALTER TABLE public.contas
  ADD COLUMN IF NOT EXISTS dia_vencimento INTEGER;
