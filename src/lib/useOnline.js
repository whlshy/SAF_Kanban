import { useSyncExternalStore } from 'react'

const subscribe = (callback) => {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)
  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

// False only when the browser knows it has no connection.
export default function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine !== false)
}
