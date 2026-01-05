import { Button } from "@/components/ui/button";
import { Upload, History, Settings, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModeToggle } from "@/components/mode-toggle";

export type SidebarView = 'validation' | 'history' | 'session-details' | 'analytics' | 'settings';

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  currentView: SidebarView;
  onNavigate: (view: SidebarView) => void;
}

export function Sidebar({ className, currentView, onNavigate, ...props }: SidebarProps) {
  return (
    <div className={cn("w-64 border-r bg-card min-h-screen flex flex-col hidden md:flex", className)} {...props}>
      <div className="p-6">
        <h2 className="text-lg font-bold tracking-tight">Email Validator</h2>
      </div>
      <div className="px-4 space-y-4 flex-1">
        <div className="space-y-1">
          <Button
            variant={currentView === 'validation' ? "secondary" : "ghost"}
            className="w-full justify-start gap-2"
            onClick={() => onNavigate('validation')}
          >
            <Upload className="h-4 w-4" />
            Validation
          </Button>
          <Button
            variant={currentView === 'history' || currentView === 'session-details' ? "secondary" : "ghost"}
            className="w-full justify-start gap-2"
            onClick={() => onNavigate('history')}
          >
            <History className="h-4 w-4" />
            History
          </Button>
          <Button
            variant={currentView === 'analytics' ? "secondary" : "ghost"}
            className="w-full justify-start gap-2"
            onClick={() => onNavigate('analytics')}
          >
            <BarChart2 className="h-4 w-4" />
            Analytics
          </Button>
        </div>

        <div className="mt-6 pt-6 border-t space-y-4">
          <div className="space-y-1">
             <Button
              variant={currentView === 'settings' ? "secondary" : "ghost"}
              className="w-full justify-start gap-2"
              onClick={() => onNavigate('settings')}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          </div>
          <div className="flex items-center justify-between px-2">
            <span className="text-xs font-medium text-muted-foreground pl-2">Theme</span>
            <ModeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}
