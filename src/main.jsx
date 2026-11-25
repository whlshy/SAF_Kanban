import React from "react"
import ReactDOM from 'react-dom/client'
import App from "./components/App"
import './styles/lib/tailwind.css'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query"
import { BrowserRouter } from "react-router-dom"
import { message } from '@/lib/notify'
import { t } from '@/i18n'
import { startPwa } from '@/pwa'
import { startDesktopUpdater } from '@/desktopUpdate'

const isProd = import.meta.env.MODE === 'production'

const Index = () => {
  const onError = (error) => {
    // Errors with a specific hint (e.g. from the Apps Script) stay on screen longer.
    if (error?.userMessage) message.error(error.userMessage, 8)
    else message.error(t("common.apiError"))
  }

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false, // default: true
      },
    },
  })

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={isProd ? '/SAF_Kanban/' : '/'}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

startPwa()
startDesktopUpdater()

const rootElement = document.getElementById('root')
ReactDOM.createRoot(rootElement).render(<Index />)
