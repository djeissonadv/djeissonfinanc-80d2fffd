import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Card — superfície CALMA por padrão.
 *
 * Antes, todo Card vinha com liquid-glass + shine + spotlight (blur 30px,
 * gradiente de brilho e glow seguindo o cursor). O efeito é bonito isolado,
 * mas aplicado a TODOS os cards ele destrói a hierarquia: quando tudo está
 * elevado e brilhando, nada se destaca — e a tela vira ruído. Também custa
 * caro (backdrop-filter em dezenas de elementos simultâneos).
 *
 * Agora o padrão é uma superfície sólida com borda fina. Ênfase é OPT-IN:
 *   - `variant="elevated"` para o card protagonista da tela (raro, 1 por página)
 *   - `variant="glass"` para overlays (modal/popover), onde o blur significa
 *     "estou por cima de outra coisa" — que é o único lugar em que ele informa.
 */
const cardVariants = cva("text-card-foreground rounded-xl", {
  variants: {
    variant: {
      default: "bg-card border border-border/70",
      elevated: "bg-card border border-border shadow-lg shadow-black/20",
      glass: "glass-strong rounded-2xl",
      ghost: "bg-transparent",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  ),
);
Card.displayName = "Card";

// Padding padrão p-4 (era p-6). Com dezenas de cards por tela, 24px de padding
// empurra o conteúdo pra fora da dobra sem acrescentar informação.
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1 p-4", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

// text-base (era text-2xl): título de card é rótulo de seção, não manchete.
// O número é que deve ser grande — não o rótulo dele.
const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-base font-semibold leading-tight tracking-tight", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />,
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-4 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants };
