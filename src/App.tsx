import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Download, Loader2, Video, Image as ImageIcon, AlertCircle } from "lucide-react";

export default function App() {
  const [imageUrl, setImageUrl] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrl) return;

    setIsGenerating(true);
    setError(null);
    setVideoUrl(null);

    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageUrl }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate video");
      }

      const blob = await response.blob();
      const videoBlob = new Blob([blob], { type: "video/mp4" });
      const url = window.URL.createObjectURL(videoBlob);
      setVideoUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Background Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-orange-500/10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-20">
        <header className="mb-16 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 mb-6">
              <Video className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-medium uppercase tracking-wider text-white/60">Reel Ready</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
              Image to Reel
            </h1>
            <p className="text-lg text-white/40 max-w-xl mx-auto">
              Transform any static image into a 5-second vertical MP4 video optimized for Reels, TikTok, and Shorts.
            </p>
          </motion.div>
        </header>

        <section className="grid gap-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl"
          >
            <form onSubmit={handleGenerate} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="imageUrl" className="text-sm font-medium text-white/60 ml-1">
                  Public Image URL
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-white/20 group-focus-within:text-orange-500 transition-colors">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <input
                    id="imageUrl"
                    type="url"
                    required
                    placeholder="https://images.unsplash.com/photo-..."
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isGenerating || !imageUrl}
                className="w-full bg-white text-black font-bold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-orange-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating Video...
                  </>
                ) : (
                  <>
                    <Video className="w-5 h-5" />
                    Generate 5s Reel
                  </>
                )}
              </button>
            </form>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 text-sm"
                >
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Preview Section */}
          <AnimatePresence>
            {videoUrl && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="grid md:grid-cols-2 gap-8 items-start"
              >
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-xl">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Video className="w-5 h-5 text-orange-500" />
                    Preview
                  </h3>
                  <div className="aspect-[9/16] bg-black rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                    <video
                      key={videoUrl}
                      src={videoUrl}
                      controls
                      autoPlay
                      loop
                      playsInline
                      className="w-full h-full object-cover"
                    >
                      <source src={videoUrl} type="video/mp4" />
                      Your browser does not support the video tag.
                    </video>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
                    <h3 className="text-xl font-bold mb-4">Success!</h3>
                    <p className="text-white/60 mb-8">
                      Your 5-second vertical video has been generated. It's scaled and cropped to 1080x1920, perfect for mobile platforms.
                    </p>
                    <a
                      href={videoUrl}
                      download="reel.mp4"
                      className="inline-flex items-center gap-2 px-8 py-4 bg-orange-500 text-white font-bold rounded-2xl hover:bg-orange-600 transition-all active:scale-[0.98]"
                    >
                      <Download className="w-5 h-5" />
                      Download MP4
                    </a>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-xl">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-white/40 mb-4">Specifications</h4>
                    <ul className="space-y-3 text-sm">
                      <li className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-white/40">Duration</span>
                        <span className="font-mono">5.0s</span>
                      </li>
                      <li className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-white/40">Resolution</span>
                        <span className="font-mono">1080 x 1920</span>
                      </li>
                      <li className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-white/40">Aspect Ratio</span>
                        <span className="font-mono">9:16</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-white/40">Codec</span>
                        <span className="font-mono">H.264 / MP4</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <footer className="mt-32 text-center text-white/20 text-sm">
          <p>&copy; 2026 Image to Reel Converter. Built for speed and simplicity.</p>
        </footer>
      </main>
    </div>
  );
}
