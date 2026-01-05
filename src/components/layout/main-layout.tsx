import { Sidebar, SidebarView } from "./sidebar";

interface MainLayoutProps {
  children: React.ReactNode;
  currentView: SidebarView;
  onNavigate: (view: SidebarView) => void;
}

export function MainLayout({ children, currentView, onNavigate }: MainLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar currentView={currentView} onNavigate={onNavigate} />
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {children}
      </main>
    </div>
  );
}