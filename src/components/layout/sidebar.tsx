import { Button } from "@/components/ui/button";
import { Upload, History } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
}

export function Sidebar({ className, children, ...props }: SidebarProps) {
  return (
    <div className={cn("pb-12 space-y-4", className)} {...props}>
      <div className="px-4 space-y-4">
        <h3 className="text-sm font-semibold px-2 mb-4 uppercase tracking-wider text-muted-foreground">
          Main Menu
        </h3>
        <div className="space-y-2">
          <div>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
            >
              <Upload className="h-4 w-4" />
              Upload List
            </Button>
          </div>
          <div>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
            >
              <History className="h-4 w-4" />
              History
            </Button>
          </div>
        </div>

        {children && (
          <div className="mt-6 pt-6 border-t">
            <h3 className="text-sm font-semibold px-2 mb-4 uppercase tracking-wider text-muted-foreground">
              Actions
            </h3>
            <div className="space-y-2">
              {children}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
