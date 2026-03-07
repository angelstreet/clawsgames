import { BrowserRouter, Routes, Route } from 'react-router-dom';
import SpectatorHub from './components/SpectatorHub';
import MatchView from './components/MatchView';
import LiveBattle from './components/LiveBattle';

const basePath = import.meta.env.BASE_URL;

export default function App() {
  return (
    <BrowserRouter basename={basePath}>
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        <header className="border-b border-white/10 px-4 pb-2 flex items-start justify-between">
          <div></div>
          <img src="/logo.jpg" alt="ClawsGames" className="h-32 w-auto" />
          <a
            href="https://rankingofclaws.angelstreet.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1 mt-1"
          >
            Rankings <span className="text-xs">→</span>
          </a>
        </header>
        <main className="max-w-6xl mx-auto px-4 pt-2">
          <Routes>
            <Route path="/" element={<SpectatorHub />} />
            <Route path="/match/:matchId" element={<MatchView />} />
            <Route path="/battle/:matchId" element={<MatchView />} />
            <Route path="/live/:matchId" element={<LiveBattle />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
