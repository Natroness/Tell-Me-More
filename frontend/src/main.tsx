import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './index.css'
import { AuthGate } from './routes/AuthGate'
import { Capture } from './routes/Capture'
import { Family } from './routes/Family'
import { Heirloom } from './routes/Heirloom'
import { Interview } from './routes/Interview'
import { PublicStory } from './routes/PublicStory'
import { Shelf } from './routes/Shelf'

const router = createBrowserRouter([
  {
    element: <AuthGate />,
    children: [
      { path: '/', element: <Shelf /> },
      { path: '/capture', element: <Capture /> },
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
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
