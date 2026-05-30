import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CATEGORIAS_DESPESA = [
  "Alimentação", "Assinatura", "Beleza", "Casa", "Compras", "Educação",
  "Empréstimos", "Lazer", "Operação bancária", "Outros", "Pais Maiara",
  "Presente", "Produtora", "Saúde", "Serviços", "Transporte", "Vestuário", "Viagem"
];

const CATEGORIAS_RECEITA = [
  "Salário/Pró-labore", "Freelance/PJ", "Receita Produtora", "Investimentos",
  "Vendas", "Reembolsos", "Devoluções", "Transferência entre contas", "Outras receitas"
];

// Padrão de dispatch: prefere Gemini direto (pós-migração); cai pro gateway
// Lovable enquanto está em transição. Ambos retornam o mesmo shape `{ status,
// args? }` para o caller não se importar com o provider.
type CategoryArgs = { categoria: string; essencial: boolean; confianca: number };
type CategoryResult = { status: number; args?: CategoryArgs };

const CAT_SCHEMA = (categorias: string[]) => ({
  type: "object",
  properties: {
    categoria: { type: "string", enum: categorias },
    essencial: { type: "boolean" },
    confianca: { type: "number" },
  },
  required: ["categoria", "essencial", "confianca"],
});

async function categorizeViaGemini(prompt: string, categorias: string[], apiKey: string): Promise<CategoryResult> {
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{
        functionDeclarations: [{
          name: "categorize_transaction",
          description: "Categorize a financial transaction",
          parameters: CAT_SCHEMA(categorias),
        }],
      }],
      toolConfig: {
        functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["categorize_transaction"] },
      },
      generationConfig: { temperature: 0.1 },
    }),
  });
  if (!r.ok) return { status: r.status };
  const raw: any = await r.json().catch(() => ({}));
  const call = raw?.candidates?.[0]?.content?.parts?.find((p: any) => p?.functionCall)?.functionCall;
  if (!call?.args) return { status: 200 };
  return { status: 200, args: call.args as CategoryArgs };
}

async function categorizeViaLovable(prompt: string, categorias: string[], apiKey: string): Promise<CategoryResult> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      tools: [{
        type: "function",
        function: {
          name: "categorize_transaction",
          description: "Categorize a financial transaction",
          parameters: { ...CAT_SCHEMA(categorias), additionalProperties: false },
        },
      }],
      tool_choice: { type: "function", function: { name: "categorize_transaction" } },
    }),
  });
  if (!r.ok) return { status: r.status };
  const data: any = await r.json();
  const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return { status: 200 };
  try {
    return { status: 200, args: JSON.parse(toolCall.function.arguments) as CategoryArgs };
  } catch {
    return { status: 200 };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { transacoes } = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!GEMINI_API_KEY && !LOVABLE_API_KEY) {
      throw new Error("Nenhum provider de IA configurado (GEMINI_API_KEY ou LOVABLE_API_KEY)");
    }

    const results = [];

    for (const tx of transacoes) {
      const isReceita = tx.tipo === 'receita';
      const categorias = isReceita ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;
      const fallback = { descricao: tx.descricao, categoria: isReceita ? "Outras receitas" : "Outros", essencial: false, confianca: 0 };

      const prompt = `Você é um assistente de categorização financeira. Analise a seguinte transação e retorne APENAS um objeto JSON (sem markdown, sem explicações):

Descrição: "${tx.descricao}"
Valor: R$ ${tx.valor}
Tipo: ${isReceita ? 'RECEITA' : 'DESPESA'}

Retorne:
{
  "categoria": "uma das categorias listadas abaixo",
  "essencial": true ou false,
  "confianca": 0-100
}

Categorias disponíveis: ${categorias.join(", ")}

Critérios para DESPESAS:
- Alimentação: supermercados, restaurantes, delivery, fruteira
- Casa: aluguel, condomínio, água, luz, internet, gás, móveis
- Saúde: farmácia, consultas, plano de saúde, seguro de vida
- Transporte: combustível, financiamento carro, seguro carro, manutenção, imposto veicular
- Serviços: celular, serviços gerais
- Assinatura: serviços recorrentes (Netflix, Spotify, etc)
- Lazer: hobbys, entretenimento
- Essencial: necessário para sobrevivência/trabalho

Critérios para RECEITAS:
- Salário/Pró-labore: salário fixo, pró-labore
- Freelance/PJ: trabalhos avulsos, nota fiscal PJ
- Receita Produtora: receitas de produtora de vídeo/conteúdo
- Investimentos: dividendos, juros, rendimentos
- Vendas: venda de produtos ou itens usados
- Reembolsos: reembolso de despesas
- Devoluções: estornos, devoluções de compras
- Transferência entre contas: PIX/TED entre contas próprias`;

      try {
        const result = GEMINI_API_KEY
          ? await categorizeViaGemini(prompt, categorias, GEMINI_API_KEY)
          : await categorizeViaLovable(prompt, categorias, LOVABLE_API_KEY!);

        if (result.status === 429) { results.push({ ...fallback, error: "rate_limited" }); continue; }
        if (result.status === 402) { results.push({ ...fallback, error: "payment_required" }); continue; }
        if (!result.args) { results.push(fallback); continue; }
        results.push({ descricao: tx.descricao, ...result.args });
      } catch {
        results.push(fallback);
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("categorize error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
