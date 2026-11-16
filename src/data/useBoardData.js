import React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createBoardSource } from './index'

const EMPTY = []

// Network failures are retried; an answer from the server (wrong ID, missing
// sheet) is final.
const retry = (failureCount, error) => !error?.status && failureCount < 3

// The data source of a board, rebuilt only when the settings it reads change.
export function useBoardSource(board) {
  const { type, sheetId, scriptId } = board || {}
  return React.useMemo(
    () => createBoardSource(board && { type, sheetId, scriptId }),
    [!!board, type, sheetId, scriptId]
  )
}

// Loads a board's columns, tasks and users. While `paused`, nothing is fetched
// and what was loaded stays on screen.
export function useBoardData(board, { paused = false } = {}) {
  const source = useBoardSource(board)
  const enabled = !!source?.ready && !paused
  const queryKey = (part) => ["board", board?.id, source?.type, source?.key, part]
  // networkMode "always": offline, the service worker answers with what was
  // loaded last time, so the queries must still run.
  const common = { enabled, retry, networkMode: "always" }

  const columnsQuery = useQuery({ ...common, queryKey: queryKey("columns"), queryFn: () => source.loadColumns() })
  const tasksQuery = useQuery({ ...common, queryKey: queryKey("tasks"), queryFn: () => source.loadTasks(), refetchOnWindowFocus: true })
  const usersQuery = useQuery({ ...common, queryKey: queryKey("users"), queryFn: () => source.loadUsers() })

  return {
    source,
    columns: columnsQuery.data || EMPTY,
    tasks: tasksQuery.data || EMPTY,
    users: usersQuery.data || EMPTY,
    // The columns have been asked for and the answer is in (possibly empty).
    columnsLoaded: columnsQuery.isFetched && !columnsQuery.isFetching,
    tasksLoading: tasksQuery.isFetching,
    reloadTasks: tasksQuery.refetch,
  }
}

// One mutation for every write, so the board can tell that any write is
// pending: write.mutate({ op: "saveTask" | "moveTask" | "deleteTask", payload }).
export function useBoardWrite(source) {
  return useMutation({
    // Fail right away when offline instead of waiting for the connection.
    networkMode: "always",
    mutationFn: ({ op, payload }) => source[op](payload),
  })
}
