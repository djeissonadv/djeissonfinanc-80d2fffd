import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { DollarSign } from 'lucide-react';

/**
 * Login só por Google. App pessoal: sem cadastro, sem senha. A primeira
 * entrada cria a conta sozinha (Supabase); quem pode entrar é decidido pela
 * lista de convidados, aplicada no AuthProvider (vale pós-redirect do Google).
 */
export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { accessDenied } = useAuth();

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
    // Sucesso: vai pro Google e volta. A trava de convidados roda no AuthProvider.
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-primary">
            <DollarSign className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-xl">FinançasPro</CardTitle>
          <CardDescription>Gerencie suas finanças pessoais</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {accessDenied && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Esse e-mail não tem acesso. Entre com uma conta convidada.
            </div>
          )}

          <Button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            variant="outline"
            className="w-full h-11 gap-2 text-sm"
          >
            <GoogleIcon />
            {loading ? 'Redirecionando...' : 'Entrar com Google'}
          </Button>

          <p className="text-2xs text-muted-foreground text-center pt-1">
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
