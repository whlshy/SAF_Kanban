import React from "react"
import ReactDOM from 'react-dom/client'
import App from "./components/App"
import './styles/main.styl'
import './styles/lib/tailwind.css'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query"
import { message } from 'antd'
import { BrowserRouter } from "react-router-dom"
import useSnackbarStore from "@/store/snackbar"
import { t } from '@/i18n'

const isProd = import.meta.env.MODE === 'production'

const Index = () => {
  const { setSnackMsg } = useSnackbarStore(state => state)

  const onError = (error, variables, context) => {
    console.log('onError', error, variables)
    // Apps Script errors carry a specific hint; keep those on screen longer.
    if (error?.userMessage) message.error(error.userMessage, 8)
    else message.error(t("common.apiError"))
  }

  const onSuccess = async (data, query) => {
    const status = (data?.body?.status !== null && data?.body?.status !== undefined) ? data?.body?.status : null
    if (status !== null && data?.body?.message)
      setSnackMsg({ message: data?.body?.message })
    !data?.ok && status == null && message.error(t("common.apiError"))
  }

  const onSettled = (data, error) => {
  }

  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onSuccess,
      onError,
      onSettled,
    }),
    mutationCache: new MutationCache({
      onSuccess,
      onError
    }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false, // default: true
        select: (data) => {
          const status = (data?.body?.status !== null && data?.body?.status !== undefined) ? data?.body?.status : null
          return status == null ? (data.body || null) : null
        }
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

const rootElement = document.getElementById('root')
ReactDOM.createRoot(rootElement).render(<Index />)
