import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---------------------------------------------------------------------------
// Formatadores seguros (não-numéricos viram "—" — evita "R$ undefined" no prompt)
// ---------------------------------------------------------------------------
const brl = (n: unknown, dec = 0): string => {
  const v = typeof n === "number" && isFinite(n) ? n : null;
  return v == null
    ? "—"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
};
const pct = (n: unknown, dec = 0): string => {
  const v = typeof n === "number" && isFinite(n) ? n : null;
  return v == null ? "—" : v.toFixed(dec);
};

// ---------------------------------------------------------------------------
// Prompt do sistema POR MODO. Claude recebe instruções específicas pra cada
// tipo de análise; o prompt do user vem com os dados ENRIQUECIDOS, não crus.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPTS: Record<string, string> = {
  analises_deep_analysis: `Você é um consultor financeiro pessoal brasileiro sênior, analítico e direto. Sua função é PRODUZIR UM RELATÓRIO ANALÍTICO de 1 a 2 minutos de leitura sobre os últimos 12 meses do usuário.

ESTRUTURA OBRIGATÓRIA (markdown, exatamente nesta ordem):

## Tese
Uma frase forte resumindo a situação financeira do usuário hoje. Use número.

## O que mudou
3 a 5 bullets do que MUDOU nos últimos 3 meses vs 3 meses anteriores. Cada bullet ancora num número (R$ ou %). Mostra trend ↑↓ visualmente com emoji se ajudar.

## Onde está o dinheiro
Quebra de despesas por categoria (top 5), com R$ e % da despesa total. Cite o maior dreno.

## Riscos
2 a 4 riscos REAIS (não genéricos). Cada um cita número e diz a consequência se não tratado. Anomalias, comprometimento alto com parcelas, queda de receita, gastos não-essenciais subindo, etc.

## Oportunidades
2 a 3 alavancas concretas com IMPACTO MENSURÁVEL: "cortar X economiza R$ Y/mês", "renegociar Z libera R$ W". Sem genericismo.

## Ação imediata
1 ação ESPECÍFICA pra este mês (não "controle gastos") — diga categoria, valor a cortar, ou comportamento exato a mudar.

REGRAS:
- 400-600 palavras no total. Não exceda.
- Cada afirmação tem número. Sem genericismo.
- Português do Brasil, tom firme mas respeitoso.
- Use **negrito** pros números importantes.
- Não invente categorias que não vieram nos dados.`,

  analises_ask: `Você é um consultor financeiro pessoal brasileiro sênior. O usuário vai te fazer uma pergunta específica sobre as próprias finanças. Você recebe um RESUMO dos dados dele junto da pergunta.

REGRAS:
- Responda DIRETO ao que ele perguntou, citando números do contexto.
- Se a pergunta envolve dinheiro, dê resposta quantitativa (R$, %).
- Se algo não está no contexto, diga "não tenho esse dado" — NÃO INVENTE.
- Use markdown, máximo 200 palavras. Sem cabeçalhos longos.
- Português do Brasil.`,

  projecoes_scenario: `Você é um consultor financeiro pessoal brasileiro analisando um CENÁRIO PROJETADO de fluxo de caixa. Avalie a viabilidade do plano.

ESTRUTURA:
1. **Veredito** em 1 linha: SUSTENTÁVEL / APERTADO / INSUSTENTÁVEL, citando saldo projetado.
2. **Quando aperta** — em que mês o saldo livre fica negativo (se ficar), por quê.
3. **A maior fragilidade** — qual variável mais sensibiliza o cenário (parcela do imóvel, receita, etc.).
4. **Como fortalecer** — 2 ajustes concretos com impacto numérico no saldo final 12m.

REGRAS: máximo 200 palavras, markdown, sem genericismo, números em todo bullet.`,

  planejamento_review: `Você é um consultor financeiro pessoal brasileiro revisando um ORÇAMENTO MENSAL em andamento. Identifique o que está fora do trilho e o que ajustar.

ESTRUTURA:
1. **Pulso do mês** — 1 linha: NO AZUL / APERTADO / VERMELHO, com sobra projetada.
2. **O que está estourando** — categorias acima da meta/média, R$ excedente.
3. **O que está sob controle** — 1-2 categorias modelo.
4. **Ajuste único de maior impacto** — uma mudança específica com impacto numérico no fim do mês.
5. **Regra 50/30/20** — qual dos 3 pilares está fora e em quanto.

REGRAS: máximo 220 palavras, markdown, números em tudo.`,

  dividas_strategy: `Você é um consultor financeiro brasileiro especialista em quitação de dívidas. Monte um plano DETALHADO de saída a partir dos dados.

ESTRUTURA:
1. **Avalanche ou bola de neve** — qual ordem ataca primeiro e por quê (juro vs valor).
2. **Ordem de quitação** — liste 1, 2, 3... com razão numérica pra cada.
3. **Custo de adiar** — quanto juros se evita quitando antecipado a dívida mais cara.
4. **Bola de neve** — após quitar X, redirecionar o valor pra Y acelera saída em quantos meses.
5. **Ação deste mês** — quanto destinar a qual dívida, valor exato.

REGRAS: máximo 280 palavras, markdown, números obrigatórios, taxas "null" significam desconhecidas — pede pra cadastrar, não chuta.`,
};

// ---------------------------------------------------------------------------
// Builder do prompt do usuário POR MODO. Recebe `context` e gera o texto que
// vai pro Claude. Isolar aqui mantém o servidor simples e o front passa só dados.
// ---------------------------------------------------------------------------
function buildUserPrompt(mode: string, ctx: any): string {
  if (mode === "analises_deep_analysis") {
    const monthlySummary = (ctx.monthlySummary || []) as Array<any>;
    const categories = (ctx.topCategories || []) as Array<any>;
    const trends = (ctx.spendingTrends || []) as Array<any>;
    const anomalies = (ctx.anomalies || []) as Array<any>;
    const recurring = (ctx.recurringCharges || []) as Array<any>;

    return `Dados do usuário (últimos ${monthlySummary.length} meses):

RECEITA BASE MENSAL: R$ ${brl(ctx.receitaBase)}
SALDO ATUAL EM CONTA: R$ ${brl(ctx.saldoAtual)}
RESERVA MÍNIMA CONFIG.: R$ ${brl(ctx.reservaMinima)}
SCORE DE SAÚDE FINANCEIRA: ${ctx.healthScore ?? "—"}/100 (${ctx.healthNivel ?? "—"})

FLUXO DE CAIXA POR MÊS:
${monthlySummary.map((m) => `- ${m.mes}: receita R$ ${brl(m.receita)} / despesa R$ ${brl(m.despesa)} / sobra R$ ${brl(m.sobra)}`).join("\n")}

DESPESA TOTAL ÚLTIMOS 3 MESES: R$ ${brl(ctx.totalDespesa3m)}
DESPESA TOTAL 3 MESES ANTERIORES: R$ ${brl(ctx.totalDespesa3mPrev)}

TOP CATEGORIAS DE GASTO (mês corrente):
${categories.slice(0, 8).map((c: any) => `- ${c.cat}: R$ ${brl(c.total)} (${pct(c.pct)}%)`).join("\n") || "—"}

TENDÊNCIAS POR CATEGORIA (3 últimos meses vs 3 anteriores):
${trends.slice(0, 8).map((t: any) => `- ${t.categoria}: ${t.tendencia} (${typeof t.variacao === "number" && t.variacao > 0 ? "+" : ""}${pct(t.variacao)}%), média recente R$ ${brl(t.mediaRecente)} vs R$ ${brl(t.mediaAnterior)} antes`).join("\n") || "—"}

ANOMALIAS DETECTADAS:
${anomalies.slice(0, 5).map((a: any) => `- ${a.categoria} em ${a.mes}: R$ ${brl(a.valor)} (média R$ ${brl(a.media)}, excesso R$ ${brl(a.excesso)})`).join("\n") || "Nenhuma anomalia significativa."}

COBRANÇAS RECORRENTES (top 8):
${recurring.slice(0, 8).map((r: any) => `- ${r.descricao}: R$ ${brl(r.valor)} (frequência ${r.frequencia}m, categoria ${r.categoria || "—"})`).join("\n") || "—"}

PARCELAS ATIVAS: ${ctx.parcelasAtivas ?? 0}
COMPROMETIMENTO MENSAL COM PARCELAS: ${pct(ctx.commitmentAvg)}%`;
  }

  if (mode === "analises_ask") {
    const cats = (ctx.topCategories || []) as Array<any>;
    return `RESUMO FINANCEIRO DO USUÁRIO:
- Receita base mensal: R$ ${brl(ctx.receitaBase)}
- Saldo atual: R$ ${brl(ctx.saldoAtual)}
- Despesa mês corrente: R$ ${brl(ctx.despesaMes)}
- Receita mês corrente: R$ ${brl(ctx.receitaMes)}
- Score saúde: ${ctx.healthScore ?? "—"}/100
- Top categorias: ${cats.slice(0, 6).map((c: any) => `${c.cat} R$ ${brl(c.total)}`).join(", ") || "—"}
- Parcelas ativas: ${ctx.parcelasAtivas ?? 0}, comprometimento ${pct(ctx.commitmentAvg)}%

PERGUNTA DO USUÁRIO: ${ctx.question ?? "(vazia)"}`;
  }

  if (mode === "projecoes_scenario") {
    const meses = (ctx.projecaoMensal || []) as Array<any>;
    return `Cenário projetado (próximos ${meses.length} meses):
- Receita média mensal: R$ ${brl(ctx.receitaBase)}
- Despesa média recente: R$ ${brl(ctx.despesaMediaMensal)}
- Saldo inicial: R$ ${brl(ctx.saldoInicial)}
- Reserva alvo: R$ ${brl(ctx.reservaMinima)}
${ctx.parcelaImovel ? `- Parcela do financiamento: R$ ${brl(ctx.parcelaImovel)}/mês` : ""}
${ctx.dividasMensais ? `- Outras parcelas/dívidas: R$ ${brl(ctx.dividasMensais)}/mês` : ""}

PROJEÇÃO MÊS A MÊS:
${meses.map((m: any) => `- ${m.mes}: saldo livre R$ ${brl(m.saldoLivre)}, acumulado R$ ${brl(m.saldoAcumulado)}`).join("\n")}`;
  }

  if (mode === "planejamento_review") {
    const cats = (ctx.categorias || []) as Array<any>;
    const alertas = (ctx.alertas || []) as Array<any>;
    return `Orçamento do casal — ${ctx.mesCorrente ? "mês em andamento" : "mês fechado"}:
- Receita esperada: R$ ${brl(ctx.receita)}
- Gasto até agora: R$ ${brl(ctx.despesaMes)} | Projeção fim do mês: R$ ${brl(ctx.despesaProjetada)}
- Sobra projetada: R$ ${brl(ctx.sobraProjetada)}
- Essenciais: R$ ${brl(ctx.essenciais)} (${pct(ctx.pctEssenciais)}% — meta 50%)
- Não-essenciais: R$ ${brl(ctx.naoEssenciais)}
- Poupança/sobra: ${pct(ctx.pctPoupanca)}% (meta 20%)

ALERTAS:
${alertas.map((a: any) => `- ${a.categoria}: ${a.tipo} (gasto R$ ${brl(a.gastoMes)}, projeção R$ ${brl(a.projecao)}${a.meta != null ? `, meta R$ ${brl(a.meta)}` : `, média R$ ${brl(a.media)}`})`).join("\n") || "—"}

CATEGORIAS (gasto mês / média histórica):
${cats.slice(0, 10).map((x: any) => `- ${x.categoria}: R$ ${brl(x.gastoMes)} / R$ ${brl(x.media)} ${x.meta != null ? `(meta R$ ${brl(x.meta)})` : ""}`).join("\n") || "—"}`;
  }

  if (mode === "dividas_strategy") {
    const d = ctx;
    return `Dívidas:
- Total restante: R$ ${brl(d.totalRestante)}
- Compromisso mensal: R$ ${brl(d.totalMensal)}${d.comprometimentoRenda != null ? ` (${pct(d.comprometimentoRenda)}% da renda de R$ ${brl(d.rendaMensal)})` : ""}
- Livre em: ${d.mesLiberdade} (${d.mesesAteLiberdade} meses)
- Juros evitáveis quitando à vista: R$ ${brl(d.jurosEvitaveis)}

DÍVIDAS (ordenadas por prioridade sugerida):
${(d.dividas || []).map((x: any) => `- ${x.nome}: R$ ${brl(x.valorMensal)}/mês, ${x.parcelasRestantes}x restantes, R$ ${brl(x.valorRestante)} no total, taxa ${x.taxaAno != null ? pct(x.taxaAno) + "% a.a." : "DESCONHECIDA — cadastrar"}`).join("\n")}`;
  }

  throw new Error(`Modo inválido: ${mode}`);
}

// ---------------------------------------------------------------------------
// Chamada Claude — usa o messages API com cache de prompt no system block
// (5min TTL). Reduz custo em queries repetidas no mesmo ctx.
// ---------------------------------------------------------------------------
async function callClaude(systemPrompt: string, userPrompt: string): Promise<{ ok: true; content: string } | { ok: false; status: number; error: string }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { ok: false, status: 500, error: "ANTHROPIC_API_KEY não configurada" };
  const model = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-5";

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0.3,
      system: [
        // cache_control no system → revisitar prompt do mesmo modo sai mais barato
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    console.error("Claude error:", r.status, t.slice(0, 400));
    return { ok: false, status: r.status, error: `Anthropic API ${r.status}: ${t.slice(0, 300)}` };
  }
  const data: any = await r.json();
  const text = data?.content
    ?.filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("") || "";
  return { ok: true, content: text };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { mode, context } = await req.json();
    if (!mode || !context) {
      return new Response(JSON.stringify({ error: "Parâmetros 'mode' e 'context' obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = SYSTEM_PROMPTS[mode];
    if (!systemPrompt) {
      return new Response(JSON.stringify({ error: `Modo '${mode}' não suportado` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrompt = buildUserPrompt(mode, context);
    const result = await callClaude(systemPrompt, userPrompt);

    if (!result.ok) {
      const status = result.status === 429 ? 429 : result.status === 401 ? 401 : 500;
      const msg =
        result.status === 429
          ? "Limite de requisições do Claude atingido. Tente novamente em alguns segundos."
          : result.status === 401
          ? "Chave Claude inválida ou expirada."
          : "Erro ao consultar Claude.";
      return new Response(JSON.stringify({ error: msg, detail: result.error }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (result.content.trim().length < 20) {
      console.error("Claude resposta curta:", result.content);
      return new Response(JSON.stringify({ error: "Claude retornou resposta vazia. Tente de novo." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ analysis: result.content.trim(), mode }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-analyst error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
