import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { type, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let systemPrompt = "";
    let userPrompt = "";

    switch (type) {
      case "dashboard_insights": {
        systemPrompt = `Você é um consultor financeiro pessoal brasileiro, direto e técnico. Gere insights a partir SÓ dos dados fornecidos.

Regras (OBRIGATÓRIAS):
- 3 a 5 bullets, ordenados do mais relevante (mais dinheiro em jogo) ao menos. CADA bullet começa com o número que o motiva (R$ ou %) e diz o que fazer a respeito.
- Priorize: anomalias e categorias em alta (cite a variação % e o R$), depois oportunidade concreta de economia (qual categoria cortar e quanto), depois risco de comprometimento da renda.
- Proibido conselho genérico sem número ("gaste com consciência", "monte uma reserva"). Se não houver dado pra um ponto, não invente — omita.
- Não repita o que o usuário já vê (totais do mês). Interprete: o que mudou, o que é fora do padrão, o que decidir.
- Máximo ~160 palavras. Markdown. No máximo 1 emoji por bullet, só se agregar.`;
        userPrompt = `Analise este resumo financeiro do mês:
- Receita base: R$ ${context.receita}
- Total despesas: R$ ${context.totalDespesas}
- Total receitas extras: R$ ${context.totalReceitas}
- Saldo projetado: R$ ${context.saldoProjetado}
- % da renda gasta: ${context.percentGasto?.toFixed(1)}%
- Reserva mínima configurada: R$ ${context.reserva}
- Essenciais: R$ ${context.totalEssencial} (${context.pctEssencial?.toFixed(0)}%)
- Não-essenciais: R$ ${context.totalNaoEssencial}

Top categorias de gasto:
${context.topCategorias?.map((c: any) => `- ${c.cat}: R$ ${c.total.toFixed(2)} (${c.pct.toFixed(0)}%)`).join('\n') || 'Nenhuma despesa'}

${context.parcelasAtivas ? `Parcelas ativas: ${context.parcelasAtivas} compromissos futuros` : ''}
${context.faturasPendentes ? `Faturas de cartão pendentes: ${context.faturasPendentes}` : ''}

${context.spendingTrends?.length ? `\nTendências de gastos por categoria:\n${context.spendingTrends.map((t: any) => `- ${t.categoria}: ${t.tendencia} (${t.variacao > 0 ? '+' : ''}${t.variacao.toFixed(0)}%), média recente R$ ${t.mediaRecente.toFixed(0)}`).join('\n')}` : ''}

${context.anomalies?.length ? `\nGastos anômalos detectados:\n${context.anomalies.map((a: any) => `- ${a.categoria} em ${a.mes}: R$ ${a.valor.toFixed(0)} (média R$ ${a.media.toFixed(0)}, excesso R$ ${a.excesso.toFixed(0)})`).join('\n')}` : ''}

${context.recurringCharges?.length ? `\nCobranças recorrentes identificadas (${context.recurringCharges.length} itens): total mensal estimado R$ ${context.recurringCharges.reduce((s: number, r: any) => s + r.valor, 0).toFixed(0)}` : ''}

${context.healthScore ? `\nScore de saúde financeira: ${context.healthScore}/100 (${context.healthNivel})` : ''}

${context.commitmentAvg ? `\nComprometimento médio da renda: ${context.commitmentAvg.toFixed(0)}%` : ''}
${context.commitmentTrend ? `Tendência de comprometimento: ${context.commitmentTrend}` : ''}`;
        break;
      }

      case "category_analysis": {
        systemPrompt = `Você é um consultor financeiro pessoal brasileiro, direto e técnico. Analise UMA categoria com base só nos números fornecidos.

Regras (OBRIGATÓRIAS):
- 2 a 3 bullets, cada um ancorado num número (R$ ou %).
- Compare o gasto do mês com a média histórica: diga se está acima/abaixo e em quanto (R$ e %).
- Se fizer sentido cortar, diga um alvo concreto (ex: "voltar à média economiza R$ X/mês"). Se for essencial, foque em otimizar, não em cortar.
- Sem conselho genérico. Máximo ~90 palavras. Markdown.`;
        userPrompt = `Categoria: ${context.categoria}
Total gasto este mês: R$ ${context.totalCategoria}
Percentual do total: ${context.pctTotal?.toFixed(1)}%
Receita mensal: R$ ${context.receita}
Quantidade de transações: ${context.qtdTransacoes}
${context.mediaHistorica ? `Média histórica (3 meses): R$ ${context.mediaHistorica.toFixed(2)}` : ''}
É categoria essencial: ${context.essencial ? 'Sim' : 'Não'}`;
        break;
      }

      case "financing_viability": {
        systemPrompt = `Você é um consultor financeiro e imobiliário brasileiro, direto e técnico. Analise a viabilidade de um financiamento da Caixa (sistema SAC) com base SÓ nos números fornecidos.

Regras de resposta (OBRIGATÓRIAS):
- Comece com um veredito em 1 linha: **APROVAR**, **APROVAR COM RESSALVAS** ou **NÃO AGORA**.
- Depois, no máximo 5 bullets. CADA bullet cita um número concreto do contexto (R$ ou %) e explica a consequência. Nada de conselho genérico ("controle seus gastos", "monte uma reserva") sem número.
- Aponte explicitamente O MAIOR risco e A ÚNICA alavanca de maior impacto (ex: "aumentar entrada em R$ X derruba a parcela para R$ Y").
- Se houver venda de imóvel financiando a entrada, avalie se o líquido cobre entrada + custos + reserva, e o risco de timing (vender antes de comprar).
- Não repita todos os números de volta; interprete. Máximo ~180 palavras. Português do Brasil. Markdown.`;
        userPrompt = `Simulação de financiamento (Caixa, SAC):
- Valor do imóvel: R$ ${context.valorImovel}
- Entrada: R$ ${context.entrada} (${context.percEntrada?.toFixed(1)}%)
- Valor financiado: R$ ${context.financiado}
- Taxa de juros: ${context.taxaAnual}% a.a.
- Prazo: ${context.prazoAnos} anos
- Parcela inicial (SAC, decrescente): R$ ${context.parcelaInicial}
- Total de juros no prazo: R$ ${context.totalJuros}
- % da renda comprometida pela parcela: ${context.percRenda?.toFixed(1)}%
- Semáforo do checklist: ${context.semaforo}

Contexto financeiro:
- Renda bruta familiar: R$ ${context.receitaMensal}
- Outras dívidas mensais: R$ ${context.despesasMensais}
- Saldo livre hoje: R$ ${context.saldoLivre}
- Saldo livre após a parcela: R$ ${context.saldoComFinanciamento}
${context.temVenda ? `
Entrada financiada pela VENDA do imóvel atual:
- Valor de venda: R$ ${context.valorVendaImovel}
- Líquido da venda (após quitar saldo/IPTU/IR/custos): R$ ${context.liquidoVenda}
- Capital total para a compra: R$ ${context.capitalParaCompra}
- Reserva de emergência necessária: R$ ${context.reservaNecessaria}
- Sobra após entrada + custos + reserva: R$ ${context.capitalRestante}` : ''}`;
        break;
      }

      case "scenario_analysis": {
        systemPrompt = `Você é um consultor financeiro e imobiliário brasileiro, direto e técnico. Compare os 4 cenários com base SÓ nos números reais fornecidos. Estruture em 5 seções Markdown curtas, cada afirmação ancorada num número (R$ ou %):
1. **Recomendação** — qual cenário (0/1/2/3) e por quê, citando o saldo/mês de cada um que sustenta a escolha.
2. **Timing** — em que mês comprar e o porquê numérico (ex: quando o saldo livre passa de R$ X).
3. **Riscos** — o maior risco concreto da situação, com número.
4. **Alavancas** — a alavanca de maior impacto (qual gasto/dívida mexer e quanto melhora o saldo).
5. **Meta de reserva** — quanto manter em R$ antes de comprar.

Proibido frase genérica sem número. Máximo ~220 palavras no total.`;
        const c = context;
        userPrompt = `Análise de cenários para compra de imóvel:

Dados do usuário (baseados em ${c.mesesAnalisados} meses de dados reais):
- Receita média mensal: R$ ${c.receita}
- Imóvel: R$ ${c.parametros.valorImovel} | Entrada: R$ ${c.parametros.entrada}
- Saldo devedor carro: R$ ${c.parametros.saldoDevedorCarro}
- Parcela carro: R$ ${c.parametros.parcelaCarro}/mês
- Meses restantes carro: ${c.parametros.mesesRestantesCarro}
- Empréstimos ativos: R$ ${c.parametros.emprestimosAtivos}/mês

Cenário 0 (Atual): Saldo livre R$ ${c.cenario0.saldo}/mês | 12 meses: R$ ${c.cenario0.saldo12}
Cenário 1 (Compra+Carro): Saldo R$ ${c.cenario1.saldo}/mês | Δ ${c.cenario1.delta}/mês
Cenário 2 (Quita Carro): Saldo R$ ${c.cenario2.saldo}/mês | Δ ${c.cenario2.delta}/mês | Custo quitar: R$ ${c.cenario2.custoQuitar}
Cenário 3 (Carro Quita Sozinho): Saldo com carro R$ ${c.cenario3.saldoComCarro}, sem carro R$ ${c.cenario3.saldoSemCarro}, melhora no mês ${c.cenario3.mesMelhora}`;
        break;
      }

      case "debt_strategy": {
        systemPrompt = `Você é um consultor financeiro brasileiro especialista em quitação de dívidas, direto e técnico. Monte um plano de saída com base SÓ nos números fornecidos.

Regras de resposta (OBRIGATÓRIAS):
- Use método avalanche (atacar o maior juro primeiro) salvo se uma dívida pequena puder ser quitada em 1-2 meses (aí cite o ganho psicológico de eliminá-la).
- Estrutura em Markdown, máximo ~200 palavras:
  1. **Ordem de ataque**: liste em que ordem quitar, citando o porquê com número (taxa % ou saldo R$).
  2. **A maior sangria**: aponte qual dívida custa mais em juros e o quanto se evita quitando antes.
  3. **Efeito bola de neve**: o que fazer com o valor que sobra quando cada dívida acaba.
  4. **1 ação concreta neste mês**: específica e numérica.
- Dívidas com taxa "null" têm juro desconhecido — diga pra ele cadastrar/descobrir a taxa, não invente.
- NADA de conselho genérico ("gaste menos", "faça reserva") sem número. Português do Brasil.`;
        const d = context;
        userPrompt = `Situação de dívidas:
- Total restante: R$ ${d.totalRestante?.toFixed(0)}
- Compromisso mensal: R$ ${d.totalMensal?.toFixed(0)}${d.comprometimentoRenda != null ? ` (${d.comprometimentoRenda.toFixed(0)}% da renda de R$ ${d.rendaMensal?.toFixed(0)})` : ''}
- Livre de dívidas em: ${d.mesLiberdade} (${d.mesesAteLiberdade} meses no ritmo atual)
- Juros evitáveis quitando à vista (onde a taxa é conhecida): R$ ${d.jurosEvitaveis?.toFixed(0)}

Dívidas (ordenadas por prioridade sugerida):
${d.dividas?.map((x: any) => `- ${x.nome}: R$ ${x.valorMensal?.toFixed(0)}/mês, ${x.parcelasRestantes}x restantes, R$ ${x.valorRestante?.toFixed(0)} no total, taxa ${x.taxaAno != null ? x.taxaAno + '% a.a.' : 'desconhecida'}`).join('\n')}`;
        break;
      }

      default:
        return new Response(JSON.stringify({ error: "Tipo de análise inválido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Limite de requisições atingido. Tente novamente em alguns minutos." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "Créditos de IA esgotados. Adicione créditos nas configurações." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erro ao consultar IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "Sem resposta da IA";

    return new Response(JSON.stringify({ analysis: content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-advisor error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
