import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from './supabase'

type Table = 'interview' | 'turn' | 'job' | 'story' | 'memory_note'

/**
 * Refetches `queryKey` whenever a row matching `filter` changes (DESIGN.md §5.6).
 * The backend only writes rows; this is how the phone hears about them.
 */
export function useLiveQuery(table: Table, filter: string, queryKey: QueryKey) {
  const qc = useQueryClient()
  const key = JSON.stringify(queryKey)
  useEffect(() => {
    const channel = supabase
      .channel(`${table}:${filter}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () =>
        qc.invalidateQueries({ queryKey: JSON.parse(key) }),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [qc, table, filter, key])
}
