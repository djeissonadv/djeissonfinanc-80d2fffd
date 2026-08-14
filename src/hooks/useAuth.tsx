import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Session, User } from '@supabase/supabase-js';
import { emailAutorizado } from '@/lib/auth-allowlist';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** true quando um login válido foi barrado por não estar na lista de convidados. */
  accessDenied: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  accessDenied: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    // Trava de convidados: vale pra login por e-mail E por Google (que só
    // chega aqui depois do redirect). E-mail fora da lista → desloga na hora.
    const aplicar = (session: Session | null) => {
      const email = session?.user?.email;
      if (email && !emailAutorizado(email)) {
        setAccessDenied(true);
        setSession(null);
        setLoading(false);
        supabase.auth.signOut();
        return;
      }
      if (session) setAccessDenied(false);
      setSession(session);
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      aplicar(session);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      aplicar(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, accessDenied, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
