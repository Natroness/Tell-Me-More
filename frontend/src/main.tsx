import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './index.css'
import { DisplayModeProvider } from './lib/displayMode'
import { Archive } from './routes/Archive'
import { AuthGate } from './routes/AuthGate'
import { Capture } from './routes/Capture'
import { ChooseStoryteller } from './routes/ChooseStoryteller'
import { Family } from './routes/Family'
import { Heirloom } from './routes/Heirloom'
import { Home } from './routes/Home'
import { Interview } from './routes/Interview'
import { MyRequests } from './routes/MyRequests'
import { Notifications } from './routes/Notifications'
import { Onboarding } from './routes/Onboarding'
import { PublicStory } from './routes/PublicStory'
import { RecordStory } from './routes/RecordStory'
import { RequestConfirm } from './routes/RequestConfirm'
import { RequestDetail } from './routes/RequestDetail'
import { Review } from './routes/Review'
import { ReviewShare } from './routes/ReviewShare'
import { Settings } from './routes/Settings'
import { Shelf } from './routes/Shelf'
import { Tell } from './routes/Tell'

const router = createBrowserRouter([
  {
    element: <AuthGate />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/stories', element: <Shelf /> },
      { path: '/capture', element: <Capture /> },
      { path: '/review', element: <Review /> },
      { path: '/archive', element: <Archive /> },
      { path: '/choose/:heirloomId', element: <ChooseStoryteller /> },
      { path: '/request-confirm/:requestId', element: <RequestConfirm /> },
      { path: '/requests', element: <MyRequests /> },
      { path: '/requests/:requestId', element: <RequestDetail /> },
      { path: '/answer/:requestId', element: <RecordStory /> },
      { path: '/tell', element: <Tell /> },
      { path: '/share/:heirloomId', element: <ReviewShare /> },
      { path: '/notifications', element: <Notifications /> },
      { path: '/settings', element: <Settings /> },
      { path: '/onboarding', element: <Onboarding /> },
      { path: '/h/:heirloomId', element: <Heirloom /> },
      { path: '/interview/:interviewId', element: <Interview /> },
      { path: '/family', element: <Family /> },
    ],
  },
  { path: '/s/:heirloomId', element: <PublicStory /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <DisplayModeProvider>
        <RouterProvider router={router} />
      </DisplayModeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
