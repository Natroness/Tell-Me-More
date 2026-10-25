import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from './supabase'

type Table = 'interview' | 'turn' | 'job' | 'story' | 'memory_note' | 'notification' | 'story_request' | 'heirloom' | 'media' | 'profile' | 'immersive_world' | 'storytime' | 'person' | 'relationship' | 'member' | 'family_event'

/**
 * Refetches `queryKey` whenever a row matching `filter` changes (DESIGN.md §5.6).
 * The backend only writes rows; this is how the phone hears about them.
 */
export function useLiveQuery(table: Table, filter: string, queryKey: QueryKey) {
  useLiveQueries(table, filter, [queryKey])
}

/** One subscription that refetches several queries, e.g. a date feeding a calendar and a timeline. */
export function useLiveQueries(table: Table, filter: string, queryKeys: QueryKey[]) {
  const qc = useQueryClient()
  const keys = JSON.stringify(queryKeys)
  useEffect(() => {
    const channel = supabase
      .channel(`${table}:${filter}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => {
        for (const queryKey of JSON.parse(keys) as QueryKey[]) qc.invalidateQueries({ queryKey })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [qc, table, filter, keys])
}
