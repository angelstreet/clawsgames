import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import GameList from './components/GameList';
import Leaderboard from './components/Leaderboard';
import MatchView from './components/MatchView';

const basePath = import.meta.env.BASE_URL;

export default function App() {
  return (
    <BrowserRouter basename={basePath}>
      <div className="min-h-screen bg-gray-950 text-white">
        <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-6">
          <Link to="/" className="text-xl font-bold">🎮 ClawsGames</Link>
          <nav className="flex gap-4 text-sm text-gray-400">
            <Link to="/" className="hover:text-white">Games</Link>
            <Link to="/leaderboard" className="hover:text-white">Leaderboard</Link>
          </nav>
        </header>
        <main className="max-w-4xl mx-auto p-4">
          <Routes>
            <Route path="/" element={<GameList />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/leaderboard/:gameId" element={<Leaderboard />} />
            <Route path="/match/:matchId" element={<MatchView />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
