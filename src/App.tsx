import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/Login";
import DesignPreviewPage from "@/pages/_DesignPreview";
import OnboardingPage from "@/pages/Onboarding";
import DashboardPage from "@/pages/Dashboard";
import { Skeleton } from "@/components/ui/skeleton";

// Páginas pesadas (recharts, react-markdown, queries grandes) entram lazy.
// Reduz o bundle inicial — usuário só baixa Calculadora se abrir Calculadora.
// Dashboard e Transações ficam síncronas pra LCP imediato (primeira tela
// pós-login).
const TransacoesPage = lazy(() => import("@/pages/Transacoes"));
const CalculadoraPage = lazy(() => import("@/pages/Calculadora"));
const ContasPage = lazy(() => import("@/pages/Contas"));
const ConfiguracoesPage = lazy(() => import("@/pages/Configuracoes"));
const CategoriasPage = lazy(() => import("@/pages/Categorias"));
const ProjecoesPage = lazy(() => import("@/pages/Projecoes"));
const PlanejamentoPage = lazy(() => import("@/pages/Planejamento"));
const AnalisesPage = lazy(() => import("@/pages/Analises"));
const DividasPage = lazy(() => import("@/pages/Dividas"));
const ContasPagarReceberPage = lazy(() => import("@/pages/ContasPagarReceber"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

// Fallback usado durante o lazy load — bem mais leve que tela em branco.
const RouteFallback = () => (
  <div className="space-y-4 p-4">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-32 w-full" />
    <Skeleton className="h-64 w-full" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/_design" element={<DesignPreviewPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/transacoes" element={<Suspense fallback={<RouteFallback />}><TransacoesPage /></Suspense>} />
              <Route path="/calculadora" element={<Suspense fallback={<RouteFallback />}><CalculadoraPage /></Suspense>} />
              <Route path="/contas" element={<Suspense fallback={<RouteFallback />}><ContasPage /></Suspense>} />
              <Route path="/configuracoes" element={<Suspense fallback={<RouteFallback />}><ConfiguracoesPage /></Suspense>} />
              <Route path="/categorias" element={<Suspense fallback={<RouteFallback />}><CategoriasPage /></Suspense>} />
              <Route path="/projecoes" element={<Suspense fallback={<RouteFallback />}><ProjecoesPage /></Suspense>} />
              <Route path="/planejamento" element={<Suspense fallback={<RouteFallback />}><PlanejamentoPage /></Suspense>} />
              <Route path="/analises" element={<Suspense fallback={<RouteFallback />}><AnalisesPage /></Suspense>} />
              <Route path="/dividas" element={<Suspense fallback={<RouteFallback />}><DividasPage /></Suspense>} />
              <Route path="/a-pagar-receber" element={<Suspense fallback={<RouteFallback />}><ContasPagarReceberPage /></Suspense>} />
            </Route>
            <Route path="*" element={<Suspense fallback={<RouteFallback />}><NotFound /></Suspense>} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
