import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { DollarSign } from 'lucide-react';

/**
 * Login por e-mail/senha, com criar-conta embutido.
 *
 * O projeto Supabase é próprio e começa vazio (sem usuários), então a
 * primeira vez é "Criar conta". Com "Confirmar e-mail" desligado no painel,
 * a conta já entra na hora. Google OAuth fica pra depois (nice-to-have).
 */
export default function LoginPage() {
  const [modo, setModo] = useState<'entrar' | 'criar'>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const creds = { email: email.trim().toLowerCase(), password };

    if (modo === 'criar') {
      const { data, error } = await supabase.auth.signUp(creds);
      if (error) {
        toast({ title: 'Erro ao criar conta', description: error.message, variant: 'destructive' });
      } else if (data.session) {
        navigate('/'); // confirm-email desligado → já entra
      } else {
        toast({ title: 'Quase lá', description: 'Confira seu e-mail pra confirmar a conta e depois entre.' });
        setModo('entrar');
      }
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword(creds);
    if (error) {
      toast({ title: 'Não entrou', description: 'E-mail ou senha incorretos.', variant: 'destructive' });
    } else {
      navigate('/');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-primary">
            <DollarSign className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-xl">FinançasPro</CardTitle>
          <CardDescription>
            {modo === 'entrar' ? 'Entre na sua conta' : 'Crie sua conta'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs">E-mail</Label>
              <Input id="email" type="email" autoComplete="email" value={email}
                onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs">Senha</Label>
              <Input id="password" type="password"
                autoComplete={modo === 'criar' ? 'new-password' : 'current-password'}
                value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
            </div>
            <Button type="submit" className="w-full h-10" disabled={loading}>
              {loading
                ? (modo === 'criar' ? 'Criando...' : 'Entrando...')
                : (modo === 'criar' ? 'Criar conta' : 'Entrar')}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setModo(modo === 'entrar' ? 'criar' : 'entrar')}
            className="w-full mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {modo === 'entrar' ? 'Não tem conta? Criar agora' : '← Já tenho conta, entrar'}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
