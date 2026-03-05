import { BrowserRouter, Routes, Route } from 'react-router-dom';
import SpectatorHub from './components/SpectatorHub';
import MatchView from './components/MatchView';
import ShowdownBattle from './components/ShowdownBattle';

const basePath = import.meta.env.BASE_URL;

export default function App() {
  return (
    <BrowserRouter basename={basePath}>
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between">
          <div className="text-xl font-bold tracking-tight">🎮 ClawsGames</div>
          <a
            href="https://rankingofclaws.angelstreet.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1"
          >
            Rankings <span className="text-xs">→</span>
          </a>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<SpectatorHub />} />
            <Route path="/match/:matchId" element={<MatchView />} />
            <Route path="/battle/:matchId" element={<ShowdownBattle />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
