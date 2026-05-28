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

    // Formatadores seguros: número ausente/NaN vira "—" em vez de "undefined"/"NaN".
    // Sem isso, o prompt chegava com "R$ undefined (NaN%)" e o modelo INVENTAVA
    // valores em cima do lixo, gerando relatórios errados.
    const brl = (n: unknown, dec = 2): string => {
      const v = typeof n === "number" && isFinite(n) ? n : null;
      return v == null
        ? "—"
        : v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    };
    const pct = (n: unknown, dec = 0): string => {
      const v = typeof n === "number" && isFinite(n) ? n : null;
      return v == null ? "—" : v.toFixed(dec);
    };

    if (!context || typeof context !== "object") {
      return new Response(JSON.stringify({ error: "Contexto ausente ou inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
- Receita base: R$ ${brl(context.receita)}
- Total despesas: R$ ${brl(context.totalDespesas)}
- Total receitas extras: R$ ${brl(context.totalReceitas)}
- Saldo projetado: R$ ${brl(context.saldoProjetado)}
- % da renda gasta: ${pct(context.percentGasto, 1)}%
- Reserva mínima configurada: R$ ${brl(context.reserva)}
- Essenciais: R$ ${brl(context.totalEssencial)} (${pct(context.pctEssencial)}%)
- Não-essenciais: R$ ${brl(context.totalNaoEssencial)}

Top categorias de gasto:
${context.topCategorias?.length ? context.topCategorias.map((c: any) => `- ${c.cat}: R$ ${brl(c.total)} (${pct(c.pct)}%)`).join('\n') : 'Nenhuma despesa'}

${context.parcelasAtivas ? `Parcelas ativas: ${context.parcelasAtivas} compromissos futuros` : ''}
${context.faturasPendentes ? `Faturas de cartão pendentes: ${context.faturasPendentes}` : ''}

${context.spendingTrends?.length ? `\nTendências de gastos por categoria:\n${context.spendingTrends.map((t: any) => `- ${t.categoria}: ${t.tendencia} (${typeof t.variacao === 'number' && t.variacao > 0 ? '+' : ''}${pct(t.variacao)}%), média recente R$ ${brl(t.mediaRecente)}`).join('\n')}` : ''}

${context.anomalies?.length ? `\nGastos anômalos detectados:\n${context.anomalies.map((a: any) => `- ${a.categoria} em ${a.mes}: R$ ${brl(a.valor)} (média R$ ${brl(a.media)}, excesso R$ ${brl(a.excesso)})`).join('\n')}` : ''}

${context.recurringCharges?.length ? `\nCobranças recorrentes identificadas (${context.recurringCharges.length} itens): total mensal estimado R$ ${brl(context.recurringCharges.reduce((s: number, r: any) => s + (typeof r.valor === 'number' ? r.valor : 0), 0))}` : ''}

${context.healthScore ? `\nScore de saúde financeira: ${context.healthScore}/100 (${context.healthNivel})` : ''}

${context.commitmentAvg != null ? `\nComprometimento médio da renda: ${pct(context.commitmentAvg)}%` : ''}
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
Total gasto este mês: R$ ${brl(context.totalCategoria)}
Percentual do total: ${pct(context.pctTotal, 1)}%
Receita mensal: R$ ${brl(context.receita)}
Quantidade de transações: ${context.qtdTransacoes}
${context.mediaHistorica != null ? `Média histórica (3 meses): R$ ${brl(context.mediaHistorica)}` : ''}
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
- Valor do imóvel: R$ ${brl(context.valorImovel)}
- Entrada: R$ ${brl(context.entrada)} (${pct(context.percEntrada, 1)}%)
- Valor financiado: R$ ${brl(context.financiado)}
- Taxa de juros: ${pct(context.taxaAnual, 2)}% a.a.
- Prazo: ${context.prazoAnos} anos
- Parcela inicial (SAC, decrescente): R$ ${brl(context.parcelaInicial)}
- Total de juros no prazo: R$ ${brl(context.totalJuros)}
- % da renda comprometida pela parcela: ${pct(context.percRenda, 1)}%
- Semáforo do checklist: ${context.semaforo}

Contexto financeiro:
- Renda bruta familiar: R$ ${brl(context.receitaMensal)}
- Outras dívidas mensais: R$ ${brl(context.despesasMensais)}
- Saldo livre hoje: R$ ${brl(context.saldoLivre)}
- Saldo livre após a parcela: R$ ${brl(context.saldoComFinanciamento)}
${context.temVenda ? `
Entrada financiada pela VENDA do imóvel atual:
- Valor de venda: R$ ${brl(context.valorVendaImovel)}
- Líquido da venda (após quitar saldo/IPTU/IR/custos): R$ ${brl(context.liquidoVenda)}
- Capital total para a compra: R$ ${brl(context.capitalParaCompra)}
- Reserva de emergência necessária: R$ ${brl(context.reservaNecessaria)}
- Sobra após entrada + custos + reserva: R$ ${brl(context.capitalRestante)}` : ''}`;
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
- Receita média mensal: R$ ${brl(c.receita)}
- Imóvel: R$ ${brl(c.parametros?.valorImovel)} | Entrada: R$ ${brl(c.parametros?.entrada)}
- Saldo devedor carro: R$ ${brl(c.parametros?.saldoDevedorCarro)}
- Parcela carro: R$ ${brl(c.parametros?.parcelaCarro)}/mês
- Meses restantes carro: ${c.parametros?.mesesRestantesCarro}
- Empréstimos ativos: R$ ${brl(c.parametros?.emprestimosAtivos)}/mês

Cenário 0 (Atual): Saldo livre R$ ${brl(c.cenario0?.saldo)}/mês | 12 meses: R$ ${brl(c.cenario0?.saldo12)}
Cenário 1 (Compra+Carro): Saldo R$ ${brl(c.cenario1?.saldo)}/mês | Δ ${brl(c.cenario1?.delta)}/mês
Cenário 2 (Quita Carro): Saldo R$ ${brl(c.cenario2?.saldo)}/mês | Δ ${brl(c.cenario2?.delta)}/mês | Custo quitar: R$ ${brl(c.cenario2?.custoQuitar)}
Cenário 3 (Carro Quita Sozinho): Saldo com carro R$ ${brl(c.cenario3?.saldoComCarro)}, sem carro R$ ${brl(c.cenario3?.saldoSemCarro)}, melhora no mês ${c.cenario3?.mesMelhora}`;
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
- Total restante: R$ ${brl(d.totalRestante, 0)}
- Compromisso mensal: R$ ${brl(d.totalMensal, 0)}${d.comprometimentoRenda != null ? ` (${pct(d.comprometimentoRenda)}% da renda de R$ ${brl(d.rendaMensal, 0)})` : ''}
- Livre de dívidas em: ${d.mesLiberdade} (${d.mesesAteLiberdade} meses no ritmo atual)
- Juros evitáveis quitando à vista (onde a taxa é conhecida): R$ ${brl(d.jurosEvitaveis, 0)}

Dívidas (ordenadas por prioridade sugerida):
${d.dividas?.map((x: any) => `- ${x.nome}: R$ ${brl(x.valorMensal, 0)}/mês, ${x.parcelasRestantes}x restantes, R$ ${brl(x.valorRestante, 0)} no total, taxa ${x.taxaAno != null ? pct(x.taxaAno) + '% a.a.' : 'desconhecida'}`).join('\n')}`;
        break;
      }

      case "budget_review": {
        systemPrompt = `Você é um consultor financeiro de um CASAL, direto e técnico. Analise o orçamento do mês com base SÓ nos números fornecidos (orçamento único do casal).

Regras (OBRIGATÓRIAS):
- Comece com 1 linha de veredito: o mês está **no azul**, **apertado** ou **no vermelho**, citando a sobra projetada em R$.
- Depois, no máximo 4 bullets, cada um ancorado num número (R$ ou %): a categoria que mais ameaça o orçamento (e quanto cortar pra voltar ao trilho), o ponto da regra 50/30/20 que está fora, e a ação de maior impacto no mês.
- Use as projeções (fim do mês) quando o mês ainda está correndo. Não invente categorias que não vieram.
- Proibido conselho genérico ("economizem", "controlem gastos") sem número. Máximo ~160 palavras. Markdown. Português do Brasil.`;
        const c = context;
        userPrompt = `Orçamento do casal${c.mesCorrente ? ' (mês em andamento)' : ' (mês fechado)'}:
- Receita esperada: R$ ${brl(c.receita, 0)}
- Gasto até agora: R$ ${brl(c.despesaMes, 0)} | Projeção fim do mês: R$ ${brl(c.despesaProjetada, 0)}
- Sobra projetada: R$ ${brl(c.sobraProjetada, 0)}
- Essenciais: R$ ${brl(c.essenciais, 0)} (${pct(c.pctEssenciais)}% — meta 50%)
- Não-essenciais: R$ ${brl(c.naoEssenciais, 0)}
- Poupança/sobra: ${pct(c.pctPoupanca)}% (meta 20%)
${c.alertas?.length ? `\nAlertas por categoria:\n${c.alertas.map((a: any) => `- ${a.categoria}: ${a.tipo} (gasto R$ ${brl(a.gastoMes, 0)}, projeção R$ ${brl(a.projecao, 0)}${a.meta != null ? `, meta R$ ${brl(a.meta, 0)}` : `, média R$ ${brl(a.media, 0)}`})`).join('\n')}` : ''}
${c.categorias?.length ? `\nGasto por categoria (mês / média):\n${c.categorias.map((x: any) => `- ${x.categoria}: R$ ${brl(x.gastoMes, 0)} / média R$ ${brl(x.media, 0)}${x.meta != null ? ` (meta R$ ${brl(x.meta, 0)})` : ''}`).join('\n')}` : ''}`;
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
        temperature: 0.3,
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
    const content = data.choices?.[0]?.message?.content;

    // Valida a resposta: se vier vazia ou for "lixo" sem nenhum número, devolve
    // erro em vez de exibir um texto genérico/inventado como se fosse análise.
    if (typeof content !== "string" || content.trim().length < 10) {
      console.error("AI empty/short response:", JSON.stringify(data).slice(0, 500));
      return new Response(
        JSON.stringify({ error: "A IA não retornou uma análise utilizável. Tente novamente." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ analysis: content.trim() }), {
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
