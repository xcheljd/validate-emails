import { MainLayout } from "@/components/layout/main-layout";
import { ScrollArea } from "@/components/ui/scroll-area";

function App() {
  return (
    <MainLayout>
      <header className="border-b px-8 py-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Upload List</h1>
      </header>
      <ScrollArea className="flex-1 p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <section className="p-12 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-center space-y-4">
            <div className="bg-muted p-4 rounded-full">
              {/* Icon placeholder */}
            </div>
            <div>
              <h2 className="text-xl font-semibold">Drop your email list here</h2>
              <p className="text-muted-foreground">Support for CSV and Excel files</p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Or paste emails</h2>
            <textarea 
              className="w-full h-40 p-4 rounded-md border bg-card text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Enter emails separated by commas or new lines..."
            />
          </section>
        </div>
      </ScrollArea>
    </MainLayout>
  );
}

export default App;