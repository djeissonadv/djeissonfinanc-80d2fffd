-- Adiciona coluna `dividas_abertas_quitar` à tabela simulacoes_financiamento.
-- Permite informar (ou puxar da página Dívidas) o saldo total de dívidas
-- que serão quitadas com o líquido da venda do imóvel atual.
-- Subtrai do líquido — reduz o capital disponível pra entrada.

ALTER TABLE public.simulacoes_financiamento
  ADD COLUMN IF NOT EXISTS dividas_abertas_quitar NUMERIC NOT NULL DEFAULT 0;
