import type { RouteObject } from 'react-router'
import { EditPhotos, NewMemory } from './ChoosePhotos'
import { MemoriesList } from './MemoriesList'
import { MemoryDetail } from './MemoryDetail'
import { RecordMemory } from './RecordMemory'
import { ReviewMemory } from './ReviewMemory'

export const memoriesRoutes: RouteObject[] = [
  { path: '/memories', element: <MemoriesList /> },
  { path: '/memories/new', element: <NewMemory /> },
  { path: '/memories/:memoryId', element: <MemoryDetail /> },
  { path: '/memories/:memoryId/photos', element: <EditPhotos /> },
  { path: '/memories/:memoryId/record', element: <RecordMemory /> },
  { path: '/memories/:memoryId/edit', element: <ReviewMemory /> },
]
