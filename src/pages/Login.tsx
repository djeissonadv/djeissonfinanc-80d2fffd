import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { DollarSign } from 'lucide-react';

// Whitelist: só esse email pode acessar. Filtro de UX — o RLS do Supabase
// continua sendo o guarda real dos dados (cada usuário só vê os próprios).
const EMAILS_AUTORIZADOS = ['djeissonamaus@gmail.com'];

function isAutorizado(email: string | null | undefined): boolean {
  return !!email && EMAILS_AUTORIZADOS.includes(email.trim().toLowerCase());
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Se voltar do Google já autenticado, checa a whitelist. Se não estiver,
  // faz signOut e mostra erro. Se estiver, entra.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const email = session?.user?.email;
      if (!session) return;
      if (!isAutorizado(email)) {
        await supabase.auth.signOut();
        toast({ title: 'Acesso não autorizado', description: 'Esse email não tem permissão pra acessar.', variant: 'destructive' });
        return;
      }
      navigate('/');
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, toast]);

  const handleGoogle = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) {
      toast({ title: 'Erro', description: error.message.slice(0, 200), variant: 'destructive' });
      setLoading(false);
    }
    // Sucesso: o navegador vai pro Google e depois volta. onAuthStateChange
    // acima cuida da checagem de whitelist quando a sessão chegar.
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
            <DollarSign className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">FinançasPro</CardTitle>
          <CardDescription>Gerencie suas finanças pessoais</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            variant="outline"
            className="w-full h-11 text-sm gap-2"
          >
            <GoogleIcon />
            {loading ? 'Redirecionando...' : 'Entrar com Google'}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Acesso restrito ao proprietário.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.3 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.5 2.9-2.2 5.4-4.7 7l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.2-8.3 2.2-6.3 0-11.6-3.8-13.5-9.1l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
