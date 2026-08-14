/**
 * Lista de e-mails autorizados a acessar o app.
 *
 * É um app pessoal — só o dono entra. A trava roda no AuthProvider (pega
 * login por e-mail E por Google): qualquer sessão cujo e-mail não esteja aqui
 * é deslogada na hora. O RLS do Supabase continua sendo a proteção real dos
 * dados; isto é a porta da frente.
 *
 * Pra convidar alguém, some o e-mail (minúsculo) aqui e faça deploy.
 */
export const EMAILS_AUTORIZADOS = [
  'djeissonamaus@gmail.com',
  'contato@djeissonmauss.com',
];

export function emailAutorizado(email: string | null | undefined): boolean {
  return !!email && EMAILS_AUTORIZADOS.includes(email.trim().toLowerCase());
}
