import { Button } from "@/components/ui/button";
import { Upload, History, Settings, BarChart2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModeToggle } from "@/components/mode-toggle";
import { useSettings } from "@/hooks/use-settings";

export type SidebarView = 'validation' | 'history' | 'session-details' | 'analytics' | 'settings';

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  currentView: SidebarView;
  onNavigate: (view: SidebarView) => void;
}

export function Sidebar({ className, currentView, onNavigate, ...props }: SidebarProps) {
  const { settings, updateSettings } = useSettings();
  const isCollapsed = settings.sidebarCollapsed;

  const toggleCollapse = () => {
    updateSettings({ sidebarCollapsed: !isCollapsed });
  };

  return (
    <div 
      className={cn(
        "border-r bg-card min-h-screen flex flex-col hidden md:flex transition-all duration-300 ease-in-out", 
        isCollapsed ? "w-[70px]" : "w-64",
        className
      )} 
      {...props}
    >
      <div className={cn("p-4 flex items-center h-16", isCollapsed ? "justify-center" : "justify-between")}>
        {!isCollapsed && <h2 className="text-lg font-bold tracking-tight truncate">Email Validator</h2>}
        <Button variant="ghost" size="icon" onClick={toggleCollapse} title={isCollapsed ? "Expand" : "Collapse"}>
           {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>
      
      <div className="px-2 space-y-4 flex-1 py-4 flex flex-col">
        <div className="space-y-1">
           <NavButton 
             active={currentView === 'validation'} 
             onClick={() => onNavigate('validation')} 
             icon={<Upload className="h-4 w-4" />} 
             label="Validation" 
             collapsed={isCollapsed} 
           />
           <NavButton 
             active={currentView === 'history' || currentView === 'session-details'} 
             onClick={() => onNavigate('history')} 
             icon={<History className="h-4 w-4" />} 
             label="History" 
             collapsed={isCollapsed} 
           />
           <NavButton 
             active={currentView === 'analytics'} 
             onClick={() => onNavigate('analytics')} 
             icon={<BarChart2 className="h-4 w-4" />} 
             label="Analytics" 
             collapsed={isCollapsed} 
           />
        </div>

        <div className="mt-auto pt-4 border-t space-y-4">
          <div className="space-y-1">
             <NavButton
              active={currentView === 'settings'}
              onClick={() => onNavigate('settings')}
              icon={<Settings className="h-4 w-4" />}
              label="Settings"
              collapsed={isCollapsed}
            />
          </div>
          
          <div className={cn("flex items-center px-2", isCollapsed ? "justify-center" : "justify-between")}>
            {!isCollapsed && <span className="text-xs font-medium text-muted-foreground pl-2">Theme</span>}
            <ModeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, collapsed }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; collapsed: boolean }) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      className={cn(
        "w-full justify-start gap-2 overflow-hidden", 
        collapsed ? "justify-center px-0" : "px-4"
      )}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </Button>
  )
}