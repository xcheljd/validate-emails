import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { LayoutDashboard, Upload, History, Settings, MailCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Sidebar({ className }: SidebarProps) {
  return (
    <div className={cn("pb-12 border-r bg-card w-64 h-screen flex flex-col", className)}>
      <div className="px-6 py-6 flex items-center gap-2">
        <MailCheck className="h-6 w-6 text-primary" />
        <h2 className="text-xl font-bold tracking-tight text-foreground">ReachCheck</h2>
      </div>
      <Separator />
      <ScrollArea className="flex-1 px-4 py-6">
        <div className="space-y-4">
          <div className="px-2 py-2">
            <h3 className="mb-2 px-4 text-xs font-semibold tracking-tight text-muted-foreground uppercase">
              Validation
            </h3>
            <div className="space-y-1">
              <Button variant="ghost" className="w-full justify-start gap-2">
                <Upload className="h-4 w-4" />
                Upload List
              </Button>
              <Button variant="ghost" className="w-full justify-start gap-2">
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Button>
            </div>
          </div>
          <div className="px-2 py-2">
            <h3 className="mb-2 px-4 text-xs font-semibold tracking-tight text-muted-foreground uppercase">
              History
            </h3>
            <div className="space-y-1">
              <Button variant="ghost" className="w-full justify-start gap-2">
                <History className="h-4 w-4" />
                Past Results
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>
      <Separator />
      <div className="px-6 py-4">
        <Button variant="ghost" className="w-full justify-start gap-2">
          <Settings className="h-4 w-4" />
          Settings
        </Button>
      </div>
    </div>
  );
}
