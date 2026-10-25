import type { RouteObject } from 'react-router'
import { DatesCalendar } from './DatesCalendar'
import { EventDetail } from './EventDetail'
import { EditEvent, NewEvent } from './EventForm'
import { YearOverview } from './YearOverview'

export const datesRoutes: RouteObject[] = [
  { path: '/dates', element: <DatesCalendar /> },
  { path: '/dates/year', element: <YearOverview /> },
  { path: '/dates/new', element: <NewEvent /> },
  { path: '/events/:eventId', element: <EventDetail /> },
  { path: '/events/:eventId/edit', element: <EditEvent /> },
]
