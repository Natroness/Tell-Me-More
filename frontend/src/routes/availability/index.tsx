import type { RouteObject } from 'react-router'
import { EditBusyPeriodScreen } from './EditBusyPeriod'
import { FamilyAvailabilityScreen } from './FamilyAvailability'
import { MyScheduleScreen } from './MySchedule'
import { RelativeStatusScreen } from './RelativeStatus'

export const availabilityRoutes: RouteObject[] = [
  { path: '/availability', element: <FamilyAvailabilityScreen /> },
  { path: '/availability/me', element: <MyScheduleScreen /> },
  { path: '/availability/busy/new', element: <EditBusyPeriodScreen /> },
  { path: '/availability/busy/:entryId', element: <EditBusyPeriodScreen /> },
  { path: '/availability/person/:userId', element: <RelativeStatusScreen /> },
]
