# IT Command - Frontend

The sleek, modern, and highly-responsive frontend interface for the IT Command Platform built with Next.js 14.

## Features
- **App Router Architecture**: Leveraging Next.js 14 layouts, caching, and suspense.
- **shadcn/ui Design**: Fully custom, accessible, and themeable UI components built on Radix primitives.
- **Mobile-First Responsiveness**: Horizontal-scrolling data tables, full-screen dialogs, and a responsive bottom-navigation bar for seamless mobile workflows.
- **Global Command Search**: Lightning-fast `Cmd+K` / `Ctrl+K` global palette across all modules.
- **Real-Time Dashboards**: Powered by Recharts for data visualization.
- **State Management**: Zustand for global auth and settings state.

## Setup & Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Create a `.env.local` file in the root directory:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

### 3. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Technologies Used
- Next.js 14
- React Hook Form + Zod (Validation)
- Tailwind CSS
- shadcn/ui
- Zustand
- Recharts
- Lucide Icons
