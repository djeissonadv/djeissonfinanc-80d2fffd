import { useState, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  parseSicrediCSV,
  parseNubankCSV,
  normalizeDescription,
  isFaturaPayment,
  isCreditoParcelamento,
  isSaldoAnteriorFatura,
  type SkippedLine,
  type ClassifiedTransaction,
  type CsvLineLogEntry,
} from "@/lib/csv-parser";
import { autoCategorizarTransacao } from "@/lib/auto-categorize";
import { parsePdfFile, extractPdfText } from "@/lib/pdf-parser";
import { parseOFX } from "@/lib/ofx-parser";
import {
  isCreditoDescritivo,
  parseCreditoDescritivo,
  isSicrediLoanCsv,
  parseSicrediLoanCsv,
  buildEmprestimoRows,
  type CreditoDescritivo,
} from "@/lib/credito-parser";
import {
  projectFutureInstallments,
  detectConflicts,
  type ConflictMatch,
  type ProjectableTransaction,
  type ProjectedInstallment,
} from "@/lib/installment-projection";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, Check, AlertCircle, CreditCard, CalendarDays, Plus, Landmark } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ImportReport, ImportResult, DuplicateInfo, ImportedItem } from "./ImportReport";
import { CsvImportPreviewV2, type ImportPreviewData, type InstallmentGroup } from "./CsvImportPreviewV2";
import { ConflictModal } from "./ConflictModal";
import { DateCorrectionPreview, type DateCorrectionItem } from "./DateCorrectionPreview";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PlannedTransaction = {
  user_id: string;
  conta_id: string;
  data: string;
  data_original: string | null;
  mes_competencia: string | null;
  descricao: string;
  descricao_normalizada: string;
  valor: number;
  categoria: string;
  tipo: "receita" | "despesa";
  essencial: boolean;
  parcela_atual: number | null;
  parcela_total: number | null;
  grupo_parcela: string | null;
  hash_transacao: string;
  pessoa: string;
  codigo_cartao: string | null;
  valor_dolar: number | null;
  ignorar_dashboard?: boolean;
  _isOriginal: boolean;
};

interface PreparedImportPlan {
  contaNome: string;
  allTransactionsCount: number;
  newTransactions: PlannedTransaction[];
  duplicateTransactions: PlannedTransaction[];
  duplicateItems: DuplicateInfo[];
  importedOriginals: ImportedItem[];
  importedFutures: ImportedItem[];
  totalDespesas: number;
  totalReceitas: number;
  logEntries: ImportResult["logEntries"];
  autoProjectedIdsToDelete: string[];
  replacedTransactions: PlannedTransaction[];
  previewData: ImportPreviewData;
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function getDefaultDueDate(transactions: ClassifiedTransaction[]): { month: number; year: number } {
  if (transactions.length === 0) {
    const now = new Date();
    return { month: now.getMonth(), year: now.getFullYear() };
  }
  let latest = new Date(transactions[0].data + "T00:00:00");
  for (const t of transactions) {
    const d = new Date(t.data + "T00:00:00");
    if (d > latest) latest = d;
  }
  const nextMonth = new Date(latest);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return { month: nextMonth.getMonth(), year: nextMonth.getFullYear() };
}

export function CsvImportDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<"csv" | "ofx" | "pdf" | null>(null);
  const [contas, setContas] = useState<{ id: string; nome: string; tipo: string }[]>([]);
  const [selectedConta, setSelectedConta] = useState<string>("");
  const [detectedConta, setDetectedConta] = useState<string | null>(null);
  const [detectedAccountType, setDetectedAccountType] = useState<"corrente" | "credito" | null>(null);
  const [detectedAccountNumber, setDetectedAccountNumber] = useState<string | null>(null);
  const [creatingConta, setCreatingConta] = useState(false);
  const [needsManualSelect, setNeedsManualSelect] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parsedTransactions, setParsedTransactions] = useState<ClassifiedTransaction[]>([]);
  const [parsedSkippedLines, setParsedSkippedLines] = useState<SkippedLine[]>([]);
  const [parsedTotalLines, setParsedTotalLines] = useState(0);
  const [parsedLineLogs, setParsedLineLogs] = useState<CsvLineLogEntry[]>([]);
  const [parsedOpening, setParsedOpening] = useState<{ balance: number; date: string } | null>(null);
  const [parsedDueDay, setParsedDueDay] = useState<number | null>(null);
  const [loanDoc, setLoanDoc] = useState<CreditoDescritivo | null>(null);
  const [loanContaId, setLoanContaId] = useState<string>("");
  const [loanImporting, setLoanImporting] = useState(false);
  const [forceImporting, setForceImporting] = useState(false);
  const [preparedPlan, setPreparedPlan] = useState<PreparedImportPlan | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<ConflictMatch[] | null>(null);
  const [conflictContext, setConflictContext] = useState<{ contaId: string; userId: string } | null>(null);
  const [dateCorrectionItems, setDateCorrectionItems] = useState<DateCorrectionItem[] | null>(null);
  const [dateCorrectMode, setDateCorrectMode] = useState(false);

  const [dueMonth, setDueMonth] = useState<number>(new Date().getMonth());
  const [dueYear, setDueYear] = useState<number>(new Date().getFullYear());
  const [dueConfirmed, setDueConfirmed] = useState(false);

  const isCredito = useMemo(() => {
    if (detectedAccountType === "credito") return true;
    const conta = contas.find((c) => c.id === selectedConta);
    return conta?.tipo === "credito";
  }, [detectedAccountType, contas, selectedConta]);

  const dueWarning = useMemo(() => {
    if (!isCredito || parsedTransactions.length === 0) return null;
    const latestTx = parsedTransactions.reduce(
      (latest, t) => {
        const d = new Date(t.data + "T00:00:00");
        return d > latest ? d : latest;
      },
      new Date(parsedTransactions[0].data + "T00:00:00"),
    );
    // Compara com o ÚLTIMO dia do mês da fatura — lançamentos DENTRO do mês
    // (consumos, encargos) são normais e não devem disparar o alerta. Só avisa
    // se houver transação realmente depois do fim do período escolhido.
    const fimPeriodo = new Date(dueYear, dueMonth + 1, 0, 23, 59, 59);
    if (fimPeriodo < latestTx) {
      return `Período da fatura (${MONTH_NAMES[dueMonth]}/${dueYear}) é anterior a transações no extrato`;
    }
    return null;
  }, [isCredito, parsedTransactions, dueMonth, dueYear]);

  const loadContas = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("contas").select("id, nome, tipo, numero_conta").eq("user_id", user.id);
    setContas(data || []);
    return data || [];
  }, [user]);

  // Cria a conta/cartão que o extrato detectou e ainda não existe. Nasce com
  // saldo_inicial 0 — para conta de débito com OFX, o saldo anterior é aplicado
  // automaticamente na importação (Step 0). Não cria transação de abertura.
  const createDetectedAccount = async () => {
    if (!user || !detectedConta) return;
    setCreatingConta(true);
    try {
      const tipo = detectedAccountType === "credito" ? "credito" : "debito";
      const datas = parsedTransactions.map((t) => t.data).filter(Boolean).sort();
      const dataAbertura = parsedOpening?.date || datas[0] || new Date().toISOString().slice(0, 10);
      const { data: nova, error } = await supabase
        .from("contas")
        .insert({
          user_id: user.id,
          nome: detectedConta,
          tipo,
          saldo_inicial: 0,
          data_abertura: dataAbertura,
          numero_conta: detectedAccountNumber || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      await loadContas();
      setSelectedConta(nova.id);
      setNeedsManualSelect(false);
      queryClient.invalidateQueries({ queryKey: ["contas"] });
      toast({ title: `${tipo === "credito" ? "Cartão" : "Conta"} "${detectedConta}" criado` });
    } catch {
      toast({ title: "Erro ao criar a conta", variant: "destructive" });
    } finally {
      setCreatingConta(false);
    }
  };

  const handleLoanImport = async () => {
    if (!user || !loanDoc || !loanContaId) return;
    setLoanImporting(true);
    try {
      const pessoaNome = user.user_metadata?.full_name || user.email?.split("@")[0] || "Titular";
      const now = new Date();
      const hojeIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const rows = buildEmprestimoRows(loanDoc, { userId: user.id, contaId: loanContaId, pessoa: pessoaNome, hojeIso });
      if (rows.length === 0) {
        toast({ title: "Nenhuma parcela futura a lançar" });
        setLoanImporting(false);
        return;
      }
      for (let i = 0; i < rows.length; i += 50) {
        const { error } = await supabase
          .from("transacoes")
          .upsert(rows.slice(i, i + 50), { onConflict: "user_id,hash_transacao" });
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ["transacoes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["dividas-future"] });
      queryClient.invalidateQueries({ queryKey: ["dividas-parcelamentos"] });
      toast({ title: `${rows.length} parcelas do empréstimo ${loanDoc.contratoKey} lançadas` });
      handleClose();
    } catch {
      toast({ title: "Erro ao lançar o empréstimo", variant: "destructive" });
    } finally {
      setLoanImporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "csv" && ext !== "ofx" && ext !== "pdf") {
      toast({ title: "Apenas arquivos .csv, .ofx ou .pdf", variant: "destructive" });
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande (máx 10MB)", variant: "destructive" });
      return;
    }

    setFile(f);
    setFileType(ext as "csv" | "ofx" | "pdf");
    setResult(null);
    setPreparedPlan(null);
    setDueConfirmed(false);
    const contasList = await loadContas();

    let contaDetectada: string | null = null;
    let transactions: ClassifiedTransaction[] = [];
    let accountType: "corrente" | "credito" | null = null;
    let skippedLines: SkippedLine[] = [];
    let totalLines = 0;
    let lineLogs: CsvLineLogEntry[] = [];
    let openingDetected: { balance: number; date: string } | null = null;
    let accountNumber: string | null = null;
    let dueDay: number | null = null;
    let detectedDue: { month: number; year: number } | null = null;

    if (ext === "pdf") {
      try {
        // Documento Descritivo de Crédito (empréstimo/financiamento) tem fluxo próprio:
        // não é fatura, então projetamos as parcelas futuras numa conta de débito.
        const rawText = (await extractPdfText(f)).join("\n");
        if (isCreditoDescritivo(rawText)) {
          const ddc = parseCreditoDescritivo(rawText);
          if (ddc && ddc.futuras.length > 0) {
            setLoanDoc(ddc);
            const debitos = (contasList || []).filter((c: any) => c.tipo === "debito");
            setLoanContaId(debitos.length === 1 ? debitos[0].id : "");
            return; // UI do empréstimo assume daqui
          }
          toast({ title: "Documento de crédito sem parcelas futuras a lançar" });
          setFile(null);
          setFileType(null);
          return;
        }
        const pessoaNome = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Titular';
        const parsed = await parsePdfFile(f, pessoaNome);
        if (parsed.transactions.length === 0 && parsed.totalLines === 0) {
          toast({
            title: "PDF sem texto extraível",
            description: "Este PDF pode ser uma imagem escaneada. Tente exportar diretamente do app/banco.",
            variant: "destructive",
          });
          setFile(null);
          setFileType(null);
          return;
        }
        transactions = parsed.transactions;
        skippedLines = parsed.skippedLines;
        totalLines = parsed.totalLines;
        lineLogs = parsed.lineLogs;
        contaDetectada = parsed.institution;
        dueDay = parsed.detectedDueDate?.day ?? null;
        if (parsed.detectedDueDate) {
          detectedDue = { month: parsed.detectedDueDate.month, year: parsed.detectedDueDate.year };
        }
      } catch (err: any) {
        if (err?.message === "PDF_PASSWORD") {
          toast({
            title: "PDF protegido por senha",
            description: "Este PDF está protegido. Remova a senha ou exporte novamente sem proteção.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Erro ao ler PDF", description: String(err?.message || err), variant: "destructive" });
        }
        setFile(null);
        setFileType(null);
        return;
      }
    } else if (ext === "ofx") {
      const text = await f.text();
      const pessoaNomeOfx = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Titular';
      const parsed = parseOFX(text, pessoaNomeOfx);
      contaDetectada = parsed.contaDetectada;
      accountType = parsed.accountType;
      transactions = parsed.transactions;
      accountNumber = parsed.accountNumber;
      openingDetected = parsed.openingBalance != null && parsed.openingDate
        ? { balance: parsed.openingBalance, date: parsed.openingDate }
        : null;

      // Try matching by account number
      if (parsed.accountNumber && contasList) {
        const matchByNum = contasList.find((c: any) => c.numero_conta === parsed.accountNumber);
        if (matchByNum) {
          contaDetectada = matchByNum.nome;
        }
      }

      // Generate lineLogs for OFX
      lineLogs = transactions.map((t, i) => ({
        lineNumber: i + 1,
        content: `${t.data} | ${t.descricao} | ${t.valor}`,
        status: 'importada' as const,
        reason: 'Transação OFX',
        hash_transacao: t.hash_transacao,
      }));
      totalLines = transactions.length;
    } else {
      const text = await f.text();
      const pessoaNomeCsv = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Titular';

      // CSV de cronograma de empr\u00E9stimo Sicredi \u2192 fluxo de empr\u00E9stimo (n\u00E3o \u00E9 extrato).
      if (isSicrediLoanCsv(text)) {
        const ddc = parseSicrediLoanCsv(text);
        if (ddc && ddc.futuras.length > 0) {
          setLoanDoc(ddc);
          const debitos = (contasList || []).filter((c: any) => c.tipo === "debito");
          setLoanContaId(debitos.length === 1 ? debitos[0].id : "");
          return;
        }
        toast({ title: "Cronograma sem parcelas futuras a lan\u00E7ar" });
        setFile(null);
        setFileType(null);
        return;
      }

      // Detect Nubank credit card CSV (header: "date,title,amount") vs Sicredi/MP CSV
      const firstNonEmptyLine = text.replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim()) || '';
      const isNubankCsv = /^\s*date\s*,\s*title\s*,\s*amount\s*$/i.test(firstNonEmptyLine);

      const parsed = isNubankCsv
        ? parseNubankCSV(text, pessoaNomeCsv)
        : parseSicrediCSV(text, pessoaNomeCsv);
      contaDetectada = parsed.contaDetectada;
      transactions = parsed.transactions;
      skippedLines = parsed.skippedLines;
      totalLines = parsed.totalLines;
      lineLogs = parsed.lineLogs;
      if (contaDetectada && ["black", "mercado pago", "nubank"].some((n) => contaDetectada!.toLowerCase().includes(n))) {
        accountType = "credito";
      }
      // Use auto-detected due date from CSV header
      if (parsed.detectedDueDate) {
        setDueMonth(parsed.detectedDueDate.month);
        setDueYear(parsed.detectedDueDate.year);
        dueDay = parsed.detectedDueDate.day ?? null;
      } else {
        const defaultDue = getDefaultDueDate(transactions);
        setDueMonth(defaultDue.month);
        setDueYear(defaultDue.year);
      }
    }

    setDetectedConta(contaDetectada);
    setDetectedAccountType(accountType);
    setParsedTransactions(transactions);
    setParsedSkippedLines(skippedLines);
    setParsedTotalLines(totalLines);
    setParsedLineLogs(lineLogs);
    setParsedOpening(openingDetected);
    setDetectedAccountNumber(accountNumber);
    setParsedDueDay(dueDay);

    // Para PDF/OFX: prioriza o vencimento DETECTADO no documento (ex: "Vence em
    // 20/02/2026" → fatura de fevereiro). Só cai no palpite por data de transação
    // quando o documento não traz o vencimento.
    if (ext !== 'csv') {
      if (detectedDue) {
        setDueMonth(detectedDue.month);
        setDueYear(detectedDue.year);
      } else {
        const defaultDue = getDefaultDueDate(transactions);
        setDueMonth(defaultDue.month);
        setDueYear(defaultDue.year);
      }
    }

    if (contaDetectada && contasList) {
      const match = contasList.find((c: any) =>
        c.nome.toLowerCase().includes(contaDetectada!.toLowerCase()) ||
        (c.numero_conta && contaDetectada === c.numero_conta)
      );
      if (match) {
        setSelectedConta(match.id);
        setNeedsManualSelect(false);
        if (match.tipo === "credito") setDetectedAccountType("credito");
      } else {
        setNeedsManualSelect(true);
      }
    } else {
      setNeedsManualSelect(true);
    }
  };

  const applyDueDate = (
    transactions: ClassifiedTransaction[],
  ): (ClassifiedTransaction & { _data_original: string; _mes_competencia: string })[] => {
    if (!isCredito || !dueConfirmed) {
      return transactions.map((t) => ({ ...t, _data_original: t.data, _mes_competencia: "" }));
    }
    // Keep original transaction date in `data`, use billing period for `mes_competencia`
    const billingPeriod = `${dueYear}-${String(dueMonth + 1).padStart(2, "0")}`;
    return transactions.map((t) => ({
      ...t,
      _data_original: t.data,
      _mes_competencia: billingPeriod,
      // data stays as original transaction date (NOT overwritten to 01/month)
    }));
  };

  const validateBeforeImport = () => {
    if (!file || !user) return null;
    if (fileType === "csv") {
      if (parsedLineLogs.length === 0 && parsedTransactions.length === 0) {
        toast({ title: "Nenhuma linha do CSV foi lida", variant: "destructive" });
        return null;
      }
    } else if (parsedTransactions.length === 0) {
      toast({ title: "Nenhuma transação encontrada no arquivo", variant: "destructive" });
      return null;
    }
    if (isCredito && !dueConfirmed) {
      toast({ title: "Confirme o período da fatura", variant: "destructive" });
      return null;
    }
    if (!selectedConta) {
      toast({ title: "Selecione uma conta", variant: "destructive" });
      setNeedsManualSelect(true);
      return null;
    }
    return { contaId: selectedConta, currentUserId: user.id };
  };

  const cleanOrphanProjections = async (
    contaId: string,
    userId: string,
    _csvTransactions: ClassifiedTransaction[],
    targetMonth: string,
  ): Promise<number> => {
    // Clean all auto-projected transactions for target month and beyond

    // Delete ALL auto-projected transactions for this account where mes_competencia >= targetMonth.
    // This ensures a clean slate: the new import will re-project fresh parcelas for all future months.
    // Without this, old projections with slightly different descriptions (e.g., garbled fonts from
    // earlier faturas) would remain and create duplicates when the new import projects with clean text.
    const { data: projections } = await supabase
      .from("transacoes")
      .select("id, mes_competencia")
      .eq("user_id", userId)
      .eq("conta_id", contaId)
      .gte("mes_competencia", targetMonth)
      .ilike("descricao", "%(auto-projetada)%");

    if (!projections || projections.length === 0) return 0;

    const ids = projections.map((p) => p.id);
    // Delete in chunks
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await supabase.from("transacoes").delete().in("id", chunk);
      if (error) {
        console.error("Erro ao deletar projeções:", error);
        return 0;
      }
    }
    // Projections cleaned successfully
    return ids.length;
  };

  const checkOngoingDuplicates = async (
    userId: string,
    contaId: string,
    ongoingTxs: ClassifiedTransaction[],
  ): Promise<{ unique: ClassifiedTransaction[]; duplicates: ClassifiedTransaction[] }> => {
    if (ongoingTxs.length === 0) return { unique: [], duplicates: [] };

    // Fetch existing transactions for this account for deduplication
    let existingTxs: any[] = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      const { data } = await supabase
        .from("transacoes")
        .select("descricao_normalizada, valor, parcela_atual, parcela_total, mes_competencia, descricao")
        .eq("user_id", userId)
        .eq("conta_id", contaId)
        .range(from, from + batchSize - 1);
      if (!data || data.length === 0) break;
      existingTxs = existingTxs.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    const unique: ClassifiedTransaction[] = [];
    const duplicates: ClassifiedTransaction[] = [];

    for (const tx of ongoingTxs) {
      const txCompetencia = (tx as any)._mes_competencia || null;
      const matchingExisting = existingTxs.find(
        (e) =>
          e.descricao_normalizada === tx.descricao_normalizada &&
          Math.abs(Number(e.valor) - tx.valor) < 0.01 &&
          e.parcela_atual === tx.parcela_atual &&
          e.parcela_total === tx.parcela_total &&
          (e.mes_competencia === txCompetencia || (!e.mes_competencia && !txCompetencia)),
      );
      if (matchingExisting) {
        // If the match is an auto-projected transaction, let it through as unique
        // so detectConflicts can handle the replacement (CSV real replaces projected)
        if (matchingExisting.descricao?.includes("(auto-projetada)")) {
          unique.push(tx);
        } else {
          duplicates.push(tx);
        }
      } else {
        unique.push(tx);
      }
    }

    return { unique, duplicates };
  };

  const buildImportPlan = async (
    contaId: string,
    currentUserId: string,
    resolvedConflicts?: ConflictMatch[],
  ): Promise<PreparedImportPlan> => {
    const { data: rules } = await supabase.from("regras_categorizacao").select("*").eq("user_id", currentUserId);
    setProgress(20);

    const finalTransactions = applyDueDate(parsedTransactions);

    // Classify transactions
    const simpleRaw = finalTransactions.filter((t) => t.classification === "simple");
    const newInstallmentRaw = finalTransactions.filter((t) => t.classification === "new_installment");
    const ongoingRaw = finalTransactions.filter((t) => t.classification === "ongoing_installment");
    const refundRaw = finalTransactions.filter((t) => t.classification === "refund");
    const paymentRaw = finalTransactions.filter((t) => t.classification === "payment");

    // Check ongoing installments for duplicates
    const { unique: ongoingUnique, duplicates: ongoingDuplicates } = await checkOngoingDuplicates(
      currentUserId,
      contaId,
      ongoingRaw,
    );

    setProgress(35);

    // Build PlannedTransactions for importable items (simple + refunds + new_installment first parcela + ongoing unique).
    // Em conta de DÉBITO (não cartão), os itens classificados como "payment" (ex: "PAGTO FATURA MASTER"
    // no extrato da conta corrente) são SAÍDAS reais de caixa e precisam virar despesa normal — senão o
    // saldo da conta fica errado. Em CARTÃO, esses pagamentos são tratados à parte (bloco abaixo, como
    // receita ignorada que abate a fatura), então ficam de fora daqui.
    const importableTransactions = [
      ...simpleRaw,
      ...refundRaw,
      ...newInstallmentRaw,
      ...ongoingUnique,
      ...(isCredito ? [] : paymentRaw),
    ];
    const allOriginals: PlannedTransaction[] = [];

    for (const t of importableTransactions) {
      let categoria = "Outros";
      let essencial = false;
      
      // 1. Check user-defined rules first
      const matchedRule = rules?.find((r) => t.descricao.toLowerCase().includes(r.padrao.toLowerCase()));
      if (matchedRule) {
        categoria = matchedRule.categoria;
        essencial = matchedRule.essencial;
      } else {
        // 2. Fall back to dictionary-based auto-categorization
        const autoCategoria = autoCategorizarTransacao(t.descricao);
        if (autoCategoria) {
          categoria = autoCategoria;
        }
      }

      const grupo_parcela = t.parcela_atual ? crypto.randomUUID() : null;

      allOriginals.push({
        user_id: currentUserId,
        conta_id: contaId,
        data: t.data,
        data_original: (t as any)._data_original ?? t.data,
        mes_competencia: isCredito ? ((t as any)._mes_competencia || null) : null,
        descricao: t.descricao,
        descricao_normalizada: t.descricao_normalizada,
        valor: t.valor,
        categoria,
        tipo: t.tipo,
        essencial,
        parcela_atual: t.parcela_atual,
        parcela_total: t.parcela_total,
        grupo_parcela,
        hash_transacao: t.hash_transacao,
        pessoa: t.pessoa,
        codigo_cartao: t.codigo_cartao,
        valor_dolar: t.valor_dolar,
        // "Saldo anterior da fatura" é artefato de rollover (não é gasto novo):
        // marca ignorar_dashboard pra não inflar despesa do mês em Dashboard/
        // Análises/Planejamento. A fatura acumulada já o ignora explicitamente.
        // SEMPRE booleano (nunca undefined): a coluna é NOT NULL no banco.
        ignorar_dashboard: isSaldoAnteriorFatura(t.descricao),
        _isOriginal: true,
      });
    }

    setProgress(40);

    // Project future installments (only from new_installment transactions, parcela 01/X)
    const projectedInstallments = projectFutureInstallments(allOriginals);

    setProgress(50);

    // Fetch existing for conflict detection
    let existingTxs: any[] = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      const { data } = await supabase
        .from("transacoes")
        .select(
          "id, descricao, valor, data, data_original, mes_competencia, parcela_atual, parcela_total, pessoa, hash_transacao",
        )
        .eq("user_id", currentUserId)
        .eq("conta_id", contaId)
        .range(from, from + batchSize - 1);
      if (!data || data.length === 0) break;
      existingTxs = existingTxs.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    setProgress(60);

    const allPlanned = [...allOriginals, ...projectedInstallments] as (ProjectableTransaction | ProjectedInstallment)[];
    const { clean, exactMatches, autoReplacements, conflicts } = detectConflicts(allPlanned, existingTxs);

    if (conflicts.length > 0 && !resolvedConflicts) {
      throw { type: "CONFLICTS", conflicts, contaId, userId: currentUserId };
    }

    const idsToDelete: string[] = [];
    const resolvedClean: (ProjectableTransaction | ProjectedInstallment)[] = [...clean];

    for (const ar of autoReplacements) {
      idsToDelete.push(ar.existingId);
      resolvedClean.push(ar.planned);
    }

    for (const em of exactMatches) {
      const existingTx = existingTxs.find((e) => e.id === em.existingId);
      if (existingTx?.descricao?.includes("(auto-projetada)") && !("_isProjected" in em.planned)) {
        idsToDelete.push(em.existingId);
        resolvedClean.push(em.planned);
      }
    }

    if (resolvedConflicts) {
      for (const rc of resolvedConflicts) {
        if (rc.choice === "csv") {
          idsToDelete.push(rc.existingTransaction.id);
          resolvedClean.push(rc.csvTransaction);
        }
      }
    }

    setProgress(75);

    const newTransactions: PlannedTransaction[] = resolvedClean.map((t: any) => ({
      ...t,
      descricao_normalizada: t.descricao_normalizada || normalizeDescription(t.descricao),
      codigo_cartao: t.codigo_cartao || null,
      valor_dolar: t.valor_dolar || null,
      // SEMPRE booleano: a coluna ignorar_dashboard é NOT NULL. Projeções e demais
      // linhas que não definem o campo precisam de um default explícito — senão o
      // upsert em lote envia null e viola a constraint.
      ignorar_dashboard: t.ignorar_dashboard ?? false,
      _isOriginal: !("_isProjected" in t),
    }));

    // Importa PAGAMENTOS reais da fatura (ex: "Pagamento da fatura de X") como
    // receita ignorada no dashboard, pra o saldo acumulado/rollover refletir o que
    // foi pago. "Crédito por parcelamento" fica de fora (é abatimento do
    // financiamento, não caixa). Guard anti-duplicata: pula se já existe um
    // pagamento (manual via "Pagar fatura" ou import anterior) no mesmo cartão +
    // período + valor próximo.
    for (const pay of (isCredito ? paymentRaw : [])) {
      if (!isFaturaPayment(pay.descricao) || isCreditoParcelamento(pay.descricao)) continue;
      const compet = (pay as any)._mes_competencia || null;
      const jaTem = existingTxs.some((e) =>
        isFaturaPayment(e.descricao) &&
        (e.mes_competencia || null) === compet &&
        Math.abs(Number(e.valor) - pay.valor) <= 0.5,
      );
      const naBatelada = newTransactions.some((t) => t.hash_transacao === pay.hash_transacao);
      if (jaTem || naBatelada) continue;
      newTransactions.push({
        user_id: currentUserId,
        conta_id: contaId,
        data: pay.data,
        data_original: (pay as any)._data_original ?? pay.data,
        mes_competencia: compet,
        descricao: pay.descricao,
        descricao_normalizada: pay.descricao_normalizada || normalizeDescription(pay.descricao),
        valor: pay.valor,
        categoria: "Pagamento Fatura",
        tipo: "receita",
        essencial: true,
        parcela_atual: null,
        parcela_total: null,
        grupo_parcela: null,
        hash_transacao: pay.hash_transacao,
        pessoa: pay.pessoa,
        codigo_cartao: null,
        valor_dolar: null,
        ignorar_dashboard: true,
        _isOriginal: true,
      });
    }

    const duplicateItems: DuplicateInfo[] = exactMatches
      .filter((em) => {
        const existingTx = existingTxs.find((e) => e.id === em.existingId);
        return !existingTx?.descricao?.includes("(auto-projetada)") || "_isProjected" in em.planned;
      })
      .map((em) => ({
        data: em.planned.data,
        descricao: em.planned.descricao,
        valor: em.planned.valor,
        tipo: (em.planned as any).tipo || 'despesa',
        pessoa: em.planned.pessoa,
        hash_transacao: em.planned.hash_transacao,
      }));

    const importedOriginals: ImportedItem[] = newTransactions
      .filter((t) => t._isOriginal)
      .map((t) => ({
        data: t.data,
        descricao: t.descricao,
        valor: t.valor,
        tipo: t.tipo,
        parcela_atual: t.parcela_atual,
        parcela_total: t.parcela_total,
        pessoa: t.pessoa,
      }));

    const importedFutures: ImportedItem[] = newTransactions
      .filter((t) => !t._isOriginal)
      .map((t) => ({
        data: t.data,
        descricao: t.descricao,
        valor: t.valor,
        tipo: t.tipo,
        parcela_atual: t.parcela_atual,
        parcela_total: t.parcela_total,
        pessoa: t.pessoa,
        isFuture: true,
      }));

    const totalDespesas = newTransactions
      .filter((t) => t.tipo === "despesa")
      .reduce((sum, t) => sum + Number(t.valor), 0);

    const totalReceitas = newTransactions
      .filter((t) => t.tipo === "receita")
      .reduce((sum, t) => sum + Number(t.valor), 0);

    const logEntries = parsedLineLogs.map((entry) => {
      if (entry.status === "importada") {
        return { ...entry, status: "importada" as const, reason: "Importada com sucesso" };
      }
      return entry;
    });

    // Build new preview data
    const installmentGroups: InstallmentGroup[] = newInstallmentRaw.map((t) => ({
      descricao: t.descricao,
      valorParcela: t.valor,
      totalParcelas: t.parcela_total!,
      valorTotal: t.valor * t.parcela_total!,
      dataInicio: (t as any)._data_original || t.data,
      pessoa: t.pessoa,
      transactions: [t],
    }));

    const previewData: ImportPreviewData = {
      simpleTransactions: simpleRaw,
      refunds: refundRaw,
      newInstallments: installmentGroups,
      ongoingInstallments: ongoingUnique,
      duplicateInstallments: ongoingDuplicates,
      payments: paymentRaw,
      rejectedLines: parsedSkippedLines.map((s) => ({
        lineNumber: s.lineNumber,
        content: s.content,
        reason: s.reason,
      })),
      totalLines: parsedTotalLines,
      fileName: file?.name || "arquivo.csv",
    };

    const contaNome = contas.find((c) => c.id === contaId)?.nome || "";

    return {
      contaNome,
      allTransactionsCount: allOriginals.length + projectedInstallments.length,
      newTransactions,
      duplicateTransactions: [],
      duplicateItems,
      importedOriginals,
      importedFutures,
      totalDespesas,
      totalReceitas,
      logEntries,
      autoProjectedIdsToDelete: idsToDelete,
      replacedTransactions: [],
      previewData,
    };
  };

  const handleOpenPreview = async () => {
    const context = validateBeforeImport();
    if (!context) return;

    // All file types now use preview

    setImporting(true);
    setProgress(5);

    try {
      // NOTE: cleanOrphanProjections moved to handleImport so that projections are not
      // deleted prematurely if buildImportPlan throws a CONFLICTS error during preview.
      const plan = await buildImportPlan(context.contaId, context.currentUserId);
      setPreparedPlan(plan);
      setProgress(100);
    } catch (err: any) {
      if (err?.type === "CONFLICTS") {
        setPendingConflicts(err.conflicts);
        setConflictContext({ contaId: err.contaId, userId: err.userId });
      } else {
        console.error(err);
        toast({ title: "Erro ao analisar o arquivo", variant: "destructive" });
      }
    } finally {
      setImporting(false);
    }
  };

  const handleConflictResolved = async (resolved: ConflictMatch[]) => {
    if (!conflictContext) return;
    setPendingConflicts(null);
    setImporting(true);
    setProgress(10);

    try {
      const plan = await buildImportPlan(conflictContext.contaId, conflictContext.userId, resolved);
      setPreparedPlan(plan);
      setProgress(100);
    } catch (err) {
      console.error(err);
      toast({ title: "Erro ao processar conflitos", variant: "destructive" });
    } finally {
      setImporting(false);
      setConflictContext(null);
    }
  };

  const handleCheckDateCorrection = async () => {
    if (!user || !selectedConta || !isCredito || !dueConfirmed) return;
    setImporting(true);
    setProgress(10);

    try {
      const billingPeriod = `${dueYear}-${String(dueMonth + 1).padStart(2, "0")}`;

      const { data: existing } = await supabase
        .from("transacoes")
        .select("id, descricao, descricao_normalizada, valor, data, parcela_atual, parcela_total, mes_competencia")
        .eq("user_id", user.id)
        .eq("conta_id", selectedConta)
        .or(`mes_competencia.eq.${billingPeriod},data.gte.${billingPeriod}-01`);

      setProgress(50);

      if (!existing || existing.length === 0) {
        toast({ title: "Nenhuma transação encontrada para este período", variant: "destructive" });
        setImporting(false);
        return;
      }

      const corrections: DateCorrectionItem[] = [];
      for (const csvTx of parsedTransactions) {
        const csvNorm = csvTx.descricao_normalizada;
        const match = existing.find((e) => {
          if (e.descricao_normalizada !== csvNorm) return false;
          if (Math.abs(Number(e.valor) - csvTx.valor) > 0.01) return false;
          if (e.parcela_atual !== csvTx.parcela_atual) return false;
          if (e.parcela_total !== csvTx.parcela_total) return false;
          return true;
        });

        if (match && match.data !== csvTx.data) {
          corrections.push({
            transactionId: match.id,
            descricao: csvTx.descricao,
            valor: csvTx.valor,
            currentDate: match.data,
            correctDate: csvTx.data,
            parcela: csvTx.parcela_atual ? `${csvTx.parcela_atual}/${csvTx.parcela_total}` : null,
            billingPeriod,
          });
        }
      }

      setProgress(100);

      if (corrections.length === 0) {
        toast({ title: "Todas as datas já estão corretas", description: "Nenhuma correção necessária." });
      } else {
        setDateCorrectionItems(corrections);
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Erro ao verificar datas", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleApplyDateCorrection = async () => {
    if (!dateCorrectionItems || dateCorrectionItems.length === 0) return;
    setImporting(true);
    setProgress(10);

    try {
      let updated = 0;
      const billingPeriod = dateCorrectionItems[0].billingPeriod;

      for (let i = 0; i < dateCorrectionItems.length; i++) {
        const item = dateCorrectionItems[i];
        const { error } = await supabase
          .from("transacoes")
          .update({
            data: item.correctDate,
            data_original: item.correctDate,
            mes_competencia: billingPeriod,
          })
          .eq("id", item.transactionId);

        if (!error) updated++;
        setProgress(10 + (90 * (i + 1)) / dateCorrectionItems.length);
      }

      toast({
        title: `${updated} datas corrigidas`,
        description: `${dateCorrectionItems.length} transações processadas, ${updated} atualizadas.`,
      });
      setDateCorrectionItems(null);
      setDateCorrectMode(false);
      queryClient.invalidateQueries({ queryKey: ["transacoes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err) {
      console.error(err);
      toast({ title: "Erro ao corrigir datas", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    const context = validateBeforeImport();
    if (!context) return;

    setImporting(true);
    setProgress(5);

    try {
      // Step 0: Ensure required categories exist
      const { data: existingCats } = await supabase
        .from('categorias')
        .select('nome')
        .eq('user_id', context.currentUserId);
      const existingNames = new Set((existingCats || []).map((c: any) => c.nome));
      const { REQUIRED_CATEGORIES: reqCats, CATEGORY_COLORS: catColors } = await import('@/lib/auto-categorize');
      const missingCats = reqCats.filter((name: string) => !existingNames.has(name));
      if (missingCats.length > 0) {
        await supabase.from('categorias').insert(
          missingCats.map((nome: string) => ({
            user_id: context.currentUserId,
            nome,
            cor: catColors[nome] || '#9ca3af',
            parent_id: null,
          }))
        );
      }
      setProgress(10);
      const plan = preparedPlan ?? (await buildImportPlan(context.contaId, context.currentUserId));

      // Clean orphan projections AFTER buildImportPlan succeeds (no CONFLICTS thrown),
      // so projections are preserved if the user needs to resolve conflicts first.
      {
        const csvDates = parsedTransactions.map((t) => new Date(t.data + "T00:00:00").getTime());
        const newestDate = new Date(Math.max(...csvDates));
        const targetMonth =
          isCredito && dueConfirmed
            ? `${dueYear}-${String(dueMonth + 1).padStart(2, "0")}`
            : `${newestDate.getFullYear()}-${String(newestDate.getMonth() + 1).padStart(2, "0")}`;
        await cleanOrphanProjections(context.contaId, context.currentUserId, parsedTransactions, targetMonth);
      }

      // Step 0: Reconcile opening balance from the statement. Sets the account's
      // saldo_inicial = saldo anterior detectado no OFX, mas SÓ na primeira
      // importação de uma conta de débito cujo saldo inicial nunca foi definido —
      // evita sobrescrever valor manual e a dupla contagem de "Saldo de Abertura".
      let openingApplied: { balance: number; date: string } | null = null;
      if (fileType === "ofx" && parsedOpening) {
        const { data: contaRow } = await supabase
          .from("contas")
          .select("saldo_inicial, tipo")
          .eq("id", context.contaId)
          .single();
        if (contaRow && contaRow.tipo !== "credito" && !contaRow.saldo_inicial) {
          const { count } = await supabase
            .from("transacoes")
            .select("id", { count: "exact", head: true })
            .eq("conta_id", context.contaId)
            .eq("user_id", context.currentUserId);
          if (!count) {
            const { error: updErr } = await supabase
              .from("contas")
              .update({ saldo_inicial: parsedOpening.balance, data_abertura: parsedOpening.date })
              .eq("id", context.contaId);
            if (!updErr) openingApplied = parsedOpening;
          }
        }
      }

      // Step 0b: guarda o dia de vencimento detectado na fatura do cartão.
      if (isCredito && parsedDueDay && parsedDueDay >= 1 && parsedDueDay <= 31) {
        await supabase.from("contas").update({ dia_vencimento: parsedDueDay }).eq("id", context.contaId);
        queryClient.invalidateQueries({ queryKey: ["contas"] });
      }

      // Step 1: Delete auto-projected duplicates
      let deletedCount = 0;
      if (plan.autoProjectedIdsToDelete.length > 0) {
        for (let i = 0; i < plan.autoProjectedIdsToDelete.length; i += 100) {
          const chunk = plan.autoProjectedIdsToDelete.slice(i, i + 100);
          const { error } = await supabase.from("transacoes").delete().in("id", chunk);
          if (error) {
            console.error("[Import] Erro ao deletar:", error);
          } else {
            deletedCount += chunk.length;
          }
        }
      }

      // Step 2: Insert new transactions
      // Validação PRÉ-INSERT: confere campos obrigatórios/tipos ANTES de enviar
      // ao banco, transformando erro críptico de constraint (ex: NOT NULL) numa
      // mensagem clara e acionável, e evitando insert parcial. Robustez do import.
      const problemas: string[] = [];
      for (const t of plan.newTransactions as any[]) {
        const v = Number(t.valor);
        if (!Number.isFinite(v)) problemas.push(`valor inválido (${t.descricao ?? '??'})`);
        if (!t.data || !/^\d{4}-\d{2}-\d{2}$/.test(t.data)) problemas.push(`data inválida (${t.descricao ?? '??'})`);
        if (t.tipo !== 'receita' && t.tipo !== 'despesa') problemas.push(`tipo inválido "${t.tipo}" (${t.descricao ?? '??'})`);
        if (typeof t.ignorar_dashboard !== 'boolean') problemas.push(`ignorar_dashboard não-booleano (${t.descricao ?? '??'})`);
        if (!t.descricao || !String(t.descricao).trim()) problemas.push(`descrição vazia`);
        if (!t.hash_transacao) problemas.push(`hash ausente (${t.descricao ?? '??'})`);
      }
      if (problemas.length > 0) {
        const amostra = problemas.slice(0, 5).join('; ');
        throw new Error(
          `${problemas.length} transação(ões) com dados inválidos antes de salvar: ${amostra}${problemas.length > 5 ? '…' : ''}. Nada foi importado.`,
        );
      }

      let imported = 0;
      const batchSize = 50;

      for (let i = 0; i < plan.newTransactions.length; i += batchSize) {
        const batch = plan.newTransactions
          .slice(i, i + batchSize)
          .map(({ _isOriginal, _isProjected, ...rest }: any) => rest);
        const { error, data } = await supabase
          .from("transacoes")
          .upsert(batch, { onConflict: "user_id,hash_transacao" })
          .select("id");

        if (error) throw error;
        imported += data?.length || 0;
        setProgress(80 + (20 * (i + batch.length)) / Math.max(plan.newTransactions.length, 1));
      }

      setResult({
        imported,
        duplicates: plan.duplicateItems.length,
        deletedAutoProjected: deletedCount,
        contaNome: plan.contaNome,
        duplicateItems: plan.duplicateItems,
        originalItems: plan.importedOriginals,
        futureItems: plan.importedFutures,
        totalDespesas: plan.totalDespesas,
        totalReceitas: plan.totalReceitas,
        skippedLines: parsedSkippedLines,
        totalCsvLines: parsedTotalLines,
        logEntries: plan.logEntries,
      });

      // Registros de auditoria (histórico + logs). NÃO são críticos: as transações
      // já foram inseridas acima. Se qualquer um falhar (coluna ausente, RLS, etc.),
      // apenas logamos — jamais deixar um erro de bookkeeping reportar o import inteiro
      // como "Erro ao importar" e confundir o usuário com dados que já entraram.
      try {
        await supabase.from("historico_importacoes").insert({
          user_id: context.currentUserId,
          nome_arquivo: file!.name,
          tipo_arquivo: fileType || "csv",
          conta_nome: plan.contaNome,
          conta_id: context.contaId,
          qtd_importada: imported,
          qtd_duplicadas: plan.duplicateItems.length,
          qtd_total: plan.allTransactionsCount,
        });
      } catch (logErr) {
        console.error("[Import] Falha ao gravar histórico_importacoes (não-crítico):", logErr);
      }

      try {
        await supabase.from("import_logs").insert([
          {
            user_id: context.currentUserId,
            arquivo: file!.name,
            total_linhas_csv: parsedTotalLines,
            linhas_importadas: plan.importedOriginals.length,
            linhas_rejeitadas: parsedLineLogs.filter((entry) => entry.status !== "importada").length,
            detalhes_json: plan.logEntries as any,
          },
        ]);
      } catch (logErr) {
        console.error("[Import] Falha ao gravar import_logs (não-crítico):", logErr);
      }

      if (openingApplied) {
        const [y, m, d] = openingApplied.date.split("-");
        toast({
          title: "Saldo anterior detectado no extrato",
          description: `R$ ${openingApplied.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} em ${d}/${m}/${y} foi definido como saldo inicial da conta, pra reconciliar o saldo sem divergência.`,
        });
      }

      setPreparedPlan(null);
      queryClient.invalidateQueries({ queryKey: ["transacoes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["historico_importacoes"] });
      queryClient.invalidateQueries({ queryKey: ["contas"] });
      queryClient.invalidateQueries({ queryKey: ["saldos"] });
    } catch (err) {
      console.error(err);
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as any).message)
            : String(err);
      toast({
        title: "Erro ao importar",
        description: msg || "Erro desconhecido. Veja o console para detalhes.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      setProgress(100);
    }
  };

  const handleForceImport = async (items: DuplicateInfo[]) => {
    if (!user || !selectedConta) return;
    setForceImporting(true);

    try {
      const { data: rules } = await supabase.from("regras_categorizacao").select("*").eq("user_id", user.id);

      const txs = items.map((item) => {
        let categoria = "Outros";
        let essencial = false;
        const matchedRule = rules?.find((r) => item.descricao.toLowerCase().includes(r.padrao.toLowerCase()));
        if (matchedRule) {
          categoria = matchedRule.categoria;
          essencial = matchedRule.essencial;
        }

        return {
          user_id: user.id,
          conta_id: selectedConta,
          data: item.data,
          descricao: item.descricao,
          descricao_normalizada: normalizeDescription(item.descricao),
          valor: item.valor,
          categoria,
          // valor is stored as absolute value in DB — rely on the tipo preserved from the original parse
          tipo: item.tipo,
          essencial,
          parcela_atual: null,
          parcela_total: null,
          grupo_parcela: null,
          hash_transacao: item.hash_transacao + "_force_" + Date.now(),
          pessoa: item.pessoa,
        };
      });

      const { data, error } = await supabase.from("transacoes").insert(txs).select("id");
      if (error) throw error;

      const forceImported = data?.length || 0;
      toast({ title: `${forceImported} duplicatas importadas com sucesso` });

      if (result) {
        setResult({
          ...result,
          imported: result.imported + forceImported,
          duplicates: 0,
          duplicateItems: [],
        });
      }

      queryClient.invalidateQueries({ queryKey: ["transacoes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err) {
      console.error(err);
      toast({ title: "Erro ao importar duplicatas", variant: "destructive" });
    }

    setForceImporting(false);
  };

  const handleClose = () => {
    setFile(null);
    setFileType(null);
    setResult(null);
    setProgress(0);
    setNeedsManualSelect(false);
    setSelectedConta("");
    setDetectedConta(null);
    setDetectedAccountType(null);
    setParsedTransactions([]);
    setParsedSkippedLines([]);
    setParsedTotalLines(0);
    setParsedLineLogs([]);
    setParsedOpening(null);
    setParsedDueDay(null);
    setLoanDoc(null);
    setLoanContaId("");
    setLoanImporting(false);
    setForceImporting(false);
    setPreparedPlan(null);
    setPendingConflicts(null);
    setConflictContext(null);
    setDueConfirmed(false);
    setDateCorrectionItems(null);
    setDateCorrectMode(false);
    onOpenChange(false);
  };

  const yearOptions = useMemo(() => {
    const now = new Date();
    return [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  }, []);

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Importar Extrato</DialogTitle>
            <DialogDescription>Faça upload do arquivo CSV, OFX ou PDF do seu banco</DialogDescription>
          </DialogHeader>

          {!result ? (
            dateCorrectionItems ? (
              <DateCorrectionPreview
                items={dateCorrectionItems}
                confirming={importing}
                onBack={() => { setDateCorrectionItems(null); setDateCorrectMode(false); }}
                onConfirm={handleApplyDateCorrection}
              />
            ) : preparedPlan ? (
              <CsvImportPreviewV2
                data={preparedPlan.previewData}
                confirming={importing}
                onBack={() => setPreparedPlan(null)}
                onConfirm={handleImport}
              />
            ) : (
              <div className="space-y-4">
                {loanDoc ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted">
                      <Landmark className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium block">Empréstimo detectado — {loanDoc.instituicao}</span>
                        <span className="text-xs text-muted-foreground">Contrato {loanDoc.contratoKey}</span>
                      </div>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Parcela (fixa)</span><span className="font-medium">{loanDoc.parcelaFixa.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Parcelas futuras a lançar</span><span className="font-medium">{loanDoc.futuras.length} de {loanDoc.totalParcelas}</span></div>
                      {loanDoc.saldoDevedor != null && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Saldo devedor</span><span className="font-medium">{loanDoc.saldoDevedor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span></div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Conta de débito que paga este empréstimo</Label>
                      <Select value={loanContaId} onValueChange={setLoanContaId}>
                        <SelectTrigger><SelectValue placeholder="Selecione a conta de débito" /></SelectTrigger>
                        <SelectContent>
                          {contas.filter((c) => c.tipo === "debito").map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      As {loanDoc.futuras.length} parcelas futuras entram como "Empréstimos" na conta escolhida e aparecem em Dívidas e Projeções. Reimportar atualiza sem duplicar.
                    </p>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={handleClose}>Cancelar</Button>
                      <Button onClick={handleLoanImport} disabled={!loanContaId || loanImporting}>
                        {loanImporting ? "Lançando..." : `Lançar ${loanDoc.futuras.length} parcelas`}
                      </Button>
                    </div>
                  </div>
                ) : !file ? (
                  <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer hover:border-foreground/30 transition-colors">
                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                    <span className="text-sm text-muted-foreground">Clique para selecionar um arquivo</span>
                    <span className="text-xs text-muted-foreground mt-1">.csv, .ofx ou .pdf — Máximo 10MB</span>
                    <input type="file" accept=".csv,.ofx,.pdf" className="hidden" onChange={handleFileSelect} />
                  </label>
                ) : (
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block">{file.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {fileType === "ofx" ? "OFX" : fileType === "pdf" ? "PDF" : "CSV"} —{" "}
                          {fileType === "csv" || fileType === "pdf"
                            ? `${parsedTotalLines} linhas lidas / ${parsedTransactions.length} transações válidas`
                            : `${parsedTransactions.length} transações encontradas`}
                        </span>
                      </div>
                    </div>

                    {detectedConta && (
                      <p className="text-sm text-primary">
                        <Check className="inline h-4 w-4 mr-1" />
                        Conta detectada: <strong>{detectedConta}</strong>
                        {isCredito && (
                          <span className="ml-2 text-muted-foreground">
                            <CreditCard className="inline h-3 w-3 mr-1" />
                            Cartão de crédito
                          </span>
                        )}
                      </p>
                    )}

                    {needsManualSelect && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <AlertCircle className="h-4 w-4" />
                          {detectedConta ? "Conta não encontrada. Crie a detectada ou selecione uma existente:" : "Selecione a conta:"}
                        </p>
                        {detectedConta && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full gap-1.5 justify-start"
                            onClick={createDetectedAccount}
                            disabled={creatingConta}
                          >
                            {detectedAccountType === "credito" ? <CreditCard className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                            {creatingConta
                              ? "Criando..."
                              : `Criar ${detectedAccountType === "credito" ? "cartão" : "conta"} "${detectedConta}"`}
                          </Button>
                        )}
                        <Select value={selectedConta} onValueChange={setSelectedConta}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione uma conta existente" />
                          </SelectTrigger>
                          <SelectContent>
                            {contas.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {isCredito && (
                      <div className="space-y-3 p-3 rounded-lg border border-accent/30 bg-accent/5">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-accent" />
                          <Label className="text-sm font-medium">Período da fatura</Label>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Informe a qual fatura estas transações pertencem. As datas originais de cada compra serão preservadas.
                        </p>
                        <div className="flex gap-2">
                          <Select
                            value={String(dueMonth)}
                            onValueChange={(v) => {
                              setDueMonth(Number(v));
                              setDueConfirmed(false);
                              setPreparedPlan(null);
                            }}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MONTH_NAMES.map((name, i) => (
                                <SelectItem key={i} value={String(i)}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={String(dueYear)}
                            onValueChange={(v) => {
                              setDueYear(Number(v));
                              setDueConfirmed(false);
                              setPreparedPlan(null);
                            }}
                          >
                            <SelectTrigger className="w-24">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {yearOptions.map((y) => (
                                <SelectItem key={y} value={String(y)}>
                                  {y}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {dueWarning && (
                          <p className="text-xs flex items-center gap-1 text-destructive">
                            <AlertCircle className="h-3 w-3" />
                            {dueWarning}
                          </p>
                        )}

                        <Button
                          variant={dueConfirmed ? "secondary" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => setDueConfirmed(true)}
                        >
                          {dueConfirmed ? (
                            <>
                              <Check className="h-4 w-4 mr-1" /> Fatura: {MONTH_NAMES[dueMonth]} {dueYear}
                            </>
                          ) : (
                            "Confirmar período da fatura"
                          )}
                        </Button>
                      </div>
                    )}

                    {importing && <Progress value={progress} />}

                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={handleOpenPreview}
                        disabled={importing || (isCredito && !dueConfirmed)}
                        className="w-full"
                      >
                        {importing
                          ? "Analisando transações..."
                          : `Revisar ${parsedTransactions.length} transações antes de importar`}
                      </Button>

                      {isCredito && dueConfirmed && (
                        <Button
                          variant="outline"
                          onClick={handleCheckDateCorrection}
                          disabled={importing}
                          className="w-full"
                        >
                          <CalendarDays className="mr-2 h-4 w-4" />
                          Corrigir datas de importação anterior
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          ) : (
            <ImportReport
              result={result}
              onClose={handleClose}
              onForceImport={handleForceImport}
              forceImporting={forceImporting}
            />
          )}
        </DialogContent>
      </Dialog>

      {pendingConflicts && pendingConflicts.length > 0 && (
        <ConflictModal
          open={true}
          conflicts={pendingConflicts}
          onConfirm={handleConflictResolved}
          onCancel={() => {
            setPendingConflicts(null);
            setConflictContext(null);
          }}
        />
      )}
    </>
  );
}
