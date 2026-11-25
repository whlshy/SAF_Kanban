import { atom } from 'jotai'
import { createdAtParts } from '@/lib/createdAt'

export const dialogAtom = atom({ open: false })

export const taskTimes = (task) => {
  const createdRaw = String(task?.createdAt ?? "").trim()
  const movedRaw = String(task?.movedAt ?? "").trim()
  const created = createdAtParts(createdRaw)
  const moved = movedRaw && movedRaw !== createdRaw ? createdAtParts(movedRaw) : null
  return { created, moved }
}
