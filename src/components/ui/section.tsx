import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

/**
 * Primitivas de layout da aplicação.
 *
 * Existem pra matar a variação acidental: antes cada página montava seu
 * próprio cabeçalho e seus próprios blocos, então título de seção aparecia
 * como text-2xl numa tela e text-base noutra, com padding p-6 aqui e p-4 ali.
 * O olho lê isso como desorganização mesmo sem saber nomear o motivo.
 *
 * Regra: página usa <PageHeader> uma vez, e todo bloco de conteúdo é uma
 * <Section>. Números importantes usam <Stat>.
 */

// ---------------------------------------------------------------------------

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Controles à direita (seletor de mês, botão de ação). */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex items-start justify-between gap-3 flex-wrap', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight leading-tight">{title}</h1>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

// ---------------------------------------------------------------------------

interface SectionProps {
  title?: string;
  description?: string;
  /** Controle no canto direito do cabeçalho (filtro, "ver todos"). */
  action?: React.ReactNode;
  /** Ícone opcional à esquerda do título. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Remove o padding do corpo — pra listas/tabelas que sangram até a borda. */
  flush?: boolean;
  /** Card protagonista da tela. Use no máximo um por página. */
  emphasis?: boolean;
}

export function Section({
  title, description, action, icon, children, className, flush, emphasis,
}: SectionProps) {
  return (
    <Card variant={emphasis ? 'elevated' : 'default'} className={cn('overflow-hidden', className)}>
      {(title || action) && (
        <div className={cn(
          'flex items-start justify-between gap-3 p-4',
          !flush && 'pb-0',
        )}>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight flex items-center gap-1.5">
              {icon}
              {title}
            </h2>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn(!flush && 'p-4', title && !flush && 'pt-3')}>{children}</div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

type StatTone = 'default' | 'positive' | 'negative' | 'accent';

const TONE_CLASS: Record<StatTone, string> = {
  default: 'text-foreground',
  positive: 'text-success',
  negative: 'text-destructive',
  accent: 'text-primary',
};

interface StatProps {
  label: string;
  value: string;
  /** Linha de apoio abaixo do número (contexto, comparação). */
  hint?: string;
  tone?: StatTone;
  /** 'lg' pro número principal da tela; 'md' padrão; 'sm' em grades densas. */
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

const SIZE_CLASS = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
} as const;

/**
 * Número com rótulo. Única forma de exibir métrica no app — antes cada tela
 * escolhia um tamanho (text-3xl, 4xl, 5xl, 7xl), o que fazia telas diferentes
 * parecerem sistemas diferentes.
 */
export function Stat({
  label, value, hint, tone = 'default', size = 'md', icon, onClick, className,
}: StatProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'text-left min-w-0',
        onClick && 'hover:opacity-70 transition-opacity w-full',
        className,
      )}
    >
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon}
        <span className="truncate">{label}</span>
      </p>
      <p className={cn('num-display tabular mt-0.5 truncate', SIZE_CLASS[size], TONE_CLASS[tone])}>
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
    </Comp>
  );
}

// ---------------------------------------------------------------------------

/** Espaçamento vertical padrão entre blocos de uma página. */
export function PageStack({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('space-y-4', className)}>{children}</div>;
}

/** Estado vazio consistente — antes cada lista inventava o seu. */
export function EmptyState({
  icon, title, description, action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 px-4">
      {icon && <div className="text-muted-foreground/50 mb-2">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
