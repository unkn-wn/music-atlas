import React from 'react';
import { Sparkles, X } from 'lucide-react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel max-w-lg w-full p-6 shadow-2xl relative border border-white/20 rounded-2xl flex flex-col gap-4"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            About Music Atlas
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed">
          Music Atlas is an attempt at visualizing the global music streaming landscape, gathering
          genres from EveryNoise and public YouTube Music user playlists, with artist information
          from Deezer. The goal is to see common and similar artists that each user would listen to.
        </p>

        <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 flex flex-col gap-2.5 text-xs text-slate-300">
          <div className="flex items-start gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mt-1 shrink-0 shadow-sm" />
            <div>
              <strong className="text-white font-semibold">Dot</strong> — a music artist, larger
              meaning more popular and more fans (data from Deezer)
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="w-2.5 h-0.5 bg-cyan-400 mt-2 shrink-0 shadow-sm" />
            <div>
              <strong className="text-white font-semibold">Line</strong> — a connection between two
              artists, showing up in a significant amount of similar playlists
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-purple-400 to-pink-400 mt-1 shrink-0 shadow-sm" />
            <div>
              <strong className="text-white font-semibold">Color</strong> — a group of genres,
              defined by EveryNoise subgenres and results from YouTube
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Let me know if there are any bugs or issues at{' '}
          <a
            href="mailto:leon.mofx@gmail.com"
            className="text-emerald-400 hover:text-emerald-300 underline font-medium transition-colors"
          >
            leon.mofx@gmail.com
          </a>
          ! Inspired by the Twitch Atlas.
        </p>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition-all shadow-lg shadow-emerald-500/20 cursor-pointer"
        >
          Enter the Atlas
        </button>
      </div>
    </div>
  );
};
