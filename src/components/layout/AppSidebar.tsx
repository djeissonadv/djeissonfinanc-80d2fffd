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
import { useLocation } from 'react-router-dom';
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

const items = [
  { title: 'Dashboard', url: '/', icon: LayoutDashboard },
  { title: 'Transações', url: '/transacoes', icon: ArrowLeftRight },
  { title: 'Calculadora', url: '/calculadora', icon: Calculator },
  { title: 'Cenários', url: '/cenarios', icon: Scale },
  { title: 'Contas', url: '/contas', icon: Wallet },
  { title: 'Projeções', url: '/projecoes', icon: TrendingUp },
  { title: 'Planejamento', url: '/planejamento', icon: ClipboardList },
  { title: 'Análises', url: '/analises', icon: BarChart3 },
  { title: 'A pagar/receber', url: '/a-pagar-receber', icon: CalendarClock },
  { title: 'Dívidas', url: '/dividas', icon: Landmark },
  { title: 'Categorias', url: '/categorias', icon: FolderOpen },
  { title: 'Configurações', url: '/configuracoes', icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <DollarSign className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && <span className="font-bold text-lg">FinançasPro</span>}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
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
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
