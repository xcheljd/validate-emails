import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
   <React.StrictMode>
     <QueryClientProvider client={queryClient}>
       <App />
       <Toaster position="top-right" theme="light" richColors />
     </QueryClientProvider>
   </React.StrictMode>,
 );
