import {
  LayoutDashboard,
  ArrowLeftRight,
  Calculator,
  Wallet,
  Settings,
  DollarSign,
  FolderOpen,
  TrendingUp,
  ClipboardList,
  BarChart3,
  Landmark,
  CalendarClock,
  Scale,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from '@/components/ui/sidebar';

// Fluxo diário — as telas que respondem "como está meu dinheiro" e o que fazer.
// Ordem: onde estou → o que entra/sai → pra onde foi → o que vem → simular → dívida.
const principais = [
  { title: 'Início', url: '/', icon: LayoutDashboard },
  { title: 'Lançamentos', url: '/transacoes', icon: ArrowLeftRight },
  { title: 'Gastos', url: '/analises', icon: BarChart3 },
  { title: 'Planejar', url: '/projecoes', icon: TrendingUp },
  { title: 'Cenários', url: '/cenarios', icon: Scale },
  { title: 'Dívidas', url: '/dividas', icon: Landmark },
];

// "Mais" — telas que vão ser absorvidas pelas principais nos próximos passos
// (Calculadora→Planejar, Contas/Categorias→Ajustes, etc.). Ficam aqui pra nada
// quebrar enquanto a fusão não acontece; o grupo encolhe conforme eu fundo.
const mais = [
  { title: 'Calculadora', url: '/calculadora', icon: Calculator },
  { title: 'Contas', url: '/contas', icon: Wallet },
  { title: 'Planejamento', url: '/planejamento', icon: ClipboardList },
  { title: 'A pagar/receber', url: '/a-pagar-receber', icon: CalendarClock },
  { title: 'Categorias', url: '/categorias', icon: FolderOpen },
  { title: 'Ajustes', url: '/configuracoes', icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  const renderItem = (item: { title: string; url: string; icon: typeof LayoutDashboard }) => (
    <SidebarMenuItem key={item.title}>
      <SidebarMenuButton asChild>
        <NavLink
          to={item.url}
          end={item.url === '/'}
          className="hover:bg-muted/50"
          activeClassName="bg-primary/10 text-primary font-medium"
        >
          <item.icon className="mr-2 h-4 w-4" />
          {!collapsed && <span>{item.title}</span>}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <DollarSign className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && <span className="font-semibold text-base">FinançasPro</span>}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{principais.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Mais</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{mais.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
